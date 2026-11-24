// Actual compiled VST3 wrapper, local engine and listener; no public tunnel.
// Uses the plugin's normal localhost ports. Stop existing broadcasts first.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import dgram from 'node:dgram';
import {NativeReceiver} from '../server/native-receiver.mjs';
import {createStreamServer} from '../server/index.mjs';
import {senderPlanFixture} from './fixtures/sender-plan.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const app=await createStreamServer({nativeSender:true,managedTunnel:true,managedLifetime:true,studioPort:8788,udpPort:49300,publicPort:0,ignoreStoredURL:true,...senderPlanFixture()});
app.setTunnelState('ready','https://render-test.invalid');
const state=()=>fetch(`http://127.0.0.1:${app.studioPort}/api/studio`).then(r=>r.json());
const build=process.platform==='win32'?'build-windows-x64':'build';
const plugin=process.env.PLUGIN_PATH||`${build}/SessionStream_artefacts/Release/VST3/SessionStream.vst3`;
const probe=process.env.SESSIONSTREAM_VST3_PROBE||(process.platform==='win32'?[`${build}/vst3-probe.exe`,`${build}/Release/vst3-probe.exe`].find(existsSync):'./build/vst3-probe');
const child=spawn(probe||`${build}/Release/vst3-probe.exe`,[path.resolve(plugin),'180'],{stdio:['pipe','pipe','pipe']});
let output='',ended=false,failure,receiver,received=0;const packets=dgram.createSocket('udp4');packets.on('message',()=>++received);
child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
child.stderr.on('data',chunk=>{output+=chunk;process.stderr.write(chunk);});
child.once('error',error=>{failure=error;ended=true;});
const exit=new Promise(resolve=>child.once('exit',code=>{ended=true;resolve(code);}));
async function waitFor(check,label){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){if(failure)throw failure;if(await check())return;if(ended)throw Error(`Host exited: ${output}`);await sleep(25);}
  throw Error(`Timed out: ${label}`);
}
async function command(value){const previous=output.length;child.stdin.write(value+'\n');await waitFor(()=>output.slice(previous).includes('CONTROL: '+value),value);}
try{
  await waitFor(async()=>{const s=await state();return s.live&&s.audio;},'initial live plugin');
  let initial=await state();const origin=`http://127.0.0.1:${app.publicPort}`;
  await new Promise(resolve=>packets.bind(0,'127.0.0.1',resolve));
  app.setTunnelState('ready',origin+'/123456',initial.room);initial=await state();
  receiver=new NativeReceiver({urlOverride:new URL(origin+'/123456'),mode:'pcm',port:packets.address().port});
  await waitFor(()=>received>0,'actual encrypted plugin audio at listener');const listenerSocket=receiver.ws;
  for(let cycle=0;cycle<2;++cycle){
    await command('offline 1');await sleep(300);const before=received;
    await sleep(6200);assert.equal(received,before,'Offline render leaked audio to the listener');
    let s=await state();assert.equal(s.listenerURL,initial.listenerURL);assert.equal(s.engineClients,1);assert(s.live);assert.equal(receiver.ws,listenerSocket);assert.equal(receiver.ws.readyState,1);
    await command('offline 0');await waitFor(()=>received>before,'actual plugin audio after export');
    await command('deactivate');await sleep(6500);s=await state();assert.equal(s.listenerURL,initial.listenerURL);assert.equal(s.engineClients,1);
    const paused=received;await command('activate');await waitFor(()=>received>paused,'actual plugin audio after reprepare');
  }
  await command('remove');assert.equal(await exit,0,output);
  assert.equal((await state()).engineClients,0);
  console.log('PASS: actual VST3 wrapper preserves the engine, invite and listener across repeated offline exports and long release/reprepare, transmits no offline PCM, then resumes real plugin audio');
}finally{
  if(!ended){child.kill('SIGTERM');await Promise.race([exit,sleep(2000)]);}
  receiver?.close();packets.close();await app.close();
}
