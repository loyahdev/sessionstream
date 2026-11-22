import {ListenerDelivery} from './listener-delivery.mjs';
import {createAudio,musicSDP} from './audio.mjs';
const $=id=>document.getElementById(id),studio=document.documentElement.dataset.mode==='studio';
const themeButton=$('theme-toggle');
function updateThemeButton(){
  const dark=document.documentElement.dataset.theme==='dark';
  const label=dark?'Switch to light mode':'Switch to dark mode';
  themeButton.setAttribute('aria-label',label);
  themeButton.title=label;
  themeButton.setAttribute('aria-pressed',String(dark));
}
themeButton.addEventListener('click',()=>{
  const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem('sessionstream-theme',theme);}catch{}
  updateThemeButton();
});
updateThemeButton();

let currentHostName='',mediaHandlersBound=false;
function syncMediaSession(){
  if(studio||!('mediaSession' in navigator))return;
  try{
    if(typeof MediaMetadata==='function'){
      navigator.mediaSession.metadata=new MediaMetadata({
        title:$('session-title')?.textContent||'Live DAW Session',
        artist:currentHostName?`Hosted by ${currentHostName}`:'SessionStream',
        album:'SessionStream',
        artwork:[{src:`${pathPrefix}/brand-mark.svg`,sizes:'96x96',type:'image/svg+xml'}]
      });
    }
    navigator.mediaSession.playbackState=running?(live?'playing':'paused'):'none';
    if(!mediaHandlersBound){
      mediaHandlersBound=true;
      for(const [action,fn] of [
        ['play',()=>{if(!running)void start();else if(audio&&['suspended','interrupted'].includes(audio.context.state))void audio.resume();else if(muted)$('mute').click();}],
        ['pause',()=>{if(running&&!muted)$('mute').click();}],
        ['stop',()=>{if(running)void stop();}]
      ]){try{navigator.mediaSession.setActionHandler(action,fn);}catch{}}
    }
  }catch{}
}
function showHost(name){
  currentHostName=typeof name==='string'?name:'';
  const line=$('host-name');
  line.hidden=!currentHostName;
  line.textContent=line.hidden?'':`Session hosted by ${currentHostName}`;
  syncMediaSession();
}
let expired=false;
function reloadExpired(){
  if(expired)return;
  expired=true;
  void stop(false);
  const url=new URL(location.href);
  url.searchParams.set('expired','1');
  url.hash='';
  location.replace(url);
}
let audio=null,ws=null,running=false,reconnectTimer=null,reconnectAttempt=0,session=null,iceServers=[],peerId=null;
let deliveryMode='direct',extraEncryption=false,secureDelivery=null;
let pcm=false,live=false,lastBinary=0,statsTimer=null,fallbackTimer=null,pingTimer=null,rtcSource=null,remoteElement=null,needsResume=false;
let feedbackEnabled=false,nextNoteAt=0;
let muted=false,mono=false,dimmed=false,scopeMode='wave',noteTimer=null,connectionRetried=false;
let bufferStats=null;
let passcode='',awaitingPasscode=false,joined=false,sourceAvailable=false,healthState='ok',healthSentAt=0;
let receptionGraceUntil=0,lastProgress=0,receivedPackets=null;
const peers=new Map(),pendingCandidates=new Map(),makingOffer=new Set();
const pathPrefix=document.documentElement.dataset.sharePrefix||location.pathname.match(/^\/\d{6}(?=\/|$)/)?.[0]||'';
const room=location.hash.slice(1)||document.documentElement.dataset.room||'';
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function status(text,kind=''){
  $('status-label').textContent=text.toUpperCase();
  $('status-dot').className=`dot ${kind}`;
  $('console-card')?.classList.toggle('is-live',kind==='live');
  if(!studio)$('heading').textContent=kind==='live'?'Listening':'Listen';
  syncMediaSession();
}
function send(m){if(!studio&&!joined&&m.type!=='join')return;if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));}
let approvalRequired=false,accountRequired=false,listenerCredential='';
let accessDenied=false,waitingForApproval=false,checkingSignIn=false,joinInFlight=null;
let audioSetup=null,audioAttempt=0;
try{listenerCredential=localStorage.getItem('sessionstream-listener-'+room)||'';}catch{}
if(!/^[a-f0-9]{64}$/.test(listenerCredential)){listenerCredential=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');try{localStorage.setItem('sessionstream-listener-'+room,listenerCredential);}catch{}}
async function joinListener(){
  const targetSocket=ws;
  if(accessDenied||waitingForApproval||!running||targetSocket?.readyState!==WebSocket.OPEN||joinInFlight===targetSocket)return;
  let listenerTicket;
  if(accountRequired){
    joinInFlight=targetSocket;
    try{
      const response=await fetch('https://sessionstream.app/api/account/listener-ticket',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({room}),signal:AbortSignal.timeout?.(8000)});
      const proof=await response.json();
      if(!response.ok||!proof.ticket)throw Error();
      listenerTicket=proof.ticket;
    }catch{
      if(ws===targetSocket&&running)showListenerSignIn();
      return;
    }finally{
      if(joinInFlight===targetSocket)joinInFlight=null;
    }
  }
  if(ws!==targetSocket||!running)return;
  checkingSignIn=false;
  send({type:'join',role:'listener',mode:pcm?'pcm':'webrtc',room,name:$('listener-name').value.trim()||'Guest',listenerCredential,...(listenerTicket?{listenerTicket}:{}),...(passcode?{passcode}:{})});
}
function showListenerSignIn(){accountRequired=true;checkingSignIn=true;awaitingPasscode=false;$('passcode-form').hidden=true;$('connect').hidden=false;$('listener-identity').hidden=false;$('listener-signin').hidden=false;$('listener-name').hidden=true;$('listener-identity').querySelector('label').hidden=true;$('listener-access-note').textContent='Sign in in the new tab, then return here and try again.';message('This host requires a signed-in account.');status('Sign in required');$('connect').innerHTML='Check sign-in <span>↗</span>';}

function accessBlocked(reason){
  if(accessDenied)return;
  accessDenied=true;
  $('connect').hidden=true;
  $('passcode-form').hidden=true;
  $('listener-identity').hidden=true;
  void stop(false);
  status(reason==='revoked'?'Access revoked':'Request declined','error');
  message(reason==='revoked'?'The host revoked your access to this invitation.':'The host declined your request to join this invitation.',true);
}
function idleButton(){
  $('connect').innerHTML=studio?'Start broadcast <span>↗</span>':accountRequired?'Check sign-in <span>↗</span>':approvalRequired?'Request access <span>↗</span>':'Start listening <span aria-hidden="true">↗</span>';
}
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
  'audio-stalled':'Audio has stopped reaching this device. Try Buffered audio or check your connection.'
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
function closeDelivery(){secureDelivery?.close();secureDelivery=null;}
function disposePeer(id){const p=peers.get(id);if(p){p.onconnectionstatechange=null;p.close();peers.delete(id);}pendingCandidates.delete(id);}
function closePeers(){closeDelivery();for(const id of peers.keys())disposePeer(id);rtcSource?.disconnect();rtcSource=null;if(remoteElement){remoteElement.pause();remoteElement.srcObject=null;remoteElement.remove();remoteElement=null;}needsResume=false;}
function updateModeControls(automatic=false){
  $('mode-live').checked=!pcm;$('mode-buffered').checked=pcm;
  $('mode-help').textContent=pcm
    ?(automatic?'Live audio could not connect. Switched to Buffered audio automatically. ':'')+'More latency and data use.'
    :'Live audio uses less delay. Switch to Buffered if the connection is unstable.';
  $('quality').textContent='STEREO';
}
function setMode(value,automatic=false){
  if(deliveryMode==='cloud')return;
  pcm=value;connectionRetried=false;resetReception();clearTimeout(fallbackTimer);closePeers();audio?.reset();audio?.usePCM(pcm);send({type:'mode',mode:pcm?'pcm':'webrtc'});
  updateModeControls(automatic);
  $('transport').textContent=pcm?'PCM / tunnel':'Connecting…';
  $('fourth-label').textContent=pcm?'BUFFER RESETS':'PACKET LOSS';$('fourth-value').textContent='—';
  if(!joined)return;
  if(pcm)message(automatic?'Switched to Buffered audio. Reconnecting…':'Switching to Buffered audio…');
  else{scheduleFallback();}
}
function retryLiveAudio(){
  if(connectionRetried){send({type:'listener-connection',event:'fallback-after-retry'});setMode(true,true);return;}
  connectionRetried=true;send({type:'listener-connection',event:'retry-requested'});send({type:'renegotiate'});
  message('Retrying Live audio…');scheduleFallback();
}
function scheduleFallback(){
  clearTimeout(fallbackTimer);
  if(studio||pcm||deliveryMode==='cloud'||!running)return;
  fallbackTimer=setTimeout(()=>{
    if([...peers.values()].some(p=>p.connectionState==='connected'))return;
    // Waiting for the host is not a failed connection attempt.
    if(!live||!sourceAvailable){scheduleFallback();return;}
    retryLiveAudio();
  },15000);
}
function connection(id,generation=crypto.randomUUID()){
  if(!studio)resetReception();
  const candidates=pendingCandidates.get(id);disposePeer(id);if(candidates)pendingCandidates.set(id,candidates);const pc=new RTCPeerConnection({iceServers});pc.generation=generation;peers.set(id,pc);
  pc.onicecandidate=({candidate})=>{if(candidate)send({type:'candidate',to:id,candidate,generation:pc.generation});};
  pc.onconnectionstatechange=()=>{
    if(new URLSearchParams(location.search).has('audio-test'))console.debug('peer',id,pc.connectionState,pc.iceConnectionState,pc.signalingState);
    if(pc.connectionState==='connected'){
      if(!studio){connectionRetried=false;clearTimeout(fallbackTimer);status(live?'Listening':'Waiting for host',live?'live':'');if(healthState==='ok')message('');}
    }else if(pc.connectionState==='failed'){
      if(deliveryMode==='cloud'){ws?.close();return;}
      if(studio)offer(id,true).catch(e=>message(e.message,true));else if(!pcm){if(live&&sourceAvailable)reportHealth('connection-failed');retryLiveAudio();}
    }else if(pc.connectionState==='disconnected'&&!studio){status('Recovering connection');scheduleFallback();}
  };
  if(!studio){
    if(deliveryMode==='cloud'||extraEncryption){closeDelivery();secureDelivery=new ListenerDelivery({iceServers,decode:async()=>{const {CloudAudioDecoder}=await import('./vendor/cloud-decoder.mjs');const decoder=new CloudAudioDecoder();await decoder.ready;return decoder;},onFrame:raw=>{if(!running||!live)return;lastBinary=performance.now();audio?.usePCM(true);audio?.feed(raw);},onError:e=>{if(!running||!live)return;message(e.message,true);ws?.close();}});pc.ondatachannel=event=>secureDelivery?.attach(event.channel);}
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
  if(m.type==='sign-in-required'&&!studio){showListenerSignIn();return;}
  if(m.type==='name-required'&&!studio){$('listener-identity').hidden=false;message('Enter your name, then request access.');return;}
  if(m.type==='approval-pending'&&!studio){
    reconnectAttempt=0;
    waitingForApproval=true;awaitingPasscode=false;
    $('passcode-form').hidden=true;
    $('connect').hidden=false;
    $('connect').textContent='Cancel request';
    status('Waiting for approval');
    message('Your request is with the host. Audio starts after they accept.');
    return;
  }
  if(!studio&&(m.type==='access-revoked'||m.type==='access-rejected')){
    accessBlocked(m.type==='access-revoked'?'revoked':'rejected');
    return;
  }
  if(m.type==='access-full'&&!studio){message('This session cannot accept more requests right now.',true);return;}
  if(m.type==='passcode-required'&&!studio){passcodePrompt(!!m.invalid);return;}
  if(m.type==='joined'){
    const socket=ws;
    if(!studio&&!(await audioSetup)){
      if(running&&ws===socket){
        await stop(false);
        status('Audio unavailable','error');
        message('Access granted. Your browser audio could not start. Try again to listen.',true);
      }
      return;
    }
    if(!running||ws!==socket)return;
    waitingForApproval=false;
    if(!studio)$('connect').innerHTML='Stop listening <span aria-hidden="true">■</span>';
    deliveryMode=m.delivery==='cloud'?'cloud':'direct';extraEncryption=m.encrypted===true;if(!studio){$('audio-security').hidden=false;$('audio-security').textContent=deliveryMode==='cloud'?(extraEncryption?'Cloud · end-to-end encrypted':'Cloud · connection encryption only'):(extraEncryption?'Direct · end-to-end encrypted':'Direct · connection encryption only');}if(!studio){$('audio-mode').hidden=deliveryMode==='cloud';if(deliveryMode==='cloud'){audio?.usePCM(true);$('transport').textContent=extraEncryption?'Cloud / encrypted':'Cloud / transport encryption';}}
    joined=true;if(!studio)$('listener-identity').hidden=true;if(!studio&&$('note-form'))$('note-form').hidden=true;connectionRetried=false;awaitingPasscode=false;$('passcode-form').hidden=true;$('connect').hidden=false;$('passcode').value='';$('passcode-error').textContent='';$('passcode').removeAttribute('aria-invalid');resetReception();
    reconnectAttempt=0;iceServers=m.iceServers;peerId=m.id;
    if(studio){live=true;send({type:'publishing',live:true,title:$('title').value});for(const id of m.peers||[])await offer(id);message('Broadcasting. Press Start streaming in the plugin, then play your project.');}
    else{send({type:'mode',mode:pcm?'pcm':'webrtc'});send({type:'listener-health',state:'ok'});healthState='ok';scheduleFallback();status('Waiting for host');}
  }else if(m.type==='status'){
    live=m.live;feedbackEnabled=m.feedbackEnabled===true;if(!studio&&$('note-form'))$('note-form').hidden=!(joined&&live&&feedbackEnabled);
    if(!studio)showHost(m.hostName);
    const wasAvailable=sourceAvailable;sourceAvailable=!!m.audio;
    if(sourceAvailable&&!wasAvailable)resetReception();
    if(!live||!sourceAvailable)reportHealth('ok');
    $('session-title').textContent=m.title;$('fourth-value').textContent=studio?String(m.listeners):$('fourth-value').textContent;
    if(m.audio){$('source-label').textContent=`${(m.audio.rate/1000).toFixed(1)} KHZ SOURCE · 2 CHANNELS`;}
    else $('source-label').textContent='WAITING FOR PLUGIN AUDIO';
    if(studio){status(live&&m.audio?'Broadcasting live':live?'Waiting for plugin':'Sharing paused',live&&m.audio?'live':'');}
    else if(!live){status('Waiting for host');message('Audio will start when your host is ready.');}
    else if(pcm||deliveryMode==='cloud'){status(m.audio?'Listening':'Waiting for audio',m.audio?'live':'');if(m.audio&&healthState==='ok')message('');}
    else if([...peers.values()].some(p=>p.connectionState==='connected')){status('Listening', 'live');}

  }else if(m.type==='peer-joined'||m.type==='renegotiate')await offer(m.id||m.from,m.type==='renegotiate');
  else if(m.type==='peer-left'||m.type==='peer-mode'&&m.mode==='pcm')disposePeer(m.id);
  else if(m.type==='peer-mode'&&m.mode==='webrtc')await offer(m.id,true);
  else if(m.type==='publisher-left'){closePeers();audio?.reset();live=false;sourceAvailable=false;reportHealth('ok');status('Waiting for host');}
  else if(m.type==='offer'&&!studio&&(!pcm||extraEncryption||deliveryMode==='cloud')){
    const pc=connection(m.from,m.generation);await pc.setRemoteDescription(m.sdp);
    await flushCandidates(m.from,pc);
    const answer=musicSDP(await pc.createAnswer(),510000);await pc.setLocalDescription(answer);
    send({type:'answer',sdp:pc.localDescription,generation:pc.generation});scheduleFallback();
  }else if(m.type==='answer'&&studio){const pc=peers.get(m.from);if(pc&&pc.generation===m.generation&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription(m.sdp);await flushCandidates(m.from,pc);}}
  else if(m.type==='candidate'){
    const pc=peers.get(m.from);
    if(pc?.remoteDescription){if(pc.generation===m.generation)await pc.addIceCandidate(m.candidate);}
    else{const list=pendingCandidates.get(m.from)||[];if(list.length<64)list.push({candidate:m.candidate,generation:m.generation});pendingCandidates.set(m.from,list);}
  }else if(m.type==='note-ack'&&!studio&&$('note-status')){
    const sec=Math.max(0,Math.floor(Number(m.offsetSeconds)||0));
    const stamp=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    if($('note-input')?.value.trim()===m.text)$('note-input').value='';
    $('note-status').hidden=false;$('note-status').textContent=`Sent to DAW at ${stamp} ✓`;
    clearTimeout(noteTimer);noteTimer=setTimeout(()=>{if($('note-status'))$('note-status').hidden=true;},3500);
  }else if(m.type==='note-error'&&!studio&&$('note-status')){
    $('note-status').hidden=false;$('note-status').textContent=m.error||'Your note could not be sent.';
  }else if(m.type==='pong'&&pcm)$('rtt').textContent=`${Math.round(performance.now()-m.at)} ms`;
}
function connectSocket(){
  if(!running)return;
  const socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${pathPrefix}/signal`);ws=socket;socket.binaryType='arraybuffer';
  socket.onopen=()=>{if(studio)send({type:'join',role:'publisher',token:session.token});else joinListener();};
  let chain=Promise.resolve();
  socket.onmessage=({data})=>{
    if(typeof data!=='string'){if(extraEncryption&&!studio){void secureDelivery?.buffered(data);return;}lastBinary=performance.now();if(studio||pcm)audio?.feed(data);return;}
    chain=chain.then(()=>ws===socket&&running?onSignal(JSON.parse(data)):undefined).catch(e=>{console.error('Signaling failed:',e);message(`Connection issue: ${e.message}`,true);});
  };
  socket.onerror=()=>message('Connection interrupted. Reconnecting…',true);
  socket.onclose=async e=>{
    if(ws!==socket||!running)return;
    joined=false;if($('note-form'))$('note-form').hidden=true;
    if(!studio&&[4003,4011,4012].includes(e.code)){reloadExpired();return;}
    if(!studio&&e.code===1006&&await checkInvite())return;
    if(ws!==socket||!running)return;
    if(!studio&&e.code===4014){accessBlocked(/revoked|removed/i.test(e.reason)?'revoked':'rejected');return;}
    if(!studio&&e.code===4015){await stop(false);showListenerSignIn();return;}
    if([4001,4003,4009,4012,4016].includes(e.code)){
      await stop(false);
      message(e.reason||'This invite is no longer available.',true);
      return;
    }
    waitingForApproval=false;
    if(e.code===4008&&awaitingPasscode){await stop(false);passcodePrompt();message('Too many passcode attempts. Wait a moment, then try again.',true);return;}
    audio?.reset();closePeers();live=false;status('Reconnecting');
    message('Connection interrupted. Rejoining at the live audio.');
    clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectSocket,Math.min(8000,500*2**reconnectAttempt++)+Math.random()*250);
  };
}
async function start(){
  if(expired||accessDenied||running||$('connect').disabled)return;
  if(!studio&&!/^[a-f0-9]{48}$/.test(room)){message('Open the private invite your host sent you to join this session.',true);return;}
  if(!studio&&approvalRequired&&!accountRequired&&!$('listener-name').value.trim()){$('listener-identity').hidden=false;$('listener-name').focus();message('Enter a name for the host.');return;}
  $('connect').disabled=true;
  try{
    message('Starting audio…');
    if(studio&&!session)session=await fetch(`${pathPrefix}/api/studio`).then(r=>{if(!r.ok)throw Error('Local broadcaster is unavailable');return r.json();});
    const attempt=++audioAttempt;
    audioSetup=prepareAudio(attempt);
    if(studio&&!(await audioSetup))throw Error('The browser audio device did not start.');
    if(attempt!==audioAttempt||expired||accessDenied)return;
    running=true;joined=false;sourceAvailable=false;healthState='ok';resetReception();connectSocket();
    $('connect').innerHTML=studio?'Stop broadcast <span>■</span>':'Cancel <span aria-hidden="true">■</span>';
    $('connect').classList.add('stop');
    statsTimer=setInterval(updateStats,1000);pingTimer=setInterval(()=>send({type:'ping',at:performance.now()}),5000);
    $('transport').textContent=studio?'Opus / WebRTC':pcm?'PCM / tunnel':'Connecting…';
  }catch(e){message(`Could not start audio: ${e.message}`,true);await stop(false);}
  finally{$('connect').disabled=false;}
}
async function prepareAudio(attempt){
  try{
    const prepared=await createAudio(studio?35:90);
    if(attempt!==audioAttempt){await prepared.context.close().catch(()=>{});return false;}
    audio=prepared;
    if(studio){audio.destination=audio.context.createMediaStreamDestination();audio.destination.channelCount=2;audio.analyser.connect(audio.destination);}
    else{audio.usePCM(pcm);audio.setMono?.(mono);audio.gain.gain.value=listenerGain();audio.output.connect(audio.context.destination);}
    audio.node.port.onmessage=({data})=>{
      if(data.type==='stats'&&(studio||pcm)){
        bufferStats={bufferMs:data.bufferMs,targetMs:data.targetMs,underruns:data.underruns,trims:data.trimmed};
        $('buffer').textContent=`${Math.round(data.bufferMs)} ms`;
        if(!studio){$('fourth-value').textContent=String(data.trimmed+data.underruns);$('quality').textContent='UNCOMPRESSED STEREO';}
      }
    };
    // Expose audio only when an explicit local test opt-in is present.
    if (new URLSearchParams(location.search).has('audio-test')) {window.__testAudio=audio;window.__testPeers=peers;}
    return true;
  }catch{return false;}
}
async function stop(showMessage=true){
  ++audioAttempt;waitingForApproval=false;checkingSignIn=false;awaitingPasscode=false;
  if($('note-form'))$('note-form').hidden=true;
  if(!studio)$('listener-identity').hidden=accessDenied||(!approvalRequired&&!accountRequired);
  reportHealth('ok',false);running=false;live=false;joined=false;sourceAvailable=false;clearTimeout(reconnectTimer);clearTimeout(fallbackTimer);clearInterval(statsTimer);clearInterval(pingTimer);
  if(studio)send({type:'publishing',live:false});ws?.close();ws=null;closePeers();
  const closing=audio;
  audio=null;
  idleButton();
  $('connect').classList.remove('stop');
  if(!accessDenied)status('Disconnected');$('transport').textContent='—';$('buffer').textContent='—';$('rtt').textContent='—';
  if(showMessage)message(studio?'Broadcast stopped. Clients can no longer hear your audio.':'You have left the session.');
  await closing?.context.close().catch(()=>{});
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
        const codec=stats.get(s.codecId);if(codec)$('quality').textContent='HIGH-QUALITY STEREO';
      }
    }
  }
  const now=performance.now();
  if(!studio&&!pcm&&deliveryMode!=='cloud'){if(receivedPackets!==null&&packets>receivedPackets)lastProgress=now;receivedPackets=packets;}
  if((studio||joined)&&audio&&['suspended','interrupted'].includes(audio.context.state)){status('Audio paused');message('Audio was paused by your browser. Tap Resume audio.');$('connect').innerHTML='Resume audio <span>↗</span>';}
  if(!studio&&running&&joined){
    // Incoming packets, rather than output level, distinguish a broken stream
    // from intentional mute, silent content, or the host pausing a broadcast.
    const progress=pcm||deliveryMode==='cloud'?lastBinary:lastProgress;
    if(!live||!sourceAvailable)reportHealth('ok');
    else if(needsResume||['suspended','interrupted'].includes(audio?.context.state))reportHealth('audio-blocked');
    else if(progress&&now-progress<3000)reportHealth('ok');
    else if(now>=receptionGraceUntil){
      const failed=!pcm&&[...peers.values()].some(p=>['failed','disconnected','closed'].includes(p.connectionState));
      reportHealth(failed?'connection-failed':'audio-stalled');
    }
  }
  if(studio&&performance.now()-lastBinary>1800&&lastBinary)message('Plugin audio has stopped. Check Start streaming and DAW playback.');
}
$('connect').onclick=()=>{
  if(accessDenied)return;
  if(waitingForApproval){
    if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'cancel-request'}));
    void stop(false);
    status('Request cancelled');
    message('You cancelled your request.');
    return;
  }
  if(checkingSignIn&&running&&!joined){void joinListener();return;}
  if(!running){void start();return;}
  if((studio||joined)&&(['suspended','interrupted'].includes(audio?.context.state)||needsResume)){
    Promise.all([audio.resume(),remoteElement?.play()]).then(()=>{
      needsResume=false;
      reportHealth('ok');
      if(!studio){
        status(live?'Listening':'Waiting for host',live?'live':'');
        message(live?'':'Audio will start when your host is ready.');
      }
      $('connect').innerHTML=studio?'Stop broadcast <span>■</span>':'Stop listening <span aria-hidden="true">■</span>';
    }).catch(()=>message('Your browser paused audio. Tap Resume audio to try again.',true));
    return;
  }
  void stop();
};
$('passcode-form').onsubmit=async e=>{
  e.preventDefault();if(accessDenied||waitingForApproval)return;passcode=$('passcode').value;$('passcode-submit').disabled=true;$('passcode').removeAttribute('aria-invalid');$('passcode-error').textContent='';
  try{if(running){if(ws?.readyState===WebSocket.OPEN)await joinListener();else if(ws?.readyState!==WebSocket.CONNECTING)connectSocket();}else await start();}
  catch{message('Could not start audio. Try again.',true);}
  finally{$('passcode-submit').disabled=false;}
};
function listenerGain(){const value=Number($('volume').value),db=Number.isFinite(value)?Math.max(-60,Math.min(6,value)):-60;return muted||db<=-60?0:10**((db-(dimmed?12:0))/20);}
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
$('mute').onclick=()=>{muted=!muted;$('mute').setAttribute('aria-pressed',String(muted));$('mute').textContent=muted?'Unmute':'Mute';syncMediaSession();applyListenerVolume();};
if($('mono'))$('mono').onclick=()=>{mono=!mono;$('mono').setAttribute('aria-pressed',String(mono));audio?.setMono?.(mono);};
if($('dim'))$('dim').onclick=()=>{dimmed=!dimmed;$('dim').setAttribute('aria-pressed',String(dimmed));applyListenerVolume();};
for(const [id,mode] of [['scope-wave','wave'],['scope-fft','fft']]){
  if($(id))$(id).onclick=()=>{
    scopeMode=mode;
    $('scope').dataset.display=mode;
    $('scope').setAttribute('aria-label',mode==='fft'?'Live audio frequency spectrum':'Live left and right audio waveforms');
    for(const [other,m] of [['scope-wave','wave'],['scope-fft','fft']]){
      const active=m===scopeMode;
      $(other)?.classList.toggle('active',active);
      $(other)?.setAttribute('aria-pressed',String(active));
    }
  };
}
function submitMixNote(raw){
  const text=String(raw||'').trim().slice(0,120);
  if(!text||!joined||studio||!live||!feedbackEnabled||performance.now()<nextNoteAt)return;
  nextNoteAt=performance.now()+2000;send({type:'listener-note',text});
}
if($('note-form')){
  $('note-form').onsubmit=e=>{e.preventDefault();submitMixNote($('note-input')?.value);};
  document.querySelectorAll('.note-chip').forEach(btn=>btn.addEventListener('click',()=>submitMixNote(btn.dataset.note)));
}
for(const [id,value] of [['mode-live',false],['mode-buffered',true]])$(id).onchange=()=>{if(pcm===value)return;if(running)setMode(value);else{pcm=value;updateModeControls();}};
updateModeControls();
$('title').onchange=()=>{if(studio&&running)send({type:'publishing',live,title:$('title').value});};
$('bitrate').onchange=()=>{if(studio&&running)for(const id of peers.keys())offer(id,true).catch(e=>message(e.message,true));};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('invite').value);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy link',1800);}catch{ $('invite').select();message('Select and copy the invite link.');}};
$('rotate').onclick=async()=>{const r=await fetch(`${pathPrefix}/api/rotate`,{method:'POST',headers:{Authorization:`Bearer ${session.token}`}});if(r.ok){await refreshInvite();message('New invite created. Share this link with your client.');}else message('Could not create a new invite.',true);};
async function refreshInvite(){try{session=await fetch(`${pathPrefix}/api/studio`).then(r=>r.json());$('invite').value=session.listenerURL;
  $('link-note').textContent=session.listenerURL.includes('127.0.0.1')?'Local link only. Start with npm run start:tunnel to reach clients online.':'Temporary Cloudflare link. Keep this computer, the broadcaster, and the tunnel running.';
}catch(e){message(`Cannot reach the local bridge: ${e.message}`,true);}}
if(studio){
  $('heading').textContent='Broadcast';
  $('studio-settings').hidden=false;$('invite-panel').hidden=false;$('listener-settings').hidden=true;$('audio-mode').hidden=true;
  $('fourth-label').textContent='LISTENERS';
  $('connect').innerHTML='Start broadcast <span>↗</span>';message('Start the broadcast, then start streaming in SessionStream.');
  await refreshInvite();setInterval(refreshInvite,5000);
}else if(!/^[a-f0-9]{48}$/.test(room)){message('You need a private invite from your host to join.',true);$('connect').disabled=true;}
else{
  // The invite stays in the fragment; no passcode is placed in a URL or stored.
  // Preflight never starts audio. The listener's click remains the user gesture
  // that opens/resumes Web Audio on phones, including protected sessions.
  $('connect').disabled=true;
  void checkInvite(true).finally(()=>{$('connect').disabled=accessDenied||expired;});
  const timer=setInterval(()=>{if(expired)clearInterval(timer);else void checkInvite();},15000);
}
async function checkInvite(initial=false){
  try{
    const response=await fetch(`${pathPrefix}/api/invite`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,listenerCredential}),signal:AbortSignal.timeout?.(5000)});
    if([403,404,410].includes(response.status)){reloadExpired();return true;}
    if(!response.ok)return false;
    const info=await response.json();
    showHost(info.hostName);
    if(info.accessDecision==='rejected'||info.accessDecision==='revoked'){accessBlocked(info.accessDecision);return true;}
    if(!running&&!accessDenied){
      const changed=initial||approvalRequired!==!!info.approvalRequired||accountRequired!==!!info.accountRequired;
      approvalRequired=!!info.approvalRequired;
      accountRequired=!!info.accountRequired;
      if(changed){
        $('listener-identity').hidden=!approvalRequired&&!accountRequired;
        $('listener-signin').hidden=!accountRequired;
        $('listener-name').hidden=accountRequired;
        $('listener-identity').querySelector('label').hidden=accountRequired;
        $('listener-access-note').textContent='The host approves access before you hear audio.';
        if(accountRequired)showListenerSignIn();
        else idleButton();
      }
      if(info.passcodeRequired&&!awaitingPasscode&&!passcode)passcodePrompt();
    }
  }catch{}
  return false;
}
const canvas=$('scope'),ctx=canvas.getContext('2d');
const valuesL=new Float32Array(2048),valuesR=new Float32Array(2048),freqL=new Uint8Array(1024),freqR=new Uint8Array(1024);
function drawCurve(samples,w,centerY,amp,strokeStyle,fillStyle){
  const points=Math.min(180,Math.max(48,Math.floor(w/2.5)));
  const step=samples.length/points;
  ctx.beginPath();
  let px=0,py=centerY-samples[0]*amp;
  ctx.moveTo(px,py);
  for(let i=1;i<points;i++){
    const x=i/(points-1)*w;
    const y=centerY-samples[Math.floor(i*step)]*amp;
    ctx.quadraticCurveTo(px,py,(px+x)*.5,(py+y)*.5);
    px=x;py=y;
  }
  ctx.lineTo(w,py);
  ctx.strokeStyle=strokeStyle;
  ctx.lineWidth=1.5;
  ctx.stroke();
  if(fillStyle){
    ctx.lineTo(w,centerY);ctx.lineTo(0,centerY);ctx.closePath();
    ctx.fillStyle=fillStyle;ctx.fill();
  }
}
function draw(){
  const light=document.documentElement.dataset.theme==='light';
  const plotLine=light?'rgba(44,102,33,.12)':'rgba(186,247,122,.08)';
  const midLine=light?'#cbd7cc':'#2a352d';
  const plotL=light?'#2c6621':'#baf77a';
  const plotR=light?'#74638f':'#baa7d7';
  const plotIdle=light?'#829285':'#56665a';
  const dpr=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight;
  if(w>0&&h>0&&(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr))){
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);

  // Crisp studio gridlines
  ctx.strokeStyle=plotLine;ctx.lineWidth=1;ctx.beginPath();
  for(let i=1;i<8;i++){const x=Math.round(w*i/8)+.5;ctx.moveTo(x,0);ctx.lineTo(x,h);}
  ctx.stroke();

  if(scopeMode==='fft'){
    freqL.fill(0);freqR.fill(0);
    if(audio?.analyserL){audio.analyserL.getByteFrequencyData(freqL);audio.analyserR.getByteFrequencyData(freqR);}
    else audio?.analyser.getByteFrequencyData(freqL);
    const bars=48,gap=2,barW=Math.max(2,(w-(bars-1)*gap)/bars);
    const sr=audio?.context.sampleRate||48000,nyquist=sr*.5;
    for(let i=0;i<bars;i++){
      const f0=20*Math.pow(1000,i/bars),f1=20*Math.pow(1000,(i+1)/bars);
      const b0=Math.max(1,Math.floor(f0/nyquist*freqL.length)),b1=Math.max(b0+1,Math.min(freqL.length,Math.ceil(f1/nyquist*freqL.length)));
      let maxL=0,maxR=0;
      for(let b=b0;b<b1;b++){if(freqL[b]>maxL)maxL=freqL[b];if(freqR[b]>maxR)maxR=freqR[b];}
      const mag=Math.max(maxL,maxR)/255;
      const bh=Math.max(2,mag*(h-14));
      const x=i*(barW+gap),y=h-4-bh;
      ctx.fillStyle=running?(light?'rgba(44,102,33,.82)':'rgba(186,247,122,.82)'):plotIdle;
      ctx.fillRect(x,y,barW,bh);
    }
  }else{
    const topY=Math.round(h*.29)+.5,botY=Math.round(h*.72)+.5;
    ctx.strokeStyle=midLine;ctx.lineWidth=1;ctx.beginPath();
    ctx.moveTo(0,topY);ctx.lineTo(w,topY);
    ctx.moveTo(0,botY);ctx.lineTo(w,botY);
    ctx.stroke();

    valuesL.fill(0);valuesR.fill(0);
    if(audio?.analyserL){
      audio.analyserL.getFloatTimeDomainData(valuesL);
      audio.analyserR.getFloatTimeDomainData(valuesR);
    }else if(audio?.analyser){
      audio.analyser.getFloatTimeDomainData(valuesL);
      valuesR.set(valuesL);
    }
    const amp=h*.20;
    drawCurve(valuesL,w,topY,amp,running?plotL:plotIdle,running?(light?'rgba(44,102,33,.10)':'rgba(186,247,122,.10)'):null);
    drawCurve(valuesR,w,botY,amp,running?plotR:plotIdle,running?(light?'rgba(116,99,143,.10)':'rgba(186,167,215,.09)'):null);

    ctx.font='600 9px "DM Sans", sans-serif';
    ctx.fillStyle=light?'rgba(23,33,26,.48)':'rgba(242,243,236,.42)';
    ctx.fillText('L',6,12);
    ctx.fillText('R',6,Math.round(h*.54)+10);
  }
  requestAnimationFrame(draw);
}
draw();
// Diagnostics are read-only and contain no session credentials.
window.sessionDiagnostics=()=>({running,pcm,live,muted,mono,dimmed,scopeMode,volumeDb:Number($('volume').value),context:audio?.context.state,connections:[...peers.values()].map(p=>p.connectionState),lastAudioAgeMs:lastBinary?performance.now()-lastBinary:null,listenerHealth:healthState,buffer:bufferStats,relayConfigured:iceServers.some(s=>[s.urls].flat().some(url=>/^turns?:/.test(url))),safety:{ceilingDbFS:-1,maxGainDb:6,lookaheadMs:5}});
