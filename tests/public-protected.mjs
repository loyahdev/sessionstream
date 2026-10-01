// Optional integration check against an already-running synthetic plugin
// preview. Do not use this on an active client session.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
const api=process.env.STUDIO_API||'http://127.0.0.1:8788/api/studio';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={testedAt:new Date().toISOString(),checks:[]},errors=[];
const read=()=>fetch(api).then(r=>r.json());
async function waitFor(check){for(let n=0;n<100;n++){const s=await read();if(check(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('Producer state did not recover');}
try{
 const session=await read();assert(session.live&&session.passcodeRequired&&session.publicSiteReady);
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(session.listenerURL.replace('/listen#','/listen?audio-test#'));
 await page.locator('#passcode-form').waitFor({state:'visible'});
 assert.equal((await read()).listeners,0);
 await page.locator('#passcode').fill('incorrect-code');await page.locator('#passcode-submit').click();
 await page.waitForFunction(()=>document.querySelector('#passcode-error').textContent.includes('Incorrect'));
 assert.equal((await read()).listeners,0);assert.equal(await page.evaluate(()=>window.sessionDiagnostics().connections.length),0);
 await page.locator('#passcode').fill(process.env.SESSIONSTREAM_TEST_PASSCODE||'studio-preview-20');await page.locator('#passcode-submit').click();
 await page.waitForFunction(()=>window.sessionDiagnostics().connections.includes('connected'),null,{timeout:20000});
 await page.waitForFunction(()=>{const a=new Float32Array(2048);window.__testAudio.analyser.getFloatTimeDomainData(a);return a.some(x=>Math.abs(x)>.005);});
 report.checks.push({name:'Plugin-generated public protected link: incorrect code has no listener/peer, correct code renders stereo audio',result:'PASS'});
 await page.locator('#mute').click();await page.waitForTimeout(1200);assert.equal((await read()).listenerIssue,null);
 await page.locator('#mute').click();await page.locator('#fallback').click();
 await page.waitForFunction(()=>window.sessionDiagnostics().pcm&&window.sessionDiagnostics().lastAudioAgeMs<500,null,{timeout:15000});
 await page.waitForFunction(()=>{const a=new Float32Array(2048);window.__testAudio.analyser.getFloatTimeDomainData(a);return a.some(x=>Math.abs(x)>.005);});
 report.checks.push({name:'Public compatibility PCM and mute preserve protection and normal producer status',result:'PASS'});
 await page.evaluate(()=>window.__testAudio.context.suspend());await waitFor(s=>s.listenerIssue?.includes('enable audio'));
 console.log('CHECKPOINT: listener browser audio blocked; inspect native warning');
 if(process.env.VERIFY_NATIVE_EDITOR==='1'){const lines=createInterface({input:process.stdin});await lines.question('');lines.close();}
 await page.locator('#connect').click();await waitFor(s=>!s.listenerIssue);
 await page.waitForFunction(()=>window.sessionDiagnostics().context==='running');
 report.checks.push({name:'Browser error reaches actual plugin status and clears after Resume',result:'PASS'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'artifacts/listener-public-protected-0.20.png',fullPage:true});
 await page.locator('#connect').click();await waitFor(s=>s.listeners===0&&!s.listenerIssue);
 assert.deepEqual(errors,[]);report.checks.push({name:'Mobile-width layout, clean disconnect and no runtime errors',result:'PASS'});report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.stack;process.exitCode=1;}
finally{await browser.close();await writeFile('artifacts/public-protected-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
