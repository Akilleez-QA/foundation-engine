// tools/convert/archive.mjs: list and extract members of two 1990s game data archive layouts, written independently
// from what community reconstructions document about them:
//
//   layout 1 (big-endian, directory first): u32 directory count, 12 reserved bytes, the directory names (u8 length +
//            bytes), then per directory a u32 file count, 12 reserved bytes and per file a name (u8 length + bytes),
//            u32 flags, u32 offset, u32 size, u32 packed size (0 = stored); packed members are LZSS blocks
//   layout 2 (little-endian, directory last): the file ends with u32 directory size and u32 archive size (which must
//            equal the file size); the directory holds u32 count and per file u32 name length + name, u8 flags
//            (bit 0 = zlib), u32 size, u32 packed size, u32 offset
//
// Names are normalised as the reconstructions do: lower case, `\` separators, a leading `.\` dropped. Extraction is
// bounded by the declared size (zlib output limited to it exactly; LZSS by the same rule).
import {inflateSync} from 'node:zlib';
import {decodeLzssBlocks} from './lzss.mjs';

const MAX_MEMBERS = 1 << 16;

export function normaliseName(name) {
  let s = name.replace(/\//g, '\\').toLowerCase();
  while (s.startsWith('.\\')) s = s.slice(2);
  while (s.includes('\\.\\')) s = s.replace(/\\\.\\/g, '\\');
  if (s === '.') s = '';
  return s;
}

function reader(bytes, little) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = n => {
    if (at + n > bytes.length) throw Error(`archive directory ends early at byte ${at}`);
  };
  return {
    seek(p) {
      if (p < 0 || p > bytes.length) throw Error(`archive offset ${p} is outside the file`);
      at = p;
    },
    get at() {
      return at;
    },
    u8() {
      need(1);
      return bytes[at++];
    },
    u32() {
      need(4);
      const x = v.getUint32(at, little);
      at += 4;
      return x;
    },
    name(len) {
      need(len);
      const b = bytes.subarray(at, at + len);
      at += len;
      for (const c of b) if (c > 0x7e || c < 0x20) throw Error('archive member name is not printable ASCII');
      return Buffer.from(b).toString('latin1');
    },
  };
}

function layout1(bytes) {
  const r = reader(bytes, false);
  const dirCount = r.u32();
  if (dirCount === 0 || dirCount > 4096) throw Error(`directory count ${dirCount} is implausible`);
  r.seek(16);
  const dirs = [];
  for (let i = 0; i < dirCount; i++) dirs.push(normaliseName(r.name(r.u8())));
  const members = [];
  for (const dir of dirs) {
    const count = r.u32();
    r.seek(r.at + 12);
    if (members.length + count > MAX_MEMBERS) throw Error(`more than ${MAX_MEMBERS} members`);
    for (let i = 0; i < count; i++) {
      const base = normaliseName(r.name(r.u8()));
      r.u32(); // flags
      const offset = r.u32(),
        size = r.u32(),
        packed = r.u32();
      members.push({
        name: dir ? `${dir.replace(/\\$/, '')}\\${base}` : base,
        offset,
        size,
        packed,
        method: packed ? 'lzss' : 'stored',
      });
    }
  }
  return {layout: 1, members};
}

function layout2(bytes) {
  if (bytes.length < 12) throw Error('too short for an archive');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dirSize = v.getUint32(bytes.length - 8, true),
    total = v.getUint32(bytes.length - 4, true);
  if (total !== bytes.length) throw Error('the archive size in the trailer does not match the file size');
  if (dirSize > total - 8) throw Error('the directory is larger than the archive');
  const r = reader(bytes, true);
  r.seek(total - dirSize - 8);
  const count = r.u32();
  if (count > MAX_MEMBERS) throw Error(`more than ${MAX_MEMBERS} members`);
  const members = [];
  for (let i = 0; i < count; i++) {
    const len = r.u32();
    if (len > 1024) throw Error('archive member name longer than 1,024 bytes');
    const name = normaliseName(r.name(len));
    const packedFlag = r.u8() & 1;
    const size = r.u32(),
      packedSize = r.u32(),
      offset = r.u32();
    members.push({name, offset, size, packed: packedFlag ? packedSize : 0, method: packedFlag ? 'zlib' : 'stored'});
  }
  return {layout: 2, members};
}

/** The archive's members ({name, offset, size, packed, method}); the layout is detected. */
export function readArchive(bytes) {
  const errors = [];
  for (const parse of [layout2, layout1]) {
    try {
      const a = parse(bytes);
      for (const m of a.members) {
        const span = m.packed || m.size;
        if (m.offset + span > bytes.length) throw Error(`member ${m.name} lies outside the archive`);
      }
      return a;
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw Error(`not a recognised archive (${errors.join('; ')})`);
}

/** One member's bytes. `maxBytes` bounds the declared size before anything is decompressed. */
export function extractMember(bytes, archive, name, {maxBytes = 1 << 28} = {}) {
  const key = normaliseName(name);
  const m = archive.members.find(x => x.name === key);
  if (!m) throw Error(`no member ${name} in the archive`);
  if (m.size > maxBytes) throw Error(`member ${name} declares ${m.size} bytes, above ${maxBytes}`);
  if (m.method === 'stored') return Uint8Array.from(bytes.subarray(m.offset, m.offset + m.size));
  const packed = bytes.subarray(m.offset, m.offset + m.packed);
  if (m.method === 'lzss') return decodeLzssBlocks(packed, m.size, {maxOutput: maxBytes});
  let out;
  try {
    out = inflateSync(packed, {maxOutputLength: Math.max(1, m.size)});
  } catch (e) {
    throw Error(
      `member ${name}: zlib data is corrupt or larger than its declared ${m.size} bytes (${e.code ?? e.message})`,
    );
  }
  if (out.length !== m.size) throw Error(`member ${name} inflates to ${out.length} bytes, not the declared ${m.size}`);
  return new Uint8Array(out);
}
