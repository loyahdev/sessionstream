import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createStreamServer} from '../server/index.mjs';
import {awaitTunnelReady,resolveFreshTunnel} from '../server/tunnel-readiness.mjs';

test('managed helper never exposes a cached predecessor URL; readiness follows current tunnel',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sessionstream-cold-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(path.join(dir,'public-url.json'),JSON.stringify({url:'https://stale-dead.trycloudflare.com'}));
  const app=await createStreamServer({nativeSender:true,managedTunnel:true,runtimeDir:dir,publicPort:0,studioPort:0,udpPort:0});t.after(()=>app.close());
  const api=`http://127.0.0.1:${app.studioPort}/api/studio`,get=()=>fetch(api).then(r=>r.json());
  let state=await get();assert(!state.publicSiteReady);assert(!state.listenerURL.includes('stale-dead'));assert(state.listenerURL.startsWith('http://127.0.0.1:'));
  assert.equal((await fetch(`http://127.0.0.1:${app.publicPort}/health`).then(r=>r.json())).instance,app.instance);
  app.setTunnelState('verifying');state=await get();assert(!state.publicSiteReady);assert.equal(state.tunnelPhase,'verifying');
  app.setTunnelState('ready','https://current-ready.trycloudflare.com');state=await get();assert(state.publicSiteReady);assert(state.listenerURL.startsWith('https://current-ready.'));
  app.setTunnelState('retrying');state=await get();assert(!state.publicSiteReady);assert(!state.listenerURL.startsWith('https://'));
});
test('generate request retries acknowledge one invitation instead of invalidating the first link',async t=>{
  const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true});t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.studioPort}`,get=()=>fetch(base+'/api/studio').then(r=>r.json()),initial=await get();
  const post=requestId=>fetch(base+'/api/control',{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({action:'generate',source:123,requestId})});
  const id='0123456789abcdef0123456789abcdef';assert.equal((await post(id)).status,200);const first=await get();
  assert.equal((await post(id)).status,200);const repeated=await get();assert.equal(repeated.room,first.room);assert.equal(repeated.inviteRequest,id);
  assert.equal((await post('1123456789abcdef0123456789abcdef')).status,200);assert.notEqual((await get()).room,first.room);
});
test('tunnel readiness retries pending probes and requires two consecutive current-origin successes',async()=>{
  let calls=0;const outcomes=[false,false,true,false,true,true];
  assert(await awaitTunnelReady({url:'https://test.trycloudflare.com',instance:'ours',current:()=>true,probe:async()=>outcomes[calls++],browserProbe:async()=>true,sleep:async()=>{},attempts:10}));assert.equal(calls,6);
});
test('browser resolver is checked only after the new tunnel responds twice, and failed resolution keeps the link pending',async()=>{
  let direct=0,browser=0;
  assert(await awaitTunnelReady({url:'https://fresh.trycloudflare.com',instance:'ours',current:()=>true,probe:async()=>++direct>=2,browserProbe:async()=>{assert(direct>=3);return ++browser>=3;},sleep:async()=>{},attempts:10}));
  assert.equal(direct,5);assert.equal(browser,3);
});
test('a late browser-resolution check cannot advertise an exited tunnel',async()=>{
  let active=true;
  assert.equal(await awaitTunnelReady({url:'https://old.trycloudflare.com',instance:'ours',current:()=>active,probe:async()=>true,browserProbe:async()=>{active=false;return true;},sleep:async()=>{}}),false);
});
test('fresh tunnel lookup falls back to HTTPS if external UDP DNS is blocked',async()=>{
  let fallbacks=0;const options={lookup:async()=>{throw Error('UDP DNS blocked');},fallback:async host=>{assert.equal(host,'fresh.trycloudflare.com');fallbacks++;return ['104.16.231.132'];}};
  assert.deepEqual(await resolveFreshTunnel('fresh.trycloudflare.com',options),['104.16.231.132']);assert.equal(fallbacks,1);
  assert.deepEqual(await resolveFreshTunnel('fresh.trycloudflare.com',{...options,lookup:async()=>['104.16.230.132']}),['104.16.230.132']);assert.equal(fallbacks,1);
});
test('exited/replaced tunnel cannot publish a late successful probe',async()=>{
  let active=true;
  assert.equal(await awaitTunnelReady({url:'https://old.trycloudflare.com',instance:'ours',current:()=>active,probe:async()=>{active=false;return true;},sleep:async()=>{}}),false);
});
