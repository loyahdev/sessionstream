export async function createAudio(targetMs=35){
  // iOS Web Audio defaults to ambient audio, which follows the silent switch.
  // Request the media playback category before opening/resuming the device.
  let session,previousType;
  try{session=globalThis.navigator?.audioSession;previousType=session?.type;if(session)session.type='playback';}catch{session=null;}
  const restoreSession=()=>{try{if(session?.type==='playback')session.type=previousType;}catch{}};
  const mediaPlayback=()=>{try{if(session)session.type='playback';}catch{}};
  let context;
  try{context=new AudioContext({latencyHint:'interactive',sampleRate:48000});}catch(e){restoreSession();throw e;}
  context.addEventListener('statechange',()=>{if(context.state==='closed')restoreSession();});
  if(new URLSearchParams(location.search).has('audio-test'))window.__audioInit=context;
  try {
    await Promise.race([context.resume(),new Promise((_,reject)=>setTimeout(()=>reject(Error('The browser audio device did not start. Check your output device and try again.')),12000))]);
    await Promise.race([context.audioWorklet.addModule('/pcm-worklet.mjs'),new Promise((_,reject)=>setTimeout(()=>reject(Error('The browser could not load its audio engine. Reload this page and try again.')),10000))]);
  } catch(e) { context.close().catch(()=>{}); throw e; }
  const node=new AudioWorkletNode(context,'session-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{targetMs}});
  node.channelCount=2;node.channelCountMode='explicit';
  const analyser=new AnalyserNode(context,{fftSize:2048,smoothingTimeConstant:.7});
  const gain=new GainNode(context,{gain:1});
  node.connect(analyser);analyser.connect(gain);
  let pcmConnected=true;
  return {context,node,analyser,gain,resume(){mediaPlayback();return context.resume();},usePCM(enabled){
    if(enabled===pcmConnected)return;
    if(enabled)node.connect(analyser);else node.disconnect(analyser);
    pcmConnected=enabled;
  },feed(buffer){node.port.postMessage({type:'packet',buffer},[buffer]);},reset(){node.port.postMessage({type:'reset'});}};
}
export function musicSDP(description,bitrate){
  const lines=description.sdp.split('\r\n');
  const opus=lines.find(l=>/^a=rtpmap:\d+ opus\/48000/i.test(l));
  if(!opus)return description;
  const pt=opus.match(/^a=rtpmap:(\d+)/)[1];
  const opts={stereo:'1','sprop-stereo':'1',maxaveragebitrate:String(bitrate),useinbandfec:'1',usedtx:'0',maxplaybackrate:'48000'};
  const i=lines.findIndex(l=>l.startsWith(`a=fmtp:${pt} `));
  const values=new Map(i>=0?lines[i].slice(lines[i].indexOf(' ')+1).split(';').map(v=>v.trim().split('=')):[]);
  for(const [k,v] of Object.entries(opts))values.set(k,v);
  const fmt=`a=fmtp:${pt} ${[...values].map(([k,v])=>`${k}=${v}`).join(';')}`;
  if(i>=0)lines[i]=fmt;else lines.splice(lines.indexOf(opus)+1,0,fmt);
  // Browser support for packet duration varies; this requests 10 ms packets.
  const audio=lines.findIndex(l=>l.startsWith('m=audio'));
  if(audio>=0&&!lines.some(l=>l.startsWith('a=ptime:')))lines.splice(audio+1,0,'a=ptime:10');
  return {type:description.type,sdp:lines.join('\r\n')};
}
