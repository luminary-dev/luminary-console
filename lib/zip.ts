// Minimal ZIP writer for the weekly backup — no dependency needed for "a few
// small JSON files in one archive". Entries are DEFLATE-compressed via
// node:zlib (raw deflate = zip method 8) with a hand-rolled CRC-32 (node's
// zlib.crc32 only exists on newer runtimes). Produces a plain ZIP readable by
// every unarchiver: [local header + data]* + central directory + end record.
import { deflateRawSync } from "node:zlib";

// Standard CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320), table-driven.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  // `& 0xff` keeps the table index inside CRC_TABLE's 256 entries and `i` is
  // bounded by the loop, so neither fallback is reachable.
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS date/time (zip's timestamp format), local time is fine for a backup.
function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

export type ZipFile = { name: string; data: string | Buffer };

/** Build a ZIP archive (deflate, no zip64 — fine for < 4 GB of JSON). */
export function buildZip(files: ZipFile[]): Buffer {
  const { date, time } = dosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const crc = crc32(raw);
    const deflated = deflateRawSync(raw, { level: 9 });
    // Store uncompressed if deflate doesn't help (tiny files).
    const method = deflated.length < raw.length ? 8 : 0;
    const data = method === 8 ? deflated : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra/comment/disk/attrs stay 0
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDir, end]);
}
