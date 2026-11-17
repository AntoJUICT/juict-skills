import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { browserPad, meetHtml, meet, splitsTabel } from "./fit-check.mjs";
import { bouwPaginas, pasIn } from "./bouw.mjs";

const voorbeeldPad = fileURLToPath(new URL("../../voorbeeld/rapport.voorbeeld.json", import.meta.url));
const bouwPad = fileURLToPath(new URL("./bouw.mjs", import.meta.url));
const voorbeeld = () => JSON.parse(readFileSync(voorbeeldPad, "utf8"));
const LOGO = { logoPos: "/_blob/pos", logoDia: "/_blob/dia" };

test("splitsTabel: 10 rijen, 3 naar de vervolgpagina", () => {
  const kolommen = ["Naam", "Adres"];
  const rijen = Array.from({ length: 10 }, (_, i) => [`Rij ${i + 1}`, `r${i + 1}@voorbeeldtechniek.nl`]);
  const blokken = [{ type: "p", tekst: "Intro" }, { type: "tabel", kolommen, rijen, breedtes: ["100px", "auto"] }, { type: "p", tekst: "Na" }];
  const { hier, vervolg } = splitsTabel(blokken, 3);
  assert.equal(hier.length, 2);
  assert.deepEqual(hier[0], blokken[0]);
  assert.equal(hier[1].rijen.length, 7);
  assert.deepEqual(hier[1].rijen.at(-1), ["Rij 7", "r7@voorbeeldtechniek.nl"]);
  assert.equal(vervolg[0].type, "tabel");
  assert.deepEqual(vervolg[0].kolommen, kolommen);
  assert.deepEqual(vervolg[0].breedtes, ["100px", "auto"]);
  assert.deepEqual(vervolg[0].rijen.map((r) => r[0]), ["Rij 8", "Rij 9", "Rij 10"]);
  assert.deepEqual(vervolg[1], blokken[2], "blokken na de tabel gaan mee naar de vervolgpagina");
  assert.equal(blokken[1].rijen.length, 10, "invoer blijft ongewijzigd");
});

test("splitsTabel zonder tabel geeft null", () => {
  assert.equal(splitsTabel([{ type: "p", tekst: "x" }], 2), null);
});

test("meetHtml: losse pagina met meetscript, zonder helmet en zonder /_blob-bronnen", () => {
  const pg = bouwPaginas(voorbeeld(), LOGO)[1];
  const m = meetHtml(pg.html);
  assert.ok(m.includes('id="RESULT"'));
  assert.ok(!m.includes("<helmet>") && !m.includes("</helmet>"));
  assert.ok(!m.includes("/_blob"));
  assert.ok(!m.includes("<x-dc>") && !m.includes("support.js"));
  assert.ok(m.includes('data-rol="inhoud"') && m.includes('data-rol="voet"'));
  assert.ok(m.includes("content=") && m.includes("footer="));
});

test("browserPad geeft een string of null", () => {
  const b = browserPad();
  assert.ok(b === null || typeof b === "string");
});

// Nepmeting: elke tabelrij kost 30px, de pagina past bij maximaal 20 rijen.
function nepMeet(paginas) {
  return Promise.resolve(paginas.map(({ bestand, html }) => {
    if (!html.includes('data-rol="voet"')) return { bestand, inhoud: null, footer: null, tabel: 0, over: false };
    const rijen = (html.match(/<tr>/g) || []).length - 1;
    const tekstVol = html.includes("HEEL VEEL TEKST");
    const inhoud = 400 + Math.max(rijen, 0) * 30 + (tekstVol ? 2000 : 0);
    return { bestand, inhoud, footer: 1065, tabel: Math.max(rijen, 0) * 30, over: inhoud > 1065 - 12 };
  }));
}

const metRijen = (n) => {
  const r = voorbeeld();
  r.bijlage.secties = [{ ...r.bijlage.secties[0], rijen: Array.from({ length: n }, (_, i) => {
    const nr = String(i + 1).padStart(2, "0");
    return { naam: `Medewerker ${nr}`, adres: `mw${nr}@voorbeeldtechniek.nl`, licentie: "Business Premium", voorstel: "behouden" };
  }) }];
  return r;
};

test("pasIn splitst een lange bijlage tot alles past en nummert de pagina's opnieuw", async () => {
  const { paginas, rondes } = await pasIn(metRijen(60), LOGO, { meetFn: nepMeet });
  assert.ok(rondes <= 6);
  const metingen = await nepMeet(paginas);
  assert.ok(metingen.every((m) => !m.over), JSON.stringify(metingen.filter((m) => m.over)));
  const bijlagen = paginas.filter((p) => /Bijlage-1/.test(p.bestand));
  assert.ok(bijlagen.length >= 3, bijlagen.map((p) => p.bestand).join(", "));
  assert.ok(bijlagen.slice(1).every((p) => p.html.includes("Bijlage, deel 1, vervolg")));
  assert.ok(bijlagen.slice(1).every((p) => !p.html.includes("vervolg, vervolg")));
  for (const p of bijlagen) assert.ok(p.html.includes(">Accounts</h1>"), "zelfde titel");
  for (const p of bijlagen) assert.ok(p.html.includes(">Nog nodig?</th>"), "zelfde kolommen");
  const alleRijen = bijlagen.flatMap((p) => [...p.html.matchAll(/Medewerker (\d\d)/g)].map((m) => m[1]));
  assert.deepEqual(alleRijen, Array.from({ length: 60 }, (_, i) => String(i + 1).padStart(2, "0")));
  paginas.forEach((p, i) => {
    if (i === 0) return;
    assert.match(p.bestand, new RegExp(`^${String(i + 1).padStart(2, "0")}-[A-Za-z0-9-]+\\.dc\\.html$`));
    const nr = p.html.match(/<div data-rol="voet"[^>]*>\s*<div>[^<]*<\/div>\s*<div>(\d+)<\/div>/);
    assert.equal(Number(nr[1]), i + 1, p.bestand);
  });
  assert.equal(new Set(paginas.map((p) => p.bestand)).size, paginas.length);
});

test("pasIn stopt bij een te volle pagina zonder tabel", async () => {
  const r = voorbeeld();
  r.samenvatting.zagen = "HEEL VEEL TEKST";
  await assert.rejects(pasIn(r, LOGO, { meetFn: nepMeet }), /^Error: Pagina 02-Samenvatting\.dc\.html is \d+px te vol; maak de tekst korter$/);
});

test("pasIn stopt na 6 rondes", async () => {
  let rondes = 0;
  // De eerste bijlagepagina blijft steeds 1px te vol, de rest past.
  const altijdVol = (paginas) => {
    rondes++;
    return Promise.resolve(paginas.map(({ bestand }) => (bestand.endsWith("-Bijlage-1.dc.html")
      ? { bestand, inhoud: 1054, footer: 1065, tabel: 100, over: true }
      : { bestand, inhoud: 500, footer: 1065, tabel: 0, over: false })));
  };
  await assert.rejects(pasIn(metRijen(60), LOGO, { meetFn: altijdVol }), /Bijlage-1\.dc\.html is 1px te vol/);
  assert.equal(rondes, 6);
});

test("integratie: voorbeeld met 60 bijlage-rijen past na --fit", { skip: !browserPad(), timeout: 600000 }, async () => {
  const uit = mkdtempSync(join(tmpdir(), "rapport-fit-"));
  try {
    const pad = join(uit, "rapport.json");
    writeFileSync(pad, JSON.stringify(metRijen(60)));
    const res = spawnSync(process.execPath, [bouwPad, "--rapport", pad, "--uit", uit, "--logo-pos", "/_blob/a", "--logo-dia", "/_blob/b", "--fit"], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    const map = join(uit, "project");
    const paginas = readdirSync(map).filter((f) => f.endsWith(".dc.html")).sort()
      .map((bestand) => ({ bestand, html: readFileSync(join(map, bestand), "utf8") }));
    const metingen = await meet(paginas, browserPad());
    assert.ok(metingen.every((m) => m.over === false), JSON.stringify(metingen.filter((m) => m.over)));
    assert.ok(metingen.filter((m) => m.inhoud !== null).length >= 1);
    assert.ok(paginas.filter((p) => /Bijlage-1/.test(p.bestand)).length >= 2);
  } finally {
    rmSync(uit, { recursive: true, force: true });
  }
});
