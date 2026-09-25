import { useEffect, useRef, useState } from 'react';
import { downloadText, nativeCandidate, useAutomation, type Candidate } from '../automation';
import { staticResultCells } from '../staticResults';
import { STATIC_COLUMNS } from '../staticTable';

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
  const [tab,setTab]=useState<'rounds'|'logs'>('rounds'),[runId,setRunId]=useState(''),[roundIndex,setRoundIndex]=useState(0);
  const [context,setContext]=useState<{runId:string;round?:number}|null>(null);
  const [source,setSource]=useState('全部来源'),[level,setLevel]=useState('全部级别'),[query,setQuery]=useState(''),[follow,setFollow]=useState(true);
  const scroll=useRef<HTMLDivElement>(null);
  const lastRun=useRef<string|null>(null);
  useEffect(()=>{
    const id=snapshot?.state.runId;
    if(id&&lastRun.current&&id!==lastRun.current){setContext(null);localStorage.removeItem('auto-poke-rng:log-context');}
    if(id)lastRun.current=id;
  },[snapshot?.state.runId]);
  useEffect(()=>{
    const receive=()=>{try{const value=JSON.parse(localStorage.getItem('auto-poke-rng:log-context')||'null');if(value){setContext(value);setTab('logs');setSource('全部来源');setLevel('全部级别');setQuery('');}}catch{/* invalid navigation */}};
    receive();window.addEventListener('auto-poke:related-logs',receive);window.addEventListener('storage',receive);
    return()=>{window.removeEventListener('auto-poke:related-logs',receive);window.removeEventListener('storage',receive);};
  },[]);
  useEffect(()=>{if(follow&&tab==='logs'&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[snapshot?.logs.length,follow,tab]);
  if(!snapshot)return <p role="status">{error||'正在加载日志中心…'}</p>;
  const run=snapshot.runs.find(item=>item.id===runId)||snapshot.runs[0];
  const round=run?.rounds[Math.min(roundIndex,Math.max(0,run.rounds.length-1))];
  const logs=snapshot.logs.filter(row=>(source==='全部来源'||row.source===source)&&(level==='全部级别'||row.level===level)
    &&(!context||(row.runId===context.runId&&(context.round===undefined||row.round===context.round)))
    &&(!query||`${row.message} ${row.source}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const perform=(promise:Promise<unknown>|undefined)=>void promise?.catch(error=>setError(error.message));
  const text=logs.map(row=>`${row.time}\t${row.source}\t${row.level}\t${row.message}`).join('\n');
  const clearContext=()=>{setContext(null);localStorage.removeItem('auto-poke-rng:log-context');};
  return <section className="automation-log-center" aria-label="日志中心内容">
    <nav className="automation-toolbar" aria-label="日志视图"><button aria-pressed={tab==='rounds'} onClick={()=>setTab('rounds')}>轮次记录</button><button aria-pressed={tab==='logs'} onClick={()=>setTab('logs')}>详细日志</button>
      <label><input type="checkbox" checked={snapshot.logging} onChange={event=>perform(api?.setLogging(event.target.checked))}/>自动保存磁盘日志</label></nav>
    {(error||snapshot.error)&&<p role="alert" className="panel-error">{error||snapshot.error}</p>}
    {tab==='rounds'?<div className="automation-records">
      <aside><label>运行记录<select aria-label="运行记录" value={run?.id||''} onChange={event=>{setRunId(event.target.value);setRoundIndex(0);}}>{snapshot.runs.map(item=><option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.kind==='static'?'定点':'TID'}</option>)}</select></label>
        {run?.rounds.map((item,index)=><button className={round===item?'active':''} key={item.number} onClick={()=>setRoundIndex(index)}>第 {item.number} 轮 · {item.outcome}</button>)}
        {!run&&<p className="muted">运行自动流程后，轮次记录会显示在这里。</p>}</aside>
      <div className="automation-record-detail">{round&&<><div className="automation-toolbar"><strong>第 {round.number} 轮 · {round.outcome}</strong>
        <button onClick={()=>{setContext({runId:run.id,round:round.number});setSource('全部来源');setLevel('全部级别');setQuery('');setTab('logs');}}>查看相关日志</button>
        <button onClick={()=>downloadText(JSON.stringify({runId:run.id,...round},null,2),'轮次记录.json','application/json')}>导出记录</button></div>
        <dl className="automation-metrics"><div><dt>Seed</dt><dd>{round.seed||'—'}</dd></div><div><dt>启动帧</dt><dd>{round.trigger??'—'}</dd></div><div><dt>本轮 delay</dt><dd>{round.usedDelay??'—'}</dd></div><div><dt>实际 delay</dt><dd>{round.actualDelays?.join(' / ')||'—'}</dd></div></dl>
        <CandidateTable rows={round.candidates} selected={round.selected} sources={round.sources}/>
        {!!round.reverse?.length&&<details><summary>反查结果</summary><CandidateTable rows={round.reverse}/></details>}
        <details><summary>轮次事件与诊断</summary><pre>{JSON.stringify(round.events,null,2)}</pre></details></>}
        {run?.message&&<p>{run.message}</p>}</div>
    </div>:<>
      <div className="automation-toolbar"><select aria-label="筛选日志来源" value={source} onChange={event=>setSource(event.target.value)}>{['全部来源','系统','自动定点','自动TID','眨眼','OCR','脚本','手柄'].map(value=><option key={value}>{value}</option>)}</select>
        <select aria-label="筛选日志级别" value={level} onChange={event=>setLevel(event.target.value)}><option>全部级别</option><option value="info">信息</option><option value="success">成功</option><option value="warning">警告/错误</option></select>
        <input aria-label="搜索日志" placeholder="搜索日志…" value={query} onChange={event=>setQuery(event.target.value)}/>
        <label><input type="checkbox" checked={follow} onChange={event=>setFollow(event.target.checked)}/>自动跟随</label>
        <button onClick={()=>perform(navigator.clipboard.writeText(text))}>复制</button><button onClick={()=>downloadText(text,'运行日志.txt')}>导出</button>
        <button onClick={()=>perform(api?.clearLogs())}>清空显示</button><span>{logs.length} 条</span>
        {context&&<button onClick={clearContext}>清除轮次筛选</button>}</div>
      <div ref={scroll} className="automation-table-scroll automation-log-lines"><table><thead><tr><th>时间</th><th>来源</th><th>轮次</th><th>内容</th></tr></thead><tbody>{logs.map(row=><tr key={row.id}><td>{row.time}</td><td>{row.source}</td><td>{row.round||'—'}</td><td className={'log-'+row.level}>{row.message}</td></tr>)}</tbody></table>
        {!logs.length&&<p className="muted">当前筛选没有日志。</p>}</div>
    </>}
  </section>;
}
