const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {registerAutomation}=require('../electron/automation.cjs');
const {defaults}=require('../electron/automation-store.cjs');
const {createDeviceFixture,until}=require('./helpers/device-fixture.cjs');

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'automation-contract-'));
  const script=path.join(directory,'source.rng');fs.writeFileSync(script,'_目标帧数 = 300\nA 10\n');
  const trace=[],ocrRequests=[],workerMessages=[],handlers=new Map(),events=new EventEmitter();
  const window={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:()=>{},mainFrame:{}}};
  const state={video:{status:'connected',width:1920,height:1080,sharedMemory:{},session:'one'},controller:{status:'connected'}};
  let resolveDone,callbacks,workerConfig;
  const devices={events,getState:()=>state,claimAutomation:async()=>trace.push('claim'),releaseAutomation:()=>trace.push('release'),
    ocr:{start:async()=>trace.push('warmup'),read:async(_image,_lang,options)=>{trace.push('ocr:'+options.field);ocrRequests.push(options);return {text:options.field};}},
    controller:{sequence:async()=>trace.push('key')},runner:{rootDirectory:directory,current:null,
      resolveScript:async()=>({absolute:script}),validate:async()=>({valid:true}),stop:async()=>trace.push('stop-script'),
      start:async options=>{trace.push(options.text);queueMicrotask(()=>events.emit('script',{event:'script.done',runId:'s',status:'completed'}));return {runId:'s'};}}};
  const rng={isBusy:()=>false,cancel:async()=>trace.push('cancel-search'),generate:async input=>{trace.push(input);return [{advances:151,pid:'00000001',ec:'00000002',stats:[1,2,3,4,5,6]}];}};
  const workerFactory=(config,handlers)=>{workerConfig=config;callbacks=handlers;return {done:new Promise(resolve=>{resolveDone=resolve;}),send:message=>workerMessages.push(message),stop:async()=>resolveDone({status:'stopped'})};};
  const automation=registerAutomation({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getMainWindow:()=>window,getWindows:()=>[window],devices,rng,
    blink:{getState:()=>({status:'idle'})},userData:directory,workerFactory,captureImage:async()=>{trace.push('frame');return 'image';}});
  const invoke=(name,input,event={sender:window.webContents,senderFrame:window.webContents.mainFrame})=>handlers.get('automation:'+name)(event,input);
  const input={kind:'static',config:defaults().static,profile:{version:'BD',tid:0,sid:0},blink:{mode:'recover',eye:'data:image/png;base64,AQ==',
    sourceWidth:1920,sourceHeight:1080,roi:{x:0,y:0,width:100,height:100},threshold:.9,npc:0,seed:['1','2','3','4'],noisy:false,searchMin:0,searchMax:1000000}};
  input.config.scripts={...input.config.scripts,seed:'source.rng',advance:'source.rng',hit:'source.rng'};
  t.after(async()=>{await automation.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {automation,input,invoke,trace,ocrRequests,workerMessages,devices,state,rng,done:value=>resolveDone(value),callbacks:()=>callbacks,workerConfig:()=>workerConfig};
}

test('C02: preparation compiles but does not save, press, warm up, or claim devices',async t=>{
  const f=fixture(t);f.input.config.parameters.fixed_delay=1442;
  assert.equal((await f.invoke('check',f.input)).ready,true);assert.deepEqual(f.trace,[]);
  assert.equal(f.automation.getState().config.static.parameters.fixed_delay,100);
});
test('C01/D04: run snapshots parameters and OCR; newly recorded samples retain the chosen baseline',async t=>{
  const f=fixture(t);f.input.config.parameters.fixed_delay=1442;
  await f.invoke('start',f.input);
  f.input.config.parameters.target='Piplup';f.input.config.parameters.fixed_delay=999;
  const request=f.callbacks().request;
  await request('delay_record',{candidates:[1445]});
  assert.equal((await request('delay_profile',{})).config.baseline_delay,1442);
  assert.equal(f.workerConfig().parameters.target,'Turtwig');
  assert.equal(f.workerConfig().parameters.fixed_delay,1442);
  const changed=defaults().ocr;changed[0].rect.x=900;
  await f.invoke('ocr-save',changed);
  await request('ocr',{imageBase64:'image',operation:'text',field:'nature'});
  assert.equal(f.ocrRequests.at(-1).regions.nature[0],112,'active OCR uses its startup snapshot');
});
test('C04: stopping forbids all late script/search calls and releases the resource lock',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);const request=f.callbacks().request;
  await f.invoke('stop');
  await assert.rejects(request('script',{text:'A 100',name:'source.rng'}),/停止/);
  await assert.rejects(request('search',{}),/停止/);
  assert.equal(f.automation.getState().state.status,'stopped');assert.equal(f.trace.at(-1),'release');
});

test('definite non-shiny stops only its hit script and waits for controller cleanup',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);
  const status=f.automation.getState().state.status;
  const release=deferred(),started=deferred();let released=false;
  f.devices.runner.start=async()=>{started.resolve();return {runId:'hit'};};
  f.devices.runner.stop=async()=>{await release.promise;released=true;f.devices.events.emit('script',{event:'script.done',runId:'hit',status:'cancelled'});};
  t.after(()=>release.resolve());
  const request=f.callbacks().request;
  const script=request('script',{text:'A 1',name:'source.rng',scriptId:'hit-1'});
  void script.catch(()=>{});
  await started.promise;
  let stopped=false;
  const stopping=request('stop_script',{scriptId:'hit-1'}).then(()=>{stopped=true;});
  void stopping.catch(()=>{});
  await new Promise(setImmediate);assert.equal(stopped,false);assert.equal(released,false);
  release.resolve();await stopping;await script;
  assert.equal(released,true);assert.equal(f.automation.getState().state.status,status);
  f.devices.runner.start=async()=>{queueMicrotask(()=>f.devices.events.emit('script',{event:'script.done',runId:'next',status:'completed'}));return {runId:'next'};};
  await request('script',{text:'B 1',name:'source.rng'});
});

test('a stop arriving before the hit script request prevents its launch',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);const request=f.callbacks().request;
  const status=f.automation.getState().state.status;
  await request('stop_script',{scriptId:'early-hit'});
  await request('script',{text:'late-key',name:'source.rng',scriptId:'early-hit'});
  assert.equal(f.trace.includes('late-key'),false);
  assert.equal(f.automation.getState().state.status,status);
});

test('hit cancellation releases real mock-controller input before the workflow continues',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();
  const f=fixture(t);
  hardware.devices.runner.rootDirectory=f.devices.runner.rootDirectory;
  f.devices.runner=hardware.devices.runner;
  f.devices.controller=hardware.devices.controller;
  hardware.devices.events.on('script',message=>f.devices.events.emit('script',message));
  await f.invoke('start',f.input);const request=f.callbacks().request;
  const script=request('script',{text:'A DOWN\nWAIT 60000\nPRINT "unexpected-tail"\nB 1',name:'source.rng',scriptId:'native-hit'});
  void script.catch(()=>{});
  await until(async()=>((await hardware.clients.controller.call('controller.status')).report.buttons&4)!==0,'hit script holds A');
  await request('stop_script',{scriptId:'native-hit'});await script;
  const state=await hardware.clients.controller.call('controller.status');
  assert.equal(state.report.buttons,0);assert.equal(state.owned,false);
  assert.equal(f.automation.getState().logs.some(row=>row.message==='unexpected-tail'),false);
  await request('script',{text:'B 1',name:'source.rng'});
});

test('roamer battle detection uses structured watch results from the current hit script',async t=>{
  const f=fixture(t);f.input.config.parameters.target='Cresselia';await f.invoke('start',f.input);
  const started=deferred();f.devices.runner.start=async()=>{started.resolve();return {runId:'hit'};};
  f.devices.runner.stop=async()=>f.devices.events.emit('script',{event:'script.done',runId:'hit',status:'cancelled'});
  const script=f.callbacks().request('script',{text:'$2 = @宝可表',name:'source.rng',scriptId:'hit-watch'});void script.catch(()=>{});
  await started.promise;
  await new Promise(setImmediate);
  const emit=message=>f.devices.events.emit('script',{runId:'hit',event:'script.image-result',...message});
  emit({event:'script.log',message:'已检测到进入战斗'});
  emit({runId:'old-hit',labelName:'宝可表',scriptValue:50});
  emit({labelName:'其他标签',scriptValue:50});
  emit({labelName:'宝可表',scriptValue:95});
  assert.deepEqual(f.workerMessages,[]);
  emit({labelName:'宝可表',score:93.2,scriptValue:94});
  assert.deepEqual(f.workerMessages,[{event:'battle',scriptId:'hit-watch'}]);
  f.devices.events.emit('script',{event:'script.done',runId:'hit',status:'completed'});await script;
  emit({labelName:'宝可表',scriptValue:0});
  assert.equal(f.workerMessages.length,1,'finished scripts no longer observe battle');
});

test('a real image-label script detects roamer battle without PRINT wording',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const hardware=createDeviceFixture(t);await hardware.connectController();await hardware.connectVideo();
  const f=fixture(t);f.input.config.parameters.target='Cresselia';
  f.input.blink.sourceWidth=320;f.input.blink.sourceHeight=240;
  hardware.devices.runner.rootDirectory=f.devices.runner.rootDirectory;
  f.devices.runner=hardware.devices.runner;f.devices.controller=hardware.devices.controller;
  f.devices.getState=()=>hardware.devices.getState();
  hardware.devices.events.on('script',message=>f.devices.events.emit('script',message));
  const directory=path.join(f.devices.runner.rootDirectory,'ImgLabel');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,'宝可表.IL'),JSON.stringify({searchMethod:0,
    ImgBase64:'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAG0lEQVQIHWNkYmRgBgNGbi5OZjBgFBEWYgYDAAdxAJTQaRgKAAAAAElFTkSuQmCC',
    RangeX:0,RangeY:0,RangeWidth:3,RangeHeight:3,TargetX:0,TargetY:0,TargetWidth:3,TargetHeight:3}));
  await f.invoke('start',f.input);
  await f.callbacks().request('script',{text:'$2 = @宝可表',name:'source.rng',scriptId:'native-watch'});
  assert.deepEqual(f.workerMessages,[{event:'battle',scriptId:'native-watch'}]);
});
test('C04: device loss terminates the whole workflow as a failure',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);f.state.video.session='reconnected';
  await new Promise(resolve=>setTimeout(resolve,260));
  assert.equal(f.automation.getState().state.status,'failed');assert.match(f.automation.getState().state.message,/切换/);
});
test('C03: controller emergency stop also stops a workflow between scripts',async t=>{
  const f=fixture(t);await f.invoke('start',f.input);f.devices.events.emit('stop-automation');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.automation.getState().state.status,'stopped');
});
test('C03: unknown windows and subframes cannot start or inspect workflows',async t=>{
  const f=fixture(t);await assert.rejects(f.invoke('state',null,{sender:{},senderFrame:{}}),/sender/);assert.deepEqual(f.trace,[]);
});
test('O01: all-field testing reads notes before turning and reads six stats from one new frame',async t=>{
  const f=fixture(t);const result=await f.invoke('ocr',{operation:'test-all'});
  assert.deepEqual(Object.keys(result.results),['nature','characteristic','hp','attack','defense','sp_attack','sp_defense','speed']);
  assert.deepEqual(f.trace.filter(x=>x==='frame'||x.startsWith?.('ocr:')||x.startsWith?.('RIGHT')),
    ['frame','ocr:nature','ocr:characteristic','RIGHT 100\nWAIT 2000\n','frame','ocr:hp','ocr:attack','ocr:defense','ocr:sp_attack','ocr:sp_defense','ocr:speed']);
});
test('O07: reverse searches the entire legendary group and preserves equal-Adv species',async t=>{
  const f=fixture(t);f.input.config.parameters.target='Latias';await f.invoke('start',f.input);
  const rows=await f.callbacks().request('search',{seed:{pair:['1','2']},reverse:{target:{raw_target_advances:150},nature:'认真'}});
  assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.reverseSpecies),['Latias','Latios']);
});
test('reverse preserves the forward lead for ordinary and sync candidates in every sync mode',async t=>{
  const {RuntimeClient}=require('../electron/runtime-client.cjs');
  const {natures}=require('../src/generated/bdsp-data.json');
  const client=new RuntimeClient({role:'rng'});
  t.after(()=>client.close());
  for(const mode of [0,1,2])for(const configuredLead of [13,255])for(const source of (mode===0?['no_sync']:['no_sync','sync'])){
    await t.test(`mode=${mode}, configured lead=${configuredLead}, source=${source}`,async t=>{
      const f=fixture(t),calls=[];
      Object.assign(f.input.config.parameters,{sync_mode:mode,sync_nature:natures[7],lead:configuredLead,max_advances:20,reverse_lookup_window:10});
      f.input.config.parameters.filters[0].shiny=255;
      f.rng.generate=async input=>{calls.push(input);return client.call('static.generate',input);};
      await f.invoke('start',f.input);
      const request=f.callbacks().request,seed={pair:['1234567887654321','8765432112345678']};
      const forwardLead=source==='sync'?7:mode>0?255:configuredLead;
      const rows=await request('search',{seed,...(mode>0?{lead:forwardLead}:{})});
      const candidate=rows.find(row=>row.nature!==13)||rows[0];
      assert.ok(candidate,'forward search produces a real native candidate');
      const reverse=await request('search',{seed,reverse:{target:{raw_target_advances:candidate.advances,sync_source:source,sync_nature:source==='sync'?7:null},nature:natures[candidate.nature]}});
      assert.equal(calls[0].lead,forwardLead);
      assert.equal(calls[1].lead,forwardLead,'reverse must use the lead that generated the candidate');
      assert.deepEqual(reverse.find(row=>row.advances===candidate.advances),{...candidate,reverseSpecies:'Turtwig'});
    });
  }
});

test('O11: calibration never presses keys or applies a threshold without user choice',async t=>{
  const f=fixture(t);const calibration=f.invoke('calibrate',{target:'Turtwig'});
  await new Promise(resolve=>setImmediate(resolve));
  f.done({status:'completed',result:{interval:2.5,suggested:3}});
  assert.deepEqual(await calibration,{interval:2.5,suggested:3});
  assert.equal(f.automation.getState().config.static.parameters.shiny_threshold_seconds,4);
  assert.deepEqual(f.trace,['warmup']);
});
