import http from 'node:http';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const id='101',token='test-token',restart=process.argv.includes('--restart');let ready=false,rotations=0,posts=0,dropGET=false;
const state={native:true,controlProtocol:3,engineProtocol:1,token,owner:null,inviteSource:null,inviteRequest:null,live:false,listeners:0,tunnelPhase:'verifying',publicSiteReady:false,passcodeRequired:false,listenerURL:'https://not-ready.trycloudflare.com/listen#initial'};
const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(req.url==='/api/studio'){if(dropGET){dropGET=false;if(restart)Object.assign(state,{token:'replacement-engine-token',owner:null,inviteSource:null,inviteRequest:null,listenerURL:'https://ready.trycloudflare.com/listen#replacement'});return reply(500,{error:'temporary read failure'});}state.publicSiteReady=ready;return reply(200,state);}
  if(req.url==='/api/control'||req.url==='/api/engine'){
    assert.equal(req.headers.authorization,`Bearer ${state.token}`);let body='';for await(const c of req)body+=c;const m=JSON.parse(body);assert.equal(String(m.source),id);
    if(m.action==='generate'){
      assert(ready,'Controller tried to publish before the tunnel was verified');assert.equal(m.passcode,'studio-review-code');state.passcodeRequired=true;posts++;
      if(state.inviteRequest!==m.requestId){rotations++;state.inviteRequest=m.requestId;state.owner=m.source;state.inviteSource=m.source;state.listenerURL=`https://ready.trycloudflare.com/listen#room-${rotations}`;}
      if(rotations===1&&posts===1){dropGET=true;if(!restart)return reply(500,{error:'lost acknowledgement'});}
    }
    return reply(200,{ok:true});
  }
  reply(404,{});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const timer=setTimeout(()=>ready=true,1800);
try{
 const child=spawn('./build/controller-probe',['/missing-test-runtime',`http://127.0.0.1:${server.address().port}`],{env:{...process.env,SESSIONSTREAM_TEST_PASSCODE:'studio-review-code'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});child.stderr.on('data',b=>process.stderr.write(b));
 const code=await new Promise(r=>child.on('exit',r));assert.equal(code,0);assert.equal(rotations,restart?3:2);assert.equal(posts,restart?3:2,'Only a replacement engine may need this request posted again');assert(output.includes('first Generate completed'));console.log(restart?'PASS: pending first click survives a failed status reread and engine replacement after acknowledgement':'PASS: pending first click survives delayed readiness, a lost POST acknowledgement and failed status reread');
}finally{clearTimeout(timer);await new Promise(r=>server.close(r));}
