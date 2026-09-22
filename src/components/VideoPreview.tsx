import { useState } from 'react';
import { Camera, CircleHelp, Focus, Image, ImagePlus, MonitorPlay, Play, Save, ScanSearch, Search, Tag, Tags } from 'lucide-react';

export function VideoLabelsButton({ expanded, toggle }: { expanded: boolean; toggle: () => void }) {
  return <button className={'icon-button ' + (expanded ? 'active' : '')} title="标签" aria-label="标签"
    aria-expanded={expanded} onClick={toggle}><Tags size={15} /></button>;
}

export function VideoPreview({ labelsOpen = false }: { labelsOpen?: boolean }) {
  return <section className="video-preview-content" aria-label="视频画面" data-labels-open={labelsOpen}>
    {!labelsOpen && <div className="preview-stage">
      <div className="preview-frame"><MonitorPlay size={28} /><strong>等待视频源连接</strong></div>
    </div>}
    <div className="image-label-content" hidden={!labelsOpen}><ImageLabelWorkspace /></div>
  </section>;
}

function ImageLabelWorkspace() {
  const [mode, setMode] = useState<'range' | 'target' | null>(null);
  const [notice, setNotice] = useState('');
  const previewAction = (name: string) => setNotice(name + '功能将在后续接入。');

  return <div className="image-label-workspace" aria-label="图像标签工作区">
    <div className="image-label-grid">
      <section className="label-snapshot-section" aria-label="截图静态帧">
        <header className="label-section-heading"><h4><Image size={14} />截图画布</h4><span>静态帧</span></header>
        <div className="label-snapshot-stage">
          <div className="label-snapshot-frame">
            <ImagePlus size={30} /><strong>尚未截图</strong><p>从右侧实时画面截取一帧，在这里圈选与标注</p>
          </div>
        </div>
        <div className="label-canvas-caption"><span>左键移动 · 滚轮缩放 · 右键圈选</span><span>100%</span></div>
      </section>

      <section className="label-monitor-section" aria-label="实时视频监视器">
        <header className="label-section-heading"><h4><MonitorPlay size={14} />实时画面</h4></header>
        <div className="label-monitor-stage">
          <div className="label-monitor-frame"><MonitorPlay size={26} /><strong>等待视频源连接</strong></div>
        </div>
      </section>

      <section className="label-edit-section" aria-label="图像标签编辑">
        <div className="label-action-bar" role="toolbar" aria-label="截图与圈选工具">
          <button className="button" onClick={() => previewAction('截图')}><Camera size={14} />截图</button>
          <button className={'button label-selection-button range ' + (mode === 'range' ? 'active' : '')} aria-pressed={mode === 'range'} title="红框：圈选搜索范围" onClick={() => setMode(value => value === 'range' ? null : 'range')}><span className="label-color-dot" />搜索范围</button>
          <button className={'button label-selection-button target ' + (mode === 'target' ? 'active' : '')} aria-pressed={mode === 'target'} title="绿框：圈选搜索目标" onClick={() => setMode(value => value === 'target' ? null : 'target')}><span className="label-color-dot" />搜索目标</button>
          <button className="button" onClick={() => previewAction('搜索测试')}><ScanSearch size={14} />搜索测试</button>
          <button className="button" onClick={() => previewAction('动态测试')}><Play size={13} />动态测试</button>
          <button className="button" onClick={() => previewAction('保存标签')}><Save size={14} />保存标签</button>
          <button className="button" onClick={() => previewAction('打开截图')}><ImagePlus size={14} />打开截图</button>
        </div>
        <div className="label-parameters">
          <header className="label-section-heading"><h4>搜索参数</h4><span>{mode === 'range' ? '搜索范围 · 红框' : mode === 'target' ? '搜索目标 · 绿框' : '选择圈选工具'}</span></header>
          <div className="label-parameter-body">
            <div className="label-form-fields">
              <label><span>标签名称</span><input type="text" placeholder="输入标签名称" aria-label="标签名称" /></label>
              <label><span>搜索方法</span><select aria-label="搜索方法" defaultValue=""><option value="" disabled>选择搜索方法</option><option value="template">模板匹配</option><option value="color">颜色匹配</option></select></label>
              <label><span>最低匹配度</span><div className="label-threshold"><input type="number" aria-label="最低匹配度" min={0} max={100} defaultValue={95} /><span>%</span></div></label>
            </div>
            <section className="label-match-preview" aria-label="动态测试对照">
              <div className="label-match-comparison">
                <figure><figcaption>实时区域</figcaption><div className="label-region-placeholder"><MonitorPlay size={20} /><span>等待实时画面</span></div></figure>
                <figure><figcaption>标签截图</figcaption><div className="label-region-placeholder"><Focus size={20} /><span>等待标签截图</span></div></figure>
              </div>
              <dl><div><dt>匹配度</dt><dd>—</dd></div><div><dt>耗时</dt><dd>— <small>ms</small></dd></div><div><dt>最大匹配度</dt><dd>—</dd></div></dl>
            </section>
          </div>
          <div className="label-coordinates">
            <Coordinates title="目标位置" kind="target" />
            <Coordinates title="搜索范围" kind="range" />
          </div>
        </div>
      </section>

      <div className="label-reference-section">
        <section className="label-library" aria-label="搜图标签">
          <header className="label-section-heading"><h4><Tag size={14} />搜图标签</h4><span>0</span></header>
          <div className="label-list-search"><Search size={13} /><input type="search" aria-label="搜索图像标签" placeholder="搜索标签…" /></div>
          <div className="label-library-items" aria-label="标签列表" tabIndex={0}>
            <div className="label-library-empty"><Tags size={24} /><strong>还没有标签</strong><span>保存后在这里选择标签</span></div>
          </div>
          <p className="label-library-hint">双击标签可加载到画布</p>
        </section>
        <section className="label-instructions" aria-label="标注说明">
          <header className="label-section-heading"><h4><CircleHelp size={14} />标注步骤</h4></header>
          <ol>
            <li><span>01</span><div><strong>截取画面</strong><p>从右上角实时画面截图，左侧保留静态帧。</p></div></li>
            <li><span className="range">02</span><div><strong>圈选搜索范围</strong><p>用红框限定在哪一片区域搜索。</p></div></li>
            <li><span className="target">03</span><div><strong>圈选搜索目标</strong><p>用绿框标出需要识别的图像。</p></div></li>
            <li><span>04</span><div><strong>测试并保存</strong><p>检查匹配结果，命名并保存标签。</p></div></li>
          </ol>
        </section>
      </div>
    </div>
    <footer className="label-workspace-note" role="status">{notice || '截图、图像识别与标签保存功能待接入。'}</footer>
  </div>;
}

function Coordinates({ title, kind }: { title: string; kind: 'range' | 'target' }) {
  return <fieldset><legend><span className={'label-color-dot ' + kind} />{title}</legend><div>
    {['X', 'Y', '宽', '高'].map(label => <label key={label}><span>{label}</span><input type="number" aria-label={title + ' ' + label} min={0} defaultValue={0} /></label>)}
  </div></fieldset>;
}
