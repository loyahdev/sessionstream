import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createStreamServer} from '../server/index.mjs';
let now=Date.now(),app;const account={identity:null,ready:Promise.resolve(),status:()=>({phase:'signed-out'}),close(){}};
const advertise=()=>app.setTunnelState('ready','https://ui-preview.invalid/123456');
app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},now:()=>now,onInviteRequested:advertise});advertise();
let child,timer;try{
 const local=`http://127.0.0.1:${app.studioPort}`;child=spawn('./build/local-monitor',[local,String(app.udpPort)],{stdio:['ignore','pipe','pipe']});let output='',advanced=false;
 child.stdout.on('data',async b=>{output+=b;process.stdout.write(b);if(!advanced&&output.includes('EXPIRY_TEST_LIVE')){advanced=true;const s=await (await fetch(local+'/api/studio')).json();assert.equal(s.expiresInHours,1);now=s.expiresAt;await fetch(local+'/api/studio');}});child.stderr.on('data',b=>{output+=b;process.stderr.write(b);});
 timer=setTimeout(()=>child.kill('SIGTERM'),15000);const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0);assert(output.includes('PASS: expiry stops Send'));console.log('PASS: actual native controller and monitor recover from invite expiry without any editor.');
}finally{clearTimeout(timer);if(child?.exitCode===null)child.kill('SIGTERM');await app.close();}
