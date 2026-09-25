const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startWorker}=require('../electron/automation-worker.cjs');
const {defaults}=require('../electron/automation-store.cjs');
const {validateParameters}=require('../electron/automation.cjs');

test('calibration loads native libraries with stdin open and reports unavailable video',async()=>{
  const worker=startWorker({command:'calibrate',species:492,video:{sharedMemory:{version:0}}});
  let timer;
  try {
    const result=await Promise.race([worker.done,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('calibration stalled during native initialization')),10000);
    })]);
    assert.equal(result.status,'failed');
    assert.match(result.message,/Unsupported frame protocol/);
  } finally {
    clearTimeout(timer);
    await worker.stop();
  }
});

test('T02: real JSONL worker generates inclusive ID range and fixed elapsed timings',async()=>{
  const worker=startWorker({command:'tid-preview',seed:['40000000','00000000','40000000','00000000'],frame_threshold:4});
  const result=await worker.done;
  assert.equal(result.status,'completed',result.message);
  assert.equal(result.result.id_states.length,5);
  assert.deepEqual(result.result.id_states.map(row=>row.advances),[0,1,2,3,4]);
  const reference=require('../third_party/bdsp-automation-reference/fixtures/id8.json').generate[0].results;
  assert.equal(result.result.id_states[0].display_tid,reference[0].displayTID);
  assert.equal(result.result.id_elapsed_seconds[0],0);
  assert.ok(result.result.id_elapsed_seconds[1]>3);
});
test('D01: real worker estimates weighted delay without loading hardware',async()=>{
  const worker=startWorker({command:'delay-estimate',profile:{config:{strategy:'mean',baseline_delay:100,multi_candidate_policy:'weighted',window_size:5},samples:[{candidates:[100,102]},{candidates:[104]}]}});
  const result=await worker.done;
  assert.equal(result.status,'completed',result.message);assert.equal(result.result,103);
});
test('C04: worker cancellation resolves stopped and accepts no follow-up commands',async()=>{
  const worker=startWorker({command:'tid-preview',seed:['12345678','9ABCDEF0','11111111','22222222'],frame_threshold:250000});
  await worker.stop();const result=await worker.done;assert.equal(result.status,'stopped');
});
test('C02: invalid filters, NaN delays and empty TID pools fail validation',()=>{
  const config=defaults();validateParameters('static',config.static.parameters);
  assert.throws(()=>validateParameters('static',{...config.static.parameters,shiny_threshold_seconds:NaN}),/判闪/);
  assert.throws(()=>validateParameters('tid',config.tid.parameters),/Display TID/);
  assert.throws(()=>validateParameters('static',{...config.static.parameters,filters:[{...config.static.parameters.filters[0],ivMin:[32,0,0,0,0,0]}]}),/个体值/);
});
