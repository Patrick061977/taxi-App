#!/usr/bin/env node
// vetter-extract-pdfs.js — Aus jedem Vetter-PDF Pickup/Ziel/Zeit/Personen mit Claude extrahieren
// → JSON pro PDF → CSV mit allen Auftraegen

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-5-20250929';
const PDF_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Vetter-Touristik-Auftraege';
const OUT_JSON = path.join(PDF_DIR, '_extracted.json');
const OUT_CSV = path.join(PDF_DIR, '_extracted.csv');

const PROMPT = `Du analysierst einen Vetter-Touristik Fahrauftrag (PDF, oft Scan).

Extrahiere ALLE Fahrten aus dem Dokument. Ein Dokument kann mehrere Fahrten enthalten.

Pro Fahrt extrahiere:
- datum (TT.MM.JJJJ)
- zeit_abholung (HH:MM) — wann Patient abgeholt werden soll
- pickup_adresse (Strasse, PLZ, Ort — meist Interferry/Faehre Swinemuende oder Hotel)
- ziel_adresse (Strasse, PLZ, Ort — meist Patienten-Adresse oder Klinik)
- personen_anzahl (Zahl)
- kunde_name (Name des Passagiers, falls erkennbar)
- telefon (falls vorhanden)
- richtung (entweder "Anreise" wenn von Faehre/Bahnhof zum Patient/Hotel ODER "Abreise" wenn umgekehrt ODER "Transfer" sonst)
- notizen (sonstige relevante Infos: Gepaeck, Rollstuhl, etc.)

Antworte AUSSCHLIESSLICH mit reinem JSON in diesem Format (KEIN Markdown, KEIN Text drumherum):
{"fahrten": [{"datum": "...", "zeit_abholung": "...", "pickup_adresse": "...", "ziel_adresse": "...", "personen_anzahl": N, "kunde_name": "...", "telefon": "...", "richtung": "...", "notizen": "..."}]}

Falls Feld unklar/fehlt: leeren String "" oder null. Personen-Anzahl default 1 wenn nicht erkennbar.`;

async function extractFromPdf(pdfPath) {
    const buf = fs.readFileSync(pdfPath);
    const b64 = buf.toString('base64');

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 4000,
            messages: [{
                role: 'user',
                content: [
                    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
                    { type: 'text', text: PROMPT }
                ]
            }]
        })
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`API ${resp.status}: ${err.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = data?.content?.[0]?.text || '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn('  ⚠ JSON-Parse-Fehler:', e.message, ' Antwort-Snippet:', cleaned.slice(0, 200));
        return { fahrten: [], _raw: text };
    }
}

(async () => {
    const pdfs = [];
    for (const year of ['2025', '2026']) {
        const dir = path.join(PDF_DIR, year);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).sort()) {
            if (f.toLowerCase().endsWith('.pdf')) pdfs.push(path.join(dir, f));
        }
    }
    console.log(`[Vetter-Extract] ${pdfs.length} PDFs gefunden`);

    const results = [];
    for (let i = 0; i < pdfs.length; i++) {
        const pdf = pdfs[i];
        const fn = path.basename(pdf);
        process.stdout.write(`[${i+1}/${pdfs.length}] ${fn} ... `);
        try {
            const parsed = await extractFromPdf(pdf);
            const cnt = parsed.fahrten?.length || 0;
            console.log(`${cnt} Fahrten`);
            results.push({ pdf: fn, year: pdf.includes('/2025/') ? 2025 : 2026, ...parsed });
        } catch (e) {
            console.log(`FEHLER: ${e.message}`);
            results.push({ pdf: fn, error: e.message });
        }
    }

    fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
    console.log(`\n[Vetter-Extract] JSON: ${OUT_JSON}`);

    // CSV
    const rows = [['PDF','Jahr','Datum','Zeit','Pickup','Ziel','Personen','Kunde','Telefon','Richtung','Notizen'].join(';')];
    for (const r of results) {
        if (!r.fahrten) {
            rows.push([r.pdf, r.year || '', '', '', '', '', '', '', '', '', r.error || ''].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(';'));
            continue;
        }
        for (const f of r.fahrten) {
            rows.push([r.pdf, r.year, f.datum, f.zeit_abholung, f.pickup_adresse, f.ziel_adresse, f.personen_anzahl, f.kunde_name, f.telefon, f.richtung, f.notizen].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(';'));
        }
    }
    fs.writeFileSync(OUT_CSV, '﻿' + rows.join('\n'), 'utf8');
    console.log(`[Vetter-Extract] CSV : ${OUT_CSV}`);
    const totalFahrten = results.reduce((s,r) => s + (r.fahrten?.length || 0), 0);
    console.log(`[Vetter-Extract] GESAMT: ${totalFahrten} Fahrten aus ${pdfs.length} PDFs`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
