import { STATIC_COLUMNS } from '../staticTable';
import { Dialog } from './Dialog';

export function StaticTableSettings({ hidden, onChange, close }: { hidden: string[]; onChange: (hidden: string[]) => void; close: () => void }) {
  return <Dialog title="表格设置" close={close} className="static-columns-dialog">
    <div className="bdsp-tool-body">
      <p className="bdsp-tool-hint">选择表格中显示的属性列。复制与导出仍包含全部属性。</p>
      <div className="static-column-options">{STATIC_COLUMNS.map(column => <label className="static-check" key={column.id}>
        <input type="checkbox" checked={!hidden.includes(column.id)} disabled={column.id === 'advances'} onChange={event => onChange(event.target.checked ? hidden.filter(id => id !== column.id) : [...hidden, column.id])} />{column.label}
      </label>)}</div>
      <footer className="bdsp-tool-actions"><button className="button" type="button" onClick={() => onChange([])}>显示全部列</button><button className="button primary" type="button" onClick={close}>完成</button></footer>
    </div>
  </Dialog>;
}
