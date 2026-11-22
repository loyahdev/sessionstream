import {StereoPeakLimiter,MultichannelPeakLimiter} from './peak-limiter.mjs';
import {pcmInfo,pcmSample,stereoSample} from './pcm-format.mjs';
class PCMPlayer extends AudioWorkletProcessor {
 constructor(options){
  super();this.capacity=32768;this.buffers=Array.from({length:8},()=>new Float32Array(this.capacity));this.l=this.buffers[0];this.r=this.buffers[1];this.last=new Float32Array(8);this.start=new Float32Array(8);this.temp=new Float32Array(8);this.channels=2;this.outputChannels=options.processorOptions?.outputChannels??2;
  this.rate=48000;this.targetMs=options.processorOptions?.targetMs??35;this.baseTargetMs=this.targetMs;this.effectiveTargetMs=this.targetMs;this.underruns=0;this.trimmed=0;this.ticks=0;this.adjustment=1;this.previousFrames=256;this.reset();
  this.port.onmessage=({data})=>{if(data.type==='reset')this.reset();if(data.type==='format'&&[1,2,6,8].includes(data.outputChannels)){this.outputChannels=data.outputChannels;this.reset();}if(data.type==='packet')this.push(data.buffer);};
 }
 reset(){this.write=0;this.read=0;this.primed=false;this.sequence=null;this.source=null;this.effectiveTargetMs=this.baseTargetMs;this.fade=0;this.last.fill(0);this.start.fill(0);}
 push(buffer){
  const info=pcmInfo(buffer);if(!info)return;const {sequence:seq,rate,frames:n,channels,source,view:v,width,encoding}=info;
  if(source!==this.source||rate!==this.rate||channels!==this.channels){this.reset();this.source=source;this.rate=rate;this.channels=channels;}
  if(this.sequence!==null){const gap=(seq-this.sequence-1)>>>0;if(gap>0x80000000)return;if(gap>8){this.read=this.write;this.primed=false;}else for(let i=0;i<gap*this.previousFrames;i++){for(let ch=0;ch<channels;ch++)this.buffers[ch][this.write%this.capacity]=0;this.write++;}}
  this.sequence=seq;this.previousFrames=n;
  for(let i=0;i<n;i++){for(let ch=0;ch<channels;ch++)this.buffers[ch][this.write%this.capacity]=pcmSample(v,24+(i*channels+ch)*width,encoding);this.write++;}
  const target=Math.ceil(this.rate*this.effectiveTargetMs/1000);if(this.write-this.read>Math.min(this.capacity-512,target+this.rate*.08)){this.trimmed++;this.read=this.write-target;this.primed=false;}
 }
 process(inputs,outputs){
  const out=outputs[0];if(!out?.length)return true;const target=this.rate*this.effectiveTargetMs/1000;let leftPeak=0,rightPeak=0;
  if(!this.primed&&this.write-this.read>=target){this.primed=true;this.fade=0;this.start.set(this.last);}
  const queued=this.write-this.read;this.adjustment=1+Math.max(-.002,Math.min(.002,(queued-target)/this.rate*.08));const step=this.rate/sampleRate*this.adjustment;
  for(let i=0;i<out[0].length;i++){
   if(this.primed&&this.read+step+1>=this.write){this.primed=false;this.underruns++;this.fade=0;this.effectiveTargetMs=Math.min(300,(this.capacity-1024)/this.rate*1000,this.effectiveTargetMs+20);}
   if(this.primed){const at=Math.floor(this.read),frac=this.read-at,a=at%this.capacity,b=(at+1)%this.capacity;this.fade=Math.min(1,this.fade+1/(sampleRate*.005));for(let ch=0;ch<this.channels;ch++)this.last[ch]=(this.buffers[ch][a]+(this.buffers[ch][b]-this.buffers[ch][a])*frac)*this.fade+this.start[ch]*(1-this.fade);this.read+=step;}else for(let ch=0;ch<this.channels;ch++)this.last[ch]*=.95;
   if(this.outputChannels<=2){stereoSample(this.last,this.channels,this.temp);const l=this.temp[0],r=this.temp[1];out[0][i]=this.outputChannels===1?(l+r)*.5:l;if(out[1])out[1][i]=r;for(let ch=2;ch<out.length;ch++)out[ch][i]=0;}
   else for(let ch=0;ch<out.length;ch++)out[ch][i]=ch<this.channels?this.last[ch]:this.channels===1&&ch===1?this.last[0]:0;
   leftPeak=Math.max(leftPeak,Math.abs(out[0][i]));rightPeak=Math.max(rightPeak,Math.abs(out[1]?.[i]??out[0][i]));
  }
  if(++this.ticks%80===0)this.port.postMessage({type:'stats',bufferMs:(this.write-this.read)/this.rate*1000,targetMs:this.effectiveTargetMs,underruns:this.underruns,trimmed:this.trimmed,leftPeak,rightPeak,rate:this.rate,channels:this.channels,outputChannels:this.outputChannels});return true;
 }
}
registerProcessor('session-pcm',PCMPlayer);
class SafetyOutput extends AudioWorkletProcessor {
 constructor(){super();this.limiter=new MultichannelPeakLimiter(sampleRate,8);this.samples=new Float32Array(8);this.mono=false;this.port.onmessage=({data})=>{if(data.type==='mono')this.mono=!!data.value;};}
 process(inputs,outputs){const input=inputs[0],out=outputs[0];if(!out?.length)return true;for(let i=0;i<out[0].length;i++){for(let ch=0;ch<8;ch++)this.samples[ch]=input?.[ch]?.[i]??(ch===1?input?.[0]?.[i]??0:0);if(this.mono){const value=(this.samples[0]+this.samples[1])*.5+Math.SQRT1_2*(this.samples[2]+(this.samples[4]+this.samples[5]+this.samples[6]+this.samples[7])*.5);this.samples.fill(0);this.samples[0]=this.samples[1]=value;}this.limiter.sample(this.samples);for(let ch=0;ch<out.length;ch++)out[ch][i]=this.limiter.output[ch]??0;}return true;}
}
registerProcessor('session-safety',SafetyOutput);
