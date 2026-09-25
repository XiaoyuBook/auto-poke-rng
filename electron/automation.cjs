const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { AutomationStore, defaultFilter, defaults } = require('./automation-store.cjs');
const { startWorker } = require('./automation-worker.cjs');
const { validateConfig: validateBlink } = require('./blink-client.cjs');
const data = require('../src/generated/bdsp-data.json');
const reverseGroups = [['Articuno','Zapdos','Moltres'],['Raikou','Entei','Suicune'],['Regirock','Regice','Registeel'],['Latias','Latios']];

function validateParameters(kind, parameters) {
  const limits=kind==='tid'?{frame_threshold:[0,250000],delay:[0,1000000000],loop_count:[1,1000000]}:
    {initial_advances:[0,10000000],max_advances:[0,1000000000],offset:[0,1000000],fixed_delay:[0,1000000000],max_wait_frames:[0,1000000],
      reseed_threshold_frames:[0,1000000],reidentify_max_attempts:[1,100],reidentify_seed_max_attempts:[1,100],reseeding_threshold:[0,1000000000],reverse_lookup_window:[0,10000],loop_count:[1,1000000],sync_mode:[0,2]};
  for(const [key,[low,high]]of Object.entries(limits))if(!Number.isInteger(parameters[key])||parameters[key]<low||parameters[key]>high)throw Error(`${key} 需要在 ${low}–${high} 之间`);
  if(!['single','count','infinite'].includes(parameters.loop_mode)||!(kind==='tid'?['script','capture']:['script','capture','reidentify']).includes(parameters.start))throw Error('运行模式无效');
  if(kind==='tid'){
    if(!Array.isArray(parameters.target_display_tids)||!parameters.target_display_tids.length||parameters.target_display_tids.some(value=>!Number.isInteger(value)||value<0||value>999999))throw Error('请添加0–999999之间的目标 Display TID');
  }else{
    if(!data.targets.some(target=>target.speciesKey===parameters.target))throw Error('目标宝可梦无效');
    if(!['next_round','recapture_seed'].includes(parameters.reidentify_failure_policy))throw Error('校正失败策略无效');
    if(parameters.shiny_threshold_seconds!==null&&(!Number.isFinite(parameters.shiny_threshold_seconds)||parameters.shiny_threshold_seconds<=0||parameters.shiny_threshold_seconds>300))throw Error('判闪阈值应大于0且不超过300秒');
    if(!Number.isInteger(parameters.lead)||![...Array(27).keys(),255].includes(parameters.lead))throw Error('队首参数无效');
    if(parameters.sync_mode>0&&!data.natures.includes(parameters.sync_nature))throw Error('请设置同步性格');
    if(!Array.isArray(parameters.filters)||!parameters.filters.length||parameters.filters.length>20)throw Error('需要1–20组目标筛选条件');
    for(const filter of parameters.filters){
      if(![0,1,2,3,255].includes(filter.shiny)||![0,1,2,255].includes(filter.ability)||![0,1,2,255].includes(filter.gender))throw Error('筛选参数无效');
      if(!Array.isArray(filter.natures)||filter.natures.length!==25||filter.natures.some(value=>typeof value!=='boolean'))throw Error('性格筛选无效');
      if(!['ivMin','ivMax'].every(key=>Array.isArray(filter[key])&&filter[key].length===6&&filter[key].every(value=>Number.isInteger(value)&&value>=0&&value<=31))||filter.ivMin.some((v,i)=>v>filter.ivMax[i]))throw Error('个体值范围无效');
      for(const name of ['height','weight'])if(!Number.isInteger(filter[name+'Min'])||!Number.isInteger(filter[name+'Max'])||filter[name+'Min']<0||filter[name+'Max']>255||filter[name+'Min']>filter[name+'Max'])throw Error('体型范围无效');
    }
  }
}

function registerAutomation({ipcMain,getMainWindow,getWindows,devices,rng,blink,userData,workerFactory=startWorker,captureImage}){
  const store=new AutomationStore(userData);let active=null, auxiliary=null, timer=null, closed=false;
  let state={status:'idle',kind:null,runId:null,progress:null,capture:null,message:'等待开始',revision:0};
  const snapshot=()=>({...store.snapshot(),state});
  const broadcast=()=>{
    clearTimeout(timer);timer=setTimeout(()=>{for(const window of getWindows())if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('automation:state',snapshot());},40);
  };
  store.on('change',broadcast);store.on('log',broadcast);
  const update=patch=>{state={...state,...patch,revision:state.revision+1};broadcast();};
  const requireWindow=(event,main=false)=>{
    if(event.senderFrame!==event.sender.mainFrame||!getWindows().some(window=>!window.isDestroyed()&&window.webContents===event.sender)||(main&&event.sender!==getMainWindow()?.webContents))throw Error('Unknown automation sender');
  };
  const handle=(name,action,main=true)=>ipcMain.handle('automation:'+name,async(event,args)=>{requireWindow(event,main);if(closed)throw Error('程序正在关闭');return action(args);});
  const checkStopped=run=>{if(closed||run.stopped||(active!==run&&auxiliary!==run))throw Error('自动流程已停止');};
  const runScript=async(run,text,name)=>{
    await run.keepalive;
    checkStopped(run);
    const selected=run.scripts[name]||Object.values(run.scripts)[0];
    if(!selected)throw Error('未配置脚本目录');
    let resolve,reject,id;const early=[];
    const complete=new Promise((a,b)=>{resolve=a;reject=b;});
    // A very short failed script can report before start() returns its run ID.
    complete.catch(()=>{});
    const dispatch=message=>{
      if(message.runId!==id)return;
      if(message.event==='script.log'){
        store.log(message.message,'脚本','info',{runId:run.id,round:run.round});
        if(/已检测到进入战斗/.test(message.message))run.worker?.send({event:'battle'});
      }
      if(message.event==='script.done')message.status==='completed'?resolve():reject(Error(message.message||'脚本已停止'));
    };
    const listener=message=>{if(!id)early.push(message);else dispatch(message);};
    devices.events.on('script',listener);
    try{
      ({runId:id}=await devices.runner.start({text,path:selected.path,shouldStop:()=>run.stopped||closed||(active!==run&&auxiliary!==run)}));
      for(const message of early)dispatch(message);
      if(run.stopped){await devices.runner.stop();throw Error('自动流程已停止');}
      await complete;checkStopped(run);
    }finally{devices.events.off('script',listener);}
  };
  const image=captureImage||(async()=>{
    const source=devices.getState().video;
    if(source.status!=='connected')throw Error('请先连接视频源');
    const response=await fetch(`${source.baseUrl}/snapshot.png?session=${encodeURIComponent(source.session)}`,{headers:{Authorization:'Bearer '+source.token},signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error('读取视频帧失败');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(devices.getState().video.session!==source.session)throw Error('视频源已切换');
    return bytes.toString('base64');
  });
  const ocrRequest=async(params,rows=store.data.config.ocr)=>devices.ocr.read(params.imageBase64||await image(),'',{...params,regions:Object.fromEntries(rows.map(row=>[row.id,['x','y','width','height'].map(key=>row.rect[key])]))});
  const checks=async input=>{
    const checks=[];let scripts={},target;
    const add=async(label,action)=>{try{await action();checks.push({label,ok:true,detail:'已就绪'});}catch(error){checks.push({label,ok:false,detail:error.message});}};
    const {kind,config,profile}=input||{};
    await add('任务参数',()=>{if(!['static','tid'].includes(kind)||!config?.parameters||!config?.scripts)throw Error('自动流程配置无效');validateParameters(kind,config.parameters);target=data.targets.find(item=>item.speciesKey===config.parameters.target);
      if(kind==='static'&&(!profile||!['BD','SP'].includes(profile.version)||!['tid','sid'].every(key=>Number.isInteger(profile[key])&&profile[key]>=0&&profile[key]<=65535)))throw Error('存档参数无效');
      if(target&&target.version!=='BDSP'&&target.version!==profile.version)throw Error('该目标不属于当前存档版本');});
    await add('视频源',()=>{if(devices.getState().video.status!=='connected')throw Error('请先连接视频源');});
    await add('伊机控',()=>{if(devices.getState().controller.status!=='connected')throw Error('请先连接伊机控');if(devices.runner.current)throw Error('已有手动脚本正在运行');});
    await add('眼睛模板与校正配置',()=>{validateBlink({...input.blink,mode:kind==='tid'?'munchlax':config?.parameters?.start==='reidentify'?'reidentify':'recover'},devices.getState().video);if(input.exitBlink)validateBlink({...input.exitBlink,mode:'recover'},devices.getState().video);
      if(config?.parameters?.exit_blink_name&&!input.exitBlink)throw Error('所选过场测种配置已不可用，请重新选择');
      if(['starting','preview','capturing','solving','tracking','countdown','timeline','stopping'].includes(blink.getState().status))throw Error('请先停止手动眨眼捕获/推进');});
    await add('脚本配置与语法',async()=>{
      if(!config?.scripts||!config.parameters)throw Error('脚本选择无效');
      const required=kind==='tid'?['name']:['advance','hit'];
      if(config.parameters.start==='script'||config.parameters.loop_mode!=='single')required.push('seed');
      if(config.parameters.auto_reverse)required.push('reverse');if(config.parameters.escape_continue)required.push('escape');
      for(const key of required)if(!config.scripts[key])throw Error(`请选择 ${key} 脚本`);
      for(const [key,relative] of Object.entries(config.scripts)){
        if(!relative)continue;
        const {absolute}=await devices.runner.resolveScript(relative);
        const text=await fs.readFile(absolute,'utf8');
        const validation=await devices.runner.validate({text,path:relative});
        if(!validation.valid)throw Error(`${relative}：${validation.diagnostic?.message||'语法检查取消'}`);
        scripts[key]={path:relative,text};
      }
      if(kind==='static'&&!/^\s*_目标帧数\s*=/m.test(scripts.advance?.text||''))throw Error('过帧脚本缺少 _目标帧数 参数');
      if(config.parameters.escape_continue&&!config.parameters.shiny_threshold_seconds)throw Error('逃跑续搜需要启用判闪');
    });
    return {checks,ready:checks.every(item=>item.ok),scripts,target};
  };
  const stop=async(message='用户停止',failure=false)=>{
    const run=active||auxiliary;if(!run)return;
    if(run.stopped)return run.done;
    run.stopped=true;run.failure=failure;run.stopReason=message;
    if(run.calibration){await run.worker?.stop(message);return run.done;}
    if(active===run){store.history(run.id,'stop',[message,state.progress]);update({status:'stopping',message});}
    await Promise.allSettled([run.worker?.stop(message),run.stop?.(message),devices.runner.stop(),rng.cancel(),devices.controller.child&&devices.controller.call('controller.stop')]);
    if(run.done)await run.done;
  };
  const emergencyStop=()=>{void stop('伊机控停止操作');};
  devices.events.on('stop-automation',emergencyStop);
  const start=async input=>{
    if(active||auxiliary||rng.isBusy())throw Error('已有任务正在运行');
    input=structuredClone(input);
    const run={id:randomUUID(),kind:input.kind,round:0,stopped:false,scripts:{},worker:null};active=run;
    update({status:'starting',kind:input.kind,runId:run.id,progress:null,capture:null,seed:null,roundDelay:null,message:'检查运行条件…'});
    try{
      await devices.claimAutomation(run.id);
      checkStopped(run);
      const result=await checks(input);checkStopped(run);
      if(!result.ready)throw Error(result.checks.filter(item=>!item.ok).map(item=>`${item.label}：${item.detail}`).join('\n'));
      store.change(next=>{
        next.config[input.kind]=structuredClone(input.config);
        if(input.kind==='static')store.profile(next,result.target.speciesId).config.baseline_delay=input.config.parameters.fixed_delay;
      });
      run.input=structuredClone(input);run.target=result.target;run.ocr=structuredClone(store.data.config.ocr);
      for(const selected of Object.values(result.scripts))run.scripts[selected.path]=selected;
      if(input.config.parameters.shiny_threshold_seconds||input.config.parameters.auto_reverse||input.config.parameters.loop_mode!=='single')await devices.ocr.start();
      checkStopped(run);store.beginRun(run.id,run.kind);
      const source=input.kind==='tid'?'自动TID':'自动定点';
      const context=()=>({runId:run.id,round:run.round});
      const request=async(method,params)=>{
        checkStopped(run);
        if(method==='script')return runScript(run,params.text,params.name);
        if(method==='ocr')return ocrRequest(params,run.ocr);
        if(method==='delay_profile'){
          const profile=store.data.profiles[run.target.speciesId];
          return structuredClone(profile||{config:{strategy:'fixed',baseline_delay:input.config.parameters.fixed_delay,multi_candidate_policy:'ignore',window_size:5,ewma_alpha:.5,dense_interval_width:2},samples:[]});
        }
        if(method==='delay_record'){store.recordDelay(run.target.speciesId,params.candidates);return null;}
        if(method==='search'){
          const p=run.input.config.parameters;
          let initial=p.initial_advances,max=p.max_advances,lead=params.lead??p.lead,filters=p.filters;
          if(params.reverse){const center=params.reverse.target.raw_target_advances;initial=Math.max(0,center-p.reverse_lookup_window);max=center+p.reverse_lookup_window-initial;
            lead=params.reverse.target.sync_source==='sync'?params.reverse.target.sync_nature:p.lead;
            const nature=data.natures.indexOf(params.reverse.nature);filters=[{...defaultFilter(),shiny:255,natures:data.natures.map((_,i)=>nature<0||i===nature)}];}
          const rows=new Map();
          const targets=params.reverse?(reverseGroups.find(group=>group.includes(p.target))||[p.target]):[p.target];
          for(const target of targets)for(const filter of filters){checkStopped(run);const values=await rng.generate({seed0:params.seed.pair[0],seed1:params.seed.pair[1],target,profile:run.input.profile,lead,
            initialAdvances:initial,maxAdvances:max,offset:p.offset,filter:{...filter,natures:params.nature==null?filter.natures:data.natures.map((_,i)=>i===params.nature)}});
            checkStopped(run);
            for(const row of values)rows.set(`${target}:${row.advances}`,params.reverse?{...row,reverseSpecies:target}:row);}
          return [...rows.values()].sort((a,b)=>a.advances-b.advances);
        }
        throw Error('不允许的自动流程请求');
      };
      run.worker=workerFactory({kind:input.kind,parameters:input.config.parameters,scripts:result.scripts,
        species:result.target?.speciesId,blink:input.blink,exitBlink:input.exitBlink,video:{sharedMemory:devices.getState().video.sharedMemory},scriptRoot:devices.runner.rootDirectory},
        {request,event:message=>{
          if(active===run&&message.event==='log'){store.log(message.message,source,'info',context());return;}
          if(run.stopped||active!==run)return;
          if(message.event==='progress'){
            const progress=message.progress;run.round=progress.loop_index||run.round;
            if(input.kind==='tid'){
              const record=store.runs.find(item=>item.id===run.id);
              if(run.round&&!record.rounds.some(item=>item.number===run.round))store.history(run.id,'cycle_start',[run.round]);
              if(progress.seed_text&&record.rounds.at(-1)?.seed!==progress.seed_text)store.history(run.id,'seed_captured',[progress.seed_text,progress.current_advances]);
            }
            update({status:'running',progress:{...progress,wait_target_wall:progress.wait_target_at==null?null:message.wall+(progress.wait_target_at-message.clock)},message:progress.log_message||state.message});
          }else if(message.event==='history'){if(message.name==='cycle_start')run.round=message.args[0];store.history(run.id,message.name,message.args);}
          else if(message.event==='log')store.log(message.message,source,'info',context());
          else if(message.event==='capture')update({capture:message});
          else if(message.event==='seed')update({seed:message.seed});
          else if(message.event==='delay')update({roundDelay:message.value});
          else if(message.event==='keepalive'&&!devices.runner.current&&!run.keepalive){run.keepalive=devices.controller.sequence({actions:[{kind:'button',key:'L',down:true},{kind:'wait',duration_ms:50},{kind:'button',key:'L',down:false}]}).catch(error=>store.log('捕获保活失败：'+error.message,source,'warning',context())).finally(()=>{run.keepalive=null;});}
        }});
      const videoSession=devices.getState().video.session;
      const health=setInterval(()=>{const current=devices.getState();if(current.video.status!=='connected'||current.video.session!==videoSession||current.controller.status!=='connected')void stop('设备已断开或视频源已切换',true);},200);
      run.done=(async()=>{
        const outcome=await run.worker.done;clearInterval(health);
        await Promise.allSettled([devices.runner.stop(),rng.cancel()]);
        const status=run.failure?'failed':run.stopped?'stopped':outcome.status;
        const message=run.stopReason||outcome.message||'自动流程已结束';
        store.finishRun(run.id,status,message);store.log(message,source,status==='failed'?'warning':status==='completed'?'success':'info',context());
        devices.releaseAutomation(run.id);if(active===run)active=null;
        update({status,message,capture:null,progress:state.progress?{...state.progress,wait_target_wall:null}:null});
      })();
      return snapshot();
    }catch(error){const status=run.stopped?'stopped':'failed';store.finishRun(run.id,status,error.message);devices.releaseAutomation(run.id);if(active===run)active=null;update({status,message:error.message});throw error;}
  };
  handle('state',snapshot,false);
  handle('check',async input=>{if(active||auxiliary)throw Error('已有流程正在运行');const {ready,checks:items}=await checks(input);return {ready,checks:items};});
  handle('start',start);handle('stop',()=>stop());
  handle('save',({kind,scope,values})=>store.save(kind,scope,values));
  handle('ocr-save',rows=>store.saveOcr(rows));handle('ocr-defaults',()=>defaults().ocr);
  handle('delay',({species,action,config,number,excluded})=>action==='save'?store.saveDelay(species,config):action==='clear'?store.clearDelay(species):store.excludeDelay(species,number,excluded));
  handle('logging',value=>store.setLogging(value),false);handle('clear-logs',()=>store.clearLogs(),false);
  handle('log',row=>store.log(row.message,row.source,row.level));
  handle('ocr',async args=>{
    if(active||auxiliary)throw Error('已有流程正在使用 OCR');
    const run={id:randomUUID(),stopped:false,scripts:{turn:{path:'BDSP/OCR翻页.rng'}}};auxiliary=run;
    const rows=structuredClone(store.data.config.ocr);
    try{
      if(args.operation==='warmup'){await devices.ocr.start();checkStopped(run);return {text:'OCR 已预热'};}
      if(args.operation==='test-all'){
        if(devices.getState().controller.status!=='connected')throw Error('测试全部需要连接伊机控，请先停在训练家笔记页');
        await devices.claimAutomation(run.id);checkStopped(run);
        const results={};
        for(const fields of [['nature','characteristic'],['hp','attack','defense','sp_attack','sp_defense','speed']]){
          checkStopped(run);const imageBase64=await image();checkStopped(run);
          for(const field of fields){const value=await ocrRequest({operation:'field',field,imageBase64},rows);checkStopped(run);results[field]=String(value.text||'未识别');store.log(`测试全部/${field}：${results[field]}`,'OCR');}
          if(fields[0]==='nature')await runScript(run,'RIGHT 100\nWAIT 2000\n','turn');
        }
        return {text:'测试全部完成',results};
      }
      const result=await ocrRequest(args,rows);checkStopped(run);store.log(`OCR ${args.field||args.operation}：${result.text||'未识别'}`,'OCR');return result;
    }catch(error){store.log('OCR：'+error.message,'OCR','warning');throw error;}
    finally{devices.releaseAutomation(run.id);if(auxiliary===run)auxiliary=null;}
  });
  handle('delay-estimate',async({profile})=>{
    const worker=workerFactory({command:'delay-estimate',profile});const result=await worker.done;
    if(result.status!=='completed')throw Error(result.message);return result.result;
  });
  handle('calibrate',async({target})=>{
    if(active||auxiliary)throw Error('已有流程正在使用 OCR');
    const species=data.targets.find(item=>item.speciesKey===target)?.speciesId;
    const video=devices.getState().video;
    if(!species||video.status!=='connected'||!video.sharedMemory)throw Error('请选择宝可梦并连接视频源');
    const run={calibration:true,stopped:false};auxiliary=run;
    const rows=structuredClone(store.data.config.ocr);
    update({status:'starting',kind:'static',runId:null,progress:null,capture:null,message:'准备判闪校准…'});
    try{
      await devices.ocr.start();checkStopped(run);
      run.worker=workerFactory({command:'calibrate',species,video:{sharedMemory:video.sharedMemory}},
        {request:async(method,params)=>{checkStopped(run);if(method!=='ocr')throw Error('校准仅允许 OCR');return ocrRequest(params,rows);}});
      update({status:'running',message:'判闪校准中，请手动触发一次普通遭遇'});
      run.done=run.worker.done;
      const result=await run.done;
      if(result.status!=='completed')throw Error(result.message||'校准已停止');
      store.log(`判闪校准：间隔 ${result.result.interval}s，建议阈值 ${result.result.suggested}s`,'OCR');
      update({status:'completed',message:'判闪校准完成，请确认建议阈值'});
      return result.result;
    }catch(error){update({status:run.stopped?'stopped':'failed',message:error.message});throw error;}
    finally{if(auxiliary===run)auxiliary=null;}
  });
  handle('tid-preview',async args=>{
    if(active||auxiliary)throw Error('已有流程正在运行');
    if(!Number.isInteger(args.frame_threshold)||args.frame_threshold<0||args.frame_threshold>250000||!Array.isArray(args.seed)||args.seed.length!==4||args.seed.some(word=>!/^[\da-f]{1,8}$/i.test(word))||args.seed.every(word=>/^0+$/.test(word)))throw Error('TID Seed 或范围无效');
    auxiliary=workerFactory({command:'tid-preview',...args});
    try{const result=await auxiliary.done;if(result.status!=='completed')throw Error(result.message);return result.result;}finally{auxiliary=null;}
  });
  return {store,start,stop,getState:snapshot,close:async()=>{closed=true;await stop('程序关闭');clearTimeout(timer);devices.events.off('stop-automation',emergencyStop);store.removeAllListeners();},isBusy:()=>!!active||!!auxiliary};
}
module.exports={registerAutomation,validateParameters};
