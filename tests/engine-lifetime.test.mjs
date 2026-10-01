import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {EngineLifetime} from '../server/engine-lifetime.mjs';
import {createStreamServer} from '../server/index.mjs';

test('abandoned startup and vanished plugin heartbeats expire without listener keep-alives',()=>{
  let now=0;const lease=new EngineLifetime({now:()=>now});
  assert(!lease.poll().idle);now=8000;assert(lease.poll().idle);
  lease.attach(1);now=12999;assert(!lease.poll().idle);
  now=13000;assert.deepEqual(lease.poll(),{expired:[1],idle:true});
});

test('removing one plugin preserves the helper for another enabled plugin',()=>{
  let now=0;const lease=new EngineLifetime({now:()=>now});
  lease.attach(1);lease.attach(2);lease.detach(1);assert(!lease.poll().idle);
  now=4000;lease.attach(2);now=6000;assert(!lease.poll().idle);
  lease.detach(2);assert(lease.poll().idle);
});

test('private engine leases invalidate a removed owner invite, protect other instances and signal idle shutdown',async t=>{
  let idleResolve;const idle=new Promise(resolve=>idleResolve=resolve);
  const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true,managedLifetime:true,onNoClients:idleResolve});
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.studioPort}`,publicURL=`http://127.0.0.1:${app.publicPort}`;
  const initial=await fetch(base+'/api/studio').then(r=>r.json());
  const post=(endpoint,action,source,headers={})=>fetch(base+endpoint,{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`,...headers},body:JSON.stringify({action,source})});
  assert.equal((await post('/api/engine','attach',1,{Authorization:'Bearer invalid'})).status,403);
  assert.equal((await fetch(publicURL+'/api/engine',{method:'POST'})).status,403);
  assert.equal((await post('/api/engine','attach',1,{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/engine','attach',-1)).status,400);
  for(const source of [1,2])assert.equal((await post('/api/engine','attach',source)).status,200);
  await post('/api/control','generate',1);
  const invite=await fetch(base+'/api/studio').then(r=>r.json());
  const listener=new WebSocket(publicURL.replace('http:','ws:')+'/signal',{origin:publicURL});
  t.after(()=>listener.terminate());
  await new Promise((resolve,reject)=>{listener.once('open',resolve);listener.once('error',reject);});
  const joined=new Promise(resolve=>listener.on('message',data=>{if(JSON.parse(data).type==='joined')resolve();}));
  listener.send(JSON.stringify({type:'join',role:'listener',room:invite.room}));await joined;
  const closed=new Promise(resolve=>listener.once('close',code=>resolve(code)));
  await post('/api/engine','detach',1);assert.equal(await closed,4003);
  const state=await fetch(base+'/api/studio').then(r=>r.json());
  assert.equal(state.engineClients,1);assert.notEqual(state.room,invite.room);assert.equal(state.inviteSource,null);assert(!state.live);
  await new Promise(resolve=>setTimeout(resolve,350));assert.equal((await fetch(publicURL+'/health')).status,200);
  await post('/api/engine','detach',2);await idle;
});

test('an unresponsive controller releases its invite and permits managed helper shutdown',async t=>{
  let idleResolve;const idle=new Promise(resolve=>idleResolve=resolve);
  const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true,managedLifetime:true,lifetimeOptions:{leaseMs:350,startupMs:1000},onNoClients:idleResolve});
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.studioPort}`,initial=await fetch(base+'/api/studio').then(r=>r.json());
  const post=(endpoint,action)=>fetch(base+endpoint,{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({action,source:42})});
  await post('/api/engine','attach');await post('/api/control','generate');await post('/api/control','start');
  // Public health requests do not count as an enabled plugin heartbeat.
  await fetch(`http://127.0.0.1:${app.publicPort}/health`);await idle;
  const state=await fetch(base+'/api/studio').then(r=>r.json());assert(!state.live);assert.equal(state.engineClients,0);assert.equal(state.inviteSource,null);
});
