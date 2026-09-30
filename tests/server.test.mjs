import {test} from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {WebSocket} from 'ws';
import {createStreamServer} from '../server/index.mjs';
import {parsePacket,tonePacket} from '../server/protocol.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function socket(port){return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/signal`,{origin:`http://127.0.0.1:${port}`});ws.once('open',()=>resolve(ws));ws.once('error',reject);});}
function waitFor(ws,type){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.off('message',on);reject(Error(`Timeout: ${type}`));},3000);function on(data,binary){if(binary)return;const m=JSON.parse(data);if(m.type===type){clearTimeout(timeout);ws.off('message',on);resolve(m);}}ws.on('message',on);});}
test('packet parser rejects invalid lengths, versions, channel count and sample rate',()=>{
  assert.equal(parsePacket(tonePacket(1)).channels,2);
  assert.equal(parsePacket(tonePacket(2).subarray(0,100)),null);
  for(const [offset,val,method] of [[8,22050,'writeUInt32LE'],[14,1,'writeUInt16LE'],[20,2,'writeUInt32LE']]){const b=tonePacket(0);b[method](val,offset);assert.equal(parsePacket(b),null);}
});
test('private publisher, capability invite, stereo relay, source isolation and shutdown',async t=>{
  const app=await createStreamServer({publicPort:0,studioPort:0,udpPort:0});t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.publicPort}`,local=`http://127.0.0.1:${app.studioPort}`;
  assert.equal((await fetch(`${base}/api/studio`)).status,404);
  assert.equal((await fetch(`${base}/studio`)).status,404);
  assert.equal((await fetch(`${local}/api/studio`,{headers:{'cf-connecting-ip':'1.2.3.4'}})).status,403);
  const session=await fetch(`${local}/api/studio`).then(r=>r.json());
  const attacker=await socket(app.publicPort);let closed=new Promise(r=>attacker.once('close',code=>r(code)));
  attacker.send(JSON.stringify({type:'join',role:'publisher',token:session.token}));assert.equal(await closed,4003);
  const bad=await socket(app.publicPort);closed=new Promise(r=>bad.once('close',code=>r(code)));
  bad.send(JSON.stringify({type:'join',role:'listener',room:'é'.repeat(48)}));assert.equal(await closed,4003);
  const publisher=await socket(app.studioPort);let ready=waitFor(publisher,'joined');publisher.send(JSON.stringify({type:'join',role:'publisher',token:session.token}));await ready;
  const listener=await socket(app.publicPort);ready=waitFor(listener,'joined');const arrival=waitFor(publisher,'peer-joined');listener.send(JSON.stringify({type:'join',role:'listener',room:session.room}));await ready;const peer=await arrival;
  const offer=waitFor(listener,'offer');publisher.send(JSON.stringify({type:'offer',to:peer.id,sdp:{type:'offer',sdp:'test'}}));assert.equal((await offer).sdp.sdp,'test');
  listener.send(JSON.stringify({type:'mode',mode:'pcm'}));publisher.send(JSON.stringify({type:'publishing',live:true,title:'Test studio'}));await delay(30);
  const udp=dgram.createSocket('udp4');t.after(()=>udp.close());
  const binary=new Promise(resolve=>listener.once('message',(data,isBinary)=>{if(isBinary)resolve(data);else listener.on('message',function on(d,b){if(b){listener.off('message',on);resolve(d);}});}));
  const packet=tonePacket(4);udp.send(packet,app.udpPort,'127.0.0.1');assert.deepEqual(await binary,packet);
  let binaryCount=0;listener.on('message',(d,b)=>{if(b)binaryCount++;});
  udp.send(tonePacket(5,256,48000,9876),app.udpPort,'127.0.0.1');await delay(50);assert.equal(binaryCount,0);
  publisher.send(JSON.stringify({type:'publishing',live:false}));await delay(30);udp.send(tonePacket(6),app.udpPort,'127.0.0.1');await delay(50);assert.equal(binaryCount,0);
  const rotate=await fetch(`${local}/api/rotate`,{method:'POST',headers:{Authorization:`Bearer ${session.token}`,Origin:local}});assert.equal(rotate.status,200);
  const changed=await fetch(`${local}/api/studio`).then(r=>r.json());assert.notEqual(session.room,changed.room);
});
