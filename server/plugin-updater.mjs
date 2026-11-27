import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,copyFile,chmod,open,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const releaseAPI='https://api.github.com/repos/loyahdev/sessionstream/releases/latest';
export const updateAsset=platform=>platform==='darwin'?'SessionStream-mac-arm64.pkg':platform==='win32'?'SessionStream-windows-x64-arm64.exe':null;
export function versionParts(text){if(typeof text!=='string'||!/^v?\d{1,8}(\.\d{1,8}){1,3}$/.test(text))throw Error('Invalid update version.');return text.replace(/^v/,'').split('.').map(Number).concat([0,0,0,0]).slice(0,4);}
export function newerVersion(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<4;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
export function releaseAsset(release,platform,current){
 if(!release||release.draft||release.prerelease||!newerVersion(release.tag_name,current))throw Error('No newer release is ready.');
 const name=updateAsset(platform),asset=release.assets?.find(a=>a.name===name),tag=release.tag_name;
 if(!name||!asset||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>512*1024*1024||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('A verified update is not available for this computer.');
 const expected=`https://github.com/loyahdev/sessionstream/releases/download/${encodeURIComponent(tag)}/${name}`;
 if(asset.browser_download_url!==expected)throw Error('Invalid update download source.');
 return {version:tag.replace(/^v/,''),name,size:asset.size,sha256:asset.digest.slice(7),url:expected};
}
export async function digestFile(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
const exec=promisify(execFile);
async function macHostApplication(pid){
 const {stdout}=await exec('/bin/ps',['-ww','-p',String(pid),'-o','comm='],{timeout:2000,maxBuffer:8192});
 return stdout.trim().match(/^(\/.+\.app)\/Contents\/MacOS\/[^/\r\n]+$/)?.[1];
}
const allowedDownload=url=>{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname);};
export async function downloadResponse(url,{fetchImpl=fetch,signal}={}){
 for(let redirects=0;redirects<6;redirects++){
  if(!allowedDownload(url))throw Error('Invalid update redirect.');
  const response=await fetchImpl(url,{redirect:'manual',signal,headers:{'User-Agent':'SessionStream-Updater','Accept':'application/octet-stream'}});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('Invalid update redirect.');url=new URL(next,url).href;continue;}
  if(!response.ok||!response.body)throw Error('Update download failed. Try again.');return response;
 }throw Error('Too many update redirects.');
}
export class PluginUpdater {
 constructor({directory,currentVersion,platform=process.platform,fetchImpl=fetch,launch=spawn,node=process.execPath,hostApplication=macHostApplication}={}){Object.assign(this,{directory,currentVersion,platform,fetchImpl,launch,node,hostApplication});this.state={phase:'idle'};this.job=null;this.pending=null;this.ready=this.restore();}
 async restore(){try{const file=path.join(this.directory,'active.json'),entry=JSON.parse(await readFile(file,'utf8'));if(!/^[a-f0-9]{32}$/.test(entry.id))return;this.job=path.join(this.directory,entry.id);const state=JSON.parse(await readFile(path.join(this.job,'status.json'),'utf8'));if(['ready','waiting','applying','complete','error','cancelled'].includes(state.phase))this.state=state;}catch{}}
 async status(){await this.ready;if(this.job&&['waiting','applying'].includes(this.state.phase)){try{this.state=JSON.parse(await readFile(path.join(this.job,'status.json'),'utf8'));}catch{}try{const worker=JSON.parse(await readFile(path.join(this.job,'worker.json'),'utf8'));if(['waiting','applying'].includes(this.state.phase)&&Number.isSafeInteger(worker.pid)&&worker.pid>1){try{process.kill(worker.pid,0);}catch(error){if(error.code==='ESRCH'){await this.save({phase:'error',message:'The updater stopped before finishing. Download and try again.'});await rm(path.join(this.job,'control.lock'),{force:true});}}}}catch{}}return {...this.state};}
 async save(state){this.state={...state};if(this.job){const file=path.join(this.job,'status.json'),temp=file+'.tmp';await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,file);}}
 async prepare(){await this.ready;if(this.pending||['ready','waiting','applying'].includes(this.state.phase))return this.status();
  if(!updateAsset(this.platform))throw Error('Updates are not supported on this platform.');
  const controller=this.download=new AbortController();this.state={phase:'downloading',progress:0,message:'Checking release…'};
  this.pending=this.downloadRelease(controller).catch(async error=>{if(this.job)await rm(path.join(this.job,updateAsset(this.platform)+'.part'),{force:true}).catch(()=>{});const aborted=controller.signal.aborted;await this.save({phase:aborted?'cancelled':'error',message:aborted?'Update cancelled.':error.message});}).finally(()=>{this.pending=null;this.download=null;});return {...this.state};
 }
 async downloadRelease(controller){
  const response=await this.fetchImpl(releaseAPI,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),headers:{'User-Agent':'SessionStream-Updater','Accept':'application/vnd.github+json'},redirect:'error'});
  if(!response.ok)throw Error('Could not check the latest release. Try again.');
  const text=await response.text();if(text.length>1048576)throw Error('Invalid update metadata.');const asset=releaseAsset(JSON.parse(text),this.platform,this.currentVersion);
  await mkdir(this.directory,{recursive:true,mode:0o700});for(const entry of await readdir(this.directory,{withFileTypes:true})){if(!entry.isDirectory()||!/^[a-f0-9]{32}$/.test(entry.name))continue;const previous=path.join(this.directory,entry.name);try{const state=JSON.parse(await readFile(path.join(previous,'status.json'),'utf8'));if(['complete','cancelled','error','idle'].includes(state.phase))await rm(previous,{recursive:true,force:true});}catch{}}
  const id=randomBytes(16).toString('hex');this.job=path.join(this.directory,id);await mkdir(this.job,{recursive:true,mode:0o700});await chmod(this.job,0o700);await writeFile(path.join(this.directory,'active.json'),JSON.stringify({id}),{mode:0o600});
  const partial=path.join(this.job,asset.name+'.part'),target=path.join(this.job,asset.name);
  let count=0;const hash=createHash('sha256');const {open}=await import('node:fs/promises'),file=await open(partial,'wx',0o600);
  try{const stream=await downloadResponse(asset.url,{fetchImpl:this.fetchImpl,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)])});const declared=stream.headers.get('content-length');if(declared!==null&&Number(declared)!==asset.size)throw Error('Update size does not match the release.');
   for await(const chunk of stream.body){if(controller.signal.aborted)throw Error('Update cancelled.');count+=chunk.length;if(count>asset.size)throw Error('Update download is larger than expected.');hash.update(chunk);await file.writeFile(chunk);this.state={phase:'downloading',version:asset.version,progress:count/asset.size,message:'Downloading update…'};}
  }finally{await file.close();}
  if(controller.signal.aborted)throw Error('Update cancelled.');if(count!==asset.size||hash.digest('hex')!==asset.sha256){await rm(partial,{force:true});throw Error('Update verification failed. Nothing was installed.');}
  await rename(partial,target);await writeFile(path.join(this.job,'release.json'),JSON.stringify(asset),{mode:0o600});await this.save({phase:'ready',version:asset.version,progress:1,message:'Ready. Install after closing all DAWs.'});
 }
 async install(hostPID,{reopen=false}={}){await this.ready;if(this.state.phase==='waiting'||this.state.phase==='applying')return this.status();if(this.state.phase!=='ready'||!Number.isSafeInteger(hostPID)||hostPID<=1||hostPID===process.pid)throw Error('Download the update before installing.');
  const asset=JSON.parse(await readFile(path.join(this.job,'release.json'),'utf8'));if(await digestFile(path.join(this.job,asset.name))!==asset.sha256)throw Error('Update verification failed. Download it again.');
  // Run from a private cache. Windows cannot replace a runtime executable in use.
  const binary=path.join(this.job,this.platform==='win32'?'update-node.exe':'update-node');await copyFile(this.node,binary);await chmod(binary,0o700);
  await copyFile(fileURLToPath(new URL('./update-worker.mjs',import.meta.url)),path.join(this.job,'update-worker.mjs'));
  const reopenApp=reopen&&this.platform==='darwin'?await this.hostApplication(hostPID).catch(()=>null):null;
  const job={asset,platform:this.platform,hostPID,enginePID:process.pid,createdAt:Date.now(),...(reopenApp?{reopenApp}:{})};await writeFile(path.join(this.job,'job.json'),JSON.stringify(job),{mode:0o600});
  const message=reopenApp?'Save your project and quit your DAW. It will reopen after the update.':'Quit all DAWs, then wait for installation before reopening.';
  await this.save({phase:'waiting',version:asset.version,message});
  try{const child=this.launch(binary,[path.join(this.job,'update-worker.mjs'),path.join(this.job,'job.json')],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});if(Number.isSafeInteger(child.pid))await writeFile(path.join(this.job,'worker.json'),JSON.stringify({pid:child.pid}),{mode:0o600});child.unref();}catch{await this.save({phase:'error',version:asset.version,message:'Could not start the updater. Download and try again.'});}
  return this.status();
 }
 async cancel(){await this.ready;this.download?.abort();if(this.pending)await this.pending;let lock;
  try{if(this.job)lock=await open(path.join(this.job,'control.lock'),'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Installation has already started.');throw error;}
  try{if(this.state.phase==='applying')throw Error('Installation has already started.');if(this.job)await writeFile(path.join(this.job,'cancel'),'',{mode:0o600});await this.save({phase:'cancelled',message:'Update cancelled.'});return this.status();}finally{if(lock){await lock.close();await rm(path.join(this.job,'control.lock'),{force:true});}}
 }

 async dismiss(){if(['waiting','applying','downloading'].includes(this.state.phase))return this.cancel();this.state={phase:'idle'};if(this.job)await writeFile(path.join(this.job,'status.json'),JSON.stringify(this.state),{mode:0o600});return this.status();}
 async close(){this.download?.abort();await this.pending;}
}
