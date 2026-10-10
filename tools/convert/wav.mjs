// tools/convert/wav.mjs: 16-bit PCM WAV (RIFF) encoder for decoded sound.

/** Mono 16-bit little-endian PCM samples (Int16Array) at `rate` Hz to WAV bytes. */
export function encodeWav(samples, rate, channels = 1) {
  const dataBytes = samples.length * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVEfmt ', 8, 'latin1');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'latin1');
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(samples[i], 44 + i * 2);
  return out;
}
