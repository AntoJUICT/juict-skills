// Minimale zip-lezer/-schrijver (alleen node:zlib). Bedoeld voor .docx/.pptx-sjablonen:
// leest via de central directory (dus ook zips met data descriptors zoals Word ze schrijft),
// bewaart de volgorde van de entries en slaat map-entries over.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

export function leesZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Geen geldige zip (end of central directory ontbreekt).");
  const aantal = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const uit = new Map();
  for (let n = 0; n < aantal; n++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error("Beschadigde zip (central directory).");
    const vlag = buf.readUInt16LE(p + 8), methode = buf.readUInt16LE(p + 10);
    const gecomprimeerd = buf.readUInt32LE(p + 20), lengte = buf.readUInt32LE(p + 24);
    const naamLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), comLen = buf.readUInt16LE(p + 32);
    const lokaal = buf.readUInt32LE(p + 42);
    const naam = buf.subarray(p + 46, p + 46 + naamLen).toString(vlag & 0x800 ? "utf8" : "latin1");
    p += 46 + naamLen + extraLen + comLen;
    if (naam.endsWith("/")) continue;
    if (buf.readUInt32LE(lokaal) !== LOC) throw new Error(`Beschadigde zip (local header van ${naam}).`);
    const start = lokaal + 30 + buf.readUInt16LE(lokaal + 26) + buf.readUInt16LE(lokaal + 28);
    const ruw = buf.subarray(start, start + gecomprimeerd);
    let data;
    if (methode === 0) data = Buffer.from(ruw);
    else if (methode === 8) data = inflateRawSync(ruw);
    else throw new Error(`Compressiemethode ${methode} wordt niet ondersteund (${naam}).`);
    if (data.length !== lengte) throw new Error(`Beschadigde zip (lengte van ${naam}).`);
    uit.set(naam, data);
  }
  return uit;
}

export function schrijfZip(bestanden) {
  const delen = [], cd = [];
  let pos = 0;
  for (const [naam, data] of bestanden) {
    const nb = Buffer.from(naam, "utf8");
    const comp = data.length ? deflateRawSync(data) : Buffer.alloc(0);
    const methode = data.length ? 8 : 0;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOC, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(methode, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(CEN, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(methode, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28);
    c.writeUInt32LE(pos, 42);
    delen.push(lh, nb, comp); cd.push(c, nb);
    pos += 30 + nb.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0); eocd.writeUInt16LE(bestanden.size, 8); eocd.writeUInt16LE(bestanden.size, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(pos, 16);
  return Buffer.concat([...delen, cdBuf, eocd]);
}
