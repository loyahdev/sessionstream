import OpusScript from 'opusscript';
import {qualities} from './session-policy.mjs';
export class CloudAudioEncoder {
 constructor(quality='balanced'){
  if(!Object.hasOwn(qualities,quality))throw Error('Invalid Cloud quality preset.');
  this.encoder=new OpusScript(48000,2,OpusScript.Application.AUDIO,{wasm:true});
  this.encoder.encoderCTL(4002,qualities[quality]); // OPUS_SET_BITRATE
  this.encoder.encoderCTL(4010,10); // OPUS_SET_COMPLEXITY
  this.sequence=0;this.closed=false;
 }
 encode(samples){
  if(this.closed)throw Error('Cloud encoder is closed.');
  if(!(samples instanceof Int16Array)||samples.length!==960)throw Error('Cloud audio needs 10 ms of 48 kHz stereo PCM.');
  const opus=this.encoder.encode(Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength),480);
  const packet=new Uint8Array(16+opus.length),view=new DataView(packet.buffer);
  packet.set([83,83,79,49]);view.setUint32(4,this.sequence++,true);view.setUint16(8,480,true);packet[10]=2;packet[11]=1;view.setUint32(12,opus.length,true);packet.set(opus,16);return packet;
 }
 close(){if(this.closed)return;this.closed=true;this.encoder.delete();}
}
