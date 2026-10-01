// Real browser + isolated native sender. No Cloudflare, DAW, or live user
// session is used. Run: node --expose-gc tests/access-browser.mjs
import {chromium} from 'playwright';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';
import dgram from 'node:dgram';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
const report={testedAt:new Date().toISOString(),scope:'Local Chrome with actual native stereo RTP/PCM; phone viewport and browser activation. No physical iPhone or worldwide network test.',checks:[]};
const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true});
const local=`http://127.0.0.1:${app.studioPort}`,publicBase=`http://127.0.0.1:${app.publicPort}`;
const getSession=()=>fetch(local+'/api/studio').then(r=>r.json());
const initial=await getSession();
async function control(action,extra={}){
  const response=await fetch(local+'/api/control',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({action,source:12345,...extra})});
  assert(response.ok,`Control ${action}: ${response.status}`);
}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
const udp=dgram.createSocket('udp4');let sequence=0;const start=performance.now(),errors=[];
const audioTimer=setInterval(()=>{const target=Math.floor((performance.now()-start)*48/256);while(sequence<target)udp.send(tonePacket(sequence++),app.udpPort,'127.0.0.1');},5);
const leaseTimer=setInterval(()=>control('lease').catch(()=>{}),1000);
async function waitIssue(expected,timeout=10000){
  const until=Date.now()+timeout;let issue;
  do{issue=(await getSession()).listenerIssue;if(expected?issue?.includes(expected):issue===null)return issue;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
  assert.fail(`Listener issue did not become ${expected??'clear'}: ${issue}`);
}
async function energy(page){return page.evaluate(async()=>{
  const {gain,context}=window.__testAudio,analyser=context.createAnalyser(),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);gain.connect(analyser);analyser.connect(sink);
  await new Promise(r=>setTimeout(r,250));const values=new Float32Array(2048);analyser.getFloatTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);
  gain.disconnect(analyser);analyser.disconnect();sink.disconnect();return rms;
});}
async function audible(page){const until=Date.now()+6000;do{if(await energy(page)>.005)return;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);assert.fail(`No rendered audio: ${JSON.stringify(await page.evaluate(()=>window.sessionDiagnostics()))}`);}
async function pageFor(room,options={}){
  const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1280,height:850}});
  await context.addInitScript(()=>{
    window.__sockets=[];window.__signalTypes=[];window.__dropPCM=false;
    const NativeSocket=WebSocket;
    window.WebSocket=class extends NativeSocket{
      constructor(...args){super(...args);window.__sockets.push(this);this.addEventListener('message',event=>{if(typeof event.data==='string')try{window.__signalTypes.push(JSON.parse(event.data).type);}catch{}});}
      set onmessage(handler){this.__handler=handler;super.onmessage=event=>{if(window.__dropPCM&&typeof event.data!=='string')return;handler?.(event);};}
      get onmessage(){return this.__handler;}
    };
    const NativeContext=AudioContext;window.AudioContext=class extends NativeContext{constructor(...args){window.__audioCreatedWithGesture=navigator.userActivation.isActive;super(...args);}};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  if(options.hidePreflight)await page.route('**/api/invite',route=>route.fulfill({status:200,contentType:'application/json',body:'{"passcodeRequired":false}'}));
  await page.goto(`${publicBase}/listen?audio-test#${room}`);
  return {page,context};
}
try{
  await control('start');
  const plain=await pageFor((await getSession()).room);
  assert(await plain.page.locator('#passcode-form').isHidden());assert(await plain.page.locator('#connect').isVisible());
  assert.equal(await plain.page.locator('#volume').inputValue(),'0');assert.equal(await plain.page.locator('#volume').getAttribute('max'),'6');
  await plain.page.locator('#connect').click();await plain.page.waitForFunction(()=>window.sessionDiagnostics().connections.includes('connected'),null,{timeout:15000});await audible(plain.page);
  assert.equal(await plain.page.evaluate(()=>window.__audioCreatedWithGesture),true);
  await plain.page.locator('#mute').click();await plain.page.waitForTimeout(2500);
  assert((await energy(plain.page))<.0001);assert.equal(await plain.page.evaluate(()=>window.sessionDiagnostics().listenerHealth),'ok');await waitIssue(null);
  report.checks.push({name:'Unprotected link remains one-click, unity/+6 dB controls unchanged; actual RTP audio and muted listener stay healthy',result:'PASS'});
  await plain.page.locator('#mute').click();await plain.page.evaluate(()=>window.__testAudio.context.suspend());
  await plain.page.waitForFunction(()=>window.sessionDiagnostics().listenerHealth==='audio-blocked');await waitIssue('enable audio playback');
  await plain.page.locator('#connect').click();await plain.page.waitForFunction(()=>window.sessionDiagnostics().listenerHealth==='ok');await audible(plain.page);await waitIssue(null);
  report.checks.push({name:'Browser-paused audio produces actionable listener/producer error; Resume clears it',result:'PASS'});
  await plain.page.locator('#fallback').click();await plain.page.waitForFunction(()=>window.sessionDiagnostics().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500);await audible(plain.page);
  await plain.page.waitForTimeout(6500);await plain.page.evaluate(()=>window.__dropPCM=true);
  await plain.page.waitForFunction(()=>window.sessionDiagnostics().listenerHealth==='audio-stalled',null,{timeout:8000});await waitIssue('stopped reaching');
  await plain.page.evaluate(()=>window.__dropPCM=false);await plain.page.waitForFunction(()=>window.sessionDiagnostics().listenerHealth==='ok');await audible(plain.page);await waitIssue(null);
  report.checks.push({name:'Missing PCM reception while producer audio is active reports a real stall and clears on packet recovery',result:'PASS'});
  await plain.page.evaluate(()=>window.__dropPCM=true);await control('stop');await plain.page.waitForTimeout(4500);
  assert.equal(await plain.page.evaluate(()=>window.sessionDiagnostics().listenerHealth),'ok');await waitIssue(null);
  report.checks.push({name:'Host stop is expected waiting, without a false listener error',result:'PASS'});
  await plain.context.close();
  const passcode='Studio session 12';await control('generate',{passcode});await control('start');const protectedRoom=(await getSession()).room;
  const missing=await pageFor(protectedRoom,{hidePreflight:true});await missing.page.locator('#connect').click();
  await missing.page.waitForFunction(()=>!document.querySelector('#passcode-form').hidden);
  assert.equal(await missing.page.locator('#passcode-error').textContent(),'');assert.equal((await getSession()).listeners,0);
  assert(await missing.page.evaluate(()=>!window.__signalTypes.includes('joined')&&!window.__signalTypes.includes('offer')&&window.__testPeers.size===0));
  report.checks.push({name:'A protected WS challenge blocks joining/ICE/audio even if invite preflight is bypassed',result:'PASS'});
  await missing.context.close();
  const protectedClient=await pageFor(protectedRoom,{mobile:true}),page=protectedClient.page;
  await page.waitForFunction(()=>!document.querySelector('#passcode-form').hidden);
  assert(await page.locator('#connect').isHidden());assert.equal(await page.evaluate(()=>!!window.__audioInit),false);
  assert.equal(await page.locator('#passcode').getAttribute('type'),'password');assert.equal(await page.locator('#passcode').getAttribute('maxlength'),'64');
  await page.locator('#passcode').fill('wrong code');await page.locator('#passcode-submit').click();
  await page.waitForFunction(()=>document.querySelector('#passcode-error').textContent.includes('Incorrect'));
  assert.equal((await getSession()).listeners,0);assert.equal(await page.locator('#passcode').inputValue(),'');
  assert(await page.evaluate(()=>!window.__signalTypes.includes('joined')&&!window.__signalTypes.includes('offer')&&window.__testPeers.size===0));
  const socketCount=await page.evaluate(()=>window.__sockets.length);
  await page.locator('#passcode').fill(passcode);await page.locator('#passcode-submit').click();
  await page.waitForFunction(()=>window.sessionDiagnostics().connections.includes('connected'),null,{timeout:15000});await audible(page);
  assert.equal(await page.evaluate(()=>window.__sockets.length),socketCount);assert.equal((await getSession()).listeners,1);assert(await page.locator('#passcode-form').isHidden());assert.equal(await page.locator('#passcode').inputValue(),'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert(await page.evaluate(secret=>!location.href.includes(secret)&&localStorage.length===0&&sessionStorage.length===0&&!JSON.stringify(window.sessionDiagnostics()).includes(secret),passcode));
  report.checks.push({name:'Protected mobile page prompts before audio, wrong code has no peer, correct retry joins on same WS and receives actual audio; secrets absent from URL/storage/diagnostics',result:'PASS'});
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/listener-protected-live.png',fullPage:true});
  await page.locator('#fallback').click();await page.waitForFunction(()=>window.sessionDiagnostics().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500);await audible(page);
  await page.evaluate(()=>window.__sockets.at(-1).close());
  await page.waitForFunction(()=>window.__sockets.length>1&&window.sessionDiagnostics().lastAudioAgeMs<500,null,{timeout:10000});await audible(page);
  assert(await page.locator('#passcode-form').isHidden());await waitIssue(null);
  await page.locator('#mute').click();await page.waitForTimeout(1500);assert((await energy(page))<.0001);assert.equal(await page.evaluate(()=>window.sessionDiagnostics().listenerHealth),'ok');await waitIssue(null);
  report.checks.push({name:'Authorized protected reconnect remembers code only in page memory; PCM and hard mute stay connected/healthy',result:'PASS'});
  await page.evaluate(()=>window.__dropPCM=true);await page.waitForFunction(()=>window.sessionDiagnostics().listenerHealth==='audio-stalled',null,{timeout:10000});
  await control('generate',{passcode});await page.waitForFunction(()=>!window.sessionDiagnostics().running);
  assert.equal(await page.locator('#message').textContent(),'Invite changed');await waitIssue(null);
  report.checks.push({name:'Revoked invite stops listening, preserves the terminal error, and clears producer health',result:'PASS'});
  await protectedClient.context.close();
  const prompt=await pageFor((await getSession()).room,{mobile:true});await prompt.page.waitForFunction(()=>!document.querySelector('#passcode-form').hidden);await prompt.page.screenshot({path:'artifacts/listener-passcode.png',fullPage:true});await prompt.context.close();
  assert.deepEqual(errors,[]);report.checks.push({name:'No browser runtime errors',result:'PASS'});report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack;console.error(error);process.exitCode=1;}
finally{
  clearInterval(audioTimer);clearInterval(leaseTimer);udp.close();await browser.close();await app.close();
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/access-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
