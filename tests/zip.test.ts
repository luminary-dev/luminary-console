// The backup archive is hand-assembled byte by byte, so nothing but a real
// parse of the produced bytes proves it. These tests read the archive back the
// way an unarchiver does: end record first, then the central directory, then
// each local header at the offset the central directory claims. An offset that
// is one byte out still "looks like a zip" in a length assertion, and only
// fails when a client tries to open last week's backup.
import { describe, expect, it } from "vitest";
import { crc32 as zlibCrc32, inflateRawSync } from "node:zlib";
import { buildZip, type ZipFile } from "@/lib/zip";
import { atIndex } from "./helpers";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

type ParsedEntry = {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  /** The name as spelled in the local header, which must match the central one. */
  localName: string;
  localMethod: number;
  localCrc: number;
  flags: number;
  dosDate: number;
  dosTime: number;
  /** The raw bytes between the local header and the next entry. */
  payload: Buffer;
};

type ParsedZip = {
  entryCount: number;
  totalEntryCount: number;
  centralDirSize: number;
  centralDirOffset: number;
  entries: ParsedEntry[];
};

/** Read an archive the way an unarchiver does, from the end record inwards. */
function parseZip(zip: Buffer): ParsedZip {
  // No archive comment is ever written, so the end record is the last 22 bytes.
  const endOffset = zip.length - 22;
  expect(endOffset).toBeGreaterThanOrEqual(0);
  expect(zip.readUInt32LE(endOffset)).toBe(END_SIG);

  const entryCount = zip.readUInt16LE(endOffset + 8);
  const totalEntryCount = zip.readUInt16LE(endOffset + 10);
  const centralDirSize = zip.readUInt32LE(endOffset + 12);
  const centralDirOffset = zip.readUInt32LE(endOffset + 16);

  const entries: ParsedEntry[] = [];
  let p = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    expect(zip.readUInt32LE(p)).toBe(CENTRAL_SIG);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressedSize = zip.readUInt32LE(p + 20);
    const uncompressedSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    expect(zip.readUInt32LE(localOffset)).toBe(LOCAL_SIG);
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;

    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      localName: zip.subarray(localOffset + 30, localOffset + 30 + localNameLen).toString("utf8"),
      localMethod: zip.readUInt16LE(localOffset + 8),
      localCrc: zip.readUInt32LE(localOffset + 14),
      flags: zip.readUInt16LE(localOffset + 6),
      dosTime: zip.readUInt16LE(localOffset + 10),
      dosDate: zip.readUInt16LE(localOffset + 12),
      payload: zip.subarray(dataStart, dataStart + compressedSize),
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  // The walk must land exactly on the end record: a short or long central
  // directory means a size field is wrong.
  expect(p).toBe(centralDirOffset + centralDirSize);
  expect(p).toBe(endOffset);

  return { entryCount, totalEntryCount, centralDirSize, centralDirOffset, entries };
}

/** The bytes an entry was built from, whatever storage method was chosen. */
function inflateEntry(entry: ParsedEntry): Buffer {
  return entry.method === 8 ? inflateRawSync(entry.payload) : Buffer.from(entry.payload);
}

// Compressible enough that deflate is a real win, so method 8 is exercised.
const REPETITIVE_JSON = JSON.stringify({
  clients: Array.from({ length: 40 }, (_, i) => ({
    slug: `client-${i}`,
    stage: "quotation",
    currency: "LKR",
  })),
});

describe("archive structure", () => {
  it("writes a valid end record for an archive with no files", () => {
    // The weekly backup can legitimately find nothing to archive, and an empty
    // zip must still open rather than read as a truncated file.
    const zip = buildZip([]);
    expect(zip).toHaveLength(22);

    const parsed = parseZip(zip);
    expect(parsed.entryCount).toBe(0);
    expect(parsed.totalEntryCount).toBe(0);
    expect(parsed.centralDirSize).toBe(0);
    expect(parsed.centralDirOffset).toBe(0);
    expect(parsed.entries).toHaveLength(0);
  });

  it("carries the three signatures an unarchiver looks for", () => {
    const zip = buildZip([{ name: "clients.json", data: REPETITIVE_JSON }]);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from("PK\x03\x04", "latin1"));
    expect(zip.includes(Buffer.from("PK\x01\x02", "latin1"))).toBe(true);
    expect(zip.subarray(zip.length - 22, zip.length - 18)).toEqual(
      Buffer.from("PK\x05\x06", "latin1"),
    );
  });

  it("counts every entry twice over in the end record", () => {
    // Both the "entries on this disk" and "entries in total" fields are read by
    // real unarchivers, and a mismatch makes some of them refuse the archive.
    const files: ZipFile[] = [
      { name: "a.json", data: REPETITIVE_JSON },
      { name: "b.json", data: "{}" },
      { name: "c.json", data: REPETITIVE_JSON },
    ];
    const parsed = parseZip(buildZip(files));
    expect(parsed.entryCount).toBe(3);
    expect(parsed.totalEntryCount).toBe(3);
    expect(parsed.entries.map((e) => e.name)).toEqual(["a.json", "b.json", "c.json"]);
  });

  it("points the central directory at the byte after the last entry", () => {
    // The offset is accumulated by hand while writing, so it is exactly the
    // field most likely to drift as entries are added.
    const files: ZipFile[] = [
      { name: "one.json", data: REPETITIVE_JSON },
      { name: "two.json", data: "x" },
    ];
    const zip = buildZip(files);
    const parsed = parseZip(zip);

    let expectedOffset = 0;
    for (const entry of parsed.entries) {
      expect(entry.localOffset).toBe(expectedOffset);
      expectedOffset += 30 + Buffer.byteLength(entry.name, "utf8") + entry.compressedSize;
    }
    expect(parsed.centralDirOffset).toBe(expectedOffset);
  });

  it("repeats the local header fields in the central directory", () => {
    // The two copies of name, method and CRC are what let an unarchiver seek
    // straight to one member, so they have to agree.
    const parsed = parseZip(
      buildZip([
        { name: "clients.json", data: REPETITIVE_JSON },
        { name: "tiny.txt", data: "x" },
      ]),
    );
    for (const entry of parsed.entries) {
      expect(entry.localName).toBe(entry.name);
      expect(entry.localMethod).toBe(entry.method);
      expect(entry.localCrc).toBe(entry.crc);
      // Flag bit 11 tells the reader the name is UTF-8 rather than CP437.
      expect(entry.flags).toBe(0x0800);
    }
  });

  it("stamps a DOS date matching the day the archive was built", () => {
    const before = new Date();
    const parsed = parseZip(buildZip([{ name: "a.json", data: REPETITIVE_JSON }]));
    const after = new Date();

    const entry = atIndex(parsed.entries, 0);
    const year = (entry.dosDate >> 9) + 1980;
    const month = (entry.dosDate >> 5) & 0x0f;
    const day = entry.dosDate & 0x1f;
    // Comparing against both ends of the call absorbs a midnight rollover.
    const stamped = `${year}-${month}-${day}`;
    const candidates = [before, after].map(
      (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    );
    expect(candidates).toContain(stamped);

    const hour = entry.dosTime >> 11;
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThan(24);
  });
});

describe("entry contents", () => {
  it("round-trips a deflated entry through zlib", () => {
    // The archive claims raw deflate (method 8). If it ever claimed that while
    // writing something else, only an actual inflate would notice.
    const parsed = parseZip(buildZip([{ name: "clients.json", data: REPETITIVE_JSON }]));
    const entry = atIndex(parsed.entries, 0);
    expect(entry.method).toBe(8);
    expect(entry.compressedSize).toBeLessThan(entry.uncompressedSize);
    expect(inflateRawSync(entry.payload).toString("utf8")).toBe(REPETITIVE_JSON);
  });

  it("round-trips several entries of mixed shapes", () => {
    const files: ZipFile[] = [
      { name: "clients.json", data: REPETITIVE_JSON },
      { name: "empty.json", data: "" },
      { name: "tiny.txt", data: "x" },
      { name: "binary.bin", data: Buffer.from([0, 255, 128, 7, 0, 0, 1]) },
      { name: "unicode.txt", data: "සුබ පැතුම්, kâhve" },
    ];
    const parsed = parseZip(buildZip(files));
    expect(parsed.entries).toHaveLength(files.length);

    for (let i = 0; i < files.length; i++) {
      const file = atIndex(files, i);
      const entry = atIndex(parsed.entries, i);
      const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
      expect(entry.name).toBe(file.name);
      expect(entry.uncompressedSize).toBe(raw.length);
      expect(inflateEntry(entry)).toEqual(raw);
    }
  });

  it("accepts a Buffer payload as readily as a string", () => {
    const bytes = Buffer.from([13, 10, 0, 200, 199]);
    const parsed = parseZip(buildZip([{ name: "raw.bin", data: bytes }]));
    const entry = atIndex(parsed.entries, 0);
    expect(entry.uncompressedSize).toBe(5);
    expect(inflateEntry(entry)).toEqual(bytes);
  });

  it("stores rather than deflates when deflate would grow the entry", () => {
    // Deflate adds framing, so a one-byte file comes out larger. Storing it is
    // the documented fallback, and the header must say method 0 to match.
    const parsed = parseZip(buildZip([{ name: "tiny.txt", data: "x" }]));
    const entry = atIndex(parsed.entries, 0);
    expect(entry.method).toBe(0);
    expect(entry.compressedSize).toBe(entry.uncompressedSize);
    expect(entry.payload.toString("utf8")).toBe("x");
  });

  it("writes an empty file entry as a zero-length stored member", () => {
    // An empty state file is normal, and a zero-length entry is where a size or
    // CRC field is most likely to be written as something other than zero.
    const parsed = parseZip(buildZip([{ name: "empty.json", data: "" }]));
    const entry = atIndex(parsed.entries, 0);
    expect(entry.uncompressedSize).toBe(0);
    expect(entry.compressedSize).toBe(0);
    expect(entry.method).toBe(0);
    expect(entry.crc).toBe(0);
    expect(entry.payload).toHaveLength(0);
  });
});

describe("CRC-32", () => {
  it("produces the standard check value", () => {
    // 0xCBF43926 over "123456789" is the published check value for CRC-32,
    // so a wrong polynomial or a missing final inversion shows up here.
    const parsed = parseZip(buildZip([{ name: "check.txt", data: "123456789" }]));
    expect(atIndex(parsed.entries, 0).crc).toBe(0xcbf43926);
  });

  it("agrees with zlib over text, binary and empty content", () => {
    const files: ZipFile[] = [
      { name: "json.json", data: REPETITIVE_JSON },
      { name: "empty.json", data: "" },
      { name: "unicode.txt", data: "සුබ පැතුම්" },
      { name: "binary.bin", data: Buffer.from(Array.from({ length: 256 }, (_, i) => 255 - i)) },
      { name: "high-bytes.bin", data: Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00]) },
    ];
    const parsed = parseZip(buildZip(files));
    for (let i = 0; i < files.length; i++) {
      const file = atIndex(files, i);
      const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
      expect(atIndex(parsed.entries, i).crc).toBe(zlibCrc32(raw));
    }
  });
});

describe("non-ASCII names", () => {
  it("measures names in bytes, not characters, so offsets stay aligned", () => {
    // The name length field is a byte count. Writing a character count would
    // leave every following entry a few bytes short, which is exactly the kind
    // of corruption that only appears once a Sinhala filename is archived.
    const files: ZipFile[] = [
      { name: "සේවාදායකයා.json", data: REPETITIVE_JSON },
      { name: "kâhve-menü.txt", data: "espresso" },
      { name: "plain.json", data: REPETITIVE_JSON },
    ];
    const zip = buildZip(files);
    const parsed = parseZip(zip);

    const wideName = atIndex(files, 0).name;
    expect(Buffer.byteLength(wideName, "utf8")).toBeGreaterThan(wideName.length);

    for (let i = 0; i < files.length; i++) {
      const entry = atIndex(parsed.entries, i);
      expect(entry.name).toBe(atIndex(files, i).name);
      expect(entry.localName).toBe(atIndex(files, i).name);
      // parseZip already asserted the signature at each claimed local offset,
      // so reaching here means every offset survived the wide names.
      expect(zip.readUInt32LE(entry.localOffset)).toBe(LOCAL_SIG);
    }

    const last = atIndex(parsed.entries, files.length - 1);
    expect(parsed.centralDirOffset).toBe(
      last.localOffset + 30 + Buffer.byteLength(last.name, "utf8") + last.compressedSize,
    );
    expect(inflateEntry(last).toString("utf8")).toBe(REPETITIVE_JSON);
  });
});
