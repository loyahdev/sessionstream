import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudioBuffer} from '../server/audio-buffer.mjs';
import {tonePacket,parsePacket} from '../server/protocol.mjs';
for(const rate of [44100,48000,96000,192000])test(`native stereo FIFO survives 60 seconds of 2048-frame DAW bursts at ${rate} Hz`,()=>{
  const b=new AudioBuffer();let next=0,seq=0,heard=false;
  for(let ms=0;ms<60000;ms+=10){
    while(next<=ms){for(let i=0;i<8;i++){const packet=tonePacket(seq++,256,rate);b.push(packet,parsePacket(packet));}next+=2048/rate*1000;}
    const {samples}=b.render();heard ||= samples.some(v=>Math.abs(v)>100);
  }
  assert(heard);assert.equal(b.underruns,0);assert.equal(b.trims,0);assert(b.stats().bufferMs<120);
});
test('native FIFO rejects duplicate packets, bounds stalls and resets before restart',()=>{
  const b=new AudioBuffer();for(let i=0;i<200;i++){const p=tonePacket(i);b.push(p,parsePacket(p));}
  assert(b.trims>0);const before=b.write;const packet=tonePacket(199);b.push(packet,parsePacket(packet));assert.equal(b.write,before);
  b.reset();assert(b.render().samples.every(v=>v===0));
});
