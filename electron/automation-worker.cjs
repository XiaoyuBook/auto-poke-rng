const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
function pythonPath() {
  const bundled = path.join(__dirname, '..', '.deps/script-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return process.env.AUTO_POKE_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
}
function startWorker(config, { event = () => {}, request = async () => { throw Error('未知自动流程请求'); }, spawnProcess = spawn } = {}) {
  const child = spawnProcess(pythonPath(), ['-u',path.join(__dirname,'../runtime/python/automation_host.py')], {
    windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},
  });
  let buffer='', diagnostic='', completed=false, stopped=false, result, settle;
  const done=new Promise(resolve=>{settle=resolve;});
  const send=message=>{if(!child.stdin.destroyed&&!completed)child.stdin.write(JSON.stringify(message)+'\n');};
  const finish=value=>{if(completed)return;completed=true;clearTimeout(startup);settle(value);child.stdin.end();};
  const startup=setTimeout(()=>{finish({status:'failed',message:'自动流程运行时启动超时'});child.kill();},30000);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-4000);});
  child.stdin.on('error',error=>finish({status:stopped?'stopped':'failed',message:error.message}));
  child.once('error',error=>finish({status:'failed',message:error.message}));
  child.once('close',code=>finish({status:stopped?'stopped':'failed',message:diagnostic||`自动流程运行时退出 (${code})`}));
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    if(buffer.length>64*1024*1024){finish({status:'failed',message:'自动流程响应超过限制'});child.kill();return;}
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let message;try{message=JSON.parse(line);}catch{finish({status:'failed',message:'自动流程返回无效数据'});child.kill();return;}
      if(completed)continue;
      clearTimeout(startup);
      if(message.event==='request'){
        void (async()=>{try{if(stopped)throw Error('自动流程已停止');const value=await request(message.method,message.params);if(!stopped)send({id:message.id,result:value});}
          catch(error){send({id:message.id,error:error.message});}})();
      }else if(message.event==='done')finish({status:stopped?'stopped':message.status,message:message.message,result});
      else if(message.event==='result'){result=message.result;finish({status:'completed',result});}
      else if(!stopped)event(message);
    }
  });
  send(config);
  return {done,send,stop:async()=>{
    if(completed)return done;
    stopped=true;send({command:'stop'});
    const timer=setTimeout(()=>child.kill(),2000);
    try{return await done;}finally{clearTimeout(timer);}
  }};
}
module.exports={startWorker,pythonPath};
