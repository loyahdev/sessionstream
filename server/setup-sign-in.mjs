import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Account,accountConfig} from './account.mjs';
import {CredentialStore} from './credential-store.mjs';
import {pluginSignInURL,accountResultPage} from './account-pages.mjs';

// The installer uses the same PKCE flow and OS credential item as the plug-in.
// No browser cookies or tokens are copied into installer files or process arguments.
export async function setupSignIn({account,openBrowser,timeout=300000}={}){
 const config=accountConfig();account ||= new Account({...config,autoRestore:false,store:new CredentialStore(config.issuer,config.clientId)});
 let finish,timer,busy=false;const done=new Promise(resolve=>{finish=resolve});
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'||url.pathname!=='/auth/callback'){res.writeHead(404);res.end();return;}
  if(busy||!account.pending||url.searchParams.get('state')!==account.pending.state){res.writeHead(400);res.end('Invalid sign-in request.');return;}
  busy=true;const ok=await account.callback(url.searchParams);
  const saved=ok&&account.status().phase==='signed-in'&&!account.status().message;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(accountResultPage(saved));finish(saved);
 });
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const result=account.begin(`http://127.0.0.1:${server.address().port}/auth/callback`);if(!result.url)return false;
  timer=setTimeout(()=>finish(false),timeout);
  await (openBrowser||((url)=>new Promise((resolve,reject)=>execFile(process.platform==='darwin'?'/usr/bin/open':'rundll32.exe',process.platform==='darwin'?[url]:['url.dll,FileProtocolHandler',url],{windowsHide:true},error=>error?reject(error):resolve()))))(pluginSignInURL(result.url));
  return await done;
 }finally{clearTimeout(timer);server.close();server.closeAllConnections();account.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let ok=false;try{ok=await setupSignIn()}catch{}
 const resultIndex=process.argv.indexOf('--result');if(resultIndex>=0&&process.argv[resultIndex+1])await writeFile(process.argv[resultIndex+1],ok?'signed-in':'failed',{mode:0o600});
 process.exitCode=ok?0:1;
}
