import wrtc from '@roamhq/wrtc';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {musicSDP} from '../web/audio.mjs';
import {AudioBuffer} from './audio-buffer.mjs';
export class NativeSender {
  constructor(send,ice){this.send=send;this.ice=ice;this.peers=new Map();this.pending=new Map();this.buffer=new AudioBuffer();this.source=new wrtc.nonstandard.RTCAudioSource();this.track=this.source.createTrack();this.stream=new wrtc.MediaStream([this.track]);this.live=false;this.chain=Promise.resolve();this.error=null;this.next=performance.now()+10;this.tick();}
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
  handle(m){this.chain=this.chain.then(()=>this.signal(m)).catch(e=>{this.error=e.message;console.error('Native signaling:',e.message);});}
  dispose(id){const pc=this.peers.get(id);if(pc){pc.onconnectionstatechange=null;pc.onicecandidate=null;pc.close();this.peers.delete(id);}this.pending.delete(id);}
  async offer(id,force=false){
    if(!this.live)return;
    if(this.peers.has(id)&&!force)return;this.dispose(id);
    const pc=new wrtc.RTCPeerConnection({iceServers:this.ice()});pc.generation=randomUUID();this.peers.set(id,pc);
    pc.onicecandidate=({candidate})=>{if(candidate)this.send(id,{type:'candidate',from:'native',candidate,generation:pc.generation});};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')this.dispose(id);};
    pc.addTrack(this.track,this.stream);
    await pc.setLocalDescription(musicSDP(await pc.createOffer(),320000));
    this.send(id,{type:'offer',from:'native',sdp:pc.localDescription,generation:pc.generation});
  }
  async signal(m){
    const id=m.id||m.from;
    if(m.type==='peer-left'||m.type==='peer-mode'&&m.mode==='pcm'){this.dispose(id);return;}
    if(m.type==='peer-joined'||m.type==='renegotiate'||m.type==='peer-mode'&&m.mode==='webrtc'){await this.offer(id,m.type!=='peer-joined');return;}
    const pc=this.peers.get(id);if(!pc||pc.generation!==m.generation)return;
    if(m.type==='answer'&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription(m.sdp);for(const c of this.pending.get(id)||[])await pc.addIceCandidate(c);this.pending.delete(id);}
    if(m.type==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(m.candidate);else{const q=this.pending.get(id)||[];if(q.length<64)q.push(m.candidate);this.pending.set(id,q);}}
  }
  start(ids){this.live=true;this.buffer.reset();this.buffer.underruns=0;this.buffer.trims=0;for(const id of ids)this.handle({type:'peer-joined',id});}
  stop(){this.live=false;this.buffer.reset();for(const id of this.peers.keys())this.dispose(id);}
  feed(data,p){if(this.live)this.buffer.push(data,p);}
  close(){this.closed=true;clearTimeout(this.timer);this.stop();this.stream.removeTrack(this.track);this.track.stop();this.stream=null;this.track=null;this.source=null;global.gc?.();}
}
