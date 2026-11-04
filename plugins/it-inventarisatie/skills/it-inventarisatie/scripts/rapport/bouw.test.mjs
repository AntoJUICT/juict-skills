import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bouwPaginas, canvasJson, schrijf } from "./bouw.mjs";
import { esc, veiligeHtml } from "./onderdelen.mjs";

const voorbeeldPad = fileURLToPath(new URL("../../voorbeeld/rapport.voorbeeld.json", import.meta.url));
const bouwPad = fileURLToPath(new URL("./bouw.mjs", import.meta.url));
const voorbeeld = () => JSON.parse(readFileSync(voorbeeldPad, "utf8"));
const LOGO = { logoPos: "/_blob/pos", logoDia: "/_blob/dia" };
const EM_DASH = String.fromCharCode(0x2014);
const EURO = String.fromCharCode(0x20ac);
const tekstVan = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("eerste pagina is het voorblad, daarna de rest in leesvolgorde", () => {
  const r = voorbeeld();
  const p = bouwPaginas(r, LOGO);
  assert.equal(p[0].bestand, "Main.dc.html");
  // voorblad + samenvatting + stand + opvalt, doel, stappenplan, uren, open vragen + een pagina per bijlagesectie
  assert.equal(p.length, 1 + 1 + r.stand.length + 5 + r.bijlage.secties.length);
  p.slice(1).forEach((x, i) => assert.match(x.bestand, new RegExp(`^${String(i + 2).padStart(2, "0")}-[A-Za-z0-9-]+\\.dc\\.html$`)));
  const titels = p.map((x) => x.titel);
  assert.equal(titels[1], "Samenvatting");
  assert.equal(titels[2], r.stand[0].titel);
  assert.ok(titels.indexOf("Uren") > titels.indexOf("Stappenplan"));
  assert.ok(titels.indexOf("Open vragen") > titels.indexOf("Uren"));
  assert.equal(new Set(p.map((x) => x.bestand)).size, p.length);
});

test("elke pagina is een Claude Design-artboard", () => {
  for (const { bestand, html } of bouwPaginas(voorbeeld(), LOGO)) {
    assert.ok(html.includes('<script src="./support.js"></script>'), bestand);
    assert.ok(html.includes("class Component extends DCLogic"), bestand);
    assert.ok(html.includes('"$preview":{"width":794,"height":1123}'), bestand);
    assert.ok(html.includes("<x-dc>") && html.includes("<helmet>"), bestand);
    assert.ok(html.includes("Libre+Franklin"), bestand);
    assert.ok(!html.includes(EM_DASH), `${bestand} bevat een em-dash`);
    assert.ok(!html.includes("{{"), `${bestand} bevat {{`);
    assert.ok(!html.includes(EURO), `${bestand} bevat een euroteken`);
  }
});

test("gradient alleen op het voorblad, logo's via de meegegeven url's", () => {
  const [voorblad, ...rest] = bouwPaginas(voorbeeld(), LOGO);
  assert.ok(voorblad.html.includes("linear-gradient(25deg, #002345 25%, #b33259 50%, #ff3862 75%)"));
  assert.ok(voorblad.html.includes('src="/_blob/dia"'));
  assert.ok(!voorblad.html.includes('data-rol="voet"'), "voorblad heeft geen footer");
  for (const x of rest) {
    assert.ok(!x.html.includes("linear-gradient"), x.bestand);
    assert.ok(x.html.includes('src="/_blob/pos"'), x.bestand);
  }
});

test("footer bevat datum en paginanummer", () => {
  const r = voorbeeld();
  bouwPaginas(r, LOGO).forEach((x, i) => {
    if (i === 0) return;
    const voet = x.html.match(/<div data-rol="voet"[^>]*>\s*<div>([^<]*)<\/div>\s*<div>(\d+)<\/div>/);
    assert.ok(voet, `${x.bestand} heeft geen footer`);
    assert.equal(voet[1], `JUICT, ${r.datum}`);
    assert.equal(Number(voet[2]), i + 1);
  });
});

test("rapporttekst wordt ge-escaped, alleen <b> en <br> blijven staan", () => {
  const r = voorbeeld();
  r.samenvatting.zagen = "Een <script>alert(1)</script> en <b>vet</b> & meer<br>regel";
  const html = bouwPaginas(r, LOGO)[1].html;
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("<b>vet</b>"));
  assert.ok(html.includes("&amp; meer<br>regel"));
});

test("esc en veiligeHtml", () => {
  assert.equal(esc('a & <b> "c"'), "a &amp; &lt;b&gt; &quot;c&quot;");
  assert.equal(veiligeHtml("<b>x</b><br><br/><i>y</i>"), "<b>x</b><br><br>&lt;i&gt;y&lt;/i&gt;");
  assert.equal(veiligeHtml('<b onclick="x">z</b>'), "&lt;b onclick=&quot;x&quot;&gt;z</b>");
});

test("lege secties leveren geen pagina op", () => {
  const r = voorbeeld();
  r.openVragen = [];
  const p = bouwPaginas(r, LOGO);
  assert.ok(!p.some((x) => x.titel === "Open vragen"));
  assert.equal(p.length, bouwPaginas(voorbeeld(), LOGO).length - 1);
  r.bijlage.secties = [];
  assert.ok(!bouwPaginas(r, LOGO).some((x) => x.bestand.includes("Bijlage")));
});

test("urenpagina: subtotalen, projectmanagement, totaal en alleen nodig, zonder bedragen", () => {
  const uren = bouwPaginas(voorbeeld(), LOGO).find((x) => x.titel === "Uren");
  assert.ok(uren);
  const t = tekstVan(uren.html);
  assert.match(t, /Subtotaal\s+105\b/);
  assert.match(t, /Subtotaal\s+26\b/);
  assert.match(t, /Projectmanagement, ongeveer 10%: 13 uur/);
  assert.match(t, /Totaal: 144 uur/);
  assert.match(t, /ongeveer 116 uur/);
  for (const k of ["Fase", "Wat jullie daarna hebben", "Rekenbasis", "Uren"]) assert.ok(t.includes(k), k);
  assert.ok(t.includes("(nodig)") && t.includes("(keuze, kan later)"));
  assert.ok(t.includes("Zo komen we tot deze uren"));
  for (const z of voorbeeld().uren.toelichting) assert.ok(t.includes(z), z);
  for (const n of voorbeeld().uren.nietInbegrepen) assert.ok(t.includes(n), n);
  assert.ok(!uren.html.includes(EURO));
  assert.ok(!/Bedrag|tarief/i.test(t));
});

test("bijlage toont vakjes ja/nee of de keuzelabels", () => {
  const p = bouwPaginas(voorbeeld(), LOGO).filter((x) => x.bestand.includes("Bijlage"));
  assert.equal(p.length, 2);
  assert.ok(p[0].html.includes("table-layout: fixed"));
  assert.match(tekstVan(p[0].html), /ja\s+nee/);
  assert.match(tekstVan(p[1].html), /Intune\s+Telefoon/);
});

test("canvasJson: een board per pagina in leesvolgorde", () => {
  const p = bouwPaginas(voorbeeld(), LOGO);
  const nu = new Date("2026-11-04T10:00:00.123Z");
  const c = canvasJson(p, nu, "IT-inventarisatie Voorbeeld");
  assert.equal(c.v, 3);
  assert.deepEqual(c.createdOnFiles, { v: 1, at: "2026-11-04T10:00:00Z" });
  assert.equal(c.title, "IT-inventarisatie Voorbeeld");
  assert.deepEqual(c.order, p.map((x) => x.bestand));
  assert.equal(Object.keys(c.boards).length, p.length);
  p.forEach((x, i) => {
    const b = c.boards[x.bestand];
    assert.deepEqual(b, { x: (i % 4) * 874, y: Math.floor(i / 4) * 1243, w: 794, h: 1123, title: `${i + 1}. ${x.titel}`, paper: "a4" });
  });
});

test("schrijf zet de pagina's en canvas.json in <root>/project", () => {
  const root = mkdtempSync(join(tmpdir(), "rapport-"));
  try {
    const p = bouwPaginas(voorbeeld(), LOGO);
    const geschreven = schrijf(p, root);
    assert.equal(geschreven.length, p.length + 1);
    for (const x of p) assert.equal(readFileSync(join(root, "project", x.bestand), "utf8"), x.html);
    const c = JSON.parse(readFileSync(join(root, "project", "canvas.json"), "utf8"));
    assert.deepEqual(c.order, p.map((x) => x.bestand));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const cli = (args) => spawnSync(process.execPath, [bouwPad, ...args], { encoding: "utf8" });

test("CLI bouwt het voorbeeld", () => {
  const uit = mkdtempSync(join(tmpdir(), "rapport-cli-"));
  try {
    const res = cli(["--rapport", voorbeeldPad, "--uit", uit, "--logo-pos", "/_blob/a", "--logo-dia", "/_blob/b"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(join(uit, "project", "Main.dc.html")));
    assert.ok(existsSync(join(uit, "project", "canvas.json")));
    assert.ok(readFileSync(join(uit, "project", "02-Samenvatting.dc.html"), "utf8").includes('src="/_blob/a"'));
  } finally {
    rmSync(uit, { recursive: true, force: true });
  }
});

test("CLI weigert een rapport met een wachtwoord in vrije tekst", () => {
  const uit = mkdtempSync(join(tmpdir(), "rapport-cli-"));
  try {
    const r = voorbeeld();
    r.stand[0].blokken[1].tekst = "De switch heeft wachtwoord: geheim123";
    const pad = join(uit, "rapport.json");
    writeFileSync(pad, JSON.stringify(r));
    const res = cli(["--rapport", pad, "--uit", uit, "--logo-pos", "/_blob/a", "--logo-dia", "/_blob/b"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /stand\.0\.blokken\.1\.tekst/);
    assert.ok(!res.stderr.includes("geheim123"));
    assert.ok(!existsSync(join(uit, "project")));
  } finally {
    rmSync(uit, { recursive: true, force: true });
  }
});

test("CLI weigert een logo-url die Git Bash naar een Windows-pad heeft omgezet", () => {
  const res = cli(["--rapport", voorbeeldPad, "--uit", tmpdir(), "--logo-pos", "C:/Program Files/Git/_blob/a", "--logo-dia", "/_blob/b"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /MSYS_NO_PATHCONV=1/);
});

test("CLI zonder verplichte argumenten geeft exit 1", () => {
  const res = cli(["--rapport", voorbeeldPad]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--uit/);
});
