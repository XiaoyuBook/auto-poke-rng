const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {createRequire}=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const turn=()=>new Promise(setImmediate);

function fixture(t){
  const children=[];
  const filename=path.resolve(__dirname,'../electron/ocr-client.cjs');
  const originalRequire=createRequire(filename),module={exports:{}};
  const spawn=()=>{
    const child=new EventEmitter();
    Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),killed:false});
    child.commands=[];child.stdin.on('data',data=>child.commands.push(JSON.parse(data.toString())));
    child.kill=()=>{child.killed=true;}; // OS exit is deliberately delivered later.
    child.message=message=>child.stdout.write(JSON.stringify(message)+'\n');
    children.push(child);return child;
  };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,__dirname:path.dirname(filename),process,Buffer,setTimeout,clearTimeout,
    require:name=>name==='node:child_process'?{spawn}:originalRequire(name)},{filename});
  const client=new module.exports.OcrClient();
  t.after(async()=>{await client.close();for(const child of children)child.emit('exit',0);});
  return {client,children};
}

test('late exit/error/protocol data from a closed OCR worker cannot settle new requests',async t=>{
  const {client,children}=fixture(t);
  const starting=client.start();const old=children[0];old.message({event:'ocr.ready'});await starting;
  const oldRequest=client.read('YWJj');const closed=assert.rejects(oldRequest,/关闭/);
  await turn();await client.close();await closed;
  const next=client.read('YWJj').then(value=>({value}),error=>({error}));
  const fresh=children[1];fresh.message({event:'ocr.ready'});await turn();
  assert.equal(fresh.commands.length,1);
  const id=fresh.commands[0].id;
  old.emit('exit',0);
  old.emit('error',Error('late error'));
  old.message({id,ok:true,result:{text:'stale'}});
  old.stdout.write('bad old protocol\n');
  assert.equal(client.pending.size,1,'the fresh request must remain pending');
  fresh.message({id,ok:true,result:{text:'fresh',confidence:1}});
  const result=await next;
  assert.equal(result.error,undefined);
  assert.equal(result.value.text,'fresh');
});

test('closing during OCR startup allows immediate restart and old finalizers do not clear it',async t=>{
  const {client,children}=fixture(t);
  const oldStart=client.start().then(()=>null,error=>error);
  void client.close();
  const freshStart=client.start();
  void freshStart.catch(()=>{});
  assert.equal(children.length,2,'restart must not reuse the closing startup promise');
  const pending=client.starting;
  assert.match((await oldStart).message,/关闭/);
  assert.equal(client.starting,pending,'old finally must not clear the new startup');
  children[0].emit('exit',0);
  children[1].message({event:'ocr.ready'});await freshStart;
  assert.equal(client.child,children[1]);
});

test('current OCR worker failures still reject its own requests',async t=>{
  const {client,children}=fixture(t);
  const starting=client.start();children[0].message({event:'ocr.ready'});await starting;
  const request=client.read('YWJj');const rejected=assert.rejects(request,/退出/);
  await turn();children[0].emit('exit',1);await rejected;
  assert.equal(client.pending.size,0);assert.equal(client.child,null);
});

test('a read awaiting the old ready event cannot dispatch onto a new unready worker',async t=>{
  const {client,children}=fixture(t);
  const oldRead=client.read('YWJj').then(()=>null,error=>error);
  children[0].message({event:'ocr.ready'});
  void client.close();
  const freshStart=client.start();void freshStart.catch(()=>{});
  assert.match((await oldRead).message,/不可用/);
  assert.equal(children[1].commands.length,0);
  children[1].message({event:'ocr.ready'});await freshStart;
});
