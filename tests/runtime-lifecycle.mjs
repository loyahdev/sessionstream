// Actual plugin + bundled helper + real Cloudflare child; run with no DAW stream.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const plugin=process.env.PLUGIN_PATH||'build/SessionStream_artefacts/Release/VST3/SessionStream.vst3';
const report={testedAt:new Date().toISOString(),plugin,checks:[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const base='http://127.0.0.1:8788';
async function waitFor(read,description,timeout=85000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){try{const result=await read();if(result)return result;}catch{}await sleep(100);}
  throw Error(`Timed out: ${description}`);
}
const state=()=>fetch(base+'/api/studio',{signal:AbortSignal.timeout(700)}).then(response=>response.json());
async function running(previous){return waitFor(async()=>{const s=await state();return s.enginePID!==previous&&s.tunnelPID&&s.publicSiteReady&&s.live&&s.audio?s:null;},'fresh live helper and invite');}
async function stopped(s,reason){
  const start=Date.now();await waitFor(()=>!alive(s.enginePID)&&!alive(s.tunnelPID),reason,12000);
  await assert.rejects(fetch(base+'/health',{signal:AbortSignal.timeout(500)}));
  report.checks.push({name:reason,result:'PASS',elapsedMs:Date.now()-start});
}
try{await state();throw Error('Stop the existing SessionStream engine before this test');}
catch(error){if(error.message.startsWith('Stop the existing'))throw error;}
let host,output='';
try{
  host=spawn('./build/vst3-probe',[path.resolve(plugin),'600'],{stdio:['pipe','pipe','pipe']});
  host.stdout.on('data',data=>{output+=data;process.stdout.write(data);});host.stderr.on('data',data=>{output+=data;process.stderr.write(data);});
  let s=await running();const first=s.listenerURL;
  report.checks.push({name:'Actual plugin launches bundled helper, live audio and worldwide invite',result:'PASS'});
  host.stdin.write('send 0\n');await waitFor(async()=>!(await state()).live,'paused broadcast');
  await sleep(6000);const paused=await state();assert.equal(paused.enginePID,s.enginePID);assert.equal(paused.tunnelPID,s.tunnelPID);assert.equal(paused.listenerURL,first);
  report.checks.push({name:'Stop streaming retains the enabled engine, tunnel and invite beyond the crash lease',result:'PASS'});
  host.stdin.write('send 1\n');s=await running();assert.equal(s.listenerURL,first);
  host.stdin.write('reset\n');await sleep(1000);
  const reset=await state();assert.equal(reset.enginePID,s.enginePID);assert.equal(reset.tunnelPID,s.tunnelPID);assert.equal(reset.listenerURL,first);assert(reset.live);
  report.checks.push({name:'Audio reset/seek preserves helper, tunnel, live stream and invite',result:'PASS'});
  host.stdin.write('bypass 1\n');await stopped(s,'Host bypass stops helper and tunnel');
  host.stdin.write('bypass 0\n');s=await running(s.enginePID);assert.notEqual(s.listenerURL,first);
  report.checks.push({name:'Unbypass restarts with a fresh invite',result:'PASS'});
  host.stdin.write('suspend 1\n');await sleep(6000);const idle=await state();assert.equal(idle.enginePID,s.enginePID);assert.equal(idle.listenerURL,s.listenerURL);
  report.checks.push({name:'Enabled idle track without render callbacks preserves engine and invite',result:'PASS'});
  host.stdin.write('suspend 0\n');s=await running();
  host.stdin.write('deactivate\n');await stopped(s,'Host deactivation stops helper and tunnel');
  host.stdin.write('activate\n');s=await running(s.enginePID);
  const exit=new Promise(resolve=>host.once('exit',code=>resolve(code)));
  host.stdin.write('remove\n');assert.equal(await exit,0,output);await stopped(s,'Removing plugin destroys helper and tunnel');
  // A second host is terminated without destructors to exercise the safety lease.
  host=spawn('./build/vst3-probe',[path.resolve(plugin),'180'],{stdio:['pipe','pipe','pipe']});
  host.stdout.on('data',data=>output+=data);host.stderr.on('data',data=>output+=data);
  s=await running();host.kill('SIGKILL');await stopped(s,'Host crash expires lease and destroys helper and tunnel');
  report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack;process.exitCode=1;}
finally{if(host&&host.exitCode===null&&host.signalCode===null)host.kill('SIGTERM');await writeFile('artifacts/runtime-lifecycle-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
