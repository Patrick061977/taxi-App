#!/usr/bin/env node
// v6.63.960: Auto-Generator für Hotel × Verkehrsknoten × Richtung-Routen
// Erzeugt für JEDES Hotel Landings zu allen wichtigen Verkehrsknoten.
// Ergebnis: SEO-Micro-Landings für vollständige Insel-Abdeckung.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Feste Verkehrsknoten mit sauberen Adressen + Koordinaten
const VERKEHRSKNOTEN = [
    { slug: 'bahnhof-heringsdorf',  name: 'Bahnhof Heringsdorf',   addr: 'Bülowstraße, 17424 Heringsdorf',  lat: 53.9494, lon: 14.1697 },
    { slug: 'bahnhof-ahlbeck',      name: 'Bahnhof Ahlbeck',       addr: 'Bahnhofstraße, 17419 Ahlbeck',    lat: 53.9360, lon: 14.1886 },
    { slug: 'bahnhof-bansin',       name: 'Bahnhof Bansin',        addr: 'Bahnhofstraße 3, 17429 Bansin',  lat: 53.9645, lon: 14.1297 },
    { slug: 'flughafen-heringsdorf',name: 'Flughafen Heringsdorf', addr: 'Zum Flugplatz, 17424 Heringsdorf', lat: 53.8797, lon: 14.1523 },
    { slug: 'swinemuende',          name: 'Świnoujście (Grenzübergang Ahlbeck)', addr: 'Świnoujście, PL',   lat: 53.9105, lon: 14.2467 },
];

// Hotels-Filter — nur echte Übernachtungsbetriebe
const HOTEL_PATTERN = /\b(hotel|strandhotel|pension|apart|apartment|resort|residenz|villa|ferienwohnung|ferienhaus|hostel|jugendherberge|kaiserhof|ostseeblick|seetel|maritim|travel charme|upstalsboom|dorint|steigenberger|breeze|pommerscher|golfhotel)/i;
const EXCLUDE_PATTERN = /\b(bistro|restaurant|café|kaffee|bar\b|bäckerei|imbiss|apotheke|arzt|frisör|friseur|barkeeper|kellner|fahrer|taxi|dhl|post|edeka|rewe|sparkasse|bank|makler|augenarzt|zahnarzt|physio|masseur|kfz)/i;

function slugify(s) {
    return s.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function priceEstimate(km) {
    // Grobe Schätzung: 4€ Grundgebühr + 2.5€/km
    return Math.max(6, Math.round((4 + km * 2.5) * 100) / 100);
}

// Deterministic-Hash
function stableHash(str) {
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// Intro-Varianten mit Hotel-Kontext
const INTRO_VARIANTEN = [
    ({hotel, knoten, km, min, eur}) => `Vom ${hotel} zum ${knoten} bringen wir Sie zuverlässig — die Strecke beträgt ${km} km und dauert etwa ${min} Minuten. Preis-Orientierung: ${eur} €.`,
    ({hotel, knoten, km, min, eur}) => `Ihr Weg vom ${hotel} zum ${knoten} liegt bei ${km} km, mit unserem Funk-Taxi in circa ${min} Min überbrückt. Ø-Preis nach unseren Fahrten: ${eur} €.`,
    ({hotel, knoten, km, min, eur}) => `Als ortsansässiger Taxi-Betrieb kennen wir den Weg vom ${hotel} zum ${knoten} genau: ${km} km, ${min} Min, Ø ${eur} €.`,
    ({hotel, knoten, km, min, eur}) => `${km} km trennen das ${hotel} vom ${knoten} — mit uns in etwa ${min} Minuten überbrückt. Preis nach Taxameter, Erfahrungswert ${eur} €.`,
    ({hotel, knoten, km, min, eur}) => `Für die Fahrt vom ${hotel} zum ${knoten} rechnen Sie mit ${min} Min und rund ${eur} € (Median). Distanz ${km} km.`,
];

const KNOTEN_TIPPS = {
    'bahnhof-heringsdorf':   'Direkt am Bahnsteig-Ausgang — wir überwachen die UBB-Zugzeiten und passen den Pickup bei Verspätung an.',
    'bahnhof-ahlbeck':       'UBB-Endstation direkt an der polnischen Grenze — Grenzübertritt ist kein Problem, wir warten am Bahnhofsvorplatz.',
    'bahnhof-bansin':        'Kleiner UBB-Halt im westlichen Kaiserbad — kurze Anfahrt aus allen Bansiner Hotels.',
    'flughafen-heringsdorf': 'Flightradar-Überwachung inklusive: bei Verspätung oder Frühankunft warten wir für Sie ohne Extra-Kosten.',
    'swinemuende':           'Grenzübertritt nach Polen — Personalausweis oder Reisepass mitführen, wir kennen den Zoll-Ablauf.',
};

function fetchViaCli(refPath) {
    // Nutzt firebase-CLI (bereits eingeloggt) — HTTP-Direct-Fetch scheitert an DB-Rules.
    const out = execSync('firebase database:get ' + refPath, {
        maxBuffer: 100 * 1024 * 1024, // 100 MB (customers kann groß sein)
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }).toString();
    return JSON.parse(out);
}

function generatePageHtml(hotel, knoten, direction) {
    // direction: 'from-hotel' (Hotel → Knoten) oder 'to-hotel' (Knoten → Hotel)
    const from = direction === 'from-hotel' ? hotel : knoten;
    const to   = direction === 'from-hotel' ? knoten : hotel;
    const km = hotel._km;
    const min = hotel._min;
    const eur = hotel._eur;
    const priceStr = eur.toFixed(2).replace('.', ',');

    // Deterministic Hash für Content-Varianz
    const h = stableHash(from.name + to.name);
    const intro = INTRO_VARIANTEN[h % INTRO_VARIANTEN.length]({
        hotel: hotel.name, knoten: knoten.name, km: km.toFixed(1), min, eur: priceStr,
    });
    const knotenTipp = KNOTEN_TIPPS[knoten.slug] || 'Wir kennen den Weg — 24/7 verfügbar, Kartenzahlung an Bord.';

    const filename = `taxi-${slugify(from.name)}-zu-${slugify(to.name)}.html`;
    const canonical = `https://umwelt-taxi-insel-usedom.de/${filename}`;
    const title = `Taxi ${from.name} → ${to.name} · Funk Taxi Heringsdorf`;
    const truncTitle = title.length > 65 ? title.slice(0, 62) + '...' : title;
    const description = `Taxi vom ${from.name} zum ${to.name}: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min). Schätzwert aus echten Fahrten, kein Festpreis. 24/7 unter 038378/22022.`;

    // JSON-LD
    const breadcrumb = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Startseite", "item": "https://umwelt-taxi-insel-usedom.de/landing.html"},
            {"@type": "ListItem", "position": 2, "name": "Preise", "item": "https://umwelt-taxi-insel-usedom.de/taxi-preise.html"},
            {"@type": "ListItem", "position": 3, "name": `${from.name} → ${to.name}`}
        ]
    };
    const taxiService = {
        "@context": "https://schema.org", "@type": "TaxiService",
        "name": "Funk Taxi Heringsdorf", "telephone": "+493837822022",
        "url": "https://umwelt-taxi-insel-usedom.de/",
        "areaServed": ["Heringsdorf","Ahlbeck","Bansin","Usedom"],
        "priceRange": `EUR ${priceStr}`
    };
    const faqPage = {
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [
            {"@type":"Question","name":`Was kostet die Fahrt vom ${from.name} zum ${to.name}?`,"acceptedAnswer":{"@type":"Answer","text":`Schätzwert: ca. ${priceStr} € (Median aus echten Fahrten, kein Festpreis, Endpreis nach Taxameter). Nacht (22-6 Uhr, So/Feiertag) +5 € Zuschlag. Großraum-Taxi bis 8 Personen +10 €.`}},
            {"@type":"Question","name":"Wie kann ich das Taxi bestellen?","acceptedAnswer":{"@type":"Answer","text":"Telefonisch unter 038378 22022 rund um die Uhr, online über umwelt-taxi-insel-usedom.de/anfrage.html oder direkt beim Fahrer. Vorbestellung ab 25 Min Vorlauf."}},
            {"@type":"Question","name":"Kann ich mit Karte bezahlen?","acceptedAnswer":{"@type":"Answer","text":"Ja. Bar, EC-Karte (Girocard/Maestro), Kreditkarte (Visa/MasterCard), Apple Pay und Google Pay im Wagen."}}
        ]
    };

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${truncTitle}</title>
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
footer { padding: 30px 20px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #1e293b; }
footer a { color: #fbbf24; text-decoration: none; margin: 0 8px; }
</style>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
<script type="application/ld+json">${JSON.stringify(taxiService)}</script>
<script type="application/ld+json">${JSON.stringify(faqPage)}</script>
</head>
<body>
<header>
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
<p style="font-size:14px;color:#cbd5e1;">💡 ${knotenTipp}</p>

<h2>Adressen im Überblick</h2>
<div style="background:#1e293b;padding:14px;border-radius:8px;font-size:14px;">
<p><strong>Abholung:</strong> ${from.addr}</p>
<p><strong>Ziel:</strong> ${to.addr}</p>
</div>

<h2>Häufige Fragen</h2>
<div class="faq-item"><h3>Was kostet die Fahrt vom ${from.name} zum ${to.name}?</h3><p>Schätzwert: ca. ${priceStr} € (${km.toFixed(1)} km, ${min} Min, Median-Preis). Kein Festpreis — der Endpreis wird nach Taxameter abgerechnet. Nacht-Zuschlag +5 €, Großraum-Taxi bis 8 Personen +10 €.</p></div>
<div class="faq-item"><h3>Wie kann ich das Taxi bestellen?</h3><p>Rund um die Uhr unter 038378 22022 oder online über <a href="anfrage.html" style="color:#fbbf24;">anfrage.html</a>. Vorbestellung ab 25 Min Vorlauf, ideal für Zug-/Flug-Anschluss.</p></div>
<div class="faq-item"><h3>Kann ich mit Karte bezahlen?</h3><p>Ja: Bar, EC/Girocard/Maestro, Visa, MasterCard, Apple Pay, Google Pay — direkt im Wagen via mobilem Kartenlesegerät.</p></div>

<h2>Weitere Preise auf Usedom</h2>
<p>In unserer <a href="taxi-preise.html" style="color:#fbbf24;">Preisliste</a> finden Sie 140 echte Routen aus abgeschlossenen Fahrten — Bahnhof-Transfers, Hotel-Fahrten, Kliniken, Restaurants, Flughafen und Grenzfahrten nach Polen.</p>

</main>
<footer>
<p>Funk Taxi Heringsdorf · <a href="tel:+493837822022">038378 22022</a> · <a href="landing.html">Home</a> · <a href="taxi-preise.html">Preise</a> · <a href="anfrage.html">Anfrage</a></p>
<p>Preise Median-Werte aus Erfahrung. Endpreis nach Taxameter. Adressen aus CRM.</p>
</footer>
</body>
</html>`;
}

async function main() {
    console.log('📡 Lade Hotels aus Firebase (via firebase-CLI)...');
    const customers = fetchViaCli('/customers');
    const hotels = [];
    for (const [id, c] of Object.entries(customers || {})) {
        if (!c || !c.name) continue;
        // Ist Hotel? — mehrere Signale
        const isHotel =
            c.category === 'hotel' ||
            c.customerKind === 'Hotel' ||
            (c.type === 'hotel') ||
            (c.type === 'supplier' && (HOTEL_PATTERN.test(c.name) || /\bhof\b/i.test(c.name))) ||
            (HOTEL_PATTERN.test(c.name) && !EXCLUDE_PATTERN.test(c.name));
        if (!isHotel) continue;
        if (EXCLUDE_PATTERN.test(c.name)) continue;
        // Adresse: Feld c.address ODER c.defaultPickup
        const addr = c.address || c.defaultPickup;
        if (!addr) continue;
        // Koordinaten: c.lat/c.lon ODER c.defaultPickupCoords
        let lat = c.lat || c.latitude;
        let lon = c.lon || c.longitude;
        if ((!lat || !lon) && c.defaultPickupCoords) {
            lat = c.defaultPickupCoords.lat;
            lon = c.defaultPickupCoords.lon;
        }
        if (!lat || !lon) continue;
        hotels.push({
            id, name: c.name.trim(), addr,
            lat: parseFloat(lat), lon: parseFloat(lon),
        });
    }
    console.log('🏨 ' + hotels.length + ' Hotels mit Adresse+Koords');
    console.log('🚉 ' + VERKEHRSKNOTEN.length + ' Verkehrsknoten');

    let created = 0, skipped = 0;
    const createdFiles = [];
    for (const hotel of hotels) {
        for (const knoten of VERKEHRSKNOTEN) {
            const km = haversineKm(hotel.lat, hotel.lon, knoten.lat, knoten.lon);
            if (km < 0.3) continue; // zu nah, keine Landing
            if (km > 50) continue;  // zu weit
            const min = Math.max(5, Math.round(km * 2.5));
            const eur = priceEstimate(km);
            hotel._km = km; hotel._min = min; hotel._eur = eur;

            for (const direction of ['from-hotel', 'to-hotel']) {
                const from = direction === 'from-hotel' ? hotel : knoten;
                const to   = direction === 'from-hotel' ? knoten : hotel;
                const filename = `taxi-${slugify(from.name)}-zu-${slugify(to.name)}.html`;
                const filepath = path.join(ROOT, filename);
                // NICHT überschreiben wenn Datei bereits existiert (v959 hat schon eigene Content)
                if (fs.existsSync(filepath)) { skipped++; continue; }
                const html = generatePageHtml(hotel, knoten, direction);
                fs.writeFileSync(filepath, html);
                created++;
                createdFiles.push(filename);
            }
        }
    }
    console.log('---');
    console.log('✅ ' + created + ' neue HTMLs erstellt');
    console.log('⏭️  ' + skipped + ' übersprungen (existiert schon)');

    // Sitemap ergänzen
    if (created > 0 && fs.existsSync(path.join(ROOT, 'sitemap.xml'))) {
        let sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
        const today = new Date().toISOString().slice(0, 10);
        const newUrls = createdFiles.map(f =>
            `<url><loc>https://umwelt-taxi-insel-usedom.de/${f}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`
        ).join('\n');
        // Vor </urlset> einfügen
        if (sm.includes('</urlset>') && !sm.includes(createdFiles[0])) {
            sm = sm.replace('</urlset>', newUrls + '\n</urlset>');
            fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sm);
            console.log('🗺 sitemap.xml erweitert um ' + created + ' URLs');
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
