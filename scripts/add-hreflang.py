#!/usr/bin/env python3
"""hreflang de + x-default in alle Landings.

Patrick 16.08.: 'hreflang und webp'.

Da wir keine EN/PL-Uebersetzungen haben, setzen wir:
  - hreflang="de" (Deutschland)
  - hreflang="de-DE" (spezifisch DE)
  - hreflang="x-default" (Fallback fuer alle anderen Sprachen)

Alle zeigen auf die deutsche Version (self-referencing).
Sobald EN/PL-Versionen existieren, koennen die Tags erweitert werden.
"""
import re, os, glob

os.chdir('C:/Taxi App/taxi-App-github')

def build_hreflang(canonical):
    return (
        f'<link rel="alternate" hreflang="de" href="{canonical}">\n'
        f'<link rel="alternate" hreflang="de-DE" href="{canonical}">\n'
        f'<link rel="alternate" hreflang="x-default" href="{canonical}">\n'
    )

files = []
for pat in ['taxi-*.html', 'grosstaxi-*.html', 'sammeltaxi-*.html', 'ruftaxi-*.html',
            'krankenfahrt-*.html', 'flughafen-heringsdorf.html', 'berlin.html',
            'landing.html', 'kein-bock-zu-laufen.html', 'anfrage.html', 'kontakt.html', 'impressum.html']:
    files.extend(glob.glob(pat))

files = sorted(set(files))
count = 0
for fn in files:
    with open(fn, encoding='utf-8') as f: c = f.read()
    if 'hreflang=' in c: continue  # skip wenn schon vorhanden
    m = re.search(r'<link rel="canonical" href="([^"]+)"', c)
    if not m: continue
    canonical = m.group(1)
    tags = build_hreflang(canonical)
    # Einfuegen nach canonical
    c = c.replace(m.group(0), m.group(0) + '\n' + tags.rstrip())
    with open(fn, 'w', encoding='utf-8') as f: f.write(c)
    count += 1

print(f'✅ hreflang in {count} Landings ergänzt')
