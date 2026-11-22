// Detached updater: never replaces plugin files while its host or engine is running.
import {readFile,writeFile,rename,stat,open,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function processAlive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
export async function applyPackage(file,job){
 if(job.platform==='darwin'){
  await exec('/usr/sbin/installer',['-pkg',file,'-target','CurrentUserHomeDirectory'],{timeout:600000,maxBuffer:1048576});
  for(const name of ['VST3/SessionStream.vst3','Components/SessionStream.component']){const {stdout}=await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(homedir(),'Library/Audio/Plug-Ins',name,'Contents/Info.plist')]);if(stdout.trim()!==job.asset.version)throw Error('The installed version could not be confirmed.');}
 }else{
  // Only the path is dynamic, encoded as data rather than PowerShell source.
  const encodedPath=Buffer.from(file).toString('base64');const script=`$ErrorActionPreference='Stop'; $setup=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $p=Start-Process -FilePath $setup -ArgumentList '/S' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:600000,windowsHide:true,maxBuffer:1048576});
  const base=process.env.CommonProgramW6432||process.env.CommonProgramFiles;if(!base)throw Error('The installed version could not be confirmed.');const version=await readFile(path.join(base,'VST3/SessionStream.vst3/Contents/Resources/sessionstream-version.txt'),'utf8');if(version.trim()!==job.asset.version)throw Error('The installed version could not be confirmed.');
 }
}
export async function runUpdateJob(file,{alive=processAlive,apply=applyPackage,sleep=delay,now=Date.now,platform=process.platform}={}){
 const folder=path.dirname(file),status=async state=>{const target=path.join(folder,'status.json');await writeFile(target+'.worker',JSON.stringify(state),{mode:0o600});await rename(target+'.worker',target);};let job,lock;
 try{
  job=JSON.parse(await readFile(file,'utf8'));const expected=platform==='darwin'?'SessionStream-mac-arm64.pkg':platform==='win32'?'SessionStream-windows-x64-arm64.exe':null;
  if(!expected||job.platform!==platform||job.asset?.name!==expected||!/^\d{1,8}(\.\d{1,8}){1,3}$/.test(job.asset.version)||!Number.isSafeInteger(job.asset.size)||job.asset.size<1||job.asset.size>536870912||!Number.isFinite(job.createdAt)||!/^([a-f0-9]{64})$/.test(job.asset.sha256)||![job.hostPID,job.enginePID].every(pid=>Number.isSafeInteger(pid)&&pid>1&&pid!==process.pid))throw Error('Invalid update job.');
  const cancelled=async()=>{try{await stat(path.join(folder,'cancel'));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  const deadline=job.createdAt+86400000;
  while(alive(job.hostPID)||alive(job.enginePID)){if(await cancelled()){await status({phase:'cancelled',message:'Update cancelled.'});return;}if(now()>deadline)throw Error('Update timed out waiting for your DAW. Try again.');await sleep(1000);}
  for(let attempt=0;!lock;attempt++){try{lock=await open(path.join(folder,'control.lock'),'wx',0o600);}catch(error){if(error.code!=='EEXIST'||attempt>=10)throw Error('The updater is busy. Try again.');await sleep(100);}}
  if(await cancelled()){await status({phase:'cancelled',message:'Update cancelled.'});return;}
  const packageFile=path.join(folder,expected),info=await stat(packageFile);if(info.size!==job.asset.size)throw Error('Update verification failed. Nothing was installed.');const hash=createHash('sha256');for await(const chunk of createReadStream(packageFile))hash.update(chunk);if(hash.digest('hex')!==job.asset.sha256)throw Error('Update verification failed. Nothing was installed.');
  await status({phase:'applying',version:job.asset.version,message:'Installing SessionStream…'});try{await apply(packageFile,job);}catch{throw Error('The update could not be installed. Reopen your DAW and try again.');}await status({phase:'complete',version:job.asset.version,message:`Updated to ${job.asset.version}. Reopen your DAW.`});
 }catch(error){await status({phase:'error',version:job?.asset?.version,message:error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'Update installation failed. Try again.':String(error.message).slice(0,250)});}finally{if(lock){await lock.close();await rm(path.join(folder,'control.lock'),{force:true});}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runUpdateJob(path.resolve(process.argv[2]||''));
