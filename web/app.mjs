import {createAudio,musicSDP} from './audio.mjs';
const $=id=>document.getElementById(id),studio=document.documentElement.dataset.mode==='studio';
let audio=null,ws=null,running=false,reconnectTimer=null,reconnectAttempt=0,session=null,iceServers=[],peerId=null;
let pcm=false,live=false,lastBinary=0,statsTimer=null,fallbackTimer=null,pingTimer=null,rtcSource=null,remoteElement=null,needsResume=false;
let muted=false;
let passcode='',awaitingPasscode=false,joined=false,sourceAvailable=false,healthState='ok',healthSentAt=0;
let receptionGraceUntil=0,lastProgress=0,receivedPackets=null;
const peers=new Map(),pendingCandidates=new Map(),makingOffer=new Set();
const room=location.hash.slice(1);
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function status(text,kind=''){ $('status-label').textContent=text.toUpperCase();$('status-dot').className=`dot ${kind}`;if(!studio)$('heading').textContent=kind==='live'?'Listening':'Listen in'; }
function send(m){if(!studio&&!joined&&m.type!=='join')return;if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));}
function joinListener(){send({type:'join',role:'listener',room,...(passcode?{passcode}:{})});}
function passcodePrompt(invalid=false){
  awaitingPasscode=true;$('passcode-form').hidden=false;$('connect').hidden=true;
  $('passcode-error').textContent=invalid?'Incorrect passcode. Please try again.':'';
  if(invalid){passcode='';$('passcode').value='';$('passcode').setAttribute('aria-invalid','true');}
  else $('passcode').removeAttribute('aria-invalid');
  status('Passcode required');message('Enter the passcode your host shared with you.');$('passcode').focus();
}
function resetReception(){receptionGraceUntil=performance.now()+6000;lastProgress=0;receivedPackets=null;lastReceived=null;lastBinary=0;}
const healthMessages={
  'audio-blocked':'Your browser paused audio. Tap Resume audio.',
  'connection-failed':'The audio connection failed. Trying to reconnect…',
  'audio-stalled':'Audio has stopped reaching this device. Try compatibility audio or check your connection.'
};
function reportHealth(next,showMessage=true){
  if(studio)return;
  const changed=healthState!==next;healthState=next;
  if(joined&&(changed||next!=='ok'&&performance.now()-healthSentAt>=3000)){
    send({type:'listener-health',state:next});healthSentAt=performance.now();
  }
  if(!showMessage)return;
  if(next!=='ok')message(healthMessages[next],true);
  else if(changed&&!awaitingPasscode){message(live?'':'Audio will start when your host is ready.');status(live?'Listening':'Waiting for host',live?'live':'');}
}
function disposePeer(id){const p=peers.get(id);if(p){p.onconnectionstatechange=null;p.close();peers.delete(id);}pendingCandidates.delete(id);}
function closePeers(){for(const id of peers.keys())disposePeer(id);rtcSource?.disconnect();rtcSource=null;if(remoteElement){remoteElement.pause();remoteElement.srcObject=null;remoteElement.remove();remoteElement=null;}needsResume=false;}
function setMode(value){
  pcm=value;resetReception();clearTimeout(fallbackTimer);closePeers();audio?.reset();audio?.usePCM(pcm);send({type:'mode',mode:pcm?'pcm':'webrtc'});
  $('fallback').textContent=pcm?'Try low-delay audio':'Use compatibility audio';
  $('transport').textContent=pcm?'PCM / tunnel':'Connecting…';
  $('quality').textContent=pcm?'PCM · STEREO':'OPUS · STEREO';
  $('fourth-label').textContent=pcm?'BUFFER RESETS':'PACKET LOSS';$('fourth-value').textContent='—';
  if(pcm)message('Compatibility audio uses more bandwidth. Playback will resume with fresh audio.');
  else{send({type:'renegotiate'});scheduleFallback();}
}
function scheduleFallback(){clearTimeout(fallbackTimer);if(!studio&&!pcm&&running)fallbackTimer=setTimeout(()=>{
  if(![...peers.values()].some(p=>p.connectionState==='connected'))setMode(true);
},12000);}
function connection(id,generation=crypto.randomUUID()){
  if(!studio)resetReception();
  const candidates=pendingCandidates.get(id);disposePeer(id);if(candidates)pendingCandidates.set(id,candidates);const pc=new RTCPeerConnection({iceServers});pc.generation=generation;peers.set(id,pc);
  pc.onicecandidate=({candidate})=>{if(candidate)send({type:'candidate',to:id,candidate,generation:pc.generation});};
  pc.onconnectionstatechange=()=>{
    if(new URLSearchParams(location.search).has('audio-test'))console.debug('peer',id,pc.connectionState,pc.iceConnectionState,pc.signalingState);
    if(pc.connectionState==='connected'){
      if(!studio){clearTimeout(fallbackTimer);status(live?'Listening':'Waiting for host',live?'live':'');if(healthState==='ok')message('');}
    }else if(pc.connectionState==='failed'){
      if(studio)offer(id,true).catch(e=>message(e.message,true));else if(!pcm){if(live&&sourceAvailable)reportHealth('connection-failed');setMode(true);}
    }else if(pc.connectionState==='disconnected'&&!studio){status('Recovering connection');scheduleFallback();}
  };
  if(!studio){
    pc.ontrack=e=>{
      if(new URLSearchParams(location.search).has('audio-test'))console.debug('track',e.track.kind,e.track.readyState,e.track.muted,e.track.enabled);
      if(pcm||!running||!audio||peers.get(id)!==pc)return;
      rtcSource?.disconnect();if(remoteElement){remoteElement.pause();remoteElement.srcObject=null;remoteElement.remove();}
      // This element keeps remote decoding active. Web Audio is the sole output:
      // volume=0 alone does not silence media elements on every browser/device.
      remoteElement=new Audio();remoteElement.autoplay=true;remoteElement.muted=true;remoteElement.defaultMuted=true;remoteElement.volume=0;remoteElement.setAttribute('muted','');remoteElement.setAttribute('playsinline','');remoteElement.srcObject=e.streams[0]||new MediaStream([e.track]);
      remoteElement.hidden=true;document.body.append(remoteElement);
      rtcSource=audio.context.createMediaStreamSource(remoteElement.srcObject);rtcSource.connect(audio.analyser);
      remoteElement.play().catch(()=>{needsResume=true;if(live&&sourceAvailable)reportHealth('audio-blocked');message('Tap Resume audio to start listening.');$('connect').innerHTML='Resume audio <span>↗</span>';});
      try{if('jitterBufferTarget' in e.receiver)e.receiver.jitterBufferTarget=40;}catch{}
    };
  }
  return pc;
}
async function flushCandidates(id,pc){for(const c of pendingCandidates.get(id)||[])if(c.generation===pc.generation)await pc.addIceCandidate(c.candidate);pendingCandidates.delete(id);}
async function offer(id,force=false){
  if(!studio||!running||!live||makingOffer.has(id))return;
  const existing=peers.get(id);if(existing&&!force&&existing.connectionState!=='failed'&&existing.connectionState!=='closed')return;
  makingOffer.add(id);
  try{
    const pc=connection(id);const sender=pc.addTrack(audio.destination.stream.getAudioTracks()[0],audio.destination.stream);
    const bitrate=Number($('bitrate').value);const params=sender.getParameters();
    if(params.encodings?.length){params.encodings[0].maxBitrate=bitrate;await sender.setParameters(params);}
    const description=musicSDP(await pc.createOffer(),bitrate);await pc.setLocalDescription(description);
    send({type:'offer',to:id,sdp:pc.localDescription,generation:pc.generation});
  }finally{makingOffer.delete(id);}
}
async function onSignal(m){
  if(new URLSearchParams(location.search).has('audio-test')&&m.type!=='status')console.debug('signal',studio?'host':'client',m.type,m.from||m.id||'');
  if(m.type==='passcode-required'&&!studio){passcodePrompt(!!m.invalid);return;}
  if(m.type==='joined'){
    joined=true;awaitingPasscode=false;$('passcode-form').hidden=true;$('connect').hidden=false;$('passcode').value='';$('passcode-error').textContent='';$('passcode').removeAttribute('aria-invalid');resetReception();
    reconnectAttempt=0;iceServers=m.iceServers;peerId=m.id;
    if(studio){live=true;send({type:'publishing',live:true,title:$('title').value});for(const id of m.peers||[])await offer(id);message('Broadcasting. Press Send audio in the plugin, then play your project.');}
    else{send({type:'mode',mode:pcm?'pcm':'webrtc'});send({type:'listener-health',state:'ok'});healthState='ok';scheduleFallback();status('Waiting for host');}
  }else if(m.type==='status'){
    live=m.live;
    const wasAvailable=sourceAvailable;sourceAvailable=!!m.audio;
    if(sourceAvailable&&!wasAvailable)resetReception();
    if(!live||!sourceAvailable)reportHealth('ok');
    $('session-title').textContent=m.title;$('fourth-value').textContent=studio?String(m.listeners):$('fourth-value').textContent;
    if(m.audio){$('source-label').textContent=`${(m.audio.rate/1000).toFixed(1)} KHZ SOURCE · 2 CHANNELS`;}
    else $('source-label').textContent='WAITING FOR PLUGIN AUDIO';
    if(studio){status(live&&m.audio?'Broadcasting live':live?'Waiting for plugin':'Sharing paused',live&&m.audio?'live':'');}
    else if(!live){status('Waiting for host');message('Audio will start when your host is ready.');}
    else if(pcm){status(m.audio?'Listening · compatibility':'Waiting for audio',m.audio?'live':'');if(m.audio&&healthState==='ok')message('');}
    else if([...peers.values()].some(p=>p.connectionState==='connected')){status('Listening', 'live');}

  }else if(m.type==='peer-joined'||m.type==='renegotiate')await offer(m.id||m.from,m.type==='renegotiate');
  else if(m.type==='peer-left'||m.type==='peer-mode'&&m.mode==='pcm')disposePeer(m.id);
  else if(m.type==='peer-mode'&&m.mode==='webrtc')await offer(m.id,true);
  else if(m.type==='publisher-left'){closePeers();audio?.reset();live=false;sourceAvailable=false;reportHealth('ok');status('Waiting for host');}
  else if(m.type==='offer'&&!studio&&!pcm){
    const pc=connection(m.from,m.generation);await pc.setRemoteDescription(m.sdp);
    await flushCandidates(m.from,pc);
    const answer=musicSDP(await pc.createAnswer(),510000);await pc.setLocalDescription(answer);
    send({type:'answer',sdp:pc.localDescription,generation:pc.generation});scheduleFallback();
  }else if(m.type==='answer'&&studio){const pc=peers.get(m.from);if(pc&&pc.generation===m.generation&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription(m.sdp);await flushCandidates(m.from,pc);}}
  else if(m.type==='candidate'){
    const pc=peers.get(m.from);
    if(pc?.remoteDescription){if(pc.generation===m.generation)await pc.addIceCandidate(m.candidate);}
    else{const list=pendingCandidates.get(m.from)||[];if(list.length<64)list.push({candidate:m.candidate,generation:m.generation});pendingCandidates.set(m.from,list);}
  }else if(m.type==='pong'&&pcm)$('rtt').textContent=`${Math.round(performance.now()-m.at)} ms`;
}
function connectSocket(){
  if(!running)return;
  const socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/signal`);ws=socket;socket.binaryType='arraybuffer';
  socket.onopen=()=>{if(studio)send({type:'join',role:'publisher',token:session.token});else joinListener();};
  let chain=Promise.resolve();
  socket.onmessage=({data})=>{
    if(typeof data!=='string'){lastBinary=performance.now();if(studio||pcm)audio?.feed(data);return;}
    chain=chain.then(()=>onSignal(JSON.parse(data))).catch(e=>{console.error('Signaling failed:',e);message(`Connection issue: ${e.message}`,true);});
  };
  socket.onerror=()=>message('Connection interrupted. Reconnecting…',true);
  socket.onclose=async e=>{
    if(ws!==socket||!running)return;
    joined=false;
    if([4003,4009].includes(e.code)){message(e.reason||'This invite is no longer available.',true);stop(false);return;}
    if(e.code===4008&&awaitingPasscode){await stop(false);passcodePrompt();message('Too many passcode attempts. Wait a moment, then try again.',true);return;}
    audio?.reset();closePeers();live=false;status('Reconnecting');
    message('Connection interrupted. Rejoining at the live audio.');
    clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectSocket,Math.min(8000,500*2**reconnectAttempt++)+Math.random()*250);
  };
}
async function start(){
  if(!studio&&!/^[a-f0-9]{48}$/.test(room)){message('Open the private invite your host sent you to join this session.',true);return;}
  $('connect').disabled=true;
  try{
    message('Starting audio…');
    if(studio&&!session)session=await fetch('/api/studio').then(r=>{if(!r.ok)throw Error('Local broadcaster is unavailable');return r.json();});
    audio=await createAudio(studio?35:90);
    if(studio){audio.destination=audio.context.createMediaStreamDestination();audio.destination.channelCount=2;audio.analyser.connect(audio.destination);}
    else{audio.usePCM(pcm);audio.gain.gain.value=listenerGain();audio.gain.connect(audio.context.destination);}
    audio.node.port.onmessage=({data})=>{
      if(data.type==='stats'&&(studio||pcm)){
        $('buffer').textContent=`${Math.round(data.bufferMs)} ms`;
        if(!studio){$('fourth-value').textContent=String(data.trimmed+data.underruns);$('quality').textContent=`PCM · ${(data.rate/1000).toFixed(1)} kHz`;}
      }
    };
    // Expose audio only when an explicit local test opt-in is present.
    if (new URLSearchParams(location.search).has('audio-test')) {window.__testAudio=audio;window.__testPeers=peers;}
    running=true;joined=false;sourceAvailable=false;healthState='ok';resetReception();connectSocket();
    $('connect').innerHTML=studio?'Stop broadcast <span>■</span>':'Stop listening <span aria-hidden="true">■</span>';$('connect').classList.add('stop');
    statsTimer=setInterval(updateStats,1000);pingTimer=setInterval(()=>send({type:'ping',at:performance.now()}),5000);
    $('transport').textContent=studio?'Opus / WebRTC':pcm?'PCM / tunnel':'Connecting…';
  }catch(e){message(`Could not start audio: ${e.message}`,true);await stop(false);}
  finally{$('connect').disabled=false;}
}
async function stop(showMessage=true){
  reportHealth('ok',false);running=false;live=false;joined=false;sourceAvailable=false;clearTimeout(reconnectTimer);clearTimeout(fallbackTimer);clearInterval(statsTimer);clearInterval(pingTimer);
  if(studio)send({type:'publishing',live:false});ws?.close();ws=null;closePeers();
  await audio?.context.close().catch(()=>{});audio=null;
  $('connect').innerHTML=studio?'Start broadcast <span>↗</span>':'Start listening <span aria-hidden="true">↗</span>';$('connect').classList.remove('stop');
  status('Disconnected');$('transport').textContent='—';$('buffer').textContent='—';$('rtt').textContent='—';
  if(showMessage)message(studio?'Broadcast stopped. Clients can no longer hear your audio.':'You have left the session.');
}
let lastReceived=null;
async function updateStats(){
  let packets=0;
  for(const pc of peers.values()){
    let stats;try{stats=await pc.getStats();}catch{continue;}
    for(const s of stats.values()){
      if(s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated){
        $('rtt').textContent=s.currentRoundTripTime===undefined?'—':`${Math.round(s.currentRoundTripTime*1000)} ms`;
        if(!studio){const candidate=stats.get(s.remoteCandidateId);$('transport').textContent=candidate?.candidateType==='relay'?'WebRTC / relay':'WebRTC / direct';}
      }
      if(!studio&&s.type==='inbound-rtp'&&s.kind==='audio'){
        const received=s.packetsReceived||0,lost=s.packetsLost||0;
        packets+=received;
        $('fourth-value').textContent=`${(100*Math.max(0,lost)/Math.max(1,received+lost)).toFixed(1)}%`;
        if(lastReceived&&s.jitterBufferEmittedCount>lastReceived.count){
          $('buffer').textContent=`${Math.round(1000*(s.jitterBufferDelay-lastReceived.delay)/(s.jitterBufferEmittedCount-lastReceived.count))} ms`;
        }
        lastReceived={count:s.jitterBufferEmittedCount,delay:s.jitterBufferDelay};
        const codec=stats.get(s.codecId);if(codec)$('quality').textContent='OPUS · STEREO';
      }
    }
  }
  const now=performance.now();
  if(!studio&&!pcm){if(receivedPackets!==null&&packets>receivedPackets)lastProgress=now;receivedPackets=packets;}
  if(audio&&['suspended','interrupted'].includes(audio.context.state)){status('Audio paused');message('Audio was paused by your browser. Tap Resume audio.');$('connect').innerHTML='Resume audio <span>↗</span>';}
  if(!studio&&running&&joined){
    // Incoming packets, rather than output level, distinguish a broken stream
    // from intentional mute, silent content, or the host pausing a broadcast.
    const progress=pcm?lastBinary:lastProgress;
    if(!live||!sourceAvailable)reportHealth('ok');
    else if(needsResume||['suspended','interrupted'].includes(audio?.context.state))reportHealth('audio-blocked');
    else if(progress&&now-progress<3000)reportHealth('ok');
    else if(now>=receptionGraceUntil){
      const failed=!pcm&&[...peers.values()].some(p=>['failed','disconnected','closed'].includes(p.connectionState));
      reportHealth(failed?'connection-failed':'audio-stalled');
    }
  }
  if(studio&&performance.now()-lastBinary>1800&&lastBinary)message('Plugin audio has stopped. Check Send audio and Ableton playback.');
}
$('connect').onclick=()=>{if(running&&(['suspended','interrupted'].includes(audio?.context.state)||needsResume))Promise.all([audio.resume(),remoteElement?.play()]).then(()=>{needsResume=false;reportHealth('ok');if(!studio){status(live?'Listening':'Waiting for host',live?'live':'');message(live?'':'Audio will start when your host is ready.');}$('connect').innerHTML=studio?'Stop broadcast <span>■</span>':'Stop listening <span aria-hidden="true">■</span>';}).catch(()=>message('Your browser paused audio. Tap Resume audio to try again.',true));else if(running)stop();else start();};
$('passcode-form').onsubmit=async e=>{
  e.preventDefault();passcode=$('passcode').value;$('passcode-submit').disabled=true;$('passcode').removeAttribute('aria-invalid');$('passcode-error').textContent='';
  try{if(running){await audio.resume();if(ws?.readyState===WebSocket.OPEN)joinListener();else connectSocket();}else await start();}
  catch{message('Could not start audio. Try again.',true);}
  finally{$('passcode-submit').disabled=false;}
};
function listenerGain(){const db=Number($('volume').value);return muted||db<=-60?0:10**(db/20);}
function applyListenerVolume(){
  if(!audio||studio)return;
  const gain=audio.gain.gain,time=audio.context.currentTime,value=listenerGain();
  gain.cancelScheduledValues(time);
  // Mute is exact zero, independent of the remembered slider level. Never
  // stop receiving, suspend the context or close a peer to silence output.
  if(value===0)gain.setValueAtTime(0,time);else gain.setTargetAtTime(value,time,.02);
}
$('volume').oninput=()=>{
  const db=Number($('volume').value),label=db<=-60?'−∞ dB':`${db>0?'+':''}${db} dB`;
  $('volume-label').textContent=label;$('volume').setAttribute('aria-valuetext',label);applyListenerVolume();
};
$('mute').onclick=()=>{muted=!muted;$('mute').setAttribute('aria-pressed',String(muted));$('mute').textContent=muted?'Unmute':'Mute';applyListenerVolume();};
$('fallback').onclick=()=>{if(!running){pcm=!pcm;$('fallback').textContent=pcm?'Try low-delay audio':'Use compatibility audio';message(pcm?'Compatibility audio selected.':'Low-delay audio selected.');}else setMode(!pcm);};
$('title').onchange=()=>{if(studio&&running)send({type:'publishing',live,title:$('title').value});};
$('bitrate').onchange=()=>{if(studio&&running)for(const id of peers.keys())offer(id,true).catch(e=>message(e.message,true));};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('invite').value);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy link',1800);}catch{ $('invite').select();message('Select and copy the invite link.');}};
$('rotate').onclick=async()=>{const r=await fetch('/api/rotate',{method:'POST',headers:{Authorization:`Bearer ${session.token}`}});if(r.ok){await refreshInvite();message('New invite created. Share this link with your client.');}else message('Could not create a new invite.',true);};
async function refreshInvite(){try{session=await fetch('/api/studio').then(r=>r.json());$('invite').value=session.listenerURL;
  $('link-note').textContent=session.listenerURL.includes('127.0.0.1')?'Local link only. Start with npm run start:tunnel to reach clients online.':'Temporary Cloudflare link. Keep this Mac, the broadcaster, and the tunnel running.';
}catch(e){message(`Cannot reach the local bridge: ${e.message}`,true);}}
if(studio){
  $('heading').textContent='Broadcast';$('intro-text').textContent='Share your Ableton audio with a listener.';
  $('studio-settings').hidden=false;$('invite-panel').hidden=false;$('listener-settings').hidden=true;$('fallback').hidden=true;
  $('fourth-label').textContent='LISTENERS';
  $('connect').innerHTML='Start broadcast <span>↗</span>';message('Start the broadcast, then press Send audio in your Ableton plugin.');
  await refreshInvite();setInterval(refreshInvite,5000);
}else if(!/^[a-f0-9]{48}$/.test(room)){message('You need a private invite from your host to join.',true);$('connect').disabled=true;}
else{
  // The invite stays in the fragment; no passcode is placed in a URL or stored.
  // Preflight never starts audio. The listener's click remains the user gesture
  // that opens/resumes Web Audio on phones, including protected sessions.
  fetch('/api/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room})})
    .then(r=>r.ok?r.json():null).then(info=>{if(info?.passcodeRequired&&!joined)passcodePrompt();}).catch(()=>{});
}
const canvas=$('scope'),ctx=canvas.getContext('2d'),values=new Float32Array(2048);
function draw(){
  const dpr=Math.min(devicePixelRatio,2),w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==w*dpr||canvas.height!==h*dpr){canvas.width=w*dpr;canvas.height=h*dpr;}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#303931';ctx.lineWidth=1;ctx.beginPath();
  for(let x=0;x<w;x+=Math.max(1,w/12)){ctx.moveTo(x,0);ctx.lineTo(x,h);}
  ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
  values.fill(0);audio?.analyser.getFloatTimeDomainData(values);
  ctx.strokeStyle=running?'#baf77a':'#647560';ctx.lineWidth=1.5;ctx.beginPath();
  for(let x=0;x<w;x++){const y=h/2-values[Math.floor(x/w*values.length)]*h*.43;if(!x)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
  requestAnimationFrame(draw);
}
draw();
// Diagnostics are read-only and contain no session credentials.
window.sessionDiagnostics=()=>({running,pcm,live,muted,volumeDb:Number($('volume').value),context:audio?.context.state,connections:[...peers.values()].map(p=>p.connectionState),lastAudioAgeMs:lastBinary?performance.now()-lastBinary:null,listenerHealth:healthState});
