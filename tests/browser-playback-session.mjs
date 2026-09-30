import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const session=await fetch('http://127.0.0.1:9878/api/studio').then(r=>r.json());
const invite=`http://127.0.0.1:9877/listen?audio-test#${session.room}`;
const report={testedAt:new Date().toISOString(),scope:'Chrome rendered stereo; simulated AudioSession API. Does not test a physical iPhone silent switch.',checks:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
async function rms(page){return page.evaluate(async()=>{
  const {gain,context}=window.__testAudio,split=context.createChannelSplitter(2),sink=context.createGain(),analysers=[context.createAnalyser(),context.createAnalyser()];sink.gain.value=0;sink.connect(context.destination);gain.connect(split);
  analysers.forEach((a,i)=>{a.fftSize=2048;split.connect(a,i);a.connect(sink);});await new Promise(r=>setTimeout(r,350));
  const energy=analysers.map(a=>{const v=new Float32Array(2048);a.getFloatTimeDomainData(v);return Math.sqrt(v.reduce((sum,x)=>sum+x*x,0)/v.length);});gain.disconnect(split);split.disconnect();analysers.forEach(a=>a.disconnect());sink.disconnect();return energy;
});}
try{
  for(const policy of ['supported','unsupported','rejects']){
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(policy=>{
      window.__sessionChanges=[];let type='ambient';
      Object.defineProperty(navigator,'audioSession',{configurable:true,value:policy==='unsupported'?undefined:{get type(){return type;},set type(value){if(policy==='rejects')throw new Error('Unsupported category');type=value;window.__sessionChanges.push(value);}}});
      const NativeContext=window.AudioContext;window.AudioContext=class extends NativeContext{constructor(...args){window.__sessionBeforeContext=navigator.audioSession?.type;super(...args);}};
    },policy);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(invite);await page.locator('#connect').click();await page.waitForFunction(()=>window.sessionDiagnostics?.().connections.includes('connected'),null,{timeout:15000});
    await page.waitForTimeout(500);
    if(policy==='supported')assert.equal(await page.evaluate(()=>window.__sessionBeforeContext),'playback');
    let energy=await rms(page);assert(energy[0]>.01&&energy[1]>.005,`Silent WebRTC (${policy}): ${energy}`);
    assert(await page.locator('.audio-details').isVisible());assert(await page.locator('#scope').isVisible());
    await page.waitForFunction(()=>document.querySelector('#transport').textContent.includes('WebRTC'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('audio').count(),1);assert(await page.locator('audio').evaluate(e=>e.muted&&e.defaultMuted&&e.hasAttribute('muted')));
    await page.evaluate(()=>{document.querySelector('audio').volume=1;document.querySelector('#volume').value='0';document.querySelector('#volume').dispatchEvent(new Event('input'));});
    assert((await rms(page)).every(x=>x<.0001));
    await page.evaluate(()=>{document.querySelector('#volume').value='1';document.querySelector('#volume').dispatchEvent(new Event('input'));});
    if(policy==='supported'){
      await page.evaluate(async()=>{navigator.audioSession.type='ambient';await window.__testAudio.context.suspend();});
      await page.waitForFunction(()=>document.querySelector('#connect').textContent.includes('Resume'));
      await page.locator('#connect').click();await page.waitForFunction(()=>window.__testAudio.context.state==='running');
      assert.equal(await page.evaluate(()=>navigator.audioSession.type),'playback');assert((await rms(page))[0]>.01);
      await page.waitForFunction(()=>document.querySelector('#heading').textContent==='Listening'&&!document.querySelector('#message').textContent);
      await page.screenshot({path:'artifacts/listener-phone-waveform.png',fullPage:true});
      await page.setViewportSize({width:1280,height:850});await page.waitForTimeout(200);await page.screenshot({path:'artifacts/listener-waveform-desktop.png',fullPage:true});
    }
    await page.locator('#fallback').click();await page.waitForFunction(()=>window.sessionDiagnostics().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500);
    assert.equal(await page.locator('audio').count(),0);energy=await rms(page);assert(energy[0]>.01&&energy[1]>.005,`Silent PCM (${policy}): ${energy}`);
    if(policy==='supported')assert.equal(await page.evaluate(()=>navigator.audioSession.type),'playback');
    await page.locator('#connect').click();await page.waitForFunction(()=>!window.sessionDiagnostics().running);
    if(policy==='supported')await page.waitForFunction(()=>navigator.audioSession.type==='ambient');
    assert.deepEqual(errors,[]);report.checks.push({policy,result:'PASS',checks:'Stereo RTC/PCM, single muted decoder, volume zero, visible waveform/details, mobile layout, no page errors; supported API requests playback before context, on resume and restores on stop'});
    await context.close();
  }
  report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.stack;process.exitCode=1;}finally{await browser.close();await writeFile('artifacts/browser-playback-session.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
