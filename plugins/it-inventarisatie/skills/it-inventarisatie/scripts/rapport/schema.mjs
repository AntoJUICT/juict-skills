// Validatie van rapport.json. Geeft een lijst Nederlandse foutmeldingen; leeg = geldig.
import { findSecretText } from "../geheimen.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isTekst = (v) => typeof v === "string" && v.trim() !== "";
const EM_DASH = String.fromCharCode(0x2014);
const EURO = String.fromCharCode(0x20ac);

export function validateRapport(r) {
  const fouten = [];
  if (!isObj(r)) return ["rapport is geen object"];

  const tekst = (pad, v) => { if (!isTekst(v)) fouten.push(`${pad} ontbreekt`); };
  const lijst = (pad, v, min = 1) => {
    if (!Array.isArray(v) || v.length < min) { fouten.push(`${pad} ontbreekt`); return []; }
    return v;
  };
  const object = (pad, v) => { if (!isObj(v)) { fouten.push(`${pad} ontbreekt`); return {}; } return v; };

  tekst("klant", r.klant);
  tekst("datum", r.datum);
  const op = object("opsteller", r.opsteller);
  for (const k of ["naam", "mail", "telefoon"]) tekst(`opsteller.${k}`, op[k]);
  lijst("lezers", r.lezers).forEach((l, i) => { tekst(`lezers.${i}.naam`, l?.naam); tekst(`lezers.${i}.organisatie`, l?.organisatie); });

  const s = object("samenvatting", r.samenvatting);
  if (s.besluit !== undefined) { tekst("samenvatting.besluit.label", s.besluit?.label); tekst("samenvatting.besluit.tekst", s.besluit?.tekst); }
  tekst("samenvatting.zagen", s.zagen);
  tekst("samenvatting.adviseren", s.adviseren);
  lijst("samenvatting.kerncijfers", s.kerncijfers).forEach((k, i) => ["label", "waarde", "toelichting"].forEach((f) => tekst(`samenvatting.kerncijfers.${i}.${f}`, k?.[f])));
  lijst("samenvatting.stappen", s.stappen).forEach((k, i) => ["stap", "wie"].forEach((f) => tekst(`samenvatting.stappen.${i}.${f}`, k?.[f])));

  lijst("stand", r.stand).forEach((p, i) => {
    tekst(`stand.${i}.titel`, p?.titel);
    tekst(`stand.${i}.kicker`, p?.kicker);
    lijst(`stand.${i}.blokken`, p?.blokken).forEach((b, j) => controleerBlok(`stand.${i}.blokken.${j}`, b, fouten));
  });

  lijst("opvalt", r.opvalt).forEach((o, i) => ["punt", "zien", "doen"].forEach((f) => tekst(`opvalt.${i}.${f}`, o?.[f])));

  const d = object("doel", r.doel);
  tekst("doel.intro", d.intro);
  lijst("doel.principes", d.principes).forEach((p, i) => { tekst(`doel.principes.${i}.titel`, p?.titel); tekst(`doel.principes.${i}.tekst`, p?.tekst); });
  if (d.kaarten !== undefined) lijst("doel.kaarten", d.kaarten).forEach((p, i) => { tekst(`doel.kaarten.${i}.titel`, p?.titel); tekst(`doel.kaarten.${i}.tekst`, p?.tekst); });

  const sp = object("stappenplan", r.stappenplan);
  const maanden = lijst("stappenplan.maanden", sp.maanden);
  tekst("stappenplan.toelichting", sp.toelichting);
  lijst("stappenplan.fases", sp.fases).forEach((f, i) => {
    const pad = `stappenplan.fases.${i}`;
    ["code", "naam", "omschrijving"].forEach((k) => tekst(`${pad}.${k}`, f?.[k]));
    if (f?.pm === true) return;
    if (!Number.isInteger(f?.start) || !Number.isInteger(f?.eind)) { fouten.push(`${pad}: start en eind moeten indexen in maanden zijn`); return; }
    if (f.start < 0 || f.eind > maanden.length) fouten.push(`${pad}: start en eind moeten binnen maanden liggen (0 tot ${maanden.length})`);
    if (f.start >= f.eind) fouten.push(`${pad}: start moet kleiner zijn dan eind`);
  });

  const u = object("uren", r.uren);
  const blokken = lijst("uren.blokken", u.blokken);
  blokken.forEach((b, i) => {
    tekst(`uren.blokken.${i}.titel`, b?.titel);
    if (b?.soort !== "nodig" && b?.soort !== "keuze") fouten.push(`uren.blokken.${i}.soort moet nodig of keuze zijn`);
    lijst(`uren.blokken.${i}.fases`, b?.fases).forEach((f, j) => {
      const pad = `uren.blokken.${i}.fases.${j}`;
      ["fase", "resultaat", "rekenbasis"].forEach((k) => tekst(`${pad}.${k}`, f?.[k]));
      if (typeof f?.uren !== "number" || !(f.uren > 0)) fouten.push(`${pad}.uren moet een positief getal zijn`);
    });
  });
  if (!blokken.some((b) => b?.soort === "nodig")) fouten.push("uren.blokken heeft geen blok met soort nodig");
  if (typeof u.projectmanagementPct !== "number") fouten.push("uren.projectmanagementPct ontbreekt");
  if (!Array.isArray(u.nietInbegrepen)) fouten.push("uren.nietInbegrepen ontbreekt");
  if (!Array.isArray(u.toelichting) || u.toelichting.length !== 3 || !u.toelichting.every(isTekst)) fouten.push("uren.toelichting moet precies drie zinnen bevatten");

  lijst("openVragen", r.openVragen).forEach((v, i) => {
    tekst(`openVragen.${i}.aan`, v?.aan);
    tekst(`openVragen.${i}.rol`, v?.rol);
    lijst(`openVragen.${i}.vragen`, v?.vragen);
  });

  const b = object("bijlage", r.bijlage);
  tekst("bijlage.intro", b.intro);
  lijst("bijlage.secties", b.secties).forEach((sec, i) => {
    tekst(`bijlage.secties.${i}.titel`, sec?.titel);
    if (sec?.kolom5 !== "ja/nee" && !(Array.isArray(sec?.kolom5) && sec.kolom5.length > 0 && sec.kolom5.every(isTekst))) fouten.push(`bijlage.secties.${i}.kolom5 moet ja/nee of een lijst met teksten zijn`);
    if (sec?.nogOpen !== undefined && typeof sec.nogOpen !== "boolean") fouten.push(`bijlage.secties.${i}.nogOpen moet true of false zijn`);
    lijst(`bijlage.secties.${i}.rijen`, sec?.rijen).forEach((rij, j) => {
      ["naam", "adres", "licentie", "voorstel"].forEach((k) => tekst(`bijlage.secties.${i}.rijen.${j}.${k}`, rij?.[k]));
      if (rij?.antwoord !== undefined) tekst(`bijlage.secties.${i}.rijen.${j}.antwoord`, rij.antwoord);
    });
  });

  // Hele document: verboden tekens en patronen.
  const bekijk = (v, pad) => {
    if (typeof v === "string") {
      if (v.includes(EM_DASH)) fouten.push(`${pad}: bevat een em-dash`);
      if (v.includes("{{")) fouten.push(`${pad}: bevat {{`);
      if (v.includes(EURO) || /\bEUR\b/.test(v)) fouten.push(`${pad}: geen bedragen in het rapport, alleen uren`);
      if (/<(?!\/?(b|br)\s*\/?>)[^>]*>/i.test(v)) fouten.push(`${pad}: alleen de tags <b> en <br> zijn toegestaan`);
    } else if (Array.isArray(v)) v.forEach((x, i) => bekijk(x, pad ? `${pad}.${i}` : String(i)));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) bekijk(x, pad ? `${pad}.${k}` : k);
  };
  bekijk(r, "");
  for (const pad of findSecretText(r)) fouten.push(`${pad}: bevat een geheim in vrije tekst`);

  return fouten;
}

function controleerBlok(pad, b, fouten) {
  const t = (p, v) => { if (!isTekst(v)) fouten.push(`${p} ontbreekt`); };
  if (!isObj(b)) { fouten.push(`${pad}: blok ontbreekt`); return; }
  if (b.type === "h2" || b.type === "p") t(`${pad}.tekst`, b.tekst);
  else if (b.type === "tabel") {
    if (!Array.isArray(b.kolommen) || !b.kolommen.length || !b.kolommen.every(isTekst)) fouten.push(`${pad}.kolommen ontbreekt`);
    if (!Array.isArray(b.rijen) || !b.rijen.length) fouten.push(`${pad}.rijen ontbreekt`);
    else b.rijen.forEach((rij, i) => {
      if (!Array.isArray(rij) || rij.length !== b.kolommen?.length || !rij.every((c) => typeof c === "string")) fouten.push(`${pad}.rijen.${i}: aantal cellen komt niet overeen met kolommen`);
    });
    if (b.breedtes !== undefined && (!Array.isArray(b.breedtes) || b.breedtes.length !== b.kolommen?.length)) fouten.push(`${pad}.breedtes moet even lang zijn als kolommen`);
  } else if (b.type === "kaarten") {
    if (!Array.isArray(b.items) || !b.items.length) fouten.push(`${pad}.items ontbreekt`);
    else b.items.forEach((k, i) => { t(`${pad}.items.${i}.titel`, k?.titel); t(`${pad}.items.${i}.tekst`, k?.tekst); });
  } else fouten.push(`${pad}.type moet h2, p, tabel of kaarten zijn`);
}
