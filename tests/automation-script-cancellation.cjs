const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {ScriptRunner}=require('../electron/script-runner.cjs');

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
for(const phase of ['path','status']){
  test(`manual stop during ${phase} preflight prevents a late process without an external callback`,async()=>{
    const gate=deferred(),entered=deferred();let launches=0,statusCalls=0;
    const controller=new EventEmitter();
    controller.call=async()=>{statusCalls++;if(phase==='status'){entered.resolve();return gate.promise;}return {status:'connected'};};
    const runner=new ScriptRunner({controller,emit:()=>{}});
    runner.resolveScript=async()=>{if(phase==='path'){entered.resolve();await gate.promise;}return {root:'.',absolute:path.resolve('test.rng')};};
    runner.pythonPath=()=>{launches++;throw Error('unexpected process launch');};
    const starting=runner.start({text:'A 1',path:'test.rng'});
    await entered.promise;
    await runner.stop();
    gate.resolve({status:'connected'});
    await assert.rejects(starting,/停止/);
    assert.equal(launches,0);
    assert.equal(statusCalls,phase==='path'?0:1);
    assert.equal(runner.current,null);
  });
}

test('preflight reserves the run and a stale rejection cannot clear a newer start',async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const runner=new ScriptRunner({controller:new EventEmitter(),emit:()=>{}});
  runner.resolveScript=()=>++calls===1?first.promise:second.promise;
  const oldStart=runner.start({text:'A 1',path:'old.rng'});
  const oldRejection=assert.rejects(oldStart,/old failure/);
  await assert.rejects(runner.start({text:'A 1',path:'duplicate.rng'}),/已有脚本/);
  await runner.stop();
  const newStart=runner.start({text:'A 1',path:'new.rng'});
  const newRejection=assert.rejects(newStart,/new failure/);
  const current=runner.current;
  first.reject(Error('old failure'));await oldRejection;
  assert.equal(runner.current,current);
  second.reject(Error('new failure'));await newRejection;
  assert.equal(runner.current,null);
});

test('C04: cancellation during script preflight cannot launch a late controller process',async t=>{
  let cancelled=false,acceptStatus,entered;
  const statusEntered=new Promise(resolve=>{entered=resolve;});
  const controller=new EventEmitter();
  controller.call=async method=>{if(method==='controller.status'){entered();return new Promise(resolve=>{acceptStatus=resolve;});}return {};};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'poke-script-cancellation-'));
  fs.writeFileSync(path.join(root,'取消测试.txt'),'A 1\n');
  const runner=new ScriptRunner({rootDirectory:root,controller,emit:()=>{}});
  t.after(async()=>{await runner.stop();fs.rmSync(root,{recursive:true,force:true});});
  const starting=runner.start({text:'A 1',path:'取消测试.txt',shouldStop:()=>cancelled});
  await statusEntered;cancelled=true;acceptStatus({status:'connected'});
  await assert.rejects(starting,/停止/);
  assert.equal(runner.current,null);
});

test('C02: every frozen reference script compiles without a bundled user library',async()=>{
  const root=path.resolve(__dirname,'../third_party/bdsp-automation-reference/script');
  const runner=new ScriptRunner({rootDirectory:root});
  const files=fs.readdirSync(root).filter(file=>file.endsWith('.txt'));
  assert.equal(files.length,23);
  assert.equal((await runner.resolveScript('BDSP测种.rng')).absolute,path.join(root,'BDSP测种.txt'));
  for(const file of files){
    const result=await runner.validate({text:fs.readFileSync(path.join(root,file),'utf8'),path:file});
    assert.equal(result.valid,true,`${file}: ${result.diagnostic?.message}`);
  }
});
