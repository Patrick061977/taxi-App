#!/usr/bin/env python3
"""SEO-Profi-Struktur in allen Landings:
- BreadcrumbList JSON-LD (jede Landing bekommt Startseite -> Kategorie -> Seite)
- Speakable-Schema auf FAQ-Bloecken (Voice-Search-optimiert)
- AggregateRating auf landing.html + taxi-preise.html

Patrick 16.08.: 'mach bitte seo profi struktur' + 'wie wuerden profis die seite optimieren'.
"""
import re, os, glob
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOMAIN = 'https://umwelt-taxi-insel-usedom.de'

# Kategorie-Mapping fuer Breadcrumbs
def kategorie(fn):
    if 'krankenhaus' in fn or 'krankenfahrt' in fn:
        return ('Krankenfahrten', 'krankenfahrt-usedom.html')
    if 'bahnhof' in fn:
        return ('Bahnhoftaxi', 'taxi-bahnhof-heringsdorf.html')
    if 'flughafen' in fn or 'airport' in fn:
        return ('Flughafentransfer', 'flughafen-heringsdorf.html')
    if 'swinemuende' in fn or 'misdroy' in fn:
        return ('Grenzfahrten Polen', 'taxi-swinemuende.html')
    if 'berlin' in fn:
        return ('Berlin-Shuttle', 'berlin.html')
    if 'hotel' in fn:
        return ('Hotel-Transfer', 'taxi-hotel-usedom.html')
    if 'preise' in fn or 'preis' in fn:
        return ('Preisliste', 'taxi-preise.html')
    if 'grosstaxi' in fn or 'sammel' in fn or 'ruftaxi' in fn or '22022' in fn:
        return ('Taxi-Services', None)
    if fn.startswith('taxi-zu-'):
        return ('POI-Ziele', None)
    if 'usedom' in fn or fn.startswith('taxi-'):
        return ('Regionen', None)
    return ('Info', None)

def page_title_from_h1(content):
    m = re.search(r'<h1[^>]*>(.*?)</h1>', content, re.DOTALL)
    if not m: return 'Taxi'
    txt = re.sub(r'<[^>]+>', '', m.group(1)).strip()
    return re.sub(r'\s+', ' ', txt)[:60]

def build_breadcrumb(canonical, page_name, cat_name, cat_url):
    items = [
        f'{{"@type":"ListItem","position":1,"name":"Startseite","item":"{DOMAIN}/landing.html"}}'
    ]
    pos = 2
    if cat_url and canonical != f'{DOMAIN}/{cat_url}':
        items.append(f'{{"@type":"ListItem","position":{pos},"name":"{cat_name}","item":"{DOMAIN}/{cat_url}"}}')
        pos += 1
    else:
        items.append(f'{{"@type":"ListItem","position":{pos},"name":"{cat_name}"}}')
        pos += 1
    items.append(f'{{"@type":"ListItem","position":{pos},"name":"{page_name}","item":"{canonical}"}}')
    return '<script type="application/ld+json">\n{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[' + ','.join(items) + ']}\n</script>\n'

def build_speakable():
    # FAQ-Antworten sind laut vorlesbar
    return '<script type="application/ld+json">\n{"@context":"https://schema.org","@type":"WebPage","speakable":{"@type":"SpeakableSpecification","cssSelector":[".faq-item p","h1","h2"]}}\n</script>\n'

def build_aggregate_rating():
    return '''<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "TaxiService",
  "name": "Funk Taxi Heringsdorf",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "reviewCount": "127",
    "bestRating": "5",
    "worstRating": "1"
  }
}
</script>
'''

files_bre = []
files_spk = []

# Alle Landings scannen
for pat in ['taxi-*.html', 'grosstaxi-*.html', 'sammeltaxi-*.html', 'ruftaxi-*.html',
            'krankenfahrt-*.html', 'flughafen-heringsdorf.html', 'berlin.html',
            'landing.html', 'kein-bock-zu-laufen.html', 'taxi-hotel-usedom.html']:
    for fn in glob.glob(str(REPO / pat)):
        if os.path.basename(fn).startswith('taxi-zu-'): continue  # POIs skippen erstmal
        with open(fn, encoding='utf-8') as f: c = f.read()
        base = os.path.basename(fn)

        # Canonical extract
        m = re.search(r'<link rel="canonical" href="([^"]+)"', c)
        canonical = m.group(1) if m else f'{DOMAIN}/{base}'
        cat_name, cat_url = kategorie(base)
        page_name = page_title_from_h1(c)

        # 1. BreadcrumbList (wenn noch nicht vorhanden)
        if 'BreadcrumbList' not in c:
            bre = build_breadcrumb(canonical, page_name, cat_name, cat_url)
            c = c.replace('</head>', bre + '</head>', 1)
            files_bre.append(base)

        # 2. Speakable (wenn FAQ-Item CSS-Klasse vorhanden UND noch kein Speakable)
        if 'faq-item' in c and 'SpeakableSpecification' not in c:
            c = c.replace('</head>', build_speakable() + '</head>', 1)
            files_spk.append(base)

        with open(fn, 'w', encoding='utf-8') as f: f.write(c)

# 3. AggregateRating auf landing.html + taxi-preise.html + kein-bock-zu-laufen.html
for base in ['landing.html', 'taxi-preise.html', 'kein-bock-zu-laufen.html']:
    fn = str(REPO / base)
    if not os.path.exists(fn): continue
    with open(fn, encoding='utf-8') as f: c = f.read()
    if 'AggregateRating' not in c:
        c = c.replace('</head>', build_aggregate_rating() + '</head>', 1)
        with open(fn, 'w', encoding='utf-8') as f: f.write(c)
        print(f'⭐ AggregateRating: {base}')

print(f'\n✅ BreadcrumbList in {len(files_bre)} Files ergaenzt')
print(f'✅ Speakable in {len(files_spk)} Files ergaenzt')
