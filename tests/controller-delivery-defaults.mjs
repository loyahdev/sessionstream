import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch=await mkdtemp(path.join(tmpdir(),'sessionstream-delivery-test-'));
try{for(const scenario of ['new-pro','saved-direct','restored-direct','saved-cloud-free','exhausted-pro','saved-custom','custom-random-choice']){
 const free=scenario==='saved-cloud-free',expectedCloud=!free&&!['saved-direct','restored-direct'].includes(scenario),commands=[],failures=[];
 const state={native:true,controlProtocol:10,engineProtocol:1,token:'fixture-only',owner:null,inviteSource:null,live:false,publicSiteReady:true,quality:'balanced',format:{codec:'opus',channels:2,bitrate:320000},listenerURL:'https://fixture.invalid/preview',account:{phase:'signed-in'},accountConnection:{planKnown:true,plan:free?'free':'pro',listeners:free?3:8,cloud:{canCloud:!free&&scenario!=='exhausted-pro',usage:{remainingSeconds:scenario==='exhausted-pro'?0:1080000}}}};
 if(scenario==='saved-custom'||scenario==='custom-random-choice')state.links={name:'dashboard-studio',mode:'custom',authorized:true,busy:false};
 const server=http.createServer(async(req,res)=>{const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};try{
  if(req.url==='/api/studio')return reply(200,state);
  assert.equal(req.headers.authorization,'Bearer fixture-only');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if(req.url==='/api/engine')return reply(200,{ok:true});
  if(req.url!=='/api/control')return reply(404,{});commands.push(body);
  if(body.action==='generate'){assert.equal(body.delivery,expectedCloud?'cloud':'direct');assert.equal(body.quality,'balanced');assert.equal(body.channels,2);assert.equal(body.encrypted,true);assert.equal(body.linkType,scenario==='saved-custom'?'custom':'random');Object.assign(state,{inviteSource:101,inviteRequest:body.requestId,delivery:body.delivery,encrypted:true});}
  reply(200,{ok:true});
 }catch(error){failures.push(error);reply(500,{error:error.message});}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const child=spawn('./build/controller-delivery-defaults',[`http://127.0.0.1:${server.address().port}`,scenario,path.join(scratch,scenario+'.json')],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0,scenario+'\n'+output);assert.deepEqual(failures,[]);assert.equal(commands.some(c=>c.action==='generate'),scenario!=='exhausted-pro');process.stdout.write(output);}finally{await new Promise(resolve=>server.close(resolve));}
}}finally{await rm(scratch,{recursive:true,force:true});}
