import {CloudFrameEncryptor,CloudFrameDecryptor} from './cloud-crypto.mjs';
// API is participant-scoped by the companion. No backend credential or audio
// key is ever passed to it. This class works with browser and native WebRTC.
function waitFor(target,event,check,{timeout=15000,signal,allowTimeout=false}={}){
 if(check())return Promise.resolve();
 return new Promise((resolve,reject)=>{let timer;const finish=error=>{clearTimeout(timer);target.removeEventListener(event,on);signal?.removeEventListener('abort',aborted);error?reject(error):resolve();};const on=()=>{try{if(check())finish();}catch(error){finish(error);}};const aborted=()=>finish(Error('Cloud connection was cancelled.'));target.addEventListener(event,on);signal?.addEventListener('abort',aborted,{once:true});timer=setTimeout(()=>finish(allowTimeout?undefined:Error('Cloud connection timed out.')),timeout);if(signal?.aborted)aborted();else on();});
}
export class CloudPeer {
 constructor({PeerConnection=globalThis.RTCPeerConnection,api,key,encrypted=true,publisher=false,onFrame=()=>{},onError=()=>{},iceServers=[{urls:'stun:stun.cloudflare.com:3478'}],timeout=15000}){
  this.PeerConnection=PeerConnection;this.api=api;this.publisher=publisher;this.onFrame=onFrame;this.onError=onError;this.iceServers=iceServers;this.timeout=timeout;this.encrypted=encrypted;this.setKey(key);this.pending=0;this.receiving=0;this.closed=false;this.abort=new AbortController();this.drops=0;
 }
 setKey(key){this.cipher=this.encrypted?(this.publisher?new CloudFrameEncryptor(key):new CloudFrameDecryptor(key)):null;}
 async call(action,extra={}){if(this.closed)throw Error('Cloud connection is closed.');const result=await this.api(action,extra);if(result?.ok===false)throw Error(result.error||'Cloud connection failed.');if(this.closed)throw Error('Cloud connection is closed.');return result;}
 async connect(){
  if(this.pc||this.closed)throw Error('Create a new Cloud connection to reconnect.');
  const pc=this.pc=new this.PeerConnection({iceServers:this.iceServers});const options={timeout:this.timeout,signal:this.abort.signal};
  pc.ondatachannel=event=>{if(event.channel.label!=='server-events')event.channel.close();};
  try{
   pc.addEventListener('connectionstatechange',()=>{if(!this.closed&&['failed','closed'].includes(pc.connectionState))this.onError(Error('Cloud transport failed.'));});
   this.stage='offer';const offer=await this.call('connect');await pc.setRemoteDescription(offer.sessionDescription);await pc.setLocalDescription(await pc.createAnswer());
   this.stage='ICE gathering';await waitFor(pc,'icegatheringstatechange',()=>pc.iceGatheringState==='complete',{...options,timeout:Math.min(this.timeout,1800),allowTimeout:true});
   if(!pc.localDescription.sdp.includes('a=candidate:'))throw Error('No network candidate is available for Cloud audio.');
   this.stage='answer';await this.call('answer',{sessionDescription:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
   this.stage='connection';await waitFor(pc,'connectionstatechange',()=>{if(['failed','closed'].includes(pc.connectionState))throw Error('Cloud transport failed.');return pc.connectionState==='connected';},options);
   this.stage='channel allocation';const allocation=await this.call('open');
   if(!Number.isInteger(allocation.channelId)||allocation.channelId<0||allocation.channelId>65534||allocation.ordered!==false||allocation.maxPacketLifeTime!==120)throw Error('Invalid Cloud audio channel.');
   const channel=this.channel=pc.createDataChannel('encrypted-audio',{negotiated:true,id:allocation.channelId,ordered:false,maxPacketLifeTime:120});channel.binaryType='arraybuffer';
   channel.onmessage=event=>this.receive(event.data);channel.onclose=()=>{if(!this.closed)this.onError(Error('Cloud audio was disconnected. Rejoining is required.'));};channel.onerror=()=>{if(!this.closed)this.onError(Error('Cloud audio channel failed.'));};
   this.stage='channel open';await waitFor(channel,'open',()=>channel.readyState==='open',options);
   // Cloudflare consumes this acknowledgment; it is not audio or a key.
   if(!this.publisher)channel.send('ready');
   await this.call('ready');return this;
  }catch(error){const stage=this.stage||'setup',state=pc.iceConnectionState;this.close();throw Error(error.message+' ['+stage+'; ICE '+state+']');}
 }
 async send(raw){
  if(!this.publisher||this.closed)throw Error('Cloud publisher is not connected.');
  if(this.channel?.readyState!=='open'||this.channel.bufferedAmount>65536||this.pending>=4){this.drops++;return false;}
  this.pending++;
  try{const cipher=this.cipher;const encrypted=cipher?await cipher.encrypt(raw):raw;if(cipher!==this.cipher||this.closed||this.channel?.readyState!=='open'||this.channel.bufferedAmount>65536){this.drops++;return false;}this.channel.send(encrypted);return true;}finally{this.pending--;}
 }
 async receive(raw){
  if(this.publisher||this.closed||typeof raw==='string')return;
  if(this.receiving>=16){this.drops++;return;}
  this.receiving++;
  try{const cipher=this.cipher;const frame=cipher?await cipher.decrypt(raw):new Uint8Array(raw);if(!this.closed&&cipher===this.cipher)this.onFrame(frame);}catch{this.drops++;}finally{this.receiving--;}
 }
 close(){if(this.closed)return;this.closed=true;this.abort.abort();if(this.channel){this.channel.onmessage=null;this.channel.onerror=null;this.channel.onclose=null;this.channel.close();}if(this.pc){this.pc.ondatachannel=null;this.pc.close();}}
}
