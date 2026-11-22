export function formatPacket(sequence,channels=2,rate=48000,source=54321,frames=240){
 const b=Buffer.alloc(24+frames*channels*4);b.write('STRM');b.writeUInt32LE(sequence>>>0,4);b.writeUInt32LE(rate,8);b.writeUInt16LE(frames,12);b.writeUInt16LE(channels,14);b.writeUInt32LE(source,16);b.writeUInt32LE(1,20);
 for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++)b.writeFloatLE(.04*(ch+1)*Math.sin(2*Math.PI*(220+ch*110)*(sequence*frames+i)/rate),24+(i*channels+ch)*4);return b;
}
