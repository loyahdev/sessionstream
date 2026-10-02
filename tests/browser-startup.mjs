import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const session=await fetch('http://127.0.0.1:9878/api/studio').then(r=>r.json());
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
const checks=[];
try{
 for(const policy of ['once','always']){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(policy=>{
   window.__moduleAttempts=0;const original=AudioWorklet.prototype.addModule;
   AudioWorklet.prototype.addModule=function(url,...args){window.__moduleAttempts++;return original.call(this,policy==='always'||window.__moduleAttempts===1?'/missing-worklet.mjs':url,...args);};
  },policy);
  await page.goto(`http://127.0.0.1:9877/listen#${session.room}`);await page.locator('#connect').click();
  if(policy==='once')await page.waitForFunction(()=>window.sessionDiagnostics?.().connections.includes('connected'),null,{timeout:15000});
  else{await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('reload this page'));assert.equal(await page.evaluate(()=>window.sessionDiagnostics().running),false);assert.equal(await page.locator('#connect').isEnabled(),true);assert(!await page.locator('#message').textContent().then(s=>s.includes('Importing a module')));}
  assert.equal(await page.evaluate(()=>window.__moduleAttempts),2);assert.deepEqual(errors,[]);checks.push({policy,result:'PASS'});await page.close();
 }
}finally{await browser.close();await writeFile('artifacts/browser-startup-0.30.json',JSON.stringify(checks,null,2));console.log(checks);}
