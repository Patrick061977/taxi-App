#!/usr/bin/env node
// scripts/lohn-aus-hale.js
// Hale EventReport PDF → Lohnabrechnung (Minijob, 40 % Provision brutto)
// Usage: node scripts/lohn-aus-hale.js <EventReport.pdf>
'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PUPPETEER_PATH = path.join(__dirname, '../functions/node_modules/puppeteer-core');
const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Users/Taxi/AppData/Local/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

// ─── Konstanten ───────────────────────────────────────────────────────────────
const PROVISION_RATE    = 0.40;
const MINDESTLOHN       = 12.82;   // €/h (Stand 2025/2026)
const MINIJOB_GRENZE    = 556.00;  // €/Monat
const AG_KV             = 0.13;    // Krankenversicherung AG-Anteil
const AG_RV             = 0.15;    // Rentenversicherung AG-Anteil
const AG_STEUER         = 0.02;    // Pauschale Lohnsteuer
const AG_PAUSCHALE      = AG_KV + AG_RV + AG_STEUER; // 0.30
// Bereitschaft: Pausen > BEREITSCHAFT_GRENZE_MIN gelten als weite Bereitschaft
// → zählen NICHT als vergütungspflichtige Arbeitszeit (nur Mindestlohn-Prüfung)
const BEREITSCHAFT_GRENZE_MIN = 45;
const KM_DURCHSCHNITT_KMH     = 35;
// Lohnmodell: 40% Provision rückwärts in Stunden → × STUNDENSATZ
// + RUFBEREITSCHAFT_SATZ für Pausen >45 Min (weite Bereitschaft)
const STUNDENSATZ              = 13.60; // €/h — Provision ÷ Stundensatz = bezahlte Stunden
const RUFBEREITSCHAFT_SATZ     = 2.50;  // €/h für Pausen >45 Min

const ARBEITGEBER = {
    name:    'Funk Taxi Heringsdorf GbR',
    strasse: 'Bergstraße 7',
    ort:     '17429 Heringsdorf',
};

// ─── PDF → Text ───────────────────────────────────────────────────────────────
function extractPdfText(pdfPath) {
    const pyScript = [
        'import pdfplumber, sys',
        'with pdfplumber.open(sys.argv[1]) as pdf:',
        '    for pg in pdf.pages:',
        '        t = pg.extract_text()',
        '        if t: print(t)',
    ].join('\n');
    const tmp = pdfPath.replace(/\.pdf$/i, '_hale_py.py');
    fs.writeFileSync(tmp, pyScript, 'utf8');
    try {
        const out = execSync(`python3 "${tmp}" "${pdfPath}"`,
            { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
        fs.unlinkSync(tmp);
        return out;
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch(_) {}
        throw new Error('PDF-Extraktion fehlgeschlagen: ' + e.message);
    }
}

// ─── Parser ───────────────────────────────────────────────────────────────────
function parseDe(s) {
    return parseFloat((s || '0').replace(/\./g, '').replace(',', '.')) || 0;
}
function parseDT(date, time) {
    const [d, m, y] = date.split('.');
    return new Date(`${y}-${m}-${d}T${time}:00`);
}

function parseHaleReport(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Fahrer-Name + Zeitraum aus Header
    let fahrer = 'Unbekannt';
    let zeitraum = '';
    for (const l of lines) {
        const mF = l.match(/Fahrers?\s+(.+?)\s+im\s+Zeitraum/i);
        if (mF) fahrer = mF[1].replace(/\s*\(\d+\)\s*$/, '').trim();
        const mZ = l.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/);
        if (mZ) zeitraum = `${mZ[1]} – ${mZ[2]}`;
    }

    // Fahrt-Zeilen parsen (beginnen immer mit TT.MM.JJJJ HH:MM)
    const rides = [];
    for (const l of lines) {
        if (/^(Summe|Seite|Beginn|Fahrten|Ereignis)/i.test(l)) continue;
        const m = l.match(/^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/);
        if (!m) continue;

        const beginnDt   = parseDT(m[1], m[2]);
        const endeDt     = parseDT(m[3], m[4]);
        const durationMin = Math.max(0, Math.round((endeDt - beginnDt) / 60000));
        const isLeer = l.includes('---');

        // € wird in Hale-PDFs als ? (Encoding-Artefakt) ausgegeben → nicht als Trennzeichen nutzbar.
        // Stattdessen: alle Dezimalzahlen positional lesen + km/% als Kontext-Marker.
        // Zeilenformat: [Fahrpreis] [Zuschlag] [Gesamt] [USt%] [LeerKm km] [BelegtKm km] [Xh Ym]
        const allNums = [...l.matchAll(/(\d+[.,]\d+)/g)].map(x => ({
            val: parseDe(x[1]),
            // ist das nächste Nicht-Leerzeichen "km" oder "%"?
            after: l.slice(x.index + x[0].length).trimStart().slice(0, 2)
        }));
        const priceNums = allNums.filter(n => n.after !== 'km' && n.after !== '% ' && n.after.slice(0,1) !== '%');
        const kmNums    = allNums.filter(n => n.after === 'km');
        const pctNums   = allNums.filter(n => n.after.startsWith('%'));

        rides.push({
            date:         m[1],
            beginn:       m[2],
            ende:         m[4],
            beginnDt,
            endeDt,
            durationMin,
            isLeer,
            gesamtumsatz: isLeer ? 0 : (priceNums[2]?.val || priceNums[0]?.val || 0),
            ustSatz:      pctNums[0]?.val || 0,
            leerKm:       kmNums[0]?.val  || 0,
            belegtKm:     kmNums[1]?.val  || 0,
        });
    }

    // Summe-Zeile (Gesamt-Km + Gesamt-Umsatz)
    let summe = { gesamtumsatz: 0, leerKm: 0, belegtKm: 0, aktivMin: 0 };
    for (const l of lines) {
        if (!l.startsWith('Summe')) continue;
        const allNums = [...l.matchAll(/(\d+[.,]\d+)/g)].map(x => ({
            val: parseDe(x[1]),
            after: l.slice(x.index + x[0].length).trimStart().slice(0, 2)
        }));
        const priceN = allNums.filter(n => n.after !== 'km' && !n.after.startsWith('%'));
        const kmN    = allNums.filter(n => n.after === 'km');
        const durM   = l.match(/(\d+)\s*h\s*(\d+)\s*m/);
        summe = {
            gesamtumsatz: priceN[0]?.val || 0,
            leerKm:       kmN[0]?.val    || 0,
            belegtKm:     kmN[1]?.val    || 0,
            aktivMin: durM ? parseInt(durM[1]) * 60 + parseInt(durM[2]) : 0,
        };
        break;
    }

    return { fahrer, zeitraum, rides, summe };
}

// ─── Lohnberechnung ───────────────────────────────────────────────────────────
function fmt(n)   { return n.toFixed(2).replace('.', ',') + ' €'; }
function fmtH(m)  { return `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}min`; }
function round2(n){ return Math.round(n * 100) / 100; }

function berechne(report) {
    const { fahrer, zeitraum, rides, summe } = report;

    // Gruppierung nach Datum
    const byDate = {};
    for (const r of rides) {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
    }

    const tage = Object.entries(byDate)
        .sort(([a], [b]) => {
            const toTs = s => { const [d,m,y]=s.split('.'); return new Date(`${y}-${m}-${d}`).getTime(); };
            return toTs(a) - toTs(b);
        })
        .map(([date, dr]) => {
            const sorted       = dr.sort((a, b) => a.beginnDt - b.beginnDt);
            const schichtStart = sorted[0].beginnDt;
            const schichtEnde  = sorted[sorted.length - 1].endeDt;
            const schichtMin   = Math.round((schichtEnde - schichtStart) / 60000);
            const aktivMin     = dr.reduce((s, r) => s + r.durationMin, 0);
            const umsatz       = dr.reduce((s, r) => s + r.gesamtumsatz, 0);
            const belegtKm     = dr.reduce((s, r) => s + r.belegtKm, 0);

            // Pausen zwischen Fahrten berechnen + klassifizieren
            const pausen = [];
            for (let i = 1; i < sorted.length; i++) {
                const pauseMin = Math.round((sorted[i].beginnDt - sorted[i-1].endeDt) / 60000);
                if (pauseMin > 0) {
                    pausen.push({
                        von: sorted[i-1].ende,
                        bis: sorted[i].beginn,
                        min: pauseMin,
                        typ: pauseMin > BEREITSCHAFT_GRENZE_MIN ? 'weite Bereitschaft' : 'enge Wartezeit',
                    });
                }
            }
            const weiteBereitschaftMin = pausen.filter(p => p.typ === 'weite Bereitschaft').reduce((s, p) => s + p.min, 0);
            const engeWartezeitMin     = pausen.filter(p => p.typ === 'enge Wartezeit').reduce((s, p) => s + p.min, 0);
            // Vergütungspflichtige Arbeitszeit = aktive Fahrzeit + enge Wartezeit (≤45 Min Pause)
            const arbeitsMin = aktivMin + engeWartezeitMin;
            // km-Methode: belegte km ÷ Durchschnittsgeschwindigkeit
            const kmMethodeMin = Math.round((belegtKm / KM_DURCHSCHNITT_KMH) * 60);

            return {
                date,
                schichtStart: sorted[0].beginn,
                schichtEnde:  sorted[sorted.length - 1].ende,
                schichtMin,
                aktivMin,
                engeWartezeitMin,
                weiteBereitschaftMin,
                arbeitsMin,
                kmMethodeMin,
                pausen,
                umsatz,
                leerKm:   dr.reduce((s, r) => s + r.leerKm, 0),
                belegtKm,
                fahrten:  dr.filter(r => !r.isLeer).length,
            };
        });

    const gesamtSchichtMin        = tage.reduce((s, t) => s + t.schichtMin, 0);
    const gesamtWeiteBereitschaft = tage.reduce((s, t) => s + t.weiteBereitschaftMin, 0);
    const gesamtUmsatz            = summe.gesamtumsatz || tage.reduce((s, t) => s + t.umsatz, 0);

    // Lohnmodell: 40% Provision → rückwärts in Stunden umrechnen
    const provision               = round2(gesamtUmsatz * PROVISION_RATE);
    const bezahlteStunden         = round2(provision / STUNDENSATZ);
    const schichtStunden          = round2(gesamtSchichtMin / 60);
    // Rufbereitschaft = Aufstockung NUR wenn Provision die Schichtzeit noch nicht abdeckt.
    // Deckt die Provision bereits die volle Schichtzeit → Rufbereitschaft = 0.
    const rufbereitschaftStunden  = bezahlteStunden >= schichtStunden
        ? 0
        : round2(schichtStunden - bezahlteStunden);
    const rufbereitschaftLohn     = round2(rufbereitschaftStunden * RUFBEREITSCHAFT_SATZ);
    const bruttolohn              = round2(provision + rufbereitschaftLohn);

    // Mindestlohn-Check: bezahlte Stunden × Stundensatz muss ≥ Mindestlohn × Arbeitszeit
    const gesamtArbeitsMin        = tage.reduce((s, t) => s + t.arbeitsMin, 0);
    const gesamtArbeitsH          = gesamtArbeitsMin / 60;
    const mindestlohnBedarf       = round2(gesamtArbeitsH * MINDESTLOHN);
    const mindestlohnOK           = provision >= mindestlohnBedarf;

    const agKV      = round2(bruttolohn * AG_KV);
    const agRV      = round2(bruttolohn * AG_RV);
    const agSteuer  = round2(bruttolohn * AG_STEUER);
    const agGesamt  = round2(agKV + agRV + agSteuer);

    return {
        fahrer, zeitraum, tage,
        gesamtSchichtMin, schichtStunden,
        gesamtArbeitsMin, gesamtArbeitsH,
        gesamtWeiteBereitschaft,
        gesamtUmsatz,
        provision,            // 40% vom Umsatz
        bezahlteStunden,      // Provision ÷ Stundensatz (Stunden-Äquivalent)
        rufbereitschaftStunden, rufbereitschaftLohn,
        bruttolohn,           // Provision + ggf. Aufstockung
        mindestlohnOK, mindestlohnBedarf,
        minijobOK: bruttolohn <= MINIJOB_GRENZE,
        agKV, agRV, agSteuer, agGesamt,
        gesamtkosten: round2(bruttolohn + agGesamt),
        leerKm:   summe.leerKm,
        belegtKm: summe.belegtKm,
    };
}

// ─── HTML-Template ────────────────────────────────────────────────────────────
function generateHTML(c) {
    const heute = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
    const gesamtAktivMin      = c.tage.reduce((s, t) => s + t.aktivMin, 0);
    const gesamtEngeWarteMin  = c.tage.reduce((s, t) => s + t.engeWartezeitMin, 0);
    const gesamtFahrten       = c.tage.reduce((s, t) => s + t.fahrten, 0);

    const tageRows = c.tage.map(t => `
      <tr>
        <td>${t.date}</td>
        <td>${t.schichtStart}&nbsp;–&nbsp;${t.schichtEnde}</td>
        <td class="c">${fmtH(t.aktivMin)}</td>
        <td class="c">${fmtH(t.engeWartezeitMin)}</td>
        <td class="c">${fmtH(t.weiteBereitschaftMin)}</td>
        <td class="c"><strong>${fmtH(t.arbeitsMin)}</strong></td>
        <td class="c">${t.fahrten}</td>
        <td class="r">${t.belegtKm.toFixed(1)}&nbsp;km</td>
        <td class="r">${fmt(t.umsatz)}</td>
      </tr>`).join('');

    const mlColor  = c.mindestlohnOK ? '#d1fae5' : '#fee2e2';
    const mlBorder = c.mindestlohnOK ? '#10b981' : '#ef4444';
    const mlHColor = c.mindestlohnOK ? '#065f46' : '#991b1b';
    const mlIcon   = c.mindestlohnOK ? '✅' : '⚠️';
    const mjColor  = c.minijobOK     ? '#d1fae5' : '#fee2e2';
    const mjBorder = c.minijobOK     ? '#10b981' : '#ef4444';
    const mjHColor = c.minijobOK     ? '#065f46' : '#991b1b';
    const mjIcon   = c.minijobOK     ? '✅' : '⚠️';
    const mjSub    = c.minijobOK
        ? `Spielraum: ${fmt(MINIJOB_GRENZE - c.bruttolohn)}`
        : `Überschreitung: ${fmt(c.bruttolohn - MINIJOB_GRENZE)} → Sozialversicherungspflicht prüfen!`;

    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a}
.page{padding:16mm 18mm;max-width:210mm;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #1e3a5f}
.logo{font-size:19px;font-weight:800;color:#1e3a5f}.logo span{color:#f59e0b}
.hdr-r{text-align:right;font-size:10px;color:#64748b}
.hdr-title{font-size:15px;font-weight:700;color:#1e3a5f}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
.iblock{background:#f8fafc;border-radius:6px;padding:10px 12px;border-left:3px solid #1e3a5f}
.iblock h3{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px}
.iblock .v{font-size:11px;line-height:1.65}
section{margin-bottom:18px}
section h2{font-size:10px;font-weight:700;color:#1e3a5f;margin-bottom:7px;padding-bottom:3px;border-bottom:1px solid #e2e8f0;text-transform:uppercase;letter-spacing:.4px}
table{width:100%;border-collapse:collapse;margin-bottom:0}
th{background:#1e3a5f;color:#fff;padding:5px 7px;font-size:9px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:.3px}
td{padding:5px 7px;border-bottom:1px solid #e2e8f0;font-size:10px;vertical-align:middle}
tr:last-child td{border-bottom:none}
.c{text-align:center}.r{text-align:right}
.tfoot td{font-weight:700;background:#eef2f7;border-top:2px solid #1e3a5f}
.lrow td{padding:6px 8px}
.lbig td{background:#1e3a5f;color:#fff;font-size:13px;font-weight:800}
.lnet td{background:#065f46;color:#fff;font-size:12px;font-weight:700}
.lsub{color:#94a3b8;font-size:9px}
.lsep td{padding:2px;border:none}
.ag{background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 12px;margin-top:10px}
.ag h3{font-size:9px;font-weight:700;color:#92400e;text-transform:uppercase;margin-bottom:5px}
.agrow{display:flex;justify-content:space-between;font-size:10px;padding:2px 0}
.agtot{border-top:1px solid #f59e0b;margin-top:4px;padding-top:4px;font-weight:700}
.checks{display:flex;gap:12px;margin-top:10px}
.chk{flex:1;border-radius:6px;padding:10px 12px}
.chk h3{font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:3px}
.chk .cv{font-size:13px;font-weight:800}
.chk .cs{font-size:9px;color:#64748b;margin-top:2px}
footer{margin-top:20px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;display:flex;justify-content:space-between}
</style></head><body><div class="page">

<div class="hdr">
  <div>
    <div class="logo">FUNK<span>TAXI</span>&nbsp;Heringsdorf</div>
    <div style="font-size:10px;color:#64748b;margin-top:2px">${ARBEITGEBER.strasse} &middot; ${ARBEITGEBER.ort}</div>
  </div>
  <div class="hdr-r">
    <div class="hdr-title">LOHNABRECHNUNG</div>
    <div>Erstellt: ${heute}</div>
    <div style="margin-top:2px">Quelle: Hale Tachograph-Export</div>
  </div>
</div>

<div class="two">
  <div class="iblock">
    <h3>Arbeitnehmer</h3>
    <div class="v"><strong>${c.fahrer}</strong><br>
    Beschäftigungsart: Minijob (§&nbsp;8 SGB IV)<br>
    Lohnmodell: 40&nbsp;% Provision vom Bruttoumsatz</div>
  </div>
  <div class="iblock">
    <h3>Abrechnungszeitraum</h3>
    <div class="v"><strong>${c.zeitraum}</strong><br>
    Arbeitstage: ${c.tage.length} &nbsp;|&nbsp; Fahrten: ${gesamtFahrten}<br>
    Verg. Arbeitszeit: <strong>${fmtH(c.gesamtArbeitsMin)}</strong> (Schichtzeit: ${fmtH(c.gesamtSchichtMin)}, davon ${fmtH(c.gesamtWeiteBereitschaft)} weite Bereitschaft &gt;${BEREITSCHAFT_GRENZE_MIN}&nbsp;Min)</div>
  </div>
</div>

<section>
  <h2>Leistungsnachweis</h2>
  <table>
    <thead><tr>
      <th>Datum</th><th>Schicht</th>
      <th class="c">Fahrzeit</th>
      <th class="c">Warte&shy;zeit<br><span style="font-weight:400;text-transform:none">&le;${BEREITSCHAFT_GRENZE_MIN}&nbsp;Min</span></th>
      <th class="c">Bereit&shy;schaft<br><span style="font-weight:400;text-transform:none">&gt;${BEREITSCHAFT_GRENZE_MIN}&nbsp;Min</span></th>
      <th class="c">Arbeits&shy;zeit</th>
      <th class="c">Fahrten</th><th class="r">Bel.&nbsp;km</th><th class="r">Umsatz</th>
    </tr></thead>
    <tbody>${tageRows}</tbody>
    <tfoot><tr class="tfoot">
      <td colspan="2"><strong>Summe</strong></td>
      <td class="c">${fmtH(gesamtAktivMin)}</td>
      <td class="c">${fmtH(gesamtEngeWarteMin)}</td>
      <td class="c">${fmtH(c.gesamtWeiteBereitschaft)}</td>
      <td class="c"><strong>${fmtH(c.gesamtArbeitsMin)}</strong></td>
      <td class="c">${gesamtFahrten}</td>
      <td class="r">${c.belegtKm.toFixed(1)}&nbsp;km</td>
      <td class="r"><strong>${fmt(c.gesamtUmsatz)}</strong></td>
    </tr></tfoot>
  </table>
</section>

<section>
  <h2>Lohnabrechnung</h2>
  <table>
    <tr class="lrow"><td>Bruttoumsatz (Fahrten)</td><td class="r">${fmt(c.gesamtUmsatz)}</td></tr>
    <tr class="lrow"><td>× Provision 40&nbsp;% &rarr; Std-Äquivalent: ${c.bezahlteStunden.toFixed(2).replace('.',',')} Std × ${STUNDENSATZ.toFixed(2).replace('.',',')} €/h</td><td class="r">${fmt(c.provision)}</td></tr>
    <tr class="lrow"><td>${c.rufbereitschaftStunden > 0
        ? `+ Aufstockung auf Schichtzeit (${fmtH(c.gesamtSchichtMin)} &minus; ${c.bezahlteStunden.toFixed(2).replace('.',',')} Std) = ${c.rufbereitschaftStunden.toFixed(2).replace('.',',')} Std × ${RUFBEREITSCHAFT_SATZ.toFixed(2).replace('.',',')} €/h`
        : `Rufbereitschaft: entfällt (Provision deckt Schichtzeit ${fmtH(c.gesamtSchichtMin)} bereits ab)`
    }</td><td class="r">${fmt(c.rufbereitschaftLohn)}</td></tr>
    <tr class="lsep"><td colspan="2"></td></tr>
    <tr class="lbig"><td>= BRUTTOLOHN</td><td class="r">${fmt(c.bruttolohn)}</td></tr>
    <tr class="lrow"><td class="lsub">AN-Abzüge (Minijob pauschal &mdash; Arbeitnehmer trägt nichts)</td><td class="r lsub">0,00&nbsp;€</td></tr>
    <tr class="lnet"><td>= NETTOLOHN (Auszahlung an Fahrer)</td><td class="r">${fmt(c.bruttolohn)}</td></tr>
  </table>

  <div class="ag">
    <h3>Arbeitgeber-Abgaben (zusätzlich zur Auszahlung)</h3>
    <div class="agrow"><span>KV-Pauschale AG (13&nbsp;%)</span><span>${fmt(c.agKV)}</span></div>
    <div class="agrow"><span>RV-Pauschale AG (15&nbsp;%)</span><span>${fmt(c.agRV)}</span></div>
    <div class="agrow"><span>Pauschal-Lohnsteuer (2&nbsp;%)</span><span>${fmt(c.agSteuer)}</span></div>
    <div class="agrow agtot"><span><strong>Gesamtkosten Arbeitgeber</strong></span><span><strong>${fmt(c.gesamtkosten)}</strong></span></div>
  </div>

  <div class="checks">
    <div class="chk" style="background:${mlColor};border:1px solid ${mlBorder}">
      <h3 style="color:${mlHColor}">${mlIcon} Mindestlohn ${c.mindestlohnOK ? 'eingehalten' : 'UNTERSCHRITTEN'}</h3>
      <div class="cv">${STUNDENSATZ.toFixed(2).replace('.',',')} €/h</div>
      <div class="cs">Provision ${fmt(c.provision)} &ge; Mindestlohn-Bedarf ${fmt(c.mindestlohnBedarf)} (${fmtH(c.gesamtArbeitsMin)} × ${MINDESTLOHN.toFixed(2).replace('.',',')} €/h)</div>
    </div>
    <div class="chk" style="background:${mjColor};border:1px solid ${mjBorder}">
      <h3 style="color:${mjHColor}">${mjIcon} Minijob-Grenze ${c.minijobOK ? 'OK' : 'ÜBERSCHRITTEN'}</h3>
      <div class="cv">${fmt(c.bruttolohn)}</div>
      <div class="cs">Grenze: ${MINIJOB_GRENZE.toFixed(2).replace('.',',')} €/Mo &middot; ${mjSub}</div>
    </div>
  </div>
</section>

<footer>
  <div>${ARBEITGEBER.name} &mdash; maschinell erstellt aus Hale-Tachograph-Daten</div>
  <div>Kein steuerlicher Beleg ohne Unterschrift</div>
</footer>

</div></body></html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    const pdfIn = process.argv[2];
    if (!pdfIn || !fs.existsSync(pdfIn)) {
        console.error('Usage: node scripts/lohn-aus-hale.js <EventReport.pdf>');
        process.exit(1);
    }

    console.log('📄 Lese PDF:', pdfIn);
    const text = extractPdfText(pdfIn);

    console.log('🔍 Parse Hale-Bericht...');
    const report = parseHaleReport(text);
    console.log(`   Fahrer:   ${report.fahrer}`);
    console.log(`   Zeitraum: ${report.zeitraum}`);
    console.log(`   Fahrten:  ${report.rides.length} geparst`);
    console.log(`   Umsatz:   ${fmt(report.summe.gesamtumsatz)} (Summe-Zeile)`);

    if (!report.rides.length) {
        console.error('❌ Keine Fahrten gefunden — PDF-Format unerwartet?');
        process.exit(1);
    }

    console.log('💶 Berechne Lohn...');
    const calc = berechne(report);
    console.log(`   Bruttolohn (40%):  ${fmt(calc.bruttolohn)}`);
    console.log(`   Schichtzeit ges.:  ${fmtH(calc.gesamtSchichtMin)}`);
    console.log(`   Provision:         ${fmt(calc.provision)} (Äquivalent ${calc.bezahlteStunden.toFixed(2)} Std, Schicht ${calc.schichtStunden.toFixed(2)} Std)`);
    const rbInfo = calc.rufbereitschaftStunden > 0
        ? `${calc.rufbereitschaftStunden.toFixed(2)} Std × ${RUFBEREITSCHAFT_SATZ.toFixed(2)} €/h = ${fmt(calc.rufbereitschaftLohn)}`
        : 'entfällt (Provision deckt Schichtzeit ab)';
    console.log(`   Aufstockung:       ${rbInfo}`);
    console.log(`   Mindestlohn OK:    ${calc.mindestlohnOK ? '✅' : '⚠️  NEIN'}`);
    console.log(`   Minijob-Grenze OK: ${calc.minijobOK     ? '✅' : '⚠️  NEIN — bitte prüfen'}`);
    console.log(`   Gesamtkosten AG:   ${fmt(calc.gesamtkosten)}`);

    // HTML schreiben
    const ts      = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const base    = pdfIn.replace(/\.pdf$/i, '');
    const htmlOut = base + '_Lohnabrechnung.html';
    const pdfOut  = base + `_Lohnabrechnung_${ts}.pdf`;
    fs.writeFileSync(htmlOut, generateHTML(calc), 'utf8');
    console.log('📝 HTML:', htmlOut);

    // PDF rendern
    if (!CHROME) {
        console.error('⚠️  Kein Chrome/Edge gefunden — nur HTML-Export möglich');
        return;
    }
    const puppeteer = require(PUPPETEER_PATH);
    const browser   = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
    const page      = await browser.newPage();
    await page.goto('file://' + htmlOut.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.pdf({ path: pdfOut, format: 'A4', printBackground: true,
        margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' } });
    await browser.close();

    const kb = Math.round(fs.statSync(pdfOut).size / 1024);
    console.log(`✅ PDF fertig: ${pdfOut} (${kb} KB)`);
})();
