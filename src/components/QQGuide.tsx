import { ArrowLeft, ArrowRight, CheckCircle2, Expand, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { qqGuideSteps, type QQGuideStep } from '../qqGuide';
import { Dialog } from './Dialog';

export function QQGuide({ openSetup }: { openSetup: () => void }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [imageError, setImageError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const step = qqGuideSteps[index];
  const [x, y, width, height] = step.crop;
  useEffect(() => {
    setImageError(false);
    const scroller = root.current?.closest('.qq-content');
    if (scroller) scroller.scrollTop = 0;
  }, [index]);
  return <div className="qq-guide" ref={root}>
    <div className="qq-guide-heading"><nav className="qq-guide-steps" aria-label="教程步骤">
      {qqGuideSteps.map((item, number) => <button key={item.image} type="button" aria-label={`第${number + 1}步：${item.title}`} title={item.title}
        aria-current={index === number ? 'step' : undefined} onClick={() => setIndex(number)}>{number + 1}</button>)}
    </nav><a href="https://q.qq.com/#/apps" target="_blank" rel="noreferrer">QQ 开放平台<ExternalLink size={12} /></a></div>
    <div className="qq-guide-navigation"><span>{step.phase} · {index + 1} / {qqGuideSteps.length}</span><button className="button" disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft size={13} />上一步</button><button className="button" disabled={index === qqGuideSteps.length - 1} onClick={() => setIndex(value => value + 1)}>下一步<ArrowRight size={13} /></button></div>
    <section className="qq-guide-step" aria-label={`第${index + 1}步`}>
      <h3>{step.title}</h3>
      <button className="qq-guide-picture" type="button" aria-label={`查看第${index + 1}步原图`} onClick={() => setZoom(true)}>
        <span className="qq-guide-crop" style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(var(--qq-guide-image-height) * ${width / height}))` }}>
          <img key={step.image} src={step.image} alt={`第${index + 1}步：${step.title}`} draggable={false} onError={() => setImageError(true)}
            style={{ width: `${step.size[0] / width * 100}%`, left: `${-x / width * 100}%`, top: `${-y / height * 100}%` }} />
          {step.focus.map(([left, top, w, h], number) => <span key={number} className="qq-guide-focus" aria-hidden="true" style={{ left: `${(left - x) / width * 100}%`, top: `${(top - y) / height * 100}%`, width: `${w / width * 100}%`, height: `${h / height * 100}%` }} />)}
        </span>
        <span className="qq-guide-image-caption"><ZoomIn size={13} />点击查看完整原图 · 可缩放</span>
      </button>
      {imageError && <p className="qq-result-error" role="alert">教程图片加载失败，请重新打开教程。</p>}
      <ol className="qq-guide-actions">{step.actions.map(action => <li key={action}>{action}</li>)}</ol>
      <p className={step.caution ? 'qq-guide-caution' : 'qq-guide-detail'}>{step.detail}</p>
      <p className="qq-guide-result"><CheckCircle2 size={14} />{step.result}</p>
    </section>
    {index < 8 && <button className="qq-text-button" onClick={() => setIndex(8)}>已有机器人，跳到开发设置 →</button>}
    <div className="qq-guide-note"><strong>接下来：验证、绑定和图文测试</strong>
      <ol><li>在接入设置保存 AppID、AppSecret，点击“验证凭据”。按需勾选“记住密钥”。</li>
        <li>点击“绑定私聊”，私聊机器人发送当前六位绑定码；群聊需先添加机器人，再 @机器人发送当前码。绑定码每 60 秒更新。</li>
        <li>勾选接收方，发送图文测试。到 QQ 确认文字和图片均已收到，再点击“我已收到文字和图片”。</li></ol>
      <p>无法收发时，检查开放平台的服务范围、开发体验号码、机器人权限和网络。失败或取消不会自动重发，请先核对 QQ 与发送记录。</p>
    </div>
    <button className="button" onClick={openSetup}>前往接入设置</button>
    {zoom && <GuideImage step={step} index={index} close={() => setZoom(false)} />}
  </div>;
}

function GuideImage({ step, index, close }: { step: QQGuideStep; index: number; close: () => void }) {
  const [scale, setScale] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const changeScale = (factor: number) => {
    const bounds = stage.current;
    const fit = bounds ? Math.min((bounds.clientWidth - 24) / step.size[0], (bounds.clientHeight - 24) / step.size[1], 1) : 1;
    setScale(value => Math.min(3, Math.max(0.1, (value ?? fit) * factor)));
  };
  return <Dialog title="教程原图" close={close} className="qq-image-dialog">
    <div className="qq-image-toolbar"><span>第{index + 1}步 · {step.title}</span><button className="icon-button" aria-label="缩小" disabled={scale !== null && scale <= 0.1} onClick={() => changeScale(1 / 1.25)}><ZoomOut size={16} /></button>
      <span className="qq-image-scale">{scale === null ? '适应' : Math.round(scale * 100) + '%'}</span><button className="icon-button" aria-label="放大" disabled={scale !== null && scale >= 3} onClick={() => changeScale(1.25)}><ZoomIn size={16} /></button>
      <button className="button" onClick={() => setScale(null)}><Expand size={13} />适应窗口</button><button className="button" onClick={() => setScale(1)}>原始尺寸</button></div>
    <div className="qq-image-stage" ref={stage} data-fit={scale === null}><div className="qq-image-canvas"><img src={step.image} alt={`第${index + 1}步完整原图：${step.title}`} draggable={false} style={scale === null ? {} : { width: step.size[0] * scale, height: step.size[1] * scale }} /></div></div>
    <p className="qq-image-footnote">放大后可滚动查看。按 Esc 关闭原图，返回当前教程步骤。</p>
  </Dialog>;
}
