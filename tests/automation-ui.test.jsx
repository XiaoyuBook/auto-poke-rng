// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRequire } from 'node:module';
import { AutomationWorkspace } from '../src/components/AutomationWorkspace';
import { AutomationLogs } from '../src/components/AutomationLogs';
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
  const api={getState:vi.fn(async()=>snapshot),onState:vi.fn(()=>()=>{}),save:vi.fn(async()=>snapshot),check:vi.fn(async()=>({ready:false,checks:[{label:'视频源',ok:false,detail:'请先连接'}]})),start:vi.fn(),stop:vi.fn(),clearLogs:vi.fn(),setLogging:vi.fn()};
  window.desktop={automation:api,scripts:{list:vi.fn(async()=>({files:[],folders:[],warnings:[]}))}};
  return {snapshot,api};
}
test('C01: one save persists the complete static draft',async()=>{
  const {api}=fixture();
  render(<AutomationWorkspace kind="static" profile={defaultBdspProfile} blinkConfig={newBlinkConfig()} blinkConfigs={[]} openLogs={()=>{}} />);
  await screen.findByRole('button',{name:'保存配置'});
  fireEvent.click(screen.getByRole('button',{name:'delay 策略与样本 · 固定 delay'}));
  fireEvent.change(screen.getByLabelText('基准 delay'),{target:{value:'1452'}});
  fireEvent.click(screen.getByRole('button',{name:'保存配置'}));
  await waitFor(()=>expect(api.save).toHaveBeenCalledWith(expect.objectContaining({scope:'config',expectedId:'default',values:expect.objectContaining({delayConfig:expect.objectContaining({baseline_delay:1452})})})));
  expect(api.start).not.toHaveBeenCalled();
  expect(api.save).toHaveBeenCalledTimes(1);
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
  fireEvent.click(screen.getByRole('button',{name:'移除自动反查'}));
  expect(screen.queryByRole('region',{name:'自动反查'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  expect(screen.getByRole('region',{name:'自动反查'})).toBeTruthy();
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
  expect(screen.queryByText('123456')).toBeNull();
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
