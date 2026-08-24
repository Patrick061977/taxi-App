#!/usr/bin/env node
// v6.63.954: Landing-Page-Inventar-Scanner
// Scannt alle *.html im Repo-Root, extrahiert SEO-Metriken pro Datei,
// schreibt landing-inventar.json für landing-uebersicht.html.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'landing-inventar.json');

const BLACKLIST = new Set([
    'PENDING-MONITOR.html', 'SYSTEM-MONITOR.html', 'monitor.html',
    'FUNKTIONS-REFERENZ.html', 'FUNKTIONS-SUCHE.html', 'HILFE.html',
    'admin-log-viewer.html', 'change-viewer.html', 'log-viewer.html',
    'function-explorer.html', 'places-test.html', 'test-vorbestellung.html',
    'konflikt-tester.html', 'datetime-picker.html', 'gps-track.html',
    'buchung-test.html', 'jimdo-buttons.html', 'icon-preview.html',
    'dms.html', 'app-download.html', 'anrufstatistik.html',
    'mitarbeiter.html', 'schichtplan.html', 'tagesplan.html',
    'rechnung.html', 'fahrer-map.html', 'index.html',
    'landing-inventar.html', 'landing-uebersicht.html',
    'buchen-demo-a.html', 'buchen-demo-b.html', 'buchen-demo-c.html', 'buchen-demo-d.html',
    'buchen-v2.html', 'track.html', 'kunden.html', 'stornierung.html',
    'agb.html', 'datenschutz.html', 'impressum.html',
    'googleb29a71be78bd0c12.html', 'google5b05bd63482e6114.html',
]);

const CATEGORIES = {
    'taxi-.*-zu-.*': 'SEO-Micro-Route',
    'taxi-.*-bahnhof': 'Bahnhofs-Landing',
    'taxi-.*-hotel': 'Hotel-Landing',
    'taxi-.*-krankenhaus': 'Krankenhaus-Landing',
    'taxi-.*-swinemuende': 'Grenz-Landing',
    'taxi-.*-preise': 'Preis-Landing',
    'taxi-usedom-.*': 'Region-Landing',
    'taxi-heringsdorf-.*|taxi-ahlbeck-.*|taxi-bansin-.*|taxi-koserow-.*|taxi-zinnowitz-.*|taxi-ueckeritz-.*|taxi-trassenheide-.*|taxi-swinemuende-.*': 'Ort-Landing',
    'landing.*': 'Startseite/Landing',
    'flughafen.*': 'Flughafen-Landing',
    'krankenfahrt.*|krankenfahrten.*': 'Krankenfahrt-Landing',
    'bahnhofstransfer.*': 'Bahnhof-Transfer-Landing',
    'grossraumtaxi.*|grosstaxi.*': 'Großraum-Landing',
    'inselfahrten.*': 'Inselfahrten-Landing',
    'restaurants.*': 'Restaurant-Landing',
    'ausflugsziele.*|reise-radar.*|urlaub.*|veranstaltungen.*': 'Ausflugs-/Info-Landing',
    'kein-bock.*|keinbock.*': 'Kampagnen-Landing',
    'sammeltaxi.*|ruftaxi.*|taxi-22022.*': 'Service-Landing',
    'anfrage.*|buchen.*|kontakt.*|hotel.*': 'Funktions-Seite',
    'pauschalpreise.*': 'Pauschal-Landing',
    'berlin.*': 'Berlin-Shuttle',
    'bahnhof-.*': 'Bahnhof-Landing',
};

const ORTE = ['Heringsdorf', 'Ahlbeck', 'Bansin', 'Zinnowitz', 'Koserow', 'Ückeritz', 'Trassenheide', 'Karlshagen', 'Peenemünde', 'Świnoujście', 'Swinemünde', 'Usedom', 'Wolgast', 'Anklam', 'Greifswald', 'Berlin'];

function categorize(filename) {
    for (const [pattern, cat] of Object.entries(CATEGORIES)) {
        if (new RegExp('^' + pattern + '\\.html$').test(filename)) return cat;
    }
    return 'Sonstige';
}

function detectOrte(text) {
    const found = new Set();
    for (const ort of ORTE) {
        if (new RegExp('\\b' + ort + '\\b', 'i').test(text)) found.add(ort);
    }
    return Array.from(found);
}

function extractMeta(html, ...names) {
    for (const name of names) {
        const re = new RegExp(`<meta\\s+(?:[^>]*?\\b(?:name|property)=["']${name}["'])[^>]*?content=["']([^"']*)["']`, 'i');
        const m = html.match(re);
        if (m) return m[1];
        const re2 = new RegExp(`<meta\\s+(?:[^>]*?\\bcontent=["']([^"']*)["'])[^>]*?(?:name|property)=["']${name}["']`, 'i');
        const m2 = html.match(re2);
        if (m2) return m2[1];
    }
    return null;
}

function analyzeFile(filepath) {
    const filename = path.basename(filepath);
    const html = fs.readFileSync(filepath, 'utf8');
    const size = fs.statSync(filepath).size;

    // Title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Meta
    const description = extractMeta(html, 'description') || '';
    const keywords = extractMeta(html, 'keywords') || '';
    const ogTitle = extractMeta(html, 'og:title') || '';
    const ogDescription = extractMeta(html, 'og:description') || '';
    const ogImage = extractMeta(html, 'og:image') || '';
    const canonical = (html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i) || [])[1] || '';
    const hreflangCount = (html.match(/<link\s+rel=["']alternate["']\s+hreflang=/gi) || []).length;

    // Headings
    const h1s = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(h => h.replace(/<[^>]+>/g, '').trim());
    const h2s = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(h => h.replace(/<[^>]+>/g, '').trim());
    const h3s = (html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || []).length;

    // JSON-LD
    const jsonLdBlocks = (html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []);
    const jsonLdTypes = [];
    for (const block of jsonLdBlocks) {
        const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
        try {
            const parsed = JSON.parse(inner);
            const types = Array.isArray(parsed) ? parsed.map(p => p['@type']) : [parsed['@type']];
            jsonLdTypes.push(...types.filter(Boolean));
        } catch(_) {
            const typeMatch = inner.match(/"@type"\s*:\s*"([^"]+)"/);
            if (typeMatch) jsonLdTypes.push(typeMatch[1]);
        }
    }

    // Body-Text extrahieren (grob)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyRaw = bodyMatch ? bodyMatch[1] : html;
    const bodyText = bodyRaw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const wordCount = bodyText.split(/\s+/).filter(w => w.length > 2).length;

    // Bilder
    const imgs = (html.match(/<img[^>]*>/gi) || []);
    const imgsWithAlt = imgs.filter(i => /\balt=["'][^"']+["']/i.test(i)).length;

    // Interne Links
    const internalLinks = (html.match(/href=["'](?!https?:|mailto:|tel:|#|javascript:)[^"']+["']/gi) || []).length;

    // Ort-Erkennung im Body (nur ersten 3000 Zeichen für Speed)
    const orteImText = detectOrte(bodyText.slice(0, 3000));

    // SEO-Score (0-100)
    let score = 0;
    if (title && title.length >= 30 && title.length <= 70) score += 15;
    else if (title) score += 8;
    if (description && description.length >= 100 && description.length <= 170) score += 15;
    else if (description) score += 8;
    if (h1s.length === 1) score += 10;
    else if (h1s.length > 0) score += 5;
    if (h2s.length >= 3) score += 10;
    else if (h2s.length > 0) score += 5;
    if (wordCount >= 300) score += 15;
    else if (wordCount >= 150) score += 8;
    if (jsonLdTypes.length > 0) score += 15;
    if (canonical) score += 10;
    if (ogTitle && ogDescription) score += 5;
    if (imgs.length === 0 || imgsWithAlt / imgs.length >= 0.8) score += 5;

    const issues = [];
    if (!title) issues.push('kein Title');
    else if (title.length < 30) issues.push('Title zu kurz (' + title.length + ')');
    else if (title.length > 70) issues.push('Title zu lang (' + title.length + ')');
    if (!description) issues.push('keine Meta-Description');
    else if (description.length < 100) issues.push('Description zu kurz (' + description.length + ')');
    else if (description.length > 170) issues.push('Description zu lang (' + description.length + ')');
    if (h1s.length === 0) issues.push('kein H1');
    else if (h1s.length > 1) issues.push(h1s.length + ' H1 (soll 1 sein)');
    if (h2s.length < 3) issues.push('nur ' + h2s.length + ' H2 (soll 3+)');
    if (wordCount < 300) issues.push('nur ' + wordCount + ' Wörter (soll 300+)');
    if (jsonLdTypes.length === 0) issues.push('kein JSON-LD Schema');
    if (!canonical) issues.push('kein Canonical');
    if (!ogTitle) issues.push('kein Open-Graph');
    if (imgs.length > 0 && imgsWithAlt / imgs.length < 0.8) issues.push('nicht alle Bilder mit alt');

    return {
        filename,
        category: categorize(filename),
        size,
        title, titleLen: title.length,
        description, descriptionLen: description.length,
        keywordsLen: keywords.length,
        ogTitle, ogDescription, ogImage,
        canonical: !!canonical, canonicalUrl: canonical,
        hreflangCount,
        h1Count: h1s.length, h1First: h1s[0] || '',
        h2Count: h2s.length, h2First: h2s[0] || '',
        h3Count: h3s,
        jsonLdTypes,
        wordCount,
        imgCount: imgs.length, imgsWithAlt,
        internalLinks,
        orteImText,
        score,
        issues,
        health: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'medium' : 'poor',
    };
}

function main() {
    const entries = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !BLACKLIST.has(f));
    console.log('Scanne', entries.length, 'HTML-Seiten...');
    const results = [];
    let done = 0;
    for (const f of entries) {
        try {
            const result = analyzeFile(path.join(ROOT, f));
            results.push(result);
            done++;
            if (done % 50 === 0) console.log('  ' + done + '/' + entries.length + '...');
        } catch (e) {
            console.warn('❌ ' + f + ':', e.message);
        }
    }
    // Sortiert nach category, dann Score aufsteigend (schlechteste zuerst → sichtbar was fehlt)
    results.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.score - b.score;
    });
    // Zusammenfassung
    const byCat = {};
    for (const r of results) {
        if (!byCat[r.category]) byCat[r.category] = { total: 0, excellent: 0, good: 0, medium: 0, poor: 0 };
        byCat[r.category].total++;
        byCat[r.category][r.health]++;
    }
    const summary = {
        generatedAt: new Date().toISOString(),
        totalPages: results.length,
        avgScore: Math.round(results.reduce((s, r) => s + r.score, 0) / results.length),
        byCategory: byCat,
        byHealth: {
            excellent: results.filter(r => r.health === 'excellent').length,
            good:      results.filter(r => r.health === 'good').length,
            medium:    results.filter(r => r.health === 'medium').length,
            poor:      results.filter(r => r.health === 'poor').length,
        },
    };
    fs.writeFileSync(OUT, JSON.stringify({ summary, pages: results }, null, 2));
    console.log('✅ ' + results.length + ' Seiten analysiert → ' + path.relative(ROOT, OUT));
    console.log('   Ø Score: ' + summary.avgScore + '/100');
    console.log('   ' + summary.byHealth.excellent + ' excellent, ' + summary.byHealth.good + ' good, ' + summary.byHealth.medium + ' medium, ' + summary.byHealth.poor + ' poor');
    console.log('\nTop 5 mit Handlungsbedarf (kleinster Score):');
    for (const r of results.slice(0, 5)) {
        console.log('  ' + r.score + '/100  ' + r.filename + '  [' + r.category + ']  → ' + r.issues.slice(0, 3).join(', '));
    }
}

main();
