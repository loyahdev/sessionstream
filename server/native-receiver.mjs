import dgram from 'node:dgram';
import {WebSocket} from 'ws';
import {parsePacket} from './protocol.mjs';
import {validShare} from './link-names.mjs';
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
  constructor({target,passcode='',port,request=fetch,urlOverride}={}){
    this.url=urlOverride||receiveURL(target);this.passcode=passcode;this.port=port;this.request=request;this.phase='connecting';this.message='Connecting...';this.generation=0;this.udp=dgram.createSocket('udp4');this.udp.on('error',()=>{});this.udp.unref();this.packets=0;this.lastPacket=0;this.rate=0;void this.connect();
  }
  status(){return {phase:this.phase,message:this.message,packets:this.packets,rate:this.rate};}
  async connect(){const generation=++this.generation;const current=()=>!this.closed&&generation===this.generation;this.phase='connecting';this.message='Connecting...';
    try{
      let room=this.url.hash.slice(1);
      if(!/^[a-f0-9]{48}$/.test(room)){
        const response=await this.request(this.url,{redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error(response.status===404?'The host is offline or this link has expired.':'Could not reach the host.');
        const html=await response.text();if(html.length>262144)throw Error('Invalid listener page.');room=html.match(/data-room="([a-f0-9]{48})"/)?.[1];
        if(!room)throw Error('This link is not an active SessionStream session.');
      }
      if(!current())return;
      const url=new URL(this.url);url.hash='';url.pathname=this.url.hostname.endsWith('.trycloudflare.com')?'/signal':`${url.pathname}/signal`;url.protocol=url.protocol==='http:'?'ws:':'wss:';
      const ws=this.ws=new WebSocket(url,{origin:this.url.origin,handshakeTimeout:10000,maxPayload:65536,followRedirects:false});
      ws.on('error',()=>{});
      let lastPong=Date.now(),lastPing=0;ws.on('pong',()=>{lastPong=Date.now();});
      this.heartbeat=setInterval(()=>{if(!current())return;const now=Date.now();if(this.phase==='receiving'&&now-this.lastPacket>1500){this.phase='waiting';this.message='Waiting for host audio';}if(ws.readyState===WebSocket.OPEN){if(now-lastPong>30000)ws.terminate();else if(now-lastPing>10000){lastPing=now;ws.ping();}}},2000);this.heartbeat.unref();
      ws.on('open',()=>{if(current())ws.send(JSON.stringify({type:'join',role:'listener',mode:'pcm',room,...(this.passcode?{passcode:this.passcode}:{})}));});
      ws.on('message',(raw,binary)=>{
        if(!current())return;
        if(binary){const packet=parsePacket(raw);if(!packet)return;this.packets++;this.lastPacket=Date.now();this.rate=packet.rate;this.phase='receiving';this.message='Receiving audio';this.udp.send(raw,this.port,'127.0.0.1',()=>{});return;}
        let message;try{message=JSON.parse(raw.toString());}catch{return;}
        if(message.type==='joined'){ws.send(JSON.stringify({type:'mode',mode:'pcm'}));this.phase='waiting';this.message='Waiting for host audio';}
        if(message.type==='passcode-required'){this.phase='passcode';this.message=message.invalid?'Incorrect passcode':'This session needs a passcode';this.noRetry=true;ws.close();}
        if(message.type==='publisher-left'||message.type==='status'&&!message.live){this.phase='waiting';this.message='Waiting for host audio';}
      });
      ws.on('close',(code)=>{clearInterval(this.heartbeat);if(!current()||this.noRetry)return;if(code===4012){this.noRetry=true;this.phase='error';this.message='The host ended this session. Ask for a new invite.';return;}if(code===4011){this.noRetry=true;this.phase='error';this.message='This invite has expired. Ask the host for a new link.';return;}this.phase='reconnecting';this.message=code===4009?'Session is full. Retrying...':'Host disconnected. Reconnecting...';this.retry=setTimeout(()=>{void this.connect();},2000);this.retry.unref();});
    }catch(error){if(current()){this.phase='error';this.message=error.message||'Connection failed. Retrying...';this.retry=setTimeout(()=>{void this.connect();},3000);this.retry.unref();}}
  }
  close(){this.closed=true;++this.generation;clearTimeout(this.retry);clearInterval(this.heartbeat);this.ws?.terminate();try{this.udp.close();}catch{}}
}
