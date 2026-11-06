import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createStreamServer} from '../server/index.mjs';
test('native invites enforce quality, expiry, existing-listener disconnect and explicit renewal',async()=>{
 let now=1000000;
 const account={identity:null,ready:Promise.resolve(),status:()=>({phase:'signed-out'}),close(){}};
 const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},now:()=>now});
 const base=`http://127.0.0.1:${app.studioPort}`,publicBase=`http://127.0.0.1:${app.publicPort}`;let ws;
 const status=async()=> (await fetch(base+'/api/studio')).json();const initial=await status();
 const command=async body=>{const res=await fetch(base+'/api/control',{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({source:54321,...body})});return {code:res.status,data:await res.json()};};
 try{
  const requestId='a'.repeat(32);assert.equal((await command({action:'generate',requestId,quality:'phone',expiresInHours:1})).code,200);let s=await status();const room=s.room;assert.equal(s.quality,'phone');assert.equal(s.expiresAt,now+3600000);
  assert.equal((await command({action:'start'})).code,200);s=await status();assert.equal(s.streamStartedAt,now);now+=1000;assert.equal((await status()).streamStartedAt,1000000);
  ws=new WebSocket(publicBase.replace('http:','ws:')+'/signal',{origin:publicBase});await once(ws,'open');const joined=once(ws,'message');ws.send(JSON.stringify({type:'join',role:'listener',room,mode:'pcm'}));await joined;
  const closed=once(ws,'close');now=1000000+3600000;s=await status();assert(s.inviteExpired);assert.equal(s.live,false);assert.equal((await closed)[0],4011);
  const expired=await fetch(publicBase+'/api/invite',{method:'POST',body:JSON.stringify({room})});assert.equal(expired.status,410);assert.equal((await command({action:'start'})).code,410);
  await command({action:'generate',requestId,quality:'phone',expiresInHours:1});assert((await status()).inviteExpired,'A retry must not renew an expired invite');
  await command({action:'generate',requestId:'b'.repeat(32),quality:'balanced',expiresInHours:0});s=await status();assert(!s.inviteExpired);assert.notEqual(s.room,room);assert.equal(s.quality,'balanced');assert.equal(s.expiresAt,0);
  const revision=s.room;assert.equal((await command({action:'generate',quality:'bad',expiresInHours:1})).code,400);assert.equal((await status()).room,revision);
 }finally{ws?.terminate();await app.close();}
});
