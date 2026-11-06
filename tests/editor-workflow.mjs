// Isolated native UI workflow. No real account, clipboard, public tunnel or DAW.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStreamServer} from '../server/index.mjs';
import {validName} from '../server/link-names.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'sessionstream-editor-workflow-'));
let signedIn=true,name='preview-studio',saved=null,exchanges=0,browserStarts=0,app,timer,child;
const account={identity:{sub:'qa-user'},ready:Promise.resolve(),accessCredential:()=>signedIn?'qa-existing-login':null,status:()=>({configured:true,phase:signedIn?'signed-in':'signed-out',name:signedIn?'Preview':''}),signOut:async()=>{signedIn=false;account.identity=null;return {ok:true};},close(){}};
const request=async(url,options)=>{
 const route=new URL(url).pathname;
 if(route.endsWith('/exchange')){exchanges++;return Response.json({token:'e'.repeat(64),user:'qa-user'});}
 if(route.endsWith('/start')){browserStarts++;throw Error('Unexpected second sign-in');}
 if(route==='/v1/links'){
  if(options.method==='PUT'){const value=JSON.parse(options.body).name;if(!validName(value))return Response.json({error:'Choose a valid name.'},{status:400});if(value==='taken-studio')return Response.json({error:'That name is already in use.'},{status:409});name=value;}
  if(options.method==='DELETE')name='';return Response.json({name});
 }
 return Response.json({ok:true});
};
try{
 await writeFile(path.join(directory,'link-preferences.json'),JSON.stringify({mode:'custom'}));
 const advertise=()=>app.setTunnelState('ready','https://ui-preview.invalid/'+(app.customLinkSelection?.name||'123456'));
 app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,account,runtimeDir:directory,linkStore:{read:async()=>saved,write:async v=>{saved=v;},clear:async()=>{saved=null;}},linkOptions:{request},onInviteRequested:advertise});advertise();timer=setInterval(advertise,500);
 child=spawn('./build/invite-editor',[],{env:{...process.env,SESSIONSTREAM_EDITOR_WORKFLOW:'1',SESSIONSTREAM_EDITOR_ENDPOINT:`http://127.0.0.1:${app.studioPort}`},stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.stderr.on('data',b=>{output+=b;process.stderr.write(b);});
 const timeout=setTimeout(()=>child.kill('SIGTERM'),70000);const code=await new Promise(r=>child.once('exit',r));clearTimeout(timeout);
 await writeFile('/private/tmp/sessionstream-native-workflow.log',output);assert.equal(code,0);assert(output.includes('PASS: native editor'));assert.equal(exchanges,1);assert.equal(browserStarts,0);const final=await (await fetch(`http://127.0.0.1:${app.studioPort}/api/studio`)).json();assert.equal(final.quality,'balanced');assert.equal(final.expiresInHours,0);console.log('PASS: one scoped credential exchange, zero extra browser sign-ins; native workflow complete.');
}finally{clearInterval(timer);if(child?.exitCode===null)child.kill('SIGTERM');await app?.close();await rm(directory,{recursive:true,force:true});}
