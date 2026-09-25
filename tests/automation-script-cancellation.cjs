const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {ScriptRunner}=require('../electron/script-runner.cjs');

test('C04: cancellation during script preflight cannot launch a late controller process',async t=>{
  let cancelled=false,acceptStatus,entered;
  const statusEntered=new Promise(resolve=>{entered=resolve;});
  const controller=new EventEmitter();
  controller.call=async method=>{if(method==='controller.status'){entered();return new Promise(resolve=>{acceptStatus=resolve;});}return {};};
  const runner=new ScriptRunner({rootDirectory:path.resolve('scripts'),controller,emit:()=>{}});
  t.after(()=>runner.stop());
  const starting=runner.start({text:'A 1',path:'BDSP/OCR翻页.rng',shouldStop:()=>cancelled});
  await statusEntered;cancelled=true;acceptStatus({status:'connected'});
  await assert.rejects(starting,/停止/);
  assert.equal(runner.current,null);
});

test('C02: every imported BDSP script compiles with this project’s existing engine',async()=>{
  const runner=new ScriptRunner({rootDirectory:path.resolve('scripts')});
  for(const file of fs.readdirSync('scripts/BDSP').filter(file=>file.endsWith('.rng'))){
    const result=await runner.validate({text:fs.readFileSync(path.join('scripts/BDSP',file),'utf8'),path:'BDSP/'+file});
    assert.equal(result.valid,true,`${file}: ${result.diagnostic?.message}`);
  }
});
