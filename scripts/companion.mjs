import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStreamServer} from '../server/index.mjs';
import {acquireManagedTunnel} from '../server/managed-tunnel.mjs';
import {awaitTunnelReady,awaitManagedTunnelReady} from '../server/tunnel-readiness.mjs';
import {retireLegacyHelper} from '../server/retire-legacy.mjs';
import {runtimeStateDirectory, executableName} from '../server/platform.mjs';
import {installRuntimeLogging,createLineLogger} from '../server/diagnostics.mjs';
const log=installRuntimeLogging('engine');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=runtimeStateDirectory();
await mkdir(state,{recursive:true});
if(process.argv.includes('--replace-legacy'))await retireLegacyHelper(Number(process.env.STUDIO_PORT||8788));
const urlFile=path.join(state,'public-url.json'),config=path.join(state,'tunnel.yml');
let tunnel,stopping=false,retry,managed=null,managedFailed=false,leaseTimer,leaseBusy=false,leaseRoom,leaseRenewed=0,leaseSelection='',requested=false;
// Managed helpers keep readiness in memory. A crashed predecessor's URL file
// cannot advertise a dead tunnel, even during the initial server bind.
let app;try{app=await createStreamServer({log,nativeSender:true,managedTunnel:true,managedLifetime:true,onNoClients:()=>stop(),onInviteRequested:requestTunnel,tunnelPID:()=>tunnel?.pid,runtimeDir:state});}catch(e){console.error(e.message);process.exit(1);}
await rm(urlFile,{force:true});await writeFile(config,'{}\n');
async function launch(){
  if(stopping)return;
  if(!managedFailed&&!managed){
    const initialRoom=app.inviteRevision;
    try{managed=await acquireManagedTunnel({port:app.publicPort,room:initialRoom,custom:()=>app.customLinkSelection});}
    catch{managedFailed=true;log('tunnel','Managed provisioning unavailable; using Quick Tunnel');}
    if(stopping){await managed?.release().catch(()=>{});managed=null;return;}
    if(managed){app.setManagedIceServers?.(managed.iceServers);leaseSelection=app.customLinkSelection?.name||'';leaseRoom=initialRoom;leaseRenewed=Date.now();}
  }
  if(stopping)return;
  log('tunnel','launching');
  app.setTunnelState('connecting');let carry='',found=false;
  const binary=process.env.CLOUDFLARED_PATH||path.join(root,'bin',executableName('cloudflared'));
  const args=['tunnel','--config',config,'--no-autoupdate',...(managed?['run']:['--url',`http://127.0.0.1:${app.publicPort}`])];
  const childEnv={...process.env};delete childEnv.TUNNEL_TOKEN;delete childEnv.TUNNEL_TOKEN_FILE;
  if(managed)childEnv.TUNNEL_TOKEN=managed.token;
  const supervisor=process.env.SESSIONSTREAM_SUPERVISOR_PATH||path.join(root,'bin','windows-tunnel-supervisor.exe');
  tunnel=process.platform==='win32'
    ?spawn(supervisor,[String(process.pid),binary,...args],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']})
    :spawn(binary,args,{env:childEnv,stdio:['ignore','pipe','pipe']});
  const launched=tunnel;let exited=false;
  const current=()=>!stopping&&!exited&&tunnel===launched;
  async function advertise(url,room=app.inviteRevision){
    app.setTunnelState('verifying',url,room);console.log('Checking tunnel:',url);
    const valid=()=>current()&&(!managed||room===app.inviteRevision&&url===managed.url);
    if(await (managed?awaitManagedTunnelReady:awaitTunnelReady)({url,instance:app.instance,current:valid,onProgress:progress=>log('readiness',JSON.stringify(progress))})){
      if(!current())return;
      if(managed&&room!==app.inviteRevision)return;
      app.setTunnelState('ready',url,room);
      await writeFile(urlFile,JSON.stringify({url,instance:app.instance})).catch(()=>{});console.log('Invite site ready:',url);
    }else if(valid()){log('readiness','Health checks timed out; restarting tunnel');launched.kill('SIGTERM');}
  }
  const stdoutLog=createLineLogger(line=>log('cloudflared stdout',line)),stderrLog=createLineLogger(line=>log('cloudflared stderr',line));
  function capture(chunk){if(process.env.SESSIONSTREAM_DEBUG==='1')process.stderr.write(chunk);carry=(carry+chunk).slice(-12000);if(managed&&!found&&/Registered tunnel connection/.test(carry)){found=true;advertise(managed.url,leaseRoom).catch(()=>{if(current())launched.kill('SIGTERM');});}
    const match=!managed&&carry.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match&&!found){found=true;advertise(match[0]).catch(e=>{console.error('Tunnel health:',e.message);if(current())launched.kill('SIGTERM');});}}
  tunnel.stdout.on('data',chunk=>{stdoutLog(chunk);capture(chunk);});tunnel.stderr.on('data',chunk=>{stderrLog(chunk);capture(chunk);});
  tunnel.stdout.on('end',()=>stdoutLog.end());tunnel.stderr.on('end',()=>stderrLog.end());
  // Some failures never print a URL: retry without needing a plugin reload.
  const deadline=setTimeout(()=>{if(current()&&!found){log('tunnel','No hostname within 30 seconds; restarting');launched.kill('SIGTERM');}},30000);
  function ended(code,signal){if(exited)return;exited=true;stdoutLog.end();stderrLog.end();log('tunnel',`exited code=${code} signal=${signal}`);clearTimeout(deadline);clearInterval(leaseTimer);if(managed&&!stopping){const expired=managed;managed=null;managedFailed=true;app.setManagedIceServers?.(null);expired.release().catch(()=>{});}if(!stopping&&tunnel===launched){app.setTunnelState('retrying');rm(urlFile,{force:true}).catch(()=>{});retry=setTimeout(()=>launch().catch(()=>stop()),2000);}}
  tunnel.on('error',e=>{console.error('Tunnel:',e.message);ended();});
  tunnel.on('exit',ended);
  if(managed){
    leaseTimer=setInterval(async()=>{
      if(leaseBusy||!current()||!managed)return;
      const room=app.inviteRevision;
      const selection=app.customLinkSelection?.name||'';
      if(room===leaseRoom&&selection===leaseSelection&&Date.now()-leaseRenewed<60000)return;
      leaseBusy=true;
      const active=managed;
      try{
        const previousURL=active.url;const url=await active.renew(room);
        if(!current()||managed!==active)return;
        app.setManagedIceServers?.(active.iceServers);
        leaseRenewed=Date.now();leaseSelection=selection;
        if(room!==leaseRoom||url!==previousURL){leaseRoom=room;if(found)await advertise(url,room);}
        else if(found&&!await awaitManagedTunnelReady({url,instance:app.instance,current:()=>current()&&managed===active&&app.inviteRevision===room,attempts:3})){
          if(current()&&app.inviteRevision===room)launched.kill('SIGTERM');
        }
      }catch{if(current()){log('tunnel','Managed lease unavailable; switching to Quick Tunnel');launched.kill('SIGTERM');}}
      finally{leaseBusy=false;}
    },500);
  }
}
function requestTunnel(){if(requested||stopping)return;requested=true;launch().catch(()=>stop());}
process.send?.({ready:true});
async function stop(){
  if(stopping)return;stopping=true;clearTimeout(retry);clearInterval(leaseTimer);app.setTunnelState('stopped');
  log('lifecycle','Stopping helper and tunnel');
  // Finish the tunnel child before exiting so it cannot survive its helper.
  const force=setTimeout(()=>{tunnel?.kill('SIGKILL');process.exit(1);},4000);
  if(tunnel?.pid&&tunnel.exitCode===null&&tunnel.signalCode===null){
    const exited=new Promise(resolve=>tunnel.once('exit',resolve));
    const kill=setTimeout(()=>tunnel.kill('SIGKILL'),2000);
    tunnel.kill('SIGTERM');await exited;clearTimeout(kill);
  }
  await Promise.race([managed?.release().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1000))]);
  await rm(urlFile,{force:true});await app.close();clearTimeout(force);process.exit(0);
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
