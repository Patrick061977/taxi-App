#!/usr/bin/env node
// Generiert Bilder für Placeholder-POIs in ausflugsziele.html via Gemini Imagen 3
// Verwendung: GEMINI_API_KEY=xxx node scripts/generate-poi-images.js
// API-Key kostenlos: https://aistudio.google.com → "Get API key"

const https = require('https');
const fs   = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY fehlt. Holen unter: https://aistudio.google.com');
    process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, '..', 'images', 'poi');

// ── Stil-Templates ─────────────────────────────────────────────────────────────
const TAXI = "A bright yellow Tesla Model Y taxi with 'keinbockzulaufen.de FUNKTAXI 038378-22022' visible. No humans entering or exiting vehicles.";

const STYLE = {
    kultur: (poi, loc) =>
        `A traditional oil painting in classical Hudson River School / 19th-century European romantic style of ${poi} in ${loc}. Warm golden afternoon light, soft brushstrokes, detailed architectural reverence, atmospheric perspective. Period-appropriate human figures in subtle interaction. ${TAXI} Parked respectfully in foreground left. Cinematic 16:9 composition, museum-quality oil-on-canvas finish.`,

    familie: (poi, loc, feature) =>
        `Studio Ghibli style hand-drawn watercolor animation of ${poi} in ${loc}. Soft pastel colors, warm golden afternoon light, whimsical family-friendly atmosphere. A family (mother, father, two children) already standing or walking joyfully towards ${feature}. ${TAXI} visible in lower-left, family clearly outside the car. Two seagulls in the sky, vibrant Ghibli outdoor colors. 16:9 cinematic composition.`,

    natur: (poi, loc) =>
        `A delicate watercolor nature illustration in the style of botanical/landscape artists like Beatrix Potter, depicting ${poi} in ${loc}. Soft washes of green, ochre and sky-blue, fine ink line work. Small group of visitors in modern outdoor attire walking along path/boardwalk. Native Baltic vegetation prominently rendered. ${TAXI} parked at the trailhead, subtle integration. Wide 16:9 golden-hour light.`,

    strand: (poi, loc, feature) =>
        `A vintage 1960s seaside postcard illustration, Baltic-Sea resort poster style (Charley Harper meets retro travel-poster). Bright pastel colors, turquoise sea, golden sand, white architecture. Families on beach, Strandkörbe, ${feature}. ${TAXI} parked at promenade entrance. 16:9 horizontal poster-style composition.`,
};

// ── POI-Liste: nur Platzhalter ──────────────────────────────────────────────────
const POIS = [
    {
        slug:   'schmetterlingsfarm-trassenheide',
        name:   'Schmetterlingsfarm Trassenheide',
        cat:    'familie',
        loc:    'Trassenheide, Usedom',
        feature:'a tropical butterfly enclosure with giant colorful butterflies',
    },
    {
        slug:   'streckelsberg-koserow',
        name:   'Streckelsberg Koserow',
        cat:    'natur',
        loc:    'Koserow, Usedom — highest dune on the island',
    },
    {
        slug:   'swinoujscie-promenade',
        name:   'Świnoujście Promenade',
        cat:    'strand',
        loc:    'Świnoujście, Poland, Baltic Sea',
        feature:'the long promenade with historic spa architecture and Polish seaside charm',
    },
    {
        slug:   'insel-safari-usedom',
        name:   'Insel-Safari Usedom',
        cat:    'natur',
        loc:    'Wolgast, near Usedom — open-air wildlife safari park',
    },
    {
        slug:   'tropenhaus-bansin',
        name:   'Tropenhaus Zoo Bansin',
        cat:    'familie',
        loc:    'Seebad Bansin, Usedom',
        feature:'a tropical greenhouse full of exotic plants and animals',
    },
    {
        slug:   'tauchgondel-zinnowitz',
        name:   'Tauchgondel Zinnowitz',
        cat:    'familie',
        loc:    'Seebrücke Zinnowitz, Usedom',
        feature:'a unique submarine gondola descending into the Baltic Sea from a pier',
    },
    {
        slug:   'u-boot-peenemuende',
        name:   'U-Boot Museum Peenemünde',
        cat:    'kultur',
        loc:    'Peenemünde harbour, Usedom',
    },
    {
        slug:   'baumwipfelpfad-heringsdorf',
        name:   'Baumwipfelpfad Heringsdorf',
        cat:    'natur',
        loc:    'Heringsdorf forest, Usedom — elevated treetop walkway',
    },
];

// ── Gemini 2.5 Flash Image API Call (generateContent mit IMAGE-Modalität) ───────
function generateImage(prompt, slug) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.5-flash-image:generateContent?key=${API_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };

        const req = https.request(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) { reject(new Error(json.error.message)); return; }
                    // Bild ist in candidates[0].content.parts als inlineData
                    const parts = json.candidates?.[0]?.content?.parts || [];
                    const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
                    if (!imgPart) { reject(new Error('Kein Bild in Antwort: ' + data.slice(0,300))); return; }
                    const ext = imgPart.inlineData.mimeType.includes('png') ? 'png' : 'jpg';
                    const outPath = path.join(OUT_DIR, slug + '.' + ext);
                    fs.writeFileSync(outPath, Buffer.from(imgPart.inlineData.data, 'base64'));
                    resolve(outPath);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`🎨 Generiere ${POIS.length} POI-Bilder via Gemini Imagen 3...\n`);
    for (const p of POIS) {
        let prompt;
        if      (p.cat === 'kultur')  prompt = STYLE.kultur(p.name, p.loc);
        else if (p.cat === 'familie') prompt = STYLE.familie(p.name, p.loc, p.feature);
        else if (p.cat === 'natur')   prompt = STYLE.natur(p.name, p.loc);
        else if (p.cat === 'strand')  prompt = STYLE.strand(p.name, p.loc, p.feature);

        process.stdout.write(`▶ ${p.name} (${p.cat})... `);
        try {
            const outPath = await generateImage(prompt, p.slug);
            console.log(`✅ → ${path.basename(outPath)}`);
        } catch (e) {
            console.log(`❌ Fehler: ${e.message}`);
        }
        // 2s Pause zwischen Requests (Rate-Limit)
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log('\n✅ Fertig! Bilder in images/poi/');
    console.log('Jetzt ausflugsziele.html aktualisieren — die img:-Pfade auf picsum.photos ersetzen.\n');
    // Gibt die neuen Pfade für ausflugsziele.html aus
    console.log('── Für ausflugsziele.html ───────────────────────────────');
    for (const p of POIS) {
        console.log(`  img: 'images/poi/${p.slug}.jpg',   // ${p.name}`);
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
