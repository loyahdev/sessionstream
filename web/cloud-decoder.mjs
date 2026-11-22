import {OpusDecoder} from 'opus-decoder';
export class CloudAudioDecoder {
 constructor(){this.decoder=new OpusDecoder({sampleRate:48000,channels:2,streamCount:1,coupledStreamCount:1});this.ready=this.decoder.ready;this.lastSequence=null;this.closed=false;}
 decode(raw){
  if(this.closed)throw Error('Cloud decoder is closed.');
  const packet=raw instanceof Uint8Array?raw:new Uint8Array(raw);
  if(packet.byteLength<17||packet.byteLength>4112)throw Error('Invalid compressed Cloud audio.');
  const v=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
  if(v.getUint32(0,false)!==0x53534f31||v.getUint16(8,true)!==480||packet[10]!==2||packet[11]!==1||v.getUint32(12,true)!==packet.byteLength-16)throw Error('Invalid Cloud audio format.');
  const sequence=v.getUint32(4,true);
  if(this.lastSequence!==null){const distance=(sequence-this.lastSequence)>>>0;if(distance===0||distance>0x7fffffff)return [];}
  const decoded=this.decoder.decodeFrame(packet.subarray(16));
  if(decoded.errors.length||decoded.samplesDecoded!==480||decoded.sampleRate!==48000||decoded.channelData.length!==2)throw Error('Cloud audio could not be decoded.');
  this.lastSequence=sequence;
  // Feed the existing bounded browser PCM player in constant 240-frame blocks.
  // Gaps in sequence preserve its packet-loss and jitter recovery behavior.
  return [0,1].map(part=>{const pcm=new ArrayBuffer(24+240*8),out=new DataView(pcm);out.setUint32(0,0x4d525453,true);out.setUint32(4,(sequence*2+part)>>>0,true);out.setUint32(8,48000,true);out.setUint16(12,240,true);out.setUint16(14,2,true);out.setUint32(20,1,true);for(let i=0;i<240;i++){out.setFloat32(24+i*8,decoded.channelData[0][part*240+i],true);out.setFloat32(28+i*8,decoded.channelData[1][part*240+i],true);}return pcm;});
 }
 async reset(){this.lastSequence=null;await this.decoder.reset();}
 close(){if(this.closed)return;this.closed=true;this.decoder.free();}
}
