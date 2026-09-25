// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoPreview } from '../src/components/VideoPreview';

vi.mock('../src/useDevices',()=>({useDevices:()=>({video:{status:'idle'}})}));
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
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();delete window.desktop;});

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
  window.desktop={scripts,devices:{video}};
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
