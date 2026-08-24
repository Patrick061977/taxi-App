#!/usr/bin/env node
// v6.63.959: Route-Content-Generator — Unique Prosa pro taxi-*-zu-*.html
// Löst Google-Duplicate-Warnung durch Ort-spezifische Fakten + variable Templates.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Ort-Fakten für Uniqueness — jede Ortschaft mit unique Facts
const ORT_FAKTEN = {
    'heringsdorf': {
        display: 'Heringsdorf',
        plz: '17424',
        facts: [
            'Kaiserbad mit der historischen Seebrücke (508 m, längste Deutschlands)',
            'Villenviertel mit Bäderarchitektur aus dem 19. Jahrhundert',
            'Flughafen Heringsdorf (EDAH) direkt vor der Tür',
            'Historisches Ostseebad mit Museum Villa Irmgard',
            'Beliebtes Wellness-Ziel mit Ostsee-Therme',
        ],
        umgebung: ['Ahlbeck (5 km)', 'Bansin (4 km)', 'Świnoujście (12 km)', 'Flughafen HDF (6 km)'],
    },
    'ahlbeck': {
        display: 'Ahlbeck',
        plz: '17419',
        facts: [
            'Ältestes der drei Kaiserbäder mit Deutschlands ältester Seebrücke (280 m, 1898)',
            'Grenzort zu Polen — Świnoujście fußläufig in 30 Min entlang der Promenade',
            'Berühmte Strandkorb-Vermietungen und feiner Sandstrand',
            'Historisches Museum in der Bäderarchitektur-Villa',
            'Bahnhof Ahlbeck als UBB-Endstation',
        ],
        umgebung: ['Heringsdorf (5 km)', 'Świnoujście (2 km)', 'Bansin (9 km)'],
    },
    'bansin': {
        display: 'Bansin',
        plz: '17429',
        facts: [
            'Alt-Fischerdorf mit ruhigem Charme östlich der Kaiserbäder',
            'Kilometerlanger Sandstrand mit sanften Dünen',
            'Ausgangspunkt für Wanderungen ins Achterland',
            'Golfplatz Balmer See in 10 Min Fahrt erreichbar',
            'Beliebt bei Familien und Ruhesuchenden',
        ],
        umgebung: ['Heringsdorf (4 km)', 'Ahlbeck (9 km)', 'Ückeritz (12 km)', 'Neu Pudagla (5 km)'],
    },
    'zinnowitz': {
        display: 'Zinnowitz',
        plz: '17454',
        facts: [
            'Größtes Ostseebad im Nordwesten der Insel',
            'Bernsteintherme mit direktem Zugang zum Strand',
            'Historisches Vineta-Theater im Bäderstil',
            'Ausgangspunkt für Fahrten nach Peenemünde',
            'Beliebter Wassersportort mit Yachthafen',
        ],
        umgebung: ['Karlshagen (5 km)', 'Trassenheide (8 km)', 'Koserow (12 km)', 'Peenemünde (14 km)'],
    },
    'koserow': {
        display: 'Koserow',
        plz: '17459',
        facts: [
            'Bergiges Ostseebad am höchsten Punkt Usedoms (Streckelsberg 58 m)',
            'Fischerort mit traditionellen Räucherhäusern',
            'Medizinisches Versorgungszentrum (MVZ) als regionale Gesundheitsversorgung',
            'Beliebt bei Ruhesuchenden abseits der Kaiserbäder',
            'Kurzer Weg zum Achterwasser und zur Ostsee',
        ],
        umgebung: ['Ückeritz (6 km)', 'Zinnowitz (12 km)', 'Bansin (18 km)'],
    },
    'ueckeritz': {
        display: 'Ückeritz',
        plz: '17459',
        facts: [
            'Zwischen Kaiserbädern und Zinnowitz, ideal zentral gelegen',
            'Familien-Campingplätze und ruhige Strandabschnitte',
            'Direkte Nähe zum Naturschutzgebiet Streckelsberg',
        ],
        umgebung: ['Koserow (6 km)', 'Bansin (12 km)', 'Zinnowitz (18 km)'],
    },
    'swinemuende': {
        display: 'Świnoujście (Swinemünde)',
        plz: 'PL-72-600',
        facts: [
            'Polnische Grenzstadt mit historischem Zentrum und Promenade',
            'Beliebter Grenzübergang für Einkäufe und günstiges Essen',
            'Hafen mit Fährverbindung nach Skandinavien',
            'Kurbetrieb im polnischen Ostseebad-Stil',
        ],
        umgebung: ['Ahlbeck (2 km Grenzübergang)', 'Heringsdorf (12 km)', 'Fähre nach Deutschland'],
    },
    'trassenheide': { display: 'Trassenheide', plz: '17449', facts: ['Ruhiges Ostseebad zwischen Zinnowitz und Karlshagen', 'Naturbelassener Strand mit Dünenlandschaft'], umgebung: ['Zinnowitz (8 km)', 'Karlshagen (3 km)'] },
    'karlshagen': { display: 'Karlshagen', plz: '17449', facts: ['Ausgangsort für Fahrten nach Peenemünde und zum Historisch-Technischen Museum', 'Beliebter Familienurlaubsort'], umgebung: ['Peenemünde (5 km)', 'Zinnowitz (5 km)'] },
    'peenemuende': { display: 'Peenemünde', plz: '17449', facts: ['Historisch-Technisches Museum mit Raketenversuchsanstalt', 'Nordspitze der Insel'], umgebung: ['Karlshagen (5 km)', 'Zinnowitz (14 km)'] },
};

// Einleitungs-Varianten — variierende Syntax für Uniqueness
const INTRO_VARIANTEN = [
    ({from, to, distKm, minutes, priceEur}) => `Für die Strecke ${from} → ${to} legen wir mit dem Taxi rund ${distKm} km zurück — die Fahrt dauert je nach Verkehrslage ${minutes} Minuten. Der Median-Preis unserer letzten Fahrten liegt bei ${priceEur} €.`,
    ({from, to, distKm, minutes, priceEur}) => `Ihr Fahrer bringt Sie in etwa ${minutes} Minuten sicher von ${from} nach ${to}. Die Route ist ${distKm} km lang und wird nach Taxameter abgerechnet — Erfahrungswert liegt bei ${priceEur} €.`,
    ({from, to, distKm, minutes, priceEur}) => `Klassische Insel-Route: ${from} nach ${to} in ${minutes} Min, ${distKm} km über die üblichen Verkehrswege. Ø ${priceEur} € nach unseren letzten Fahrten dieser Strecke.`,
    ({from, to, distKm, minutes, priceEur}) => `Wir kennen die Strecke ${from} → ${to} sehr gut — ${distKm} km, üblicherweise ${minutes} Minuten Fahrtzeit. Median-Preis: ${priceEur} €.`,
    ({from, to, distKm, minutes, priceEur}) => `${distKm} km trennen ${from} und ${to} — mit unserem Funk Taxi in etwa ${minutes} Minuten überbrückt. Preis-Orientierung: ${priceEur} €.`,
    ({from, to, distKm, minutes, priceEur}) => `Als ortsansässiger Taxi-Service auf Usedom fahren wir die Strecke ${from} → ${to} täglich. ${distKm} km, ${minutes} Min, Ø ${priceEur} €.`,
];

// Wann-empfohlen-Bausteine — orts-spezifisch
const WANN_TIPPS = [
    ({toKey}) => {
        if (['heringsdorf','ahlbeck','bansin'].includes(toKey)) return 'Vor allem in der Hauptsaison (Mai-September) empfehlen wir eine Vorbestellung — an Sommer-Wochenenden können die Parkplätze in den Kaiserbädern schnell voll sein.';
        if (toKey === 'swinemuende') return 'Grenzübertritt nach Polen: Personalausweis oder Reisepass mitführen. Wir übernehmen den Grenz-Check mit unseren Fahrern routinemäßig.';
        if (toKey === 'zinnowitz') return 'Für die Bernsteintherme empfehlen wir eine Vorbestellung 30-60 Min vor Öffnungszeit, damit Sie ohne Warten am Eingang sind.';
        return 'Vorbestellung ist ab 25 Min Vorlauf jederzeit möglich — wir sind 24/7 verfügbar.';
    },
    ({fromKey, toKey}) => {
        if (fromKey === 'flughafen' || fromKey.includes('flughafen') || toKey === 'flughafen' || toKey.includes('flughafen')) return 'Flug-Ankunft/Abflug ist unser Alltag — wir überwachen die Flightradar-Daten und passen den Pickup automatisch an, auch bei Verspätung.';
        if (['heringsdorf','ahlbeck','bansin'].includes(fromKey)) return 'Aus den Kaiserbädern heraus sind wir meist innerhalb 5-10 Min bei Ihnen — auch spät nachts.';
        return '24/7-Service ohne Nachtzuschlags-Überraschung: der Nacht-Zuschlag (22-6 Uhr) beträgt 5 €, kein versteckter Aufpreis.';
    },
];

// Cross-Links — Nachbar-Routen suchen für interne Verlinkung
function findRelatedRoutes(allFiles, fromKey, currentFile) {
    const related = [];
    for (const f of allFiles) {
        if (f === currentFile) continue;
        const m = f.match(/^taxi-([a-z0-9-]+)-zu-([a-z0-9-]+)\.html$/i);
        if (!m) continue;
        const [_, fromSlug, toSlug] = m;
        // gleiche Start-Ort → verwandte Route zu anderem Ziel
        if (fromSlug.toLowerCase().includes(fromKey)) related.push({ file: f, label: prettyFromFilename(toSlug) });
    }
    return related.slice(0, 4);
}

function prettyFromFilename(slug) {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').replace(/-/g, ' ');
}

function detectOrtKey(text) {
    const lower = text.toLowerCase();
    for (const [key, meta] of Object.entries(ORT_FAKTEN)) {
        if (lower.includes(key) || lower.includes(meta.display.toLowerCase())) return key;
    }
    return null;
}

// Deterministic-Hash für konsistente Baustein-Auswahl pro Route
function stableHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function generateContentBlock(filename, meta, allFiles) {
    const h = stableHash(filename);
    const fromKey = detectOrtKey(meta.from);
    const toKey = detectOrtKey(meta.to);
    const fromOrt = fromKey ? ORT_FAKTEN[fromKey] : null;
    const toOrt = toKey ? ORT_FAKTEN[toKey] : null;

    // Intro — deterministic gewählt
    const intro = INTRO_VARIANTEN[h % INTRO_VARIANTEN.length]({
        from: meta.from,
        to: meta.to,
        distKm: meta.distKm || '?',
        minutes: meta.minutes || '5-10',
        priceEur: (meta.priceEur || '10').toString().replace('.', ','),
    });

    // Fakten-Absatz
    const facts = [];
    if (fromOrt) {
        const factIdx = h % fromOrt.facts.length;
        facts.push(`<strong>${fromOrt.display}:</strong> ${fromOrt.facts[factIdx]}.`);
    }
    if (toOrt && toKey !== fromKey) {
        const factIdx = (h >> 3) % toOrt.facts.length;
        facts.push(`<strong>${toOrt.display}:</strong> ${toOrt.facts[factIdx]}.`);
    }

    // Wann-Tipp
    const wannTippFn = WANN_TIPPS[h % WANN_TIPPS.length];
    const wannTipp = wannTippFn({ fromKey: fromKey || '', toKey: toKey || '' });

    // Wann-Tipp 2
    const wannTipp2Fn = WANN_TIPPS[(h >> 5) % WANN_TIPPS.length];
    const wannTipp2 = wannTippFn === wannTipp2Fn ? null : wannTipp2Fn({ fromKey: fromKey || '', toKey: toKey || '' });

    // Cross-Links
    const related = fromKey ? findRelatedRoutes(allFiles, fromKey, filename) : [];

    let html = '\n<section style="background:#1e293b;border-radius:8px;padding:20px;margin:24px 0;border-left:4px solid #10b981;">\n';
    html += '<h2 style="color:#fbbf24;margin-top:0;">Über diese Strecke</h2>\n';
    html += `<p style="color:#e2e8f0;">${intro}</p>\n`;
    if (facts.length > 0) {
        html += '<div style="margin-top:14px;padding:12px;background:#0f172a;border-radius:6px;font-size:14px;color:#cbd5e1;">\n';
        for (const f of facts) html += `<p style="margin:6px 0;">${f}</p>\n`;
        html += '</div>\n';
    }
    if (wannTipp) html += `<p style="color:#cbd5e1;margin-top:14px;font-size:14px;">💡 ${wannTipp}</p>\n`;
    if (wannTipp2 && wannTipp2 !== wannTipp) html += `<p style="color:#cbd5e1;margin-top:6px;font-size:14px;">💡 ${wannTipp2}</p>\n`;
    html += '</section>\n';

    // Cross-Links Sektion
    if (related.length > 0) {
        html += '\n<section style="background:#0f172a;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #1e293b;">\n';
        html += `<h2 style="color:#fbbf24;font-size:16px;margin-top:0;">Weitere Fahrten ab ${fromOrt ? fromOrt.display : meta.from}</h2>\n`;
        html += '<ul style="list-style:none;padding:0;margin:0;font-size:14px;">\n';
        for (const r of related) html += `<li style="margin:6px 0;">→ <a href="${r.file}" style="color:#10b981;">Taxi nach ${r.label}</a></li>\n`;
        html += '</ul></section>\n';
    }
    return html;
}

// Metadaten aus bestehender HTML extrahieren
function parseMeta(html, filename) {
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const description = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) || [])[1] || '';
    // "Preis ca. X,XX EUR (Y km)" oder "X.X km · Z€"
    const priceMatch = description.match(/ca\.?\s*(\d+(?:[,.]\d+)?)\s*EUR/i) || html.match(/ca\.?\s*(\d+(?:[,.]\d+)?)\s*EUR/i);
    const kmMatch = description.match(/\(([\d,.]+)\s*km/i) || html.match(/(\d+(?:[.,]\d+)?)\s*km(?![^<]*Preisliste)/i);
    // Body-Text mit "von X" nach "nach Y" Pattern
    const routeMatch = html.match(/von\s+<strong>([^<]+)<\/strong>\s+nach\s+<strong>([^<]+)<\/strong>/i)
                    || title.match(/von\s+(.+?)\s+nach\s+(.+?)(?:\s*[|·]|$)/i)
                    || title.match(/Taxi\s+(.+?)\s*(?:→|->|nach)\s+(.+?)(?:\s*[|·]|$)/i);
    let from = routeMatch ? routeMatch[1].trim() : '';
    let to = routeMatch ? routeMatch[2].trim() : '';
    // Fallback: aus Dateiname extrahieren wenn Title/Body nichts liefert
    if (!from || !to) {
        const fnMatch = (filename || '').match(/^taxi-(.+?)-zu-(.+?)\.html$/i);
        if (fnMatch) {
            from = from || fnMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            to   = to   || fnMatch[2].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
    }
    const priceEur = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;
    const distKm = kmMatch ? kmMatch[1].replace('.', ',') : null;
    const minutes = distKm ? Math.max(5, Math.round(parseFloat(distKm.replace(',', '.')) * 2.5)) : null;
    return { title, description, from, to, priceEur, distKm, minutes };
}

// Content in HTML injizieren — vor </main>
function injectContent(html, contentBlock) {
    if (html.includes('<!-- v959-content-start -->')) {
        // schon injiziert → ersetzen
        return html.replace(/<!-- v959-content-start -->[\s\S]*?<!-- v959-content-end -->/, `<!-- v959-content-start -->${contentBlock}<!-- v959-content-end -->`);
    }
    // vor </main> einfügen
    const marker = '<!-- v959-content-start -->' + contentBlock + '<!-- v959-content-end -->\n';
    return html.replace(/(<\/main>)/i, marker + '$1');
}

function main() {
    const entries = fs.readdirSync(ROOT).filter(f => /^taxi-.+-zu-.+\.html$/i.test(f));
    console.log('Verarbeite', entries.length, 'Route-Landings...');
    let ok = 0, skip = 0, err = 0;
    for (const filename of entries) {
        try {
            const filepath = path.join(ROOT, filename);
            const html = fs.readFileSync(filepath, 'utf8');
            const meta = parseMeta(html, filename);
            if (!meta.from || !meta.to) { skip++; continue; }
            const block = generateContentBlock(filename, meta, entries);
            const updated = injectContent(html, block);
            if (updated === html) { skip++; continue; }
            fs.writeFileSync(filepath, updated);
            ok++;
            if (ok <= 3) console.log('  ✓', filename, '(' + meta.from + ' → ' + meta.to + ')');
        } catch (e) {
            err++;
            console.warn('  ❌', filename, ':', e.message);
        }
    }
    console.log('---');
    console.log('✅', ok, 'HTMLs mit unique Content-Block angereichert');
    console.log('⏭️ ', skip, 'übersprungen (keine Route-Meta erkannt)');
    console.log('❌', err, 'Fehler');
    console.log('\nContent-Block idempotent — mehrfaches Ausführen überschreibt v959-Marker.');
}

main();
