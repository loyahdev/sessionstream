import {convertPCM} from '../web/pcm-format.mjs';
import {ListenerDelivery} from '../web/listener-delivery.mjs';
import {CloudAudioDecoder} from '../web/cloud-decoder.mjs';
import dgram from 'node:dgram';
import {randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import {HEADER_BYTES,parsePacket} from './protocol.mjs';
import {validShare} from './link-names.mjs';
import {musicSDP} from '../web/audio.mjs';

const cleanName=value=>{
  const text=typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,48):'';
  return text||'Studio DAW';
};
const validRate=rate=>[44100,48000,88200,96000,176400,192000].includes(rate);

export function receiveURL(value){
  const text=typeof value==='string'?value.trim():'';
  if(validShare(text.toLowerCase()))return new URL(`https://sessionstream.app/${text.toLowerCase()}`);
  let url;try{url=new URL(text);}catch{throw Error('Enter the share code, custom name or full share link.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search)throw Error('Use a SessionStream share link.');
  if(url.hostname==='sessionstream.app'&&validShare(url.pathname.slice(1).replace(/\/$/,''))&&!url.hash){url.pathname=url.pathname.replace(/\/$/,'');return url;}
  if(/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)&&url.pathname==='/listen'&&/^#[a-f0-9]{48}$/.test(url.hash))return url;
  throw Error('Use a SessionStream share link.');
}

export class NativeReceiver {
  constructor({target,passcode='',port,mode='pcm',listenerCredential='',name='',ticketProvider=null,request=fetch,urlOverride,wrtcImpl=null}={}){
    this.url=urlOverride||receiveURL(target);
    this.passcode=passcode;
    this.port=port;
    this.mode=mode==='webrtc'?'webrtc':'pcm';
    this.activeMode=this.mode;
    this.listenerCredential=typeof listenerCredential==='string'&&/^[a-f0-9]{64}$/.test(listenerCredential)?listenerCredential:randomBytes(32).toString('hex');
    this.nameSource=name;
    this.ticketProvider=ticketProvider;
    this.request=request;
    this.wrtcImpl=wrtcImpl;
    this.phase='connecting';
    this.message='Connecting...';
    this.generation=0;
    this.sequence=0;
    this.udp=dgram.createSocket('udp4');
    this.udp.on('error',()=>{});
    this.udp.unref();
    this.packets=0;
    this.lastPacket=0;
    this.rate=0;
    this.hostLive=false;
    this.hostAudio=false;
    this.iceServers=[];
    this.pendingCandidates=[];
    void this.connect();
  }
  resolveName(){return cleanName(typeof this.nameSource==='function'?this.nameSource():this.nameSource);}
  status(){return {phase:this.phase,message:this.message,packets:this.packets,rate:this.rate,transport:this.activeMode,channels:this.channels||2,format:this.sourceFormat};}
  closePeer(){
    clearTimeout(this.webrtcTimer);
    this.delivery?.close();this.delivery=null;
    if(this.sink){try{this.sink.ondata=null;this.sink.stop();}catch{}this.sink=null;}
    if(this.pc){try{this.pc.onicecandidate=null;this.pc.onconnectionstatechange=null;this.pc.ontrack=null;this.pc.close();}catch{}this.pc=null;}
    this.pendingCandidates=[];
  }
  emitFrames(samples,sampleRate,channelCount,numberOfFrames){
    if(!validRate(sampleRate)||numberOfFrames<1||channelCount<1)return;
    this.channels=channelCount;const stereo=channelCount>=2;
    let offset=0;
    while(offset<numberOfFrames){
      const frames=Math.min(240,numberOfFrames-offset);
      const packet=Buffer.allocUnsafe(HEADER_BYTES+frames*8);
      packet.write('STRM',0,'ascii');
      packet.writeUInt32LE((this.sequence++)>>>0,4);
      packet.writeUInt32LE(sampleRate>>>0,8);
      packet.writeUInt16LE(frames,12);
      packet.writeUInt16LE(2,14);
      packet.writeUInt32LE(1,16);
      packet.writeUInt32LE(1,20);
      for(let i=0;i<frames;i++){
        const base=(offset+i)*channelCount;
        const l=(samples[base]||0)/32768;
        const r=(stereo?(samples[base+1]||0):(samples[base]||0))/32768;
        packet.writeFloatLE(l,24+i*8);
        packet.writeFloatLE(r,28+i*8);
      }
      offset+=frames;
      this.packets++;
      this.lastPacket=Date.now();
      this.rate=sampleRate;
      this.phase='receiving';
      this.message='Receiving live audio';
      this.udp.send(packet,this.port,'127.0.0.1',()=>{});
    }
  }
  forwardPCM(raw){if(this.closed||!this.hostLive)return;const packet=parsePacket(raw);if(!packet)return;this.channels=packet.channels;this.packets++;this.lastPacket=Date.now();this.rate=packet.rate;this.phase='receiving';this.message='Receiving audio';this.udp.send(Buffer.from(convertPCM(raw,32)),this.port,'127.0.0.1',()=>{});}
  scheduleWebrtcFallback(ws,current){
    clearTimeout(this.webrtcTimer);
    if(this.activeMode!=='webrtc'||this.cloudMode||this.closed)return;
    this.webrtcTimer=setTimeout(()=>{
      if(!current()||this.activeMode!=='webrtc')return;
      if(this.pc?.connectionState==='connected')return;
      if(!this.hostLive||!this.hostAudio){this.scheduleWebrtcFallback(ws,current);return;}
      this.activeMode='pcm';
      this.closePeer();
      if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'mode',mode:'pcm'}));
    },12000);
    this.webrtcTimer.unref?.();
  }
  async handleOffer(ws,message,current){
    const wrtc=this.wrtcImpl||(await import('@roamhq/wrtc')).default;
    if(!current()||this.activeMode!=='webrtc'&&!this.needsControl||ws.readyState!==WebSocket.OPEN)return;
    this.closePeer();
    const pc=this.pc=new wrtc.RTCPeerConnection({iceServers:this.iceServers});
    pc.generation=message.generation;
    pc.onicecandidate=({candidate})=>{
      if(candidate&&current()&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'candidate',to:message.from||'native',candidate,generation:pc.generation}));
    };
    pc.onconnectionstatechange=()=>{
      if(!current()||this.pc!==pc)return;
      if(pc.connectionState==='connected')clearTimeout(this.webrtcTimer);
      else if(pc.connectionState==='failed'&&this.cloudMode){ws.close();}
      else if(pc.connectionState==='failed'&&this.activeMode==='webrtc'){
        this.activeMode='pcm';this.closePeer();
        if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'mode',mode:'pcm'}));
      }
    };
    if(this.needsControl){this.delivery=new ListenerDelivery({PeerConnection:wrtc.RTCPeerConnection,iceServers:this.iceServers,decode:async()=>{const decoder=new CloudAudioDecoder();await decoder.ready;return decoder;},onFrame:raw=>this.forwardPCM(Buffer.from(raw)),onError:()=>{if(current()&&this.hostLive)ws.close();}});pc.ondatachannel=event=>this.delivery?.attach(event.channel);}
    pc.ontrack=event=>{
      if(!current()||this.pc!==pc||this.activeMode!=='webrtc')return;
      if(this.sink){try{this.sink.ondata=null;this.sink.stop();}catch{}}
      const sink=this.sink=new wrtc.nonstandard.RTCAudioSink(event.track);
      sink.ondata=({samples,sampleRate,channelCount,numberOfFrames})=>{
        if(!current()||this.pc!==pc||!this.hostLive||!validRate(sampleRate))return;
        this.emitFrames(samples,sampleRate,channelCount,numberOfFrames);
      };
    };
    await pc.setRemoteDescription(message.sdp);
    for(const item of this.pendingCandidates)if(item.generation===pc.generation)await pc.addIceCandidate(item.candidate);
    this.pendingCandidates=[];
    const answer=musicSDP(await pc.createAnswer(),this.sourceFormat?.bitrate||510000,this.sourceFormat?.channels||2);
    await pc.setLocalDescription(answer);
    if(current()&&ws.readyState===WebSocket.OPEN){
      ws.send(JSON.stringify({type:'answer',sdp:pc.localDescription,generation:pc.generation}));
      this.scheduleWebrtcFallback(ws,current);
    }
  }
  async connect(){
    const generation=++this.generation;
    const current=()=>!this.closed&&generation===this.generation;
    this.closePeer();
    this.activeMode=this.mode;
    this.phase='connecting';
    this.message='Connecting...';
    try{
      let room=this.url.hash.slice(1);
      if(!/^[a-f0-9]{48}$/.test(room)){
        const response=await this.request(this.url,{redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error(response.status===404||response.status===410?'The host is offline or this link has expired.':'Could not reach the host.');
        const html=await response.text();
        if(html.length>262144)throw Error('Invalid listener page.');
        room=html.match(/data-room="([a-f0-9]{48})"/)?.[1];
        if(!room)throw Error('This link is not an active SessionStream session.');
      }
      if(!current())return;
      const url=new URL(this.url);
      url.hash='';
      url.pathname=this.url.pathname==='/listen'&&/^[a-f0-9]{48}$/.test(this.url.hash.slice(1))?'/signal':`${url.pathname}/signal`;
      url.protocol=url.protocol==='http:'?'ws:':'wss:';
      const ws=this.ws=new WebSocket(url,{origin:this.url.origin,handshakeTimeout:10000,maxPayload:65536,followRedirects:false});
      ws.on('error',()=>{});
      let lastPong=Date.now(),lastPing=0,sentTicket=false,admitted=false;
      ws.on('pong',()=>{lastPong=Date.now();});
      this.heartbeat=setInterval(()=>{
        if(!current())return;
        const now=Date.now();
        if(this.phase==='receiving'&&now-this.lastPacket>1500){this.phase='waiting';this.message='Waiting for host audio';}
        if(ws.readyState===WebSocket.OPEN){
          if(now-lastPong>30000)ws.terminate();
          else if(now-lastPing>10000){lastPing=now;ws.ping();}
        }
      },2000);
      this.heartbeat.unref();
      const sendJoin=listenerTicket=>{
        if(!current()||ws.readyState!==WebSocket.OPEN)return;
        ws.send(JSON.stringify({
          type:'join',role:'listener',dawReceive:true,mode:this.activeMode,room,
          listenerCredential:this.listenerCredential,name:this.resolveName(),
          ...(listenerTicket?{listenerTicket}:{}),
          ...(this.passcode?{passcode:this.passcode}:{})
        }));
      };
      ws.on('open',()=>sendJoin());
      ws.on('message',async(raw,binary)=>{
        if(!current())return;
        if(binary){
          if(!admitted)return;
          if(this.encrypted){void this.delivery?.buffered(raw);}else this.forwardPCM(raw);
          return;
        }
        let message;try{message=JSON.parse(raw.toString());}catch{return;}
        if(message.type==='sign-in-required'){
          if(!sentTicket&&this.ticketProvider){
            sentTicket=true;this.phase='connecting';this.message='Verifying your account...';
            const ticket=await Promise.resolve(this.ticketProvider(room)).catch(()=>null);
            if(!current()||ws.readyState!==WebSocket.OPEN)return;
            if(typeof ticket==='string'&&/^[a-f0-9]{64}$/.test(ticket)){sendJoin(ticket);return;}
          }
          this.noRetry=true;this.phase='error';this.message=message.error||'This host requires a verified signed-in account.';ws.close();return;
        }
        if(message.type==='approval-pending'){this.phase='approval';this.message='Waiting for host approval';return;}
        if(message.type==='access-rejected'||message.type==='access-revoked'){
          this.noRetry=true;this.phase='denied';
          this.message=message.type==='access-revoked'?'The host revoked your access.':'Access declined by the host.';
          ws.close();return;
        }
        if(message.type==='access-full'){this.noRetry=true;this.phase='error';this.message='This session cannot accept more listener requests.';ws.close();return;}
        if(message.type==='name-required'){this.noRetry=true;this.phase='error';this.message='Host requires listener identification.';ws.close();return;}
        if(message.type==='passcode-required'){this.phase='passcode';this.message=message.invalid?'Incorrect passcode':'This session needs a passcode';this.noRetry=true;ws.close();return;}
        if(message.type==='joined'){
          if(message.dawReceive!==true){
            this.noRetry=true;this.phase='error';this.message='Ask the sender to update SessionStream and stream with Pro.';ws.close();return;
          }
          admitted=true;
          this.sourceFormat=message.format;this.cloudMode=message.delivery==='cloud';if(message.format?.codec==='pcm')this.activeMode='pcm';this.encrypted=message.encrypted===true;this.needsControl=this.cloudMode||this.encrypted;
          this.iceServers=Array.isArray(message.iceServers)?message.iceServers:[];
          ws.send(JSON.stringify({type:'mode',mode:this.activeMode}));
          this.phase='waiting';this.message='Waiting for host audio';
          if(this.activeMode==='webrtc')this.scheduleWebrtcFallback(ws,current);
          return;
        }
        if(message.type==='offer'&&(this.activeMode==='webrtc'||this.needsControl)){
          this.handleOffer(ws,message,current).catch(()=>{
            if(!current())return;
            this.activeMode='pcm';this.closePeer();
            if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'mode',mode:'pcm'}));
          });
          return;
        }
        if(message.type==='candidate'&&(this.activeMode==='webrtc'||this.needsControl)){
          if(this.pc?.remoteDescription&&this.pc.generation===message.generation)await this.pc.addIceCandidate(message.candidate).catch(()=>{});
          else if(this.pendingCandidates.length<64)this.pendingCandidates.push({candidate:message.candidate,generation:message.generation});
          return;
        }
        if(message.type==='status'){
          this.hostLive=!!message.live;this.hostAudio=!!message.audio;
          if(!message.live){this.phase='waiting';this.message='Waiting for host audio';}
          return;
        }
        if(message.type==='publisher-left'){
          this.hostLive=false;this.hostAudio=false;this.closePeer();
          this.phase='waiting';this.message='Waiting for host audio';
        }
      });
      ws.on('close',(code,reasonBuf)=>{
        clearInterval(this.heartbeat);this.closePeer();
        if(!current()||this.noRetry)return;
        const reason=reasonBuf?.length?reasonBuf.toString('utf8'):'';
        if(code===4012){this.noRetry=true;this.phase='error';this.message='The host ended this session. Ask for a new invite.';return;}
        if(code===4011){this.noRetry=true;this.phase='error';this.message='This invite has expired. Ask the host for a new link.';return;}
        if(code===4014){this.noRetry=true;this.phase='denied';this.message=reason||'Access declined by the host.';return;}
        if(code===4015){this.noRetry=true;this.phase='error';this.message=reason||'This host requires a signed-in account.';return;}
        if(code===4017){this.noRetry=true;this.phase='error';this.message=reason||'The sender needs SessionStream Pro for DAW-to-DAW.';return;}
        if(code===4016){this.noRetry=true;this.phase='error';this.message='Host approval timed out. Click Retry connection to request again.';return;}
        this.phase='reconnecting';
        this.message=code===4009?'Session is full. Retrying...':'Host disconnected. Reconnecting...';
        this.retry=setTimeout(()=>{void this.connect();},2000);
        this.retry.unref();
      });
    }catch(error){
      if(current()){
        this.phase='error';
        this.message=error.message||'Connection failed. Retrying...';
        this.retry=setTimeout(()=>{void this.connect();},3000);
        this.retry.unref();
      }
    }
  }
  close(){
    const wasWaitingApproval=this.phase==='approval';
    this.closed=true;
    ++this.generation;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.closePeer();
    if(wasWaitingApproval&&this.ws?.readyState===WebSocket.OPEN){
      try{this.ws.send(JSON.stringify({type:'cancel-request'}));this.ws.close(1000,'Request cancelled');}catch{this.ws?.terminate();}
    }else{
      this.ws?.terminate();
    }
    try{this.udp.close();}catch{}
  }
}
