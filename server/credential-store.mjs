import {existsSync,readFileSync} from 'node:fs';
import {chmod,copyFile,link,lstat,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const helperName=`account-credentials${process.platform==='win32'?'.exe':''}`;
const packaged=fileURLToPath(new URL(`../bin/${helperName}`,import.meta.url));
const defaultBinary=existsSync(packaged)?packaged:fileURLToPath(new URL(`../build/${helperName}`,import.meta.url));
const helperDirectory=path.join(homedir(),'Library','Application Support','SessionStream','Keychain');
let sharedHelper;
function hasStableCredentialSigning(){
  try{return JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).stableCredentialSigning===true;}
  catch{return false;}
}

// Ad-hoc builds use one private helper across formats and rebuilds. Developer ID
// builds use the packaged helper so they pick up fixes under its stable identity.
export async function preserveCredentialHelper(source,directory=helperDirectory){
  await mkdir(directory,{recursive:true,mode:0o700});
  const owner=process.getuid();
  const contents=await lstat(directory);
  if(!contents.isDirectory()||contents.uid!==owner||(contents.mode&0o077)!==0)throw Error('Invalid credential helper directory');
  const target=path.join(directory,'account-credentials');
  const validate=async()=>{
    const file=await lstat(target);
    if(!file.isFile()||file.uid!==owner||(file.mode&0o777)!==0o700)throw Error('Invalid credential helper');
    return target;
  };
  try{return await validate();}catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=await mkdtemp(path.join(directory,'.install-'));
  try{
    const file=path.join(staging,'account-credentials');
    await copyFile(source,file);
    await chmod(file,0o700);
    try{await link(file,target);}catch(error){if(error.code!=='EEXIST')throw error;}
    return await validate();
  }finally{await rm(staging,{recursive:true,force:true});}
}

export class CredentialStore {
  constructor(issuer,clientId,{binary=defaultBinary}={}) {
    this.binary=binary;this.key=createHash('sha256').update(`${issuer}\n${clientId}`).digest('hex');this.queue=Promise.resolve();
  }
  run(action,value='',{interactive=false}={}) {
    const operation=this.queue.then(async()=>{
      const binary=this.binary===packaged&&process.platform==='darwin'&&!hasStableCredentialSigning()
        ?await (sharedHelper??=preserveCredentialHelper(packaged).catch(()=>packaged))
        :this.binary;
      return new Promise((resolve,reject)=>{
        if(Buffer.byteLength(value)>5120)return reject(Error('Credential is too large'));
        const child=spawn(binary,[action,this.key,...(interactive?['--interactive']:[])],{stdio:['pipe','pipe','ignore'],windowsHide:true});
        const chunks=[];let size=0,failed=false;
        const fail=(authRequired=false)=>{if(!failed){failed=true;const error=Error(authRequired?'Saved sign-in needs Keychain approval. Use Sign in to reconnect.':'Secure credential storage is unavailable');error.code=authRequired?'SECURE_STORAGE_AUTH_REQUIRED':'SECURE_STORAGE_UNAVAILABLE';reject(error);}};
        const timer=setTimeout(()=>{child.kill();fail();},interactive?120000:15000);timer.unref();
        child.on('error',()=>fail());child.stdin.on('error',()=>fail());
        child.stdout.on('data',chunk=>{size+=chunk.length;if(size>5120){child.kill();fail();}else chunks.push(chunk);});
        child.on('close',code=>{clearTimeout(timer);if(code!==0)fail(code===3);else if(!failed)resolve(Buffer.concat(chunks).toString('utf8'));});
        child.stdin.end(value);
      });
    });
    this.queue=operation.catch(()=>{});return operation;
  }
  async read(options){const value=await this.run('read','',options);if(!value)return null;const data=JSON.parse(value);return typeof data.refreshToken==='string'?data.refreshToken:null;}
  write(refreshToken,options){return this.run('write',JSON.stringify({refreshToken}),options);}
  clear(options){return this.run('clear','',options);}
}
