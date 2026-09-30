export const HEADER_BYTES = 24;
export function parsePacket(b) {
  if (b.length < HEADER_BYTES || b.toString('ascii', 0, 4) !== 'STRM') return null;
  const sequence = b.readUInt32LE(4), rate = b.readUInt32LE(8);
  const frames = b.readUInt16LE(12), channels = b.readUInt16LE(14);
  if (b.readUInt32LE(20) !== 1 || ![44100, 48000, 88200, 96000, 176400, 192000].includes(rate)
      || channels !== 2 || frames < 1 || frames > 256 || b.length !== HEADER_BYTES + frames * 8) return null;
  return {sequence, rate, frames, channels, source: b.readUInt32LE(16)};
}
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
