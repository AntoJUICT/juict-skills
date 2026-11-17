#!/usr/bin/env node
// Bronbestanden (eml, msg, docx) naar platte tekst. PDF geeft null: Claude leest PDF's zelf met de Read-tool.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leesZip } from "./zip.mjs";

const hier = dirname(fileURLToPath(import.meta.url));

function decodeer(bytes, charset) {
  const cs = String(charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  try { return new TextDecoder(cs === "iso-8859-1" || cs === "us-ascii" ? "windows-1252" : cs).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

function qpBytes(tekst) {
  const s = tekst.replace(/[ \t]+(?=\r?\n)/g, "").replace(/=\r?\n/g, "");
  const uit = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { uit.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else uit.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(uit);
}

export function decodeerWoorden(waarde) {
  const s = String(waarde ?? "").replace(/(\?=)\s+(?==\?)/g, "$1");
  return s.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, tekst) => {
    const bytes = enc.toLowerCase() === "b" ? Buffer.from(tekst, "base64") : qpBytes(tekst.replace(/_/g, " "));
    return decodeer(bytes, cs.split("*")[0]);
  });
}

function splitsKop(tekst) {
  const m = /\r?\n\r?\n/.exec(tekst);
  const kopTekst = m ? tekst.slice(0, m.index) : tekst;
  const body = m ? tekst.slice(m.index + m[0].length) : "";
  const kop = {};
  for (const regel of kopTekst.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = regel.indexOf(":");
    if (i > 0) { const k = regel.slice(0, i).trim().toLowerCase(); if (!(k in kop)) kop[k] = regel.slice(i + 1).trim(); }
  }
  return { kop, body };
}

function param(waarde, naam) {
  const m = new RegExp(`${naam}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(waarde ?? "");
  return m ? (m[1] ?? m[2]) : null;
}

const HTML_ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", eacute: "é", egrave: "è", euml: "ë", ouml: "ö", uuml: "ü" };
function htmlNaarTekst(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return HTML_ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, "\n\n");
}

// Verzamelt de tekstdelen (bijlagen overgeslagen), recursief voor multipart.
function verzamel(tekst, acc = { plain: [], html: [] }) {
  const { kop, body } = splitsKop(tekst);
  const ct = kop["content-type"] ?? "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  if (/^attachment/i.test(kop["content-disposition"] ?? "")) return acc;
  if (type.startsWith("multipart/")) {
    const grens = param(ct, "boundary");
    if (!grens) return acc;
    const esc = grens.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const delen = body.split(new RegExp(`(?:^|\\r?\\n)--${esc}(?:--)?[ \\t]*(?=\\r?\\n|$)`));
    for (const d of delen.slice(1)) if (d.trim()) verzamel(d.replace(/^\r?\n/, ""), acc);
    return acc;
  }
  if (type !== "text/plain" && type !== "text/html") return acc;
  const enc = (kop["content-transfer-encoding"] ?? "7bit").trim().toLowerCase();
  const bytes = enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64")
    : enc === "quoted-printable" ? qpBytes(body) : Buffer.from(body, "latin1");
  (type === "text/html" ? acc.html : acc.plain).push(decodeer(bytes, param(ct, "charset") ?? "utf-8"));
  return acc;
}

export function emlNaarTekst(buf) {
  const tekst = Buffer.from(buf).toString("latin1");
  const { kop } = splitsKop(tekst);
  const { plain, html } = verzamel(tekst);
  const ruw = plain.length ? plain.join("\n") : html.map(htmlNaarTekst).join("\n");
  const h = (k) => decodeerWoorden(kop[k] ?? "");
  return {
    onderwerp: h("subject"), van: h("from"), aan: h("to"), datum: h("date"),
    tekst: ruw.replace(/\r\n?/g, "\n").trim(),
  };
}

const xmlTekst = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
});

export function docxNaarTekst(buf) {
  const xml = leesZip(Buffer.from(buf)).get("word/document.xml");
  if (!xml) throw new Error("word/document.xml ontbreekt in het docx-bestand.");
  const regels = [];
  for (const [, p] of xml.toString("utf8").matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    let regel = "";
    for (const [, t, tab] of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|(<w:tab\s*\/>)|<w:br\s*\/>/g)) {
      regel += t !== undefined ? xmlTekst(t) : tab ? "\t" : " ";
    }
    if (regel.trim()) regels.push(regel);
  }
  return regels.join("\n");
}

function msgNaarTekst(pad) {
  const uit = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(hier, "msg-naar-tekst.ps1"), "-Pad", pad],
    { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  return uit.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
}

const kopRegels = (r) => [`Onderwerp: ${r.onderwerp}`, `Van: ${r.van}`, `Aan: ${r.aan}`, `Datum: ${r.datum}`, "", r.tekst].join("\n");

export function bronNaarTekst(pad) {
  switch (extname(pad).toLowerCase()) {
    case ".eml": return kopRegels(emlNaarTekst(readFileSync(pad)));
    case ".msg": return msgNaarTekst(pad);
    case ".docx": return docxNaarTekst(readFileSync(pad));
    default: return null; // o.a. .pdf: Claude leest die zelf met de Read-tool
  }
}

export function main(map) {
  if (!map) { console.error("Gebruik: tekst.mjs <bronnenmap>"); process.exitCode = 2; return; }
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam);
    if (!statSync(pad).isFile() || naam.toLowerCase().endsWith(".txt")) continue;
    try {
      const tekst = bronNaarTekst(pad);
      if (tekst == null) { console.log(`${naam}: overgeslagen (Claude leest dit bestand zelf)`); continue; }
      writeFileSync(`${pad}.txt`, tekst, "utf8");
      console.log(`${naam}: ${tekst.length} tekens`);
    } catch (e) { console.error(`${naam}: mislukt (${e.message})`); process.exitCode = 1; }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv[2]);
