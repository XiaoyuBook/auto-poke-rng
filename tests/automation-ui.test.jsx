// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRequire } from 'node:module';
import { AutomationWorkspace } from '../src/components/AutomationWorkspace';
import { AutomationLogs } from '../src/components/AutomationLogs';
import { FrlgBingoBoard } from '../src/components/FrlgBingoBoard';
import { OcrWorkspace } from '../src/components/OcrWorkspace';
import { defaultBdspProfile } from '../src/bdspProfile';
import { newBlinkConfig } from '../src/blink';
const { defaults } = createRequire(import.meta.url)('../electron/automation-store.cjs');
HTMLDialogElement.prototype.showModal ||= function(){this.open=true;};
HTMLDialogElement.prototype.close ||= function(){this.open=false;};
afterEach(()=>{cleanup();delete window.desktop;localStorage.clear();});
function fixture(){
  const config=defaults();
  const snapshot={config,staticGroups:{activeId:'default',items:[{id:'default',name:'默认流程',config:structuredClone(config.static)}]},profiles:{},logs:[],runs:[],logging:true,error:'',state:{status:'idle',revision:0,progress:null,message:'等待开始'}};
  const api={getState:vi.fn(async()=>snapshot),onState:vi.fn(()=>()=>{}),save:vi.fn(async()=>snapshot),check:vi.fn(async()=>({ready:false,checks:[{label:'视频源',ok:false,detail:'请先连接'}]})),start:vi.fn(),stop:vi.fn(),clearLogs:vi.fn(),setLogging:vi.fn(),delayEstimate:vi.fn(async ({config,samples})=>({value:config.baseline_delay,effective_strategy:config.strategy,valid_round_count:0,candidate_count:0,used_fallback:config.strategy!=='fixed',sample_statuses:samples.map(()=> 'used'),used_round_numbers:[]})),delay:vi.fn(async()=>snapshot)};
  window.desktop={automation:api,scripts:{list:vi.fn(async()=>({files:[],folders:[],warnings:[]}))}};
  return {snapshot,api};
}

test('starter built-in mode removes script pickers and saves the complete automatic draft',async()=>{
  const {api,snapshot}=fixture();
  api.save.mockImplementation(async({values})=>{snapshot.config.static=structuredClone(values);return structuredClone(snapshot);});
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  const checkbox=await screen.findByRole('checkbox',{name:'御三家全自动'});
  fireEvent.click(checkbox);
  for(const label of ['测种脚本','过帧脚本','撞帧脚本','反查脚本'])expect(screen.queryByLabelText(label)).toBeNull();
  expect(screen.getByText(/时序采用图示配置/).textContent).toContain('41 / 48');
  expect(screen.getByText(/目标前固定 200 帧/).textContent).toContain('本轮 delay');
  expect(screen.queryByText('校正与补救 · 高级设置')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'保存配置'}));
  await waitFor(()=>expect(api.save).toHaveBeenCalledWith(expect.objectContaining({scope:'config',values:expect.objectContaining({parameters:expect.objectContaining({starter_automation:true,start:'script'})})})));
  await waitFor(()=>expect(screen.getByRole('checkbox',{name:'御三家全自动'}).disabled).toBe(false));
  fireEvent.click(screen.getByRole('checkbox',{name:'御三家全自动'}));
  expect(screen.getByLabelText('测种脚本')).toBeTruthy();
});
test('C01: one save persists the complete static draft',async()=>{
  const {api}=fixture();
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  await screen.findByRole('button',{name:'保存配置'});
  fireEvent.click(screen.getByRole('button',{name:/设置 delay 策略/}));
  fireEvent.change(screen.getByLabelText('固定 delay'),{target:{value:'1452'}});
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'应用'}));
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'保存配置'}));
  await waitFor(()=>expect(api.save).toHaveBeenCalledWith(expect.objectContaining({scope:'config',expectedId:'default',values:expect.objectContaining({delayConfig:expect.objectContaining({baseline_delay:1452})})})));
  expect(api.start).not.toHaveBeenCalled();
  expect(api.save).toHaveBeenCalledTimes(1);
});
test('delay dialog shows strategy controls and discards changes on cancel',async()=>{
  const {api}=fixture();
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:/设置 delay 策略/}));
  expect(screen.getByRole('dialog',{name:'delay 策略'})).toBeTruthy();
  expect(screen.queryByLabelText('多候选处理')).toBeNull();
  expect(screen.queryByLabelText('有效样本窗口')).toBeNull();
  expect(screen.queryByRole('button',{name:'上一页'})).toBeNull();
  expect(screen.getByRole('tab',{name:'历史样本（0）'})).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab',{name:'策略设置'}),{key:'ArrowRight'});
  expect(screen.getByRole('tab',{name:'历史样本（0）'}).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab',{name:'历史样本（0）'}),{key:'ArrowLeft'});
  expect(screen.getByRole('tab',{name:'策略设置'}).getAttribute('aria-selected')).toBe('true');
  fireEvent.change(screen.getByLabelText('计算策略'),{target:{value:'last'}});
  expect(screen.queryByLabelText('多候选处理')).toBeNull();
  fireEvent.change(screen.getByLabelText('计算策略'),{target:{value:'mode'}});
  expect(screen.getByLabelText('多候选处理')).toBeTruthy();
  expect(screen.getByLabelText('有效样本窗口')).toBeTruthy();
  expect(screen.queryByLabelText('新样本权重')).toBeNull();
  fireEvent.change(screen.getByLabelText('计算策略'),{target:{value:'ema'}});
  expect(screen.getByLabelText('新样本权重')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('计算策略'),{target:{value:'dense_interval'}});
  expect(screen.getByLabelText('密集区间跨度')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(screen.queryByRole('dialog',{name:'delay 策略'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/设置 delay 策略/}));
  expect(screen.getByLabelText('计算策略').value).toBe('fixed');
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  fireEvent.click(screen.getByText('校正与补救 · 高级设置'));
  expect(screen.queryByLabelText('补救测种最大尝试')).toBeNull();
  fireEvent.change(screen.getByLabelText('校正失败处理'),{target:{value:'recapture_seed'}});
  expect(screen.getByLabelText('补救测种最大尝试')).toBeTruthy();
});
test('invalid delay draft cannot be applied and does not retain the previous estimate',async()=>{
  fixture();
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:/设置 delay 策略/}));
  await waitFor(()=>expect(screen.getByRole('dialog',{name:'delay 策略'}).querySelector('.automation-delay-preview p').textContent).toBe('固定值 · 每轮使用'));
  fireEvent.change(screen.getByLabelText('固定 delay'),{target:{value:''}});
  expect(screen.getByRole('button',{name:'应用'}).disabled).toBe(true);
  expect(screen.getByText('请输入 0–1,000,000,000 帧的整数')).toBeTruthy();
});
test('shared delay samples change immediately and clearing names the cross-flow impact',async()=>{
  const {api,snapshot}=fixture();
  const species=387;
  snapshot.profiles[String(species)]={config:structuredClone(snapshot.config.static.delayConfig),samples:[{round_number:1,candidates:[123],observed_at:'2026-09-27T00:00:00Z',excluded:false}],next_round_number:2};
  api.delay.mockImplementation(async ({action,number,excluded})=>{
    const samples=snapshot.profiles[String(species)].samples;
    if(action==='exclude')samples.find(sample=>sample.round_number===number).excluded=excluded;
    if(action==='clear')snapshot.profiles[String(species)].samples=[];
    return structuredClone(snapshot);
  });
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:/设置 delay 策略/}));
  fireEvent.click(screen.getByRole('tab',{name:'历史样本（1）'}));
  fireEvent.click(screen.getByRole('button',{name:'排除'}));
  await waitFor(()=>expect(api.delay).toHaveBeenCalledWith({species,action:'exclude',number:1,excluded:true}));
  expect(await screen.findByRole('button',{name:'恢复'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'清空共享样本'}));
  expect(screen.getByText(/这会影响使用该宝可梦的所有流程/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'保留样本'}));
  expect(api.delay).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'清空共享样本'}));
  fireEvent.click(screen.getByRole('button',{name:'确认清空'}));
  await waitFor(()=>expect(api.delay).toHaveBeenCalledWith({species,action:'clear'}));
  expect(await screen.findByRole('tab',{name:'历史样本（0）'})).toBeTruthy();
  expect(api.save).not.toHaveBeenCalled();
});
test('static workflow uses its selected default blink config and lets exit inherit it',async()=>{
  const {api,snapshot}=fixture();
  api.save.mockImplementation(async ({values})=>{snapshot.config.static=structuredClone(values);return snapshot;});
  const current={...newBlinkConfig(),name:'当前配置'};
  const saved={...newBlinkConfig(),name:'定点测种'};
  const exit={...newBlinkConfig(),name:'过场后测种'};
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={current} blinkConfigs={[saved,exit]} openLogs={()=>{}} />);
  expect((await screen.findByLabelText('默认测种配置')).querySelector('option[value=""]').textContent).toBe(current.name);
  fireEvent.change(await screen.findByLabelText('默认测种配置'),{target:{value:saved.name}});
  fireEvent.click(screen.getByRole('button',{name:'开始前检查'}));
  await waitFor(()=>expect(api.check).toHaveBeenCalledWith(expect.objectContaining({blink:saved,exitBlink:undefined})));
  fireEvent.click(screen.getByRole('button',{name:'添加配置组'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/过场/}));
  fireEvent.click(screen.getByRole('button',{name:'添加（1）'}));
  expect(screen.getByLabelText('过场测种配置').querySelector('option[value=""]').textContent).toBe(saved.name);
  fireEvent.change(screen.getByLabelText('默认测种配置'),{target:{value:''}});
  expect(screen.getByLabelText('过场测种配置').querySelector('option[value=""]').textContent).toBe(current.name);
  fireEvent.change(screen.getByLabelText('默认测种配置'),{target:{value:saved.name}});
  fireEvent.change(screen.getByLabelText('过场测种配置'),{target:{value:exit.name}});
  fireEvent.click(screen.getByRole('button',{name:'开始前检查'}));
  await waitFor(()=>expect(api.check).toHaveBeenLastCalledWith(expect.objectContaining({blink:saved,exitBlink:exit})));
});
test('a deleted default blink config stops the workflow instead of silently using the current one',async()=>{
  const {api,snapshot}=fixture();
  snapshot.config.static.parameters.blink_name='已删除';
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:'开始前检查'}));
  await screen.findByText('所选默认测种配置已不可用，请重新选择');
  expect(api.check).not.toHaveBeenCalled();
});
test('optional groups become active when configured and can be removed and restored',async()=>{
  fixture();
  window.desktop.scripts.list.mockResolvedValue({files:[{path:'BDSP/reverse.txt'}],folders:[],warnings:[]});
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:'添加配置组'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/自动反查/}));
  fireEvent.click(screen.getByRole('checkbox',{name:/过场/}));
  fireEvent.click(screen.getByRole('button',{name:'添加（2）'}));
  expect(screen.getByRole('region',{name:'自动反查'})).toBeTruthy();
  expect(screen.getByRole('region',{name:'过场'})).toBeTruthy();
  expect(screen.queryByRole('checkbox',{name:'启用自动反查'})).toBeNull();
  expect(screen.getByRole('region',{name:'自动反查'}).textContent).toContain('待配置');
  fireEvent.focus(screen.getByLabelText('反查脚本'));
  await waitFor(()=>expect(screen.getByLabelText('反查脚本').querySelector('option[value="BDSP/reverse.txt"]')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('反查脚本'),{target:{value:'BDSP/reverse.txt'}});
  expect(screen.getByRole('region',{name:'自动反查'}).textContent).toContain('已配置');
  expect(screen.getByRole('button',{name:'移除自动反查'}).closest('aside').getAttribute('aria-label')).toBe('配置组');
  expect(screen.getByRole('region',{name:'自动反查'}).querySelector('[aria-label="移除自动反查"]')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'移除自动反查'}));
  expect(screen.queryByRole('region',{name:'自动反查'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  expect(screen.getByRole('region',{name:'自动反查'})).toBeTruthy();
});
test('sync strategy hides the fixed lead while dynamic sync is enabled',async()=>{
  fixture();
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:'添加配置组'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/同步策略/}));
  fireEvent.click(screen.getByRole('button',{name:'添加（1）'}));
  expect(screen.getByText('队首特性')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('同步模式'),{target:{value:'2'}});
  expect(screen.queryByText('队首特性')).toBeNull();
  expect(screen.getByLabelText('同步性格')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('同步模式'),{target:{value:'0'}});
  expect(screen.getByText('队首特性')).toBeTruthy();
  expect(screen.queryByLabelText('同步性格')).toBeNull();
});
test('failed complete save preserves the current draft and prevents a workflow switch',async()=>{
  const {api,snapshot}=fixture();
  snapshot.staticGroups.items.push({id:'second',name:'第二套',config:structuredClone(snapshot.config.static)});
  api.save.mockRejectedValueOnce(Error('磁盘写入失败'));
  api.manageStaticGroup=vi.fn();
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.change(await screen.findByLabelText('搜索范围'),{target:{value:'700'}});
  fireEvent.change(screen.getByLabelText('流程配置'),{target:{value:'second'}});
  await screen.findByText('磁盘写入失败');
  expect(api.manageStaticGroup).not.toHaveBeenCalled();
  expect(screen.getByLabelText('搜索范围').value).toBe('700');
});
test('C02: preparation is read only and exposes failed checks',async()=>{
  const {api}=fixture();
  render(<AutomationWorkspace kind="tid" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:'开始前检查'}));
  await screen.findByText('请先连接');
  expect(api.start).not.toHaveBeenCalled();expect(api.save).not.toHaveBeenCalled();
});
test('TID goal editor saves only targets and leaves other parameter drafts intact',async()=>{
  const {api,snapshot}=fixture();
  api.save.mockImplementation(async ({values})=>{snapshot.config.tid.parameters.target_display_tids=[...values.target_display_tids];return structuredClone(snapshot);});
  render(<AutomationWorkspace kind="tid" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} onSwitchKind={()=>{}} />);
  await screen.findByRole('region',{name:'当前 TID 目标'});
  expect(screen.getByText('暂无目标 TID')).toBeTruthy();
  expect(screen.queryByRole('complementary',{name:'配置组'})).toBeNull();
  expect(screen.queryByLabelText('目标 Display TID')).toBeNull();
  fireEvent.change(screen.getByLabelText('TID 搜索范围'),{target:{value:'600'}});
  fireEvent.click(within(screen.getByRole('region',{name:'当前 TID 目标'})).getByRole('button',{name:'目标设置'}));
  const dialog=screen.getByRole('dialog',{name:'目标 Display TID'});
  fireEvent.change(within(dialog).getByRole('textbox',{name:'目标 Display TID'}),{target:{value:'123456 123213'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'添加目标'}));
  expect(within(dialog).getByRole('button',{name:'移除目标 123456'})).toBeTruthy();
  expect(within(dialog).getByRole('button',{name:'移除目标 123213'})).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:'保存目标'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'目标 Display TID'})).toBeNull());
  const targetCard=within(screen.getByRole('region',{name:'当前 TID 目标'}));
  expect(within(targetCard.getByRole('list',{name:'目标号码'})).getAllByRole('listitem').map(item=>item.textContent)).toEqual(['123456','123213']);
  expect(api.save).toHaveBeenCalledWith({kind:'tid',scope:'parameters',values:{target_display_tids:[123456,123213]}});
  expect(screen.getByLabelText('TID 搜索范围').value).toBe('600');
  expect(snapshot.config.tid.parameters.frame_threshold).toBe(300);
  fireEvent.click(within(screen.getByRole('region',{name:'当前 TID 目标'})).getByRole('button',{name:'目标设置'}));
  fireEvent.change(screen.getByRole('textbox',{name:'目标 Display TID'}),{target:{value:'654321'}});
  fireEvent.click(screen.getByRole('button',{name:'添加目标'}));
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(within(screen.getByRole('region',{name:'当前 TID 目标'})).queryByText('654321')).toBeNull();
});
test('TID target card shows a leading-zero single target',async()=>{
  const {snapshot}=fixture();
  snapshot.config.tid.parameters.target_display_tids=[1234];
  render(<AutomationWorkspace kind="tid" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} onSwitchKind={()=>{}} />);
  const targetCard=within(await screen.findByRole('region',{name:'当前 TID 目标'}));
  expect(targetCard.getByText('目标 TID')).toBeTruthy();
  expect(targetCard.getByText('显示 ID · 1 个目标')).toBeTruthy();
  expect(targetCard.getByRole('listitem').textContent).toBe('001234');
  expect(targetCard.queryByRole('button',{name:/查看全部/})).toBeNull();
});
test('TID target card offers a read-only list of every configured target while running',async()=>{
  const {snapshot}=fixture();
  snapshot.config.tid.parameters.target_display_tids=[123456,123213,654321,7,8,9,10,11,1234];
  snapshot.state={...snapshot.state,kind:'tid',status:'running'};
  render(<AutomationWorkspace kind="tid" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} onSwitchKind={()=>{}} />);
  const targetCard=within(await screen.findByRole('region',{name:'当前 TID 目标'}));
  expect(targetCard.getByRole('button',{name:'目标设置'}).disabled).toBe(true);
  expect(within(targetCard.getByRole('list',{name:'目标号码'})).getAllByRole('listitem').map(item=>item.textContent)).toEqual(['123456','123213','654321','000007','000008','000009']);
  fireEvent.click(targetCard.getByRole('button',{name:'查看全部 9 个目标'}));
  const dialog=screen.getByRole('dialog',{name:'全部目标 TID（9 个）'});
  expect(within(dialog).getAllByRole('listitem').map(item=>item.textContent)).toEqual(['123456','123213','654321','000007','000008','000009','000010','000011','001234']);
  expect(within(dialog).queryByRole('button',{name:'保存目标'})).toBeNull();
});
test('L01/L03: record navigation filters detailed logs to the selected run and round',async()=>{
  const {snapshot}=fixture();
  snapshot.runs=[{id:'r1',kind:'static',startedAt:'2026-09-25T10:00:00Z',rounds:[{number:1,outcome:'无候选',candidates:[],events:[]}]}];
  snapshot.logs=[{id:'a',time:'10:00',source:'自动定点',level:'info',message:'current round',runId:'r1',round:1},{id:'b',time:'10:00',source:'自动定点',level:'info',message:'other round',runId:'r1',round:2}];
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button',{name:'查看相关日志'}));
  expect(screen.getByText('current round')).toBeTruthy();expect(screen.queryByText('other round')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'清除轮次筛选'}));
  expect(screen.getByText('other round')).toBeTruthy();
});

test('L04: FRLG runs expose lifecycle and ECS sources with phase and error filters',async()=>{
  const {snapshot}=fixture();
  snapshot.runs=[{id:'frlg-1',kind:'frlg',startedAt:'2026-09-25T10:00:00Z',status:'failed',message:'火叶流程失败',rounds:[]}];
  snapshot.logs=[
    {id:'l1',time:'10:00:01',source:'火叶',level:'info',message:'正在准备',phase:'准备',runId:'frlg-1'},
    {id:'l2',time:'10:00:02',source:'ECS',level:'error',message:'标签读取失败',phase:'ECS 执行',runId:'frlg-1'},
    {id:'l3',time:'10:00:03',source:'火叶',level:'info',message:'阶段完成：wild.data.candidate_range',phase:'ECS 执行',runId:'frlg-1',detailOnly:true},
  ];
  render(<AutomationLogs />);
  fireEvent.click(await screen.findByRole('button',{name:'查看火叶运行日志'}));
  expect(screen.getByText('标签读取失败')).toBeTruthy();
  expect(screen.queryByText('阶段完成：wild.data.candidate_range')).toBeNull();
  expect(screen.getByText('ECS 执行')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox',{name:'筛选日志来源'}),{target:{value:'ECS'}});
  expect(screen.getByText('标签读取失败')).toBeTruthy();
  expect(screen.queryByText('正在准备')).toBeNull();
  fireEvent.change(screen.getByRole('combobox',{name:'筛选日志级别'}),{target:{value:'error'}});
  expect(screen.getByText('标签读取失败')).toBeTruthy();
});

test('FRLG rounds default to latest, update live, and scope logs to round zero', async()=>{
  const {snapshot,api}=fixture();
  snapshot.runs=[{id:'frlg-1',kind:'frlg',startedAt:'2026-10-03T02:00:00Z',status:'running',context:{game:'frlg',target:'Pikachu',profileId:'save-a'},rounds:[
    {number:0,outcome:'已结束',candidates:[],events:[],frlg:{}},
    {number:1,outcome:'已反查',candidates:[],events:[],frlg:{request:{seedMs:1200,f1:10,tv:314,f2:20},hitSeed:'7422',seedOffset:-1,hitFrame:25295,frameError:-1,nextRequest:{seedMs:1205,f1:10,tv:314,f2:21}}}
  ]}];
  snapshot.logs=[{id:'a',time:'10:00',source:'ECS',level:'info',message:'第零轮环境检查',runId:'frlg-1',round:0},{id:'b',time:'10:01',source:'ECS',level:'info',message:'第一轮结果',runId:'frlg-1',round:1}];
  render(<AutomationLogs/>);
  const detail=await screen.findByRole('region',{name:'火叶轮次详情'});
  expect(within(detail).getByText('7422')).toBeTruthy();
  expect(within(detail).getByText('1200 ms')).toBeTruthy();
  expect(within(detail).getByText('1205 ms')).toBeTruthy();
  await act(async()=>api.onState.mock.calls[0][0]({...snapshot,runs:[{...snapshot.runs[0],rounds:[...snapshot.runs[0].rounds,{number:2,outcome:'运行中',candidates:[],events:[],frlg:{request:{seedMs:1300}}}]}]}));
  expect(within(detail).getByText('1300 ms')).toBeTruthy();
  expect(within(detail).queryByText('7422')).toBeNull();
  await act(async()=>api.onState.mock.calls[0][0]({...snapshot,runs:[{...snapshot.runs[0],rounds:[...snapshot.runs[0].rounds,{number:2,outcome:'校准跳过',endedAt:'2026-10-03T01:00:00Z',candidates:[],events:[],frlg:{result:'校准跳过',notes:['本轮结果波动较大，参数保持不变']}}]}]}));
  expect(within(detail).getByText('本轮反查后跳过校准，未输出完整落点；具体原因见校准判断。')).toBeTruthy();
  expect(within(detail).queryByText(/等待本轮捕获与反查结果/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/第 0 轮 · 已结束/}));
  fireEvent.click(screen.getByRole('button',{name:'查看火叶运行日志'}));
  expect(screen.getByText('第零轮环境检查')).toBeTruthy();
  expect(screen.queryByText('第一轮结果')).toBeNull();
  expect(screen.getByRole('cell',{name:'0'})).toBeTruthy();
});

test('BINGO renders an interactive distribution and explicitly shows out-of-chart hits',async()=>{
  const axis=[-4,-3,-2,-1,0,1,2,3,4];
  const state={status:'running',runId:'frlg-1',profileId:'save-a',message:'执行中',logs:[],bingo:{version:1,observed:true,axis,seedText:[],grid:axis.map(seed=>axis.map(frame=>({seed,frame,count:seed===1&&frame===-1?12:0,marker:'．'}))),prediction:{seed:1,seedRadius:1,frame:-1,frameRadius:1},current:{seed:1,frame:-1,hitSeed:1,hitFrame:-1,inRange:true,inDeadZone:false},context:{enterTv:false},stable:{result:false},count:12,tv:{enabled:false}}};
  const {rerender}=render(<FrlgBingoBoard key="frlg-1" state={state.bingo} startedRounds={19}/>);
  await screen.findByText('本轮已计入');
  expect(screen.queryByRole('table')).toBeNull();
  const point=screen.getByRole('button',{name:'Seed 偏差 +1，帧偏差 -1，累计命中 12 次，本轮落点'});
  fireEvent.keyDown(point,{key:'Enter'});
  expect(screen.getByText('选中落点 · Seed +1 / 帧 -1 · 累计 12 次')).toBeTruthy();
  rerender(<FrlgBingoBoard key="frlg-1" state={{...state.bingo,current:{...state.bingo.current,seed:7,hitSeed:7,inRange:false}}} startedRounds={19}/>);
  expect(screen.getByText(/本轮落点在图外/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:/本轮落点$/})).toBeNull();
  const tvBingo={...state.bingo,grid:axis.map(seed=>axis.map(frame=>({seed,frame,count:seed===1&&frame===0?6:0,marker:'．'}))),context:{enterTv:true,tvFrameCost:314},current:{...state.bingo.current,frame:0,hitFrame:314},tv:{enabled:true,current:1,prediction:1,radius:2,cells:axis.map(frame=>({frame,count:frame===0?9:frame===1?8:0,marker:'．'}))}};
  rerender(<FrlgBingoBoard key="frlg-1" state={tvBingo} startedRounds={19}/>);
  expect(screen.getByText('本次运行已开始 19 轮（含当前轮）')).toBeTruthy();
  expect(screen.getByText('有效样本 17 次')).toBeTruthy();
  expect(screen.getByText(/样本数有重叠，不能相加作为总轮数/)).toBeTruthy();
  expect(screen.getByText(/本轮帧偏差拆分：\+314 帧 = \+1 周期 × 314 帧 \+ \(0 帧\)/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'Seed 偏差 +1，剩余帧偏差 0，累计命中 6 次，本轮落点'})).toBeTruthy();
  rerender(<FrlgBingoBoard key="different-run" state={tvBingo}/>);
  expect(screen.queryByText('本次运行已开始 19 轮（含当前轮）')).toBeNull();
});

test('O01/O10: warmup calls the real service and exposes failures without claiming readiness',async()=>{
  const {api}=fixture();api.ocr=vi.fn(async()=>{throw Error('模型加载失败');});
  render(<OcrWorkspace />);
  fireEvent.click(await screen.findByRole('button',{name:'预热 OCR'}));
  await screen.findByText('模型加载失败');
  expect(api.ocr).toHaveBeenCalledWith({operation:'warmup'});
  expect(screen.queryByRole('button',{name:'OCR 已预热'})).toBeNull();
});
test('O01: testing all saves current regions and displays backend per-field results',async()=>{
  const {api,snapshot}=fixture();api.saveOcr=vi.fn(async()=>snapshot);api.ocr=vi.fn(async()=>({results:{nature:'爽朗',hp:'156'},text:'测试全部完成'}));
  render(<OcrWorkspace />);
  fireEvent.click(await screen.findByRole('button',{name:'测试全部'}));
  await screen.findByText('爽朗');await screen.findByText('156');
  expect(api.saveOcr).toHaveBeenCalledWith(snapshot.config.ocr);
  expect(api.ocr).toHaveBeenCalledWith({operation:'test-all'});
});
test('T05/T06/T07: filtered display never truncates copy-all and recapture clears old rows',async()=>{
  const {api,snapshot}=fixture();snapshot.config.tid.parameters.target_display_tids=[123456];
  snapshot.state={...snapshot.state,kind:'tid',runId:'r1',progress:{phase:'等待取名',id_states:[
    {advances:0,tid:1,sid:2,tsv:3,display_tid:654321},{advances:1,tid:4,sid:5,tsv:6,display_tid:123456}],id_elapsed_seconds:[0,4.285],seed_measured_wall_time:1000}};
  const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  render(<AutomationWorkspace kind="tid" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  fireEvent.click(await screen.findByRole('button',{name:'仅目标 TID · 1'}));
  expect(screen.queryByText('654321')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'复制全部'}));
  await waitFor(()=>expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0][0]).toContain('654321');expect(writeText.mock.calls[0][0]).toContain('123456');
  await act(async()=>api.onState.mock.calls[0][0]({...snapshot,state:{...snapshot.state,progress:{phase:'捕获Seed',id_states:[],id_elapsed_seconds:[]}}}));
  expect(within(screen.getByRole('region',{name:'ID 数据'})).queryByText('123456')).toBeNull();
});
test('L03: a new run removes the previous round filter',async()=>{
  const {snapshot,api}=fixture();snapshot.state.runId='r1';
  localStorage.setItem('auto-poke-rng:log-context',JSON.stringify({runId:'r1',round:1}));
  snapshot.logs=[{id:'a',time:'10:00',source:'自动定点',level:'info',message:'new run message',runId:'r2',round:1}];
  render(<AutomationLogs />);await screen.findByRole('button',{name:'清除轮次筛选'});
  expect(screen.queryByText('new run message')).toBeNull();
  await act(async()=>api.onState.mock.calls[0][0]({...snapshot,state:{...snapshot.state,runId:'r2',status:'starting'}}));
  expect(screen.getByText('new run message')).toBeTruthy();expect(screen.queryByRole('button',{name:'清除轮次筛选'})).toBeNull();
});
