import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TunnelBroker} from '../services/tunnel-broker/worker.mjs';
import {acquireManagedTunnel} from '../server/managed-tunnel.mjs';
import {LinkAuthorization} from '../server/link-auth.mjs';
function fixture(){
 const values=new Map();const storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},async delete(k){for(const v of Array.isArray(k)?k:[k])values.delete(v);},async list({prefix=''}){return new Map([...values].filter(([k])=>k.startsWith(prefix)));},async setAlarm(){},async transaction(fn){return fn(this);}};
 const env={PUBLIC_ORIGIN:'https://sessionstream.app',CF_ACCOUNT_ID:'account',CF_ZONE_ID:'zone',CF_API_TOKEN:'secret',TUNNEL_DOMAIN:'sessionstream.app',MAX_LEASES:'10',ALLOCATIONS_PER_HOUR:'100',
 async CF_FETCH(url,options){return Response.json({success:true,result:url.endsWith('/token')?'tunnel-token':options.method==='POST'?{id:crypto.randomUUID()}:url.includes('?')?[]:{}});},
 async AUTH_FETCH(url,options){assert.equal(options.redirect,'manual');if(url.endsWith('/oauth/token')){assert.equal(options.body.has('client_secret'),false);assert(options.body.get('code_verifier'));return Response.json({access_token:'broker-owned-clerk-token'});}assert.equal(options.headers.Authorization,'Bearer broker-owned-clerk-token');return Response.json({sub:'user_authorized'});}};
 const broker=new TunnelBroker({storage},env);
 const request=(path,options={})=>broker.fetch(new Request(new URL(path,env.PUBLIC_ORIGIN),{...options,headers:{'cf-connecting-ip':'192.0.2.1',...Object.fromEntries(new Headers(options.headers))}}));
 const addUser=async(user,n)=>{const token=n.repeat(64);await storage.put(`link-session:${createHash('sha256').update(`Bearer ${token}`).digest('hex')}`,{user,expires:Date.now()+86400000});return token;};
 const links=(token,method='GET',name)=>request('/v1/links',{method,headers:{Authorization:`Bearer ${token}`},...(name?{body:JSON.stringify({name})}:{})});
 return {values,storage,env,broker,request,addUser,links};
}
test('simultaneous claims have one winner, and failed rename preserves the existing claim',async()=>{
 const f=fixture(),a=await f.addUser('a','a'),b=await f.addUser('b','b');
 const claims=await Promise.all([f.links(a,'PUT','Studio-One'),f.links(b,'PUT','studio-one')]);
 assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
 assert.equal((await (await f.links(a)).json()).name,'studio-one');
 assert.equal((await f.links(b,'PUT','other-room')).status,200);
 assert.equal((await f.links(a,'PUT','other-room')).status,409);
 assert.equal((await (await f.links(a)).json()).name,'studio-one');
 assert.equal((await f.links(a,'PUT','new-room')).status,200);
 assert.equal(f.values.has('name:studio-one'),false);assert.equal(f.values.get('name:new-room'),'a');
 assert.equal((await f.links(b,'PUT','studio-one')).status,200);assert.equal(f.values.has('name:other-room'),false);
});
test('claimed links survive session removal; routing always checks the current owner',async()=>{
 const f=fixture(),token=await f.addUser('a','a');await f.links(token,'PUT','my-studio');let selection={name:'my-studio',token};
 const lease=await acquireManagedTunnel({port:12345,room:'first',request:f.request,custom:()=>selection});
 assert.equal(lease.url,'https://sessionstream.app/my-studio');
 const resolve=name=>f.request(`/resolve/${name}`);
 assert.equal((await resolve('my-studio')).status,200);
 await lease.renew('second');assert.equal(lease.url,'https://sessionstream.app/my-studio');
 await f.links(token,'PUT','new-studio');assert.equal((await resolve('my-studio')).status,404);
 await lease.renew('second');assert.equal(lease.url,'https://sessionstream.app/new-studio');
 const other=await f.addUser('b','b');await f.links(other,'PUT','my-studio');assert.equal((await resolve('my-studio')).status,404);
 selection=null;await lease.renew('second');assert.match(lease.url,/\d{6}$/);assert.equal((await resolve('new-studio')).status,404);
 assert.equal((await (await f.links(token)).json()).name,'new-studio');
 selection={name:'new-studio',token};await lease.renew('second');assert.equal((await resolve('new-studio')).status,200);
 await lease.release();assert.equal((await resolve('new-studio')).status,404);assert.equal((await (await f.links(token)).json()).name,'new-studio');
});
test('another account cannot bind a saved name and one name cannot route two active sessions',async()=>{
 const f=fixture(),a=await f.addUser('a','a'),b=await f.addUser('b','b');await f.links(a,'PUT','exclusive');
 const lease=await acquireManagedTunnel({port:12345,room:'one',request:f.request,custom:()=>({name:'exclusive',token:a})});
 await assert.rejects(acquireManagedTunnel({port:12345,room:'two',request:f.request,custom:()=>({name:'exclusive',token:a})}));
 await assert.rejects(acquireManagedTunnel({port:12345,room:'bad',request:f.request,custom:()=>({name:'exclusive',token:b})}));
 assert.equal((await f.request('/resolve/exclusive')).status,200);await lease.release();
});
test('custom-link authorization uses its own PKCE code exchange and returns a limited opaque credential',async()=>{
 const f=fixture();let saved=null;
 const account={identity:{sub:'user_authorized'},status:()=>({phase:'signed-in'})};
 const auth=new LinkAuthorization(account,{read:async()=>null,write:async value=>{saved=value;},clear:async()=>{saved=null;}},{request:f.request});await auth.ready;
 const url=new URL(await auth.begin('http://127.0.0.1:8788/auth/callback'));
 assert.equal(url.searchParams.get('scope'),'profile');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(await auth.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'one-use-code'})),true);
 assert.match(auth.credential(),/^[a-f0-9]{64}$/);assert(saved);assert.equal(saved.includes('broker-owned-clerk-token'),false);
 assert.equal((await f.links(auth.credential(),'PUT','authorized-studio')).status,200);
 assert.equal(await auth.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'one-use-code'})),false);
 account.identity.sub='other-account';assert.equal(auth.credential(),null);await auth.clear();assert.equal(saved,null);
});
test('missing authorization and reserved or malformed names are rejected',async()=>{
 const f=fixture(),token=await f.addUser('a','a');assert.equal((await f.links('x')).status,401);
 for(const name of ['health','signal','api','123456','ab','bad/route','ends-','a'.repeat(33)])assert.equal((await f.links(token,'PUT',name)).status,400,name);
});

test('existing account access grant exchanges for a scoped link credential without a second PKCE login',async()=>{
 const f=fixture();let verified=0;f.env.AUTH_FETCH=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(String(url),'https://clerk.sessionstream.app/oauth/userinfo');assert.equal(options.headers.Authorization,'Bearer existing-desktop-access');verified++;return Response.json({sub:'same-user'});};
 const response=await f.request('/v1/link-auth/exchange',{method:'POST',headers:{Authorization:'Bearer existing-desktop-access'},body:'{}'});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.user,'same-user');assert.match(data.token,/^[a-f0-9]{64}$/);assert.equal(verified,1);
 assert.equal((await f.links(data.token,'PUT','single-login-studio')).status,200);
 assert.equal((await f.request('/v1/link-auth/exchange',{method:'POST',headers:{Authorization:'Bearer existing-desktop-access',Origin:'https://foreign.example'},body:'{}'})).status,403);
 f.env.AUTH_FETCH=async()=>Response.json({error:'invalid_token'},{status:401});assert.equal((await f.request('/v1/link-auth/exchange',{method:'POST',headers:{Authorization:'Bearer expired'},body:'{}'})).status,401);
 f.env.AUTH_FETCH=async()=>{throw Error('Network detail must not escape');};const failure=await f.request('/v1/link-auth/exchange',{method:'POST',headers:{Authorization:'Bearer offline'},body:'{}'});assert.equal(failure.status,503);assert(!(await failure.text()).includes('Network detail'));
});
