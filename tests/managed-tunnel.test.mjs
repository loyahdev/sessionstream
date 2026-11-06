import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acquireManagedTunnel,inviteRevision} from '../server/managed-tunnel.mjs';
import {TunnelBroker} from '../services/tunnel-broker/worker.mjs';
import {createStreamServer} from '../server/index.mjs';
import {WebSocket} from 'ws';

function fixture(){
  const values=new Map(),calls=[];
  const storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},async delete(k){for(const key of Array.isArray(k)?k:[k])values.delete(key);},async list({prefix='',limit=10000}={}){return new Map([...values].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([k,v])=>[k,structuredClone(v)]));},async setAlarm(at){this.alarm=at;},async transaction(fn){return fn(this);}};
  const env={CF_ACCOUNT_ID:'account',CF_ZONE_ID:'zone',CF_API_TOKEN:'account-secret',PUBLIC_ORIGIN:'https://sessionstream.app',TUNNEL_DOMAIN:'sessionstream.app',MAX_LEASES:'2',ALLOCATIONS_PER_HOUR:'5',
    async CF_FETCH(url,options){
      calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
      if(env.fail&&url.endsWith(env.fail))return Response.json({success:false},{status:503});
      let result={};
      if(options.method==='POST'&&url.endsWith('/cfd_tunnel'))result={id:crypto.randomUUID()};
      if(options.method==='POST'&&url.endsWith('/dns_records'))result={id:crypto.randomUUID()};
      if(url.endsWith('/token'))result='eyJtunnel-token';
      if(url.includes('?'))result=[];
      return Response.json({success:true,result});
    }};
  const broker=new TunnelBroker({storage},env);
  const request=async(url,options)=>{const headers=new Headers(options.headers);headers.set('cf-connecting-ip','192.0.2.1');return broker.fetch(new Request(url,{...options,headers}));};
  return {broker,env,storage,values,calls,request};
}

test('account broker provisions separate tunnels, renews, rotates code, and deletes only the leased resources',async()=>{
  const f=fixture(),a=await acquireManagedTunnel({port:12345,room:'first',request:f.request}),b=await acquireManagedTunnel({port:12346,room:'other',request:f.request});
  assert.notEqual(a.id,b.id);assert.notEqual(a.url,b.url);assert.match(a.url,/^https:\/\/sessionstream\.app\/\d{6}$/);
  const config=f.calls.find(c=>c.url.endsWith('/configurations')).body.config;
  assert.equal(config.ingress[0].service,'http://127.0.0.1:12345');assert.equal(config.ingress[1].service,'http_status:404');
  const lookup=url=>f.broker.fetch(new Request(`https://sessionstream.app/resolve/${url.split('/').at(-1)}`));
  assert.equal((await lookup(a.url)).status,200);
  const original=a.url;await a.renew('first');assert.equal(a.url,original);
  await a.renew('rotated');assert.notEqual(a.url,original);assert.equal((await lookup(original)).status,404);
  assert.equal((await lookup(a.url)).status,200);
  const denied=await f.broker.fetch(new Request(`https://sessionstream.app/v1/leases/${a.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${'a'.repeat(64)}`}}));assert.equal(denied.status,404);
  await a.release();assert.equal((await lookup(a.url)).status,404);assert.equal((await lookup(b.url)).status,200);
  assert(f.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/connections')));
  assert.equal((await f.storage.list({prefix:'lease:'})).size,1);
});
test('capacity, partial provisioning errors, and abandoned leases fail safely and reclaim capacity',async()=>{
  const f=fixture();f.env.MAX_LEASES='1';
  const lease=await acquireManagedTunnel({port:12345,room:'x',request:f.request});
  await assert.rejects(acquireManagedTunnel({port:12346,room:'y',request:f.request}));
  for(const [key,value] of f.values)if(key.startsWith('lease:')){value.expires=0;f.values.set(key,value);}
  await f.broker.alarm();assert.equal((await f.storage.list({prefix:'lease:'})).size,0);
  f.env.fail='/configurations';await assert.rejects(acquireManagedTunnel({port:12345,room:'z',request:f.request}));
  assert.equal((await f.storage.list({prefix:'lease:'})).size,0);
  assert(f.calls.some(c=>c.method==='DELETE'&&c.url.includes('/cfd_tunnel/')));
  assert.equal(lease.token,'eyJtunnel-token');
});
test('anonymous allocation is bounded per IP and does not allow arbitrary origin services',async()=>{
  const f=fixture();f.env.MAX_LEASES='20';
  for(let i=0;i<5;i++){const a=await acquireManagedTunnel({port:12345,room:String(i),request:f.request});await a.release();}
  await assert.rejects(acquireManagedTunnel({port:12345,room:'sixth',request:f.request}));
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/cfd_tunnel')).length,5);
  const request=new Request('https://sessionstream.app/v1/leases',{method:'POST',headers:{Authorization:`Bearer ${'a'.repeat(64)}`,'cf-connecting-ip':'192.0.2.2'},body:JSON.stringify({port:80,revision:inviteRevision('x')})});
  assert.equal((await f.broker.fetch(request)).status,400);
});
test('client rejects insecure/foreign broker URLs and never follows a provisioning redirect',async()=>{
  await assert.rejects(acquireManagedTunnel({port:12345,room:'x',broker:'http://example.com'}));
  assert.equal(await acquireManagedTunnel({port:12345,room:'x',broker:'off'}),null);
  await assert.rejects(acquireManagedTunnel({port:12345,room:'x',request:async(url,options)=>{assert.equal(options.redirect,'error');return Response.json({id:crypto.randomUUID(),token:'secret',url:'https://foreign.example/123456'});}}));
});
test('six-digit listener paths load assets, embed current invite, upgrade sockets, and invalidate old codes immediately',async t=>{
  const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0});t.after(()=>app.close());
  const local=`http://127.0.0.1:${app.studioPort}`,publicBase=`http://127.0.0.1:${app.publicPort}`;
  app.setTunnelState('ready','https://sessionstream.app/123456');
  const studio=await fetch(local+'/api/studio').then(r=>r.json());assert.equal(studio.listenerURL,'https://sessionstream.app/123456');assert(studio.publicSiteReady);
  const page=await fetch(publicBase+'/123456').then(r=>r.text());assert(page.includes(`data-room="${studio.room}"`));assert(page.includes('src="/123456/app.mjs"'));assert(page.includes('href="/123456/style.css"'));
  for(const file of ['app.mjs','audio.mjs','pcm-worklet.mjs','style.css','health'])assert.equal((await fetch(`${publicBase}/123456/${file}`)).status,200,file);
  assert.equal((await fetch(publicBase+'/654321')).status,404);assert.equal((await fetch(publicBase+'/123456/api/studio')).status,404);
  const socket=new WebSocket(`ws://127.0.0.1:${app.publicPort}/123456/signal`,{origin:publicBase});t.after(()=>socket.terminate());await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  await fetch(local+'/api/rotate',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${studio.token}`}});
  assert.equal((await fetch(publicBase+'/123456')).status,404);assert.equal((await fetch(local+'/api/studio').then(r=>r.json())).publicSiteReady,false);
  app.setTunnelState('ready','https://sessionstream.app/654321');assert.equal((await fetch(publicBase+'/654321')).status,200);
  // Quick Tunnel invites still rotate without reprovisioning their hostname.
  app.setTunnelState('ready','https://quick.trycloudflare.com');await fetch(local+'/api/rotate',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${studio.token}`}});
  const quick=await fetch(local+'/api/studio').then(r=>r.json());assert(quick.publicSiteReady);assert(quick.listenerURL.startsWith('https://quick.trycloudflare.com/listen#'));
});

test('public Worker routes the code prefix, translates only a valid Origin, and strips credentials',async t=>{
  const {default:worker}=await import('../services/tunnel-broker/worker.mjs');
  let upstream,lookups=0;
  const env={PUBLIC_ORIGIN:'https://sessionstream.app',LINK_LIMITER:{async limit(){return {success:true};}},BROKER:{idFromName(){return 'id';},get(){return {async fetch(){lookups++;return Response.json({hostname:'t-private.sessionstream.app'});}};}}};
  t.mock.method(globalThis,'fetch',async(request,options)=>{upstream={url:request.url,headers:options.headers};return new Response('ok');});
  const response=await worker.fetch(new Request('https://sessionstream.app/123456/health',{headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer should-not-forward',Cookie:'private-cookie'}}),env);
  assert.equal(response.status,200);assert.equal(upstream.url,'https://t-private.sessionstream.app/123456/health');assert.equal(upstream.headers.get('origin'),'https://t-private.sessionstream.app');assert.equal(upstream.headers.get('authorization'),null);assert.equal(upstream.headers.get('cookie'),null);
  assert.equal((await worker.fetch(new Request('https://sessionstream.app/123456/signal',{headers:{Origin:'https://foreign.example'}}),env)).status,403);
  env.LINK_LIMITER.limit=async()=>({success:false});const before=lookups;
  assert.equal((await worker.fetch(new Request('https://sessionstream.app/000001'),env)).status,429);assert.equal(lookups,before);
});


test('warm tunnel pool skips hostname creation on the request path and never reuses a released connector',async()=>{
  const f=fixture();f.env.MAX_LEASES='4';f.env.WARM_POOL_SIZE='2';
  await f.broker.alarm();
  const spares=[...(await f.storage.list({prefix:'lease:'})).values()];assert.equal(spares.length,2);assert(spares.every(l=>l.kind==='pool'));assert.equal((await f.storage.list({prefix:'code:'})).size,0);
  const before=f.calls.length;await assert.rejects(acquireManagedTunnel({port:12345,room:'first',request:f.request}));assert.equal(f.calls.length,before,'Warming pool must fail quickly without creating another cold route');
  for(const [key,value] of f.values)if(key.startsWith('lease:')){value.readyAt=Date.now()-1;f.values.set(key,value);}
  const lease=await acquireManagedTunnel({port:12345,room:'first',request:f.request});
  assert(spares.some(s=>s.id===lease.id));assert.deepEqual(f.calls.slice(before).map(c=>c.method),['PUT','GET']);
  await lease.release();assert(!f.values.has(`lease:${lease.id}`));
  await f.broker.alarm();assert.equal((await f.storage.list({prefix:'lease:'})).size,2);assert(!f.values.has(`lease:${lease.id}`));
});
test('listener route lookups do not queue behind another tunnel provisioning request',async()=>{
  const f=fixture(),a=await acquireManagedTunnel({port:12345,room:'first',request:f.request});
  const original=f.env.CF_FETCH;let unblock,entered;
  const gate=new Promise(r=>unblock=r),waiting=new Promise(r=>entered=r);
  f.env.CF_FETCH=async(url,options)=>{if(url.endsWith('/configurations')){entered();await gate;}return original(url,options);};
  const next=acquireManagedTunnel({port:12346,room:'second',request:f.request});await waiting;
  let timer;
  try{
    const response=await Promise.race([f.broker.fetch(new Request(`https://sessionstream.app/resolve/${a.url.split('/').at(-1)}`)),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Route lookup blocked by provisioning')),300))]);
    assert.equal(response.status,200);
  }finally{clearTimeout(timer);unblock();const b=await next;await b.release();await a.release();}
});


test('product assets cannot replace API or six-digit session routes',async()=>{
  const {default:worker}=await import('../services/tunnel-broker/worker.mjs');
  const assets=[],routes=[];
  const env={PUBLIC_ORIGIN:'https://sessionstream.app',CF_API_TOKEN:'test-only',ASSETS:{async fetch(request){const path=new URL(request.url).pathname;assets.push(path);return new Response(path==='/'?'<h1>Product</h1>':'Missing',{status:path==='/'?200:404,headers:{'Content-Type':'text/html'}});}},LINK_LIMITER:{async limit(){return {success:true};}},BROKER:{idFromName(){return 'account';},get(){return {async fetch(request){const path=new URL(request.url).pathname;routes.push(path);return Response.json({}, {status:path.startsWith('/resolve/')?404:401});}};}}};
  const request=path=>worker.fetch(new Request('https://sessionstream.app'+path),env);
  const home=await request('/');assert.equal(home.status,200);assert((await home.text()).includes('Product'));assert(home.headers.get('Content-Security-Policy').includes("script-src 'self'"));assert(!home.headers.get('Content-Security-Policy').includes("script-src 'unsafe-inline'"));
  assert.equal((await request('/missing')).status,404);assert.equal((await request('/123456')).status,404);assert.equal((await request('/v1/leases')).status,401);assert.equal((await request('/health')).status,200);
  assert.deepEqual(assets,['/']);assert.deepEqual(routes,['/resolve/missing','/resolve/123456','/v1/leases']);
});
