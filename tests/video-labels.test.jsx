// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoPreview } from '../src/components/VideoPreview';
import { DetachedPanel } from '../src/DetachedPanel';

vi.mock('../src/useDevices',()=>({useDevices:()=>({video:{status:'idle'}})}));
vi.mock('../src/usePanelWindows',()=>({usePanelWindows:()=>({state:{videoLabelsOpen:true},setError:()=>{}})}));
beforeEach(()=>{
  vi.stubGlobal('Image',class {
    naturalWidth=8; naturalHeight=8;
    set src(value){this.url=value;queueMicrotask(()=>this.onload());}
  });
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){
    return {drawImage:image=>{this.source=image.url;},getImageData:()=>({data:new Uint8ClampedArray(8*8*4)})};
  });
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockImplementation(function(){return `data:image/png;base64,${btoa('crop:'+this.source)}`;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();delete window.desktop;localStorage.clear();});

function fixture(overrides={}){
  const frame={url:'data:image/png;base64,FRAMEA',width:8,height:8,sequence:1};
  const label={name:'已有标签',path:'BDSP/ImgLabel/已有标签.IL',searchMethod:5,threshold:95,
    range:{x:0,y:0,width:8,height:8},target:{x:1,y:1,width:2,height:2},imageBase64:'ORIGINAL',...overrides};
  const scripts={labelsList:vi.fn(async()=>({labels:[label]})),labelRead:vi.fn(async()=>label),labelSave:vi.fn(async data=>({...data,path:label.path}))};
  const listeners=new Set();
  const video={getSnapshot:vi.fn(async()=>frame),onSnapshot:vi.fn(fn=>{listeners.add(fn);return()=>listeners.delete(fn);}),
    matchLabel:vi.fn(async()=>({score:100,scriptValue:100,matched:true,unit:'percent',x:1,y:1,width:2,height:2})),
    snapshot:vi.fn(async()=>{const live={...frame,url:'data:image/png;base64,FRAMEB',sequence:2};listeners.forEach(fn=>fn(live));return live;}),
    captureFrame:vi.fn(async()=>({...frame,url:'data:image/png;base64,FRAMEB',sequence:2}))};
  window.desktop={scripts,devices:{video},getMetadata:async()=>({platform:'win32'})};
  return {scripts,video,frame,label,listeners};
}
async function load(){
  fireEvent.click(await screen.findByRole('button',{name:'已有标签'}));
  await waitFor(()=>expect(screen.getByLabelText('标签名称').value).toBe('已有标签'));
}
async function save(scripts){
  fireEvent.click(screen.getByRole('button',{name:'保存标签'}));
  await waitFor(()=>expect(scripts.labelSave).toHaveBeenCalled());
  return scripts.labelSave.mock.lastCall[0];
}

test.each([0,1,2,3,4,5])('saving threshold/range edits preserves the loaded template and method %s',async method=>{
  const {scripts}=fixture({searchMethod:method});
  render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.change(screen.getByLabelText('最低匹配度'),{target:{value:'90'}});
  fireEvent.change(screen.getByLabelText('搜索范围 W'),{target:{value:'7'}});
  const saved=await save(scripts);
  expect(saved).toMatchObject({folder:'BDSP',imageBase64:'ORIGINAL',searchMethod:method,threshold:90});
});

test('loading a zero threshold preserves it',async()=>{
  fixture({threshold:0});render(<VideoPreview labelsOpen />);await load();
  expect(screen.getByLabelText('最低匹配度').value).toBe('0');
});

test('explicit target reselection replaces the template with the current reference crop',async()=>{
  const {scripts,frame}=fixture();render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.change(screen.getByLabelText('目标位置 X'),{target:{value:'2'}});
  expect((await save(scripts)).imageBase64).toBe(btoa('crop:'+frame.url));
});

test('a new reference snapshot does not replace the loaded template',async()=>{
  const {scripts}=fixture();render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.click(screen.getByRole('button',{name:'截图',exact:true}));
  await waitFor(()=>expect(screen.getByAltText('截图静态帧').getAttribute('src')).toContain('FRAMEB'));
  expect((await save(scripts)).imageBase64).toBe('ORIGINAL');
});

test('searching a live frame leaves the static reference and its next saved crop unchanged',async()=>{
  const {scripts,frame,video}=fixture();render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.change(screen.getByLabelText('目标位置 X'),{target:{value:'2'}});
  fireEvent.click(screen.getByRole('button',{name:'搜索测试'}));
  await screen.findByAltText('实时匹配画面');
  expect(screen.getByAltText('截图静态帧').getAttribute('src')).toBe(frame.url);
  expect(video.captureFrame).toHaveBeenCalledOnce();expect(video.snapshot).not.toHaveBeenCalled();
  expect((await save(scripts)).imageBase64).toBe(btoa('crop:'+frame.url));
});

test.each([5,3,2])('editor uses runtime matching and script threshold semantics for method %s',async method=>{
  const {video}=fixture({searchMethod:method});render(<VideoPreview labelsOpen />);await load();
  video.matchLabel.mockResolvedValue({score:94.1,scriptValue:95,matched:true,unit:method===2?'score':'percent',x:1,y:1,width:2,height:2});
  fireEvent.click(screen.getByRole('button',{name:'搜索测试'}));
  await waitFor(()=>expect(video.matchLabel).toHaveBeenCalledWith('FRAMEB',expect.objectContaining({searchMethod:method,imageBase64:'ORIGINAL',threshold:95})));
  await screen.findByText('脚本值 95 · 通过');
  const notice=screen.getByRole('status').textContent;
  expect(notice).toContain(method===2?'94.1 分':'94.1%');
});

test('new color labels use normalized correlation while legacy raw thresholds remain editable',async()=>{
  const {scripts}=fixture({searchMethod:2,threshold:2000});render(<VideoPreview labelsOpen />);await load();
  fireEvent.change(screen.getByLabelText('最低匹配度'),{target:{value:'3000'}});
  expect((await save(scripts)).threshold).toBe(3000);
  fireEvent.change(screen.getByLabelText('搜索方法'),{target:{value:'3'}});
  scripts.labelSave.mockClear();
  expect((await save(scripts)).searchMethod).toBe(3);
});

test('detached labels read, save, switch, and reopen in the active script folder',async()=>{
  const {scripts}=fixture();localStorage.setItem('auto-poke-rng:label-folder','BDSP');
  const view=render(<DetachedPanel tool="video" />);await load();
  expect(scripts.labelsList).toHaveBeenCalledWith('BDSP');
  expect(scripts.labelRead).toHaveBeenCalledWith('BDSP','已有标签');
  expect((await save(scripts)).folder).toBe('BDSP');
  await act(async()=>{
    localStorage.setItem('auto-poke-rng:label-folder','FRLG');
    window.dispatchEvent(new StorageEvent('storage',{key:'auto-poke-rng:label-folder',newValue:'FRLG'}));
  });
  await waitFor(()=>expect(scripts.labelsList).toHaveBeenCalledWith('FRLG'));
  expect(screen.getByLabelText('标签名称').value).toBe('');
  await load();scripts.labelSave.mockClear();
  expect(scripts.labelRead).toHaveBeenCalledWith('FRLG','已有标签');
  expect((await save(scripts)).folder).toBe('FRLG');
  view.unmount();scripts.labelsList.mockClear();render(<DetachedPanel tool="video" />);
  await waitFor(()=>expect(scripts.labelsList).toHaveBeenCalledWith('FRLG'));
});

test('a late label read from the previous folder cannot become the new folder draft',async()=>{
  const {scripts,label}=fixture();let completeRead;
  scripts.labelRead.mockReturnValue(new Promise(resolve=>{completeRead=resolve;}));
  const view=render(<VideoPreview labelsOpen labelFolder="BDSP" />);
  fireEvent.click(await screen.findByRole('button',{name:'已有标签'}));
  view.rerender(<VideoPreview labelsOpen labelFolder="FRLG" />);
  await act(async()=>completeRead(label));
  expect(screen.getByLabelText('标签名称').value).toBe('');
  fireEvent.click(screen.getByRole('button',{name:'保存标签'}));
  await screen.findByText('请先截图并填写标签名称。');
  expect(scripts.labelSave).not.toHaveBeenCalled();
});

test('switching folders while dynamic testing starts does not leave an old timer running',async()=>{
  const {video}=fixture();let completeMatch;
  video.matchLabel.mockReturnValue(new Promise(resolve=>{completeMatch=resolve;}));
  const view=render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.click(screen.getByRole('button',{name:'动态测试'}));
  await waitFor(()=>expect(video.matchLabel).toHaveBeenCalled());
  view.rerender(<VideoPreview labelsOpen labelFolder="FRLG" />);
  const interval=vi.spyOn(window,'setInterval');
  await act(async()=>completeMatch({score:100,scriptValue:100,matched:true,unit:'percent',x:1,y:1,width:2,height:2}));
  expect(interval).not.toHaveBeenCalled();
});

const matchResult=score=>({score,scriptValue:score,matched:score>=95,unit:'percent',x:1,y:1,width:2,height:2});
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};

test.each([false,true])('closing the same folder invalidates a pending dynamic start, reopened=%s',async reopen=>{
  const {video}=fixture(),pending=deferred();
  video.matchLabel.mockReturnValueOnce(pending.promise);
  const view=render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.click(screen.getByRole('button',{name:'动态测试'}));
  await waitFor(()=>expect(video.matchLabel).toHaveBeenCalledOnce());
  view.rerender(<VideoPreview labelsOpen={false} labelFolder="BDSP" />);
  if(reopen)view.rerender(<VideoPreview labelsOpen labelFolder="BDSP" />);
  const interval=vi.spyOn(window,'setInterval');
  await act(async()=>pending.resolve(matchResult(100)));
  expect(interval).not.toHaveBeenCalled();
  expect(screen.queryByAltText('实时匹配画面')).toBeNull();
  expect(video.captureFrame).toHaveBeenCalledOnce();
  view.rerender(<VideoPreview labelsOpen labelFolder="BDSP" />);
  expect(screen.getByRole('button',{name:'动态测试'}).getAttribute('aria-pressed')).toBe('false');
});

test('dynamic testing can be stopped while its first match is pending',async()=>{
  const {video}=fixture(),pending=deferred();video.matchLabel.mockReturnValueOnce(pending.promise);
  render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.click(screen.getByRole('button',{name:'动态测试'}));
  await waitFor(()=>expect(video.matchLabel).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button',{name:'停止动态'}));
  const interval=vi.spyOn(window,'setInterval');
  await act(async()=>pending.resolve(matchResult(100)));
  expect(interval).not.toHaveBeenCalled();
  expect(screen.queryByAltText('实时匹配画面')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('动态测试已停止。');
});

test.each(['resolve','reject'])('a previous dynamic session cannot overwrite or restart a new session on late %s',async outcome=>{
  const {video}=fixture(),old=deferred(),current=deferred();
  video.matchLabel.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view=render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  fireEvent.click(screen.getByRole('button',{name:'动态测试'}));
  await waitFor(()=>expect(video.matchLabel).toHaveBeenCalledOnce());
  view.rerender(<VideoPreview labelsOpen={false} labelFolder="BDSP" />);
  view.rerender(<VideoPreview labelsOpen labelFolder="BDSP" />);
  fireEvent.click(screen.getByRole('button',{name:'动态测试'}));
  await waitFor(()=>expect(video.matchLabel).toHaveBeenCalledTimes(2));
  const interval=vi.spyOn(window,'setInterval');
  await act(async()=>current.resolve(matchResult(100)));
  expect(interval).toHaveBeenCalledOnce();
  const notice=screen.getByRole('status').textContent;
  await act(async()=>outcome==='resolve'?old.resolve(matchResult(20)):old.reject(new Error('stale failure')));
  expect(interval).toHaveBeenCalledOnce();
  expect(screen.getByText('脚本值 100 · 通过')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(notice);
});

test('closing a running dynamic session discards its pending poll result',async()=>{
  const {video}=fixture(),pending=deferred();
  const view=render(<VideoPreview labelsOpen labelFolder="BDSP" />);await load();
  let poll;
  vi.spyOn(window,'setInterval').mockImplementation(callback=>{poll=callback;return 77;});
  const clear=vi.spyOn(window,'clearInterval');
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'动态测试'})));
  expect(poll).toBeTypeOf('function');
  video.matchLabel.mockReturnValueOnce(pending.promise);
  await act(async()=>poll());
  expect(video.matchLabel).toHaveBeenCalledTimes(2);
  view.rerender(<VideoPreview labelsOpen={false} labelFolder="BDSP" />);
  expect(clear).toHaveBeenCalledWith(77);
  view.rerender(<VideoPreview labelsOpen labelFolder="BDSP" />);
  await act(async()=>pending.resolve(matchResult(20)));
  expect(screen.getByText('脚本值 100 · 通过')).toBeTruthy();
  expect(screen.getByRole('button',{name:'动态测试'}).getAttribute('aria-pressed')).toBe('false');
});
