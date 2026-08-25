#!/usr/bin/env node
// v6.63.961: Kaiserbäder-Hub-Netz — Heringsdorf/Ahlbeck/Bansin als Hotspots
// zu ALLEN wichtigen Zielen auf/um Usedom.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Startpunkte — die Kaiserbäder als zentrale Hotspots
const HOTSPOTS = [
    { slug: 'heringsdorf', name: 'Heringsdorf', addr: 'Ortsmitte, 17424 Heringsdorf', lat: 53.9514, lon: 14.1700 },
    { slug: 'ahlbeck',     name: 'Ahlbeck',     addr: 'Ortsmitte, 17419 Ahlbeck',     lat: 53.9341, lon: 14.1935 },
    { slug: 'bansin',      name: 'Bansin',      addr: 'Ortsmitte, 17429 Bansin',      lat: 53.9570, lon: 14.1400 },
];

// Ziele — alle wichtigen Punkte innerhalb + außerhalb der Insel
const ZIELE = [
    // Krankenhäuser + medizinische Einrichtungen
    { slug: 'krankenhaus-anklam',            name: 'Krankenhaus Anklam',            addr: 'Am Klinikum 1, 17389 Anklam',                     lat: 53.855, lon: 13.685, kat: 'Krankenhaus' },
    { slug: 'krankenhaus-wolgast',           name: 'Krankenhaus Wolgast',           addr: 'Chausseestraße 46, 17438 Wolgast',                 lat: 54.052, lon: 13.777, kat: 'Krankenhaus' },
    { slug: 'universitaetsmedizin-greifswald',name:'Universitätsmedizin Greifswald', addr:'Ferdinand-Sauerbruch-Straße, 17475 Greifswald',    lat: 54.096, lon: 13.408, kat: 'Krankenhaus' },
    { slug: 'mvz-koserow',                   name: 'MVZ Koserow',                   addr: 'Medizinisches Versorgungszentrum, 17459 Koserow',  lat: 54.043, lon: 13.995, kat: 'MVZ' },
    { slug: 'rehaklinik-ahlbeck',            name: 'Rehaklinik Seebad Ahlbeck',     addr: 'Kieferngrund, 17419 Ahlbeck-Kaiserbäder',          lat: 53.938, lon: 14.192, kat: 'Reha-Klinik' },
    { slug: 'rehaklinik-usedom',             name: 'Rehaklinik Usedom',             addr: 'Setheweg, 17424 Heringsdorf',                      lat: 53.953, lon: 14.167, kat: 'Reha-Klinik' },
    // Verkehrsknoten
    { slug: 'bahnhof-zinnowitz',             name: 'Bahnhof Zinnowitz',             addr: 'Bahnhofstraße, 17454 Zinnowitz',                   lat: 54.075, lon: 13.910, kat: 'Bahnhof' },
    { slug: 'bahnhof-koserow',               name: 'Bahnhof Koserow',               addr: 'Bahnhofstraße, 17459 Koserow',                     lat: 54.049, lon: 14.001, kat: 'Bahnhof' },
    { slug: 'bahnhof-zuessow',               name: 'Bahnhof Züssow',                addr: 'Bahnhof, 17495 Züssow',                            lat: 53.945, lon: 13.653, kat: 'Bahnhof' },
    // Sehenswürdigkeiten + Museen
    { slug: 'peenemuende-museum',            name: 'Historisch-Technisches Museum Peenemünde', addr:'Im Kraftwerk, 17449 Peenemünde',        lat: 54.140, lon: 13.771, kat: 'Museum' },
    { slug: 'ostseetherme-usedom',           name: 'Ostsee-Therme Usedom',          addr: 'Lindenstraße 90, 17424 Heringsdorf',               lat: 53.949, lon: 14.147, kat: 'Freizeit' },
    { slug: 'bernsteintherme-zinnowitz',     name: 'Bernsteintherme Zinnowitz',     addr: 'Dünenstraße, 17454 Zinnowitz',                     lat: 54.076, lon: 13.912, kat: 'Freizeit' },
    { slug: 'schmetterlingsfarm-trassenheide',name:'Schmetterlingsfarm Trassenheide', addr:'Karlshagener Straße, 17449 Trassenheide',         lat: 54.069, lon: 13.867, kat: 'Freizeit' },
    { slug: 'baumwipfelpfad-usedom',         name: 'Baumwipfelpfad Usedom',         addr: 'Am Bahnhof, 17424 Heringsdorf',                    lat: 53.950, lon: 14.170, kat: 'Freizeit' },
    { slug: 'muritzeum-waren',               name: 'Müritzeum Waren',               addr: 'Zur Steinmole, 17192 Waren',                       lat: 53.520, lon: 12.681, kat: 'Museum' },
    // Fern-Ziele
    { slug: 'flughafen-berlin-ber',          name: 'Flughafen Berlin BER',          addr: 'Willy-Brandt-Platz, 12529 Schönefeld',             lat: 52.365, lon: 13.510, kat: 'Fern' },
    { slug: 'berlin-hauptbahnhof',           name: 'Berlin Hauptbahnhof',           addr: 'Europaplatz 1, 10557 Berlin',                      lat: 52.525, lon: 13.369, kat: 'Fern' },
    { slug: 'flughafen-hamburg',             name: 'Flughafen Hamburg',             addr: 'Flughafenstraße 1-3, 22335 Hamburg',               lat: 53.630, lon: 9.988,  kat: 'Fern' },
    { slug: 'flughafen-rostock-laage',       name: 'Flughafen Rostock-Laage',       addr: 'Flughafenstraße 1, 18299 Laage',                   lat: 53.917, lon: 12.284, kat: 'Fern' },
    // Golf + Sport
    { slug: 'golfhotel-balmer-see',          name: 'Golfhotel Balmer See',          addr: 'Balmer See 1, 17429 Balm',                         lat: 53.929, lon: 14.070, kat: 'Sport' },
    // Zusätzliche Kaiserbäder-Sehenswürdigkeiten
    { slug: 'seebruecke-heringsdorf',        name: 'Seebrücke Heringsdorf',         addr: 'Kulmstraße, 17424 Heringsdorf',                    lat: 53.949, lon: 14.170, kat: 'Sehenswürdigkeit' },
    { slug: 'seebruecke-ahlbeck',            name: 'Seebrücke Ahlbeck',             addr: 'Dünenstraße, 17419 Ahlbeck',                       lat: 53.947, lon: 14.220, kat: 'Sehenswürdigkeit' },
    { slug: 'seebruecke-bansin',             name: 'Seebrücke Bansin',              addr: 'Strandpromenade, 17429 Bansin',                    lat: 53.976, lon: 14.111, kat: 'Sehenswürdigkeit' },
];

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
function priceEstimate(km) { return Math.max(6, Math.round((4 + km * 2.5) * 100) / 100); }
function stableHash(str) { let h=0; for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))|0; return Math.abs(h); }

const INTROS = [
    ({f,t,km,min,eur,kat}) => `Vom ${f.name} zum ${t.name} bringen wir Sie in etwa ${min} Minuten (${km.toFixed(1)} km). Als etabliertes ${kat}-Ziel gehört diese Fahrt zu unseren Standardstrecken. Preis-Orientierung: ${eur} €.`,
    ({f,t,km,min,eur,kat}) => `${km.toFixed(1)} km trennen ${f.name} vom ${t.name} — mit unserem Funk-Taxi in rund ${min} Min überbrückt. Ø-Preis: ${eur} €.`,
    ({f,t,km,min,eur,kat}) => `Für die Fahrt vom ${f.name} zum ${t.name} rechnen Sie mit ${min} Minuten Fahrtzeit und einem Erfahrungspreis von ca. ${eur} € (${km.toFixed(1)} km).`,
    ({f,t,km,min,eur,kat}) => `Wir kennen den Weg vom ${f.name} zum ${t.name} — ${km.toFixed(1)} km, ${min} Min, Ø ${eur} € nach unseren letzten Fahrten dieser Strecke.`,
];

const KAT_TIPPS = {
    'Krankenhaus':    'Krankenhaus-Fahrten sind unser Alltag — wir bringen Sie pünktlich zur Aufnahme oder zum ambulanten Termin, auch mit Rollstuhl.',
    'MVZ':            'MVZ-Termine haben feste Uhrzeiten — Vorbestellung mit 60 Min Vorlauf empfehlen wir, damit wir Sie stressfrei hinbringen.',
    'Reha-Klinik':    'Für Ihre Reha-Anreise transportieren wir auch Gepäck ohne Aufpreis und warten falls nötig auf Empfang.',
    'Bahnhof':        'UBB/DB-Verspätung ist kein Problem — wir überwachen die Zug-Ankunftszeiten und passen den Pickup automatisch an.',
    'Museum':         'Ideal für Ausflüge — wir empfehlen die Fahrt mit Rückholung nach Museumsschluss, bitte einfach beim Buchen angeben.',
    'Freizeit':       'Für Wellness/Freizeit-Ausflüge: wir können Sie auch später wieder abholen, einfach beim Buchen mitgeben.',
    'Fern':           'Fernfahrten planen wir 24-48 h im Voraus — Festpreis-Angebot auf Anfrage, Kartenzahlung an Bord.',
    'Sport':          'Golfausrüstung, Fahrräder oder Sportgepäck — kein Problem, sagen Sie einfach Bescheid.',
    'Sehenswürdigkeit': 'Bei kurzen Wegen zu den Seebrücken sind wir meist innerhalb 5-10 Minuten bei Ihnen — auch spontan.',
};

function generateHtml(from, to, km, min, eur, kat) {
    const h = stableHash(from.name + to.name);
    const priceStr = eur.toFixed(2).replace('.', ',');
    const intro = INTROS[h % INTROS.length]({ f: from, t: to, km, min, eur: priceStr, kat });
    const katTipp = KAT_TIPPS[kat] || 'Wir kennen den Weg — 24/7 verfügbar, Kartenzahlung an Bord.';
    const filename = `taxi-${slugify(from.name)}-zu-${slugify(to.name)}.html`;
    const canonical = `https://umwelt-taxi-insel-usedom.de/${filename}`;
    const rawTitle = `Taxi ${from.name} → ${to.name} · Funk Taxi Heringsdorf`;
    const title = rawTitle.length > 65 ? rawTitle.slice(0, 62) + '...' : rawTitle;
    const description = `Taxi vom ${from.name} zum ${to.name}: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min). Schätzwert, kein Festpreis. 24/7 unter 038378/22022.`;

    const jsonLd1 = {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Startseite","item":"https://umwelt-taxi-insel-usedom.de/landing.html"},
        {"@type":"ListItem","position":2,"name":kat,"item":"https://umwelt-taxi-insel-usedom.de/taxi-preise.html"},
        {"@type":"ListItem","position":3,"name":`${from.name} → ${to.name}`}
    ]};
    const jsonLd2 = {"@context":"https://schema.org","@type":"TaxiService","name":"Funk Taxi Heringsdorf","telephone":"+493837822022","url":"https://umwelt-taxi-insel-usedom.de/","areaServed":["Heringsdorf","Ahlbeck","Bansin","Usedom"],"priceRange":`EUR ${priceStr}`};
    const jsonLd3 = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":`Was kostet die Fahrt vom ${from.name} zum ${to.name}?`,"acceptedAnswer":{"@type":"Answer","text":`Schätzwert: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min, Median-Preis). Kein Festpreis — nach Taxameter. Nacht +5 €, Großraum bis 8 Pers. +10 €.`}},
        {"@type":"Question","name":"Wie kann ich das Taxi bestellen?","acceptedAnswer":{"@type":"Answer","text":"24/7 unter 038378 22022 oder online über anfrage.html. Vorbestellung ab 25 Min Vorlauf, für Reha/Klinik-Anreise 60+ Min empfohlen."}},
        {"@type":"Question","name":"Kann ich mit Karte bezahlen?","acceptedAnswer":{"@type":"Answer","text":"Ja. Bar, EC/Girocard, Visa/MasterCard, Apple Pay, Google Pay direkt im Wagen."}}
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
.kat-badge { display:inline-block; padding:4px 10px; background:#3b82f6; color:white; border-radius:4px; font-size:12px; font-weight:600; margin-bottom:8px; }
footer { padding: 30px 20px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #1e293b; }
footer a { color: #fbbf24; text-decoration: none; margin: 0 8px; }
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd1)}</script>
<script type="application/ld+json">${JSON.stringify(jsonLd2)}</script>
<script type="application/ld+json">${JSON.stringify(jsonLd3)}</script>
</head>
<body>
<header>
<span class="kat-badge">${kat}</span>
<h1>Taxi vom ${from.name} zum ${to.name}</h1>
<p class="meta">${km.toFixed(1)} km · ca. ${min} Min · Funk Taxi Heringsdorf</p>
<div class="price">ca. ${priceStr} €</div>
<div class="price-note">Schätzwert — kein Festpreis, Endpreis nach Taxameter</div>
<a href="tel:+493837822022" class="cta phone">📞 038378 22022</a>
<a href="anfrage.html?from=${encodeURIComponent(from.name)}&to=${encodeURIComponent(to.name)}" class="cta">💬 Anfrage senden</a>
</header>
<main>
<h2>Über diese Strecke</h2>
<p>${intro}</p>
<p style="font-size:14px;color:#cbd5e1;">💡 ${katTipp}</p>

<h2>Adressen im Überblick</h2>
<div style="background:#1e293b;padding:14px;border-radius:8px;font-size:14px;">
<p><strong>Abholung:</strong> ${from.addr}</p>
<p><strong>Ziel:</strong> ${to.addr}</p>
</div>

<h2>Häufige Fragen</h2>
<div class="faq-item"><h3>Was kostet die Fahrt vom ${from.name} zum ${to.name}?</h3><p>Schätzwert: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min). Kein Festpreis, Endpreis nach Taxameter. Nacht +5 €, Großraum bis 8 Pers. +10 €.</p></div>
<div class="faq-item"><h3>Wie bestellen?</h3><p>24/7 unter 038378 22022 oder online über <a href="anfrage.html" style="color:#fbbf24;">anfrage.html</a>. Vorbestellung ab 25 Min, für Klinik-Fahrten 60+ Min empfohlen.</p></div>
<div class="faq-item"><h3>Kartenzahlung möglich?</h3><p>Ja — Bar, EC, Visa/MasterCard, Apple Pay, Google Pay direkt im Wagen.</p></div>

<h2>Weitere Fahrten</h2>
<p>In unserer <a href="taxi-preise.html" style="color:#fbbf24;">Preisliste</a> finden Sie alle Routen aus echten Fahrten — Bahnhof-Transfers, Hotels, Kliniken, Restaurants, Flughafen und Grenzfahrten nach Polen.</p>
</main>
<footer>
<p>Funk Taxi Heringsdorf · <a href="tel:+493837822022">038378 22022</a> · <a href="landing.html">Home</a> · <a href="taxi-preise.html">Preise</a> · <a href="anfrage.html">Anfrage</a></p>
<p>Preise Median-Werte aus Erfahrung. Endpreis nach Taxameter. Fern-Fahrten Festpreis auf Anfrage.</p>
</footer>
</body>
</html>`;
}

function main() {
    let created = 0, skipped = 0;
    for (const from of HOTSPOTS) {
        for (const to of ZIELE) {
            const km = haversineKm(from.lat, from.lon, to.lat, to.lon);
            if (km < 0.3) continue;
            if (km > 250) continue; // Fern-Ziele bis 250 km ok
            const min = Math.max(5, Math.round(km * 1.5)); // Fern: Autobahn schneller
            const eur = priceEstimate(km);

            for (const dir of ['from-hub', 'to-hub']) {
                const f = dir === 'from-hub' ? from : to;
                const t = dir === 'from-hub' ? to : from;
                const filename = `taxi-${slugify(f.name)}-zu-${slugify(t.name)}.html`;
                const filepath = path.join(ROOT, filename);
                if (fs.existsSync(filepath)) { skipped++; continue; }
                fs.writeFileSync(filepath, generateHtml(f, t, km, min, eur, to.kat));
                created++;
            }
        }
    }
    console.log('✅ ' + created + ' neue Kaiserbäder-Hub-Landings');
    console.log('⏭️  ' + skipped + ' schon vorhanden');
    return created;
}

module.exports = { main, HOTSPOTS, ZIELE };
if (require.main === module) main();
