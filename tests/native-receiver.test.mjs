import {test} from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {senderPlanFixture} from './fixtures/sender-plan.mjs';
import {NativeReceiver,receiveURL} from '../server/native-receiver.mjs';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket,parsePacket} from '../server/protocol.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await sleep(20);}throw Error('Receiver timeout');}
test('receiver accepts share codes and names while rejecting arbitrary or private origins',()=>{
 assert.equal(receiveURL('123456').href,'https://sessionstream.app/123456');
 assert.equal(receiveURL('My-Studio').href,'https://sessionstream.app/my-studio');
 assert.equal(receiveURL('https://sessionstream.app/my-studio/').pathname,'/my-studio');
 assert.equal(receiveURL(`https://quick-test.trycloudflare.com/listen#${'a'.repeat(48)}`).hash,`#${'a'.repeat(48)}`);
 for(const value of ['http://127.0.0.1:8788','https://example.com/audio','https://sessionstream.app/api/studio','https://sessionstream.app:12345/studio','https://user:pass@sessionstream.app/123456'])assert.throws(()=>receiveURL(value));
});
test('real host session forwards stereo PCM to a receiver and enforces its passcode',async t=>{
 let now=Date.now(),plan='free';const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,now:()=>now,...senderPlanFixture(()=>plan,()=>now)});t.after(()=>app.close());
 app.setTunnelState('ready','https://sessionstream.app/studio-test');
 const studio=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}/studio-test`;
 const data=await (await fetch(studio+'/api/studio')).json();
 const control=(action,more={})=>fetch(studio+'/api/control',{method:'POST',headers:{Origin:studio,Authorization:`Bearer ${data.token}`,'Content-Type':'application/json'},body:JSON.stringify({source:12345,action,...more})});
 assert.equal((await control('generate',{passcode:'protected',expiresInHours:24})).status,200);app.setTunnelState('ready','https://sessionstream.app/studio-test');await control('start');
 const sink=dgram.createSocket('udp4');sink.bind(0,'127.0.0.1');await once(sink,'listening');t.after(()=>sink.close());const packets=[];sink.on('message',packet=>packets.push(packet));
 const denied=new NativeReceiver({urlOverride:new URL(remote),port:sink.address().port});t.after(()=>denied.close());await until(()=>denied.phase==='passcode');assert.equal(packets.length,0);
 const freeSender=new NativeReceiver({urlOverride:new URL(remote),passcode:'protected',port:sink.address().port});
 t.after(()=>freeSender.close());
 await until(()=>freeSender.phase==='error');
 assert.match(freeSender.message,/sender needs SessionStream Pro/);
 const browser=new WebSocket(remote.replace('http','ws')+'/signal',{origin:new URL(remote).origin});
 t.after(()=>browser.terminate());
 const joined=new Promise((resolve,reject)=>{
  browser.once('error',reject);
  browser.on('message',data=>{if(JSON.parse(data).type==='joined')resolve();});
 });
 await once(browser,'open');
 const {room}=await fetch(studio+'/api/studio').then(r=>r.json());
 browser.send(JSON.stringify({type:'join',role:'listener',room,mode:'pcm',passcode:'protected'}));
 await joined;
 browser.close();
 plan='pro';now+=26000;

 const receiver=new NativeReceiver({urlOverride:new URL(remote),passcode:'protected',port:sink.address().port});t.after(()=>receiver.close());await until(()=>receiver.phase==='waiting');
 const source=dgram.createSocket('udp4');t.after(()=>source.close());
 for(let i=0;i<20;i++){source.send(tonePacket(i,256,48000,12345),app.udpPort,'127.0.0.1');await sleep(2);}
 await until(()=>packets.length>=10);assert.equal(receiver.phase,'receiving');assert.equal(parsePacket(packets[0]).rate,48000);assert.equal(parsePacket(packets[0]).channels,2);
 assert(packets.some(packet=>Math.abs(packet.readFloatLE(24)-packet.readFloatLE(28))>.01));
 await control('stop');await sleep(50);const before=packets.length;
 for(let i=20;i<25;i++)source.send(tonePacket(i,256,48000,12345),app.udpPort,'127.0.0.1');await sleep(100);assert.equal(packets.length,before);
 now+=24*3600000+1;await (await fetch(studio+'/api/studio')).json();await until(()=>receiver.phase==='error');assert.match(receiver.message,/expired/);assert(receiver.noRetry);
 receiver.close();denied.close();
});

test('local Receive is available both as a guest and with a free account',async t=>{
 let signedIn=false;const account={identity:{sub:'test-user'},status:()=>({phase:signedIn?'signed-in':'signed-out'}),close(){}};
 const app=await createStreamServer({account,nativeSender:true,publicPort:0,studioPort:0,udpPort:0,linkStore:{read:async()=>null,clear:async()=>{},write:async()=>{}}});t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.studioPort}`,data=await (await fetch(base+'/api/studio')).json();
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{Origin:base,Authorization:`Bearer ${data.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 await post('/api/engine',{source:123,action:'attach'});
 const command={source:123,action:'start',port:43210,target:'http://127.0.0.1/not-allowed'};
 for(const loggedIn of [false,true]){
  signedIn=loggedIn;
  const allowed=await post('/api/receive',command);
  assert.equal(allowed.status,200);
  assert.match((await allowed.json()).error,/share link/);
 }
 signedIn=false;assert.equal((await post('/api/receive',{source:123,action:'stop'})).status,200);
});

test('receiver handles Pro waiting room approval, account tickets, cancellation, and stops retrying on 4014/4015',async t=>{
 const tickets=new Map();
 const hostAccount={identity:{sub:'host'},issuer:'https://clerk.example',clientId:'public',status:()=>({phase:'signed-in',name:'Host Producer'}),accessCredential:()=>'host-token',close(){},renew:async()=>{}};
 const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,account:hostAccount,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},linkOptions:{request:async()=>Response.json({error:'Unavailable'},{status:503})},dashboardOptions:{enabled:true,autoTimer:false,storeFactory:()=>({read:async()=>null,write:async()=>{},clear:async()=>{}}),fetchImpl:async(url,opt)=>{
  if(url.endsWith('/enroll'))return Response.json({deviceCredential:'c'.repeat(64)});
  if(url.endsWith('/listener/verify')){const {ticket,room}=JSON.parse(opt.body);const entry=tickets.get(ticket);tickets.delete(ticket);return entry&&entry.room===room?Response.json({listener:entry.listener}):Response.json({error:'Invalid proof'},{status:403});}
  return Response.json({plan:'pro',listeners:8});
 }}});
 t.after(()=>app.close());
 app.setTunnelState('ready','https://sessionstream.app/pro-room');
 const studio=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}/pro-room`;
 const initial=await (await fetch(studio+'/api/studio')).json();
 const post=(route,body)=>fetch(studio+route,{method:'POST',headers:{Origin:studio,Authorization:`Bearer ${initial.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 await post('/api/control',{source:501,action:'generate',listenerApproval:true,listenerAccounts:true});
 app.setTunnelState('ready','https://sessionstream.app/pro-room');
 await post('/api/control',{source:501,action:'start'});

 const sink=dgram.createSocket('udp4');sink.bind(0,'127.0.0.1');await once(sink,'listening');t.after(()=>sink.close());
 const received=[];sink.on('message',p=>received.push(p));

 // Without a ticketProvider, sign-in-required halts cleanly without reconnect loop
 const unauth=new NativeReceiver({urlOverride:new URL(remote),port:sink.address().port,name:'Unverified DAW'});
 t.after(()=>unauth.close());
 await until(()=>unauth.phase==='error'&&unauth.noRetry===true);
 const genAfterUnauth=unauth.generation;await sleep(80);assert.equal(unauth.generation,genAfterUnauth);

 // Verified receiver enters waiting room, cancels cleanly, then joins & gets accepted, then gets revoked without looping
 const cred='d'.repeat(64);
 const issueTicket=room=>{const ticket=Math.random().toString(16).slice(2).padEnd(64,'a').slice(0,64);tickets.set(ticket,{room,listener:{id:'rx-pro',name:'Collab DAW'}});return ticket;};
 const cancelled=new NativeReceiver({urlOverride:new URL(remote),port:sink.address().port,listenerCredential:cred,name:'Collab DAW',ticketProvider:issueTicket});
 await until(()=>cancelled.phase==='approval');
 assert.equal(cancelled.message,'Waiting for host approval');
 let roster=(await (await fetch(studio+'/api/studio')).json()).listenerAccess.listeners;
 assert.equal(roster.length,1);assert.equal(roster[0].name,'Collab DAW');assert.equal(roster[0].verified,true);
 cancelled.close();
 await until(async()=>(await (await fetch(studio+'/api/studio')).json()).listenerAccess.listeners.length===0);

 const approved=new NativeReceiver({urlOverride:new URL(remote),port:sink.address().port,listenerCredential:cred,name:'Collab DAW',ticketProvider:issueTicket});
 t.after(()=>approved.close());
 await until(()=>approved.phase==='approval');
 roster=(await (await fetch(studio+'/api/studio')).json()).listenerAccess.listeners;
 assert.equal((await post('/api/listeners',{source:501,action:'accept',id:roster[0].id})).status,200);
 await until(()=>approved.phase==='waiting');

 // Verify 480-frame WebRTC stereo emission chunks cleanly into <=256-frame STRM packets
 const samples=new Int16Array(960);
 for(let i=0;i<480;i++){samples[2*i]=8192;samples[2*i+1]=-4096;}
 approved.emitFrames(samples,48000,2,480);
 await until(()=>received.length>=2);
 assert.equal(parsePacket(received[0]).frames,240);
 assert.equal(parsePacket(received[1]).frames,240);

 // Host revokes access -> receiver enters denied phase with noRetry (no 2s reconnect loop)
 assert.equal((await post('/api/listeners',{source:501,action:'revoke',id:roster[0].id})).status,200);
 await until(()=>approved.phase==='denied'&&approved.noRetry===true);
 const genAfterRevoke=approved.generation;await sleep(80);assert.equal(approved.generation,genAfterRevoke);
});
