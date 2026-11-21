import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DashboardClient} from '../server/dashboard-client.mjs';
function fixture(){
 let time=Date.parse('2026-11-03T23:59:50Z'),failure=null,renewals=0;
 const secrets=new Map(),requests=[],denied=[];
 const account={identity:{sub:'user_a'},issuer:'https://clerk.example',clientId:'public',status(){return {phase:this.identity?'signed-in':'signed-out'};},accessCredential:()=> 'oauth-access',renew:async()=>{renewals++;}};
 const storeFactory=sub=>({read:async()=>secrets.get(sub)||null,write:async v=>secrets.set(sub,v),clear:async()=>secrets.delete(sub)});
 const client=new DashboardClient({account,storeFactory,autoTimer:false,now:()=>time,onDenied:m=>denied.push(m),fetchImpl:async(url,options)=>{
   requests.push({url,body:options.body,authorization:options.headers.Authorization});
   if(failure){const f=failure;failure=null;if(f==='network')throw Error('offline');return Response.json({error:'denied'}, {status:f});}
   return Response.json(url.endsWith('/enroll')?{deviceCredential:'a'.repeat(64)}:{plan:'pro',listeners:8,duplicate:false});
 }});
 return {client,account,secrets,requests,denied,advance:ms=>time+=ms,fail:v=>failure=v,renewals:()=>renewals};
}
test('versioned enrollment and zero report, cumulative counters across UTC midnight, pause/resume',async()=>{
 const f=fixture(),c=f.client;assert((await c.authorizeStart()).ok);
 assert(f.requests[0].url.endsWith('/v1/enroll'));assert.equal(f.requests[1].authorization,'Bearer oauth-access');
 assert.deepEqual(JSON.parse(f.requests[1].body).totals[0],{date:'2026-11-03',seconds:0,listenerSeconds:0,bytes:0});
 c.audio(1,2,80000);f.advance(11000);c.audio(1,2,80000);await c.stopped();
 const report=JSON.parse(f.requests.at(-1).body);assert.equal(report.live,false);assert.equal(report.totals.length,2);
 assert.equal(report.totals.reduce((n,t)=>n+t.seconds,0),2);assert.equal(report.totals.reduce((n,t)=>n+t.listenerSeconds,0),4);
 c.audio(1,2,80000);assert((await c.authorizeStart()).ok);c.audio(1,1,40000);await c.stopped();
 assert.equal(JSON.parse(f.requests.at(-1).body).totals.reduce((n,t)=>n+t.seconds,0),3);
 assert.equal(c.listenerLimit,8);assert.equal(c.plan,'pro');assert.equal(c.status().planKnown,true);assert(!JSON.stringify(c.status()).includes('aaaa'));
});
test('network and 503 retries preserve exact bytes and sequence while counters continue',async()=>{
 const f=fixture(),c=f.client;await c.authorizeStart();f.advance(15000);c.audio(1,1,40000);f.fail('network');await c.tick();const pending=f.requests.at(-1).body;
 c.audio(1,1,40000);f.advance(1000);f.fail(503);await c.tick();assert.equal(f.requests.at(-1).body,pending);
 f.advance(2000);await c.tick();assert.equal(f.requests.at(-1).body,pending);f.advance(15000);await c.tick();
 const next=JSON.parse(f.requests.at(-1).body);assert.equal(next.sequence,JSON.parse(pending).sequence+1);assert.equal(next.totals.reduce((n,t)=>n+t.seconds,0),2);
});
test('401 uses existing token renewal and retries identical report',async()=>{
 const f=fixture();await f.client.authorizeStart();f.advance(15000);f.fail(401);await f.client.tick();assert.equal(f.renewals(),1);assert.equal(f.requests.at(-1).body,f.requests.at(-2).body);
});
test('revocation blocks reporting and streaming until explicit reconnect with a new ID',async()=>{
 const f=fixture(),c=f.client;await c.authorizeStart();const old=JSON.parse(f.secrets.get('user_a')).device;
 f.advance(15000);f.fail(403);await c.tick();assert(c.status().reconnectRequired);const n=f.requests.length;
 f.advance(15000);await c.tick();assert.equal(f.requests.length,n);assert(!(await c.authorizeStart()).ok);
 await c.reconnectAfterSignIn({sub:f.account.identity.sub,status:403});assert.notEqual(JSON.parse(f.secrets.get('user_a')).device,old);assert(!c.status().reconnectRequired);assert(f.denied.length);
});
test('device/session limits never fall back to anonymous or silently enroll another device',async()=>{
 for(const stage of ['enroll','start']){const f=fixture();if(stage==='start')await f.client.tick();f.fail(409);assert(!(await f.client.authorizeStart()).ok);assert(f.client.blocked);const n=f.requests.length;await f.client.authorizeStart();assert.equal(f.requests.length,n);}
});
test('account scoping, process runs and anonymous Free streaming',async()=>{
 const f=fixture();await f.client.authorizeStart();await f.client.stopped();const run=f.client.run;
 f.account.identity={sub:'user_b'};await f.client.tick();assert(f.secrets.has('user_a'));assert(f.secrets.has('user_b'));assert.notEqual(f.client.run,run);
 f.account.identity=null;await f.client.tick();const count=f.requests.length;assert((await f.client.authorizeStart()).ok);assert.equal(f.requests.length,count);assert.equal(f.client.listenerLimit,3);
});
test('pending live retry is followed by a new stop report; lease timeout stops audio',async()=>{
 const f=fixture(),c=f.client;await c.authorizeStart();f.advance(15000);f.fail('network');await c.tick();const failed=f.requests.at(-1).body;
 await c.stopped();assert.equal(f.requests.at(-2).body,failed);assert.equal(JSON.parse(f.requests.at(-1).body).live,false);
 await c.authorizeStart();f.advance(30000);f.fail('network');await c.tick();assert(!c.live);assert(f.denied.length);
});
test('lost enrollment response retries original ID after process restart',async()=>{
 const f=fixture();f.fail('network');await f.client.tick();const id=JSON.parse(f.requests.at(-1).body).device;
 f.advance(1000);f.fail(409);await f.client.tick();assert.equal(JSON.parse(f.requests.at(-1).body).device,id);assert(f.client.blocked);
});
