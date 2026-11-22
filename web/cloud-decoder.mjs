import {pcmInfo} from './pcm-format.mjs';
import {OpusDecoder} from 'opus-decoder';
export class CloudAudioDecoder {
 constructor(){this.decoder=new OpusDecoder({sampleRate:48000,channels:2,streamCount:1,coupledStreamCount:1});this.mono=new OpusDecoder({sampleRate:48000,channels:1,streamCount:1,coupledStreamCount:0});this.ready=Promise.all([this.decoder.ready,this.mono.ready]);this.lastSequence=null;this.closed=false;}
 decode(raw){
  if(this.closed)throw Error('Cloud decoder is closed.');
  const packet=raw instanceof Uint8Array?raw:new Uint8Array(raw);
  const pcm=pcmInfo(packet);if(pcm){if(this.lastSequence!==null){const distance=(pcm.sequence-this.lastSequence)>>>0;if(distance===0||distance>0x7fffffff)return [];}this.lastSequence=pcm.sequence;return [packet.slice().buffer];}
  if(packet.byteLength<17||packet.byteLength>4112)throw Error('Invalid compressed Cloud audio.');
  const v=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
  if(v.getUint32(0,false)!==0x53534f31||v.getUint16(8,true)!==480||![1,2].includes(packet[10])||packet[11]!==1||v.getUint32(12,true)!==packet.byteLength-16)throw Error('Invalid Cloud audio format.');
  const sequence=v.getUint32(4,true);
  if(this.lastSequence!==null){const distance=(sequence-this.lastSequence)>>>0;if(distance===0||distance>0x7fffffff)return [];}
  const channels=packet[10],decoded=(channels===1?this.mono:this.decoder).decodeFrame(packet.subarray(16));
  if(decoded.errors.length||decoded.samplesDecoded!==480||decoded.sampleRate!==48000||decoded.channelData.length!==channels)throw Error('Cloud audio could not be decoded.');
  this.lastSequence=sequence;
  // Feed the existing bounded browser PCM player in constant 240-frame blocks.
  // Gaps in sequence preserve its packet-loss and jitter recovery behavior.
  return [0,1].map(part=>{const pcm=new ArrayBuffer(24+240*channels*4),out=new DataView(pcm);out.setUint32(0,0x4d525453,true);out.setUint32(4,(sequence*2+part)>>>0,true);out.setUint32(8,48000,true);out.setUint16(12,240,true);out.setUint16(14,channels,true);out.setUint32(20,1,true);for(let i=0;i<240;i++){for(let ch=0;ch<channels;ch++)out.setFloat32(24+(i*channels+ch)*4,decoded.channelData[ch][part*240+i],true);}return pcm;});
 }
 async reset(){this.lastSequence=null;await Promise.all([this.decoder.reset(),this.mono.reset()]);}
 close(){if(this.closed)return;this.closed=true;this.decoder.free();this.mono.free();}
}
