import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const helperName=`account-credentials${process.platform==='win32'?'.exe':''}`;
const packaged=fileURLToPath(new URL(`../bin/${helperName}`,import.meta.url));
const defaultBinary=existsSync(packaged)?packaged:fileURLToPath(new URL(`../build/${helperName}`,import.meta.url));

export class CredentialStore {
  constructor(issuer,clientId,{binary=defaultBinary}={}) {
    this.binary=binary;this.key=createHash('sha256').update(`${issuer}\n${clientId}`).digest('hex');this.queue=Promise.resolve();
  }
  run(action,value='',{interactive=false}={}) {
    const operation=this.queue.then(()=>new Promise((resolve,reject)=>{
      if(Buffer.byteLength(value)>5120)return reject(Error('Credential is too large'));
      const child=spawn(this.binary,[action,this.key,...(interactive?['--interactive']:[])],{stdio:['pipe','pipe','ignore'],windowsHide:true});
      const chunks=[];let size=0,failed=false;
      const fail=(authRequired=false)=>{if(!failed){failed=true;const error=Error(authRequired?'Saved sign-in needs Keychain approval. Use Sign in to reconnect.':'Secure credential storage is unavailable');error.code=authRequired?'SECURE_STORAGE_AUTH_REQUIRED':'SECURE_STORAGE_UNAVAILABLE';reject(error);}};
      const timer=setTimeout(()=>{child.kill();fail();},interactive?120000:15000);timer.unref();
      child.on('error',()=>fail());child.stdin.on('error',()=>fail());
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>5120){child.kill();fail();}else chunks.push(chunk);});
      child.on('close',code=>{clearTimeout(timer);if(code!==0)fail(code===3);else if(!failed)resolve(Buffer.concat(chunks).toString('utf8'));});
      child.stdin.end(value);
    }));
    this.queue=operation.catch(()=>{});return operation;
  }
  async read(options){const value=await this.run('read','',options);if(!value)return null;const data=JSON.parse(value);return typeof data.refreshToken==='string'?data.refreshToken:null;}
  write(refreshToken,options){return this.run('write',JSON.stringify({refreshToken}),options);}
  clear(options){return this.run('clear','',options);}
}
