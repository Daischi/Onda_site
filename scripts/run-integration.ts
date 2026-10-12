import { readFileSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const testPath='tests/integration/commerce.test.ts';
const expected=(readFileSync(testPath,'utf8').match(/^test\(/gm)||[]).length;
const child=spawn(process.execPath,['--import','tsx','--test','--test-reporter=tap',testPath],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';let marker=false;let failed=false;let complete=false;let exitPromise:Promise<void>;
function consume(chunk:Buffer){const text=chunk.toString();process.stdout.write(text);output+=text;if(/^not ok /m.test(output))failed=true;if(output.includes('# Integration fixtures and server stopped.'))marker=true;if(marker&&expected>0&&(output.match(/^ok \d+ - /gm)||[]).length===expected&&!failed)void finishPassed();}
child.stdout.on('data',consume);child.stderr.on('data',chunk=>{process.stderr.write(chunk);output+=chunk.toString();});
async function terminateTree(){if(child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32'&&child.pid){try{await exec('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,timeout:5000});}catch{}}else child.kill('SIGTERM');}
function finishPassed(){if(complete)return;complete=true;setTimeout(()=>{console.log(`\nIntegração aprovada: ${expected}/${expected} testes passaram; os recursos de teste foram encerrados.`);process.exit(0);},250).unref();}
exitPromise=new Promise(resolve=>child.once('exit',code=>{if(complete)return resolve();if(code===0){complete=true;process.exitCode=0;}else{complete=true;process.exitCode=1;}resolve();}));
setTimeout(()=>{if(!complete){complete=true;void terminateTree().finally(()=>{console.error(`Integração interrompida. Estado da limpeza: ${marker?'concluída':'incompleta'}; testes aprovados: ${(output.match(/^ok \d+ - /gm)||[]).length}/${expected}.`);process.exitCode=1;});}},180000).unref();
