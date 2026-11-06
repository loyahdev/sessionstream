import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';
const account={identity:null,ready:Promise.resolve(),status:()=>({phase:'signed-out'}),close(){}};
const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},ignoreStoredURL:true});
const local=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}`;const initial=await (await fetch(local+'/api/studio')).json();
const control=async(action,more={})=>{const r=await fetch(local+'/api/control',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({source:31337,action,...more})});assert(r.ok);};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});const udp=dgram.createSocket('udp4');let lease,audio,seq=0;
try{
 await control('generate',{quality:'balanced',expiresInHours:0});await control('start');lease=setInterval(()=>control('lease').catch(()=>{}),1000);audio=setInterval(()=>udp.send(tonePacket(seq++,256,48000,31337),app.udpPort,'127.0.0.1'),6);
 const session=await (await fetch(local+'/api/studio')).json();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__socketCount=0;window.__offerCount=0;const NativeSocket=WebSocket;window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);window.__socketCount++;this.addEventListener('message',event=>{if(typeof event.data==='string')try{if(JSON.parse(event.data).type==='offer')window.__offerCount++;}catch{}});}};});
 await page.goto(`${remote}/listen?audio-test#${session.room}`);await page.locator('#connect').click();
 await page.waitForFunction(()=>window.sessionDiagnostics().running&&window.sessionDiagnostics().connections.includes('connected'));const sockets=await page.evaluate(()=>window.__socketCount),offers=await page.evaluate(()=>window.__offerCount);
 await control('stop');await page.waitForFunction(()=>window.sessionDiagnostics().running&&!window.sessionDiagnostics().live);assert.equal((await (await fetch(local+'/api/studio')).json()).listeners,1);assert((await page.evaluate(()=>window.sessionDiagnostics().connections)).includes('connected'));
 await control('start');await page.waitForFunction(()=>window.sessionDiagnostics().running&&window.sessionDiagnostics().live);assert.equal(await page.evaluate(()=>window.__socketCount),sockets);assert.equal(await page.evaluate(()=>window.__offerCount),offers);assert((await page.evaluate(()=>window.sessionDiagnostics().connections)).includes('connected'));
 await control('end');await page.waitForFunction(()=>!window.sessionDiagnostics().running);assert.match(await page.locator('body').innerText(),/ended by the host/i);
 await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>window.__socketCount),sockets);assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/session-ended-browser.png',fullPage:true});
 console.log('PASS: real Chrome listener stays connected through Pause/Resume, receives End session, stops and does not reconnect.');
}finally{clearInterval(lease);clearInterval(audio);udp.close();await browser.close();await app.close();}
