import {
  FRLG_HIDDEN_TYPES, FRLG_METHODS, FRLG_NATURES, FRLG_SHININESS, FRLG_STATIC_CATEGORIES, FRLG_WILD_CATEGORIES,
  getFrlgLocationLabel, type FrlgAbilityOption, type FrlgStaticRequest, type FrlgStaticTarget, type FrlgWildTarget,
} from '../frlgAutomation';
import { categoryLabels, gameLabels, methodLabels, natureLabels, shinyLabels, statLabels, typeLabels } from '../frlgLabels';
import type { FrlgSaveProfile } from '../frlgProfile';
import { Dialog } from './Dialog';
import { FrlgSprite } from './FrlgSprite';

type Props = {
  request: FrlgStaticRequest; profile: FrlgSaveProfile; target?: FrlgStaticTarget | FrlgWildTarget;
  targets: (FrlgStaticTarget | FrlgWildTarget)[]; locations: string[]; abilities: FrlgAbilityOption[];
  busy: boolean; diagnostics: string[]; error: string; notice: string;
  onChange: <K extends keyof FrlgStaticRequest>(key: K, value: FrlgStaticRequest[K]) => void;
  onMethod: (method: string) => void; onCategory: (category: string) => void; onLocation: (location: string) => void;
  onIv: (index: number, kind: 'ivMin' | 'ivMax', raw: string) => void;
  onIvPreset: (perfect: boolean) => void;
  onClose: () => void; onSearch: () => void; onCancelSearch: () => void;
};

export function FrlgTargetSettingsDialog({ request, profile, target, targets, locations, abilities, busy, diagnostics, error, notice, onChange, onMethod, onCategory, onLocation, onIv, onIvPreset, onClose, onSearch, onCancelSearch }: Props) {
  const wild = request.method.includes('Wild');
  return <Dialog title="火叶目标与筛选条件" close={onClose} className="automation-target-dialog frlg-target-dialog">
    <div className="automation-target-dialog-body">
      <div className="frlg-search-identity" aria-label="当前搜索目标">
        <span className="frlg-search-sprite"><FrlgSprite species={request.pokemon} shiny={['Star', 'Square', 'Star/Square'].includes(request.shiny)}/></span>
        <div><strong>{target?.displayName || request.pokemon}</strong><span>{request.pokemon} · {wild ? getFrlgLocationLabel(request.location) : categoryLabels[request.category]}</span></div>
        <small>{profile.name} · {gameLabels[profile.game]}</small>
      </div>
      <div className="frlg-search-layout">
        <fieldset disabled={busy} className="frlg-search-main">
          <section className="frlg-search-section" aria-labelledby="frlg-encounter-heading">
            <h3 id="frlg-encounter-heading">遭遇目标</h3>
            <div className={`automation-fields frlg-encounter-fields${wild ? '' : ' is-static'}`}>
              <label>目标宝可梦<select aria-label="火叶自动目标宝可梦" value={request.pokemon} onChange={event => onChange('pokemon', event.target.value)}>{targets.map(item => <option key={item.species} value={item.species}>{item.displayName} · {item.species}</option>)}</select></label>
              {wild && <label>遭遇地点<select aria-label="野生遭遇地点" value={request.location} onChange={event => onLocation(event.target.value)}>{locations.map(location => <option key={location} value={location}>{getFrlgLocationLabel(location)}</option>)}</select></label>}
              <label>{wild ? '遭遇类别' : '分类'}<select aria-label={wild ? '野生遭遇类别' : '静态分类'} value={request.category} onChange={event => onCategory(event.target.value)}>{(wild ? FRLG_WILD_CATEGORIES : FRLG_STATIC_CATEGORIES).map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>
              <label>搜索方法<select aria-label="搜索方法" value={request.method} onChange={event => onMethod(event.target.value)}>{FRLG_METHODS.map(method => <option key={method} value={method}>{methodLabels[method]}</option>)}</select></label>
            </div>
          </section>
          <section className="frlg-search-section" aria-labelledby="frlg-attributes-heading">
            <h3 id="frlg-attributes-heading">属性条件</h3>
            <div className="automation-fields frlg-attribute-fields">
              <label>闪光<select aria-label="闪光筛选" value={request.shiny} onChange={event => onChange('shiny', event.target.value as FrlgStaticRequest['shiny'])}><option value="Any">任意</option>{FRLG_SHININESS.map(value => <option key={value} value={value}>{shinyLabels[value]}</option>)}</select></label>
              <label>性格<select aria-label="性格筛选" value={request.nature} onChange={event => onChange('nature', event.target.value as FrlgStaticRequest['nature'])}><option value="Any">任意</option>{FRLG_NATURES.map(value => <option key={value} value={value}>{natureLabels[value] || value}</option>)}</select></label>
              <label>性别<select aria-label="性别筛选" value={request.gender} onChange={event => onChange('gender', event.target.value as FrlgStaticRequest['gender'])}><option value="Any">任意</option><option value="M">雄性</option><option value="F">雌性</option><option value="-">无性别</option></select></label>
              <label>特性<select aria-label="特性筛选" value={request.ability} onChange={event => onChange('ability', event.target.value)}><option value="Any">任意</option>{abilities.map(option => <option key={option.english} value={option.english}>{option.displayName} · {option.english}</option>)}</select></label>
              <label>隐藏属性<select aria-label="隐藏属性筛选" value={request.hiddenType} onChange={event => onChange('hiddenType', event.target.value as FrlgStaticRequest['hiddenType'])}><option value="Any">任意</option>{FRLG_HIDDEN_TYPES.map(value => <option key={value} value={value}>{typeLabels[value] || value}</option>)}</select></label>
            </div>
          </section>
          <section className="frlg-search-section" aria-labelledby="frlg-iv-heading">
            <div className="frlg-iv-heading"><h3 id="frlg-iv-heading">个体值范围</h3><div><button type="button" onClick={() => onIvPreset(false)}>不限</button><button type="button" onClick={() => onIvPreset(true)}>全部 31</button></div></div>
            <table className="frlg-iv-matrix" aria-label="个体值范围"><thead><tr><td/><th scope="col">HP</th>{statLabels.slice(1).map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{(['ivMin', 'ivMax'] as const).map(kind => <tr key={kind}><th scope="row">{kind === 'ivMin' ? '最低' : '最高'}</th>{statLabels.map((label, index) => <td key={label}><input aria-label={`${label}${kind === 'ivMin' ? '最小' : '最大'}IV`} type="number" min={0} max={31} value={request[kind][index]} onChange={event => onIv(index, kind, event.target.value)}/></td>)}</tr>)}</tbody></table>
          </section>
        </fieldset>
        <fieldset disabled={busy} className="frlg-search-rail" aria-label="火叶自动流程参数">
          <h3>搜索设置</h3>
          <div className="automation-fields frlg-search-rail-fields">
            <label>最小 Advance<input aria-label="最小 Advance" type="number" min={0} value={request.minAdvances} onChange={event => onChange('minAdvances', Number(event.target.value))}/></label>
            <label>最大 Advance<input aria-label="最大 Advance" type="number" min={0} value={request.maxAdvances} onChange={event => onChange('maxAdvances', Number(event.target.value))}/></label>
            <label>Seed 模式<select aria-label="Seed 模式" value={request.seedMode === null ? 'auto' : String(request.seedMode)} onChange={event => onChange('seedMode', event.target.value === 'auto' ? null : Number(event.target.value))}><option value="auto">自动选择</option>{Array.from({length:10}, (_, mode) => <option key={mode} value={mode}>模式 {mode}</option>)}</select></label>
          </div>
          <details className="frlg-search-advanced"><summary>高级设置<span>指定 Seed · 搜索工作量</span></summary><div className="automation-fields frlg-search-rail-fields">
            <label className="frlg-checkbox-field"><span>指定 Seed / Advance</span><input aria-label="指定 Seed / Advance" type="checkbox" checked={request.directMode} onChange={event => onChange('directMode', event.target.checked)}/></label>
            {request.directMode && <label>指定 Seed<input aria-label="指定 Seed" inputMode="text" value={request.directSeed} placeholder="0000-FFFF" onChange={event => onChange('directSeed', event.target.value)}/></label>}
            {request.directMode && <label>指定 Advance<input aria-label="指定 Advance" type="number" min={0} value={request.directAdvances ?? ''} onChange={event => onChange('directAdvances', event.target.value === '' ? null : Number(event.target.value))}/></label>}
            <label>初始 Seed 候选数<input aria-label="初始 Seed 候选数" type="number" min={1} value={request.initialSeedResultCount} onChange={event => onChange('initialSeedResultCount', Number(event.target.value))}/></label>
            <label>搜索工作量上限<input aria-label="搜索工作量上限" type="number" min={1} value={request.maxIvCombinations} onChange={event => onChange('maxIvCombinations', Number(event.target.value))}/></label>
          </div></details>
          <p className="frlg-search-rule">按个体合计与可达 Advance 选择方案</p>
        </fieldset>
      </div>
      {(diagnostics.length > 0 || error) && <p className="panel-error" role="alert">{diagnostics[0] || error}</p>}
      {notice && <p role="status" className="automation-notice">{notice}</p>}
    </div>
    <div className="automation-target-dialog-actions"><span className="muted" role="status">{busy ? '正在搜索方案…' : diagnostics.length ? '参数待检查' : '按当前条件搜索并生成方案'}</span><button type="button" onClick={busy ? onCancelSearch : onClose}>{busy ? '取消搜索' : '取消'}</button><button type="button" className="button primary" disabled={busy || diagnostics.length > 0} onClick={onSearch}>{busy ? '搜索中…' : '搜索并生成方案'}</button></div>
  </Dialog>;
}
