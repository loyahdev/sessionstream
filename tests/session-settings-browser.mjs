import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createStreamServer} from '../server/index.mjs';
let now=Date.now();
const account={identity:null,ready:Promise.resolve(),status:()=>({phase:'signed-out'}),close(){}};
const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},ignoreStoredURL:true,now:()=>now});
const local=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}`;const initial=await (await fetch(local+'/api/studio')).json();
const control=async(action,more={})=>{const r=await fetch(local+'/api/control',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({source:31337,action,...more})});assert(r.ok);};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});let lease;
try{
 await control('generate',{quality:'phone',expiresInHours:1});await control('start');lease=setInterval(()=>control('lease').catch(()=>{}),1000);
 const session=await (await fetch(local+'/api/studio')).json();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__socketCount=0;const NativeSocket=WebSocket;window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);window.__socketCount++;}};});
 await page.goto(`${remote}/listen?audio-test#${session.room}`);await page.locator('#connect').click();
 for(let i=0;i<80;i++){const s=await (await fetch(local+'/api/studio')).json();if(s.listeners===1)break;if(i===79)throw Error('Listener did not join');await new Promise(r=>setTimeout(r,100));}
 assert(await page.evaluate(()=>window.sessionDiagnostics().running));now=session.expiresAt;await fetch(local+'/api/studio');
 await page.waitForFunction(()=>!window.sessionDiagnostics().running);assert.match(await page.locator('body').innerText(),/expired/i);assert(await page.locator('#connect').isDisabled());
 const sockets=await page.evaluate(()=>window.__socketCount);await page.waitForTimeout(1800);assert.equal(await page.evaluate(()=>window.__socketCount),sockets);assert.deepEqual(errors,[]);
 await page.screenshot({path:'artifacts/session-expiry-browser.png',fullPage:true});console.log('PASS: real Chrome listener stops on expiry, displays reason, and does not reconnect; no page errors.');
}finally{clearInterval(lease);await browser.close();await app.close();}
