import {createStreamServer} from '../server/index.mjs';
import {acquireManagedTunnel} from '../server/managed-tunnel.mjs';
import {awaitTunnelReady} from '../server/tunnel-readiness.mjs';
import {tonePacket} from '../server/protocol.mjs';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';import dgram from 'node:dgram';import assert from 'node:assert/strict';
const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0});
let lease,child,browser,toneTimer,controlTimer;const udp=dgram.createSocket('udp4');let active=true,logs='';
const report={testedAt:new Date().toISOString(),checks:[]};
try{
 const base=`http://127.0.0.1:${app.studioPort}`,initial=await fetch(base+'/api/studio').then(r=>r.json());
 const control=async action=>{const r=await fetch(base+'/api/control',{method:'POST',headers:{Origin:base,Authorization:`Bearer ${initial.token}`},body:JSON.stringify({source:12345,action,passcode:'managed-test-7294',requestId:crypto.randomUUID()})});assert.equal(r.status,200);};
 await control('generate');
 lease=await acquireManagedTunnel({port:app.publicPort,room:app.inviteRevision,request:async(url,options)=>{const response=await fetch(url,options);if(!response.ok){const data=await response.clone().json().catch(()=>({}));console.log(JSON.stringify({brokerStatus:response.status,error:data.error,diagnostic:data.diagnostic}));}return response;}});assert(lease);console.log('Managed lease provisioned');
 await writeFile('/tmp/sessionstream-live-cloudflared.yml','{}\n');
 child=spawn(process.env.CLOUDFLARED_PATH||'cloudflared',['tunnel','--config','/tmp/sessionstream-live-cloudflared.yml','--no-autoupdate','run'],{env:{...process.env,TUNNEL_TOKEN:lease.token},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>logs=(logs+b).slice(-12000));child.stderr.on('data',b=>logs=(logs+b).slice(-12000));child.on('exit',()=>active=false);
 app.setTunnelState('verifying',lease.url);
 assert(await awaitTunnelReady({url:lease.url,instance:app.instance,current:()=>active,onProgress:p=>{if(p.ok)console.log('Health stage passed:',p.stage);}}),'Public managed tunnel not ready');
 app.setTunnelState('ready',lease.url);report.checks.push('Live Cloudflare tunnel, custom-domain routing, DNS and instance health');console.log('Public managed tunnel ready');
 await control('start');controlTimer=setInterval(()=>control('lease').catch(()=>{}),1000);
 let sequence=0;toneTimer=setInterval(()=>udp.send(tonePacket(sequence++,240,48000,12345),app.udpPort,'127.0.0.1'),5);
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(lease.url+'?audio-test');await page.locator('#passcode-form').waitFor({state:'visible'});await page.locator('#passcode').fill('managed-test-7294');await page.locator('#passcode-submit').click();
 await page.waitForFunction(()=>window.sessionDiagnostics?.().connections.includes('connected'),null,{timeout:20000});
 const measure=()=>page.evaluate(async()=>{const {context,gain}=window.__testAudio,split=context.createChannelSplitter(2),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);gain.connect(split);const analysers=[context.createAnalyser(),context.createAnalyser()];analysers.forEach((a,i)=>{a.fftSize=2048;split.connect(a,i);a.connect(sink);});await new Promise(r=>setTimeout(r,1500));return analysers.map(a=>{const samples=new Float32Array(2048);a.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);});});
 const energy=await measure();assert(energy[0]>.005&&energy[1]>.003,`Silent stereo ${energy}`);report.checks.push('Protected code-only public link renders stereo WebRTC audio in Chrome');report.stereoRMS=energy;
 await page.locator('#mode-buffered').check();await page.waitForFunction(()=>window.sessionDiagnostics?.().pcm&&window.sessionDiagnostics?.().lastAudioAgeMs<1000,null,{timeout:10000});const bufferedEnergy=await measure();assert(bufferedEnergy[0]>.005&&bufferedEnergy[1]>.003,`Silent buffered stereo ${bufferedEnergy}`);report.bufferedStereoRMS=bufferedEnergy;report.checks.push('Buffered PCM audio renders stereo through the public Worker WebSocket');
 assert.equal(errors.length,0,JSON.stringify(errors));
 const old=lease.url;await control('generate');const next=await lease.renew(app.inviteRevision);app.setTunnelState('verifying',next);assert.equal((await fetch(old)).status,404);assert(await awaitTunnelReady({url:next,instance:app.instance,current:()=>active}));app.setTunnelState('ready',next);report.checks.push('Generating an invite replaces the six-digit code and expires the old public link');
 report.result='PASS';console.log('Live managed browser/audio checks passed');
}finally{
 clearInterval(toneTimer);clearInterval(controlTimer);await browser?.close();udp.close();
 if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await exit;clearTimeout(timer);}
 if(lease){const old=lease.url;await lease.release();assert.equal((await fetch(old)).status,404);report.checks.push('Lease release expires the link and deletes DNS/tunnel resources');}
 await app.close();await writeFile('/tmp/sessionstream-managed-live-validation.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
