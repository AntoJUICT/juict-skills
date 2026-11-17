import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { leesZip } from "../zip.mjs";
import { vervangAlinea, vulPlanning, pvaUitDossier, vulPva, hoofd } from "./vul.mjs";

const pad = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const VOORBEELD_PAD = pad("../../voorbeeld/dossier.voorbeeld.json");
const template = readFileSync(pad("../../assets/mini-pva-template.docx"));
const voorbeeld = () => JSON.parse(readFileSync(VOORBEELD_PAD, "utf8"));
const docXml = (buf) => leesZip(buf).get("word/document.xml").toString("utf8");
const templateXml = docXml(template);
const tel = (xml, s) => xml.split(s).length - 1;
const tekst = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const planningTabel = (xml) => xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g).find((t) => /Verantwoordelijke/.test(tekst(t)));
const rijen = (tbl) => tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g);

test("alle plaatshouders zijn ingevuld", () => {
  const xml = docXml(vulPva(template, voorbeeld()));
  assert.doesNotMatch(xml, /\{\{/);
  assert.doesNotMatch(tekst(xml), /\}\}/);
});

test("bladwijzers en handtekeningregel blijven", () => {
  const xml = docXml(vulPva(template, voorbeeld()));
  for (const s of ["<w:bookmarkStart", "<w:bookmarkEnd", "<w:pict", "<o:signatureline"]) {
    assert.equal(tel(xml, s), tel(templateXml, s), s);
  }
  assert.ok(tel(templateXml, "<o:signatureline") === 1, "template heeft een handtekeningregel");
});

test("planning: 5 rijen gevuld, rest weg", () => {
  const vijf = [1, 2, 3, 4, 5].map((n) => [`Onderdeel ${n}`, `Deadline ${n}`, n % 2 ? "PM" : "Techniek"]);
  const xml = vulPlanning(templateXml, vijf);
  const tbl = planningTabel(xml);
  assert.equal(rijen(tbl).length, 2 + 5, "kop, tussenrij en 5 rijen");
  assert.doesNotMatch(tbl, /\{\{planning_/);
  const t = tekst(tbl);
  for (const [o, dl, w] of vijf) { assert.match(t, new RegExp(o)); assert.match(t, new RegExp(dl)); assert.match(t, new RegExp(w)); }
  assert.equal(rijen(planningTabel(templateXml)).length, 2 + 25, "template heeft 25 planningsrijen");
});

test("meer dan 25 planningsrijen faalt", () => {
  const veel = Array.from({ length: 26 }, (_, i) => [`Onderdeel ${i}`, "x", "PM"]);
  assert.throws(() => vulPlanning(templateXml, veel), /25/);
  assert.doesNotThrow(() => vulPlanning(templateXml, veel.slice(0, 25)));
});

test("PVA mag bedragen bevatten (intern)", () => {
  const t = tekst(docXml(vulPva(template, voorbeeld())));
  assert.match(t, /€ 100 per uur/);
});

test("vervangAlinea: label vet, rest gewoon, alinea-opmaak blijft", () => {
  const p = '<w:p><w:pPr><w:pStyle w:val="Opsomming"/></w:pPr><w:bookmarkStart w:id="1" w:name="x"/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>{{a}}</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>';
  const uit = vervangAlinea(`<w:body>${p}</w:body>`, "a", { label: "Label:", rest: "tekst & meer" });
  assert.match(uit, /<w:pStyle w:val="Opsomming"\/>/);
  assert.match(uit, /<w:bookmarkStart w:id="1" w:name="x"\/>/);
  assert.match(uit, /<w:bookmarkEnd w:id="1"\/>/);
  assert.match(uit, /<w:r><w:rPr><w:b\/><w:bCs\/><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">Label: <\/w:t><\/w:r>/);
  assert.match(uit, /<w:r><w:rPr><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">tekst &amp; meer<\/w:t><\/w:r>/);
  assert.doesNotMatch(uit, /\{\{a\}\}/);
});

test("vervangAlinea: vette bron-run geeft vet label en een niet-vette rest", () => {
  const p = '<w:p><w:r><w:rPr><w:rStyle w:val="x"/><w:rFonts w:ascii="A"/><w:b/><w:bCs/><w:sz w:val="18"/></w:rPr><w:t>{{a}}</w:t></w:r></w:p>';
  const label = vervangAlinea(p, "a", { label: "L:", rest: "r" });
  assert.match(label, /<w:rPr><w:rStyle w:val="x"\/><w:rFonts w:ascii="A"\/><w:b\/><w:bCs\/><w:sz w:val="18"\/><\/w:rPr><w:t xml:space="preserve">L: </);
  assert.match(label, /<w:rPr><w:rStyle w:val="x"\/><w:rFonts w:ascii="A"\/><w:sz w:val="18"\/><\/w:rPr><w:t xml:space="preserve">r</);
  assert.equal(tel(label, "<w:b/>"), 1);
});

test("template: plaatshouder-runs zijn niet vet (vet komt alleen van een label)", () => {
  const runs = [...templateXml.matchAll(/<w:r>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:t[^>]*>\{\{[^<]*<\/w:t><\/w:r>/g)];
  assert.ok(runs.length > 50);
  for (const m of runs) assert.doesNotMatch(m[1] ?? "", /<w:b\/>|<w:bCs\/>/, m[0]);
});

test("vervangAlinea: plaatshouder verspreid over runs en handtekeningregel blijft", () => {
  const pict = '<w:r><w:pict><v:shape id="s"><o:signatureline issignatureline="t"/></v:shape></w:pict></w:r>';
  const p = `<w:p><w:r><w:t>{{goed</w:t></w:r><w:r><w:t>keuring}}</w:t></w:r>${pict}</w:p>`;
  const uit = vervangAlinea(p, "goedkeuring", "Akkoord");
  assert.match(uit, /Akkoord/);
  assert.ok(uit.includes(pict));
  assert.throws(() => vervangAlinea(p, "bestaatniet", "x"), /bestaatniet/);
});

test("pvaUitDossier: planning uit fases, besluiten en aanleveren met PM, Techniek of Klant", () => {
  const { planning } = pvaUitDossier(voorbeeld());
  const tekstRijen = planning.map((r) => r.join(" | "));
  assert.ok(planning.every((r) => r.length === 3 && r.every((c) => typeof c === "string" && c.trim())));
  assert.ok(planning.every(([, , w]) => /^(PM|Techniek|Klant)\b/.test(w)), tekstRijen.join("\n"));
  assert.ok(tekstRijen.some((r) => /Voorbereiding en inrichting/.test(r) && /Techniek/.test(r)));
  assert.ok(tekstRijen.some((r) => /gedeelde planningsmap/.test(r) && /15 december 2026/.test(r) && /Klant/.test(r)));
  assert.ok(tekstRijen.some((r) => /telefooncentrale/.test(r) && /nog te bepalen/.test(r)));
  assert.ok(tekstRijen.some((r) => /Lijst met alle gebruikers/.test(r) && /1 december 2026/.test(r) && /Klant/.test(r)));
  assert.ok(planning.length <= 25);
});

test("pvaUitDossier: niets verzinnen, ontbrekend wordt 'nog te bepalen'", () => {
  const d = voorbeeld();
  delete d.migratieplan; delete d.vervolgOfferte; delete d.externePartijen;
  d.overleg.volgende = null; d.technischeVragen = []; d.extraOnderwerpen = []; d.scope.buiten = [];
  const t = tekst(docXml(vulPva(template, d)));
  assert.match(t, /nog te bepalen/);
  assert.doesNotMatch(t, /\{\{|\}\}/);
});

test("lange lijsten krijgen extra alinea's, korte lijsten verliezen lege alinea's", () => {
  const d = voorbeeld();
  d.scope.inbegrepen = Array.from({ length: 9 }, (_, i) => `Scope-item ${i + 1}`);
  d.scope.buiten = ["Alleen dit"];
  const xml = docXml(vulPva(template, d));
  const t = tekst(xml);
  for (let i = 1; i <= 9; i++) assert.match(t, new RegExp(`Scope-item ${i}(?!\\d)`));
  assert.ok(t.indexOf("Scope-item 1") < t.indexOf("Scope-item 9"));
  assert.match(t, /Alleen dit/);
  assert.equal(tel(xml, "<w:bookmarkStart"), tel(templateXml, "<w:bookmarkStart"));
});

test("schrijfregels: geen em-dash, BC, M365 of raming", () => {
  const t = tekst(docXml(vulPva(template, voorbeeld())));
  assert.doesNotMatch(t, /—/);
  assert.doesNotMatch(t, /\bBC\b|\bM365\b/);
  assert.doesNotMatch(t, /raming/i);
});

test("ongeldig dossier faalt", () => {
  const d = voorbeeld();
  d.doel = "";
  assert.throws(() => vulPva(template, d), /doel/);
});

test("template bevat geen persoonsgegevens in docProps", () => {
  const z = leesZip(template);
  const core = z.get("docProps/core.xml").toString("utf8");
  assert.match(core, /<dc:creator>JUICT<\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy>JUICT<\/cp:lastModifiedBy>/);
  assert.ok(![...z.keys()].some((k) => k.startsWith("customXml/")));
});

test("CLI: --dossier en --uit schrijven een docx", async () => {
  const map = mkdtempSync(join(tmpdir(), "pva-"));
  try {
    const uit = join(map, "pva.docx");
    const ok = await hoofd(["--dossier", VOORBEELD_PAD, "--uit", uit]);
    assert.equal(ok.code, 0, ok.uitvoer);
    const xml = docXml(readFileSync(uit));
    assert.match(tekst(xml), /Voorbeeld Techniek/);
    const fout = join(map, "fout.json");
    writeFileSync(fout, JSON.stringify({ ...voorbeeld(), doel: "" }));
    const r = await hoofd(["--dossier", fout, "--uit", join(map, "x.docx")]);
    assert.equal(r.code, 2);
    assert.match(r.uitvoer, /doel/);
    const g = await hoofd(["--dossier", VOORBEELD_PAD]);
    assert.equal(g.code, 1);
    assert.match(g.uitvoer, /Gebruik/);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test("xmlEsc haalt in XML verboden stuurtekens weg", async () => {
  const { xmlEsc } = await import("./vul.mjs");
  assert.equal(xmlEsc("a\u000bb\u0001c & <d>"), "abc &amp; &lt;d&gt;");
  assert.equal(xmlEsc("regel\tmet tab\nen nieuwe regel"), "regel\tmet tab\nen nieuwe regel");
});

test("PVA met een stuurteken in de klantnaam blijft geldige XML", () => {
  const d = JSON.parse(readFileSync(VOORBEELD_PAD, "utf8"));
  d.klant.weergave = "Voorbeeld\u000bTechniek";
  const kern = leesZip(vulPva(template, d)).get("docProps/core.xml")?.toString("utf8") ?? "";
  assert.ok(!/\u000b/.test(kern));
});
