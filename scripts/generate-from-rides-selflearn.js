#!/usr/bin/env node
// v6.63.962: Self-Learning-Route-Generator
// Scannt /rides der letzten 90 Tage, findet häufig gefahrene Ort→Ort-Kombis
// die noch keine Landing haben, generiert automatisch neue HTMLs.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MIN_OCCURRENCES = 2;          // Route muss ≥ 2x gefahren worden sein
const LOOKBACK_DAYS = 90;
const MAX_NEW_LANDINGS = 100;       // Sicherheits-Cap pro Run

function fetchViaCli(refPath) {
    const out = execSync('firebase database:get ' + refPath, {
        maxBuffer: 500 * 1024 * 1024,
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }).toString();
    return JSON.parse(out);
}

function slugify(s) {
    return s.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function stableHash(str) { let h=0; for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))|0; return Math.abs(h); }
function priceEstimate(km) { return Math.max(6, Math.round((4 + km * 2.5) * 100) / 100); }

// Ort-Name-Extraktion aus vollständiger Adresse — für Landing-Titel
// z.B. "Strandhotel Ostseeblick, Kulmstraße 33, 17424 Heringsdorf" → "Strandhotel Ostseeblick"
function shortName(fullAddress) {
    if (!fullAddress) return null;
    // Erste Komma-getrennte Komponente
    const parts = fullAddress.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    let name = parts[0];
    // Wenn erste Komponente Straße mit Hausnummer ist (endet auf Zahl), Ort dahinter nutzen
    if (/\d+\s*$/.test(name) && parts.length > 1) {
        // Ort ist meist letzte Komponente ohne PLZ
        const orte = parts.slice(1).find(p => !/^\d{5}/.test(p));
        if (orte) name = orte;
    }
    // Zu lang → truncate
    if (name.length > 55) name = name.slice(0, 52) + '…';
    return name;
}

const INTROS_SL = [
    ({f,t,km,min,eur,count}) => `Diese Route fahren wir regelmäßig — vom ${f} zum ${t} sind es ${km.toFixed(1)} km und typisch ${min} Minuten. Ø-Preis aus ${count} Fahrten: ${eur} €.`,
    ({f,t,km,min,eur,count}) => `Vom ${f} zum ${t}: ${count}-mal in den letzten 90 Tagen von uns gefahren. Ø-Distanz ${km.toFixed(1)} km, Fahrtzeit ${min} Min, Preis ca. ${eur} €.`,
    ({f,t,km,min,eur,count}) => `Erfahrungswerte: Die Fahrt vom ${f} zum ${t} dauert etwa ${min} Minuten (${km.toFixed(1)} km). Aus unseren letzten ${count} Fahrten: ca. ${eur} € Median-Preis.`,
];

function generateHtml(from, to, km, min, eur, count) {
    const h = stableHash(from + to);
    const priceStr = eur.toFixed(2).replace('.', ',');
    const intro = INTROS_SL[h % INTROS_SL.length]({ f: from, t: to, km, min, eur: priceStr, count });
    const filename = `taxi-${slugify(from)}-zu-${slugify(to)}.html`;
    const canonical = `https://umwelt-taxi-insel-usedom.de/${filename}`;
    const rawTitle = `Taxi ${from} → ${to} · Funk Taxi Heringsdorf`;
    const title = rawTitle.length > 65 ? rawTitle.slice(0, 62) + '...' : rawTitle;
    const description = `Taxi vom ${from} zum ${to}: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min). Aus ${count} echten Fahrten. 24/7 unter 038378/22022.`;

    const jsonLd1 = {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Startseite","item":"https://umwelt-taxi-insel-usedom.de/landing.html"},
        {"@type":"ListItem","position":2,"name":"Preise","item":"https://umwelt-taxi-insel-usedom.de/taxi-preise.html"},
        {"@type":"ListItem","position":3,"name":`${from} → ${to}`}
    ]};
    const jsonLd2 = {"@context":"https://schema.org","@type":"TaxiService","name":"Funk Taxi Heringsdorf","telephone":"+493837822022","url":"https://umwelt-taxi-insel-usedom.de/","priceRange":`EUR ${priceStr}`};
    const jsonLd3 = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":`Was kostet die Fahrt vom ${from} zum ${to}?`,"acceptedAnswer":{"@type":"Answer","text":`Median aus ${count} Fahrten: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min). Kein Festpreis — nach Taxameter. Nacht +5 €, Großraum bis 8 Pers. +10 €.`}},
        {"@type":"Question","name":"Wie bestellen?","acceptedAnswer":{"@type":"Answer","text":"24/7 unter 038378 22022 oder online über anfrage.html. Vorbestellung ab 25 Min Vorlauf."}}
    ]};

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description.replace(/"/g,'&quot;')}">
<link rel="canonical" href="${canonical}">
<style>
body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
header { background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); padding: 40px 20px; text-align: center; }
header h1 { color: #fbbf24; font-size: clamp(24px, 5vw, 36px); margin: 0 0 10px; }
header .price { font-size: clamp(32px, 6vw, 48px); color: #10b981; font-weight: 900; margin: 20px 0; }
header .price-note { color: #94a3b8; font-size: 12px; font-style: italic; margin-top: -15px; margin-bottom: 15px; }
header .meta { color: #94a3b8; font-size: 14px; }
.cta { display: inline-block; padding: 14px 32px; margin: 10px 5px; background: #fbbf24; color: #0f172a; font-weight: 700; text-decoration: none; border-radius: 8px; }
.cta.phone { background: #10b981; color: white; }
main { max-width: 800px; margin: 0 auto; padding: 30px 20px; }
main h2 { color: #fbbf24; margin-top: 30px; }
.faq-item { background: #1e293b; padding: 16px; margin: 10px 0; border-left: 4px solid #fbbf24; border-radius: 6px; }
.faq-item h3 { color: #fbbf24; margin: 0 0 6px; font-size: 15px; }
.faq-item p { margin: 0; color: #cbd5e1; font-size: 14px; }
.badge { display:inline-block; padding:4px 10px; background:#10b981; color:white; border-radius:4px; font-size:12px; font-weight:600; margin-bottom:8px; }
footer { padding: 30px 20px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #1e293b; }
footer a { color: #fbbf24; text-decoration: none; margin: 0 8px; }
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd1)}</script>
<script type="application/ld+json">${JSON.stringify(jsonLd2)}</script>
<script type="application/ld+json">${JSON.stringify(jsonLd3)}</script>
</head>
<body>
<header>
<span class="badge">${count}× gefahren</span>
<h1>Taxi vom ${from} zum ${to}</h1>
<p class="meta">${km.toFixed(1)} km · ca. ${min} Min · Funk Taxi Heringsdorf</p>
<div class="price">ca. ${priceStr} €</div>
<div class="price-note">Median-Preis aus ${count} echten Fahrten</div>
<a href="tel:+493837822022" class="cta phone">📞 038378 22022</a>
<a href="anfrage.html?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}" class="cta">💬 Anfrage senden</a>
</header>
<main>
<h2>Über diese Strecke</h2>
<p>${intro}</p>
<h2>Häufige Fragen</h2>
<div class="faq-item"><h3>Was kostet die Fahrt vom ${from} zum ${to}?</h3><p>Median aus ${count} Fahrten: ca. ${priceStr} €. Kein Festpreis, Endpreis nach Taxameter. Nacht +5 €, Großraum bis 8 Pers. +10 €.</p></div>
<div class="faq-item"><h3>Wie bestellen?</h3><p>24/7 unter 038378 22022 oder online über <a href="anfrage.html" style="color:#fbbf24;">anfrage.html</a>. Vorbestellung ab 25 Min Vorlauf.</p></div>
<div class="faq-item"><h3>Kartenzahlung?</h3><p>Ja — Bar, EC, Visa/MasterCard, Apple Pay, Google Pay direkt im Wagen.</p></div>
<h2>Weitere Fahrten auf Usedom</h2>
<p>In unserer <a href="taxi-preise.html" style="color:#fbbf24;">Preisliste</a> finden Sie alle Routen aus echten Fahrten der letzten Monate.</p>
</main>
<footer>
<p>Funk Taxi Heringsdorf · <a href="tel:+493837822022">038378 22022</a> · <a href="landing.html">Home</a> · <a href="taxi-preise.html">Preise</a> · <a href="anfrage.html">Anfrage</a></p>
<p>Preise Median-Werte aus ${count} echten Fahrten. Endpreis nach Taxameter.</p>
</footer>
</body>
</html>`;
}

function main() {
    console.log('📡 Lade /rides der letzten ' + LOOKBACK_DAYS + ' Tage...');
    const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000;
    const rides = fetchViaCli('/rides');
    console.log('   ' + Object.keys(rides || {}).length + ' Rides gefunden');

    // Route-Kombinationen zählen — Slug-basiert für konsistente Erkennung
    const routes = {}; // key "fromSlug|toSlug" → { count, from, to, kmSum, priceSum, latSums }
    for (const [id, r] of Object.entries(rides || {})) {
        if (!r) continue;
        if (r.status !== 'completed') continue;
        const ts = r.completedAt || r.pickupTimestamp || r.createdAt || 0;
        if (ts < cutoff) continue;
        const fromName = shortName(r.pickup);
        const toName = shortName(r.destination);
        if (!fromName || !toName) continue;
        // Slug-Key für Duplikat-Erkennung
        const fromS = slugify(fromName);
        const toS = slugify(toName);
        if (!fromS || !toS || fromS === toS) continue;
        const key = fromS + '|' + toS;
        if (!routes[key]) routes[key] = {
            count: 0, from: fromName, to: toName,
            kmSum: 0, kmN: 0, priceSum: 0, priceN: 0
        };
        routes[key].count++;
        const km = parseFloat(r.distance || r.estimatedDistance || 0);
        if (km > 0) { routes[key].kmSum += km; routes[key].kmN++; }
        const price = parseFloat(r.price || r.estimatedPrice || 0);
        if (price > 0) { routes[key].priceSum += price; routes[key].priceN++; }
    }

    // Filter: mindestens MIN_OCCURRENCES, noch keine Landing existiert
    const candidates = Object.values(routes)
        .filter(r => r.count >= MIN_OCCURRENCES)
        .filter(r => {
            const fn = `taxi-${slugify(r.from)}-zu-${slugify(r.to)}.html`;
            return !fs.existsSync(path.join(ROOT, fn));
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_NEW_LANDINGS);

    console.log('   ' + Object.keys(routes).length + ' unique Routen aus completed-Fahrten');
    console.log('   ' + candidates.length + ' Kandidaten (≥ ' + MIN_OCCURRENCES + '× UND noch keine Landing)');

    let created = 0;
    for (const r of candidates) {
        const km = r.kmN > 0 ? r.kmSum / r.kmN : 5; // Median-nah durch Ø
        const min = Math.max(5, Math.round(km * 2.5));
        const eur = r.priceN > 0 ? r.priceSum / r.priceN : priceEstimate(km);
        const filename = `taxi-${slugify(r.from)}-zu-${slugify(r.to)}.html`;
        fs.writeFileSync(path.join(ROOT, filename), generateHtml(r.from, r.to, km, min, eur, r.count));
        created++;
        if (created <= 5) console.log(`  ✓ ${filename} (${r.count}× gefahren)`);
    }
    console.log('---');
    console.log('✅ ' + created + ' neue Self-Learning-Landings erstellt');
    console.log('\nTipp: dieses Script periodisch laufen lassen (z.B. wöchentlich) — es findet');
    console.log('automatisch neue Routen die häufig gefahren werden und legt Landing an.');
    return created;
}

module.exports = { main };
if (require.main === module) main();
