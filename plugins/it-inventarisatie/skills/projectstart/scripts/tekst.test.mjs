import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { emlNaarTekst, docxNaarTekst, bronNaarTekst } from "./tekst.mjs";
import { schrijfZip } from "./zip.mjs";

const hier = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => join(hier, "fixtures", n);

test("doorgestuurde qp-1252-mail houdt accenten en en-dash", () => {
  const r = emlNaarTekst(readFileSync(fixture("doorgestuurd-qp-1252.eml")));
  assert.equal(r.onderwerp, "FW: Offerte – integratie");
  assert.match(r.van, /Jan de Vries/);
  assert.match(r.aan, /Mike Voorbeeld/);
  assert.match(r.tekst, /één van mijn collega's/);
  assert.match(r.tekst, /coördinatie – kun je/);
  assert.match(r.tekst, /Van: .*\nVerzonden:/);
  assert.match(r.tekst, /Techniek B\.V\./); // soft line break midden in woord hersteld
  assert.doesNotMatch(r.tekst, /HTML-versie/);
});

test("base64-utf8-mail decodeert", () => {
  const r = emlNaarTekst(readFileSync(fixture("base64-utf8.eml")));
  assert.match(r.tekst, /Hi Mart,/);
  assert.match(r.tekst, /besteld – zeg/);
  assert.equal(r.onderwerp, "Laptops en printers – bestelling");
});

test("html-only mail wordt tot tekst gestript", () => {
  const eml = "Subject: x\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hallo&nbsp;wereld</p><p>Tweede &amp; laatste</p>";
  const r = emlNaarTekst(Buffer.from(eml));
  assert.match(r.tekst, /Hallo wereld\nTweede & laatste/);
});

test("docxNaarTekst geeft alinea's", () => {
  const xml = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Eerste &amp; regel</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Twee </w:t></w:r><w:r><w:tab/><w:t>delen</w:t></w:r></w:p><w:p/></w:body></w:document>';
  const docx = schrijfZip(new Map([["word/document.xml", Buffer.from(xml)]]));
  assert.equal(docxNaarTekst(docx), "Eerste & regel\nTwee \tdelen");
});

test("bronNaarTekst: pdf geeft null, eml en docx via extensie", () => {
  const map = mkdtempSync(join(tmpdir(), "tekst-"));
  try {
    writeFileSync(join(map, "a.pdf"), "%PDF");
    assert.equal(bronNaarTekst(join(map, "a.pdf")), null);
    assert.match(bronNaarTekst(fixture("base64-utf8.eml")), /Hi Mart,/);
    assert.match(bronNaarTekst(fixture("base64-utf8.eml")), /^Onderwerp: /m);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("CLI schrijft .txt naast het origineel", () => {
  const map = mkdtempSync(join(tmpdir(), "tekst-"));
  try {
    writeFileSync(join(map, "7-mail – één.eml"), readFileSync(fixture("base64-utf8.eml")));
    writeFileSync(join(map, "8-x.pdf"), "%PDF");
    execFileSync(process.execPath, [join(hier, "tekst.mjs"), map]);
    assert.match(readFileSync(join(map, "7-mail – één.eml.txt"), "utf8"), /Hi Mart,/);
    assert.equal(existsSync(join(map, "8-x.pdf.txt")), false);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

// Outlook is niet overal beschikbaar: alleen draaien met PROJECTSTART_MSG_TEST=<pad naar een eigen .msg>.
test("msg-naar-tekst.ps1 leest een .msg via Outlook", { skip: !process.env.PROJECTSTART_MSG_TEST }, () => {
  assert.ok(existsSync(join(hier, "msg-naar-tekst.ps1")));
  assert.ok(bronNaarTekst(process.env.PROJECTSTART_MSG_TEST).length > 0);
});

test("main zonder map zet exitCode 2 en beeindigt het proces niet", async () => {
  const { main } = await import("./tekst.mjs");
  const oud = process.exitCode;
  const fout = console.error;
  console.error = () => {};
  try {
    main(undefined);
    assert.equal(process.exitCode, 2);
  } finally {
    console.error = fout;
    process.exitCode = oud;
  }
});
