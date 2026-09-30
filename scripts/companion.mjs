import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStreamServer} from '../server/index.mjs';
import {awaitTunnelReady} from '../server/tunnel-readiness.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=process.env.SESSIONSTREAM_STATE_DIR||path.join(homedir(),'Library','Caches','SessionStream');
await mkdir(state,{recursive:true});
// Managed helpers keep readiness in memory. A crashed predecessor's URL file
// cannot advertise a dead tunnel, even during the initial server bind.
let app;try{app=await createStreamServer({nativeSender:true,managedTunnel:true,runtimeDir:state});}catch(e){console.error(e.message);process.exit(1);}
const urlFile=path.join(state,'public-url.json'),config=path.join(state,'tunnel.yml');
await rm(urlFile,{force:true});await writeFile(config,'{}\n');
let tunnel,stopping=false,retry;
function launch(){
  app.setTunnelState('connecting');let carry='',found=false;
  const binary=process.env.CLOUDFLARED_PATH||path.join(root,'bin','cloudflared');
  tunnel=spawn(binary,['tunnel','--config',config,'--no-autoupdate','--url',`http://127.0.0.1:${app.publicPort}`],{stdio:['ignore','pipe','pipe']});
  const launched=tunnel;let exited=false;
  const current=()=>!stopping&&!exited&&tunnel===launched;
  async function advertise(url){
    app.setTunnelState('verifying');console.log('Checking tunnel:',url);
    if(await awaitTunnelReady({url,instance:app.instance,current})){
      if(!current())return;
      app.setTunnelState('ready',url);
      await writeFile(urlFile,JSON.stringify({url,instance:app.instance})).catch(()=>{});console.log('Invite site ready:',url);
    }else if(current())launched.kill('SIGTERM');
  }
  function capture(chunk){if(process.env.SESSIONSTREAM_DEBUG==='1')process.stderr.write(chunk);carry=(carry+chunk).slice(-12000);const match=carry.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match&&!found){found=true;advertise(match[0]).catch(e=>{console.error('Tunnel health:',e.message);if(current())launched.kill('SIGTERM');});}}
  tunnel.stdout.on('data',capture);tunnel.stderr.on('data',capture);
  // Some failures never print a URL: retry without needing a plugin reload.
  const deadline=setTimeout(()=>{if(current()&&!found)launched.kill('SIGTERM');},30000);
  function ended(){if(exited)return;exited=true;clearTimeout(deadline);if(!stopping&&tunnel===launched){app.setTunnelState('retrying');rm(urlFile,{force:true}).catch(()=>{});retry=setTimeout(launch,2000);}}
  tunnel.on('error',e=>{console.error('Tunnel:',e.message);ended();});
  tunnel.on('exit',ended);
}
launch();
async function stop(){if(stopping)return;stopping=true;clearTimeout(retry);app.setTunnelState('stopped');tunnel?.kill('SIGTERM');await rm(urlFile,{force:true});await app.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
