import test from 'node:test';
import assert from 'node:assert/strict';
import {Account,accountConfig} from '../server/account.mjs';
import {createStreamServer} from '../server/index.mjs';

test('revoked installations can only re-enroll after a successful browser callback',async t=>{
 const saved=new Map(),enrolled=[];
 const account=new Account({...accountConfig(),autoRestore:false,fetchImpl:async url=>{
  if(url.pathname==='/oauth/token')return Response.json({access_token:'test-access',token_type:'bearer'});
  return Response.json({sub:'account-a',name:'Test account'});
 }});
 account.identity={sub:'account-a',name:'Test account',expires:Date.now()+3600000};
 account.accessToken='old-access';
 let revoked;
 const app=await createStreamServer({
  account,studioPort:0,publicPort:0,udpPort:0,
  linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},
  linkOptions:{request:async()=>Response.json({error:'Unavailable'},{status:503})},
  dashboardOptions:{
   enabled:true,
   storeFactory:sub=>({read:async()=>saved.get(sub),write:async value=>saved.set(sub,value),clear:async()=>saved.delete(sub)}),
   fetchImpl:async(url,options)=>{
    const {device}=JSON.parse(options.body);
    if(url.endsWith('/enroll')){enrolled.push(device);return Response.json({deviceCredential:'a'.repeat(64)});}
    if(!revoked)revoked=device;
    return device===revoked?Response.json({error:'This installation is disconnected.'},{status:403}):Response.json({plan:'pro',listeners:8});
   }
  }
 });
 t.after(()=>app.close());
 const local=`http://127.0.0.1:${app.studioPort}`;
 const studio=()=>fetch(local+'/api/studio').then(r=>r.json());
 const {token}=await studio();
 const action=async action=>fetch(local+'/api/account',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${token}`},body:JSON.stringify({action})}).then(r=>r.json());
 for(let tries=0;tries<30&&!(await studio()).accountConnection.reconnectRequired;tries++)
  await new Promise(resolve=>setTimeout(resolve,100));
 assert((await studio()).accountConnection.reconnectRequired);
 assert.equal(enrolled.length,1);
 async function begin(actionName){
  const result=await action(actionName);
  const landing=new URL(result.url);
  assert.equal(landing.origin,'https://sessionstream.app');
  assert.equal(landing.pathname,'/sign-in/');
  const authorize=new URL(landing.searchParams.get('plugin'));
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
  return authorize.searchParams.get('state');
 }
 const state=await begin('reconnect');
 assert.equal((await studio()).account.phase,'signing-in');
 assert.equal(JSON.parse(saved.get('account-a')).device,revoked);
 assert.equal((await fetch(local+'/auth/callback?state=wrong&code=mock')).status,400);
 assert.equal((await fetch(local+`/auth/callback?state=${state}&error=access_denied`)).status,400);
 assert.equal(enrolled.length,1);
 const retry=await begin('sign-in');
 const success=await fetch(local+`/auth/callback?state=${retry}&code=mock`);
 assert.equal(success.status,200);
 assert.equal(enrolled.length,2);
 assert.notEqual(enrolled[0],enrolled[1]);
 const restored=await studio();
 assert.equal(restored.account.phase,'signed-in');
 assert.equal(restored.accountConnection.reconnectRequired,false);
 assert.equal(restored.accountConnection.plan,'pro');
 // A normal sign-in after signing out also handles a previously revoked ID.
 revoked=enrolled.at(-1);
 await action('sign-out');
 const fresh=await begin('sign-in');
 assert.equal((await fetch(local+`/auth/callback?state=${fresh}&code=mock`)).status,200);
 assert.equal(enrolled.length,3);
 assert.notEqual(enrolled.at(-1),revoked);
 assert.equal((await studio()).accountConnection.reconnectRequired,false);
});


test('the plugin browser confirms readiness, temporary sign-in, or unfinished device setup',async()=>{
 for(const [failure,title] of [
  [null,'Ready to stream.'],
  ['save','Signed in for this session.'],
  ['device-limit','All three computer slots are in use.'],
  ['offline','Finishing setup in SessionStream.'],
 ]){
  let refresh=null,installation=null,block=failure;
  const account=new Account({...accountConfig(),autoRestore:false,
   store:{read:async()=>refresh,write:async value=>{if(block==='save')throw Error('Secure store unavailable');refresh=value;}},
   fetchImpl:async url=>Response.json(url.pathname==='/oauth/token'
    ?{access_token:'access',refresh_token:'refresh',token_type:'bearer'}:{sub:'user',name:'Account'})
  });
  const app=await createStreamServer({account,studioPort:0,publicPort:0,udpPort:0,
   linkStore:{read:async()=>null},
   dashboardOptions:{enabled:true,autoTimer:false,storeFactory:()=>({
    read:async()=>installation,write:async value=>{installation=value;}
   }),fetchImpl:async url=>{
    if(block==='device-limit')return Response.json({error:'Three computers are already connected. Remove one in your account.'},{status:409});
    if(block==='offline')return Response.json({error:'Account unavailable.'},{status:503});
    return Response.json(url.endsWith('/enroll')?{deviceCredential:'a'.repeat(64)}:{plan:'free',listeners:3});
   }}
  });
  try{
   const local=`http://127.0.0.1:${app.studioPort}`;
   const studio=()=>fetch(local+'/api/studio').then(r=>r.json());
   const {token}=await studio();
   const action=action=>fetch(local+'/api/account',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${token}`},body:JSON.stringify({action})}).then(r=>r.json());
   const {url}=await action('sign-in');
   const authorize=new URL(new URL(url).searchParams.get('plugin'));
   const result=await fetch(local+'/auth/callback?'+new URLSearchParams({state:authorize.searchParams.get('state'),code:'mock'}));
   const html=await result.text();
   assert.equal(result.status,200);
   assert(html.includes('<h2 id="result-title">'+title+'</h2>'));
   assert.equal((await studio()).account.remembered,failure!=='save');
   if(failure==='device-limit'){
    const before=await studio();
    assert(before.accountConnection.deviceLimitReached);
    assert(!before.accountConnection.reconnectRequired);
    block=null;
    await action('retry-device');
    for(let i=0;i<20&&!(await studio()).accountConnection.planKnown;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert((await studio()).accountConnection.planKnown);
    assert((await (await fetch(result.url)).text()).includes('Ready to stream.'));
   }
  }finally{await app.close();}
 }
});
