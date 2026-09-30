class PCMPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.capacity=32768; this.l=new Float32Array(this.capacity);this.r=new Float32Array(this.capacity);
    this.write=0;this.read=0;this.rate=48000;this.targetMs=options.processorOptions?.targetMs ?? 35;
    this.primed=false;this.source=null;this.sequence=null;this.underruns=0;this.trimmed=0;this.ticks=0;this.adjustment=1;
    this.port.onmessage=({data})=>{
      if(data.type==='reset'){this.reset();return;}
      if(data.type==='packet')this.push(data.buffer);
    };
  }
  reset(){this.write=0;this.read=0;this.primed=false;this.sequence=null;this.source=null;}
  push(buffer){
    const v=new DataView(buffer);
    if(v.byteLength<24 || v.getUint32(0,true)!==0x4d525453)return;
    const seq=v.getUint32(4,true),rate=v.getUint32(8,true),n=v.getUint16(12,true),source=v.getUint32(16,true);
    if(![44100,48000,88200,96000,176400,192000].includes(rate)||n<1||n>256||v.getUint16(14,true)!==2||v.byteLength!==24+n*8)return;
    if(source!==this.source||rate!==this.rate){this.reset();this.source=source;this.rate=rate;}
    if(this.sequence!==null){
      const gap=(seq-this.sequence-1)>>>0;
      if(gap>0x80000000)return; // Discard duplicate/out-of-order UDP packets.
      if(gap>8){this.read=this.write;this.primed=false;}
      else for(let i=0;i<gap*n;i++){this.l[this.write%this.capacity]=0;this.r[this.write%this.capacity]=0;this.write++;}
    }
    this.sequence=seq;
    for(let i=0;i<n;i++){
      const l=v.getFloat32(24+i*8,true),r=v.getFloat32(28+i*8,true);
      this.l[this.write%this.capacity]=Number.isFinite(l)?l:0;this.r[this.write%this.capacity]=Number.isFinite(r)?r:0;this.write++;
    }
    const target=Math.ceil(this.rate*this.targetMs/1000);
    if(this.write-this.read>Math.min(this.capacity-512,target+this.rate*.08)){
      this.trimmed++;this.read=this.write-target;this.primed=false;
    }
  }
  process(inputs,outputs){
    const out=outputs[0];if(!out?.length)return true;
    const target=this.rate*this.targetMs/1000;
    let leftPeak=0,rightPeak=0;
    if(!this.primed&&this.write-this.read>=target)this.primed=true;
    // Small resampling adjustment corrects independent DAW/browser clocks.
    const queued=this.write-this.read;
    this.adjustment=1+Math.max(-.002,Math.min(.002,(queued-target)/this.rate*.08));
    const step=this.rate/sampleRate*this.adjustment;
    if(this.primed){
      for(let i=0;i<out[0].length;i++){
        if(this.read+1>=this.write){this.primed=false;this.underruns++;break;}
        const at=Math.floor(this.read),frac=this.read-at,a=at%this.capacity,b=(at+1)%this.capacity;
        const l=this.l[a]+(this.l[b]-this.l[a])*frac,r=this.r[a]+(this.r[b]-this.r[a])*frac;
        out[0][i]=l;if(out[1])out[1][i]=r;
        leftPeak=Math.max(leftPeak,Math.abs(l));rightPeak=Math.max(rightPeak,Math.abs(r));this.read+=step;
      }
    }
    if(++this.ticks%80===0)this.port.postMessage({type:'stats',bufferMs:(this.write-this.read)/this.rate*1000,
      underruns:this.underruns,trimmed:this.trimmed,leftPeak,rightPeak,rate:this.rate});
    return true;
  }
}
registerProcessor('session-pcm',PCMPlayer);
