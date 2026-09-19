import fs from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
const value=(key,fallback=null)=>{const i=args.indexOf(key);return i>=0?args[i+1]:fallback};
const status=value('--status','fail');
const failedStep=value('--failed-step',status==='pass'?null:'pipeline');
const output=value('--output',path.join('artifacts','woodpecker-ci-report.json'));
const report={
  schemaVersion:1,
  status,
  failedStep:status==='pass'?null:failedStep,
  steps:[{id:failedStep||'pipeline',status,exitCode:status==='pass'?0:1,command:null,stdout:null,stderr:null,durationMs:null}],
  generatedAt:new Date().toISOString()
};
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n','utf8');
console.log('ARTISYS_WOODPECKER_REPORT='+output);
