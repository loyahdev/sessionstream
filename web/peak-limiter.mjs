// Stereo-linked sample-peak protection. Five milliseconds of lookahead and a
// 100 ms release avoid independent channel pumping. This is not a loudness meter
// or an oversampled true-peak limiter; the -1 dBFS ceiling leaves output headroom.
export class StereoPeakLimiter {
  constructor(rate=48000,ceilingDb=-1){
    this.ceiling=10**(ceilingDb/20);this.delay=Math.max(1,Math.round(rate*.005));
    this.size=this.delay+2;this.left=new Float64Array(this.size);this.right=new Float64Array(this.size);
    this.peaks=new Float64Array(this.size);this.indices=new Float64Array(this.size);
    this.release=Math.exp(-1/(rate*.1));this.reset();
  }
  reset(){this.left.fill(0);this.right.fill(0);this.head=0;this.tail=0;this.frame=0;this.gain=1;this.outL=0;this.outR=0;}
  sample(l,r){
    l=Number.isFinite(l)?l:0;r=Number.isFinite(r)?r:0;
    const n=this.frame++,slot=n%this.size;this.left[slot]=l;this.right[slot]=r;
    while(this.head!==this.tail&&this.indices[this.head]<n-this.delay)this.head=(this.head+1)%this.size;
    const peak=Math.max(Math.abs(l),Math.abs(r));
    while(this.head!==this.tail&&this.peaks[(this.tail+this.size-1)%this.size]<=peak)this.tail=(this.tail+this.size-1)%this.size;
    this.peaks[this.tail]=peak;this.indices[this.tail]=n;this.tail=(this.tail+1)%this.size;
    const maximum=this.peaks[this.head],target=maximum>this.ceiling?this.ceiling/maximum:1;
    this.gain=target<this.gain?target:target+(this.gain-target)*this.release;
    const at=(n-this.delay+this.size)%this.size;
    this.outL=n<this.delay?0:Math.max(-this.ceiling,Math.min(this.ceiling,this.left[at]*this.gain));
    this.outR=n<this.delay?0:Math.max(-this.ceiling,Math.min(this.ceiling,this.right[at]*this.gain));
  }
}
