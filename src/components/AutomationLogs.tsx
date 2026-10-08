import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Download, History, SearchX } from 'lucide-react';
import { downloadText, nativeCandidate, useAutomation, type Candidate } from '../automation';
import { staticResultCells } from '../staticResults';
import { STATIC_COLUMNS } from '../staticTable';
import { isFrlgDiagnosticLog } from '../frlgExecution';
import { FrlgRoundDetails } from './FrlgRoundDetails';
import { AutomationRecordPicker } from './AutomationRecordPicker';

const runKindLabels = { static: '定点', tid: 'TID', frlg: '火叶' };
const runStatusLabels: Record<string, string> = { running: '运行中', completed: '已完成', stopped: '已停止', failed: '失败' };
function runDate(value: string) {
  const date = new Date(value);
  const day = date.toLocaleDateString('zh-CN');
  const time = date.toLocaleTimeString('zh-CN', { hour12: false });
  return { day, time, label: `${date.toDateString() === new Date().toDateString() ? '今天' : day} ${time}` };
}

export function CandidateTable({ rows, selected = -1, sources = [] }: { rows: Candidate[]; selected?: number; sources?: string[] }) {
  const [page,setPage]=useState(0),[selection,setSelection]=useState<number|null>(null),[notice,setNotice]=useState('');
  const last=Math.max(0,Math.ceil(rows.length/50)-1),current=Math.min(page,last);
  const cells=(row:Candidate)=>staticResultCells(nativeCandidate(row),false);
  const all=()=>[['来源',...STATIC_COLUMNS.map(column=>column.label)],...rows.map((row,i)=>[sources[i]==='sync'?'同步':'普通',...cells(row)])].map(row=>row.join('\t')).join('\n');
  return <section className="automation-table"><div className="automation-toolbar"><span>{rows.length} 个候选</span>
    <button type="button" className="text-button" disabled={selection===null||!rows[selection]} onClick={()=>void navigator.clipboard.writeText(cells(rows[selection!]).join('\t')).catch(()=>setNotice('复制失败'))}>复制选中</button>
    <button type="button" className="text-button" onClick={()=>downloadText(all(),'乱数候选.tsv')}>导出全部</button><span role="status">{notice}</span></div>
    <div className="automation-table-scroll"><table><thead><tr><th>来源</th>{STATIC_COLUMNS.map(column=><th key={column.id}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.slice(current*50,current*50+50).map((row,i)=><tr key={i} tabIndex={0} aria-selected={selection===current*50+i} className={current*50+i===selected?'is-target':''} onClick={()=>setSelection(current*50+i)}>
        <td>{sources[current*50+i]==='sync'?'同步':'普通'}</td>{cells(row).map((value,index)=><td key={index}>{value}</td>)}</tr>)}</tbody></table></div>
    {!rows.length&&<p className="muted">暂无候选记录</p>}
    {last>0&&<footer className="automation-toolbar"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页</button></footer>}
  </section>;
}

export function AutomationLogs() {
  const {api,snapshot,error,setError}=useAutomation();
  const [tab,setTab]=useState<'rounds'|'logs'>('rounds'),[runId,setRunId]=useState('');
  const [roundSelection,setRoundSelection]=useState<{runId:string;number:number}|null>(null);
  const [context,setContext]=useState<{runId:string;round?:number}|null>(null);
  const [source,setSource]=useState('全部来源'),[level,setLevel]=useState('全部级别'),[query,setQuery]=useState(''),[follow,setFollow]=useState(true);
  const scroll=useRef<HTMLDivElement>(null);
  const lastRun=useRef<string|null>(null);
  useEffect(()=>{
    const id=snapshot?.runs.at(0)?.id || snapshot?.state.runId;
    if(id&&lastRun.current&&id!==lastRun.current){setContext(null);localStorage.removeItem('auto-poke-rng:log-context');}
    if(id)lastRun.current=id;
  },[snapshot?.state.runId,snapshot?.runs.at(0)?.id]);
  useEffect(()=>{
    const receive=()=>{try{const value=JSON.parse(localStorage.getItem('auto-poke-rng:log-context')||'null');if(value){setContext(value);setTab('logs');setSource('全部来源');setLevel('全部级别');setQuery('');}}catch{/* invalid navigation */}};
    receive();window.addEventListener('auto-poke:related-logs',receive);window.addEventListener('storage',receive);
    return()=>{window.removeEventListener('auto-poke:related-logs',receive);window.removeEventListener('storage',receive);};
  },[]);
  const latestLogId=snapshot?.logs.filter(row=>!isFrlgDiagnosticLog(row.message,row.detailOnly)).at(-1)?.id;
  useEffect(()=>{if(follow&&tab==='logs'&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[latestLogId,follow,tab]);
  if(!snapshot)return <p role="status">{error||'正在加载日志中心…'}</p>;
  const sourceOptions=['全部来源',...new Set(['系统','火叶','ECS','自动定点','自动TID','眨眼','OCR','脚本','手柄','QQ通知',...snapshot.logs.map(row=>row.source)])];
  const run=snapshot.runs.find(item=>item.id===runId)||snapshot.runs[0];
  const selectedIndex=run&&roundSelection?.runId===run.id ? run.rounds.findIndex(item=>item.number===roundSelection.number) : -1;
  const roundIndex=selectedIndex>=0 ? selectedIndex : (run?.rounds.length??0)-1;
  const round=run?.rounds[roundIndex];
  const chooseRound=(index:number)=>{
    if(!run?.rounds[index])return;
    setRoundSelection(index===run.rounds.length-1 ? null : {runId:run.id,number:run.rounds[index].number});
  };
  const pendingCandidates=round?.outcome==='运行中'&&!round.endedAt&&!run?.endedAt&&!['completed','stopped','failed'].includes(run?.status||'');
  const logs=snapshot.logs.filter(row=>!isFrlgDiagnosticLog(row.message,row.detailOnly)&&(source==='全部来源'||row.source===source)&&(level==='全部级别'||row.level===level)
    &&(!context||(row.runId===context.runId&&(context.round===undefined||row.round===context.round)))
    &&(!query||`${row.message} ${row.source} ${row.phase||''} ${row.event||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const perform=(promise:Promise<unknown>|undefined)=>void promise?.catch(error=>setError(error.message));
  const text=logs.map(row=>`${row.time}\t${row.source}\t${row.level}\t${row.phase||''}\t${row.message}`).join('\n');
  const openRunLogs=(number?:number)=>{if(!run)return;setContext({runId:run.id,...(number === undefined ? {} : {round:number})});setSource('全部来源');setLevel('全部级别');setQuery('');setTab('logs');};
  const clearContext=()=>{setContext(null);localStorage.removeItem('auto-poke-rng:log-context');};
  return <section className="automation-log-center" aria-label="日志中心内容">
    <header className="automation-log-header"><nav className="automation-log-tabs" aria-label="日志视图"><button type="button" aria-pressed={tab==='rounds'} onClick={()=>setTab('rounds')}>轮次记录</button><button type="button" aria-pressed={tab==='logs'} onClick={()=>setTab('logs')}>运行日志</button></nav>
      <label className="automation-log-save"><input type="checkbox" aria-label="自动保存磁盘日志" checked={snapshot.logging} onChange={event=>perform(api?.setLogging(event.target.checked))}/>自动保存日志</label></header>
    {(error||snapshot.error)&&<p role="alert" className="panel-error">{error||snapshot.error}</p>}
    {tab==='rounds'?<div className="automation-records">
      {run&&<><div className="automation-run-bar">
        <AutomationRecordPicker label="切换运行记录" value={run.id} onChange={id=>{setRunId(id);setRoundSelection(null);}} options={snapshot.runs.map(item=>({value:item.id,label:`${runKindLabels[item.kind]} · ${runDate(item.startedAt).time}`,group:runDate(item.startedAt).day,description:`${item.context&&'flowName' in item.context ? `${item.context.flowName} · ` : ''}${item.rounds.length} 轮 · ${runStatusLabels[item.status]||item.status||'状态未知'}`}))}>
          <History size={15} aria-hidden="true"/><strong>{runKindLabels[run.kind]}</strong><span className="automation-run-date" title={new Date(run.startedAt).toLocaleString('zh-CN')}>{runDate(run.startedAt).label}</span>
        </AutomationRecordPicker>
        <span className="automation-run-status" data-status={run.status}>{runStatusLabels[run.status]||run.status||'状态未知'} · {run.rounds.length} 轮</span>
      </div>
      {round&&<nav className="automation-round-navigation" aria-label="轮次导航">
        <button type="button" className="automation-record-icon" aria-label="上一轮" title="上一轮" disabled={roundIndex<=0} onClick={()=>chooseRound(roundIndex-1)}><ChevronLeft size={16}/></button>
        <AutomationRecordPicker key={run.id} label="选择轮次" value={String(round.number)} onChange={number=>chooseRound(run.rounds.findIndex(item=>String(item.number)===number))} options={run.rounds.map(item=>({value:String(item.number),label:`第 ${item.number} 轮 · ${item.outcome}`,description:item.frlg ? item.frlg.hitSeed ? `Seed ${item.frlg.hitSeed} · 帧偏差 ${item.frlg.frameError??'—'}` : item.number===0 ? '准备与计时校准' : undefined : undefined}))}>
          <strong>第 {round.number} 轮</strong><span className="automation-round-total">共 {run.rounds.length} 条</span>
        </AutomationRecordPicker>
        <button type="button" className="automation-record-icon" aria-label="下一轮" title="下一轮" disabled={roundIndex===run.rounds.length-1} onClick={()=>chooseRound(roundIndex+1)}><ChevronRight size={16}/></button>
        <span className="automation-round-outcome" role="status">{round.outcome}</span>
        <div className="automation-round-actions">
          {selectedIndex>=0&&<button type="button" className="automation-record-action" onClick={()=>setRoundSelection(null)}>最新一轮</button>}
          {run.kind!=='frlg'&&!!round.candidates.length&&<button type="button" className="automation-record-action" onClick={()=>openRunLogs(round.number)}>查看相关日志</button>}
          <button type="button" className="automation-record-icon" aria-label="导出记录" title="导出本轮记录" onClick={()=>downloadText(JSON.stringify({runId:run.id,...round},null,2),'轮次记录.json','application/json')}><Download size={15}/></button>
        </div>
      </nav>}</>}
      <div className="automation-record-detail">{!run ? <div className="automation-record-empty"><History size={24} aria-hidden="true"/><strong>暂无运行记录</strong><p>运行自动流程后，轮次记录会显示在这里。</p></div> : run.kind==='frlg' ? <FrlgRoundDetails run={run} round={round} logs={snapshot.logs} openLogs={openRunLogs}/> : round ? <>
        <dl className="automation-record-metrics"><div><dt>Seed</dt><dd>{round.seed||'—'}</dd></div><div><dt>启动帧</dt><dd>{round.trigger??'—'}</dd></div><div><dt>本轮 delay</dt><dd>{round.usedDelay??'—'}</dd></div><div><dt>实际 delay</dt><dd>{round.actualDelays?.join(' / ')||'—'}</dd></div></dl>
        {round.candidates.length ? <CandidateTable key={`${run.id}:${round.number}`} rows={round.candidates} selected={round.selected} sources={round.sources}/> : <div className="automation-record-empty" role="status">
          {pendingCandidates ? <Clock3 size={24} aria-hidden="true"/> : <SearchX size={24} aria-hidden="true"/>}
          <strong>{round.outcome==='无候选' ? '本轮没有符合条件的候选' : pendingCandidates ? '候选结果尚未生成' : '本轮没有候选记录'}</strong>
          <p>{pendingCandidates ? '本轮仍在进行，结果会自动更新。' : '可查看本轮日志了解执行结果。'}</p>
          <button type="button" className="automation-record-action" onClick={()=>openRunLogs(round.number)}>查看本轮日志<ArrowUpRight size={14} aria-hidden="true"/></button>
        </div>}
        {!!round.reverse?.length&&<details className="automation-record-diagnostics"><summary>反查结果</summary><CandidateTable key={`${run.id}:${round.number}:reverse`} rows={round.reverse}/></details>}
        <details className="automation-record-diagnostics" key={`${run.id}:${round.number}:events`}><summary>轮次事件与诊断</summary><pre>{JSON.stringify(round.events,null,2)}</pre></details></> : <div className="automation-record-empty"><Clock3 size={24} aria-hidden="true"/><strong>暂无轮次记录</strong><p>{run.status==='running' ? '流程已开始，轮次数据会自动显示。' : '此次运行没有生成轮次记录。'}</p><button type="button" className="automation-record-action" onClick={()=>openRunLogs()}>查看运行日志<ArrowUpRight size={14} aria-hidden="true"/></button></div>}
        {run?.kind!=='frlg'&&run?.message&&<p>{run.message}</p>}</div>
    </div>:<>
      <div className="automation-toolbar automation-log-filters"><select aria-label="筛选日志来源" value={source} onChange={event=>setSource(event.target.value)}>{sourceOptions.map(value=><option key={value}>{value}</option>)}</select>
        <select aria-label="筛选日志级别" value={level} onChange={event=>setLevel(event.target.value)}><option>全部级别</option><option value="info">信息</option><option value="success">成功</option><option value="warning">警告</option><option value="error">错误</option></select>
        <input aria-label="搜索日志" placeholder="搜索日志…" value={query} onChange={event=>setQuery(event.target.value)}/>
        <label><input type="checkbox" checked={follow} onChange={event=>setFollow(event.target.checked)}/>自动跟随</label>
        <button onClick={()=>perform(navigator.clipboard.writeText(text))}>复制</button><button onClick={()=>downloadText(text,'运行日志.txt')}>导出</button>
        <button onClick={()=>perform(api?.clearLogs())}>清空显示</button><span>{logs.length} 条摘要</span><span className="automation-log-hint">阶段诊断按设置写入日志文件</span>
        {context&&<button onClick={clearContext}>清除轮次筛选</button>}</div>
      <div ref={scroll} className="automation-table-scroll automation-log-lines"><table><thead><tr><th>时间</th><th>来源</th><th>阶段</th><th>轮次</th><th>内容</th></tr></thead><tbody>{logs.map(row=><tr key={row.id}><td>{row.time}</td><td>{row.source}</td><td>{row.phase||'—'}</td><td>{row.round??'—'}</td><td className={'log-'+row.level}>{row.message}</td></tr>)}</tbody></table>
        {!logs.length&&<p className="muted">当前筛选没有日志。</p>}</div>
    </>}
  </section>;
}
