#!/usr/bin/env python3
"""Fuegt JSON-LD OfferCatalog in alle Landings mit Preistabellen ein.

Patrick 16.08.: 'ja mach' (alle Preistabellen fuer Google lesbar).

Parst 3 Table-Formate:
  A) <tr><td>Ort_A</td><td>Ort_B</td><td>~km</td><td class="price">X EUR</td></tr>  (Long-Tail-Landings)
  B) <tr><td>Ziel</td><td>~km</td><td class="price">X EUR</td></tr>  (Krankenhaus, 3 Spalten)
  C) <tr><td>Ziel</td><td>~km</td><td>~min</td><td class="price">X EUR</td></tr>  (Berlin)

Baut fuer jede erkannte Zeile ein Offer.
Skip: taxi-preise.html (schon fertig, komplexes Format).
"""
import re, os, glob
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOMAIN = 'https://umwelt-taxi-insel-usedom.de'

# Patterns
PAT_4COL_ORTORT = re.compile(r'<tr><td>([^<]+)</td><td>([^<]+)</td><td>~([^<]+)</td><td class="price">(\d+(?:[.,]\d+)?)\s*EUR</td></tr>')
PAT_3COL = re.compile(r'<tr><td>([^<]+)</td><td>~([^<]+)</td><td class="price">(\d+(?:[.,]\d+)?)\s*EUR</td></tr>')
PAT_4COL_ZIEL = re.compile(r'<tr><td>([^<]+)</td><td>~([^<]+)</td><td>~([^<]+)</td><td class="price">(\d+(?:[.,]\d+)?)\s*EUR</td></tr>')

# Files zum Bearbeiten (alle taxi-* außer preise + zu-* POI-Landings)
FILES = []
for pat in ['taxi-*.html', 'grosstaxi-*.html', 'sammeltaxi-*.html', 'ruftaxi-*.html', 'krankenfahrt-*.html', 'flughafen-heringsdorf.html', 'berlin.html']:
    for fn in glob.glob(str(REPO / pat)):
        base = os.path.basename(fn)
        if base == 'taxi-preise.html': continue  # schon fertig
        if base.startswith('taxi-zu-'): continue  # POI-Landings, keine Preistabelle
        FILES.append(fn)

def get_h1(content):
    m = re.search(r'<h1[^>]*>(.*?)</h1>', content, re.DOTALL)
    if m: return re.sub(r'<[^>]+>', '', m.group(1)).strip()
    return 'Taxi'

def build_offer(i, name, price, canonical, distance=None, duration=None):
    props = []
    if distance: props.append(f'{{"@type": "PropertyValue", "name": "Distanz", "value": "{distance}"}}')
    if duration: props.append(f'{{"@type": "PropertyValue", "name": "Dauer", "value": "{duration}"}}')
    props_str = ('[' + ', '.join(props) + ']') if props else '[]'
    return f'''    {{
      "@type": "Offer",
      "@id": "{canonical}#route-{i+1}",
      "name": "{name}",
      "url": "{canonical}#route-{i+1}",
      "priceSpecification": {{
        "@type": "PriceSpecification",
        "price": "{price}",
        "priceCurrency": "EUR"
      }},
      "itemOffered": {{
        "@type": "TaxiService",
        "name": "{name}",
        "areaServed": "Insel Usedom"
      }},
      "seller": {{
        "@type": "TaxiService",
        "name": "Funk Taxi Heringsdorf",
        "telephone": "+4938378822022"
      }},
      "additionalProperty": {props_str}
    }}'''

def parse_offers(content, canonical, page_title):
    offers = []

    # Pattern A: Ort_A → Ort_B
    for i, m in enumerate(PAT_4COL_ORTORT.finditer(content)):
        a, b, dist, price = m.groups()
        offers.append(build_offer(len(offers), f'Taxi {a.strip()} → {b.strip()}',
                                   price.replace(',', '.'), canonical, distance=dist.strip()))

    # Pattern C: Ziel + km + duration
    for i, m in enumerate(PAT_4COL_ZIEL.finditer(content)):
        # Skip wenn schon durch A gematcht
        row_start = content[:m.start()].rfind('<tr>')
        row_end = content.find('</tr>', m.start()) + 5
        if PAT_4COL_ORTORT.search(content[row_start:row_end]): continue
        ziel, dist, dur, price = m.groups()
        offers.append(build_offer(len(offers), f'{page_title} → {ziel.strip()}',
                                   price.replace(',', '.'), canonical,
                                   distance=dist.strip(), duration=dur.strip()))

    # Pattern B: 3-Spalten (Krankenhaus etc.)
    for m in PAT_3COL.finditer(content):
        # Skip wenn im 4-Col-Match schon vorhanden
        row_start = content[:m.start()].rfind('<tr>')
        row_end = content.find('</tr>', m.start()) + 5
        if PAT_4COL_ORTORT.search(content[row_start:row_end]) or PAT_4COL_ZIEL.search(content[row_start:row_end]): continue
        ort, dist, price = m.groups()
        offers.append(build_offer(len(offers), f'{page_title} → {ort.strip()}',
                                   price.replace(',', '.'), canonical, distance=dist.strip()))

    return offers

def build_catalog(offers, canonical, page_name):
    if not offers: return None
    return '<script type="application/ld+json">\n' + \
           '{\n  "@context": "https://schema.org",\n  "@type": "OfferCatalog",\n' + \
           f'  "name": "{page_name} — {len(offers)} Strecken",\n' + \
           f'  "url": "{canonical}",\n' + \
           '  "provider": {\n    "@type": "TaxiService",\n    "name": "Funk Taxi Heringsdorf",\n    "telephone": "+4938378822022",\n    "address": {\n      "@type": "PostalAddress",\n      "streetAddress": "Amselring 10",\n      "addressLocality": "Ostseebad Heringsdorf",\n      "postalCode": "17424",\n      "addressCountry": "DE"\n    }\n  },\n' + \
           '  "itemListElement": [\n' + ',\n'.join(offers) + '\n  ]\n}\n</script>\n'

def process(fn):
    with open(fn, encoding='utf-8') as f: content = f.read()
    if 'OfferCatalog' in content:
        return 0, 'schon vorhanden'
    canonical_m = re.search(r'<link rel="canonical" href="([^"]+)"', content)
    canonical = canonical_m.group(1) if canonical_m else f'{DOMAIN}/{os.path.basename(fn)}'
    title_m = re.search(r'<title>([^<]+)</title>', content)
    page_title = get_h1(content)
    page_name = title_m.group(1) if title_m else page_title

    offers = parse_offers(content, canonical, page_title)
    if not offers:
        return 0, 'keine Preistabelle erkannt'
    catalog = build_catalog(offers, canonical, page_name)
    content = content.replace('</head>', catalog + '</head>', 1)
    with open(fn, 'w', encoding='utf-8') as f: f.write(content)
    return len(offers), 'ok'

# Run
print(f'{"Datei":<50} {"Offers":>7}  {"Status"}')
print('-'*80)
total_offers = 0
total_files = 0
for fn in sorted(FILES):
    n, status = process(fn)
    base = os.path.basename(fn)
    print(f'{base:<50} {n:>7}  {status}')
    if n > 0:
        total_files += 1
        total_offers += n

print(f'\n═══ Bilanz ═══')
print(f'  {total_files} Landings ergänzt')
print(f'  {total_offers} Offers total')
