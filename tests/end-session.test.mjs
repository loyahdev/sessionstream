import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createStreamServer} from '../server/index.mjs';
test('Pause preserves an invite and its listeners; End disconnects everyone and revokes the old room',async()=>{
 let now=Date.now();const account={identity:null,ready:Promise.resolve(),status:()=>({phase:'signed-out'}),close(){}};
 const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},ignoreStoredURL:true,now:()=>now});let ws,old;
 const local=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}`,status=async()=>(await fetch(local+'/api/studio')).json();const initial=await status();
 const command=async(action,more={})=>{const r=await fetch(local+'/api/control',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({source:54321,action,...more})});return r.status;};
 try{
  assert.equal(await command('generate'),200);const room=(await status()).room;assert.equal((await status()).expiresAt,0);await command('start');
  ws=new WebSocket(remote.replace('http:','ws:')+'/signal',{origin:remote});await once(ws,'open');const joined=once(ws,'message');ws.send(JSON.stringify({type:'join',role:'listener',room,mode:'pcm'}));await joined;
  assert.equal(await command('end',{source:999}),403);assert((await status()).live);
  await command('stop');let s=await status();assert.equal(s.room,room);assert.equal(s.listeners,1);assert.equal(ws.readyState,WebSocket.OPEN);
  await command('start');s=await status();assert.equal(s.room,room);assert.equal(s.listeners,1);assert(s.live);
  now+=365*24*3600000;assert.equal((await status()).inviteExpired,false);
  const closed=once(ws,'close');assert.equal(await command('end'),200);assert.equal((await closed)[0],4012);s=await status();assert.equal(s.live,false);assert.equal(s.inviteSource,null);assert.notEqual(s.room,room);assert.equal(s.streamStartedAt,0);
  assert.equal(await command('end'),200,'End retries must be idempotent');
  assert.equal((await fetch(remote+'/api/invite',{method:'POST',body:JSON.stringify({room})})).status,403);
  old=new WebSocket(remote.replace('http:','ws:')+'/signal',{origin:remote});await once(old,'open');const rejected=once(old,'close');old.send(JSON.stringify({type:'join',role:'listener',room}));assert.equal((await rejected)[0],4003);
  await command('generate');await command('start');s=await status();assert(s.live);assert.notEqual(s.room,room);
  const pausedRoom=s.room;await command('stop');assert.equal(await command('end'),200);assert.equal((await status()).inviteSource,null);assert.equal((await fetch(remote+'/api/invite',{method:'POST',body:JSON.stringify({room:pausedRoom})})).status,403);
 }finally{ws?.terminate();old?.terminate();await app.close();}
});
