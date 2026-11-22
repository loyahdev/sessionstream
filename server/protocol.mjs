import {pcmInfo} from '../web/pcm-format.mjs';
export const HEADER_BYTES = 24;
export function parsePacket(b) {const info=pcmInfo(b);if(!info)return null;const {view,...metadata}=info;return metadata;}
export function tonePacket(sequence, frames = 256, rate = 48000, source = 12345) {
  const b = Buffer.alloc(HEADER_BYTES + frames * 8);
  b.write('STRM'); b.writeUInt32LE(sequence >>> 0, 4); b.writeUInt32LE(rate, 8);
  b.writeUInt16LE(frames, 12); b.writeUInt16LE(2, 14); b.writeUInt32LE(source, 16); b.writeUInt32LE(1, 20);
  for (let i = 0; i < frames; i++) {
    const t = (sequence * frames + i) / rate;
    b.writeFloatLE(Math.sin(2 * Math.PI * 440 * t) * .08, 24 + i * 8);
    b.writeFloatLE(Math.sin(2 * Math.PI * 880 * t) * .04, 28 + i * 8);
  }
  return b;
}
