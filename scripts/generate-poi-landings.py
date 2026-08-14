#!/usr/bin/env python3
"""Generator: SEO-Landing-Pages pro POI/Hotel/Ziel aus Firebase /pois.

Erzeugt taxi-zu-<slug>.html pro POI mit:
- Meta-Tags + canonical + JSON-LD TaxiService
- H1 "Taxi zum {Name}" + Kategorie-spezifischer Intro-Text
- Karte, Adresse, Fahrpreis-Estimate
- CTA-Button "Jetzt anfragen" → buchen.html?to=...&toLat=...&toLon=...
- "Ziele in der Nähe" (3 nächste POIs)
- Cross-Link-Block zu allen Themen-Landing-Pages

Nutzung:
  python scripts/generate-poi-landings.py
"""
import json, os, re, math, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO
POIS_JSON = REPO / 'scripts' / '_pois-cache.json'
DOMAIN = 'https://umwelt-taxi-insel-usedom.de'

# Kategorien die eigene Landing-Seiten bekommen
INCLUDE_CATS = {'hotel', 'arzt', 'other', 'shopping', 'strand', 'supermarkt', 'Sonstige'}
# Ausschluss-Namen (Ortsnamen, Bahnhöfe die eigene Landings haben)
EXCLUDE_NAMES = {'Heringsdorf', 'Ahlbeck', 'Bansin', 'Zinnowitz', 'Koserow',
                 'Ückeritz', 'Trassenheide', 'Loddin', 'Kamminke', 'Świnoujście',
                 'Anklam', 'Wolgast', 'Greifswald', 'Berlin', 'Zempin', 'Karlshagen',
                 'Züssow', 'Am Flughafen',
                 # Weitere Städte/Regionen die keine sinnvollen POI-Ziele sind
                 'Rostock', 'Stettin', 'Stralsund', 'Swinemünde', 'Misdroy',
                 'Kolberg', 'Peenemünde', 'Usedom', 'Zirchow'}
# Prefix-Ausschluss (case-insensitive)
EXCLUDE_PREFIXES = ('bahnhof ', 'am bahnhof', 'flughafen ', 'am flughafen',
                    'dorf bansin')
# Suffix-Ausschluss — reine Straßennamen ohne Nummer
EXCLUDE_SUFFIXES = ('straße', 'strasse', 'weg', 'platz', 'allee', 'ring', 'chaussee')
# Regex: Straßen-mit-Hausnummer-Pattern (z.B. "Rathenaustraße 7", "Seestraße 10")
# Ohne \b damit auch "Rathenaustraße" mit "straße" als Suffix matcht
ADDR_PATTERN = re.compile(r'(straße|strasse|weg|allee|platz|ring|chaussee|promenade)\s+\d+', re.IGNORECASE)
# Slug-nicht-erlaubte Zeichen
SLUG_STRIP = re.compile(r'[^a-z0-9-]')

def load_pois():
    if not POIS_JSON.exists():
        # Nachladen via gcloud
        token = subprocess.check_output(['gcloud','auth','print-access-token']).decode().strip()
        import urllib.request
        req = urllib.request.Request(
            f'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app/pois.json?access_token={token}')
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        POIS_JSON.write_bytes(data)
    return json.loads(POIS_JSON.read_text(encoding='utf-8')) or {}

def slugify(name):
    s = name.lower()
    for de, en in [('ä','ae'),('ö','oe'),('ü','ue'),('ß','ss'),
                    ('á','a'),('é','e'),('í','i'),('ó','o'),('ú','u'),
                    ('à','a'),('è','e'),('ì','i'),('ò','o'),('ù','u'),
                    ('ś','s'),('ź','z'),('ć','c'),('ń','n'),('ł','l'),
                    ('ą','a'),('ę','e'),(' ','-'),('&','und'),
                    ('.','-'),(',','-'),('(',''), (')',''),("'",''),('"',''),
                    ('/','-'),('_','-')]:
        s = s.replace(de, en)
    s = SLUG_STRIP.sub('', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s[:60]

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2-lat1); dlon = math.radians(lon2-lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(a))

def estimate_price(km):
    """Grober Taxi-Preis nach MV-Tarif: 4,50 Grundgeb + 2,20/km."""
    if km < 0.5: return None
    return round(4.50 + km * 2.20)

def kategorie_intro(cat, name, place):
    """Kategorie-spezifischer 3-4-Satz-Intro-Text."""
    if cat == 'hotel':
        return (f'<strong>{name}</strong> in {place} ist eines der bekannten Hotels der Insel Usedom. '
                f'Wir bringen Sie mit Festpreis direkt vor die Tür — vom Bahnhof, Flughafen oder Ihrer Wunsch-Adresse. '
                f'Rufen Sie uns an oder buchen Sie online — 24 Stunden am Tag, sieben Tage die Woche.')
    if cat == 'arzt':
        return (f'Wir fahren Sie zuverlässig zu <strong>{name}</strong> in {place}. '
                f'Ob Termin am Morgen oder unerwartet — unsere Fahrer sind pünktlich vor Ort und warten falls nötig. '
                f'Krankenfahrten mit Transportschein möglich (Abrechnung mit Kasse via DMRZ).')
    if cat == 'strand':
        return (f'Zum <strong>{name}</strong> in {place} fahren wir Sie entspannt und ohne Parkplatzsuche. '
                f'Wählen Sie Abholzeit für die Rückfahrt gleich mit — dann ist Ihr Taxi wieder da wenn Sie feddig sind.')
    if cat == 'supermarkt':
        return (f'Zum <strong>{name}</strong> in {place} — perfekt wenn der Einkauf zu schwer ist zum Laufen. '
                f'Wir fahren Sie hin, warten optional bis Sie fertig sind, und bringen Sie samt Einkauf wieder heim.')
    if cat == 'shopping':
        return (f'<strong>{name}</strong> in {place} ist ein beliebtes Einkaufsziel. '
                f'Wir bringen Sie hin und wenn Sie möchten samt Einkäufen wieder zurück — Festpreis vorab.')
    # other / Sonstige / default
    return (f'<strong>{name}</strong> in {place} — wir bringen Sie zuverlässig hin und optional wieder zurück. '
            f'Rufen Sie 038378 22022 oder buchen Sie online mit Festpreis-Anzeige.')

def kategorie_titel(cat, name):
    if cat == 'hotel':      return f'Taxi zum Hotel {name}'
    if cat == 'arzt':       return f'Taxi zu {name} · Arzt / Klinik'
    if cat == 'supermarkt': return f'Taxi zum {name} · Einkauf'
    if cat == 'strand':     return f'Taxi zum {name}'
    if cat == 'shopping':   return f'Taxi zum {name}'
    return f'Taxi zum {name}'

def extract_place(address):
    """Aus '..., 17424 Heringsdorf' → 'Heringsdorf'."""
    m = re.search(r'\d{5}\s+([A-Za-zÄÖÜäöüß-]+)', address or '')
    return m.group(1) if m else 'Usedom'

def nearby_pois(poi, all_pois, limit=3):
    """Finde die 3 nächsten POIs (nicht sich selbst) mit Koords."""
    lat, lon = poi['lat'], poi['lon']
    dists = []
    for k, p in all_pois.items():
        if not isinstance(p, dict) or p is poi: continue
        if not p.get('lat') or not p.get('lon'): continue
        if p.get('name') == poi.get('name'): continue
        try:
            d = haversine(lat, lon, p['lat'], p['lon'])
            dists.append((d, k, p))
        except: continue
    dists.sort()
    return dists[:limit]

TEMPLATE = '''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | Funk Taxi Heringsdorf</title>
<meta name="description" content="{meta_desc}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{meta_desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_DE">
<meta property="og:image" content="{domain}/icon-192.png">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "TaxiService",
  "name": "{title} — Funk Taxi Heringsdorf",
  "description": "{meta_desc}",
  "url": "{canonical}",
  "telephone": "+4938378822022",
  "priceRange": "€€",
  "areaServed": {{"@type":"City","name":"{place}"}},
  "provider": {{
    "@type": "TaxiService",
    "name": "Funk Taxi Heringsdorf",
    "telephone": "+4938378822022",
    "address": {{
      "@type": "PostalAddress",
      "streetAddress": "Amselring 10",
      "addressLocality": "Ostseebad Heringsdorf",
      "postalCode": "17424",
      "addressCountry": "DE"
    }}
  }},
  "serviceType": "Taxi-Transfer",
  "destination": {{"@type":"Place","name":"{name_esc}","address":"{addr_esc}"}}
}}
</script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
* {{ margin:0; padding:0; box-sizing:border-box; font-family:-apple-system,Segoe UI,sans-serif; }}
body {{ background:#f1f5f9; color:#1e293b; line-height:1.6; }}
.container {{ max-width:900px; margin:0 auto; padding:20px; }}
header {{ background:#1e293b; color:#f8fafc; padding:24px 0; }}
h1 {{ font-size:28px; margin-bottom:8px; }}
h1 .em {{ color:#fbbf24; }}
.subtitle {{ color:#94a3b8; font-size:14px; }}
.card {{ background:#fff; border-radius:12px; padding:20px; margin:16px 0; box-shadow:0 1px 3px rgba(0,0,0,0.1); }}
.cta {{ display:inline-block; background:#f59e0b; color:#fff; padding:14px 26px; border-radius:8px; text-decoration:none; font-weight:700; font-size:16px; margin:8px 8px 8px 0; }}
.cta.phone {{ background:#22c55e; }}
.cta:hover {{ opacity:0.9; }}
#map {{ height:300px; border-radius:12px; }}
.info-row {{ display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #e2e8f0; font-size:14px; }}
.info-row:last-child {{ border-bottom:0; }}
.info-row strong {{ color:#334155; }}
footer {{ background:#0f172a; color:#94a3b8; padding:32px 0; text-align:center; margin-top:40px; }}
footer a {{ color:#f59e0b; text-decoration:none; }}
.crosslink {{ background:#fef3c7; border:2px solid #fbbf24; border-radius:12px; padding:16px; margin:16px 0; }}
.crosslink a {{ color:#78350f; text-decoration:none; display:block; padding:4px 0; font-size:14px; }}
</style>
</head>
<body>

<header>
    <div class="container">
        <h1><span class="em">Taxi</span> zum {name_html}</h1>
        <p class="subtitle">📍 {addr_html} · 24/7 unter 038378 22022</p>
    </div>
</header>

<div class="container">

<div class="card">
    <p>{intro}</p>
    <div style="margin-top:16px;">
        <a href="buchen.html?to={buchen_to}{buchen_lat_lon}" class="cta">🚕 Jetzt online anfragen</a>
        <a href="tel:+493837822022" class="cta phone">📞 038378 22022</a>
    </div>
</div>

<div class="card">
    <h2 style="font-size:18px; margin-bottom:12px;">📍 Ziel & Fahrpreis</h2>
    <div class="info-row"><span><strong>Adresse:</strong></span><span>{addr_html}</span></div>
    <div class="info-row"><span><strong>Ort:</strong></span><span>{place}</span></div>
    {price_row_bahnhof}
    {price_row_flughafen}
    <p style="font-size:12px; color:#64748b; margin-top:12px;">
        Alle Preise Estimate nach Landestarif MV. Endgültiger Preis nach realer Route.
    </p>
</div>

<div class="card" style="padding:0;">
    <div id="map"></div>
</div>

{nearby_block}

<div class="crosslink">
    <strong>🚕 Weitere Taxi-Services auf Usedom:</strong>
    <a href="landing.html">→ Taxi Heringsdorf · Ahlbeck · Bansin (Startseite)</a>
    <a href="flughafen-heringsdorf.html">→ Flughafentransfer Heringsdorf</a>
    <a href="berlin.html">→ Berlin-Shuttle Usedom</a>
    <a href="taxi-bahnhof-heringsdorf.html">→ Bahnhoftaxi Heringsdorf</a>
    <a href="taxi-bahnhof-ahlbeck.html">→ Bahnhoftaxi Ahlbeck</a>
    <a href="taxi-bahnhof-bansin.html">→ Bahnhoftaxi Bansin</a>
    <a href="taxi-hotel-usedom.html">→ Hotel-Transfer Insel Usedom</a>
    <a href="taxi-preise.html">→ Preisliste alle Strecken</a>
</div>

</div>

<footer>
    <div class="container">
        <p><strong>Funk Taxi Heringsdorf</strong> · Amselring 10 · 17424 Ostseebad Heringsdorf ·
        <a href="tel:+493837822022">038378 22022</a></p>
        <p style="font-size:13px; margin-top:12px;">
            <a href="landing.html">Startseite</a> ·
            <a href="buchen.html">Buchen</a> ·
            <a href="kontakt.html">Kontakt</a> ·
            <a href="impressum.html">Impressum</a>
        </p>
        <p style="font-size:12px; margin-top:12px; color:#64748b;">
            © Funk Taxi Heringsdorf — Patrick Wydra · Seit 1991 zuverlässig auf der Insel Usedom.
        </p>
    </div>
</footer>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map').setView([{lat}, {lon}], 15);
L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
    attribution: '© OpenStreetMap'
}}).addTo(map);
L.marker([{lat}, {lon}]).addTo(map)
  .bindPopup('<strong>{name_js}</strong><br>{addr_js}').openPopup();
</script>
</body>
</html>
'''

def html_esc(s):
    return (s or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

def js_esc(s):
    return (s or '').replace('\\','\\\\').replace("'","\\'").replace('\n','\\n')

def url_esc(s):
    import urllib.parse
    return urllib.parse.quote(s or '')

def build_page(poi_id, poi, all_pois, bahnhof_hdf, flughafen):
    name = poi.get('name','')
    addr = poi.get('address','')
    lat = poi.get('lat')
    lon = poi.get('lon')
    cat = poi.get('category', 'other')
    place = extract_place(addr)
    slug = slugify(name)
    if not slug: return None, None
    filename = f'taxi-zu-{slug}.html'
    canonical = f'{DOMAIN}/{filename}'
    title = kategorie_titel(cat, name)
    meta_desc = (f'Taxi zum {name} in {place} — Festpreis, Abholung ab Ihrer Adresse. '
                 f'Buchen online oder unter 038378 22022. 24/7.'[:158])
    intro = kategorie_intro(cat, name, place)

    # Preis-Estimate zu Bahnhof/Flughafen
    price_bahnhof = ''
    price_flughafen = ''
    if bahnhof_hdf:
        km = haversine(lat, lon, bahnhof_hdf['lat'], bahnhof_hdf['lon'])
        p = estimate_price(km)
        if p:
            price_bahnhof = f'<div class="info-row"><span><strong>Ab Bahnhof Heringsdorf:</strong></span><span>ca. {p} € ({km:.1f} km)</span></div>'
    if flughafen:
        km = haversine(lat, lon, flughafen['lat'], flughafen['lon'])
        p = estimate_price(km)
        if p:
            price_flughafen = f'<div class="info-row"><span><strong>Ab Flughafen Heringsdorf:</strong></span><span>ca. {p} € ({km:.1f} km)</span></div>'

    # Nachbar-POIs
    nearby = nearby_pois(poi, all_pois, limit=3)
    nearby_block = ''
    if nearby:
        items = []
        for d, k, p in nearby:
            n_slug = slugify(p.get('name',''))
            if not n_slug: continue
            items.append(f'<a href="taxi-zu-{n_slug}.html" style="color:#78350f;text-decoration:none;display:block;padding:6px 0;font-size:14px;">'
                         f'→ Taxi zu {html_esc(p["name"])} ({d:.1f} km entfernt)</a>')
        if items:
            nearby_block = ('<div class="card" style="background:#f0fdf4;border:2px solid #86efac;">'
                            '<h2 style="font-size:16px; margin-bottom:8px;">🚩 Ziele in der Nähe</h2>'
                            + ''.join(items) + '</div>')

    html = TEMPLATE.format(
        title=title,
        meta_desc=meta_desc,
        canonical=canonical,
        domain=DOMAIN,
        place=place,
        name_esc=name.replace('"','\\"'),
        addr_esc=addr.replace('"','\\"'),
        name_html=html_esc(name),
        addr_html=html_esc(addr),
        name_js=js_esc(name),
        addr_js=js_esc(addr),
        intro=intro,
        buchen_to=url_esc(f'{name}, {addr}'),
        buchen_lat_lon=f'&toLat={lat}&toLon={lon}',
        price_row_bahnhof=price_bahnhof,
        price_row_flughafen=price_flughafen,
        nearby_block=nearby_block,
        lat=lat,
        lon=lon,
    )
    return filename, html

def main():
    all_pois = load_pois()
    # Bahnhof + Flughafen Referenz-Koordinaten
    bahnhof = None; flughafen = None
    for k, p in all_pois.items():
        if not isinstance(p, dict): continue
        n = (p.get('name') or '').lower()
        if 'bahnhof heringsdorf' in n: bahnhof = p
        if 'flughafen' in n and p.get('lat'): flughafen = p
    if not flughafen:
        flughafen = {'lat': 53.879, 'lon': 14.152}  # Heringsdorf EDAH
    if not bahnhof:
        bahnhof = {'lat': 53.947, 'lon': 14.184}  # Heringsdorf Bhf ca.

    generated = []
    skipped_noname = 0
    skipped_notarget = 0
    skipped_ort = 0
    skipped_cat = 0
    skipped_dup = 0
    used_slugs = set()

    for poi_id, poi in all_pois.items():
        if not isinstance(poi, dict): continue
        name = poi.get('name','').strip()
        addr = poi.get('address','').strip()
        cat = poi.get('category','')
        if not name: skipped_noname += 1; continue
        if not addr or not poi.get('lat') or not poi.get('lon'): skipped_notarget += 1; continue
        if name in EXCLUDE_NAMES: skipped_ort += 1; continue
        nlower = name.lower()
        if any(nlower.startswith(p) for p in EXCLUDE_PREFIXES): skipped_ort += 1; continue
        # Skip reine Straßen-mit-Hausnummer-Adressen (kein POI-Bezug)
        if ADDR_PATTERN.search(name): skipped_ort += 1; continue
        # Skip Namen die reiner Straßenname sind (endet mit Straßen-Suffix)
        if any(nlower.rstrip('0123456789 -').endswith(s) for s in EXCLUDE_SUFFIXES): skipped_ort += 1; continue
        # Skip Namen kürzer als 4 Zeichen oder rein numerisch
        if len(name.strip()) < 5: skipped_ort += 1; continue
        if cat and cat not in INCLUDE_CATS: skipped_cat += 1; continue
        slug = slugify(name)
        if slug in used_slugs: skipped_dup += 1; continue
        used_slugs.add(slug)
        filename, html = build_page(poi_id, poi, all_pois, bahnhof, flughafen)
        if not filename: continue
        (OUT_DIR / filename).write_text(html, encoding='utf-8')
        generated.append(filename)

    print(f'✅ Generiert: {len(generated)} Landing-Pages')
    print(f'   Skipped: noname={skipped_noname} notarget={skipped_notarget} ort={skipped_ort} cat={skipped_cat} dup={skipped_dup}')

    # Sitemap update
    sitemap_path = REPO / 'sitemap.xml'
    sitemap = sitemap_path.read_text(encoding='utf-8')
    new_urls = ''
    from datetime import date
    today = date.today().isoformat()
    for fn in sorted(generated):
        loc = f'{DOMAIN}/{fn}'
        if loc in sitemap: continue
        new_urls += f'''
  <url>
    <loc>{loc}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>'''
    if new_urls:
        sitemap = sitemap.replace('</urlset>', new_urls + '\n</urlset>')
        sitemap_path.write_text(sitemap, encoding='utf-8')
        print(f'✅ sitemap.xml aktualisiert (+{len(generated)} URLs)')

    print('\nEinige Beispiel-Dateien:')
    for fn in generated[:5]:
        print(f'  {fn}')

if __name__ == '__main__':
    main()
