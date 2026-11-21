import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {writeFile} from 'node:fs/promises';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';
const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true});
const base=`http://127.0.0.1:${app.studioPort}`,publicURL=`http://127.0.0.1:${app.publicPort}`;
const first=await fetch(base+'/api/studio').then(r=>r.json());
const control=action=>fetch(base+'/api/control',{method:'POST',headers:{Origin:base,Authorization:`Bearer ${first.token}`},body:JSON.stringify({action,source:101})});
await control('generate');await control('start');
const session=await fetch(base+'/api/studio').then(r=>r.json());
let seq=0,level=1;const udp=dgram.createSocket('udp4');
const feed=setInterval(()=>{for(let n=0;n<2;n++){const p=tonePacket(seq++,256,48000,101);for(let i=0;i<256;i++){p.writeFloatLE(p.readFloatLE(24+i*8)*level,24+i*8);p.writeFloatLE(p.readFloatLE(28+i*8)*level,28+i*8);}udp.send(p,app.udpPort,'127.0.0.1');}},256/48000*2000);
const lease=setInterval(()=>control('lease'),1000);
let browser;const report={checks:[],scope:'Local Chrome and native WebRTC; no remote-network or physical loudness claim'};
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${publicURL}/listen?audio-test#${session.room}`);await page.locator('#connect').click();
 await page.waitForFunction(()=>window.sessionDiagnostics?.().connections.includes('connected'),null,{timeout:20000});
 await page.evaluate(()=>{
  const {context,output}=window.__testAudio;const analyser=context.createAnalyser();analyser.fftSize=2048;output.connect(analyser);window.__safeMeter=analyser;
 });
 async function measure(){return page.evaluate(async()=>{
  let peak=0,energy=0;const samples=new Float32Array(2048);
  for(let i=0;i<12;i++){window.__safeMeter.getFloatTimeDomainData(samples);for(const x of samples){peak=Math.max(peak,Math.abs(x));energy+=x*x;}await new Promise(r=>setTimeout(r,20));}
  return {peak,rms:Math.sqrt(energy/(12*2048))};
 });}
 await page.waitForTimeout(300);let normal=await measure();assert(normal.rms>.01);
 report.checks.push({name:'Native Opus to Chrome through final safety worklet is audible',...normal});
 for(const mode of ['live','buffered']){
  if(mode==='buffered'){await page.locator('#mode-buffered').check();await page.waitForFunction(()=>window.sessionDiagnostics().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500);}
  level=100;await page.locator('#volume').fill('6');await page.locator('#volume').dispatchEvent('input');await page.waitForTimeout(500);
  const spike=await measure();assert(spike.rms>.02);assert(spike.peak<=10**(-1/20)+.00001,`${mode} ceiling exceeded: ${spike.peak}`);
  report.checks.push({name:`${mode}: 40 dB source spike plus +6 dB listener gain stays below -1 dBFS`,...spike});
  await page.locator('#mute').click();await page.waitForTimeout(100);const muted=await measure();assert(muted.peak<.000001);await page.locator('#mute').click();
  level=1;await page.locator('#volume').fill('0');await page.locator('#volume').dispatchEvent('input');await page.waitForTimeout(700);
 }
 await page.locator('#mode-live').check();await page.waitForFunction(()=>window.sessionDiagnostics().connections.includes('connected'),null,{timeout:20000});
 assert.equal(await page.locator('audio').count(),1);assert(await page.locator('audio').evaluate(e=>e.muted));
 const diagnostics=await fetch(base+'/api/studio').then(r=>r.json());assert(diagnostics.transportDiagnostics.events.some(e=>e.event==='connection'&&e.state==='connected'));assert(diagnostics.transportDiagnostics.events.some(e=>e.event==='buffered-selected'));
 assert(!JSON.stringify(diagnostics.transportDiagnostics).includes('candidate:'));assert.deepEqual(errors,[]);
 report.checks.push({name:'Return to Live, muted decoder, mute silence and retained connection timeline',result:'PASS'});
 await page.close();
 // Exercise the real listener recovery timers against a silent signaling peer.
 const waiting=await browser.newPage();await waiting.clock.install();let socket,commands=[];
 await waiting.routeWebSocket('**/signal',ws=>{socket=ws;ws.onMessage(raw=>{const m=JSON.parse(raw);commands.push(m.type);if(m.type==='join'){ws.send(JSON.stringify({type:'joined',id:'test',iceServers:[]}));ws.send(JSON.stringify({type:'status',live:false,audio:null,listeners:1,title:'Recovery test'}));}});});
 await waiting.goto(`${publicURL}/listen?audio-test#${session.room}`);await waiting.locator('#connect').click();await waiting.waitForFunction(()=>window.sessionDiagnostics?.().running);
 await waiting.clock.fastForward(45000);assert.equal(await waiting.evaluate(()=>window.sessionDiagnostics().pcm),false);
 socket.send(JSON.stringify({type:'status',live:true,audio:{rate:48000},listeners:1,title:'Recovery test'}));await waiting.waitForFunction(()=>window.sessionDiagnostics().live);
 await waiting.clock.fastForward(15000);assert.equal(commands.filter(t=>t==='renegotiate').length,1);assert.equal(await waiting.evaluate(()=>window.sessionDiagnostics().pcm),false);
 await waiting.clock.fastForward(15000);assert.equal(await waiting.evaluate(()=>window.sessionDiagnostics().pcm),true);
 report.checks.push({name:'Waiting host does not fall back; one fresh negotiation precedes bounded Buffered fallback',result:'PASS'});
 await waiting.close();report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.stack;process.exitCode=1;}
finally{clearInterval(feed);clearInterval(lease);udp.close();await browser?.close();await app.close();await writeFile('/private/tmp/sessionstream-audio-quality.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
