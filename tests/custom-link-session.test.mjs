import test from 'node:test';
import assert from 'node:assert/strict';
import {LinkAuthorization} from '../server/link-auth.mjs';
import {LinkClient} from '../server/link-client.mjs';
function fixture({stored=null,failStore=false}={}){
 const calls=[];let saved=stored;
 const account={identity:{sub:'signed-in-user'},ready:Promise.resolve(),status:()=>({phase:account.identity?'signed-in':'signed-out'}),accessCredential:()=>account.identity?'memory-only-access':null};
 const store={read:async()=>saved,write:async s=>{if(failStore)throw Error();saved=s;},clear:async()=>{saved=null;}};
 const request=async(url,options)=>{calls.push({path:new URL(url).pathname,options});return new URL(url).pathname.endsWith('/exchange')?Response.json({token:'a'.repeat(64),user:'signed-in-user'}):Response.json({ok:true});};
 const auth=new LinkAuthorization(account,store,{request});return {account,auth,calls,get saved(){return saved;}};
}
test('custom links reuse the verified login once without opening a second browser flow',async()=>{
 const f=fixture();await f.auth.ready;const [a,b]=await Promise.all([f.auth.ensure(),f.auth.ensure()]);
 assert.equal(a,b);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/v1/link-auth/exchange');assert.equal(f.calls[0].options.headers.Authorization,'Bearer memory-only-access');assert(!f.calls[0].options.body.includes('refresh'));
 assert(f.saved);assert(!f.saved.includes('memory-only-access'));assert.equal(f.auth.credential(),'a'.repeat(64));
});
test('valid remembered link authorization needs neither exchange nor browser',async()=>{
 const f=fixture({stored:JSON.stringify({token:'b'.repeat(64),user:'signed-in-user',expires:Date.now()+60000})});await f.auth.ensure();assert.equal(f.calls.length,0);assert.equal(f.auth.credential(),'b'.repeat(64));
});
test('a credential-store outage does not falsely reject an already verified account',async()=>{
 const f=fixture({failStore:true});assert.equal(await f.auth.ensure(),'a'.repeat(64));assert.equal(f.account.status().phase,'signed-in');
});
test('sign-out during exchange cannot restore link access',async()=>{
 const f=fixture();let finish;f.auth.request=()=>new Promise(r=>finish=r);const pending=f.auth.ensure();await new Promise(r=>setImmediate(r));f.account.identity=null;await f.auth.clear();finish(Response.json({token:'c'.repeat(64),user:'signed-in-user'}));await assert.rejects(pending,/Account changed/);assert.equal(f.auth.credential(),null);assert.equal(f.saved,null);
});
test('transient authorization failure is throttled and does not erase the account',async()=>{
 const f=fixture();let attempts=0;f.auth.request=async()=>{attempts++;return Response.json({error:'Temporarily unavailable'},{status:503});};
 const client=new LinkClient(f.account,f.auth);client.status();await new Promise(r=>setTimeout(r,10));for(let i=0;i<20;i++)client.status();assert.equal(attempts,1);assert.equal(client.busy,false);assert.equal(f.account.status().phase,'signed-in');assert.match(client.error,/Temporarily/);
});
test('expired link capability is refreshed once using the existing login before retrying a claim',async()=>{
 const f=fixture();await f.auth.ensure();let requests=0;
 const client=new LinkClient(f.account,f.auth,{request:async(_url,o)=>{if(o.method==='GET')return Response.json({name:'my-studio'});if(++requests===1)return Response.json({error:'Expired'},{status:401});return Response.json({name:'new-studio'});}});
 await client.refresh();await client.action('claim','new-studio');assert.equal(client.name,'new-studio');assert.equal(requests,2);assert.equal(client.error,'');assert.equal(f.calls.filter(c=>c.path.endsWith('/exchange')).length,2);
});
