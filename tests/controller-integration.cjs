const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeClient } = require('../electron/runtime-client.cjs');
const { ScriptRunner, addSequenceApi } = require('../electron/script-runner.cjs');
const { ControllerInputManager } = require('../electron/controller-input.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Independent golden report from EasyCon's 7-byte big-endian / 7-bit packing protocol.
const neutral = [0,0,1,8,4,2,1,128];
for (const failure of ['disconnect', 'offline']) {
  test(`real keyboard hook exits after controller ${failure}`, { timeout: 10000, skip: process.platform !== 'win32' }, async () => {
    const client = new RuntimeClient({ role: 'controller', testMode: true });
    const errors = [];
    const input = new ControllerInputManager({ controller: client, broadcast: () => {} });
    input.on('error', error => errors.push(error));
    // Keep ordinary typing available while verifying the real Windows hook.
    input.setMapping({ A: 'F24' });
    try {
      await client.call('controller.connect', { port: 'mock' });
      await input.toggle();
      assert.equal(input.getState().active, true);
      const child = input.child;
      const exited = new Promise(resolve => child.once('exit', resolve));
      if (failure === 'disconnect') await client.call('controller.disconnect');
      else client.terminate();
      await exited;
      assert.equal(input.child, null, 'keyboard process has been stopped');
      assert.equal(input.getState().active, false);
      assert.equal(input.getState().visible, false);
      assert.equal(input.getState().mode, 'off');
      assert.deepEqual(errors, []);
    } finally { await input.close(); await client.close(); }
  });
}

test('EasyCon persistent COM session, golden packets, cancellation and exclusive script owner', { timeout:15000 }, async () => {
  const client=addSequenceApi(new RuntimeClient({ role:'controller', testMode:true }));
  try {
    await client.call('controller.connect',{port:'mock'});
    assert.deepEqual((await client.call('controller.debug')).report,neutral);
    await client.call('controller.key',{key:'A',down:true});
    assert.deepEqual((await client.call('controller.debug')).report,[0,1,1,8,4,2,1,128]);
    await client.call('controller.key',{key:'A',down:false});
    await client.call('controller.stick',{side:'LS',x:0,y:255});
    assert.deepEqual((await client.call('controller.debug')).report,[0,0,1,0,7,126,1,128]);
    await client.call('controller.reset');
    const { owner }=await client.call('controller.acquire');
    await assert.rejects(client.call('controller.key',{key:'A',down:true}),/脚本/);
    await assert.rejects(client.call('controller.sequence',{owner,actions:[{kind:'button',key:'A',down:true},{kind:'invalid'}]}),/不支持/);
    assert.deepEqual((await client.call('controller.debug')).report,neutral, 'invalid batch must not execute its valid prefix');
    for(let i=0;i<3;i++) await client.sequence({owner,actions:[{kind:'button',key:'B',down:true},{kind:'wait',duration_ms:40},{kind:'button',key:'B',down:false}]});
    const debug=await client.call('controller.debug'); assert.equal(debug.connects,1);
    for(let i=1;i<debug.history.length;i++) assert.ok(BigInt(debug.history[i].timestampNs)-BigInt(debug.history[i-1].timestampNs)>=29_000_000n);
    const long=client.sequence({owner,actions:[{kind:'button',key:'A',down:true},{kind:'wait',duration_ms:60000},{kind:'button',key:'X',down:true}]});
    const cancelled=assert.rejects(long,/取消/);
    await delay(100); const started=Date.now(); await client.call('controller.stop'); await cancelled;
    assert.ok(Date.now()-started<1000); assert.deepEqual((await client.call('controller.debug')).report,neutral);
    assert.equal((await client.call('controller.status')).status,'connected');
  } finally { await client.close(); }
});

test('original interpreter runs loops, imports, UI aliases; keeps connection and releases keys on failure/stop', {timeout:20000}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poke-scripts-'));
  const client=addSequenceApi(new RuntimeClient({role:'controller',testMode:true}));
  const events=[];
  const runner=new ScriptRunner({controller:client,rootDirectory:root,getVideo:()=>({status:'idle'}),emit:e=>events.push(e)});
  async function run(text) {
    fs.writeFileSync(path.join(root,'test.rng'),text);
    await runner.start({text,path:'test.rng'}); const done=runner.current.done; await done;
    return events.filter(e=>e.event==='script.done').at(-1);
  }
  try {
    await client.call('controller.connect',{port:'mock'});
    assert.equal((await run('FOR 3\nA 35\nWAIT 10\nNEXT\nPRINT "done"')).status,'completed');
    const trace = events.filter(event => event.event === 'script.progress');
    assert.ok(trace.some(event => event.source === 'test.rng' && event.loops?.[0]?.total === 3), 'loop progress from interpreter');
    assert.equal(trace.at(-1).line, 5, 'final execution position is flushed before completion');
    assert.equal((await run('press A\nwait 30\npress B')).status,'completed');
    assert.equal((await run('LS UP, 30\nRCLICK 40')).status,'completed');
    fs.mkdirSync(path.join(root,'lib'));
    fs.writeFileSync(path.join(root,'lib','math.ecs'),'_OFFSET = 4\nFUNC addOffset($value:INT):INT\nRETURN $value + _OFFSET\nENDFUNC\n');
    assert.equal((await run('IMPORT "math.ecs"\n$result = addOffset(6)\nPRINT $result')).status,'completed');
    assert.ok(events.some(event=>event.event==='script.log' && event.message.trim()==='10'));
    assert.equal((await client.call('controller.debug')).connects,1);
    assert.deepEqual((({status, phase, source, line}) => ({status, phase, source, line}))(await run('A DOWN\nTHIS_IS_NOT_A_COMMAND')), {status:'failed',phase:'compile',source:'test.rng',line:2});
    assert.equal((await run('A DOWN\nLS RIGHT\n$value = 1 / 0')).status,'failed');
    assert.deepEqual((await client.call('controller.debug')).report,neutral,'runtime failure releases held buttons and sticks');
    const before=(await client.call('controller.debug')).history.length;
    assert.equal((await run('A 50\n$text = OCR(0,0,10,10)')).status,'failed');
    assert.equal((await client.call('controller.debug')).history.length,before,'unsupported capability fails before any input');
    assert.deepEqual((await client.call('controller.debug')).report,neutral);
    fs.writeFileSync(path.join(root,'test.rng'),'A DOWN\nWAIT 60000\nX 50');
    await runner.start({text:'A DOWN\nWAIT 60000\nX 50',path:'test.rng'});
    await delay(350); await runner.stop();
    assert.equal(events.filter(e=>e.event==='script.done').at(-1).status,'cancelled');
    assert.equal((await client.call('controller.status')).status,'connected');
    assert.deepEqual((await client.call('controller.debug')).report,neutral);
    const started = new Promise(resolve => {
      const listener = event => { if (event.event === 'controller.state' && event.state.running) { client.off('event', listener); resolve(); } };
      client.on('event', listener);
    });
    await runner.start({text:'A DOWN\nWAIT 60000',path:'test.rng'});
    const interrupted = runner.current.done;
    await started;
    client.terminate();
    await interrupted;
    assert.equal(events.filter(e=>e.event==='script.done').at(-1).status,'failed','lost hardware must not be reported as successfully released');
    assert.equal(client.child,null,'script failure must not spawn a replacement hardware process');
  } finally { await runner.stop(); await client.close(); fs.rmSync(root,{recursive:true,force:true}); }
});

test('video loss stops only scripts that depend on video', { timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-video-policy-'));
  const client = addSequenceApi(new RuntimeClient({ role: 'controller', testMode: true }));
  const events = [];
  const video = { status: 'connected', session: 'session-a' };
  const runner = new ScriptRunner({ controller: client, rootDirectory: root, getVideo: () => video, emit: event => events.push(event) });
  const until = async predicate => {
    for (let n = 0; n < 100; n++) { if (predicate()) return; await delay(20); }
    throw new Error('script event timeout');
  };
  try {
    await client.call('controller.connect', { port: 'mock' });
    const text = 'A DOWN\nWAIT 250\nA UP';
    fs.writeFileSync(path.join(root, 'controller-only.rng'), text);
    await runner.start({ text, path: 'controller-only.rng' });
    await until(() => events.some(event => event.event === 'script.started'));
    runner.handleVideoState({ status: 'idle' });
    await runner.current.done;
    assert.equal(events.at(-1).status, 'completed');
    assert.deepEqual((await client.call('controller.debug')).report, neutral);
  } finally { await runner.stop(); await client.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('fast loops publish bounded latest positions and library wait exposes its source and caller', {timeout:10000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-trace-'));
  const client = addSequenceApi(new RuntimeClient({role:'controller',testMode:true}));
  const events = [];
  const runner = new ScriptRunner({controller:client,rootDirectory:root,getVideo:()=>({status:'idle'}),emit:e=>events.push(e)});
  const until = async predicate => { for (let n=0;n<100;n++) { if (predicate()) return; await delay(20); } throw new Error('trace timeout'); };
  try {
    await client.call('controller.connect',{port:'mock'});
    fs.writeFileSync(path.join(root,'test.rng'),'# placeholder');
    const started = Date.now();
    await runner.start({text:'$i = 0\nFOR\n$i += 1\nNEXT',path:'test.rng'});
    await until(()=>events.some(e=>e.event==='script.progress'));
    await delay(250);
    await runner.stop();
    const trace = events.filter(e=>e.event==='script.progress');
    assert.ok(trace.length <= Math.ceil((Date.now()-started)/100)+2, 'at most 10 updates/sec plus final flush');
    assert.ok(trace.some(e => e.loops?.[0]?.iteration > 50), 'actual rapid loop iterations');
    events.length = 0;
    fs.mkdirSync(path.join(root,'lib'));
    fs.writeFileSync(path.join(root,'lib','hold.ecs'),'FUNC hold\nWAIT 60000\nENDFUNC');
    await runner.start({text:'CALL hold',path:'test.rng'});
    await until(()=>events.some(e=>e.event==='script.progress' && e.line===2));
    const point = events.find(e=>e.event==='script.progress' && e.line===2);
    assert.equal(point.source,'lib/hold.ecs');
    assert.equal(point.text,'WAIT 60000');
    assert.equal(point.caller.source,'test.rng');
    assert.equal(point.caller.line,1);
    await runner.stop();
    assert.equal(events.at(-1).event,'script.done');
    const count=events.length; await delay(150);
    assert.equal(events.length,count,'no stale progress after done');
  } finally { await runner.stop(); await client.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
