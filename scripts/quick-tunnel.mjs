import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStreamServer } from '../server/index.mjs';
const app = await createStreamServer();
await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});
const urlFile = new URL('../.runtime/public-url.json',import.meta.url);
await rm(urlFile,{force:true});
console.log(`Open broadcaster: http://127.0.0.1:${app.studioPort}/studio`);
// Only the listener port is exposed. Studio and raw plugin UDP stay local.
const configFile = new URL('../.runtime/quick-tunnel.yml',import.meta.url);
await writeFile(configFile, '{}\n');
const tunnel = spawn('cloudflared',['tunnel','--config',fileURLToPath(configFile),'--no-autoupdate','--url',`http://127.0.0.1:${app.publicPort}`],{stdio:['ignore','pipe','pipe']});
let carry = '', found = false;
async function capture(chunk) {
  const str=chunk.toString(); process.stdout.write(str); carry=(carry+str).slice(-12000);
  const match=carry.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !found) {found=true;await writeFile(urlFile,JSON.stringify({url:match[0]}));console.log(`\nPublic site ready: ${match[0]}\nCopy the private invite from your broadcaster.\n`);}
}
tunnel.stdout.on('data',capture); tunnel.stderr.on('data',capture);
let stopping = false;
async function stop(code=0) {if(stopping)return;stopping=true;tunnel.kill('SIGTERM');await rm(urlFile,{force:true});await app.close();process.exit(code);}
tunnel.on('error',async e=>{console.error(`Cannot start cloudflared: ${e.message}. Install it, or use npm start for local testing.`);await stop(1);});
tunnel.on('exit',code=>{if(!stopping)stop(code||0);});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
