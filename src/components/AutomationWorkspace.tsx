import { useEffect, useRef, useState } from 'react';
import { Play, Square, ListChecks, FileClock } from 'lucide-react';
import { automationBusy, downloadText, useAutomation, type AutomationConfig, type AutomationKind, type AutomationParameters, type DelayConfig, type IdResults, type Readiness, type TargetFilter } from '../automation';
import type { BlinkConfig } from '../blink';
import type { BdspProfile } from '../bdspProfile';
import type { ScriptFile } from '../scriptLibrary';
import { NATURES_ZH, STATIC_TARGETS, getStaticTargets } from '../staticData';
import { LeadSelector } from './LeadSelector';
import { CandidateTable } from './AutomationLogs';

const scriptLabels:Record<string,string>={seed:'测种脚本',advance:'过帧脚本',hit:'撞闪脚本',exit:'过场脚本',reverse:'反查脚本',escape:'逃跑脚本',record:'录像脚本',name:'取名脚本'};
const strategyLabels:Record<string,string>={fixed:'固定 delay',last:'上次实际 delay',mode:'众数',median:'中位数',mean:'滚动平均',ema:'指数平滑',trimmed_mean:'截尾平均',dense_interval:'密集区间'};
const statNames=['HP','攻击','防御','特攻','特防','速度'];

export function AutomationWorkspace({kind,profile,blinkConfig,blinkConfigs,openLogs}:{kind:AutomationKind;profile:BdspProfile;blinkConfig:BlinkConfig;blinkConfigs:BlinkConfig[];openLogs:()=>void}){
  const {api,snapshot,error,setError}=useAutomation();
  const [config,setConfig]=useState<AutomationConfig|null>(null),[files,setFiles]=useState<ScriptFile[]>([]),[notice,setNotice]=useState('');
  const [readiness,setReadiness]=useState<Readiness|null>(null),[pending,setPending]=useState(false),[filterIndex,setFilterIndex]=useState(0);
  const [delayOpen,setDelayOpen]=useState(false),[delay,setDelay]=useState<DelayConfig|null>(null),[samplePage,setSamplePage]=useState(0),[estimate,setEstimate]=useState<number|null>(null);
  const [tidText,setTidText]=useState(''),[ids,setIds]=useState<IdResults|null>(null),[onlyTargets,setOnlyTargets]=useState(false),[idPage,setIdPage]=useState(0),[selectedId,setSelectedId]=useState<number|null>(null);
  const [now,setNow]=useState(Date.now());const initialized=useRef(false);
  const [calibration,setCalibration]=useState<{interval:number;suggested:number}|null>(null);
  useEffect(()=>{if(snapshot&&!initialized.current){initialized.current=true;setConfig(structuredClone(snapshot.config[kind]));}},[snapshot,kind]);
  const refreshScripts=()=>{void window.desktop?.scripts.list().then(value=>setFiles(value.files)).catch(error=>setError(error.message));};
  useEffect(()=>{if(api)refreshScripts();},[api]);
  const progress=snapshot?.state.kind===kind?snapshot.state.progress:null;
  useEffect(()=>{if(progress?.id_states){setIds({id_states:progress.id_states,id_elapsed_seconds:progress.id_elapsed_seconds||[],seed_measured_wall_time:progress.seed_measured_wall_time});if(!progress.id_states.length){setSelectedId(null);setIdPage(0);}}},[progress?.id_states,progress?.id_elapsed_seconds,progress?.seed_measured_wall_time]);
  const estimateSpecies=STATIC_TARGETS.find(item=>item.speciesKey===config?.parameters.target)?.speciesId;
  const sampleKey=JSON.stringify(snapshot?.profiles[String(estimateSpecies)]?.samples||[]);
  useEffect(()=>{
    setEstimate(null);if(!delayOpen||!delay||!api?.delayEstimate)return;
    let alive=true;const timer=setTimeout(()=>{void api.delayEstimate({config:delay,samples:JSON.parse(sampleKey),next_round_number:1}).then(value=>{if(alive)setEstimate(value);}).catch(()=>{});},200);
    return()=>{alive=false;clearTimeout(timer);};
  },[delayOpen,delay,sampleKey,api]);
  useEffect(()=>{if(!progress?.wait_target_wall)return;const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[progress?.wait_target_wall]);
  if(!api||!snapshot||!config)return <section className="automation-workspace"><p role="status">{error||(!api?'请在桌面应用中使用自动流程。':'正在加载自动流程…')}</p></section>;
  const p=config.parameters,busy=automationBusy(snapshot.state),isStatic=kind==='static';
  const target=STATIC_TARGETS.find(item=>item.speciesKey===p.target),species=target?.speciesId||387;
  const profileDelay=snapshot.profiles[String(species)];
  const currentRun=snapshot.runs.find(item=>item.id===snapshot.state.runId&&item.kind===kind),round=currentRun?.rounds.at(-1);
  const update=(values:Partial<AutomationParameters>)=>setConfig(current=>current&&({...current,parameters:{...current.parameters,...values}}));
  const perform=async(action:()=>Promise<unknown>,message='')=>{setError('');setNotice('');setPending(true);try{await action();if(message)setNotice(message);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setPending(false);}};
  const input=()=>({kind,config,blink:blinkConfig,exitBlink:blinkConfigs.find(item=>item.name===p.exit_blink_name),profile});
  const numeric=(label:string,key:keyof AutomationParameters,min=0,max=1000000000)=><label>{label}<input aria-label={label} type="number" min={min} max={max} value={Number(p[key]??0)} onChange={event=>update({[key]:Number(event.target.value)})}/></label>;
  const openRelated=()=>{if(currentRun)localStorage.setItem('auto-poke-rng:log-context',JSON.stringify({runId:currentRun.id,round:round?.number}));openLogs();window.dispatchEvent(new Event('auto-poke:related-logs'));};
  const paramDirty=JSON.stringify(p)!==JSON.stringify(snapshot.config[kind].parameters),scriptDirty=JSON.stringify(config.scripts)!==JSON.stringify(snapshot.config[kind].scripts);
  const openDelay=()=>{setDelay(structuredClone(profileDelay?.config||{strategy:'fixed',baseline_delay:p.fixed_delay,multi_candidate_policy:'ignore',window_size:5,ewma_alpha:.5,dense_interval_width:2}));setDelayOpen(value=>!value);};
  const filter=p.filters?.[filterIndex]||p.filters?.[0];
  const changeFilter=(values:Partial<TargetFilter>)=>update({filters:p.filters.map((item,index)=>index===filterIndex?{...item,...values}:item)});
  const idRows=(ids?.id_states||[]).map((row,index)=>({...row,index}));
  const visibleIds=onlyTargets?idRows.filter(row=>p.target_display_tids.includes(row.display_tid)):idRows;
  const page=Math.min(idPage,Math.max(0,Math.ceil(visibleIds.length/50)-1));
  const idCells=(row:typeof idRows[number])=>{const elapsed=ids?.id_elapsed_seconds[row.index];return [row.advances,row.tid,row.sid,row.tsv,String(row.display_tid).padStart(6,'0'),elapsed==null?'—':elapsed.toFixed(3),elapsed==null||!ids?.seed_measured_wall_time?'—':new Date((ids.seed_measured_wall_time+elapsed)*1000).toLocaleString()];};
  const idText=()=>[['Adv','TID','SID','TSV','Display TID','累计用时','预计到达时间'],...idRows.map(idCells)].map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  return <section className="automation-workspace" aria-label={isStatic?'自动定点工作区':'自动TID工作区'}>
    <header className="automation-heading"><h2>{isStatic?'自动定点乱数':'自动 TID 乱数'}</h2><p>{isStatic?'测种、搜索、过帧、校正、撞闪与反查':'小卡比兽测种、Display TID 搜索与自动取名'}</p></header>
    <div className="automation-toolbar automation-run-toolbar">
      <button className="button primary" disabled={busy||pending} onClick={()=>void perform(()=>api.start(input()))}><Play size={14}/>开始</button>
      <button className="button" disabled={!busy} onClick={()=>void perform(()=>api.stop())}><Square size={14}/>停止</button>
      <button className="button" disabled={busy||pending} onClick={()=>void perform(async()=>setReadiness(await api.check(input())))}><ListChecks size={14}/>开始前检查</button>
      <button className="button" onClick={openRelated}><FileClock size={14}/>查看相关日志</button>
      <span role="status">{snapshot.state.kind===kind?snapshot.state.message:'等待开始'}</span>
    </div>
    {(error||notice)&&<p role={error?'alert':'status'} className={error?'panel-error':'automation-notice'}>{error||notice}</p>}
    {readiness&&<section className="automation-card" aria-label="开始前准备"><h3>开始前准备</h3>{readiness.checks.map(item=><p key={item.label} className={item.ok?'':'panel-error'}>{item.ok?'✓':'!'} {item.label}：<span>{item.detail}</span></p>)}</section>}
    <div className="automation-config-grid"><section className="automation-card">
      <header className="automation-toolbar"><h3>任务参数</h3><span className="muted">{paramDirty?'未保存':'已保存'}</span><button disabled={pending} onClick={()=>void perform(()=>api.save({kind,scope:'parameters',values:p}),'任务参数已保存')}>保存任务参数</button></header>
      <div className="automation-fields"><label>起点<select aria-label="流程起点" value={p.start} onChange={event=>update({start:event.target.value as AutomationParameters['start']})}><option value="script">从测种脚本开始</option><option value="capture">从捕获 Seed 开始</option>{isStatic&&<option value="reidentify">从当前 Seed 校正开始</option>}</select></label>
        <label>运行模式<select value={p.loop_mode} onChange={event=>update({loop_mode:event.target.value as AutomationParameters['loop_mode']})}><option value="single">单次</option><option value="count">循环 N 次</option><option value="infinite">无限循环</option></select></label>{p.loop_mode==='count'&&numeric('循环次数','loop_count',1,1000000)}</div>
      {isStatic?<>
        <div className="automation-fields"><label>目标宝可梦<select aria-label="自动定点宝可梦" value={p.target} onChange={event=>{const target=STATIC_TARGETS.find(item=>item.speciesKey===event.target.value);const saved=target&&snapshot.profiles[String(target.speciesId)];update({target:event.target.value,...(saved?{fixed_delay:saved.config.baseline_delay}:{})});setDelayOpen(false);}}>{getStaticTargets('all',profile.version).map(target=><option key={target.speciesKey} value={target.speciesKey}>{target.species} · {target.level}级{target.roamer?' 游走':''}</option>)}</select></label>
          <div><span>队首特性</span><LeadSelector value={p.lead} onChange={lead=>update({lead})}/></div>
          {numeric('初始帧','initial_advances')}{numeric('搜索范围','max_advances')}{numeric('Offset','offset')}{numeric('基准 delay','fixed_delay')}
        </div>
        <details open><summary>目标筛选 · {p.filters.length} 组</summary><div className="automation-toolbar">
          {p.filters.map((_,i)=><button key={i} aria-pressed={filterIndex===i} onClick={()=>setFilterIndex(i)}>目标 {i+1}</button>)}
          <button disabled={p.filters.length>=20} onClick={()=>{update({filters:[...p.filters,structuredClone(filter)]});setFilterIndex(p.filters.length);}}>添加目标</button>
          <button disabled={p.filters.length===1} onClick={()=>{update({filters:p.filters.filter((_,i)=>i!==filterIndex)});setFilterIndex(0);}}>移除目标</button></div>
          <div className="automation-fields"><label>异色<select value={filter.shiny} onChange={event=>changeFilter({shiny:Number(event.target.value)})}><option value={255}>任意</option><option value={3}>异色</option><option value={1}>Star</option><option value={2}>Square</option><option value={0}>非异色</option></select></label>
            <label>特性<select value={filter.ability} onChange={event=>changeFilter({ability:Number(event.target.value)})}><option value={255}>任意</option><option value={0}>0</option><option value={1}>1</option><option value={2}>隐藏</option></select></label>
            <label>性别<select value={filter.gender} onChange={event=>changeFilter({gender:Number(event.target.value)})}><option value={255}>任意</option><option value={0}>雄性</option><option value={1}>雌性</option><option value={2}>无性别</option></select></label></div>
          <div className="automation-ivs">{statNames.map((label,i)=><label key={label}>{label}<input aria-label={`${label}最小IV`} type="number" min={0} max={31} value={filter.ivMin[i]} onChange={event=>changeFilter({ivMin:filter.ivMin.map((value,n)=>n===i?Number(event.target.value):value)})}/><input aria-label={`${label}最大IV`} type="number" min={0} max={31} value={filter.ivMax[i]} onChange={event=>changeFilter({ivMax:filter.ivMax.map((value,n)=>n===i?Number(event.target.value):value)})}/></label>)}</div>
          <details><summary>性格与体型</summary><div className="automation-natures">{NATURES_ZH.map((name,i)=><label key={name}><input type="checkbox" checked={filter.natures[i]} onChange={event=>changeFilter({natures:filter.natures.map((value,n)=>n===i?event.target.checked:value)})}/>{name}</label>)}</div>
            <div className="automation-fields">{(['heightMin','heightMax','weightMin','weightMax'] as const).map((key,i)=><label key={key}>{['身高下限','身高上限','体重下限','体重上限'][i]}<input type="number" min={0} max={255} value={filter[key]} onChange={event=>changeFilter({[key]:Number(event.target.value)})}/></label>)}</div></details>
        </details>
        <details><summary>自动策略</summary><div className="automation-fields">
          {numeric('最大等待帧数','max_wait_frames')}{numeric('校正帧数上限','reseed_threshold_frames',0,1000000)}{numeric('普通校正最大尝试','reidentify_max_attempts',1,100)}
          <label>校正失败处理<select value={p.reidentify_failure_policy} onChange={event=>update({reidentify_failure_policy:event.target.value as AutomationParameters['reidentify_failure_policy']})}><option value="next_round">进入下一轮</option><option value="recapture_seed">先完整重测 Seed</option></select></label>
          {numeric('补救测种最大尝试','reidentify_seed_max_attempts',1,100)}{numeric('过场预留帧数','reseeding_threshold')}
          <label>过场测种配置<select value={p.exit_blink_name||''} onChange={event=>update({exit_blink_name:event.target.value})}><option value="">使用当前眨眼配置</option>{blinkConfigs.map(value=><option key={value.name}>{value.name}</option>)}</select></label>
          <label>同步策略<select value={p.sync_mode} onChange={event=>update({sync_mode:Number(event.target.value)})}><option value={0}>关闭</option><option value={1}>首位普通精灵</option><option value={2}>首位同步精灵</option></select></label>
          {p.sync_mode>0&&<label>同步性格<select value={p.sync_nature} onChange={event=>update({sync_nature:event.target.value})}><option value="">选择性格</option>{NATURES_ZH.map(value=><option key={value}>{value}</option>)}</select></label>}
          <label>判闪阈值（秒）<input aria-label="判闪阈值" type="number" min={0.001} step={.1} value={p.shiny_threshold_seconds??''} placeholder="留空禁用" onChange={event=>update({shiny_threshold_seconds:event.target.value===''?null:Number(event.target.value)})}/></label>
          {numeric('反查窗口','reverse_lookup_window',0,10000)}</div>
          <div className="automation-toolbar"><label><input type="checkbox" checked={p.auto_reverse} onChange={event=>update({auto_reverse:event.target.checked})}/>自动反查</label><label><input type="checkbox" checked={p.escape_continue} onChange={event=>update({escape_continue:event.target.checked})}/>逃跑续搜</label></div>
          <button disabled={busy||pending} onClick={()=>void perform(async()=>setCalibration(await api.calibrate(p.target)))}>校准闪光判定</button>
          <p className="muted">校准会监测画面；请手动触发一次普通遭遇，完成后确认建议阈值。</p>
          {calibration&&<div className="automation-toolbar"><span>实测 {calibration.interval.toFixed(3)} 秒 · 建议 {calibration.suggested.toFixed(3)} 秒</span><button onClick={()=>{update({shiny_threshold_seconds:calibration.suggested});setCalibration(null);}}>采用建议阈值</button></div>}
        </details>
        <button className="button" onClick={openDelay}>delay 策略与样本 · {strategyLabels[profileDelay?.config.strategy||'fixed']}</button>
        {delayOpen&&delay&&<section className="automation-delay" aria-label="delay 策略与样本"><h4>{target?.species} · 本轮 {snapshot.state.roundDelay??'—'} / 下轮预计 {estimate??'—'} / 基准 {delay.baseline_delay}</h4><div className="automation-fields">
          <label>策略<select value={delay.strategy} onChange={event=>setDelay({...delay,strategy:event.target.value})}>{Object.entries(strategyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>基准值<input type="number" value={delay.baseline_delay} onChange={event=>setDelay({...delay,baseline_delay:Number(event.target.value)})}/></label>
          <label>多候选策略<select value={delay.multi_candidate_policy} onChange={event=>setDelay({...delay,multi_candidate_policy:event.target.value})}><option value="ignore">忽略多候选轮次</option><option value="weighted">每轮总权重为 1</option></select></label>
          {(['window_size','ewma_alpha','dense_interval_width'] as const).map((key,i)=><label key={key}>{['有效轮次窗口','平滑权重','密集区间跨度'][i]}<input type="number" step={key==='ewma_alpha'?.1:1} value={delay[key]} onChange={event=>setDelay({...delay,[key]:Number(event.target.value)})}/></label>)}</div>
          <div className="automation-toolbar"><button onClick={()=>void perform(async()=>{await api.delay({species,action:'save',config:delay});update({fixed_delay:delay.baseline_delay});},'delay 策略已保存，从下一轮生效')}>保存 delay 策略</button><button onClick={()=>void perform(()=>api.delay({species,action:'clear'}),'当前精灵样本已清空')}>清空当前精灵样本</button></div>
          <p className="muted">本轮 delay 已冻结；策略和样本变动从下一轮生效。</p>
          {[...(profileDelay?.samples||[])].reverse().slice(samplePage*10,samplePage*10+10).map(sample=><div className="automation-toolbar" key={sample.round_number}><span style={{textDecoration:sample.excluded?'line-through':undefined}}>第 {sample.round_number} 轮 · {sample.candidates.join(' / ')} · {new Date(sample.observed_at).toLocaleString()}</span><button onClick={()=>void perform(()=>api.delay({species,action:'exclude',number:sample.round_number,excluded:!sample.excluded}))}>{sample.excluded?'恢复':'划除'}</button></div>)}
          <div className="automation-toolbar"><button disabled={!samplePage} onClick={()=>setSamplePage(samplePage-1)}>上一页</button><span>{samplePage+1}</span><button disabled={(samplePage+1)*10>=(profileDelay?.samples.length||0)} onClick={()=>setSamplePage(samplePage+1)}>下一页</button></div>
        </section>}
      </>:<><div className="automation-fields">{numeric('TID 搜索范围','frame_threshold',0,250000)}{numeric('取名 delay','delay')}
        <label>目标 Display TID<input aria-label="目标 Display TID" placeholder="多个号码用空格或逗号分隔" value={tidText} onChange={event=>setTidText(event.target.value)}/></label></div>
        <button onClick={()=>{const values=tidText.trim().split(/[\s,，]+/);if(values.some(value=>!/^\d{1,6}$/.test(value))){setError('Display TID 需要0–999999之间的整数');return;}update({target_display_tids:[...new Set([...p.target_display_tids,...values.map(Number)])]});setTidText('');}}>添加目标 TID</button>
        <div className="automation-toolbar">{p.target_display_tids.map(value=><button key={value} title="移除目标" onClick={()=>update({target_display_tids:p.target_display_tids.filter(item=>item!==value)})}>{String(value).padStart(6,'0')} ×</button>)}</div>
        <p className="muted">使用“眨眼捕获”当前 S[0–3]。手动生成只有相对用时，实际测种后附带预计到达日期。</p>
        <button disabled={busy||pending} onClick={()=>void perform(async()=>{setIds(await api.tidPreview({seed:blinkConfig.seed,frame_threshold:p.frame_threshold}));setIdPage(0);})}>使用当前 Seed 生成 ID 数据</button>
      </>}
    </section>
    <section className="automation-card"><details open><summary>任务脚本</summary><p className="muted">{scriptDirty?'脚本选择未保存':'脚本选择已保存'} · 使用脚本库中的 .txt 文件</p>
      {Object.entries(config.scripts).map(([key,value])=><label className="automation-script-field" key={key}>{scriptLabels[key]||key}<select aria-label={scriptLabels[key]||key} value={value} onFocus={refreshScripts} onChange={event=>setConfig({...config,scripts:{...config.scripts,[key]:event.target.value}})}><option value="">未选择</option>{value&&!files.some(file=>file.path===value)&&<option value={value}>{value}（文件不可用）</option>}{files.map(file=><option key={file.path} value={file.path}>{file.path}</option>)}</select></label>)}
      <div className="automation-toolbar"><button disabled={pending} onClick={()=>void perform(()=>api.save({kind,scope:'scripts',values:config.scripts}),'脚本选择已保存')}>保存脚本选择</button><button onClick={refreshScripts}>刷新脚本</button></div></details>
      <details open><summary>运行详情</summary><dl className="automation-metrics"><div><dt>轮次 / 阶段</dt><dd>{progress?.loop_index||0} / {progress?.phase||'等待开始'}</dd></div><div><dt>当前 Adv</dt><dd>{progress?.current_advances??'—'}</dd></div><div><dt>目标 Adv</dt><dd>{progress?.raw_target_advances??progress?.target_advances??'—'}</dd></div><div><dt>启动 Adv</dt><dd>{progress?.trigger_advances??'—'}</dd></div><div><dt>剩余 Adv</dt><dd>{progress?.remaining_to_trigger??'—'}</dd></div><div><dt>本轮 delay</dt><dd>{snapshot.state.kind===kind?snapshot.state.roundDelay??p.delay??'—':'—'}</dd></div></dl>
        <p className="mono">{progress?.seed_text||'尚未捕获 Seed'}</p>
        {snapshot.state.kind===kind&&snapshot.state.capture&&<p>眨眼捕获 {snapshot.state.capture.captured} / {snapshot.state.capture.target}</p>}
        {!!progress?.wait_target_wall&&busy&&<p className="automation-countdown">距取名启动 · 预计 {Math.max(0,progress.wait_target_wall-now/1000).toFixed(1)} 秒</p>}
        <p>{progress?.last_script_path}</p></details>
    </section></div>
    {isStatic?<CandidateTable rows={round?.candidates||[]} selected={round?.selected} sources={round?.sources}/>:<section className="automation-table" aria-label="ID 数据"><div className="automation-toolbar">
      <button aria-pressed={!onlyTargets} onClick={()=>{setOnlyTargets(false);setIdPage(0);}}>全部 TID · {idRows.length}</button><button aria-pressed={onlyTargets} onClick={()=>{setOnlyTargets(true);setIdPage(0);}}>仅目标 TID · {idRows.filter(row=>p.target_display_tids.includes(row.display_tid)).length}</button>
      <button onClick={()=>{const index=visibleIds.findIndex(row=>p.target_display_tids.includes(row.display_tid));if(index>=0){setIdPage(Math.floor(index/50));setSelectedId(visibleIds[index].advances);}}}>定位目标</button>
      <button disabled={selectedId===null} onClick={()=>void perform(()=>navigator.clipboard.writeText(idCells(idRows.find(row=>row.advances===selectedId)!).join('\t')))}>复制选中</button>
      <button onClick={()=>void perform(()=>navigator.clipboard.writeText(idText()))}>复制全部</button><button onClick={()=>downloadText(idText(),'TID数据.csv','text/csv')}>导出全部 CSV</button></div>
      <div className="automation-table-scroll"><table><thead><tr>{['Adv','TID','SID','TSV','Display TID','累计用时(秒)','预计到达时间'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{visibleIds.slice(page*50,page*50+50).map(row=><tr key={row.advances} onClick={()=>setSelectedId(row.advances)} aria-selected={selectedId===row.advances} className={p.target_display_tids.includes(row.display_tid)?'is-target':''}>{idCells(row).map((value,i)=><td key={i} title={String(value)}>{i===6&&progress?.current_advances!==undefined&&row.advances<=progress.current_advances?(row.advances===progress.current_advances?'当前帧':'已过'):value}</td>)}</tr>)}</tbody></table></div>
      <div className="automation-toolbar"><button disabled={!page} onClick={()=>setIdPage(page-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(visibleIds.length/50))}</span><button disabled={(page+1)*50>=visibleIds.length} onClick={()=>setIdPage(page+1)}>下一页</button></div>
    </section>}
  </section>;
}
