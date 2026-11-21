import {chromium} from 'playwright';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import assert from 'node:assert/strict';
const directory=await mkdtemp(path.join(tmpdir(),'sessionstream-browser-alias-'));
const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,runtimeDir:directory,account:{status:()=>({phase:'signed-out'}),close(){}},linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}}});
const udp=dgram.createSocket('udp4');let browser,timer,sequence=0;
try{
 const studio=`http://127.0.0.1:${app.studioPort}`,initial=await (await fetch(studio+'/api/studio')).json();
 const control=async action=>{const response=await fetch(studio+'/api/control',{method:'POST',headers:{Origin:studio,Authorization:`Bearer ${initial.token}`,'Content-Type':'application/json'},body:JSON.stringify({source:12345,action})});assert.equal(response.status,200);};
 await control('generate');app.setTunnelState('ready','https://sessionstream.app/browser-studio');await control('start');
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage();const sockets=[];page.on('websocket',ws=>sockets.push(ws.url()));
 await page.goto(`http://127.0.0.1:${app.publicPort}/browser-studio?audio-test`);await page.check('#mode-buffered');await page.click('#connect');
 timer=setInterval(()=>udp.send(tonePacket(sequence++,256,48000,12345),app.udpPort,'127.0.0.1'),5);
 await page.waitForFunction(()=>window.__testAudio?.context.state==='running'&&window.sessionDiagnostics().lastAudioAgeMs!==null,{timeout:15000});
 assert(sockets.some(url=>url.endsWith('/browser-studio/signal')));
 const energy=await page.evaluate(async()=>{
   const {gain,context}=window.__testAudio,split=context.createChannelSplitter(2),sink=context.createGain(),analysers=[context.createAnalyser(),context.createAnalyser()];sink.gain.value=0;sink.connect(context.destination);gain.connect(split);
   analysers.forEach((a,i)=>{a.fftSize=2048;split.connect(a,i);a.connect(sink);});await new Promise(r=>setTimeout(r,500));
   const energy=analysers.map(a=>{const samples=new Float32Array(2048);a.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length);});gain.disconnect(split);split.disconnect();analysers.forEach(a=>a.disconnect());sink.disconnect();return energy;
 });
 assert(energy[0]>.02&&energy[1]>.01,JSON.stringify(energy));assert(energy[0]/energy[1]>1.5&&energy[0]/energy[1]<2.5);
 console.log('PASS: custom-name browser page loads its prefixed assets/socket and plays distinct stereo channels');
}finally{clearInterval(timer);await browser?.close();try{udp.close();}catch{}await app.close();await rm(directory,{recursive:true,force:true});}
