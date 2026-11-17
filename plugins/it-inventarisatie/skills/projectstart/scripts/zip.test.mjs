import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { leesZip, schrijfZip } from "./zip.mjs";

test("zip roundtrip", () => {
  const m = new Map([["a.txt", Buffer.from("x")], ["map/b.xml", Buffer.from("<a>".repeat(500))]]);
  const terug = leesZip(schrijfZip(m));
  assert.equal(terug.get("a.txt").toString(), "x");
  assert.equal(terug.get("map/b.xml").toString(), "<a>".repeat(500));
  assert.deepEqual([...terug.keys()], ["a.txt", "map/b.xml"]);
});

test("zip: lege inhoud en unicode-namen", () => {
  const m = new Map([["leeg.txt", Buffer.alloc(0)], ["één.txt", Buffer.from("é")]]);
  const terug = leesZip(schrijfZip(m));
  assert.equal(terug.get("leeg.txt").length, 0);
  assert.equal(terug.get("één.txt").toString(), "é");
});

// Zip zoals Word het schrijft: data descriptor (bit 3, sizes 0 in local header), stored + deflated, map-entry.
function wordAchtigeZip() {
  const items = [
    { naam: "[Content_Types].xml", data: Buffer.from("<Types/>"), methode: 8 },
    { naam: "word/", data: Buffer.alloc(0), methode: 0, map: true },
    { naam: "word/document.xml", data: Buffer.from("<w:document>".repeat(40)), methode: 8 },
    { naam: "docProps/x.txt", data: Buffer.from("opgeslagen"), methode: 0 },
  ];
  const delen = []; const cd = []; let pos = 0;
  for (const it of items) {
    const naam = Buffer.from(it.naam);
    const comp = it.methode === 8 ? deflateRawSync(it.data) : it.data;
    const crc = crc32(it.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    const vlag = it.map ? 0 : 0x08; lh.writeUInt16LE(vlag, 6); lh.writeUInt16LE(it.methode, 8);
    lh.writeUInt16LE(naam.length, 26);
    const dd = it.map ? Buffer.alloc(0) : Buffer.alloc(16);
    if (!it.map) { dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(comp.length, 8); dd.writeUInt32LE(it.data.length, 12); }
    delen.push(lh, naam, comp, dd);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(vlag, 8); c.writeUInt16LE(it.methode, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(it.data.length, 24); c.writeUInt16LE(naam.length, 28); c.writeUInt32LE(pos, 42);
    cd.push(c, naam);
    pos += 30 + naam.length + comp.length + dd.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(items.length, 8); eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(pos, 16);
  return { buf: Buffer.concat([...delen, cdBuf, eocd]), items };
}

test("zip leest een Word-achtige zip (data descriptors, stored + deflated) en bewaart volgorde", () => {
  const { buf } = wordAchtigeZip();
  const m = leesZip(buf);
  assert.deepEqual([...m.keys()], ["[Content_Types].xml", "word/document.xml", "docProps/x.txt"]);
  assert.equal(m.get("word/document.xml").toString(), "<w:document>".repeat(40));
  assert.equal(m.get("docProps/x.txt").toString(), "opgeslagen");
  const again = leesZip(schrijfZip(m));
  assert.deepEqual([...again.keys()], [...m.keys()]);
  assert.equal(again.get("[Content_Types].xml").toString(), "<Types/>");
});
