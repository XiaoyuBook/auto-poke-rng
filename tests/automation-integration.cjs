const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {registerAutomation}=require('../electron/automation.cjs');
const {defaults}=require('../electron/automation-store.cjs');
const {createDeviceFixture,until}=require('./helpers/device-fixture.cjs');

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(t,{captureImage,showSaveDialog}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'automation-contract-'));
  const script=path.join(directory,'source.rng');fs.writeFileSync(script,'_目标帧数 = 300\nA 10\n');
  const trace=[],ocrRequests=[],workerMessages=[],notifications={calls:[],wantsTaskImage(){return true;},notifyTask(...args){this.calls.push(args);return Promise.resolve(true);}},handlers=new Map(),events=new EventEmitter();
  const window={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:()=>{},mainFrame:{}}};
  const detachedWindow={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:()=>{},mainFrame:{}}};
  const state={video:{status:'connected',width:1920,height:1080,sharedMemory:{},session:'one'},controller:{status:'connected'}};
  let resolveDone,callbacks,workerConfig;
  const devices={events,getState:()=>state,claimAutomation:async()=>trace.push('claim'),releaseAutomation:()=>trace.push('release'),
    ocr:{start:async()=>trace.push('warmup'),read:async(_image,_lang,options)=>{trace.push('ocr:'+options.field);ocrRequests.push(options);return {text:options.field};}},
    controller:{sequence:async()=>trace.push('key')},runner:{rootDirectory:directory,current:null,
      resolveScript:async()=>({absolute:script}),validate:async()=>({valid:true}),stop:async()=>trace.push('stop-script'),
      start:async options=>{trace.push(options.text);queueMicrotask(()=>events.emit('script',{event:'script.done',runId:'s',status:'completed'}));return {runId:'s'};}}};
  const rng={isBusy:()=>false,cancel:async()=>trace.push('cancel-search'),generate:async input=>{trace.push(input);return [{advances:151,pid:'00000001',ec:'00000002',stats:[1,2,3,4,5,6]}];}};
  rng.generateReverse=input=>rng.generate(input);
  const workerFactory=(config,handlers)=>{workerConfig=config;callbacks=handlers;return {done:new Promise(resolve=>{resolveDone=resolve;}),send:message=>workerMessages.push(message),stop:async()=>resolveDone({status:'stopped'})};};
  const automation=registerAutomation({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getMainWindow:()=>window,getWindows:()=>[window,detachedWindow],devices,rng,
    blink:{getState:()=>({status:'idle'})},userData:directory,workerFactory,captureImage:captureImage|| (async()=>{trace.push('frame');return Buffer.from('snapshot').toString('base64');}),notifications,showSaveDialog});
  const invoke=(name,input,event={sender:window.webContents,senderFrame:window.webContents.mainFrame})=>handlers.get('automation:'+name)(event,input);
  const input={kind:'static',config:defaults().static,profile:{version:'BD',tid:0,sid:0},blink:{mode:'recover',eye:'data:image/png;base64,AQ==',
    sourceWidth:1920,sourceHeight:1080,roi:{x:0,y:0,width:100,height:100},threshold:.9,npc:0,seed:['1','2','3','4'],noisy:false,searchMin:0,searchMax:1000000}};
  input.config.scripts={...input.config.scripts,seed:'source.rng',advance:'source.rng',hit:'source.rng'};
  t.after(async()=>{await automation.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,window,detachedWindow,automation,input,invoke,trace,ocrRequests,workerMessages,notifications,devices,state,rng,done:value=>resolveDone(value),callbacks:()=>callbacks,workerConfig:()=>workerConfig};
}

test('diagnostic export uses a native save dialog owned by the requesting log window',async t=>{
  const dialogs=[];
  const f=fixture(t,{showSaveDialog:async(parent,options)=>{dialogs.push({parent,options});return {canceled:false,filePath:path.join(f.directory,'export.jsonl')};}});
  f.automation.store.beginRun('export-run','frlg');
  f.automation.store.diagnostic('export-run',{event:'hidden',raw:'OCR 原文'});
  f.automation.store.setLogging(false);
  const event={sender:f.detachedWindow.webContents,senderFrame:f.detachedWindow.webContents.mainFrame};
  const result=await f.invoke('export-diagnostics',{runId:'export-run'},event);
  assert.equal(dialogs[0].parent,f.detachedWindow);
  assert.match(dialogs[0].options.defaultPath,/^run_\d{13}_export-run\.jsonl$/);
  assert.deepEqual(dialogs[0].options.filters,[{name:'诊断日志',extensions:['jsonl']}]);
  assert.deepEqual(result,{canceled:false,filePath:path.join(f.directory,'export.jsonl'),active:true,incomplete:true});
  assert.match(fs.readFileSync(result.filePath,'utf8'),/OCR 原文/);
});

test('diagnostic export cancellation, invalid runs and unauthorized senders never copy files',async t=>{
  const dialogs=[];
  const f=fixture(t,{showSaveDialog:async(...args)=>{dialogs.push(args);return {canceled:true};}});
  f.automation.store.beginRun('cancel-run','frlg');
  const files=fs.readdirSync(f.directory);
  assert.deepEqual(await f.invoke('export-diagnostics',{runId:'cancel-run'}),{canceled:true});
  assert.deepEqual(fs.readdirSync(f.directory),files);
  await assert.rejects(f.invoke('export-diagnostics',{runId:'missing'}),/没有已保存/);
  await assert.rejects(f.invoke('export-diagnostics',{runId:'../outside'}),/标识无效/);
  const foreign={mainFrame:{}};
  await assert.rejects(f.invoke('export-diagnostics',{runId:'cancel-run'},{sender:foreign,senderFrame:foreign.mainFrame}),/sender/);
  await assert.rejects(f.invoke('export-diagnostics',{runId:'cancel-run'},{sender:f.window.webContents,senderFrame:{}}),/sender/);
  assert.equal(dialogs.length,1);
});

test('export result describes the copied snapshot even when the run ends while copying',async t=>{
  const f=fixture(t,{showSaveDialog:async()=>({canceled:false,filePath:path.join(f.directory,'snapshot.jsonl')})});
  f.automation.store.beginRun('ends-during-export','frlg');
  const original=f.automation.store.runLogs.exportTo.bind(f.automation.store.runLogs);
  t.mock.method(f.automation.store.runLogs,'exportTo',async(...args)=>{
    const copying=original(...args);
    f.automation.store.finishRun('ends-during-export','completed','done');
    return copying;
  });
  const result=await f.invoke('export-diagnostics',{runId:'ends-during-export'});
  assert.equal(result.active,true);
  assert.ok(!fs.readFileSync(result.filePath,'utf8').includes('run.finished'));
});

test('C02: preparation compiles but does not save, press, warm up, or claim devices',async t=>{
  const f=fixture(t);f.input.config.parameters.fixed_delay=1442;
  assert.equal((await f.invoke('check',f.input)).ready,true);assert.deepEqual(f.trace,[]);
  assert.equal(f.automation.getState().config.static.parameters.fixed_delay,66);
});

function enableStarter(f){
  f.input.config.parameters.starter_automation=true;
  f.input.config.parameters.fixed_delay=40;
  f.input.config.delayConfig.baseline_delay=40;
  f.input.config.scripts={seed:'missing/seed.ecs',advance:'missing/advance.ecs',hit:'missing/hit.ecs',reverse:'missing/reverse.ecs'};
}

test('starter workflows can pass readiness and start with the default 66-frame delay',async t=>{
  for(const target of ['Turtwig','Chimchar','Piplup']){
    const f=fixture(t);
    f.input.config.parameters.starter_automation=true;
    f.input.config.parameters.target=target;
    const check=await f.invoke('check',f.input);
    assert.equal(check.ready,true,JSON.stringify(check.checks));
    await f.invoke('start',f.input);
    assert.equal(f.workerConfig().parameters.fixed_delay,66);
    assert.equal((await f.callbacks().request('delay_profile',{})).config.baseline_delay,66);
    await f.invoke('stop');
  }
});

test('starter readiness binds trusted bundled scripts without reading the user library',async t=>{
  const f=fixture(t);enableStarter(f);
  const original=structuredClone(f.input);
  f.devices.runner.resolveScript=async()=>{throw Error('user script library must not be used');};
  assert.equal((await f.invoke('check',f.input)).ready,true);
  assert.deepEqual(f.input,original,'preparation preserves the saved draft');
  assert.deepEqual(f.trace,[],'preparation never presses a key');
  await f.invoke('start',f.input);
  const config=f.workerConfig();
  assert.equal(config.parameters.auto_reverse,true);
  assert.equal(config.scripts.advance,undefined);
  assert.equal(config.scripts.hit,undefined);
  for(const key of ['seed','reverse']){
    const bytes=fs.readFileSync(path.join(__dirname,'../resources/automation/bdsp-starter',key+'.ecs'));
    assert.equal(config.scripts[key].text,bytes.toString('utf8'));
    assert.match(config.scripts[key].path,/^__builtin__\//);
    if(key==='reverse'){
      const item=require('../resources/script-catalog.json').packages.find(item=>item.id==='bdsp-starter-reverse');
      const script=item.files.find(file=>file.path==='御三家反查.txt');
      assert.equal(bytes.length,script.bytes,'automatic reverse uses the published script bytes');
      assert.equal(createHash('sha256').update(bytes).digest('hex'),script.sha256);
    }
  }
  assert.equal(config.blink.eye,original.blink.eye);
  assert.deepEqual(config.blink.roi,original.blink.roi);
  assert.deepEqual(Object.fromEntries(['threshold','npc','timeDelay','advanceDelay','advanceDelay2','timelineNpc','pokemonNpc','noisy'].map(key=>[key,config.blink[key]])),
    {threshold:.7,npc:1,timeDelay:0,advanceDelay:41,advanceDelay2:48,timelineNpc:-1,pokemonNpc:2,noisy:false});
});

test('starter positions early and matches verified ECS clicks with 800ms and 100ms release gaps',async t=>{
  for(const [target,rights] of [['Turtwig',0],['Chimchar',1],['Piplup',2]]){
    const f=fixture(t);enableStarter(f);f.input.config.parameters.target=target;
    const sequences=[];
    f.devices.controller.sequence=async({actions})=>sequences.push(actions);
    await f.invoke('start',f.input);
    await f.callbacks().request('starter_action',{action:'press'});
    await f.callbacks().request('starter_action',{action:'position'});
    assert.equal(sequences.length,rights?2:1,'Turtwig is already selected and needs no cursor sequence');
    const navigation=rights?sequences[1]:[];
    assert.deepEqual(navigation.filter(action=>action.kind==='button'&&action.down).map(action=>action.key),Array(rights).fill('RIGHT'));
    assert.equal(navigation.filter(action=>action.kind==='button'&&!action.down).length,rights);
    assert.deepEqual(navigation.filter(action=>action.kind==='wait').map(action=>action.duration_ms),Array.from({length:rights},()=>[100,120]).flat());
    await f.callbacks().request('starter_action',{action:'select',scriptId:'final'});
    assert.equal(sequences[0][0].key,'A');
    const selection=sequences.at(-1);
    const down=selection.filter(action=>action.kind==='button'&&action.down).map(action=>action.key);
    assert.deepEqual(down,['A','UP','A']);
    const waits=selection.filter(action=>action.kind==='wait');
    assert.deepEqual(waits.map(action=>action.duration_ms),[50,800,50,100,50]);
    let elapsed=0,lastRelease=null,held=null;
    const gaps=[];
    for(const action of selection){
      if(action.kind==='wait')elapsed+=action.duration_ms;
      else if(action.down){
        assert.equal(held,null,'release the previous key before the next press');
        if(lastRelease!==null)gaps.push(elapsed-lastRelease);
        held=action.key;
      }else{
        assert.equal(action.key,held);
        held=null;lastRelease=elapsed;
      }
    }
    assert.deepEqual(gaps,[800,100],'requested intervals are neutral waits after release');
    assert.equal(held,null,'final confirmation must release A');
    assert.equal(f.trace.some(item=>typeof item==='string'&&item.includes('A 100')),false);
    await f.invoke('stop');
    await assert.rejects(()=>f.callbacks().request('starter_action',{action:'press'}),/已停止/);
    await assert.rejects(()=>f.callbacks().request('starter_action',{action:'position'}),/已停止/);
  }
});

test('starter selection cancelled before its request never reaches the controller',async t=>{
  const f=fixture(t);enableStarter(f);await f.invoke('start',f.input);
  await f.callbacks().request('stop_script',{scriptId:'early-select'});
  await f.callbacks().request('starter_action',{action:'select',scriptId:'early-select'});
  assert.equal(f.trace.includes('key'),false);
});

test('starter dialogue hold duration reaches the resident controller and invalid values never press',async t=>{
  const f=fixture(t);enableStarter(f);
  const sequences=[];
  f.devices.controller.sequence=async({actions})=>sequences.push(actions);
  await f.invoke('start',f.input);
  for(const durationMs of [200,100])await f.callbacks().request('starter_action',{action:'press',durationMs});
  assert.deepEqual(sequences.map(actions=>actions.find(action=>action.kind==='wait').duration_ms),[200,100]);
  for(const durationMs of [0,29,201,Infinity,'200']){
    await assert.rejects(()=>f.callbacks().request('starter_action',{action:'press',durationMs}),/时长无效/);
  }
  assert.equal(sequences.length,2);
});

test('starter fixed-delay readiness detects an impossible 200-frame window',async t=>{
  const f=fixture(t);enableStarter(f);f.input.config.delayConfig.baseline_delay=100;
  const check=await f.invoke('check',f.input);
  assert.equal(check.ready,false);
  assert.match(check.checks.find(row=>row.label==='任务参数').detail,/200.*78/);
  assert.deepEqual(f.trace,[]);
});

test('starter native selection can be stopped without leaving controller input held',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();
  const f=fixture(t);enableStarter(f);
  f.devices.controller=hardware.devices.controller;
  await f.invoke('start',f.input);
  const request=f.callbacks().request;
  const selection=request('starter_action',{action:'select',scriptId:'native-starter'});
  void selection.catch(()=>{});
  await until(async()=>((await hardware.clients.controller.call('controller.status')).report.buttons&4)!==0,'starter holds A');
  await request('stop_script',{scriptId:'native-starter'});await selection;
  const state=await hardware.clients.controller.call('controller.status');
  assert.equal(state.report.buttons,0);
  assert.equal(state.owned,false);
});

test('stopping native starter positioning releases RIGHT and prevents later confirmation',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();
  const f=fixture(t);enableStarter(f);f.input.config.parameters.target='Piplup';
  f.devices.controller=hardware.devices.controller;
  await f.invoke('start',f.input);
  const request=f.callbacks().request;
  const positioning=request('starter_action',{action:'position',scriptId:'native-position'});
  void positioning.catch(()=>{});
  await until(async()=>((await hardware.clients.controller.call('controller.status')).report.hat===2),'starter holds RIGHT');
  assert.equal((await hardware.clients.controller.call('controller.status')).report.buttons,0);
  await f.invoke('stop');
  await assert.rejects(positioning,/已停止/);
  const state=await hardware.clients.controller.call('controller.status');
  assert.equal(state.report.hat,8);
  assert.equal(state.report.buttons,0);
  assert.equal(state.owned,false);
  await assert.rejects(()=>request('starter_action',{action:'select',scriptId:'late-final'}),/已停止/);
});

test('worker OCR failure releases native starter input before releasing automation ownership',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();
  const f=fixture(t);enableStarter(f);f.devices.controller=hardware.devices.controller;
  await f.invoke('start',f.input);
  const selection=f.callbacks().request('starter_action',{action:'select',scriptId:'ocr-failure'});
  void selection.catch(()=>{});
  await until(async()=>((await hardware.clients.controller.call('controller.status')).report.buttons&4)!==0,'starter holds A before OCR error');
  f.done({status:'failed',message:'OCR failure'});
  await until(()=>f.automation.getState().state.status==='failed','worker failure propagated');
  await selection;
  assert.equal((await hardware.clients.controller.call('controller.status')).report.buttons,0);
  assert.equal(f.trace.includes('release'),true);
});
test('automatic search ignores legacy initial advance and Offset values',async t=>{
  const f=fixture(t);
  f.input.config.parameters.initial_advances=450;
  f.input.config.parameters.offset=25;
  f.input.config.scripts.record='missing/legacy-record.rng';
  await f.invoke('start',f.input);
  await f.callbacks().request('search',{seed:{pair:['1','2']}});
  const search=f.trace.find(item=>item&&typeof item==='object'&&Object.hasOwn(item,'initialAdvances'));
  assert.equal(search.initialAdvances,0);
  assert.equal(search.offset,0);
  assert.equal(Object.hasOwn(f.workerConfig().parameters,'initial_advances'),false);
  assert.equal(Object.hasOwn(f.workerConfig().parameters,'offset'),false);
  assert.equal(Object.hasOwn(f.workerConfig().scripts,'record'),false);
});
test('shiny detection is required independently of reverse lookup',async t=>{
  const f=fixture(t);
  f.input.config.parameters.shiny_threshold_seconds=null;
  const result=await f.invoke('check',f.input);
  assert.equal(result.ready,false);
  assert.match(result.checks.find(item=>item.label==='任务参数').detail,/判闪阈值/);
});
test('removed optional scripts and missing exit blink are ignored by check and start',async t=>{
  const f=fixture(t);
  f.input.config.features.exit={added:false,enabled:false};
  f.input.config.features.reverse={added:false,enabled:false};
  f.input.config.scripts.exit='missing/exit.rng';
  f.input.config.scripts.reverse='missing/reverse.rng';
  f.input.config.parameters.exit_blink_name='missing blink';
  f.input.config.parameters.auto_reverse=true;
  f.input.config.parameters.reseeding_threshold=null;
  f.input.config.parameters.reverse_lookup_window=null;
  assert.equal((await f.invoke('check',f.input)).ready,true);
  await f.invoke('start',f.input);
  assert.equal(f.workerConfig().parameters.auto_reverse,false);
  assert.equal(f.workerConfig().parameters.exit_blink_name,'');
  assert.equal(f.workerConfig().scripts.exit,undefined);
  assert.equal(f.workerConfig().scripts.reverse,undefined);
});
test('C01/D04: run snapshots parameters and OCR; newly recorded samples retain the chosen baseline',async t=>{
  const f=fixture(t);f.input.config.parameters.fixed_delay=1442;f.input.config.delayConfig.baseline_delay=1442;
  await f.invoke('start',f.input);
  f.input.config.parameters.target='Piplup';f.input.config.parameters.fixed_delay=999;
  const request=f.callbacks().request;
  await request('delay_record',{candidates:[1445]});
  assert.equal((await request('delay_profile',{})).config.baseline_delay,1442);
  assert.equal(f.workerConfig().parameters.target,'Turtwig');
  assert.equal(f.workerConfig().parameters.fixed_delay,1442);
  const changed=defaults().ocr;changed[0].rect.x=900;
  await f.invoke('ocr-save',changed);
  await request('ocr',{imageBase64:'image',operation:'text',field:'nature'});
  assert.equal(f.ocrRequests.at(-1).regions.nature[0],112,'active OCR uses its startup snapshot');
});
test('C04: stopping forbids all late script/search calls and releases the resource lock',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);const request=f.callbacks().request;
  await f.invoke('stop');
  await assert.rejects(request('script',{text:'A 100',name:'source.rng'}),/停止/);
  await assert.rejects(request('search',{}),/停止/);
  assert.equal(f.automation.getState().state.status,'stopped');assert.equal(f.trace.at(-1),'release');
});

test('automatic task completion sends one QQ notification with target and final detail',async t=>{
  const f=fixture(t),root=f.devices.runner.rootDirectory;let rootCalls=0;
  f.devices.runner.rootDirectory=()=>{rootCalls++;return root;};
  await f.invoke('start',f.input);
  assert.equal(f.workerConfig().scriptRoot,root);
  assert.equal(rootCalls,1);
  f.done({status:'completed',message:'目标流程已完成'});
  for(let i=0;i<20&&f.automation.getState().state.status!=='completed';i++)await new Promise(setImmediate);
  assert.equal(f.automation.getState().state.status,'completed');
  assert.equal(f.notifications.calls.length,1);
  assert.match(f.notifications.calls[0][0],/^[0-9a-f-]{36}$/);
  assert.deepEqual(f.notifications.calls[0].slice(1,3),['自动定点乱数','completed']);
  assert.deepEqual(f.notifications.calls[0][3].target,'草苗龟');
  assert.deepEqual(f.notifications.calls[0][3].detail,'目标流程已完成');
  assert.deepEqual(f.notifications.calls[0][3].image,Buffer.from('snapshot'));
  assert.equal(f.automation.getState().logs.at(-1).source,'自动定点');
});

test('automatic task notification falls back to text when the final screenshot fails',async t=>{
  const f=fixture(t,{captureImage:async()=>{throw Error('snapshot unavailable');}});
  await f.invoke('start',f.input);
  f.done({status:'completed',message:'目标流程已完成'});
  for(let i=0;i<20&&f.automation.getState().state.status!=='completed';i++)await new Promise(setImmediate);
  assert.equal(f.notifications.calls.length,1);
  assert.equal(Object.hasOwn(f.notifications.calls[0][3],'image'),false);
  assert.ok(f.automation.getState().logs.some(row=>row.source==='QQ通知'&&row.message.includes('截图失败')));
});

test('definite non-shiny stops only its hit script and waits for controller cleanup',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);
  const status=f.automation.getState().state.status;
  const release=deferred(),started=deferred();let released=false;
  f.devices.runner.start=async()=>{started.resolve();return {runId:'hit'};};
  f.devices.runner.stop=async()=>{await release.promise;released=true;f.devices.events.emit('script',{event:'script.done',runId:'hit',status:'cancelled'});};
  t.after(()=>release.resolve());
  const request=f.callbacks().request;
  const script=request('script',{text:'A 1',name:'source.rng',scriptId:'hit-1'});
  void script.catch(()=>{});
  await started.promise;
  let stopped=false;
  const stopping=request('stop_script',{scriptId:'hit-1'}).then(()=>{stopped=true;});
  void stopping.catch(()=>{});
  await new Promise(setImmediate);assert.equal(stopped,false);assert.equal(released,false);
  release.resolve();await stopping;await script;
  assert.equal(released,true);assert.equal(f.automation.getState().state.status,status);
  f.devices.runner.start=async()=>{queueMicrotask(()=>f.devices.events.emit('script',{event:'script.done',runId:'next',status:'completed'}));return {runId:'next'};};
  await request('script',{text:'B 1',name:'source.rng'});
});

test('a stop arriving before the hit script request prevents its launch',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);const request=f.callbacks().request;
  const status=f.automation.getState().state.status;
  await request('stop_script',{scriptId:'early-hit'});
  await request('script',{text:'late-key',name:'source.rng',scriptId:'early-hit'});
  assert.equal(f.trace.includes('late-key'),false);
  assert.equal(f.automation.getState().state.status,status);
});

test('hit cancellation releases real mock-controller input before the workflow continues',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();
  const f=fixture(t);
  hardware.devices.runner.rootDirectory=f.devices.runner.rootDirectory;
  f.devices.runner=hardware.devices.runner;
  f.devices.controller=hardware.devices.controller;
  hardware.devices.events.on('script',message=>f.devices.events.emit('script',message));
  await f.invoke('start',f.input);const request=f.callbacks().request;
  const script=request('script',{text:'A DOWN\nWAIT 60000\nPRINT "unexpected-tail"\nB 1',name:'source.rng',scriptId:'native-hit'});
  void script.catch(()=>{});
  await until(async()=>((await hardware.clients.controller.call('controller.status')).report.buttons&4)!==0,'hit script holds A');
  await request('stop_script',{scriptId:'native-hit'});await script;
  const state=await hardware.clients.controller.call('controller.status');
  assert.equal(state.report.buttons,0);assert.equal(state.owned,false);
  assert.equal(f.automation.getState().logs.some(row=>row.message==='unexpected-tail'),false);
  await request('script',{text:'B 1',name:'source.rng'});
});

test('roamer battle detection uses structured watch results from the current hit script',async t=>{
  const f=fixture(t);f.input.config.parameters.target='Cresselia';await f.invoke('start',f.input);
  const started=deferred();f.devices.runner.start=async()=>{started.resolve();return {runId:'hit'};};
  f.devices.runner.stop=async()=>f.devices.events.emit('script',{event:'script.done',runId:'hit',status:'cancelled'});
  const script=f.callbacks().request('script',{text:'$2 = @宝可表',name:'source.rng',scriptId:'hit-watch'});void script.catch(()=>{});
  await started.promise;
  await new Promise(setImmediate);
  const emit=message=>f.devices.events.emit('script',{runId:'hit',event:'script.image-result',...message});
  emit({event:'script.log',message:'已检测到进入战斗'});
  emit({runId:'old-hit',labelName:'宝可表',scriptValue:50});
  emit({labelName:'其他标签',scriptValue:50});
  emit({labelName:'宝可表',scriptValue:95});
  assert.deepEqual(f.workerMessages,[]);
  emit({labelName:'宝可表',score:93.2,scriptValue:94});
  assert.deepEqual(f.workerMessages,[{event:'battle',scriptId:'hit-watch'}]);
  f.devices.events.emit('script',{event:'script.done',runId:'hit',status:'completed'});await script;
  emit({labelName:'宝可表',scriptValue:0});
  assert.equal(f.workerMessages.length,1,'finished scripts no longer observe battle');
});

test('a real image-label script detects roamer battle without PRINT wording',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();await hardware.connectVideo();
  const f=fixture(t);f.input.config.parameters.target='Cresselia';
  f.input.blink.sourceWidth=320;f.input.blink.sourceHeight=240;
  hardware.devices.runner.rootDirectory=f.devices.runner.rootDirectory;
  f.devices.runner=hardware.devices.runner;f.devices.controller=hardware.devices.controller;
  f.devices.getState=()=>hardware.devices.getState();
  hardware.devices.events.on('script',message=>f.devices.events.emit('script',message));
  const directory=path.join(f.devices.runner.rootDirectory,'ImgLabel');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,'宝可表.IL'),JSON.stringify({searchMethod:0,
    ImgBase64:'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAG0lEQVQIHWNkYmRgBgNGbi5OZjBgFBEWYgYDAAdxAJTQaRgKAAAAAElFTkSuQmCC',
    RangeX:0,RangeY:0,RangeWidth:3,RangeHeight:3,TargetX:0,TargetY:0,TargetWidth:3,TargetHeight:3}));
  await f.invoke('start',f.input);
  await f.callbacks().request('script',{text:'$2 = @宝可表',name:'source.rng',scriptId:'native-watch'});
  assert.deepEqual(f.workerMessages,[{event:'battle',scriptId:'native-watch'}]);
});
test('C04: device loss terminates the whole workflow as a failure',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);f.state.video.session='reconnected';
  await new Promise(resolve=>setTimeout(resolve,260));
  assert.equal(f.automation.getState().state.status,'failed');assert.match(f.automation.getState().state.message,/切换/);
});
test('C03: controller emergency stop also stops a workflow between scripts',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);f.devices.events.emit('stop-automation');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.automation.getState().state.status,'stopped');
});
test('C03: unknown windows and subframes cannot start or inspect workflows',async t=>{
  const f=fixture(t);await assert.rejects(f.invoke('state',null,{sender:{},senderFrame:{}}),/sender/);assert.deepEqual(f.trace,[]);
});
test('O01: all-field testing reads notes before turning and reads six stats from one new frame',async t=>{
  const f=fixture(t);const result=await f.invoke('ocr',{operation:'test-all'});
  assert.deepEqual(Object.keys(result.results),['nature','characteristic','hp','attack','defense','sp_attack','sp_defense','speed']);
  assert.deepEqual(f.trace.filter(x=>x==='frame'||x.startsWith?.('ocr:')||x.startsWith?.('RIGHT')),
    ['frame','ocr:nature','ocr:characteristic','RIGHT 100\nWAIT 2000\n','frame','ocr:hp','ocr:attack','ocr:defense','ocr:sp_attack','ocr:sp_defense','ocr:speed']);
});
test('O07: reverse searches the entire legendary group and preserves equal-Adv species',async t=>{
  const f=fixture(t);f.input.config.parameters.target='Latias';await f.invoke('start',f.input);
  const rows=await f.callbacks().request('search',{seed:{pair:['1','2']},reverse:{target:{raw_target_advances:150},nature:'认真'}});
  assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.reverseSpecies),['Latias','Latios']);
});
test('reverse preserves the forward lead for ordinary and sync candidates in every sync mode',async t=>{
  const {RuntimeClient}=require('../electron/runtime-client.cjs');
  const {natures}=require('../src/generated/bdsp-data.json');
  const client=new RuntimeClient({role:'rng'});
  t.after(()=>client.close());
  for(const mode of [0,1,2])for(const configuredLead of [13,255])for(const source of (mode===0?['no_sync']:['no_sync','sync'])){
    await t.test(`mode=${mode}, configured lead=${configuredLead}, source=${source}`,async t=>{
      const f=fixture(t),calls=[];
      Object.assign(f.input.config.parameters,{sync_mode:mode,sync_nature:natures[7],lead:configuredLead,max_advances:20,reverse_lookup_window:10});
      f.input.config.features.sync={added:true,enabled:true};
      f.input.config.parameters.filters[0].shiny=255;
      f.rng.generate=async input=>{calls.push(input);return client.call('static.generate',input);};
      await f.invoke('start',f.input);
      const request=f.callbacks().request,seed={pair:['1234567887654321','8765432112345678']};
      const forwardLead=source==='sync'?7:mode>0?255:configuredLead;
      const rows=await request('search',{seed,...(mode>0?{lead:forwardLead}:{})});
      const candidate=rows.find(row=>row.nature!==13)||rows[0];
      assert.ok(candidate,'forward search produces a real native candidate');
      const reverse=await request('search',{seed,reverse:{target:{raw_target_advances:candidate.advances,sync_source:source,sync_nature:source==='sync'?7:null},nature:natures[candidate.nature]}});
      assert.equal(calls[0].lead,forwardLead);
      assert.equal(calls[1].lead,forwardLead,'reverse must use the lead that generated the candidate');
      assert.deepEqual(reverse.find(row=>row.advances===candidate.advances),{...candidate,reverseSpecies:'Turtwig'});
    });
  }
});

test('high-advance reverse searches use the internal RNG entry point',async t=>{
  const f=fixture(t),calls=[];
  f.rng.generate=async()=>assert.fail('reverse must not use the manual initial-advance limit');
  f.rng.generateReverse=async input=>{calls.push(input);return [];};
  await f.invoke('start',f.input);
  await f.callbacks().request('search',{seed:{pair:['1','2']},reverse:{target:{raw_target_advances:20000000,sync_source:'no_sync'},nature:'认真'}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].initialAdvances,19999500);
  assert.equal(calls[0].maxAdvances,1000);
});

test('O11: calibration never presses keys or applies a threshold without user choice',async t=>{
  const f=fixture(t);const calibration=f.invoke('calibrate',{target:'Turtwig'});
  await new Promise(resolve=>setImmediate(resolve));
  f.done({status:'completed',result:{interval:2.5,suggested:3}});
  assert.deepEqual(await calibration,{interval:2.5,suggested:3});
  assert.equal(f.automation.getState().config.static.parameters.shiny_threshold_seconds,4);
  assert.deepEqual(f.trace,['warmup']);
});
