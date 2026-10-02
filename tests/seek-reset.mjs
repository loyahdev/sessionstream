// Compiled processor/controller + real server + authenticated PCM listener.
// All endpoints are isolated; no public tunnel or user's installed helper is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import dgram from 'node:dgram';
import {WebSocket} from 'ws';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true,managedTunnel:true,managedLifetime:true});
app.setTunnelState('ready','https://seek-test.invalid');
const local=`http://127.0.0.1:${app.studioPort}`,publicURL=`http://127.0.0.1:${app.publicPort}`;
const state=()=>fetch(local+'/api/studio').then(r=>r.json());
const defaultProbe=process.platform==='win32'
  ? ['build-windows-x64/seek-reset.exe','build-windows-x64/Release/seek-reset.exe'].find(existsSync)
  : './build/seek-reset';
const child=spawn(process.env.SESSIONSTREAM_SEEK_PROBE||defaultProbe||'build-windows-x64/Release/seek-reset.exe',[local],{stdio:['pipe','pipe','pipe']});
let output='',ended=false,childError;
child.stdout.on('data',data=>{output+=data;process.stdout.write(data);});
child.stderr.on('data',data=>{output+=data;process.stderr.write(data);});
child.once('error',error=>{childError=error;ended=true;});
const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{ended=true;resolve({code,signal});}));
const sockets=[],udp=dgram.createSocket('udp4');let sequence=0;
async function waitFor(check,label,timeout=10000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(childError)throw childError;
    if(await check())return;
    if(ended)throw Error(`Probe exited while waiting for ${label}: ${output}`);
    await sleep(25);
  }
  throw Error(`Timed out: ${label}: ${output}`);
}
async function command(value,marker){
  const before=output.length;child.stdin.write(value+'\n');
  await waitFor(()=>output.slice(before).includes(marker),marker);
}
async function listener(room){
  const ws=new WebSocket(publicURL.replace('http:','ws:')+'/signal',{origin:publicURL});sockets.push(ws);
  ws.messages=[];ws.closeReason=null;
  ws.on('message',(data,binary)=>ws.messages.push(binary?{type:'binary',data}:JSON.parse(data)));
  ws.on('close',(code,reason)=>{ws.closeReason={code,reason:reason.toString()};console.log(`Listener closed: ${code} ${reason}`);});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  ws.send(JSON.stringify({type:'join',role:'listener',room,passcode:'seek-test-code'}));
  await waitFor(()=>ws.messages.some(m=>m.type==='joined'),'protected listener join');
  ws.send(JSON.stringify({type:'mode',mode:'pcm'}));await sleep(50);
  return ws;
}
async function receive(ws,source){
  const packet=tonePacket(sequence++,256,48000,source);
  const previous=ws.messages.filter(m=>m.type==='binary').length;
  udp.send(packet,app.udpPort,'127.0.0.1');
  await waitFor(()=>ws.messages.filter(m=>m.type==='binary').length>previous,'PCM after reset');
  assert.deepEqual(ws.messages.filter(m=>m.type==='binary').at(-1).data,packet);
}
try{
  await waitFor(()=>output.includes('READY'),'native protected stream');
  const initial=await state();assert(initial.live&&initial.passcodeRequired);assert.equal(initial.engineClients,1);
  const ws=await listener(initial.room);await receive(ws,initial.owner);
  for(const [value,marker] of [['reset','RESET_OK'],['reset','RESET_OK'],['reset','RESET_OK'],['reconfigure','RECONFIGURE_OK']]){
    await command(value,marker);
    const after=await state();
    assert.equal(ws.readyState,WebSocket.OPEN,'Seeking disconnected the authenticated listener');
    assert.equal(after.listenerURL,initial.listenerURL);assert.equal(after.room,initial.room);
    assert.equal(after.owner,initial.owner);assert.equal(after.engineClients,1);
    assert(after.live&&after.passcodeRequired);await receive(ws,after.owner);
  }
  console.log('PASS: repeated resets and transient reprepare preserve host activation, Send, engine lease, protected invite, listener socket and resumed PCM');
  await command('deactivate','DEACTIVATED');
  await waitFor(()=>ws.closeReason,'listener closure on real deactivation');
  assert.deepEqual(ws.closeReason,{code:4003,reason:'Host disabled or removed'});
  const disabled=await state();assert.equal(disabled.engineClients,0);assert(!disabled.live);assert.notEqual(disabled.room,initial.room);
  await command('activate','REACTIVATED');
  const active=await state();assert(active.live&&active.passcodeRequired);assert.notEqual(active.room,initial.room);
  const next=await listener(active.room);await receive(next,active.owner);
  await command('remove','REMOVED');assert.equal((await exit).code,0,output);
  // Destruction detaches synchronously before the probe exits.
  const removed=await state();assert.equal(removed.engineClients,0);assert(!removed.live);
  await sleep(50);assert.deepEqual(next.closeReason,{code:4003,reason:'Host disabled or removed'});
  console.log('PASS: real deactivation and plugin removal still revoke the invite; reactivation restores protection');
}finally{
  if(!ended){child.kill('SIGTERM');await Promise.race([exit,sleep(2000)]);}
  for(const ws of sockets)ws.terminate();udp.close();await app.close();
}
