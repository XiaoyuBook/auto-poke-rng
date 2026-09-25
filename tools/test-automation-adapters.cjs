const {spawnSync}=require('node:child_process');
const {pythonPath}=require('../electron/automation-worker.cjs');
const path=require('node:path');
const cwd=path.resolve(__dirname,'..');
const commands=[
  [process.execPath,['--test','--test-concurrency=1','tests/automation-services.cjs','tests/automation-worker.cjs','tests/automation-integration.cjs','tests/automation-script-cancellation.cjs']],
  [pythonPath(),['-X','utf8','-m','unittest','discover','-s','runtime/tests','-p','test_automation_*.py']],
];
for(const [command,args] of commands){
  const result=spawnSync(command,args,{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(result.error)console.error(result.error.message);
  if(result.status!==0)process.exit(result.status||1);
}
