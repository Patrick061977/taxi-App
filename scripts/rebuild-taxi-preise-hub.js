#!/usr/bin/env node
// v6.63.999: Rebuild taxi-preise.html — kompletter Hub mit allen Strecken
// Patrick 29.08.: 'baue neu mit allen 1091 Strecken, filterbar nach Ort'

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function extract(html) {
    const t = html.match(/<title>Taxi\s+(.+?)\s*→\s*(.+?)\s*·/);
    if (!t) return null;
    const d = html.match(/<meta name="description" content="Taxi vom\s+.+?\s+zum\s+.+?:\s*ca\.\s*([\d,]+)\s*€\s*\(([\d,\.]+)\s*km,\s*(\d+)\s*Min\)\.\s*Aus\s*(\d+)\s*echten/);
    return {
        from: t[1].trim(),
        to: t[2].trim(),
        price: d ? parseFloat(d[1].replace(',','.')) : null,
        km: d ? parseFloat(d[2].replace(',','.')) : null,
        min: d ? parseInt(d[3]) : null,
        count: d ? parseInt(d[4]) : 1
    };
}

function classifyOrt(name) {
    const l = (name || '').toLowerCase();
    if (l.includes('ahlbeck')) return 'Ahlbeck';
    if (l.includes('heringsdorf')) return 'Heringsdorf';
    if (l.includes('bansin')) return 'Bansin';
    if (l.includes('zinnowitz')) return 'Zinnowitz';
    if (l.includes('koserow')) return 'Koserow';
    if (l.includes('sellin')) return 'Sellin';
    if (l.includes('flughafen') || l.includes('airport')) return 'Flughafen';
    if (l.includes('swin') || l.includes('świn')) return 'Świnoujście';
    if (l.includes('berlin')) return 'Berlin';
    if (l.includes('anklam') || l.includes('wolgast') || l.includes('greifswald') || l.includes('stralsund') || l.includes('usedom')) return 'Festland';
    return 'Sonstige';
}

const files = fs.readdirSync(ROOT).filter(f => f.startsWith('taxi-') && f.includes('-zu-') && f.endsWith('.html'));
console.log('Scanne', files.length, 'Strecken-Seiten...');

const routes = [];
for (const f of files) {
    try {
        const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const e = extract(html);
        if (!e) continue;
        e.file = f;
        e.fromOrt = classifyOrt(e.from);
        e.toOrt = classifyOrt(e.to);
        routes.push(e);
    } catch (_) { /* skip */ }
}
console.log('Extrahiert:', routes.length, 'Strecken mit gültigem Preis/km/min:', routes.filter(r => r.price != null).length);

routes.sort((a, b) => (b.count || 0) - (a.count || 0));

const orte = Array.from(new Set([...routes.map(r => r.fromOrt), ...routes.map(r => r.toOrt)])).sort();

const totalCount = routes.length;
const withPrice = routes.filter(r => r.price != null);
const avgPrice = withPrice.length ? (withPrice.reduce((s, r) => s + r.price, 0) / withPrice.length).toFixed(2) : '—';

const rowsJson = JSON.stringify(routes.map(r => ({
    f: r.file,
    a: r.from,
    b: r.to,
    ao: r.fromOrt,
    bo: r.toOrt,
    p: r.price,
    k: r.km,
    m: r.min,
    c: r.count
})));

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Taxi-Preise Usedom · ${totalCount} echte Routen · Heringsdorf Ahlbeck Bansin</title>
<meta name="description" content="${totalCount} echte Taxi-Routen auf Usedom mit Preis-Median aus abgeschlossenen Fahrten. Filter nach Ort. Bahnhof, Flughafen, Hotels, Kliniken, Świnoujście. Ø ${avgPrice} €.">
<meta name="keywords" content="Taxi Preise Usedom, Taxi Heringsdorf Preise, Taxi Ahlbeck Preise, Taxi Bansin Preise, Taxi Flughafen Heringsdorf, Taxi Bahnhof Ahlbeck, Taxi Steigenberger, Funk Taxi Heringsdorf">
<link rel="canonical" href="https://umwelt-taxi-insel-usedom.de/taxi-preise.html">
<meta property="og:title" content="${totalCount} echte Taxi-Routen auf Usedom">
<meta property="og:description" content="Preisliste aus ${withPrice.length} echten Fahrten. Filter nach Ort. Ruf 038378 22022.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://umwelt-taxi-insel-usedom.de/taxi-preise.html">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"TaxiService","name":"Funk Taxi Heringsdorf","telephone":"+493837822022","url":"https://umwelt-taxi-insel-usedom.de/","priceRange":"€€","areaServed":[{"@type":"City","name":"Heringsdorf"},{"@type":"City","name":"Ahlbeck"},{"@type":"City","name":"Bansin"},{"@type":"City","name":"Zinnowitz"},{"@type":"City","name":"Koserow"},{"@type":"City","name":"Świnoujście"}]}
</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.5}
header{background:linear-gradient(135deg,#1e40af 0%,#0891b2 100%);padding:16px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.3)}
.brand{max-width:1200px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;color:#fff;flex-wrap:wrap;gap:10px}
.brand h1{font-size:18px;font-weight:700}
.brand a.call{background:#10b981;padding:9px 18px;border-radius:8px;color:#fff;text-decoration:none;font-weight:700;font-size:15px}
.hero{background:#1e293b;padding:32px 16px;text-align:center}
.hero h2{font-size:26px;color:#fbbf24;margin-bottom:10px;font-weight:700}
.hero p{font-size:15px;color:#94a3b8;max-width:700px;margin:0 auto 8px}
.hero .stats{margin-top:14px;display:flex;justify-content:center;gap:20px;flex-wrap:wrap}
.hero .stats span{background:#0f172a;padding:8px 14px;border-radius:8px;font-size:13px}
.hero .stats b{color:#10b981;font-size:16px;margin-right:6px}
.container{max-width:1200px;margin:0 auto;padding:16px}
.filters{background:#1e293b;padding:14px;border-radius:10px;margin:16px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center;position:sticky;top:64px;z-index:80;box-shadow:0 2px 8px rgba(0,0,0,0.4)}
.filters input,.filters select{background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:9px 12px;border-radius:8px;font-size:14px}
.filters input{flex:1;min-width:180px}
.filters .count{margin-left:auto;font-size:13px;color:#94a3b8}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
thead{background:#0f172a}
th{text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155;cursor:pointer;user-select:none}
th:hover{color:#fbbf24}
td{padding:10px 12px;font-size:14px;border-bottom:1px solid #0f172a}
tr:hover{background:#334155}
a.route{color:#60a5fa;text-decoration:none;font-weight:600}
a.route:hover{color:#fbbf24;text-decoration:underline}
.price{color:#10b981;font-weight:700}
.chip{display:inline-block;padding:2px 8px;background:#334155;border-radius:12px;font-size:11px;color:#94a3b8;margin-left:4px}
.no-results{text-align:center;padding:40px;color:#94a3b8}
footer{padding:30px 16px;text-align:center;color:#64748b;font-size:13px}
footer a{color:#94a3b8;margin:0 8px}
@media(max-width:600px){.brand h1{font-size:15px}th,td{padding:8px 6px;font-size:12px}.hero h2{font-size:20px}}
</style>
</head>
<body>
<header>
<div class="brand">
<h1>🚕 Funk Taxi Heringsdorf</h1>
<a class="call" href="tel:+493837822022">📞 038378 22022</a>
</div>
</header>

<section class="hero">
<h2>Taxi-Preise Usedom</h2>
<p>${totalCount} echte Strecken aus abgeschlossenen Fahrten der letzten 2 Jahre. Klicke auf eine Route für Details.</p>
<div class="stats">
<span><b>${totalCount}</b>Strecken</span>
<span><b>${withPrice.length}</b>mit Preis-Median</span>
<span><b>${avgPrice} €</b>Ø-Preis</span>
<span><b>${orte.length}</b>Orte</span>
</div>
</section>

<div class="container">

<div class="filters">
<input type="text" id="q" placeholder="🔍 Suche (z.B. Steigenberger, Bahnhof, Koserow)…" oninput="apply()">
<select id="fromOrt" onchange="apply()">
<option value="">🌍 Alle Startorte</option>
${orte.map(o => `<option value="${o}">▶ ${o}</option>`).join('\n')}
</select>
<select id="toOrt" onchange="apply()">
<option value="">🏁 Alle Zielorte</option>
${orte.map(o => `<option value="${o}">◀ ${o}</option>`).join('\n')}
</select>
<span class="count" id="count">${totalCount} Routen</span>
</div>

<table>
<thead>
<tr>
<th onclick="sortBy('from')">Von</th>
<th onclick="sortBy('to')">Nach</th>
<th onclick="sortBy('km')">km</th>
<th onclick="sortBy('min')">Min</th>
<th onclick="sortBy('price')">Preis Ø</th>
</tr>
</thead>
<tbody id="tb"></tbody>
</table>

<div class="no-results" id="noResults" style="display:none">Keine Route gefunden — probier andere Filter.</div>
</div>

<footer>
📞 <a href="tel:+493837822022">038378 22022</a> · 24/7 ·
<a href="https://umwelt-taxi-insel-usedom.de/anfrage.html">Anfrage</a> ·
<a href="https://umwelt-taxi-insel-usedom.de/impressum.html">Impressum</a> ·
<a href="https://umwelt-taxi-insel-usedom.de/datenschutz.html">Datenschutz</a><br>
Preise sind Median aus echten Fahrten — kein Festpreis. Abrechnung nach Taxameter (Landestarif MV).
</footer>

<script>
const ROUTES = ${rowsJson};
let sortField = 'count', sortDir = -1;

function apply(){
  const q = (document.getElementById('q').value || '').toLowerCase();
  const fo = document.getElementById('fromOrt').value;
  const to = document.getElementById('toOrt').value;
  let filtered = ROUTES.filter(r => {
    if (fo && r.ao !== fo) return false;
    if (to && r.bo !== to) return false;
    if (q && !(r.a.toLowerCase().includes(q) || r.b.toLowerCase().includes(q))) return false;
    return true;
  });
  filtered.sort((a,b) => {
    let av,bv;
    if (sortField==='from'){av=a.a.toLowerCase();bv=b.a.toLowerCase();}
    else if (sortField==='to'){av=a.b.toLowerCase();bv=b.b.toLowerCase();}
    else if (sortField==='km'){av=a.k||0;bv=b.k||0;}
    else if (sortField==='min'){av=a.m||0;bv=b.m||0;}
    else if (sortField==='price'){av=a.p||0;bv=b.p||0;}
    else if (sortField==='count'){av=a.c||0;bv=b.c||0;}
    if (av<bv) return -1*sortDir;
    if (av>bv) return 1*sortDir;
    return 0;
  });
  document.getElementById('count').textContent = filtered.length + ' Routen';
  const tb = document.getElementById('tb');
  const limit = 500;
  const shown = filtered.slice(0, limit);
  tb.innerHTML = shown.map(r => \`<tr onclick="window.location.href='\${r.f}'" style="cursor:pointer">
    <td><a class="route" href="\${r.f}">\${r.a}</a></td>
    <td><a class="route" href="\${r.f}">\${r.b}</a></td>
    <td>\${r.k != null ? r.k.toFixed(1) : '–'}</td>
    <td>\${r.m != null ? r.m : '–'}</td>
    <td class="price">\${r.p != null ? (Math.round(r.p * 10) / 10).toFixed(1).replace('.',',') + '0 €' : '–'}</td>
  </tr>\`).join('');
  if (filtered.length > limit) {
    tb.innerHTML += \`<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px;">… weitere \${filtered.length - limit} nicht gezeigt. Nutze Filter/Suche.</td></tr>\`;
  }
  document.getElementById('noResults').style.display = filtered.length === 0 ? 'block' : 'none';
}
function sortBy(f){ if (sortField===f) sortDir *= -1; else { sortField=f; sortDir=(f==='from'||f==='to')?1:-1; } apply(); }
apply();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'taxi-preise.html'), html);
console.log('✅ taxi-preise.html neu geschrieben —', totalCount, 'Strecken, Größe:', (fs.statSync(path.join(ROOT, 'taxi-preise.html')).size / 1024).toFixed(1), 'KB');
