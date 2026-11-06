import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Account} from '../server/account.mjs';
const config={issuer:'https://example.clerk.accounts.dev',clientId:'client_public'};
function fixture(extra={}) {
  const calls=[];
  const account=new Account({...config,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});
    return Response.json(String(url).endsWith('/token')?{access_token:'private-access',token_type:'Bearer',expires_in:600}:{sub:'user_123',given_name:'Jaxon'});
  },...extra});
  return {account,calls};
}
function begin(account){const result=account.begin('http://127.0.0.1:8788/auth/callback');return new URL(result.url);}
function callback(url,code='abc'){return new URLSearchParams({state:url.searchParams.get('state'),code});}
test('public client uses S256 and confirms profile through Clerk without exposing credentials',async()=>{
 const {account,calls}=fixture(),url=begin(account);
 assert.equal(url.protocol,'https:');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(await account.callback(callback(url)),true);
 const form=calls[0].options.body;
 assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),url.searchParams.get('code_challenge'));
 assert.equal(form.has('client_secret'),false);
 assert.equal(calls[1].options.headers.Authorization,'Bearer private-access');
 assert.equal(account.status().name,'Jaxon');assert.equal(JSON.stringify(account.status()).includes('private-access'),false);
 assert.equal(await account.callback(callback(url)),false);assert.equal(calls.length,2);
});
test('invalid, expired, and cancelled callbacks never exchange a code',async()=>{
 let now=100;const {account,calls}=fixture({now:()=>now});let url=begin(account);
 assert.equal(await account.callback(new URLSearchParams({state:'x'.repeat(43),code:'abc'})),false);
 assert.equal(await account.callback(new URLSearchParams({state:'é'.repeat(43),code:'abc'})),false);
 now+=300001;assert.equal(await account.callback(callback(url)),false);assert.equal(account.status().phase,'signed-out');
 url=begin(account);const params=callback(url);params.set('error','access_denied');assert.equal(await account.callback(params),false);
 assert.equal(calls.length,0);
});
test('sign-out prevents a pending exchange from signing the user back in',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const {account}=fixture({fetchImpl:async(url)=>{await gate;return Response.json(String(url).endsWith('/token')?{access_token:'private',token_type:'Bearer'}:{sub:'user',name:'Name'});}});
 const url=begin(account),pending=account.callback(callback(url));account.signOut();release();
 assert.equal(await pending,false);assert.equal(account.status().phase,'signed-out');
});
test('missing configuration and failed token exchange leave anonymous access available',async()=>{
 const account=new Account();assert.equal(account.status().configured,false);assert.ok(account.begin('http://127.0.0.1:8788/auth/callback').error);
 const {account:configured}=fixture({fetchImpl:async()=>Response.json({error:'invalid_grant'},{status:400})});
 assert.equal(await configured.callback(callback(begin(configured))),false);assert.equal(configured.status().phase,'signed-out');
});
test('identity expires and sign-out removes the name',async()=>{
 let now=0;const {account}=fixture({now:()=>now});await account.callback(callback(begin(account)));now=600001;
 assert.equal(account.status().phase,'signed-out');assert.equal(account.status().name,'');
 await account.callback(callback(begin(account)));account.signOut();assert.equal(account.status().name,'');
});

test('account controls and callback remain local, authenticated, and independent of invites',async()=>{
 const {createStreamServer}=await import('../server/index.mjs');
 const {account}=fixture();
 const app=await createStreamServer({publicPort:0,studioPort:0,udpPort:0,account,ignoreStoredURL:true});
 try {
  const local=`http://127.0.0.1:${app.studioPort}`,pub=`http://127.0.0.1:${app.publicPort}`;
  const before=await (await fetch(`${local}/api/studio`)).json();
  const post=(base,authorization=before.token,origin=local)=>fetch(`${base}/api/account`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${authorization}`,'Content-Type':'application/json'},body:JSON.stringify({action:'sign-in'})});
  assert.equal((await post(local,'wrong')).status,403);
  assert.equal((await post(local,before.token,'https://evil.example')).status,403);
  assert.equal((await post(pub)).status,403);
  const {url}=await (await post(local)).json();const auth=new URL(url);
  assert.equal(auth.searchParams.get('redirect_uri'),`${local}/auth/callback`);
  assert.equal((await fetch(`${pub}/auth/callback?${callback(auth)}`)).status,404);
  assert.equal((await fetch(`${local}/auth/callback?${callback(auth)}`)).status,200);
  const after=await (await fetch(`${local}/api/studio`)).json();
  assert.equal(after.account.name,'Jaxon');assert.equal(after.room,before.room);assert.equal(after.live,before.live);
  assert.equal((await fetch(`${local}/auth/callback?${callback(auth)}`)).status,400);
 } finally {await app.close();}
});

function savedAccount(options={}) {
 const state=options.state||{refresh:null};
 const store={read:async()=>state.refresh,write:async value=>{state.refresh=value;},clear:async()=>{state.refresh=null;}};
 const {account,calls}=fixture({store,fetchImpl:async(url,request)=>{
   calls.push({url:String(url),options:request});
   return Response.json(String(url).endsWith('/token')?{access_token:'private-access',refresh_token:'remembered-refresh',token_type:'Bearer',expires_in:600}:{sub:'user_123',given_name:'Jaxon'});
 },...options});
 return {account,state,calls};
}
test('helper restart restores a verified identity using only the saved refresh token',async()=>{
 const first=savedAccount();await first.account.ready;
 assert.equal(await first.account.callback(callback(begin(first.account))),true);
 assert.equal(first.state.refresh,'remembered-refresh');first.account.close();
 const second=savedAccount({state:first.state});await second.account.ready;
 assert.equal(second.calls[0].options.body.get('grant_type'),'refresh_token');
 assert.equal(second.calls[0].options.body.get('refresh_token'),'remembered-refresh');
 assert.equal(second.account.status().name,'Jaxon');
 assert.equal(JSON.stringify(second.account.status()).includes('remembered-refresh'),false);
 await second.account.signOut();second.account.close();
 const third=savedAccount({state:first.state});await third.account.ready;
 assert.equal(third.account.status().phase,'signed-out');assert.equal(third.calls.length,0);third.account.close();
});
test('rotated refresh token is saved even if the profile request temporarily fails',async()=>{
 const state={refresh:'old-refresh'};
 const {account}=savedAccount({state,fetchImpl:async url=>Response.json(String(url).endsWith('/token')?
   {access_token:'access',refresh_token:'rotated-refresh',token_type:'Bearer'}:{error:'unavailable'},{status:String(url).endsWith('/token')?200:503})});
 await account.ready;assert.equal(state.refresh,'rotated-refresh');
 assert.equal(account.status().phase,'signed-out');account.close();
});
test('temporary renewal failures preserve saved login; revoked grants clear it',async()=>{
 for(const invalid of [false,true]){
  const state={refresh:'saved-refresh'};
  const {account}=savedAccount({state,fetchImpl:async()=>Response.json({error:invalid?'invalid_grant':'server_error'},{status:invalid?400:503})});
  await account.ready;assert.equal(state.refresh,invalid?null:'saved-refresh');
  assert.equal(account.status().phase,'signed-out');account.close();
 }
});
test('signing out while stored login loads prevents account restoration',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const {account,calls}=fixture({store:{read:()=>gate,clear:async()=>{},write:async()=>{}}});
 await account.signOut();release('saved-refresh');await account.ready;
 assert.equal(calls.length,0);assert.equal(account.status().phase,'signed-out');account.close();
});
test('remembered login requests offline access without expanding profile data',async()=>{
 const {account}=fixture();assert.equal(begin(account).searchParams.get('scope'),'profile offline_access');account.close();
});
