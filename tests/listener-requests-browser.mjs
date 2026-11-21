import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createStreamServer} from '../server/index.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'sessionstream-request-browser-'));
const account={
 identity:{sub:'test-host'},issuer:'https://clerk.example',clientId:'public',
 status:()=>({phase:'signed-in',name:'Test host'}),accessCredential:()=> 'test-token',close(){}
};
const saved=new Map();
const app=await createStreamServer({
 account,nativeSender:true,publicPort:0,studioPort:0,udpPort:0,runtimeDir:dir,
 linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},
 dashboardOptions:{
  enabled:true,autoTimer:false,
  storeFactory:id=>({read:async()=>saved.get(id),write:async value=>saved.set(id,value),clear:async()=>saved.delete(id)}),
  fetchImpl:async url=>Response.json(url.endsWith('/enroll')?{deviceCredential:'d'.repeat(64)}:
   url.endsWith('/listener/verify')?{listener:{id:'test-account',name:'Verified listener'}}:{plan:'pro',listeners:8})
 }
});
const local=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}`;
const status=()=>fetch(local+'/api/studio').then(response=>response.json());
const {token}=await status();
async function post(route,body){
 const response=await fetch(local+route,{method:'POST',headers:{Origin:local,Authorization:`Bearer ${token}`},body:JSON.stringify({source:101,...body})});
 assert.equal(response.status,200,await response.clone().text());
 return response.json();
}
const control=(action,extra)=>post('/api/control',{action,...extra});
const manage=(action,extra)=>post('/api/listeners',{action,...extra});
const configure=(approval,requireAccount=false)=>manage('settings',{approval,requireAccount});
const pending=async()=> (await status()).listenerAccess.listeners.filter(listener=>listener.status==='pending');
const url=async()=>`${remote}/listen#${(await status()).room}`;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
const errors=[];
async function pageFor(context,invite){
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(invite);
 await page.locator('#mode-buffered').check();
 return page;
}
const expectStatus=(page,label)=>page.waitForFunction(value=>document.querySelector('#status-label')?.textContent===value,label,{timeout:8000});
async function request(page,name){
 await page.locator('#listener-name').fill(name);
 await page.getByRole('button',{name:'Request access'}).click();
 await expectStatus(page,'WAITING FOR APPROVAL');
}
try{
 await control('generate');
 await configure(true);
 const invite=await url();
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await pageFor(context,invite);
 assert.equal(await page.locator('#theme-toggle svg').count(),2);
 const oldTheme=await page.locator('html').getAttribute('data-theme');
 await page.locator('#theme-toggle').click();
 assert.notEqual(await page.locator('html').getAttribute('data-theme'),oldTheme);
 await request(page,'First listener');
 const [first]=await pending();
 assert.equal(first.name,'First listener');
 await page.getByRole('button',{name:'Cancel request'}).click();
 await expectStatus(page,'REQUEST CANCELLED');
 await page.waitForTimeout(150);
 assert.equal((await pending()).length,0);
 await request(page,'First listener');
 const [again]=await pending();
 await manage('reject',{id:again.id});
 await expectStatus(page,'REQUEST DECLINED');
 assert.equal(await page.locator('#connect').isVisible(),false);
 await page.reload();
 await expectStatus(page,'REQUEST DECLINED');
 assert.equal(await page.locator('#connect').isVisible(),false);
 await configure(true,true);
 await configure(true,false);
 const blockedTab=await pageFor(context,invite);
 await expectStatus(blockedTab,'REQUEST DECLINED');
 assert.equal((await pending()).length,0);
 await context.close();

 const approval=await browser.newContext();
 const listener=await pageFor(approval,invite);
 await request(listener,'Reconnect listener');
 const [original]=await pending();
 const replacement=await pageFor(approval,invite);
 await request(replacement,'Reconnect listener');
 assert.deepEqual((await pending()).map(row=>row.id),[original.id]);
 await expectStatus(listener,'DISCONNECTED');
 await manage('accept',{id:original.id});
 await expectStatus(replacement,'WAITING FOR HOST');
 assert.equal((await status()).listeners,1);
 await manage('revoke',{id:original.id});
 await expectStatus(replacement,'ACCESS REVOKED');
 await replacement.reload();
 await expectStatus(replacement,'ACCESS REVOKED');
 await approval.close();

 const unavailable=await browser.newContext();
 await unavailable.addInitScript(()=>{window.AudioContext=class {constructor(){throw Error('Simulated unavailable audio device');}};});
 const audioFailure=await pageFor(unavailable,invite);
 await request(audioFailure,'Audio unavailable');
 const [queued]=await pending();
 assert.equal(queued.name,'Audio unavailable');
 await manage('accept',{id:queued.id});
 await expectStatus(audioFailure,'AUDIO UNAVAILABLE');
 assert.equal(await audioFailure.locator('#connect').isVisible(),true);
 await unavailable.close();

 await control('generate',{passcode:'test passcode'});
 const protectedInvite=await url();
 const protectedContext=await browser.newContext();
 const protectedPage=await pageFor(protectedContext,protectedInvite);
 await protectedPage.locator('#listener-name').fill('Protected listener');
 await protectedPage.locator('#passcode').fill('incorrect');
 await protectedPage.locator('#passcode-submit').click();
 await protectedPage.getByText('Incorrect passcode. Please try again.').waitFor();
 assert.equal((await pending()).length,0);
 await protectedPage.locator('#passcode').fill('test passcode');
 await protectedPage.locator('#passcode-submit').click();
 await expectStatus(protectedPage,'WAITING FOR APPROVAL');
 assert.equal(await protectedPage.locator('#passcode-form').isVisible(),false);
 await configure(false);
 await expectStatus(protectedPage,'WAITING FOR HOST');
 await protectedContext.close();
 await configure(true,true);

 const signedContext=await browser.newContext();
 await signedContext.addInitScript(()=>{
  const fetchActual=window.fetch;
  window.fetch=(resource,options)=>{
   if(resource==='https://sessionstream.app/api/account/listener-ticket')
    return Promise.resolve(window.testListenerSignedIn
     ?Response.json({ticket:'e'.repeat(64)})
     :Response.json({error:'Sign in'},{status:401}));
   return fetchActual(resource,options);
  };
 });
 const signed=await pageFor(signedContext,protectedInvite);
 await signed.locator('#passcode').fill('test passcode');
 await signed.locator('#passcode-submit').click();
 await expectStatus(signed,'SIGN IN REQUIRED');
 assert.equal((await pending()).length,0);
 await signed.evaluate(()=>{window.testListenerSignedIn=true;});
 await signed.getByRole('button',{name:'Check sign-in'}).click();
 await expectStatus(signed,'WAITING FOR APPROVAL');
 assert.equal((await pending())[0].verified,true);
 await control('end');
 await signed.waitForURL(/expired=1/);
 assert.equal(await signed.locator('h1').textContent(),'Link expired');
 assert.deepEqual(errors,[]);
 console.log('PASS: cancel, reject/reload, policy changes, duplicate tabs, approve, revoke/reload, audio failure, passcode retry, verified-account retry, expiry and theme icons.');
}finally{
 await browser.close();
 await app.close();
 await rm(dir,{recursive:true,force:true});
}
