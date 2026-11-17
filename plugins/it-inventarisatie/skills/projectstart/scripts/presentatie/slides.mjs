// De tien slides van de kick-off, gevuld uit het dossier (spec 5.2).
// Opmaak: de klassen uit Marts verkoopdeck (deck.css). Veel van die regels zijn
// gescoped op Marts slide-id's (#s-hook, #s-deliver, #s-next); daarom krijgen
// onze slides die id's, ook als dat id meer dan eens voorkomt.
// Regel: niets verzinnen. Wat open is, blijft zichtbaar open.
import { esc } from "../../../it-inventarisatie/scripts/rapport/onderdelen.mjs";
import { MART_BESTANDEN } from "./mart-bestanden.mjs";

const OPEN_BESLUIT = "bepalen we vandaag";
const OPEN_PUNT = "nog te bepalen";
const TELEFOON = "053 7400 240";
const NOODNUMMER = "053 7400 450";
const SUPPORT_MAIL = "support@juict.nl";
const SUPPORT_PORTAAL = "klantportaal.juict.nl";

// --- Tekst ---

export function accent(titel) {
  const delen = String(titel).split(/\*([^*]+)\*/);
  if (delen.length !== 3 || /\*/.test(delen[0] + delen[2])) {
    throw new Error(`Titel moet precies één *accentwoord* hebben: ${titel}`);
  }
  return `${esc(delen[0])}<em class="it">${esc(delen[1])}</em>${esc(delen[2])}`;
}

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const TELWOORDEN = ["nul", "één", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht", "negen", "tien", "elf", "twaalf"];
const telwoord = (n) => TELWOORDEN[n] ?? String(n);
const hoofdletter = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "2026-12-15" -> "15 december 2026"; andere tekst blijft zoals hij is.
export function datumTekst(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  return m ? `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]} ${m[1]}` : String(s ?? "");
}
export const maandTekst = (s) => { const [j, m] = s.split("-"); return `${MAANDEN[Number(m) - 1]} ${j}`; };
const maandNummer = (s) => { const [j, m] = s.split("-").map(Number); return j * 12 + m; };

const open = (tekst) => `<span class="k-open">${esc(tekst)}</span>`;
const ofOpen = (waarde, tekst, vorm = (v) => v) => (waarde ? esc(vorm(waarde)) : open(tekst));
const lijst = (items, leeg = "Nog niets vastgelegd.") =>
  items.length ? `<ul class="k-lijst">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p>${open(leeg)}</p>`;
const kop = (eyebrow, titel, stijl = "") =>
  `<div class="eyebrow">${esc(eyebrow)}</div>\n<h2 class="title"${stijl ? ` style="${stijl}"` : ""}>${accent(titel)}</h2>`;
const kaart = (titel, inhoud, verloop) => `<div class="lite-card">${verloop ? `<div class="lite-ico" style="background:var(${verloop});">${ICOON[verloop] ?? ""}</div>` : ""}<h3>${esc(titel)}</h3>${inhoud}</div>`;

// --- Personen ---

function initialen(naam) {
  const delen = String(naam).trim().split(/\s+/).filter(Boolean);
  const eerste = delen[0]?.[0] ?? "";
  const laatste = delen.length > 1 ? delen[delen.length - 1][0] : "";
  return (eerste + laatste).toUpperCase();
}
const voornaam = (naam) => String(naam).trim().split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Foto uit Marts teamfull als die in het deck zit; anders een cirkel met initialen.
export function persoon(naam, { fotoPaden = MART_BESTANDEN, rol, labels = [] } = {}) {
  const pad = `assets/teamfull/${voornaam(naam)}.jpg`;
  const heeftFoto = fotoPaden.some((p) => p === pad || p === `project/${pad}`);
  const beeld = heeftFoto ? `<img src="${esc(pad)}" alt="${esc(naam)}">` : esc(initialen(naam));
  return `<div class="k-persoon"><span class="k-foto">${beeld}</span><span><span class="k-naam">${esc(naam)}</span>`
    + (rol ? `<span class="k-rol">${esc(rol)}</span>` : "")
    + labels.map((l) => `<span class="k-label">${l}</span>`).join("")
    + `</span></div>`;
}

// --- Iconen en route (gekopieerd uit Marts slide 07) ---

const svg = (pad) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pad}</svg>`;
const ICOON = {
  "--grad-azure": svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  "--grad-connectiviteit": svg('<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
  "--grad-managed": svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  "--grad-consultancy": svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>'),
  "--grad-algemeen": svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>'),
  "--grad-security": svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  "--grad-werkplek": svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
};
const STAP_VERLOOP = { "01": "--grad-azure", "02": "--grad-connectiviteit" };
const fasesVan = (d, route) => d.fases.filter((f) => f.route === route);
const faseRegels = (fases) => fases.map((f) => `<p class="k-fasenaam">${esc(f.code)}: ${esc(f.naam)}</p>`).join("");

// --- Slides ---

function opening(d, opties = {}) {
  const titel = "Vandaag beginnen we *samen*.";
  const datum = opties.datum ?? d.kickoffDatum;
  const html = `<div class="photo-bleed photo-bleed-right" style="width:60%; clip-path:none;"><img class="photo-cover" src="assets/img/kantoor-team.jpg" alt="Het JUICT-team op kantoor" style="object-position: 50% center;"></div>
<div class="glow-blob" style="width:560px;height:560px;left:-200px;top:-200px;opacity:0.34;"></div>
<img class="logo-img" src="assets/logo/juict-logo-diapositief.png" alt="JUICT, voor IT" style="height:62px; position:absolute; top:84px; left:120px; z-index:2;">
<div class="hook-text">
  <div class="eyebrow">De eerste stap</div>
  <h1 class="display" style="margin-top:16px;">${accent(titel)}</h1>
  <p class="signoff">Kick-off <strong>${esc(d.klant.weergave)}</strong> · ${ofOpen(datum, "datum nog te bepalen", datumTekst)}</p>
</div>`;
  return { id: "opening", markId: "s-hook", eyebrow: "De eerste stap", titel, html };
}

function route(d) {
  const titel = "We staan bij stap *01*.";
  const stap = (nr, naam, uitleg, extra) => `<div class="rstep">
      <span class="rnode" style="background:var(${STAP_VERLOOP[nr]});"><b>${nr}</b>${ICOON[STAP_VERLOOP[nr]]}</span>
      <div class="rs-txt"><h3>${naam}</h3>${extra}<p>${uitleg}</p>${faseRegels(fasesVan(d, nr))}</div>
    </div>`;
  const html = `<div class="glow-blob" style="width:560px;height:560px;left:-180px;top:-200px;opacity:0.30;"></div>
<div class="ripple-set" style="width:1180px;height:1180px;right:-340px;top:-180px;opacity:0.5;"></div>
${kop("Zo werken we samen", titel, "margin-top:16px; max-width:1500px;")}
<div class="cyc">
  <div class="panel start">
    <span class="p-tag">De start · eenmalig</span>
    <div class="start-steps">
    ${stap("01", "Nulmeting &amp; scan", "IT en de grootste kansen scherp in kaart", '<span class="k-hier">hier staan we</span>')}
    <div class="start-link" aria-hidden="true"><span class="sl-flow"></span></div>
    ${stap("02", "Fundament bouwen", "netwerk, cloud, werkplek &amp; security op orde", "")}
    </div>
  </div>
  <div class="bridge" aria-hidden="true"><span class="br-rail"><span class="br-flow"></span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 6l6 6-6 6"/></svg></div>
  <div class="panel loopp">
    <span class="p-tag loop-tag">Doorlopend partnership</span>
    <div class="loop-body">
      <div class="ring" style="opacity:.35">
        <div class="ring-glow" aria-hidden="true"></div>
        <div class="ring-circle" aria-hidden="true"></div>
        <div class="orbit" aria-hidden="true"><span class="spark"></span></div>
        <div class="rn rn1" style="background:var(--grad-managed);"><b>03</b>${ICOON["--grad-managed"]}</div>
        <div class="rn rn2" style="background:var(--grad-consultancy);"><b>04</b>${ICOON["--grad-consultancy"]}</div>
        <div class="rn rn3" style="background:var(--grad-algemeen);"><b>05</b>${ICOON["--grad-algemeen"]}</div>
        <div class="hub"><div>${svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>')}<b>Samen</b><i>doorlopend</i></div></div>
      </div>
      <div class="legend" style="opacity:.35">
        <div class="leg"><span class="leg-n" style="background:var(--grad-managed);">03</span><div><b>Beheer, monitoring &amp; support</b><i>proactief, geen brandjes blussen</i></div></div>
        <div class="leg"><span class="leg-n" style="background:var(--grad-consultancy);">04</span><div><b>Data &amp; intelligentie</b><i>inzicht, automatisering &amp; AI</i></div></div>
        <div class="leg"><span class="leg-n" style="background:var(--grad-algemeen);">05</span><div><b>Doorontwikkelen</b><i>meten, bijsturen, vooruit</i></div></div>
      </div>
    </div>
    <p class="k-later">Stap 03 tot 05 komen later en vallen niet onder dit project.</p>
  </div>
</div>`;
  return { id: "route", markId: "s-deliver", eyebrow: "Zo werken we samen", titel, html };
}

function team(d) {
  const titel = "Korte lijnen, *vaste* gezichten.";
  const eigen = new Set([d.klant.weergave, d.klant.autotask].map((s) => s.trim().toLowerCase()));
  const sleutel = (s) => s.trim().toLowerCase();
  const vanKlant = d.contacten.filter((c) => eigen.has(sleutel(c.organisatie)));
  const extern = d.contacten.filter((c) => !eigen.has(sleutel(c.organisatie)));
  const partijen = d.externePartijen ?? [];
  const labels = (c) => [c.beslisser && "beslist", c.aanspreekpunt && "dagelijks aanspreekpunt"].filter(Boolean);
  const contact = (c) => persoon(c.naam, { fotoPaden: [], rol: c.rol, labels: labels(c) });
  // Klantcontacten: alleen de naam, plus het dagelijkse aanspreekpunt (feedback Mike).
  const klantContact = (c) => persoon(c.naam, { fotoPaden: [], labels: c.aanspreekpunt ? ["dagelijks aanspreekpunt"] : [] });
  const groep = (kopTekst, inhoud) => `<div class="k-groep"><h3>${esc(kopTekst)}</h3>${inhoud}</div>`;
  // Externe partij uit het dossier, met haar contactpersonen eronder en wie haar aanstuurt (of open).
  const partij = (p) => `<div class="k-partij"><span class="k-naam">${esc(p.naam)}</span><span class="k-rol">${esc(p.rol)}</span>`
    + extern.filter((c) => sleutel(c.organisatie) === sleutel(p.naam)).map(contact).join("")
    + `<span class="k-aansturing">aangestuurd door ${ofOpen(p.aangestuurdDoor, OPEN_BESLUIT)}</span></div>`;
  const losseExternen = extern.filter((c) => !partijen.some((p) => sleutel(p.naam) === sleutel(c.organisatie)));
  const externInhoud = partijen.map(partij).join("")
    + losseExternen.map((c) => persoon(c.naam, { fotoPaden: [], rol: `${c.rol}, ${c.organisatie}`, labels: labels(c) })).join("");
  const html = `<div class="glow-blob" style="width:560px;height:560px;left:-160px;bottom:-220px;opacity:0.34;"></div>
${kop("Vast team", titel, "margin-top:16px;")}
<div class="k-groepen">
  ${groep("JUICT", d.team.map((t) => persoon(t.naam, { rol: t.rol })).join(""))}
  ${groep(d.klant.weergave, vanKlant.length
    ? vanKlant.map(klantContact).join("")
    : `<p>${open("contactpersonen bepalen we vandaag")}</p>`)}
  ${externInhoud ? groep("Externe partijen", externInhoud) : ""}
</div>`;
  return { id: "team", markId: "s-team", eyebrow: "Vast team", titel, html };
}

function doel(d) {
  const titel = "Eén doel, *heldere* grenzen.";
  const hd = d.hardeDatum;
  const html = `<div class="ripple-set" style="width:1180px;height:1180px;right:-420px;top:-520px;opacity:0.4;"></div>
${kop("Waar we voor gaan", titel, "margin-top:16px;")}
<p class="lead" style="margin-top:22px;">${esc(d.doel)}</p>
<div class="lite-grid" style="margin-top:44px;">
  ${kaart("Wat erin zit", lijst(d.scope.inbegrepen))}
  ${kaart("Wat er buiten valt", lijst(d.scope.buiten))}
  ${kaart(`Op ${datumTekst(hd.datum)}`, `<div class="k-regels"><div><b>Klaar:</b> ${esc(hd.watKlaar)}</div><div><b>Nog niet klaar:</b> ${esc(hd.watNiet)}</div></div>`)}
</div>
${d.vervolgOfferte ? `<p class="k-voet">${esc(d.vervolgOfferte)}</p>` : ""}`;
  return { id: "doel", markId: "s-doel", eyebrow: "Waar we voor gaan", titel, html };
}

function veilig(d) {
  const titel = "Wat er al staat, nemen we *mee*.";
  const b = d.extraOnderwerpen.filter((x) => x.soort === "beveiliging");
  const alle = (veld) => b.flatMap((x) => x[veld]);
  const optioneel = b.some((x) => x.optioneel === true);
  const html = `<div class="glow-blob" style="width:560px;height:560px;right:-220px;top:-240px;opacity:0.30;"></div>
${kop("Veilig vanaf dag één", titel, "margin-top:16px;")}
<div class="lite-grid">
  ${kaart("Al geregeld", lijst(alle("geregeld")), "--grad-security")}
  ${kaart(optioneel ? "Dit controleren we (optioneel)" : "Dit controleren we", lijst(alle("controleren")), "--grad-azure")}
  ${kaart("Komt later", lijst(alle("later")), "--grad-consultancy")}
</div>`;
  return { id: "veilig", markId: "s-veilig", eyebrow: "Veilig vanaf dag één", titel, html };
}

function planning(d) {
  const start = fasesVan(d, "01").length ? fasesVan(d, "01") : d.fases;
  const maanden = Math.max(...start.map((f) => maandNummer(f.eind))) - Math.min(...start.map((f) => maandNummer(f.start))) + 1;
  const titel = `Van besluit naar plan in *${telwoord(maanden)}* ${maanden === 1 ? "maand" : "maanden"}.`;
  const fase = (f) => `<div class="k-fase"><span class="k-chip" style="background:var(${STAP_VERLOOP[f.route]});">${esc(f.code)}</span><div><b>${esc(f.naam)}</b><i>${esc(f.start === f.eind ? maandTekst(f.start) : `${maandTekst(f.start)} tot ${maandTekst(f.eind)}`)}</i></div></div>`;
  const paneel = (nr, tag) => `<div class="panel start" style="flex:1;"><span class="p-tag">${tag}</span><div class="k-fases">${fasesVan(d, nr).length ? fasesVan(d, nr).map(fase).join("") : `<p>${open(OPEN_PUNT)}</p>`}</div></div>`;
  const html = `<div class="glow-blob" style="width:560px;height:560px;left:-180px;top:-200px;opacity:0.30;"></div>
${kop("De route in maanden", titel, "margin-top:16px; max-width:1500px;")}
<div class="cyc">
  ${paneel("01", "Stap 01 · nu")}
  <div class="bridge" aria-hidden="true"><span class="br-rail"><span class="br-flow"></span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 6l6 6-6 6"/></svg></div>
  ${paneel("02", "Stap 02 · daarna")}
</div>
<p class="k-voet">Migratieplan klaar: ${d.migratieplan?.datum ? `<b>${esc(datumTekst(d.migratieplan.datum))}</b>` : open(OPEN_PUNT)}<span class="k-sep">·</span>Harde datum: <b>${esc(datumTekst(d.hardeDatum.datum))}</b></p>
${[d.vervolgOfferte, d.gebruikersimpact, d.overgangBeheer].filter(Boolean).map((t) => `<p class="k-voet" style="margin-top:8px;">${esc(t)}</p>`).join("\n")}`;
  return { id: "planning", markId: "s-deliver", eyebrow: "De route in maanden", titel, html };
}

// Een besluit met een ingevuld veld `besluit` is genomen en staat er als besluit, niet als open punt.
const isBesloten = (b) => typeof b.besluit === "string" && b.besluit.trim() !== "";

function besluiten(d) {
  const n = d.besluiten.length;
  const titel = n === 1 ? "Eén keuze bepaalt het *tempo*." : `${hoofdletter(telwoord(n))} keuzes bepalen het *tempo*.`;
  const verloop = ["--grad-connectiviteit", "--grad-consultancy", "--grad-security", "--grad-azure", "--grad-managed"];
  const stap = (b, i) => `<div class="s8-step" style="--i:${i};">
      <div class="s8-ico" style="background:var(${verloop[i % verloop.length]});"><span class="k-nr">${i + 1}</span></div>
      <div class="s8-step-t">${esc(b.vraag)}</div>
      <div class="s8-step-d k-regels" style="max-width:none;">
        ${isBesloten(b)
    ? `<div><b>Besluit:</b> ${esc(b.besluit.trim())}</div>${b.beslisser ? `\n        <div><b>Besloten door:</b> ${esc(b.beslisser)}</div>` : ""}`
    : `<div><b>Wie beslist:</b> ${ofOpen(b.beslisser, OPEN_BESLUIT)}</div>
        <div><b>Uiterlijk:</b> ${ofOpen(b.uiterlijk, OPEN_BESLUIT, datumTekst)}</div>
        <div><b>Als het vandaag niet lukt:</b> ${esc(b.alsNiet)}</div>`}
      </div>
    </div>`;
  const html = `<div class="glow-blob" style="width:520px;height:520px;left:-200px;bottom:-220px;opacity:0.32;"></div>
<div class="s8-text" style="max-width:none; padding-left:0; margin-top:0;">
  <div class="eyebrow">Fase 0</div>
  <h2 class="title s8-title" style="max-width:1500px;">${accent(titel)}</h2>
  ${n ? `<div class="s8-flow" data-step="1" style="max-width:none; gap:26px;">${d.besluiten.map(stap).join("")}</div>`
    : `<p class="lead">Er staan vandaag geen keuzes open.</p>`}
</div>`;
  return { id: "besluiten", markId: "s-next", eyebrow: "Fase 0", titel, html };
}

function aanleveren(d) {
  const titel = "Dit hebben we van *jullie* nodig.";
  const punt = (a) => kaart(a.wat, `<div class="k-regels">
      <div><b>Wie:</b> ${ofOpen(a.wie, OPEN_PUNT)}</div>
      <div><b>Wanneer:</b> ${ofOpen(a.datum, OPEN_PUNT, datumTekst)}</div>
      <div><b>Tijd:</b> ${ofOpen(a.tijd, OPEN_PUNT)}</div>
    </div>`);
  const html = `<div class="glow-blob" style="width:560px;height:560px;right:-220px;top:-240px;opacity:0.30;"></div>
${kop("Jullie aandeel", titel, "margin-top:16px;")}
<p class="lead" style="margin-top:22px;">Op hoofdlijnen. Wat we precies nodig hebben, sturen we jullie na vandaag per mail.</p>
<div class="lite-grid" style="margin-top:40px;">${d.aanleveren.length ? d.aanleveren.map(punt).join("") : kaart("Nog niets", `<p>${open(OPEN_PUNT)}</p>`)}</div>
<p class="k-voet">Technische vragen bespreken we niet hier. Die nemen we mee in die mail.</p>`;
  return { id: "aanleveren", markId: "s-aanleveren", eyebrow: "Jullie aandeel", titel, html };
}

function overleg(d) {
  const titel = "Je weet altijd waar we *staan*.";
  const namen = d.team.map((t) => t.naam);
  const vastTeam = namen.length > 1 ? `${namen.slice(0, -1).join(", ")} en ${namen.at(-1)}` : (namen[0] ?? "korte lijnen");
  const leider = d.team.find((t) => /projectleider/i.test(t.rol));
  const bel = (icoon, kopTekst, sub) => `<div class="bel">${svg(icoon)}<span><b>${kopTekst}</b><i>${esc(sub)}</i></span></div>`;
  const html = `<div class="glow-blob" style="width:560px;height:560px;left:-180px;top:-200px;opacity:0.30;"></div>
<div class="ripple-set" style="width:1180px;height:1180px;right:-340px;top:-180px;opacity:0.5;"></div>
${kop("Altijd op de hoogte", titel, "margin-top:16px; max-width:1500px;")}
<div class="lite-grid" style="margin-top:44px;">
  ${kaart("Overleg", `<p>${esc(d.overleg.ritme)}</p>`, "--grad-azure")}
  ${kaart("Vast aanspreekpunt", `<p>${esc(d.overleg.aanspreekpunt)}</p>`, "--grad-connectiviteit")}
  ${kaart("Als het schuurt", `<p>${esc(d.overleg.escalatie)}</p>`, "--grad-consultancy")}
</div>
${d.overleg.verzoekenControle ? `<p class="k-voet"><b>Verzoeken controleren:</b> ${esc(d.overleg.verzoekenControle)}</p>` : ""}
<p class="k-voet" style="margin-top:18px; font-size:19px;">Kanaal: ${d.overleg.kanaal ? `<b>${esc(d.overleg.kanaal)}</b>` : open(OPEN_BESLUIT)}<span class="k-sep">·</span>Support: <b>${SUPPORT_MAIL}</b> en <b>${SUPPORT_PORTAAL}</b><span class="k-sep">·</span>Noodnummer <b>${NOODNUMMER}</b>, alleen bij urgente storingen (daar kunnen extra kosten aan zitten)</p>
<div class="belofte">
  <div class="bel-label">Wat je aan JUICT hebt</div>
  <div class="bel-grid">
    ${bel('<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>', "Eén partner", leider ? `${leider.naam}, ${leider.rol.toLowerCase()}` : "van werkplek tot AI")}
    ${bel('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', "Proactief", "vóór je het merkt opgelost")}
    ${bel('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12c.5.5 1 1.5 1 2h6c0-.5.5-1.5 1-2a7 7 0 0 0-4-12z"/>', "Meedenkend", "met je business")}
    ${bel('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', "Vast team", vastTeam)}
  </div>
</div>`;
  return { id: "overleg", markId: "s-deliver", eyebrow: "Altijd op de hoogte", titel, html };
}

function afgesproken(d) {
  const titel = "Dit doen we *samen*.";
  const rij = (wat, wie) => `<li><span>${esc(wat)}</span><b>${wie}</b></li>`;
  // Alleen de volgende stappen; besluiten en aanleverpunten staan al op slide 7 en 8 (feedback Mike).
  const eerste = d.aanleveren[0];
  const rijen = [
    rij("Mail met de afspraken van vandaag en wat we van jullie nodig hebben", "JUICT"),
    ...(eerste ? [rij(eerste.wat, ofOpen(eerste.wie, OPEN_PUNT))] : []),
    rij("Start van de inventarisatie", "JUICT"),
  ];
  const html = `<div class="photo-bleed photo-bleed-right"><img class="photo-cover" src="assets/img/handshake.jpg" alt="Handen schudden" style="object-position: 34% center;"></div>
<div class="glow-blob" style="width:520px;height:520px;left:-200px;bottom:-220px;opacity:0.32;"></div>
<div class="s8-text" style="padding-left:0; margin-top:0;">
  <div class="eyebrow">Zo gaan we verder</div>
  <h2 class="title s8-title">${accent(titel)}</h2>
  ${rijen.length ? `<ul class="k-afspraken">${rijen.join("")}</ul>` : ""}
  <p class="k-voet">Volgend overleg: ${d.overleg.volgende ? `<b>${esc(datumTekst(d.overleg.volgende))}</b>` : open(OPEN_BESLUIT)}<span class="k-sep">·</span>${esc(d.overleg.ritme)}</p>
  <p class="contact">${svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>').replace("<svg ", '<svg style="width:20px;height:20px;vertical-align:-3px;margin-right:8px;stroke:#FF6B86;" ')}<b>${TELEFOON}</b><span class="c-sep">·</span>juict.nl</p>
  <p class="k-payoff">Tot snel.</p>
</div>`;
  return { id: "afgesproken", markId: "s-next", eyebrow: "Zo gaan we verder", titel, html };
}

export function slides(d, opties = {}) {
  const metBeveiliging = d.extraOnderwerpen.some((x) => x.soort === "beveiliging");
  return [
    opening(d, opties), route(d), team(d), doel(d),
    ...(metBeveiliging ? [veilig(d)] : []),
    planning(d), besluiten(d), aanleveren(d), overleg(d), afgesproken(d),
  ];
}

// Aanvullende opmaak voor wat Marts deck niet heeft (personen, open punten, fases).
export const KICKOFF_CSS = `
.slide[data-kick="team"], .slide[data-kick="doel"], .slide[data-kick="veilig"], .slide[data-kick="planning"],
.slide[data-kick="aanleveren"], .slide[data-kick="overleg"] { justify-content:center; }
#s-deliver[data-kick="planning"] .cyc { flex:0 0 auto; margin-top:48px; }
#s-deliver[data-kick="planning"] .panel { min-height:340px; }
.k-open { display:inline-block; padding:1px 12px; border-radius:999px; border:1px dashed rgba(255,107,134,0.75); color:#FF6B86; font-weight:700; font-style:normal; }
.k-hier { display:inline-block; margin-top:6px; padding:4px 12px; border-radius:999px; background:#fff; color:#002345; font-weight:700; font-size:16px; }
.k-fasenaam { font-size:17px; color:#fff; margin-top:6px; font-weight:600; }
.k-later { position:absolute; left:40px; bottom:26px; font-size:16px; color:rgba(255,255,255,0.55); }
.k-groepen { display:grid; grid-template-columns:repeat(3, 1fr); gap:40px; margin-top:52px; }
.k-groep h3 { font-size:15px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#FF6B86; margin-bottom:24px; }
.k-persoon { display:flex; align-items:center; gap:20px; margin-bottom:24px; }
.k-foto { width:104px; height:104px; border-radius:50%; overflow:hidden; flex-shrink:0; display:grid; place-items:center; border:3px solid #fff; background:var(--grad-algemeen); color:#fff; font-family:var(--font-display); font-weight:800; font-size:32px; box-shadow:0 12px 28px rgba(0,12,30,0.55); }
.k-foto img { width:100%; height:100%; object-fit:cover; display:block; }
.k-naam { display:block; font-family:var(--font-display); font-weight:800; font-size:28px; color:#fff; line-height:1.15; }
.k-rol { display:block; font-size:19px; color:rgba(255,255,255,0.66); margin-top:3px; }
.k-label { display:inline-block; margin:8px 8px 0 0; padding:2px 11px; border-radius:999px; background:rgba(255,107,134,0.16); color:#FF6B86; font-size:14px; font-weight:700; }
.k-lijst { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px; }
.k-lijst li { position:relative; padding-left:22px; font-size:19px; line-height:1.45; color:rgba(255,255,255,0.78); }
.k-lijst li::before { content:""; position:absolute; left:0; top:0.62em; width:9px; height:9px; border-radius:50%; background:#FF6B86; }
.k-regels { display:flex; flex-direction:column; gap:8px; font-size:18px; line-height:1.42; color:rgba(255,255,255,0.74); }
.k-regels b { color:#fff; font-weight:700; }
.k-nr { font-family:var(--font-display); font-weight:800; font-size:24px; color:#fff; }
.k-fases { margin-top:64px; display:flex; flex-direction:column; gap:22px; }
.k-fase { display:flex; align-items:center; gap:22px; }
.k-fase b { display:block; font-family:var(--font-display); font-weight:800; font-size:26px; color:#fff; line-height:1.12; }
.k-fase i { display:block; font-style:normal; font-size:18px; color:rgba(255,255,255,0.66); margin-top:4px; }
.k-chip { width:72px; height:72px; border-radius:50%; flex-shrink:0; display:grid; place-items:center; border:3px solid #fff; color:#fff; font-family:var(--font-display); font-weight:800; font-size:18px; box-shadow:0 12px 28px rgba(0,12,30,0.55); }
.k-voet { margin-top:30px; font-size:20px; line-height:1.5; color:rgba(255,255,255,0.7); }
.k-voet b { color:#fff; }
.k-sep { margin:0 14px; color:rgba(255,255,255,0.35); }
.k-partij { margin-bottom:26px; }
.k-partij .k-persoon { margin:16px 0 0; }
.k-aansturing { display:block; margin-top:10px; font-size:18px; color:rgba(255,255,255,0.7); }
.k-afspraken { list-style:none; padding:0; margin:30px 0 0; display:flex; flex-direction:column; gap:12px; max-width:960px; }
.k-afspraken li { display:flex; justify-content:space-between; gap:28px; padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.12); font-size:19px; line-height:1.4; color:rgba(255,255,255,0.78); }
.k-afspraken li b { color:#fff; font-weight:700; text-align:right; flex-shrink:0; max-width:40%; }
.k-payoff { margin-top:22px; font-family:var(--font-display); font-weight:600; font-size:40px; color:#fff; }
#s-next .contact { margin-top:26px; }
`;
