import test from 'node:test';
import assert from 'node:assert/strict';
import {StereoPeakLimiter} from '../web/peak-limiter.mjs';
import {AudioBuffer} from '../server/audio-buffer.mjs';
import {tonePacket,parsePacket} from '../server/protocol.mjs';
for(const rate of [44100,48000,96000,192000])test(`linked limiter bounds sudden spikes and invalid samples at ${rate} Hz`,()=>{
  const limiter=new StereoPeakLimiter(rate),ceiling=10**(-1/20);let heard=false;
  for(let i=0;i<rate;i++){
    let l=.1*Math.sin(i*.1),r=l*.25;
    if(i===1000||i===2000){l=100;r=25;}
    if(i===3000){l=Infinity;r=NaN;}
    limiter.sample(l,r);
    assert(Number.isFinite(limiter.outL)&&Number.isFinite(limiter.outR));
    assert(Math.abs(limiter.outL)<=ceiling+1e-7&&Math.abs(limiter.outR)<=ceiling+1e-7);
    if(i>limiter.delay){heard ||= Math.abs(limiter.outL)>.01;assert(Math.abs(limiter.outR-limiter.outL*.25)<1e-7);}
  }
  assert(heard);limiter.reset();limiter.sample(0,0);assert.equal(limiter.outL,0);
});
test('limiter preserves ordinary audio exactly apart from lookahead delay',()=>{
  const limiter=new StereoPeakLimiter();
  for(let i=0;i<2000;i++){limiter.sample(.2,.1);assert.equal(limiter.outL,i<limiter.delay?0:.2);assert.equal(limiter.outR,i<limiter.delay?0:.1);}
});
test('native sender protects float PCM before 16-bit conversion',()=>{
  const buffer=new AudioBuffer();
  for(let seq=0;seq<30;seq++){
    const packet=tonePacket(seq);for(let i=0;i<256;i++){packet.writeFloatLE(20,24+i*8);packet.writeFloatLE(5,28+i*8);}buffer.push(packet,parsePacket(packet));
  }
  const {samples}=buffer.render();assert(samples.some(x=>x>0));assert(samples.every(x=>Math.abs(x)<=Math.ceil(32767*10**(-1/20))));
});
test('loss concealment uses previous packet size instead of always inserting 256 frames',()=>{
  const buffer=new AudioBuffer();for(const seq of [0,2]){const p=tonePacket(seq,64);buffer.push(p,parsePacket(p));}assert.equal(buffer.write,192);
});
