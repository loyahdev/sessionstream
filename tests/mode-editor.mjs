// Local preview fixture: mock identity, no Clerk credentials or production claims.
import {spawn} from 'node:child_process';
import {mkdtemp,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStreamServer} from '../server/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=await mkdtemp(path.join(tmpdir(),'sessionstream-modes-'));
await writeFile(path.join(directory,'links.json'),JSON.stringify({mode:'custom'}));
let signedIn=true;
const account={identity:{sub:'preview-user'},status:()=>({configured:true,phase:signedIn?'signed-in':'signed-out',name:signedIn?'Jaxon':''}),close(){}};
const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},linkOptions:{preferences:path.join(directory,'links.json')}});
app.setTunnelState('ready','https://ui-preview.invalid');
try{
 for(const mode of ['send','receive','guest']){const receive=mode==='receive';signedIn=mode!=='guest';
  const snapshot=path.join(tmpdir(),mode==='guest'?'sessionstream-guest.png':receive?'sessionstream-receive.png':'sessionstream-send-custom.png');await rm(snapshot,{force:true});
  const child=spawn(root+'/build/invite-editor',[],{env:{...process.env,SESSIONSTREAM_EDITOR_ENDPOINT:`http://127.0.0.1:${app.studioPort}`,SESSIONSTREAM_EDITOR_SNAPSHOT:snapshot,SESSIONSTREAM_EDITOR_RECEIVE_PREVIEW:receive?'1':'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});
  try{for(let i=0;i<100;i++){if(output.includes('SNAPSHOT_SAVED'))break;await new Promise(r=>setTimeout(r,100));}if(!output.includes('SNAPSHOT_SAVED'))throw Error('Native preview did not finish rendering '+mode);await stat(snapshot);console.log('Saved '+snapshot);}
  finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
 }
}finally{await app.close();await rm(directory,{recursive:true,force:true});}
