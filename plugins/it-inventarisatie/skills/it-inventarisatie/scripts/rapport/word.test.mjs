import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { wordHtml } from "./word.mjs";

const voorbeeldPad = fileURLToPath(new URL("../../voorbeeld/rapport.voorbeeld.json", import.meta.url));
const wordPad = fileURLToPath(new URL("./word.mjs", import.meta.url));
const voorbeeld = () => JSON.parse(readFileSync(voorbeeldPad, "utf8"));
const aantal = (html, s) => html.split(s).length - 1;

test("wordHtml bevat elke sectiekop van het voorbeeldrapport", () => {
  const r = voorbeeld();
  const html = wordHtml(r);
  const koppen = [
    `IT-inventarisatie ${r.klant}`,
    "Wat we zagen en wat we adviseren",
    ...r.stand.map((s) => s.titel),
    "Wat opvalt",
    "De doelinrichting",
    "Zo pakken we het aan",
    "Uren per fase",
    "Wat we nog van jullie nodig hebben",
    ...r.bijlage.secties.map((s) => s.titel),
  ];
  for (const kop of koppen) assert.ok(html.includes(kop), `kop ontbreekt: ${kop}`);
});

test("elke sectie na het voorblad begint met een pagina-einde", () => {
  const r = voorbeeld();
  const html = wordHtml(r);
  const verwacht = 1 + r.stand.length + 1 + 1 + 1 + 1 + 1 + r.bijlage.secties.length; // samenvatting, stand, opvalt, doel, plan, uren, vragen, bijlage
  assert.equal(aantal(html, "page-break-before"), verwacht);
});

test("tekst wordt geescaped", () => {
  const r = voorbeeld();
  r.samenvatting.zagen = "Let op <script>alert(1)</script> hier";
  r.klant = "Voorbeeld <script>x</script> B.V.";
  const html = wordHtml(r);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("bijlage: open rijen tonen vakjes, beantwoorde rijen het antwoord", () => {
  const r = voorbeeld();
  r.bijlage.secties[0].rijen[0].antwoord = "Ja, houden";
  const html = wordHtml(r);
  assert.ok(html.includes("Ja, houden"));
  assert.ok(html.includes("&#9744; ja") && html.includes("&#9744; nee"));
  assert.ok(html.includes("&#9744; Intune") && html.includes("&#9744; Telefoon"));
});

test("geen sectie voor lege onderdelen", () => {
  const r = voorbeeld();
  r.opvalt = [];
  delete r.doel;
  r.openVragen = [];
  const html = wordHtml(r);
  assert.ok(!html.includes("Wat opvalt"));
  assert.ok(!html.includes("De doelinrichting"));
  assert.ok(!html.includes("Wat we nog van jullie nodig hebben"));
  assert.ok(html.includes("Uren per fase"));
});

test("CLI schrijft html en zet process.exitCode bij fouten", () => {
  const map = mkdtempSync(join(tmpdir(), "word-"));
  try {
    const uit = join(map, "r.html");
    const ok = spawnSync(process.execPath, [wordPad, "--rapport", voorbeeldPad, "--uit", uit], { encoding: "utf8" });
    assert.equal(ok.status, 0);
    assert.ok(readFileSync(uit, "utf8").includes("Voorbeeld Techniek B.V."));
    assert.equal(spawnSync(process.execPath, [wordPad], { encoding: "utf8" }).status, 2);
    const kapot = join(map, "kapot.json");
    writeFileSync(kapot, "{}");
    const fout = join(map, "fout.html");
    assert.equal(spawnSync(process.execPath, [wordPad, "--rapport", kapot, "--uit", fout], { encoding: "utf8" }).status, 1);
    assert.ok(!existsSync(fout));
  } finally { rmSync(map, { recursive: true, force: true }); }
});
