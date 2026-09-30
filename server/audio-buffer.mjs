// Bounded stereo FIFO. Resampling follows the DAW clock instead of periodically
// dropping a whole block; a short reservoir absorbs large Ableton callbacks.
export class AudioBuffer {
  constructor(targetMs=60) { this.capacity=65536;this.l=new Float32Array(this.capacity);this.r=new Float32Array(this.capacity);this.targetMs=targetMs;this.underruns=0;this.trims=0;this.reset(); }
  reset(){this.read=0;this.write=0;this.rate=48000;this.source=null;this.seq=null;this.primed=false;this.lastL=0;this.lastR=0;}
  push(packet,p){
    if(this.source!==p.source||this.rate!==p.rate){this.reset();this.source=p.source;this.rate=p.rate;}
    if(this.seq!==null){const gap=(p.sequence-this.seq-1)>>>0;if(gap>0x80000000)return;if(gap>8){this.read=this.write;this.primed=false;}else for(let i=0;i<gap*256;i++)this.put(0,0);}
    this.seq=p.sequence;
    for(let i=0;i<p.frames;i++)this.put(packet.readFloatLE(24+i*8),packet.readFloatLE(28+i*8));
    const target=this.rate*this.targetMs/1000;
    if(this.write-this.read>Math.min(this.capacity-512,target+this.rate*.12)){this.read=this.write-target;this.primed=false;this.trims++;}
  }
  put(l,r){const i=this.write++%this.capacity;this.l[i]=Number.isFinite(l)?l:0;this.r[i]=Number.isFinite(r)?r:0;}
  render(){
    const samples=new Int16Array(960),target=this.rate*this.targetMs/1000,queued=this.write-this.read;
    if(!this.primed&&queued>=target)this.primed=true;
    const step=this.rate/48000*(1+Math.max(-.005,Math.min(.005,(queued-target)/this.rate*.08)));
    for(let i=0;i<480;i++){
      let l=0,r=0;
      if(this.primed&&this.read+step+1<this.write){
        const at=Math.floor(this.read),f=this.read-at,a=at%this.capacity,b=(at+1)%this.capacity;
        l=this.l[a]+(this.l[b]-this.l[a])*f;r=this.r[a]+(this.r[b]-this.r[a])*f;this.read+=step;this.lastL=l;this.lastR=r;
      }else{
        if(this.primed){this.underruns++;this.primed=false;}
        // Fade the last sample rather than clicking abruptly to zero.
        this.lastL*=.9;this.lastR*=.9;l=this.lastL;r=this.lastR;
      }
      samples[2*i]=Math.round(Math.max(-1,Math.min(1,l))*32767);samples[2*i+1]=Math.round(Math.max(-1,Math.min(1,r))*32767);
    }
    return {samples,sampleRate:48000,bitsPerSample:16,channelCount:2,numberOfFrames:480};
  }
  stats(){return {bufferMs:(this.write-this.read)/this.rate*1000,underruns:this.underruns,trims:this.trims};}
}
