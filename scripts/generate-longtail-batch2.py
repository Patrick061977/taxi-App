#!/usr/bin/env python3
"""Generator Batch 2: 3 weitere Long-Tail-Landings (Trassenheide, Koserow, Ückeritz).

Patrick 14.08.: "weiter mit trassenheide koserow ückeritz brauch ich nur
in richtung heringsdorf swinemünde".

Alle 3 nutzen dasselbe base_template() aus generate-longtail-landings.py.
"""
import sys
from pathlib import Path
# Bindestrich im Modulname → nicht importierbar via import. Load via exec.
_here = Path(__file__).resolve().parent
_gt_src = (_here / 'generate-longtail-landings.py').read_text(encoding='utf-8')
_ns = {'__file__': str(_here / 'generate-longtail-landings.py'), '__name__': '_gt'}
exec(compile(_gt_src, str(_here / 'generate-longtail-landings.py'), 'exec'), _ns)
base_template = _ns['base_template']
REPO = _ns['REPO']
DOMAIN = _ns['DOMAIN']


def _de_umlaut(s):
    return s.replace('ü','ue').replace('ö','oe').replace('ä','ae').replace('ß','ss').replace('Ü','Ue').replace('Ö','Oe').replace('Ä','Ae')

def build(ort, hdf_km, swi_km, ahl_km, bansin_km, koords_url):
    """Baut Landing 'taxi-<ort>-heringsdorf.html' mit Richtung HDF+SWI+Kaiserbäder."""
    # Slug: Umlaut-frei damit die URL exakt dem Dateinamen entspricht
    slug = _de_umlaut(f'taxi-{ort.lower()}-heringsdorf')
    ort_title = ort.title()

    # Preisberechnung nach Landestarif MV (settings/tarif in Firebase):
    # Grundgebühr 4 EUR, km 1-2 = 3.30/km, km 3-4 = 2.80/km, ab 5 = 2.20/km
    def p(km):
        if km <= 2: return round(4 + km*3.30)
        if km <= 4: return round(4 + 6.60 + (km-2)*2.80)
        return round(16.20 + (km-4)*2.20)
    preis_hdf = p(hdf_km)
    preis_flg = p(hdf_km + 3)
    preis_ahl = p(ahl_km)
    preis_ban = p(bansin_km)
    preis_swi = p(swi_km) + 5  # +5 EUR Grenz-Aufschlag

    preis_table = f'''
<section>
<div class="card">
<h2>Festpreise ab {ort_title} — Richtung Kaiserbäder & Świnoujście</h2>
<p>Wir fahren Sie direkt vom {ort_title}er Ferienhaus, Hotel oder Ferienwohnung zum gewünschten Ziel — Festpreis nach Landestarif MV, keine Umsteigerei, 24/7.</p>
<table>
<tr><th>Ab {ort_title}</th><th>Nach</th><th>Distanz</th><th>Preis (Festpreis)</th></tr>
<tr><td>{ort_title}</td><td>Heringsdorf Zentrum</td><td>~{hdf_km} km</td><td class="price">{preis_hdf} EUR</td></tr>
<tr><td>{ort_title}</td><td>Bahnhof Heringsdorf</td><td>~{hdf_km} km</td><td class="price">{preis_hdf} EUR</td></tr>
<tr><td>{ort_title}</td><td>Flughafen Heringsdorf</td><td>~{hdf_km+3} km</td><td class="price">{preis_flg} EUR</td></tr>
<tr><td>{ort_title}</td><td>Ahlbeck</td><td>~{ahl_km} km</td><td class="price">{preis_ahl} EUR</td></tr>
<tr><td>{ort_title}</td><td>Bansin</td><td>~{bansin_km} km</td><td class="price">{preis_ban} EUR</td></tr>
<tr><td>{ort_title}</td><td>Świnoujście (Zentrum)</td><td>~{swi_km} km</td><td class="price">{preis_swi} EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:13px;color:#64748b;">Preise nach Landestarif MV für Standard-PKW (bis 4 Pers.). Grundgebühr 4 EUR + gestaffelter Kilometerpreis. Großraum-Taxi (bis 8 Pers.) +10 EUR. Nachtzuschlag Grundgebühr 5,50 EUR (22–6 Uhr, So/Feiertag). Grenzfahrt Świnoujście +5 EUR Aufschlag.</p>
</div>
</section>
'''

    content = f'''
<section>
<div class="card">
<h2>Vom {ort_title}er Strand ins Kaiserbäder-Zentrum</h2>
<p>{ort_title} ist ein beliebter Urlaubsort mitten auf der Insel Usedom. Von hier zu den Kaiserbädern (Heringsdorf, Ahlbeck, Bansin) sind es je nach Ziel {ahl_km}-{hdf_km} km. Ohne eigenes Auto sind Sie auf Bus oder Taxi angewiesen — und Bus fährt weder nachts noch am Wochenende so flexibel wie Sie es brauchen.</p>
<p>Wir bringen Sie zuverlässig von Ihrem Ferienobjekt in {ort_title} zum Bahnhof Heringsdorf, zum Flughafen Heringsdorf oder direkt über die Grenze nach Świnoujście — mit Festpreis, jederzeit, ohne Umsteigen.</p>
</div>
<div class="card">
<h2>Typische Fahrten ab {ort_title}</h2>
<ul>
<li><strong>Ankunft / Abreise</strong> — Flughafen Heringsdorf oder Bahnhof (Züge nach Züssow/Berlin)</li>
<li><strong>Ausflug Świnoujście</strong> — Promenade, Shopping, Restaurants am Nachmittag</li>
<li><strong>Restaurant / Abendessen</strong> — Kaiserbäder-Promenade, keine Suche nach Rückfahrt</li>
<li><strong>Konzert / Vineta-Festspiele</strong> — Zinnowitz Nordinsel, Rückfahrt garantiert</li>
<li><strong>Arzt / Klinik</strong> — Rehaklinik Heringsdorf, Krankenhaus Wolgast</li>
<li><strong>Karls Erlebnisdorf Koserow</strong> — Familienausflug mit Kindern + Gepäck</li>
</ul>
</div>
</section>
'''

    faqs = [
        (f'Wie lange dauert die Fahrt {ort_title} → Heringsdorf?',
         f'Ca. {int(hdf_km*1.5)} Minuten je nach Verkehr. Die Strecke geht entlang der Küste über die B111.'),
        (f'Kann ich vom Flughafen Heringsdorf abgeholt werden nach {ort_title}?',
         f'Ja — bitte Flug-Nummer und geplante Landezeit angeben, wir warten am Terminal. Festpreis ca. {preis_flg} EUR.'),
        (f'Fahren Sie nachts von {ort_title} nach Świnoujście?',
         'Ja, 24/7. Nachtzuschlag +5 EUR. Der Grenzübergang bei Ahlbeck ist rund um die Uhr offen.'),
        ('Kann ich für die Rückfahrt eine feste Uhrzeit buchen?',
         'Ja — wir vereinbaren die Abholzeit fest. Sie sagen wann Sie zurück wollen, wir stehen pünktlich vor der Tür.'),
        ('Preis für Großraum-Taxi (bis 8 Personen)?',
         'Aufschlag +10 EUR auf den regulären Festpreis. Bitte bei der Buchung angeben.'),
    ]

    return base_template(
        slug=slug,
        title=f'Taxi {ort_title} → Heringsdorf & Świnoujście · Festpreise | Funk Taxi',
        meta_desc=f'Taxi von {ort_title} zum Bahnhof/Flughafen Heringsdorf, nach Ahlbeck, Bansin oder Świnoujście. Festpreise ab {ahl_km*2 + 5} EUR. 24/7 unter 038378 22022.',
        h1=f'Taxi <span class="em">{ort_title}</span> → Heringsdorf & Świnoujście',
        subline=f'Festpreise ab {ort_title} — Kaiserbäder · Flughafen · Bahnhof · Grenzfahrt Świnoujście',
        hero_extra='',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords=f'taxi {ort.lower()}, taxi {ort.lower()} heringsdorf, taxi {ort.lower()} flughafen, taxi {ort.lower()} swinemünde, taxi {ort.lower()} bahnhof, taxi usedom {ort.lower()}',
        buchen_to=f'from={ort.replace(" ", "%20")}&to=Heringsdorf',
        buchen_lat_lon='',
    )


def main():
    # Distanzen ungefähr (nach Google Maps)
    pages = [
        # (ort, hdf_km, swi_km, ahl_km, bansin_km, koords_url)
        ('Trassenheide',  28, 35, 30, 25, ''),
        ('Koserow',       20, 28, 22, 15, ''),
        ('Ückeritz',      13, 20, 15,  8, ''),
    ]

    generated = []
    for ort, hdf, swi, ahl, ban, ku in pages:
        html = build(ort, hdf, swi, ahl, ban, ku)
        # Slug in build() ist "taxi-<lower>-heringsdorf" — Datei-Name
        fn = f'taxi-{ort.lower()}-heringsdorf.html'
        # ÜÜmlaut-Ort ("Ückeritz") → Slug "ückeritz" wäre kaputt; wir ersetzen
        fn = fn.replace('ü', 'ue').replace('ö', 'oe').replace('ä', 'ae').replace('ß', 'ss')
        (REPO / fn).write_text(html, encoding='utf-8')
        print(f'✅ {fn} ({len(html)} bytes)')
        generated.append(fn)

    # Sitemap
    from datetime import date
    today = date.today().isoformat()
    sitemap = (REPO / 'sitemap.xml').read_text(encoding='utf-8')
    for fn in generated:
        loc = f'{DOMAIN}/{fn}'
        if loc in sitemap: continue
        new_url = f'''
  <url>
    <loc>{loc}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
  </url>'''
        sitemap = sitemap.replace('</urlset>', new_url + '\n</urlset>')
    (REPO / 'sitemap.xml').write_text(sitemap, encoding='utf-8')
    print(f'✅ sitemap.xml aktualisiert (+{len(generated)} URLs)')


if __name__ == '__main__':
    main()
