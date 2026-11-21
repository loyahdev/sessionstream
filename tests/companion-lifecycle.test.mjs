import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const windowsBinary=name=>path.resolve(existsSync(`build-windows-x64/${name}.exe`)?`build-windows-x64/${name}.exe`:`build-windows-x64/Release/${name}.exe`);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function waitFor(read,description,timeout=12000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){try{const result=await read();if(result)return result;}catch{}await sleep(50);}
  throw Error(`Timed out: ${description}`);
}
async function fixture(t,{broker='off',fakeSource,requestTunnel=true}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'sessionstream-companion-'));
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const binary=path.join(dir,process.platform==='win32'?'fake-cloudflared.exe':'fake-cloudflared'),pidFile=path.join(dir,'tunnel.pid');
  // Real child process, with no public tunnel or account/network dependency.
  if(process.platform==='win32')await copyFile(process.env.SESSIONSTREAM_TEST_TUNNEL_BINARY||windowsBinary('fake-tunnel'),binary);
  else await writeFile(binary,fakeSource||`#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(process.env.SESSIONSTREAM_TEST_TUNNEL_PID,String(process.pid));\nsetInterval(()=>{},1000);\nprocess.on('SIGTERM',()=>process.exit(0));\n`,{mode:0o755});
  const helper=spawn(process.execPath,['--expose-gc','scripts/companion.mjs'],{env:{...process.env,SESSIONSTREAM_TUNNEL_BROKER:broker,PORT:'0',STUDIO_PORT:String(port),UDP_PORT:'0',CLOUDFLARED_PATH:binary,SESSIONSTREAM_STATE_DIR:dir,SESSIONSTREAM_TEST_TUNNEL_PID:pidFile,SESSIONSTREAM_SUPERVISOR_PATH:process.env.SESSIONSTREAM_SUPERVISOR_PATH||windowsBinary('windows-tunnel-supervisor')},stdio:['ignore','pipe','pipe']});
  let output='';helper.stdout.on('data',data=>output+=data);helper.stderr.on('data',data=>output+=data);
  const exit=new Promise(resolve=>helper.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{
    if(helper.exitCode===null&&helper.signalCode===null){helper.kill('SIGTERM');await Promise.race([exit,sleep(5000)]);}
    if(helper.exitCode===null&&helper.signalCode===null)helper.kill('SIGKILL');
    await rm(dir,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${port}`;
  const initial=await waitFor(()=>fetch(base+'/api/studio',{signal:AbortSignal.timeout(500)}).then(response=>response.json()),'helper local API');
  if(requestTunnel)await fetch(base+'/api/control',{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({action:'generate',source:1})});
  const tunnel=requestTunnel&&await waitFor(async()=>Number(await readFile(pidFile,'utf8')),'tunnel child PID').catch(error=>{throw Error(error.message+'\n'+output);});
  const post=(action,source=1)=>fetch(base+'/api/engine',{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({action,source})});
  return {helper,tunnel,base,post,exit,directory:dir,output:()=>output,initial};
}

test('last plugin detach terminates the real helper and its tunnel child; other enabled instances keep it alive',async t=>{
  const f=await fixture(t);
  await f.post('attach',1);await f.post('attach',2);await f.post('detach',1);
  await sleep(500);assert(alive(f.helper.pid));assert(alive(f.tunnel));
  await f.post('detach',2);const result=await f.exit;
  assert.equal(result.code,0,f.output());assert(!alive(f.helper.pid));assert(!alive(f.tunnel));
  const logs=await readFile(path.join(f.directory,'engine.log'),'utf8');
  assert(logs.includes('controller attached')&&logs.includes('controller detached')&&logs.includes('Stopping helper and tunnel'));
  await assert.rejects(fetch(f.base+'/health',{signal:AbortSignal.timeout(500)}));
});

test('DAW crash or lost controller heartbeats cannot leave the helper or tunnel running indefinitely',async t=>{
  const f=await fixture(t);await f.post('attach');
  const start=Date.now();const result=await f.exit;
  assert.equal(result.code,0,f.output());assert(Date.now()-start<8000);assert(!alive(f.tunnel));
});

test('removal during startup without any attached plugin shuts down both processes',async t=>{
  const f=await fixture(t);const result=await f.exit;
  assert.equal(result.code,0,f.output());assert(!alive(f.helper.pid));assert(!alive(f.tunnel));
});


test('failed managed connector falls back to Quick Tunnel without leaking its token into arguments or fallback', {skip:process.platform==='win32'},async t=>{
  const calls=[];
  const broker=http.createServer((req,res)=>{
    calls.push(req.method);res.setHeader('Content-Type','application/json');
    if(req.method==='POST')res.end(JSON.stringify({id:'12345678-1234-1234-1234-123456789012',token:'test-tunnel-secret',url:`http://127.0.0.1:${broker.address().port}/123456`}));
    else res.end(JSON.stringify({ok:true}));
  });
  await new Promise(resolve=>broker.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>broker.close(resolve)));
  const fakeSource=`#!/usr/bin/env node
import {writeFileSync,appendFileSync} from 'node:fs';
writeFileSync(process.env.SESSIONSTREAM_TEST_TUNNEL_PID,String(process.pid));
appendFileSync(process.env.SESSIONSTREAM_TEST_TUNNEL_PID+'.args',JSON.stringify({args:process.argv.slice(2),hasToken:!!process.env.TUNNEL_TOKEN})+String.fromCharCode(10));
if(process.env.TUNNEL_TOKEN)setTimeout(()=>process.exit(1),100);else setInterval(()=>{},1000);
process.on('SIGTERM',()=>process.exit(0));
`;
  const f=await fixture(t,{broker:`http://127.0.0.1:${broker.address().port}`,fakeSource});await f.post('attach');
  const generations=await waitFor(async()=>{const entries=(await readFile(path.join(f.directory,'tunnel.pid.args'),'utf8')).trim().split(String.fromCharCode(10)).map(JSON.parse);return entries.length>=2&&entries;},'Quick Tunnel fallback');
  assert(generations[0].args.includes('run'));assert(generations[0].hasToken);assert(!JSON.stringify(generations[0].args).includes('test-tunnel-secret'));
  assert(generations[1].args.includes('--url'));assert(!generations[1].hasToken);assert(calls.includes('DELETE'));
  await f.post('detach');await f.exit;
});


test('opening the local helper does not start a tunnel before the first invite request',async t=>{
  const f=await fixture(t,{requestTunnel:false});await f.post('attach');await sleep(400);
  assert(!existsSync(path.join(f.directory,'tunnel.pid')),'Idle helper unexpectedly started cloudflared');
  const response=await fetch(f.base+'/api/control',{method:'POST',headers:{Origin:f.base,Authorization:`Bearer ${f.initial.token}`},body:JSON.stringify({action:'generate',source:1})});assert.equal(response.status,200);
  const tunnel=await waitFor(async()=>Number(await readFile(path.join(f.directory,'tunnel.pid'),'utf8')),'requested tunnel');assert(alive(tunnel));
  await f.post('detach');assert.equal((await f.exit).code,0);assert(!alive(tunnel));
});
