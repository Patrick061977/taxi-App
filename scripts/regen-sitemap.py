#!/usr/bin/env python3
# regen-sitemap.py — Patrick 10.10. Bridge: Sitemap mit allen index-Dateien aktualisieren.
# Nimmt nur Dateien die 'index, follow' haben (keine noindex-Longtails).
# Prio nach Fahrten-Count: >=10x = 0.7, >=5x = 0.6, Rest = 0.5.
# Hub/Haupt-Seiten: 0.8 / 1.0.

import glob
import os
import re
from datetime import datetime

DOMAIN = 'https://umwelt-taxi-insel-usedom.de'
TODAY = datetime.now().strftime('%Y-%m-%d')

HIGH_PRIO = ['landing.html', 'index.html', 'buchen.html', 'anfrage.html', 'taxi-preise.html', 'kontakt.html', 'kunden.html']
HUB_FILES = ['taxi-hotel-usedom.html', 'taxi-restaurants-usedom.html', 'restaurants-usedom.html',
             'ausflugsziele.html', 'veranstaltungen-heringsdorf.html', 'taxi-bahnhof-ahlbeck.html',
             'taxi-bahnhof-bansin.html', 'taxi-bahnhof-heringsdorf.html', 'landing-hub.html']

urls = []

for f in HIGH_PRIO:
    if os.path.exists(f):
        urls.append((f, '1.0', 'weekly'))

for f in HUB_FILES:
    if os.path.exists(f) and f not in HIGH_PRIO:
        urls.append((f, '0.8', 'weekly'))

for f in sorted(glob.glob('taxi-*.html')):
    if f in HIGH_PRIO or f in HUB_FILES:
        continue
    try:
        with open(f, encoding='utf-8') as fh:
            content = fh.read(2500)
    except Exception:
        continue
    robots = re.search(r'<meta name="robots" content="([^"]*)"', content)
    if robots and 'noindex' in robots.group(1).lower():
        continue
    cnt = re.search(r'(\d+)× gefahren|Aus (\d+) echten Fahrten|Median aus (\d+)', content)
    count = int(cnt.group(1) or cnt.group(2) or cnt.group(3)) if cnt else 1
    if count >= 10:
        prio = '0.7'
    elif count >= 5:
        prio = '0.6'
    else:
        prio = '0.5'
    urls.append((f, prio, 'monthly'))

with open('sitemap.xml', 'w', encoding='utf-8') as fh:
    fh.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    fh.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for f, prio, freq in urls:
        fh.write('  <url>\n')
        fh.write(f'    <loc>{DOMAIN}/{f}</loc>\n')
        fh.write(f'    <lastmod>{TODAY}</lastmod>\n')
        fh.write(f'    <changefreq>{freq}</changefreq>\n')
        fh.write(f'    <priority>{prio}</priority>\n')
        fh.write('  </url>\n')
    fh.write('</urlset>\n')

print(f'sitemap.xml: {len(urls)} URLs geschrieben.')
