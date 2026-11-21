import test from 'node:test';
import assert from 'node:assert/strict';
import {tonePacket} from '../server/protocol.mjs';
const processors=new Map();globalThis.sampleRate=48000;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){}};}};
globalThis.registerProcessor=(name,processor)=>processors.set(name,processor);
await import('../web/pcm-worklet.mjs');
const Player=processors.get('session-pcm'),Safety=processors.get('session-safety');
function packet(seq,frames=256,rate=48000){const p=tonePacket(seq,frames,rate);return p.buffer.slice(p.byteOffset,p.byteOffset+p.byteLength);}
test('buffer starvation increases bounded target, fades, and resumes stereo',()=>{
  const player=new Player({processorOptions:{targetMs:90}});let seq=0;
  for(let i=0;i<20;i++)player.push(packet(seq++));
  let audible=false;
  for(let block=0;block<100;block++){
    const output=[new Float32Array(128),new Float32Array(128)];player.process([],[output]);audible ||= output[0].some(x=>Math.abs(x)>.01);
    assert(output.every(channel=>channel.every(Number.isFinite)));
  }
  assert(audible);assert.equal(player.underruns,1);assert.equal(player.effectiveTargetMs,110);
  for(let i=0;i<30;i++)player.push(packet(seq++));
  const output=[new Float32Array(128),new Float32Array(128)];player.process([],[output]);assert(player.primed);assert(output[0].some(x=>x!==0));
  player.reset();assert.equal(player.effectiveTargetMs,90);
});
test('final output worklet limits post-volume spikes, preserves channels and handles absent input',()=>{
  const safety=new Safety();let heard=false;
  for(let n=0;n<10;n++){
    const input=[new Float32Array(128).fill(20),new Float32Array(128).fill(5)],out=[new Float32Array(128),new Float32Array(128)];safety.process([input],[out]);
    assert(out[0].every(x=>Math.abs(x)<=10**(-1/20)+1e-6));heard ||= out[0].some(x=>x>.1);
    for(let i=0;i<128;i++)assert(Math.abs(out[1][i]-out[0][i]*.25)<1e-6);
  }
  assert(heard);safety.process([] ,[[new Float32Array(128),new Float32Array(128)]]);
});
test('adaptive reservoir stops repeated starvation under 150 ms periodic delivery stalls',()=>{
  const player=new Player({processorOptions:{targetMs:90}});let sequence=0,next=0;
  for(let t=0;t<60000;t+=128/48){
    const phase=t%1000;
    if(!(phase>=300&&phase<450))while(next<=t){player.push(packet(sequence++));next+=256/48;}
    player.process([],[[new Float32Array(128),new Float32Array(128)]]);
  }
  assert(player.underruns<=5,`Repeated underruns: ${player.underruns}`);assert.equal(player.trimmed,0);assert(player.effectiveTargetMs<=190);
});
