import { useState } from 'react';
import { downloadText, nativeCandidate, type Candidate } from '../automation';
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
