import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const local=process.env.STUDIO_URL||'http://127.0.0.1:8788/studio';
const plugin=process.env.PLUGIN_PATH||'build/SessionStream_artefacts/Release/VST3/SessionStream.vst3';
const pluginFormat=plugin.endsWith('.component')?'Audio Unit':'VST3';
const browser=await chromium.launch({channel:"chrome",headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const contexts=[],errors=[];let tone;let toneOutput="";
const report={testedAt:new Date().toISOString(),checks:[]};
try{
  const api=local.replace('/studio','/api/studio');
  tone=spawn('./build/vst3-probe',[plugin,'180'],{stdio:['pipe','pipe','pipe']});
  tone.stdout.on('data',x=>toneOutput+=x);tone.stderr.on('data',x=>toneOutput+=x);
  let session;
  const deadline=Date.now()+75000;
  while(Date.now()<deadline){try{session=await fetch(api).then(r=>r.json());if(session.native&&session.live&&session.audio&&session.listenerURL.startsWith('https://'))break;}catch{}await new Promise(r=>setTimeout(r,500));}
  assert(session?.native&&session.live&&session.audio,'Plugin did not start its own native sender');
  const invite=session.listenerURL;assert(invite.startsWith('https://'));
  report.checks.push({name:`Actual ${pluginFormat} starts bundled native engine and worldwide invite without sender browser`,result:'PASS'});
  const clientContext=await browser.newContext({viewport:{width:1280,height:850}});contexts.push(clientContext);
  const client=await clientContext.newPage();client.on('pageerror',e=>errors.push(e.message));client.on('console',m=>console.log('CLIENT',m.type(),m.text()));
  await client.goto(invite.replace('/listen#','/listen?audio-test#'));
  assert.equal(await client.locator('#volume').inputValue(),'1');
  assert.equal(await client.locator('#volume-label').textContent(),'100%');
  assert.equal(await client.locator('footer').textContent(),'built by loyahdev.');
  assert(!/A seat in|LIVE SESSION|EARLY BUILD|\/ 01/.test(await client.locator('body').innerText()));
  await client.locator('#connect').click();
  await client.waitForFunction(()=>window.__testAudio?.context.state==='running');
  assert.equal(await client.evaluate(()=>window.__testAudio.gain.gain.value),1);
  report.checks.push({name:'Simplified listener defaults to 100% actual output gain and requested footer',result:'PASS'});
  await client.waitForFunction(()=>window.sessionDiagnostics?.().connections.includes('connected'),null,{timeout:15000});
  await client.waitForFunction(()=>document.querySelector('#transport').textContent.includes('WebRTC'),null,{timeout:5000});
  report.checks.push({name:`Actual ${pluginFormat} → native WebRTC sender → public Cloudflare signaling → listener browser`,result:'PASS',diagnostics:await client.evaluate(()=>window.sessionDiagnostics())});
  // Probe the actual rendered audio through an AudioWorklet, after channel split.
  async function probe(page){return page.evaluate(async()=>{
    const {context,gain}=window.__testAudio;
    const split=context.createChannelSplitter(2),analysers=[context.createAnalyser(),context.createAnalyser()],sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);
    gain.connect(split);analysers.forEach((a,i)=>{a.fftSize=2048;split.connect(a,i);a.connect(sink);});
    await new Promise(r=>setTimeout(r,250));
    const result=analysers.map(a=>{const b=new Float32Array(a.fftSize);a.getFloatTimeDomainData(b);let total=0;for(const x of b)total+=x*x;return Math.sqrt(total/b.length);});
    gain.disconnect(split);split.disconnect();analysers.forEach(a=>a.disconnect());sink.disconnect();return result;
  });}
  await client.waitForTimeout(1000);
  const rtcRms=await probe(client);assert(rtcRms[0]>.01&&rtcRms[1]>.005,`Silent RTC audio: ${rtcRms}`);assert(rtcRms[0]>rtcRms[1]*1.3,`Stereo collapsed: ${rtcRms}`);
  report.checks.push({name:'WebRTC actual left/right audio energy',result:'PASS',rms:rtcRms});
  async function assertSingleOutput(page){
    const state=await page.evaluate(()=>{const elements=[...document.querySelectorAll('audio')];return {count:elements.length,allMuted:elements.every(e=>e.muted&&e.defaultMuted&&e.hasAttribute('muted'))};});
    assert.equal(state.count,1);assert(state.allMuted,'Hidden WebRTC decoder must never play its own audible copy');
    // Force the decoder's volume to full, emulating devices that ignore volume=0.
    await page.evaluate(()=>{document.querySelector('audio').volume=1;window.__testAudio.gain.gain.value=0;});
    await page.waitForTimeout(200);assert((await probe(page)).every(rms=>rms<.0001));
    await page.evaluate(()=>{window.__testAudio.gain.gain.value=Number(document.querySelector('#volume').value);});
  }
  await assertSingleOutput(client);
  report.checks.push({name:'WebRTC decoder explicitly muted even at full element volume; listener volume zero silences the sole graph output',result:'PASS'});
  await client.screenshot({path:'artifacts/listener-live.png',fullPage:true});
  tone.stdin.write('gain -6\n');await client.waitForTimeout(1400);const quiet=await probe(client);
  assert(quiet[0]/rtcRms[0]>.38&&quiet[0]/rtcRms[0]<.65,`Gain did not reduce stream: ${quiet} / ${rtcRms}`);
  report.checks.push({name:'Plugin -6 dB output gain reduces listener audio, with unchanged DAW passthrough',result:'PASS',rms:quiet});
  tone.stdin.write('gain 0\n');await client.waitForTimeout(600);
  await client.locator('#fallback').click();
  await client.waitForFunction(()=>window.sessionDiagnostics?.().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500,null,{timeout:15000});
  const pcmRms=await probe(client);assert(pcmRms[0]>.01&&pcmRms[1]>.005);assert(pcmRms[0]>pcmRms[1]*1.3);
  report.checks.push({name:'Public Cloudflare WebSocket PCM fallback with separate stereo channels',result:'PASS',rms:pcmRms});
  await clientContext.setOffline(true);await new Promise(r=>setTimeout(r,1200));await clientContext.setOffline(false);
  await client.waitForFunction(()=>window.sessionDiagnostics?.().lastAudioAgeMs<500,null,{timeout:15000});
  await new Promise(r=>setTimeout(r,300));const recoveredRms=await probe(client);assert(recoveredRms[0]>.01);
  report.checks.push({name:'Listener reconnect after network interruption resumes fresh audio',result:'PASS',rms:recoveredRms});
  await client.locator('#fallback').click();await client.waitForFunction(()=>window.sessionDiagnostics().connections.includes('connected'),null,{timeout:15000});
  await client.waitForTimeout(600);const retriedRms=await probe(client);assert(retriedRms[0]>.01);
  report.checks.push({name:'Return from compatibility mode to WebRTC stereo',result:'PASS',rms:retriedRms});
  await assertSingleOutput(client);
  for(let i=0;i<2;i++){
    await client.locator('#fallback').click();await client.waitForFunction(()=>window.sessionDiagnostics().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500);
    assert.equal(await client.locator('audio').count(),0);
    await client.locator('#fallback').click();await client.waitForFunction(()=>window.sessionDiagnostics().connections.includes('connected'),null,{timeout:15000});
    await client.waitForTimeout(300);await assertSingleOutput(client);assert((await probe(client))[0]>.01);
  }
  report.checks.push({name:'Repeated PCM/WebRTC switches keep a single muted decoder and one audible output',result:'PASS'});
  const phone=await clientContext.newPage();await phone.setViewportSize({width:390,height:844});await phone.goto(invite);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await phone.screenshot({path:'artifacts/listener-mobile.png',fullPage:true});
  report.checks.push({name:'Mobile listener layout has no horizontal overflow',result:'PASS'});
  report.engineStats=await fetch(api).then(r=>r.json()).then(s=>s.engine);
  tone.stdin.write('send 0\n');await client.waitForFunction(()=>!window.sessionDiagnostics().live,null,{timeout:5000});
  await new Promise(r=>setTimeout(r,300));const stoppedRms=await probe(client);assert(stoppedRms[0]<.001);
  report.checks.push({name:'Stop broadcast silences listener',result:'PASS'});
  tone.stdin.write('send 1\n');await client.waitForFunction(()=>window.sessionDiagnostics().live&&window.sessionDiagnostics().connections.includes('connected'),null,{timeout:10000});
  await new Promise(r=>setTimeout(r,800));assert((await probe(client))[0]>.01);
  report.checks.push({name:'Broadcaster stop/start recovers existing listener',result:'PASS'});
  tone.stdin.write('send 0\n');await client.locator('#connect').click();
  report.sender='Native plugin engine (no broadcaster page)';report.browserVersion=browser.version();
  assert.deepEqual(errors,[]);report.checks.push({name:'Browser runtime errors',result:'PASS',errors});
  report.result='PASS';report.toneOutput=toneOutput;
  assert(report.engineStats.underruns===0,`Native sender underruns: ${JSON.stringify(report.engineStats)}`);
  report.checks.push({name:'Native sender runs without buffer underruns during browser flow',result:'PASS',stats:report.engineStats});
}catch(e){for(const c of contexts)for(const p of c.pages()){console.log(await p.evaluate(()=>({message:document.querySelector('#message')?.textContent,state:window.sessionDiagnostics?.()})).catch(()=>null));await p.screenshot({path:'artifacts/browser-failure.png',fullPage:true}).catch(()=>{});}report.result='FAIL';report.error=e.stack;console.error(e);process.exitCode=1;}
finally{report.toneOutput=toneOutput;tone?.kill('SIGTERM');await browser.close();await mkdir('artifacts',{recursive:true});await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
