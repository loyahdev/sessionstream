// STRM channel order: L, R, C, LFE, Ls, Rs, Lrs, Rrs (JUCE 7.1).
export const channelLayouts=Object.freeze({1:'Mono',2:'Stereo',6:'5.1',8:'7.1'});
export function pcmInfo(raw){
 const bytes=raw instanceof Uint8Array?raw:new Uint8Array(raw),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.byteLength<24||v.getUint32(0,true)!==0x4d525453)return null;
 const sequence=v.getUint32(4,true),rate=v.getUint32(8,true),frames=v.getUint16(12,true),channels=v.getUint16(14,true),encoding=v.getUint32(20,true),width=encoding===1?4:encoding===2?2:encoding===3?3:0;
 if(!width||![44100,48000,88200,96000,176400,192000].includes(rate)||!Object.hasOwn(channelLayouts,channels)||frames<1||frames>256||v.byteLength!==24+frames*channels*width)return null;
 return {sequence,rate,frames,channels,encoding,width,source:v.getUint32(16,true),view:v};
}
export function pcmSample(v,offset,encoding){
 if(encoding===1){const n=v.getFloat32(offset,true);return Number.isFinite(n)?n:0;}
 if(encoding===2)return v.getInt16(offset,true)/32768;
 let n=v.getUint8(offset)|(v.getUint8(offset+1)<<8)|(v.getUint8(offset+2)<<16);if(n&0x800000)n-=0x1000000;return n/8388608;
}
export function convertPCM(raw,depth=32){
 const info=pcmInfo(raw);if(!info)throw Error('Invalid PCM audio.');
 const encoding=depth===32?1:depth===16?2:depth===24?3:0;if(!encoding)throw Error('Unsupported PCM bit depth.');
 if(info.encoding===encoding)return raw;
 const width=depth/8,out=new Uint8Array(24+info.frames*info.channels*width),v=new DataView(out.buffer),bytes=raw instanceof Uint8Array?raw:new Uint8Array(raw);
 out.set(bytes.subarray(0,24));v.setUint32(20,encoding,true);
 for(let i=0;i<info.frames*info.channels;i++){const sample=pcmSample(info.view,24+i*info.width,info.encoding),at=24+i*width;
  if(depth===32)v.setFloat32(at,sample,true);
  else if(depth===16)v.setInt16(at,Math.max(-32768,Math.min(32767,Math.round(sample*32768))),true);
  else{const n=Math.max(-8388608,Math.min(8388607,Math.round(sample*8388608)));v.setUint8(at,n&255);v.setUint8(at+1,(n>>8)&255);v.setUint8(at+2,(n>>16)&255);}
 }
 return out;
}
// Explicit stereo audition for devices that cannot open the source layout.
// LFE is omitted. Surround channels are attenuated by -3 dB.
export function stereoSample(samples,channels,out=[0,0]){
 if(channels===1){out[0]=out[1]=samples[0];return out;}if(channels===2){out[0]=samples[0];out[1]=samples[1];return out;}
 const k=Math.SQRT1_2;out[0]=samples[0]+k*(samples[2]+samples[4]+(channels===8?samples[6]:0));out[1]=samples[1]+k*(samples[2]+samples[5]+(channels===8?samples[7]:0));return out;
}
