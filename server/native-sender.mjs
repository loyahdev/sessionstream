import wrtc from '@roamhq/wrtc';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {musicSDP} from '../web/audio.mjs';
import {AudioBuffer} from './audio-buffer.mjs';
import {qualities} from './session-policy.mjs';
export class NativeSender {
  constructor(send,ice){this.send=send;this.ice=ice;this.peers=new Map();this.events=[];this.pending=new Map();this.buffer=new AudioBuffer();this.source=new wrtc.nonstandard.RTCAudioSource();this.track=this.source.createTrack();this.stream=new wrtc.MediaStream([this.track]);this.bitrate=qualities.balanced;this.live=false;this.chain=Promise.resolve();this.error=null;this.next=performance.now()+10;this.tick();}
  setQuality(value){if(this.live)throw Error('Stop streaming before changing quality.');this.bitrate=qualities[value]||qualities.balanced;}
  record(id,event,details={}){
    const entry={at:new Date().toISOString(),peer:id,event,...details};
    this.events.push(entry);if(this.events.length>64)this.events.shift();
    console.info('audio-connection',JSON.stringify(entry));
  }
  diagnostics(){return {relayConfigured:this.ice().some(s=>[s.urls].flat().some(url=>/^turns?:/.test(url))),events:[...this.events]};}
  tick(){
    this.timer=setTimeout(()=>{
      if(this.closed)return;
      const now=performance.now();
      // No stale catch-up burst after an event-loop stall.
      if(now-this.next>100){this.buffer.reset();this.next=now;}
      this.source.onData(this.live?this.buffer.render():{samples:new Int16Array(960),sampleRate:48000,channelCount:2,numberOfFrames:480});
      this.next+=10;this.tick();
    },Math.max(1,this.next-performance.now()));
  }
  handle(m){this.chain=this.chain.then(()=>this.signal(m)).catch(e=>{this.error=e.message;this.record(m.id||m.from,'signaling-error');console.error('Native signaling:',e.message);});}
  dispose(id){const pc=this.peers.get(id);if(pc){this.record(id,'closed');pc.onconnectionstatechange=null;pc.oniceconnectionstatechange=null;pc.onicecandidateerror=null;pc.onicecandidate=null;pc.close();this.peers.delete(id);}this.pending.delete(id);}
  async offer(id,force=false){
    if(!this.live)return;
    if(this.peers.has(id)&&!force)return;this.dispose(id);
    const pc=new wrtc.RTCPeerConnection({iceServers:this.ice()});pc.generation=randomUUID();this.peers.set(id,pc);this.record(id,'offer-start',{relayConfigured:this.diagnostics().relayConfigured});
    pc.onicecandidate=({candidate})=>{if(candidate){const kind=candidate.candidate.match(/ typ (host|srflx|prflx|relay)(?: |$)/)?.[1];if(kind&&!pc.loggedCandidates?.has(kind)){(pc.loggedCandidates??=new Set()).add(kind);this.record(id,'local-candidate',{kind});}this.send(id,{type:'candidate',from:'native',candidate,generation:pc.generation});}};
    pc.onconnectionstatechange=()=>{this.record(id,'connection',{state:pc.connectionState});if(pc.connectionState==='failed')this.dispose(id);};
    pc.oniceconnectionstatechange=()=>this.record(id,'ice',{state:pc.iceConnectionState});
    pc.onicecandidateerror=e=>this.record(id,'candidate-error',{code:e.errorCode});
    pc.addTrack(this.track,this.stream);
    await pc.setLocalDescription(musicSDP(await pc.createOffer(),this.bitrate));
    this.send(id,{type:'offer',from:'native',sdp:pc.localDescription,generation:pc.generation});
  }
  async signal(m){
    const id=m.id||m.from;
    if(m.type==='peer-left'||m.type==='peer-mode'&&m.mode==='pcm'){this.record(id,m.type==='peer-left'?'listener-left':'buffered-selected');this.dispose(id);return;}
    if(m.type==='peer-joined'||m.type==='renegotiate'||m.type==='peer-mode'&&m.mode==='webrtc'){await this.offer(id,m.type!=='peer-joined');return;}
    const pc=this.peers.get(id);if(!pc||pc.generation!==m.generation)return;
    if(m.type==='answer'&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription(musicSDP(m.sdp,this.bitrate));this.record(id,'answer-received');for(const c of this.pending.get(id)||[])await pc.addIceCandidate(c);this.pending.delete(id);}
    if(m.type==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(m.candidate);else{const q=this.pending.get(id)||[];if(q.length<64)q.push(m.candidate);this.pending.set(id,q);}}
  }
  start(ids){this.live=true;this.buffer.reset();this.buffer.underruns=0;this.buffer.trims=0;for(const id of ids)this.handle({type:'peer-joined',id});}
  pause(){this.live=false;this.buffer.reset();}
  stop(){this.live=false;this.buffer.reset();for(const id of this.peers.keys())this.dispose(id);}
  feed(data,p){if(this.live)this.buffer.push(data,p);}
  close(){this.closed=true;clearTimeout(this.timer);this.stop();this.stream.removeTrack(this.track);this.track.stop();this.stream=null;this.track=null;this.source=null;global.gc?.();}
}
