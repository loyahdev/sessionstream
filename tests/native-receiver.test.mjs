import {test} from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {once} from 'node:events';
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
 let now=Date.now();const app=await createStreamServer({nativeSender:true,managedTunnel:true,publicPort:0,studioPort:0,udpPort:0,now:()=>now});t.after(()=>app.close());
 app.setTunnelState('ready','https://sessionstream.app/studio-test');
 const studio=`http://127.0.0.1:${app.studioPort}`,remote=`http://127.0.0.1:${app.publicPort}/studio-test`;
 const data=await (await fetch(studio+'/api/studio')).json();
 const control=(action,more={})=>fetch(studio+'/api/control',{method:'POST',headers:{Origin:studio,Authorization:`Bearer ${data.token}`,'Content-Type':'application/json'},body:JSON.stringify({source:12345,action,...more})});
 await control('generate',{passcode:'protected',expiresInHours:24});app.setTunnelState('ready','https://sessionstream.app/studio-test');await control('start');
 const sink=dgram.createSocket('udp4');sink.bind(0,'127.0.0.1');await once(sink,'listening');t.after(()=>sink.close());const packets=[];sink.on('message',packet=>packets.push(packet));
 const denied=new NativeReceiver({urlOverride:new URL(remote),port:sink.address().port});t.after(()=>denied.close());await until(()=>denied.phase==='passcode');assert.equal(packets.length,0);
 const receiver=new NativeReceiver({urlOverride:new URL(remote),passcode:'protected',port:sink.address().port});t.after(()=>receiver.close());await until(()=>receiver.phase==='waiting');
 const source=dgram.createSocket('udp4');t.after(()=>source.close());
 for(let i=0;i<20;i++){source.send(tonePacket(i,256,48000,12345),app.udpPort,'127.0.0.1');await sleep(2);}
 await until(()=>packets.length>=10);assert.equal(receiver.phase,'receiving');assert.equal(parsePacket(packets[0]).rate,48000);assert.equal(parsePacket(packets[0]).channels,2);
 assert(packets.some(packet=>Math.abs(packet.readFloatLE(24)-packet.readFloatLE(28))>.01));
 const before=packets.length;await control('stop');await sleep(50);
 for(let i=20;i<25;i++)source.send(tonePacket(i,256,48000,12345),app.udpPort,'127.0.0.1');await sleep(100);assert.equal(packets.length,before);
 now+=24*3600000+1;await (await fetch(studio+'/api/studio')).json();await until(()=>receiver.phase==='error');assert.match(receiver.message,/expired/);assert(receiver.noRetry);
 receiver.close();denied.close();
});

test('local Receive start requires a signed-in account while stop remains available',async t=>{
 let signedIn=false;const account={identity:{sub:'test-user'},status:()=>({phase:signedIn?'signed-in':'signed-out'}),close(){}};
 const app=await createStreamServer({account,nativeSender:true,publicPort:0,studioPort:0,udpPort:0,linkStore:{read:async()=>null,clear:async()=>{},write:async()=>{}}});t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.studioPort}`,data=await (await fetch(base+'/api/studio')).json();
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{Origin:base,Authorization:`Bearer ${data.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 await post('/api/engine',{source:123,action:'attach'});
 const command={source:123,action:'start',port:43210,target:'http://127.0.0.1/not-allowed'};
 assert.equal((await post('/api/receive',command)).status,403);signedIn=true;
 const allowed=await post('/api/receive',command);assert.equal(allowed.status,200);assert.equal((await allowed.json()).ok,false); // origin validation still applies after login
 signedIn=false;assert.equal((await post('/api/receive',{source:123,action:'stop'})).status,200);
});
