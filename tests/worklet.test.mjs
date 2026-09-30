import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {tonePacket} from '../server/protocol.mjs';
async function player(targetMs=10){let C;class Base{constructor(){this.port={postMessage(){}};}}
const context=vm.createContext({AudioWorkletProcessor:Base,sampleRate:48000,Float32Array,DataView,Math,Number,registerProcessor:(n,c)=>C=c});
vm.runInContext(await readFile(new URL('../web/pcm-worklet.mjs',import.meta.url),'utf8'),context);return new C({processorOptions:{targetMs}});}
function push(p,b){p.push(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
function render(p){const l=new Float32Array(128),r=new Float32Array(128);p.process([] ,[[l,r]]);return [l,r];}
test('stereo playback retains separate channels and recovers from underruns',async()=>{
  const p=await player();for(let i=0;i<4;i++)push(p,tonePacket(i));const [l,r]=render(p);
  assert(l.some(v=>Math.abs(v)>.01));assert(r.some(v=>Math.abs(v)>.01));assert.notDeepEqual(l,r);
  for(let i=0;i<20;i++)render(p);assert(p.underruns>0);
  for(let i=4;i<10;i++)push(p,tonePacket(i));assert(render(p)[0].some(v=>Math.abs(v)>.01));
});
test('queue stays bounded under a stalled consumer, duplicates do not enter the buffer',async()=>{
  const p=await player();for(let i=0;i<1000;i++)push(p,tonePacket(i));assert(p.write-p.read<48000*.1);assert(p.trimmed>0);
  const before=p.write;push(p,tonePacket(999));assert.equal(p.write,before);
  push(p,tonePacket(1,256,44100,77));assert.equal(p.rate,44100);assert.equal(p.write,256);
});
test('non-finite input cannot poison playback',async()=>{
  const p=await player();const b=tonePacket(0);for(let i=24;i<b.length;i+=4)b.writeFloatLE(NaN,i);push(p,b);push(p,tonePacket(1));push(p,tonePacket(2));
  for(const ch of render(p))assert(ch.every(Number.isFinite));
});
