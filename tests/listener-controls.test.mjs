import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import dgram from 'node:dgram';import {WebSocket} from 'ws';
import {createStreamServer} from '../server/index.mjs';import {tonePacket} from '../server/protocol.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function event(ws,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',on);reject(Error('Missing '+type));},3000);function on(raw,binary){if(!binary){const m=JSON.parse(raw);if(m.type===type){clearTimeout(timer);ws.off('message',on);resolve(m);}}}ws.on('message',on);});}
async function setup(t,plan='pro'){
 const dir=await mkdtemp(path.join(os.tmpdir(),'ss-listener-controls-')),state=new Map();
 const account={identity:{sub:'host'},issuer:'https://clerk.example',clientId:'public',status:()=>({phase:'signed-in'}),accessCredential:()=> 'host-token',close(){},renew:async()=>{}};
 const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,runtimeDir:dir,account,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}},dashboardOptions:{enabled:true,autoTimer:false,storeFactory:sub=>({read:async()=>state.get(sub),write:async v=>state.set(sub,v),clear:async()=>state.delete(sub)}),fetchImpl:async(url,opt)=>Response.json(url.endsWith('/enroll')?{deviceCredential:'c'.repeat(64)}:url.endsWith('/listener/verify')?{listener:{id:'listener-account',name:'Verified listener'}}:{plan,listeners:plan==='pro'?8:3})}});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${app.studioPort}`,pub=`http://127.0.0.1:${app.publicPort}`;const initial=await fetch(base+'/api/studio').then(r=>r.json());
 const post=(route,body,origin=base,auth=initial.token)=>fetch(base+route,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth},body:JSON.stringify(body)});
 const control=action=>post('/api/control',{action,source:101});await control('generate');await control('start');const current=await fetch(base+'/api/studio').then(r=>r.json());
 const manage=body=>post('/api/listeners',{source:101,...body});const roster=async()=>fetch(base+'/api/studio').then(r=>r.json()).then(s=>s.listenerAccess);
 const join=async(extra={})=>{const ws=new WebSocket(`ws://127.0.0.1:${app.publicPort}/signal`,{origin:pub});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});t.after(()=>ws.terminate());return {ws,send:()=>ws.send(JSON.stringify({type:'join',role:'listener',room:current.room,mode:'pcm',listenerCredential:'a'.repeat(64),name:'Guest',...extra}))};};
 return {app,base,pub,post,control,manage,roster,join,current};
}
test('waiting listeners receive no audio; host approval opens audio; revoke blocks reconnect',async t=>{
 const f=await setup(t);assert.equal((await f.manage({action:'settings',approval:true,requireAccount:false})).status,200);
 const {ws,send}=await f.join();let binary=0,joined=0;ws.on('message',(data,b)=>{if(b)binary++;else if(JSON.parse(data).type==='joined')joined++;});let pending=event(ws,'approval-pending');send();await pending;
 const udp=dgram.createSocket('udp4');t.after(()=>udp.close());udp.send(tonePacket(1,256,48000,101),f.app.udpPort,'127.0.0.1');ws.send(JSON.stringify({type:'renegotiate'}));await delay(40);assert.equal(binary,0);assert.equal(joined,0);
 const id=(await f.roster()).listeners[0].id;const accepted=event(ws,'joined');assert.equal((await f.manage({action:'accept',id})).status,200);await accepted;udp.send(tonePacket(2,256,48000,101),f.app.udpPort,'127.0.0.1');await delay(40);assert.equal(binary,1);
 const revoked=event(ws,'access-revoked');await f.manage({action:'revoke',id});await revoked;assert.equal((await f.roster()).approval,true);
 const retry=await f.join();const blocked=event(retry.ws,'access-revoked');retry.send();await blocked;assert.equal((await f.roster()).listeners.length,0);
});
test('reject and signed-in-only settings require verified identity',async t=>{
 const f=await setup(t);await f.manage({action:'settings',approval:true,requireAccount:true});
 const missing=await f.join({identity:{id:'forged'}}),need=event(missing.ws,'sign-in-required');missing.send();await need;assert.equal((await f.roster()).listeners.length,0);
 const verified=await f.join({listenerTicket:'e'.repeat(64)}),pending=event(verified.ws,'approval-pending');verified.send();await pending;const item=(await f.roster()).listeners[0];assert(item.verified);assert.equal(item.name,'Verified listener');const rejected=event(verified.ws,'access-rejected');await f.manage({action:'reject',id:item.id});await rejected;
 const retry=await f.join({listenerTicket:'f'.repeat(64),listenerCredential:'b'.repeat(64)}),blocked=event(retry.ws,'access-rejected');retry.send();await blocked;
});
test('only the owning source and Pro may manage listeners; public requests fail',async t=>{
 const f=await setup(t);assert.equal((await f.manage({action:'settings',source:102,approval:true,requireAccount:false})).status,403);assert.equal((await f.post('/api/listeners',{action:'settings',source:101,approval:true,requireAccount:false},f.base,'wrong')).status,403);assert.equal((await fetch(f.pub+'/api/listeners',{method:'POST',body:'{}'})).status,403);
 const free=await setup(t,'free');assert.equal((await free.manage({action:'settings',approval:true,requireAccount:false})).status,403);assert.equal((await free.manage({action:'settings',approval:false,requireAccount:false})).status,200);
});
test('one identity replaces its previous connection so revocation leaves no hidden audio connection',async t=>{
 const f=await setup(t);const first=await f.join(),firstReady=event(first.ws,'joined');first.send();await firstReady;
 const closed=new Promise(r=>first.ws.once('close',r));const second=await f.join(),ready=event(second.ws,'joined');second.send();await ready;assert.equal(await closed,4009);const records=(await f.roster()).listeners;assert.equal(records.length,1);assert(records[0].online);const removed=event(second.ws,'access-revoked');await f.manage({action:'revoke',id:records[0].id});await removed;
});

test('a restored project applies access preferences on generation without a separate settings call',async t=>{
 const f=await setup(t);
 await f.control('end');
 const response=await f.post('/api/control',{action:'generate',source:102,listenerApproval:true,listenerAccounts:true,linkType:'random'});
 assert.equal(response.status,200);
 const current=await fetch(f.base+'/api/studio').then(r=>r.json());
 const invite=await fetch(f.pub+'/api/invite',{method:'POST',body:JSON.stringify({room:current.room})}).then(r=>r.json());
 assert.equal(invite.approvalRequired,true);
 assert.equal(invite.accountRequired,true);
 const free=await setup(t,'free');
 const denied=await free.post('/api/control',{action:'generate',source:101,listenerApproval:true,listenerAccounts:false});
 assert.equal(denied.status,403);
 const unchanged=await fetch(free.base+'/api/studio').then(r=>r.json());
 assert.equal(unchanged.room,free.current.room);
});

test('feedback requires host opt-in and Pro, acknowledges accepted notes and is disabled while stopped',async t=>{const f=await setup(t);const guest=await f.join(),ready=event(guest.ws,'joined');guest.send();await ready;let response=event(guest.ws,'note-error');guest.ws.send(JSON.stringify({type:'listener-note',text:'Not enabled'}));await response;assert.equal((await f.manage({action:'settings',approval:false,requireAccount:false,feedback:true})).status,200);response=event(guest.ws,'note-ack');guest.ws.send(JSON.stringify({type:'listener-note',text:'I like this'}));assert.equal((await response).text,'I like this');assert.equal((await f.roster()).notes.at(-1).text,'I like this');await f.control('stop');response=event(guest.ws,'note-error');guest.ws.send(JSON.stringify({type:'listener-note',text:'Stopped'}));await response;const free=await setup(t,'free');assert.equal((await free.manage({action:'settings',approval:false,requireAccount:false,feedback:true})).status,403);assert.equal((await free.post('/api/control',{action:'generate',source:101,listenerApproval:false,listenerAccounts:false,listenerFeedback:true})).status,403);});
