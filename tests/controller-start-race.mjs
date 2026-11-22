import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const errors=[],actions=[];
const state={native:true,controlProtocol:10,quality:'balanced',format:{codec:'opus',channels:2,bitrate:320000},engineProtocol:1,token:'test-engine',owner:null,inviteSource:null,inviteRequest:null,live:false,listeners:0,passcodeRequired:false,publicSiteReady:true,tunnelPhase:'ready',listenerURL:'https://race-test.invalid/listen#initial'};
const server=http.createServer(async(req,res)=>{
  const reply=data=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.url==='/api/studio')return reply(state);
  let bytes='';for await(const chunk of req)bytes+=chunk;const body=JSON.parse(bytes);
  if(req.url==='/api/control'){
    if(body.action==='generate'){
      actions.push('generate');assert.equal(body.passcode,'protected-race-code');
      Object.assign(state,{owner:101,inviteSource:101,inviteRequest:body.requestId,passcodeRequired:true,listenerURL:'https://race-test.invalid/listen#protected'});
    }
    if(body.action==='start'){
      actions.push('start');if(!state.passcodeRequired)errors.push('Audio started before passcode protection was applied');
      state.owner=101;state.live=true;
    }
  }
  reply({ok:true});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn('./build/controller-protected-recovery',[`http://127.0.0.1:${server.address().port}`,'--queued-start'],{stdio:'inherit'});
const timeout=setTimeout(()=>child.kill('SIGTERM'),18000);
try{
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0);assert.deepEqual(errors,[]);assert.deepEqual(actions,['generate','start']);
}finally{clearTimeout(timeout);await new Promise(resolve=>server.close(resolve));}
