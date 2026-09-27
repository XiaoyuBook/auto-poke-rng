import { useEffect, useRef, useState } from 'react';
import { Play, Square, ListChecks, FileClock, Plus, Pencil, Trash2, ChevronDown, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { automationBusy, downloadText, useAutomation, type AutomationConfig, type AutomationKind, type AutomationParameters, type DelayConfig, type IdResults, type Readiness, type StaticAutomationConfig, type StaticFeatureKey, type TargetFilter } from '../automation';
import type { BlinkConfig } from '../blink';
import type { BdspProfile } from '../bdspProfile';
import type { ScriptFile } from '../scriptLibrary';
import { CATEGORY_OPTIONS, NATURES_ZH, STATIC_TARGETS, getCategoryLabel, getStaticTargets } from '../staticData';
import { LeadSelector } from './LeadSelector';
import { CandidateTable } from './AutomationLogs';
import { Dialog } from './Dialog';
import { DelayConfigDialog, delayPreviewReason, delayStrategyLabels, useDelayPreview } from './DelayConfigDialog';

const scriptLabels:Record<string,string>={seed:'测种脚本',advance:'过帧脚本',hit:'撞帧脚本',exit:'过场脚本',reverse:'反查脚本',escape:'逃跑脚本',name:'取名脚本'};
const featureInfo:Record<StaticFeatureKey,{label:string;description:string}>={reverse:{label:'自动反查',description:'未出闪时反查目标帧与实际 delay'},exit:{label:'过场',description:'预留帧数并在过场后重新测种'},sync:{label:'同步策略',description:'配置队首及同步性格搜索'},escape:{label:'逃跑续搜',description:'未出闪时执行逃跑并继续搜索'}};
const featureOrder:StaticFeatureKey[]=['reverse','exit','sync','escape'];
const statusLabels:Record<string,string>={idle:'待命',starting:'启动中',running:'运行中',stopping:'停止中',completed:'已完成',failed:'失败',stopped:'已停止'};
const statNames=['HP','攻击','防御','特攻','特防','速度'];
const targetSprites=import.meta.glob<string>('../assets/bdsp-targets/*.png',{eager:true,query:'?url',import:'default'});

export function AutomationWorkspace({kind,profile,blinkConfig,blinkConfigs,openLogs}:{kind:AutomationKind;profile:BdspProfile;blinkConfig:BlinkConfig;blinkConfigs:BlinkConfig[];openLogs:()=>void}){
  const {api,snapshot,error,setError,setSnapshot}=useAutomation();
  const [config,setConfig]=useState<AutomationConfig|null>(null),[files,setFiles]=useState<ScriptFile[]>([]),[notice,setNotice]=useState('');
  const [targetSettingsOpen,setTargetSettingsOpen]=useState(false);
  const [groupEditor,setGroupEditor]=useState<{mode:'create'|'rename';id?:string}|null>(null),[groupName,setGroupName]=useState('');
  const [groupDeleteId,setGroupDeleteId]=useState<string|null>(null),[addFeaturesOpen,setAddFeaturesOpen]=useState(false),[selectedFeatures,setSelectedFeatures]=useState<StaticFeatureKey[]>([]),[focusedFeature,setFocusedFeature]=useState<string>('base'),[expandedFeatures,setExpandedFeatures]=useState<Record<string,boolean>>({}),[removedFeature,setRemovedFeature]=useState<StaticFeatureKey|null>(null);
  const [readiness,setReadiness]=useState<Readiness|null>(null),[pending,setPending]=useState(false),[filterIndex,setFilterIndex]=useState(0);
  const [delayOpen,setDelayOpen]=useState(false);
  const [tidText,setTidText]=useState(''),[ids,setIds]=useState<IdResults|null>(null),[onlyTargets,setOnlyTargets]=useState(false),[idPage,setIdPage]=useState(0),[selectedId,setSelectedId]=useState<number|null>(null);
  const [now,setNow]=useState(Date.now());const initialized=useRef(false);
  const [calibration,setCalibration]=useState<{interval:number;suggested:number}|null>(null);
  const [saveFailed,setSaveFailed]=useState(false);
  const savingRef=useRef(false);
  const operationRef=useRef(false);
  const delayTriggerRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(snapshot&&!initialized.current){initialized.current=true;setConfig(structuredClone(snapshot.config[kind]));}},[snapshot,kind]);
  const refreshScripts=()=>{void window.desktop?.scripts.list().then(value=>setFiles(value.files)).catch(error=>setError(error.message));};
  useEffect(()=>{if(api)refreshScripts();},[api]);
  const progress=snapshot?.state.kind===kind?snapshot.state.progress:null;
  useEffect(()=>{if(progress?.id_states){setIds({id_states:progress.id_states,id_elapsed_seconds:progress.id_elapsed_seconds||[],seed_measured_wall_time:progress.seed_measured_wall_time});if(!progress.id_states.length){setSelectedId(null);setIdPage(0);}}},[progress?.id_states,progress?.id_elapsed_seconds,progress?.seed_measured_wall_time]);
  const estimateSpecies=STATIC_TARGETS.find(item=>item.speciesKey===config?.parameters.target)?.speciesId;
  const previewSamples=snapshot?.profiles[String(estimateSpecies)]?.samples||[];
  const delayPreview=useDelayPreview(kind==='static'&&config?(config as StaticAutomationConfig).delayConfig:null,previewSamples,`${snapshot?.staticGroups.activeId}:${estimateSpecies}`,api);
  useEffect(()=>{if(!progress?.wait_target_wall)return;const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[progress?.wait_target_wall]);
  if(!api||!snapshot||!config)return <section className="automation-workspace"><p role="status">{error||(!api?'请在桌面应用中使用自动流程。':'正在加载自动流程…')}</p></section>;
  const p=config.parameters,busy=automationBusy(snapshot.state),isStatic=kind==='static';
  const staticConfig=config as StaticAutomationConfig;
  const groups=snapshot.staticGroups?.items||[],activeGroup=groups.find(item=>item.id===snapshot.staticGroups?.activeId);
  const ownState=snapshot.state.kind===kind?snapshot.state:null;
  const statusLabel=ownState?(statusLabels[ownState.status]||ownState.status):busy?'其他流程运行中':'待命';
  const statusMessage=ownState?.message||(busy?`${snapshot.state.kind==='tid'?'自动 TID':'自动定点'}：${snapshot.state.message}`:'等待开始');
  const target=STATIC_TARGETS.find(item=>item.speciesKey===p.target),species=target?.speciesId||387;
  const profileDelay=snapshot.profiles[String(species)];
  const delaySamples=profileDelay?.samples||[];
  const currentRun=snapshot.runs.find(item=>item.id===snapshot.state.runId&&item.kind===kind),round=currentRun?.rounds.at(-1);
  const update=(values:Partial<AutomationParameters>)=>{setReadiness(null);setSaveFailed(false);setConfig(current=>current&&({...current,parameters:{...current.parameters,...values}}));};
  const updateFeature=(key:StaticFeatureKey,added:boolean)=>{setReadiness(null);setSaveFailed(false);setConfig(current=>current&&({...current,features:{...(current as StaticAutomationConfig).features,[key]:{...(current as StaticAutomationConfig).features[key],added}}}));};
  const updateDelay=(draft:DelayConfig)=>{setReadiness(null);setSaveFailed(false);setConfig(current=>current&&({...current,parameters:{...current.parameters,fixed_delay:draft.baseline_delay},delayConfig:draft}));};
  const closeDelay=()=>{setDelayOpen(false);requestAnimationFrame(()=>delayTriggerRef.current?.focus());};
  const perform=async(action:()=>Promise<unknown>,message='')=>{if(operationRef.current)return;operationRef.current=true;setError('');setNotice('');setPending(true);try{await action();if(message)setNotice(message);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{operationRef.current=false;setPending(false);}};
  const input=()=>{
    const selectedBlink=p.blink_name?blinkConfigs.find(item=>item.name===p.blink_name):blinkConfig;
    if(isStatic&&!selectedBlink)throw Error('所选默认测种配置已不可用，请重新选择');
    return {kind,config,blink:selectedBlink||blinkConfig,exitBlink:blinkConfigs.find(item=>item.name===p.exit_blink_name),profile};
  };
  const numeric=(label:string,key:keyof AutomationParameters,min=0,max=1000000000)=>{const value=p[key] as number|null;const invalid=value===null||!Number.isInteger(value)||value<min||value>max;return <label>{label}<input aria-label={label} aria-invalid={invalid} type="number" min={min} max={max} value={value??''} onChange={event=>update({[key]:event.target.value===''?null:Number(event.target.value)})}/>{invalid&&<small className="automation-field-error">请输入 {min}–{max} 的整数</small>}</label>;};
  const openRelated=()=>{if(currentRun)localStorage.setItem('auto-poke-rng:log-context',JSON.stringify({runId:currentRun.id,round:round?.number}));openLogs();window.dispatchEvent(new Event('auto-poke:related-logs'));};
  const paramDirty=JSON.stringify(p)!==JSON.stringify(snapshot.config[kind].parameters),scriptDirty=JSON.stringify(config.scripts)!==JSON.stringify(snapshot.config[kind].scripts);
  const dirty=isStatic?JSON.stringify(config)!==JSON.stringify(snapshot.config.static):paramDirty||scriptDirty;
  const saveDraft=async()=>{
    if(savingRef.current)throw Error('正在保存配置');
    savingRef.current=true;
    try {
      if(isStatic){if(dirty){const saved=await api.save({kind:'static',scope:'config',values:staticConfig,expectedId:snapshot.staticGroups.activeId});setSnapshot({...saved,state:snapshot.state});setConfig(structuredClone(saved.config.static));}}
      else {if(paramDirty)await api.save({kind,scope:'parameters',values:p});if(scriptDirty)await api.save({kind,scope:'scripts',values:config.scripts});}
      setSaveFailed(false);
    } catch(error) {
      setSaveFailed(true);throw error;
    } finally {savingRef.current=false;}
  };
  const activateGroup=async(id:string)=>{
    if(id===snapshot.staticGroups.activeId||busy||pending||operationRef.current)return;
    operationRef.current=true;setError('');setNotice('');setPending(true);
    try{await saveDraft();const next=await api.manageStaticGroup({action:'select',id});setSnapshot(next);setConfig(structuredClone(next.config.static));setReadiness(null);setDelayOpen(false);setFilterIndex(0);setRemovedFeature(null);}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{operationRef.current=false;setPending(false);}
  };
  const submitGroup=async()=>{
    if(!groupEditor||!groupName.trim()||operationRef.current)return;
    operationRef.current=true;setError('');setPending(true);
    try{
      if(groupEditor.mode==='create')await saveDraft();
      const next=await api.manageStaticGroup({action:groupEditor.mode,id:groupEditor.id,name:groupName.trim()});
      setSnapshot(next);
      if(groupEditor.mode==='create'){setConfig(structuredClone(next.config.static));setReadiness(null);setDelayOpen(false);setRemovedFeature(null);}
      setGroupEditor(null);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{operationRef.current=false;setPending(false);}
  };
  const deleteGroup=async()=>{
    if(!groupDeleteId||operationRef.current)return;
    operationRef.current=true;setError('');setPending(true);
    try{if(groupDeleteId!==snapshot.staticGroups.activeId)await saveDraft();const next=await api.manageStaticGroup({action:'delete',id:groupDeleteId});setSnapshot(next);setConfig(structuredClone(next.config.static));setGroupDeleteId(null);setReadiness(null);setRemovedFeature(null);}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{operationRef.current=false;setPending(false);}
  };
  const filter=p.filters?.[filterIndex]||p.filters?.[0];
  const changeFilter=(values:Partial<TargetFilter>)=>update({filters:p.filters.map((item,index)=>index===filterIndex?{...item,...values}:item)});
  const saveTargetSettings=()=>setTargetSettingsOpen(false);
  const idRows=(ids?.id_states||[]).map((row,index)=>({...row,index}));
  const visibleIds=onlyTargets?idRows.filter(row=>p.target_display_tids.includes(row.display_tid)):idRows;
  const page=Math.min(idPage,Math.max(0,Math.ceil(visibleIds.length/50)-1));
  const idCells=(row:typeof idRows[number])=>{const elapsed=ids?.id_elapsed_seconds[row.index];return [row.advances,row.tid,row.sid,row.tsv,String(row.display_tid).padStart(6,'0'),elapsed==null?'—':elapsed.toFixed(3),elapsed==null||!ids?.seed_measured_wall_time?'—':new Date((ids.seed_measured_wall_time+elapsed)*1000).toLocaleString()];};
  const idText=()=>[['Adv','TID','SID','TSV','Display TID','累计用时','预计到达时间'],...idRows.map(idCells)].map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const renderTargetEditor=()=>isStatic&&filter?<>
        <div className="automation-target-picker">
          <label>目标宝可梦<select aria-label="自动定点宝可梦" value={p.target} onChange={event=>{update({target:event.target.value});setDelayOpen(false);}}>{CATEGORY_OPTIONS.filter(option=>option.key!=='all').map(category=><optgroup key={category.key} label={category.label}>{getStaticTargets(category.key,profile.version).map(item=><option key={item.speciesKey} value={item.speciesKey}>{item.species} · {item.level}级{item.roamer?' · 游走':''}</option>)}</optgroup>)}</select></label>
          {target&&<div className="automation-target-selected" aria-label="当前目标" aria-live="polite">
            <div className="automation-target-art"><img src={targetSprites[`../assets/bdsp-targets/${target.speciesId}.png`]} alt="" /></div>
            <div className="automation-target-identity"><span>当前目标</span><strong>{target.species}</strong><small>图鉴 #{String(target.speciesId).padStart(3,'0')} · {getCategoryLabel(target.category)} · {target.level} 级{target.roamer?' · 游走':''}</small></div>
          </div>}
        </div>
        <details open><summary>筛选条件 · {p.filters.length} 组</summary><div className="automation-toolbar">
          {p.filters.map((_,i)=><button key={i} aria-pressed={filterIndex===i} onClick={()=>setFilterIndex(i)}>条件 {i+1}</button>)}
          <button disabled={p.filters.length>=20} onClick={()=>{update({filters:[...p.filters,structuredClone(filter)]});setFilterIndex(p.filters.length);}}>添加条件</button>
          <button disabled={p.filters.length===1} onClick={()=>{update({filters:p.filters.filter((_,i)=>i!==filterIndex)});setFilterIndex(0);}}>移除条件</button></div>
          <div className="automation-fields"><label>异色<select value={filter.shiny} onChange={event=>changeFilter({shiny:Number(event.target.value)})}><option value={255}>任意</option><option value={3}>异色</option><option value={1}>Star</option><option value={2}>Square</option><option value={0}>非异色</option></select></label>
            <label>特性<select value={filter.ability} onChange={event=>changeFilter({ability:Number(event.target.value)})}><option value={255}>任意</option><option value={0}>0</option><option value={1}>1</option><option value={2}>隐藏</option></select></label>
            <label>性别<select value={filter.gender} onChange={event=>changeFilter({gender:Number(event.target.value)})}><option value={255}>任意</option><option value={0}>雄性</option><option value={1}>雌性</option><option value={2}>无性别</option></select></label></div>
          <div className="automation-ivs">{statNames.map((label,i)=><label key={label}>{label}<input aria-label={`${label}最小IV`} type="number" min={0} max={31} value={filter.ivMin[i]} onChange={event=>changeFilter({ivMin:filter.ivMin.map((value,n)=>n===i?Number(event.target.value):value)})}/><input aria-label={`${label}最大IV`} type="number" min={0} max={31} value={filter.ivMax[i]} onChange={event=>changeFilter({ivMax:filter.ivMax.map((value,n)=>n===i?Number(event.target.value):value)})}/></label>)}</div>
          <details><summary>性格与体型</summary><div className="automation-natures">{NATURES_ZH.map((name,i)=><label key={name}><input type="checkbox" checked={filter.natures[i]} onChange={event=>changeFilter({natures:filter.natures.map((value,n)=>n===i?event.target.checked:value)})}/>{name}</label>)}</div>
            <div className="automation-fields">{(['heightMin','heightMax','weightMin','weightMax'] as const).map((key,i)=><label key={key}>{['身高下限','身高上限','体重下限','体重上限'][i]}<input type="number" min={0} max={255} value={filter[key]} onChange={event=>changeFilter({[key]:Number(event.target.value)})}/></label>)}</div></details>
        </details>
  </>:null;
  const runDetails=<>
    <dl className="automation-metrics"><div><dt>轮次 / 阶段</dt><dd>{progress?.loop_index||0} / {progress?.phase||'等待开始'}</dd></div><div><dt>当前 Adv</dt><dd>{progress?.current_advances??'—'}</dd></div><div><dt>目标 Adv</dt><dd>{progress?.raw_target_advances??progress?.target_advances??'—'}</dd></div><div><dt>启动 Adv</dt><dd>{progress?.trigger_advances??'—'}</dd></div><div><dt>剩余 Adv</dt><dd>{progress?.remaining_to_trigger??'—'}</dd></div><div><dt>本轮 delay</dt><dd>{snapshot.state.kind===kind?snapshot.state.roundDelay??p.delay??'—':'—'}</dd></div></dl>
    <p className="mono">{progress?.seed_text||'尚未捕获 Seed'}</p>
    {snapshot.state.kind===kind&&snapshot.state.capture&&<p>眨眼捕获 {snapshot.state.capture.captured} / {snapshot.state.capture.target}</p>}
    {!!progress?.wait_target_wall&&busy&&<p className="automation-countdown">距取名启动 · 预计 {Math.max(0,progress.wait_target_wall-now/1000).toFixed(1)} 秒</p>}
    <p>{progress?.last_script_path}</p>
  </>;
  const jumpTo=(id:string)=>{setFocusedFeature(id);setExpandedFeatures(current=>({...current,[id]:true}));requestAnimationFrame(()=>document.getElementById(`automation-section-${id}`)?.scrollIntoView({behavior:'smooth',block:'nearest'}));};
  const scriptField=(key:string)=><label className="automation-script-field" key={key}>{scriptLabels[key]}<select aria-label={scriptLabels[key]} disabled={busy||pending} value={config.scripts[key]||''} onFocus={refreshScripts} onChange={event=>{setReadiness(null);setSaveFailed(false);setConfig(current=>current&&({...current,scripts:{...current.scripts,[key]:event.target.value}}));}}><option value="">未选择</option>{config.scripts[key]&&!files.some(file=>file.path===config.scripts[key])&&<option value={config.scripts[key]}>{config.scripts[key]}（文件不可用）</option>}{files.map(file=><option key={file.path} value={file.path}>{file.path}</option>)}</select></label>;
  const thresholdEditor=<><label>判闪阈值（秒）<input aria-label="判闪阈值" type="number" min={0.001} max={300} step={.1} value={p.shiny_threshold_seconds??''} onChange={event=>update({shiny_threshold_seconds:event.target.value===''?null:Number(event.target.value)})}/></label><button type="button" disabled={busy||pending} onClick={()=>void perform(async()=>setCalibration(await api.calibrate(p.target)))}>校准闪光判定</button>{calibration&&<div className="automation-toolbar"><span>实测 {calibration.interval.toFixed(3)} 秒 · 建议 {calibration.suggested.toFixed(3)} 秒</span><button onClick={()=>{update({shiny_threshold_seconds:calibration.suggested});setCalibration(null);}}>采用建议阈值</button></div>}</>;
  const featureConfigured=(key:StaticFeatureKey)=>key==='sync'?(p.sync_mode>0||p.lead!==255):!!config.scripts[key];
  const featureIssue=(key:StaticFeatureKey)=>!featureConfigured(key)||(key==='sync'&&p.sync_mode>0&&!p.sync_nature);
  const readinessTarget=(label:string,detail:string)=>{
    if(label==='视频源'||label==='伊机控')return null;
    if(detail.includes('反查'))return 'reverse';
    if(detail.includes('过场'))return 'exit';
    if(detail.includes('同步')||detail.includes('队首'))return 'sync';
    if(detail.includes('逃跑'))return 'escape';
    if(detail.includes('判闪')||detail.includes('录像'))return 'shiny';
    return label.includes('脚本')?'scripts':'base';
  };
  const featureCard=(key:StaticFeatureKey)=>{
    const state=staticConfig.features[key];if(!state?.added)return null;
    const open=expandedFeatures[key]!==false;
    return <section id={`automation-section-${key}`} key={key} className="automation-card automation-feature-card" aria-label={featureInfo[key].label}>
      <div className="automation-feature-heading"><button type="button" className="automation-feature-title" aria-expanded={open} onClick={()=>setExpandedFeatures(current=>({...current,[key]:!open}))}><ChevronDown size={16} className={open?'':'is-closed'}/><strong>{featureInfo[key].label}</strong><span className="automation-feature-status">{featureIssue(key)?'待配置':'已配置'}</span></button></div>
      {open&&<div className="automation-feature-body"><p className="muted">{featureInfo[key].description}</p><fieldset disabled={busy||pending}><div className="automation-fields">
        {key==='reverse'&&<>{scriptField('reverse')}{numeric('反查窗口（帧）','reverse_lookup_window',0,10000)}</>}
        {key==='exit'&&<>{numeric('过场预留帧数','reseeding_threshold')}{scriptField('exit')}<label>过场测种配置<select aria-label="过场测种配置" value={p.exit_blink_name||''} onChange={event=>update({exit_blink_name:event.target.value})}><option value="">{p.blink_name||blinkConfig.name}</option>{p.exit_blink_name&&!blinkConfigs.some(item=>item.name===p.exit_blink_name)&&<option value={p.exit_blink_name}>{p.exit_blink_name}（配置不可用）</option>}{blinkConfigs.map(value=><option key={value.name}>{value.name}</option>)}</select></label></>}
        {key==='sync'&&<><div><span>队首特性</span><LeadSelector value={p.lead} onChange={lead=>update({lead})}/></div><label>同步模式<select value={p.sync_mode} onChange={event=>update({sync_mode:Number(event.target.value)})}><option value={0}>关闭动态同步</option><option value={1}>首位普通精灵</option><option value={2}>首位同步精灵</option></select></label>{p.sync_mode>0&&<label>同步性格<select value={p.sync_nature} onChange={event=>update({sync_nature:event.target.value})}><option value="">选择性格</option>{NATURES_ZH.map(value=><option key={value}>{value}</option>)}</select></label>}</>}
        {key==='escape'&&scriptField('escape')}
      </div></fieldset></div>}
    </section>;
  };
  const topContent = <>
    <div className="automation-toolbar automation-run-toolbar">
      <button className="button primary" disabled={busy||pending} onClick={()=>void perform(async()=>{await saveDraft();await api.start(input());})}><Play size={14}/>开始</button>
      <button className="button" disabled={!busy} onClick={()=>void api.stop().catch(reason=>setError(reason instanceof Error?reason.message:String(reason)))}><Square size={14}/>停止</button>
      <button className="button" disabled={busy||pending} onClick={()=>void perform(async()=>{await saveDraft();setReadiness(await api.check(input()));})}><ListChecks size={14}/>开始前检查</button>
      <button className="button" onClick={openRelated}><FileClock size={14}/>查看相关日志</button>
      {isStatic&&<><span className="automation-save-status" role="status">{pending?'保存中':saveFailed?'保存失败':dirty?'未保存':'已保存'}</span><button type="button" disabled={busy||pending||!dirty} onClick={()=>void perform(saveDraft,'配置已保存')}>保存配置</button></>}
    </div>
    {(error||notice)&&<p role={error?'alert':'status'} className={error?'panel-error':'automation-notice'}>{error||notice}</p>}
    <div className={'automation-overview'+(isStatic?'':' automation-overview-single')}>
      {isStatic&&<button type="button" className="automation-target-card" aria-label="选择目标宝可梦与设置筛选条件" aria-haspopup="dialog" disabled={busy||pending} onClick={()=>setTargetSettingsOpen(true)}>
        {target&&<span className="automation-target-art"><img src={targetSprites[`../assets/bdsp-targets/${target.speciesId}.png`]} alt="" /></span>}
        <span className="automation-target-identity"><span>当前目标</span><strong>{target?.species||'未选择目标'}</strong><small>{target?`${getCategoryLabel(target.category)} · ${target.level} 级${target.roamer?' · 游走':''}`:''} · {p.filters.length} 组筛选条件</small></span>
        <span className="automation-target-action">目标设置</span>
      </button>}
      <section className="automation-status-card" data-status={ownState?.status||(busy?'running':'idle')} aria-label="自动流程状态">
        <div className="automation-status-heading"><span>当前流程状态</span><span className="automation-status-label">{statusLabel}</span></div>
        <strong role="status">{statusMessage}</strong>
        <dl><div><dt>阶段</dt><dd>{progress?.phase||'—'}</dd></div><div><dt>轮次</dt><dd>{progress?.loop_index||'—'}</dd></div><div><dt>当前 Adv</dt><dd>{progress?.current_advances??'—'}</dd></div></dl>
        {isStatic&&<details className="automation-status-details"><summary>查看运行详情</summary><div className="automation-status-details-content">{runDetails}</div></details>}
      </section>
    </div>
    {readiness&&<section className="automation-card" aria-label="开始前准备"><h3>开始前准备</h3>{readiness.checks.map(item=><p key={item.label} className={item.ok?'':'panel-error'}>{item.ok?'✓':'!'} {item.label}：<span>{item.detail}</span>{isStatic&&!item.ok&&readinessTarget(item.label,item.detail)&&<button type="button" onClick={()=>jumpTo(readinessTarget(item.label,item.detail)!)}>定位设置</button>}</p>)}</section>}
  </>;
  return <section className={'automation-workspace'+(isStatic?' automation-workspace-with-groups':'')} aria-label={isStatic?'自动定点工作区':'自动TID工作区'}>
    {isStatic&&<header className="automation-heading automation-static-heading"><div><h2>自动定点乱数</h2><p>配置目标、脚本与可选策略</p></div><div className="automation-flow-manager"><label>流程配置<select aria-label="流程配置" value={snapshot.staticGroups.activeId} disabled={busy||pending} onChange={event=>void activateGroup(event.target.value)}>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button type="button" aria-label="新建流程配置" title="新建流程配置" disabled={busy||pending} onClick={()=>{setGroupName('');setGroupEditor({mode:'create'});}}><Plus size={16}/></button><button type="button" aria-label="重命名流程配置" title="重命名流程配置" disabled={busy||pending} onClick={()=>{setGroupName(activeGroup?.name||'');setGroupEditor({mode:'rename',id:activeGroup?.id});}}><Pencil size={15}/></button><button type="button" aria-label="删除流程配置" title="删除流程配置" disabled={busy||pending||groups.length<=1} onClick={()=>setGroupDeleteId(snapshot.staticGroups.activeId)}><Trash2 size={15}/></button></div></header>}
    {isStatic&&<div className="automation-workspace-top">{topContent}</div>}
    {isStatic&&<aside className="automation-group-sidebar" aria-label="配置组">
      <div className="automation-group-panel">
      <div className="automation-group-header"><h2>配置组</h2><button type="button" aria-label="添加配置组" title="添加配置组" disabled={busy||pending} onClick={()=>{setSelectedFeatures([]);setAddFeaturesOpen(true);}}><Plus size={16}/></button></div>
      <div className="automation-group-list">{[{id:'base',label:'基础设置',status:'必选'},{id:'scripts',label:'基础脚本',status:'必选'},{id:'shiny',label:'闪光判定',status:'必选'},...featureOrder.filter(key=>staticConfig.features?.[key]?.added).map(key=>({id:key,label:featureInfo[key].label,status:featureIssue(key)?'待配置':'已配置'}))].map(item=>{const removable=featureOrder.includes(item.id as StaticFeatureKey);return <div key={item.id} className="automation-group-item"><button type="button" className={'automation-group-select'+(focusedFeature===item.id?' is-active':'')+(removable?' has-remove':'')} onClick={()=>jumpTo(item.id)}><strong>{item.label}</strong><small>{item.status}</small></button>{removable&&<button type="button" className="automation-group-remove" aria-label={`移除${item.label}`} title={`移除${item.label}`} disabled={busy||pending} onClick={()=>{updateFeature(item.id as StaticFeatureKey,false);setRemovedFeature(item.id as StaticFeatureKey);if(focusedFeature===item.id)setFocusedFeature('base');}}><Trash2 size={16} aria-hidden="true" /></button>}</div>;})}</div>
      </div>
    </aside>}
    <div className="automation-flow-content">
    {!isStatic&&<header className="automation-heading"><div><h2>自动 TID 乱数</h2><p>小卡比兽测种、Display TID 搜索与自动取名</p></div></header>}
    {!isStatic&&topContent}
    {isStatic&&<div className="automation-static-sections">
      <section id="automation-section-base" className="automation-card automation-feature-card" aria-label="基础设置"><div className="automation-feature-heading"><strong>基础设置</strong><span className="automation-feature-status">必选</span></div><fieldset disabled={busy||pending} className="automation-feature-body"><div className="automation-fields automation-base-fields">
        <label>起点<select aria-label="流程起点" value={p.start} onChange={event=>update({start:event.target.value as AutomationParameters['start']})}><option value="script">从测种脚本开始</option><option value="capture">从捕获 Seed 开始</option><option value="reidentify">从当前 Seed 校正开始</option></select></label>
        <label>默认测种配置<select aria-label="默认测种配置" value={p.blink_name||''} onChange={event=>update({blink_name:event.target.value})}><option value="">{blinkConfig.name}</option>{p.blink_name&&!blinkConfigs.some(item=>item.name===p.blink_name)&&<option value={p.blink_name}>{p.blink_name}（配置不可用）</option>}{blinkConfigs.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
        <label>运行模式<select value={p.loop_mode} onChange={event=>update({loop_mode:event.target.value as AutomationParameters['loop_mode']})}><option value="single">单次</option><option value="count">循环 N 次</option><option value="infinite">无限循环</option></select></label>{p.loop_mode==='count'&&numeric('循环次数','loop_count',1,1000000)}
        {numeric('搜索范围','max_advances')}
        <div className="automation-delay-field"><span>delay 策略</span><button ref={delayTriggerRef} type="button" className="automation-delay-trigger" aria-haspopup="dialog" aria-label={`设置 delay 策略：${delayStrategyLabels[staticConfig.delayConfig.strategy]||staticConfig.delayConfig.strategy}，预计 ${delayPreview.status==='ready'?delayPreview.result!.value:'待计算'} 帧`} onClick={()=>setDelayOpen(true)} title={delayStrategyLabels[staticConfig.delayConfig.strategy]||staticConfig.delayConfig.strategy}><span>{delayStrategyLabels[staticConfig.delayConfig.strategy]||staticConfig.delayConfig.strategy}</span><strong>{delayPreview.status==='ready'?delayPreview.result!.value:'—'} <small>帧</small></strong><SlidersHorizontal size={15} aria-hidden="true" /></button><small>{delayPreview.status==='ready'?delayPreviewReason(delayPreview.result!,staticConfig.delayConfig.strategy):delayPreview.status==='invalid'?'参数待补全':delayPreview.status==='error'?'预计值暂不可用':'下轮预计 · 计算中'}</small></div>
        {numeric('最大等待帧数','max_wait_frames')}
      </div>
      <details className="automation-subsection"><summary>校正与补救 · 高级设置</summary><div className="automation-fields">{numeric('校正帧数上限','reseed_threshold_frames',0,1000000)}{numeric('普通校正最大尝试','reidentify_max_attempts',1,100)}<label>校正失败处理<select value={p.reidentify_failure_policy} onChange={event=>update({reidentify_failure_policy:event.target.value as AutomationParameters['reidentify_failure_policy']})}><option value="next_round">进入下一轮</option><option value="recapture_seed">先完整重测 Seed</option></select></label>{p.reidentify_failure_policy==='recapture_seed'&&numeric('补救测种最大尝试','reidentify_seed_max_attempts',1,100)}</div></details>
      </fieldset></section>
      <section id="automation-section-scripts" className="automation-card automation-feature-card" aria-label="基础脚本"><div className="automation-feature-heading"><strong>基础脚本</strong><span className="automation-feature-status">必选</span><button type="button" className="automation-script-refresh" aria-label="刷新脚本" title="刷新脚本" disabled={busy||pending} onClick={refreshScripts}><RefreshCw size={16} aria-hidden="true" /></button></div><fieldset disabled={busy||pending} className="automation-feature-body"><p className="muted">选择脚本库中的 .txt 文件；测种脚本按起点和循环模式检查。</p><div className="automation-fields">{['seed','hit','advance'].map(scriptField)}</div></fieldset></section>
      <section id="automation-section-shiny" className="automation-card automation-feature-card" aria-label="闪光判定"><div className="automation-feature-heading"><strong>闪光判定</strong><span className="automation-feature-status">必选</span></div><fieldset disabled={busy||pending} className="automation-feature-body"><p className="muted">识别遭遇画面中两次提示文字的出现时间；间隔达到阈值时判为出闪。<br/>普通定点比较“出现了！”与“去吧/上吧”，御三家比较“去吧/上吧”与“战斗”。</p><div className="automation-fields automation-shiny-fields">{thresholdEditor}<button type="button" className="automation-record-button" aria-label="自动录像" aria-pressed={p.record_shiny} onClick={()=>update({record_shiny:!p.record_shiny})}>自动录像 · {p.record_shiny?'已开启':'已关闭'}</button></div></fieldset></section>
      {featureOrder.map(featureCard)}
    </div>}
    {!isStatic&&<div className="automation-config-grid">
      <details className="automation-card automation-flow-section" open><summary>任务参数<span>起点、运行模式与搜索范围</span></summary><div className="automation-flow-section-body">
        <header className="automation-toolbar"><span className="muted">{paramDirty?'未保存':'已保存'}</span><button disabled={pending} onClick={()=>void perform(()=>api.save({kind,scope:'parameters',values:p}),'任务参数已保存')}>保存任务参数</button></header>
        <div className="automation-fields"><label>起点<select aria-label="流程起点" value={p.start} onChange={event=>update({start:event.target.value as AutomationParameters['start']})}><option value="script">从测种脚本开始</option><option value="capture">从捕获 Seed 开始</option></select></label>
          <label>运行模式<select value={p.loop_mode} onChange={event=>update({loop_mode:event.target.value as AutomationParameters['loop_mode']})}><option value="single">单次</option><option value="count">循环 N 次</option><option value="infinite">无限循环</option></select></label>{p.loop_mode==='count'&&numeric('循环次数','loop_count',1,1000000)}
          {numeric('TID 搜索范围','frame_threshold',0,250000)}{numeric('取名 delay','delay')}
          <label>目标 Display TID<input aria-label="目标 Display TID" placeholder="多个号码用空格或逗号分隔" value={tidText} onChange={event=>setTidText(event.target.value)}/></label></div>
        <button onClick={()=>{const values=tidText.trim().split(/[\s,，]+/);if(values.some(value=>!/^\d{1,6}$/.test(value))){setError('Display TID 需要0–999999之间的整数');return;}update({target_display_tids:[...new Set([...p.target_display_tids,...values.map(Number)])]});setTidText('');}}>添加目标 TID</button>
        <div className="automation-toolbar">{p.target_display_tids.map(value=><button key={value} title="移除目标" onClick={()=>update({target_display_tids:p.target_display_tids.filter(item=>item!==value)})}>{String(value).padStart(6,'0')} ×</button>)}</div>
        <p className="muted">使用“眨眼捕获”当前 S[0–3]。手动生成只有相对用时，实际测种后附带预计到达日期。</p>
        <button disabled={busy||pending} onClick={()=>void perform(async()=>{setIds(await api.tidPreview({seed:blinkConfig.seed,frame_threshold:p.frame_threshold}));setIdPage(0);})}>使用当前 Seed 生成 ID 数据</button>
      </div></details>
      <details className="automation-card automation-flow-section"><summary>任务脚本<span>测种与取名脚本</span></summary><div className="automation-flow-section-body"><p className="muted">{scriptDirty?'脚本选择未保存':'脚本选择已保存'} · 使用脚本库中的 .txt 文件</p>
        {Object.keys(config.scripts).map(scriptField)}
        <div className="automation-toolbar"><button disabled={pending} onClick={()=>void perform(()=>api.save({kind,scope:'scripts',values:config.scripts}),'脚本选择已保存')}>保存脚本选择</button><button onClick={refreshScripts}>刷新脚本</button></div>
      </div></details>
      <details className="automation-card automation-flow-section"><summary>运行详情<span>当前轮次、帧数与 Seed</span></summary><div className="automation-flow-section-body">{runDetails}</div></details>
    </div>}
    {isStatic?<CandidateTable rows={round?.candidates||[]} selected={round?.selected} sources={round?.sources}/>:<section className="automation-table" aria-label="ID 数据"><div className="automation-toolbar">
      <button aria-pressed={!onlyTargets} onClick={()=>{setOnlyTargets(false);setIdPage(0);}}>全部 TID · {idRows.length}</button><button aria-pressed={onlyTargets} onClick={()=>{setOnlyTargets(true);setIdPage(0);}}>仅目标 TID · {idRows.filter(row=>p.target_display_tids.includes(row.display_tid)).length}</button>
      <button onClick={()=>{const index=visibleIds.findIndex(row=>p.target_display_tids.includes(row.display_tid));if(index>=0){setIdPage(Math.floor(index/50));setSelectedId(visibleIds[index].advances);}}}>定位目标</button>
      <button disabled={selectedId===null} onClick={()=>void perform(()=>navigator.clipboard.writeText(idCells(idRows.find(row=>row.advances===selectedId)!).join('\t')))}>复制选中</button>
      <button onClick={()=>void perform(()=>navigator.clipboard.writeText(idText()))}>复制全部</button><button onClick={()=>downloadText(idText(),'TID数据.csv','text/csv')}>导出全部 CSV</button></div>
      <div className="automation-table-scroll"><table><thead><tr>{['Adv','TID','SID','TSV','Display TID','累计用时(秒)','预计到达时间'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{visibleIds.slice(page*50,page*50+50).map(row=><tr key={row.advances} onClick={()=>setSelectedId(row.advances)} aria-selected={selectedId===row.advances} className={p.target_display_tids.includes(row.display_tid)?'is-target':''}>{idCells(row).map((value,i)=><td key={i} title={String(value)}>{i===6&&progress?.current_advances!==undefined&&row.advances<=progress.current_advances?(row.advances===progress.current_advances?'当前帧':'已过'):value}</td>)}</tr>)}</tbody></table></div>
      <div className="automation-toolbar"><button disabled={!page} onClick={()=>setIdPage(page-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(visibleIds.length/50))}</span><button disabled={(page+1)*50>=visibleIds.length} onClick={()=>setIdPage(page+1)}>下一页</button></div>
    </section>}
    </div>
    {isStatic&&targetSettingsOpen&&<Dialog title="目标与筛选条件" close={()=>setTargetSettingsOpen(false)} className="automation-target-dialog">
      <div className="automation-target-dialog-body">{renderTargetEditor()}{error&&<p className="panel-error" role="alert">{error}</p>}</div>
      <div className="automation-target-dialog-actions"><span className="muted">{dirty?'配置未保存':'配置已保存'}</span><button type="button" className="button primary" onClick={saveTargetSettings}>完成设置</button></div>
    </Dialog>}
    {isStatic&&delayOpen&&<DelayConfigDialog key={`${snapshot.staticGroups.activeId}:${species}`} config={staticConfig.delayConfig} samples={delaySamples} species={target?.species||'当前宝可梦'} flowName={activeGroup?.name||'当前流程'} scopeKey={`${snapshot.staticGroups.activeId}:${species}`} api={api} runningDelay={ownState?.roundDelay} locked={busy||pending} onClose={closeDelay} onApply={draft=>{updateDelay(draft);closeDelay();}} onExclude={async(roundNumber,excluded)=>{const next=await api.delay({species,action:'exclude',number:roundNumber,excluded});setSnapshot(next);}} onClear={async()=>{const next=await api.delay({species,action:'clear'});setSnapshot(next);}} />}
    {isStatic&&removedFeature&&<div className="automation-undo" role="status">已移除{featureInfo[removedFeature].label}<button type="button" onClick={()=>{updateFeature(removedFeature,true);jumpTo(removedFeature);setRemovedFeature(null);}}>撤销</button><button type="button" aria-label="关闭撤销提示" onClick={()=>setRemovedFeature(null)}>×</button></div>}
    {isStatic&&addFeaturesOpen&&<Dialog title="选择添加的配置组（可多选）" close={()=>setAddFeaturesOpen(false)} className="automation-add-dialog"><div className="automation-add-options">{featureOrder.map(key=><label key={key} className="automation-add-option"><input type="checkbox" checked={selectedFeatures.includes(key)} disabled={!!staticConfig.features[key].added} onChange={event=>setSelectedFeatures(current=>event.target.checked?[...current,key]:current.filter(value=>value!==key))}/><span><strong>{featureInfo[key].label}</strong><small>{featureInfo[key].description}</small></span>{staticConfig.features[key].added&&<em>已添加</em>}</label>)}{featureOrder.every(key=>staticConfig.features[key].added)&&<p className="muted">所有可选配置组均已添加。</p>}</div><div className="automation-group-dialog-actions"><button type="button" onClick={()=>setAddFeaturesOpen(false)}>取消</button><button type="button" className="button primary" disabled={!selectedFeatures.length} onClick={()=>{for(const key of selectedFeatures)updateFeature(key,true);const first=selectedFeatures[0];setAddFeaturesOpen(false);setSelectedFeatures([]);if(first)setTimeout(()=>jumpTo(first),0);}}>添加（{selectedFeatures.length}）</button></div></Dialog>}
    {isStatic&&groupEditor&&<Dialog title={groupEditor.mode==='create'?'新建流程配置':'重命名流程配置'} close={()=>setGroupEditor(null)} className="automation-group-dialog">
      <form onSubmit={event=>{event.preventDefault();void submitGroup();}}><label>配置名称<input autoFocus maxLength={40} value={groupName} onChange={event=>setGroupName(event.target.value)} placeholder="例如：骑拉帝纳定点" /></label>{groups.some(group=>group.name===groupName.trim()&&group.id!==groupEditor.id)&&<p className="panel-error" role="alert">配置名称已存在</p>}{error&&<p className="panel-error" role="alert">{error}</p>}<p>新流程仅包含基础设置和基础脚本。</p><div className="automation-group-dialog-actions"><button type="button" onClick={()=>setGroupEditor(null)}>取消</button><button type="submit" className="button primary" disabled={!groupName.trim()||pending||groups.some(group=>group.name===groupName.trim()&&group.id!==groupEditor.id)}>{groupEditor.mode==='create'?'创建':'保存名称'}</button></div></form>
    </Dialog>}
    {isStatic&&groupDeleteId&&<Dialog title="删除流程配置" close={()=>setGroupDeleteId(null)} className="automation-group-dialog"><div className="automation-group-delete"><p>删除“{groups.find(group=>group.id===groupDeleteId)?.name}”及其保存的参数和脚本？</p>{error&&<p className="panel-error" role="alert">{error}</p>}<div className="automation-group-dialog-actions"><button type="button" onClick={()=>setGroupDeleteId(null)}>取消</button><button type="button" className="button danger" disabled={pending} onClick={()=>void deleteGroup()}>删除配置</button></div></div></Dialog>}
  </section>;
}
