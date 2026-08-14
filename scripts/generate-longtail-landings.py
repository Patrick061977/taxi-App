#!/usr/bin/env python3
"""Generator: 6 Long-Tail-SEO-Landings basierend auf Google-Suggest-Keywords.

Pro Seite: eigener Content (Preistabelle, FAQ, JSON-LD), einheitliches Design.
"""
import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOMAIN = 'https://umwelt-taxi-insel-usedom.de'

# ─── Preise (grobe Estimates auf Basis MV-Landestarif + Grenz-Zuschlag) ─────
PREISE = {
    'heringsdorf-swinemuende': {'km': 8, 'preis': '25 EUR', 'dauer': '15 Min'},
    'ahlbeck-swinemuende':      {'km': 5, 'preis': '20 EUR', 'dauer': '10 Min'},
    'bansin-swinemuende':       {'km': 12, 'preis': '35 EUR', 'dauer': '20 Min'},
    'koserow-swinemuende':      {'km': 30, 'preis': '75 EUR', 'dauer': '40 Min'},
    'flughafen-swinemuende':    {'km': 20, 'preis': '55 EUR', 'dauer': '30 Min'},
    'heringsdorf-misdroy':      {'km': 25, 'preis': '65 EUR', 'dauer': '35 Min'},
    'heringsdorf-zinnowitz':    {'km': 25, 'preis': '55 EUR', 'dauer': '30 Min'},
    'ahlbeck-zinnowitz':        {'km': 30, 'preis': '65 EUR', 'dauer': '40 Min'},
    'bansin-zinnowitz':         {'km': 18, 'preis': '45 EUR', 'dauer': '25 Min'},
    'flughafen-zinnowitz':      {'km': 32, 'preis': '75 EUR', 'dauer': '45 Min'},
}

def base_template(slug, title, meta_desc, h1, subline, hero_extra, preis_table,
                  content_blocks, faq_items, keywords, buchen_to='',
                  buchen_lat_lon='', json_ld_extra=''):
    canonical = f'{DOMAIN}/{slug}.html'
    faq_json = ',\n'.join([
        f'{{"@type":"Question","name":{repr(q).replace(chr(39),chr(34))},"acceptedAnswer":{{"@type":"Answer","text":{repr(a).replace(chr(39),chr(34))}}}}}'
        for q, a in faq_items
    ]) if faq_items else ''
    faq_ld = f''',
        {{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [{faq_json}]
        }}''' if faq_items else ''

    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{meta_desc}">
<meta name="keywords" content="{keywords}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{meta_desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_DE">
<meta property="og:image" content="{DOMAIN}/icon-192.png">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<script type="application/ld+json">
{{
    "@context": "https://schema.org",
    "@type": "TaxiService",
    "name": "{title}",
    "description": "{meta_desc}",
    "url": "{canonical}",
    "telephone": "+4938378822022",
    "priceRange": "€€",
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
    }}{json_ld_extra}
}}{faq_ld}
</script>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; font-family:-apple-system,Segoe UI,sans-serif; }}
body {{ background:#f1f5f9; color:#1e293b; line-height:1.6; }}
.container {{ max-width:960px; margin:0 auto; padding:0 20px; }}
header {{ background:linear-gradient(135deg,#0f172a,#1e293b); color:#f8fafc; padding:48px 0 40px; }}
h1 {{ font-size:32px; line-height:1.2; margin-bottom:12px; }}
h1 .em {{ color:#fbbf24; }}
.subline {{ color:#94a3b8; font-size:16px; margin-bottom:24px; }}
.cta {{ display:inline-block; background:#f59e0b; color:#fff; padding:16px 32px; border-radius:8px; text-decoration:none; font-weight:700; font-size:17px; margin:4px 8px 4px 0; }}
.cta.phone {{ background:#22c55e; }}
.cta:hover {{ opacity:0.9; }}
section {{ padding:32px 0; }}
h2 {{ font-size:24px; margin-bottom:16px; color:#0f172a; }}
h3 {{ font-size:18px; margin-bottom:8px; color:#334155; }}
.card {{ background:#fff; border-radius:12px; padding:24px; margin:16px 0; box-shadow:0 1px 3px rgba(0,0,0,0.08); }}
table {{ width:100%; border-collapse:collapse; margin-top:12px; }}
th, td {{ padding:10px 14px; text-align:left; border-bottom:1px solid #e2e8f0; }}
th {{ background:#f8fafc; font-weight:700; color:#0f172a; font-size:14px; }}
td {{ font-size:15px; }}
tr:last-child td {{ border-bottom:none; }}
.price {{ font-weight:700; color:#059669; }}
.faq-item {{ margin-bottom:16px; }}
.faq-item h3 {{ color:#0f172a; }}
.faq-item p {{ color:#475569; margin-top:6px; }}
.crosslink {{ background:#fef3c7; border:2px solid #fbbf24; border-radius:12px; padding:16px; }}
.crosslink a {{ color:#78350f; text-decoration:none; display:block; padding:5px 0; font-size:14px; }}
footer {{ background:#0f172a; color:#94a3b8; padding:40px 0 24px; text-align:center; }}
footer a {{ color:#f59e0b; text-decoration:none; }}
.small {{ font-size:13px; margin-top:16px; }}
p {{ margin-bottom:12px; }}
ul {{ margin:8px 0 12px 24px; }}
ul li {{ margin-bottom:6px; }}
@media (max-width:600px) {{ h1{{font-size:26px;}} .cta{{width:100%;text-align:center;margin-bottom:8px;}} }}
</style>
</head>
<body>

<header>
    <div class="container">
        <h1>{h1}</h1>
        <p class="subline">{subline}</p>
        <a href="buchen.html?{buchen_to}{buchen_lat_lon}" class="cta">🚕 Jetzt online anfragen</a>
        <a href="tel:+493837822022" class="cta phone">📞 038378 22022</a>
        {hero_extra}
    </div>
</header>

<div class="container">
{preis_table}
{content_blocks}
{"".join([f'<div class="faq-item"><h3>{q}</h3><p>{a}</p></div>' for q,a in faq_items]) if faq_items else ''}
{"<section><div class=card><h2>Häufige Fragen</h2>" if faq_items else ""}
{"</div></section>" if faq_items else ""}

<section>
    <div class="crosslink">
        <strong>🚕 Weitere Taxi-Services auf Usedom:</strong>
        <a href="landing.html">→ Startseite: Taxi Heringsdorf · Ahlbeck · Bansin</a>
        <a href="taxi-preise.html">→ Preisliste alle Strecken</a>
        <a href="flughafen-heringsdorf.html">→ Flughafentransfer Heringsdorf</a>
        <a href="berlin.html">→ Berlin-Shuttle Usedom</a>
        <a href="taxi-bahnhof-heringsdorf.html">→ Bahnhoftaxi Heringsdorf</a>
        <a href="taxi-bahnhof-ahlbeck.html">→ Bahnhoftaxi Ahlbeck</a>
        <a href="taxi-bahnhof-bansin.html">→ Bahnhoftaxi Bansin</a>
        <a href="taxi-hotel-usedom.html">→ Hotel-Transfer Insel Usedom</a>
    </div>
</section>

</div>

<footer>
    <div class="container">
        <p><strong>Funk Taxi Heringsdorf</strong> · Amselring 10 · 17424 Ostseebad Heringsdorf · <a href="tel:+493837822022">038378 22022</a></p>
        <p class="small">
            <a href="landing.html">Startseite</a> · <a href="buchen.html">Online-Buchung</a> · <a href="kontakt.html">Kontakt</a> · <a href="impressum.html">Impressum</a>
        </p>
        <p class="small" style="opacity:0.7;">© Funk Taxi Heringsdorf — Patrick Wydra · Seit 1991 auf der Insel Usedom.</p>
    </div>
</footer>

</body>
</html>
'''

# ─── PAGE 1: taxi-swinemuende.html ─────────────────────────────────────
def page_swinemuende():
    preis_table = '''
<section>
<div class="card">
<h2>Festpreise nach Świnoujście (Swinemünde)</h2>
<p>Wir fahren Sie täglich zwischen den deutschen Kaiserbädern und dem polnischen Świnoujście — inklusive Grenzübergang. Alle Preise pro Fahrt für bis zu 4 Personen.</p>
<table>
<tr><th>Ab</th><th>Nach Świnoujście</th><th>Distanz</th><th>Preis (Festpreis)</th></tr>
<tr><td>Heringsdorf</td><td>Zentrum / Promenade</td><td>~8 km</td><td class="price">25 EUR</td></tr>
<tr><td>Ahlbeck</td><td>Zentrum / Grenze</td><td>~5 km</td><td class="price">20 EUR</td></tr>
<tr><td>Bansin</td><td>Zentrum</td><td>~12 km</td><td class="price">35 EUR</td></tr>
<tr><td>Zinnowitz</td><td>Zentrum</td><td>~35 km</td><td class="price">85 EUR</td></tr>
<tr><td>Koserow</td><td>Zentrum</td><td>~30 km</td><td class="price">75 EUR</td></tr>
<tr><td>Flughafen Heringsdorf</td><td>Zentrum</td><td>~20 km</td><td class="price">55 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:13px;color:#64748b;">Preise gelten für Standard-PKW (bis 4 Pers.). Großraum-Taxi (bis 8 Pers.) +10 EUR. Nachtzuschlag 22:00–06:00 und So/Feiertag: +5 EUR.</p>
</div>
</section>
'''
    content = '''
<section>
<div class="card">
<h2>Warum Taxi nach Świnoujście mit uns?</h2>
<ul>
<li><strong>Festpreis vorab</strong> — keine Überraschung, kein Taxameter-Stress</li>
<li><strong>Direkter Grenzübergang</strong> — wir kennen alle Übergänge (Ahlbeck, Kamminke)</li>
<li><strong>Kein Umsteigen</strong> — Sie werden vor der Haustür abgeholt und direkt am Ziel abgesetzt</li>
<li><strong>Deutsche Fahrer</strong> mit Erfahrung im Grenzverkehr</li>
<li><strong>24/7 verfügbar</strong> — auch nachts, sonntags, feiertags</li>
<li><strong>Bar oder Karte</strong> — Zahlung in EUR (nicht PLN nötig)</li>
</ul>
</div>
<div class="card">
<h2>Beliebte Ziele in Świnoujście</h2>
<ul>
<li><strong>Promenade Świnoujście</strong> — direkt am Meer, Restaurants, Cafés</li>
<li><strong>Galeria Corso</strong> — Einkaufszentrum, ca. 5 km ab Grenze</li>
<li><strong>Hafen / Fähre</strong> — Anschluss nach Schweden</li>
<li><strong>Bahnhof Świnoujście</strong> — Verbindungen nach Stettin, Warschau</li>
<li><strong>Kliniken / Sanatorien</strong> — Kurhotels und Rehazentren</li>
<li><strong>Woliński Nationalpark</strong> — Naturausflug</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Was kostet ein Taxi von Heringsdorf nach Świnoujście?',
         'Der Festpreis beträgt 25 EUR pro Fahrt für bis zu 4 Personen. Nachtzuschlag ab 22:00 Uhr: +5 EUR.'),
        ('Braucht man einen Reisepass?',
         'Nein. Als EU-Bürger reicht der Personalausweis. Der Übergang ist offen, keine feste Grenzkontrolle. Ausnahmslos Sichtprüfung möglich.'),
        ('Wo kann ich bezahlen — EUR oder PLN?',
         'Wir akzeptieren nur EUR (Bar oder Karte). PLN nicht nötig — der Fahrpreis läuft in Deutschland ab.'),
        ('Wartet der Fahrer für Rückfahrt?',
         'Auf Wunsch ja. Wartezeit 1 EUR/Min. Alternativ vereinbaren wir eine feste Abholzeit — dann steht der Wagen wieder pünktlich vor der Tür.'),
        ('Wie lange dauert die Fahrt?',
         'Von Heringsdorf ca. 15 Min inkl. Grenzübergang. Von Ahlbeck ca. 10 Min. Zur Hauptsaison kann es an der Grenze zu Wartezeit kommen.'),
    ]
    return base_template(
        slug='taxi-swinemuende',
        title='Taxi nach Świnoujście (Swinemünde) · Festpreis ab 20 EUR | Funk Taxi',
        meta_desc='Taxi von Heringsdorf, Ahlbeck, Bansin nach Świnoujście (Swinemünde) — Festpreis, kein Taxameter, direkte Fahrt inkl. Grenzübergang. Ab 20 EUR. 24/7 unter 038378 22022.',
        h1='Taxi nach <span class="em">Świnoujście</span> (Swinemünde)',
        subline='Festpreise ab Heringsdorf · Ahlbeck · Bansin ab 20 EUR — 24/7 verfügbar',
        hero_extra='<p style="margin-top:16px;color:#cbd5e1;font-size:14px;">✓ Festpreis ohne Taxameter · ✓ Direkter Grenzübergang · ✓ Bar oder Karte in EUR</p>',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords='taxi swinemünde, taxi nach swinemünde, taxi heringsdorf swinemünde, taxi ahlbeck swinemünde, taxi bansin swinemünde, taxi kosten swinemünde, taxi polen swinemünde',
        buchen_to='to=' + 'Promenada Zdrojowa, Świnoujście, Polen'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.911&toLon=14.247',
    )

# ─── PAGE 2: taxi-heringsdorf-swinemuende.html ─────────────────────────
def page_hdf_swi():
    preis_table = '''
<section>
<div class="card">
<h2>Was kostet ein Taxi von Heringsdorf nach Świnoujście?</h2>
<p style="font-size:20px;margin-bottom:16px;"><strong class="price">25 EUR Festpreis</strong> pro Fahrt (bis 4 Personen) — inklusive Grenzübergang.</p>
<table>
<tr><th>Distanz</th><td>~8 km</td></tr>
<tr><th>Fahrtdauer</th><td>ca. 15 Min (Hauptsaison bis 25 Min bei Grenzverkehr)</td></tr>
<tr><th>Personen</th><td>1–4 (Standard PKW)</td></tr>
<tr><th>Preis</th><td class="price">25 EUR fest</td></tr>
<tr><th>Nachtzuschlag</th><td>+5 EUR (22:00–06:00 Uhr, Sonn-/Feiertage)</td></tr>
<tr><th>Großraum bis 8 Pers.</th><td class="price">35 EUR</td></tr>
<tr><th>Rückfahrt inkl. Wartezeit</th><td>+15 EUR pro Stunde Warten</td></tr>
</table>
</div>
</section>
'''
    content = '''
<section>
<div class="card">
<h2>Direkte Verbindung Heringsdorf → Świnoujście</h2>
<p>Sie werden vor Ihrem Hotel, Ihrer Ferienwohnung oder wo immer Sie in Heringsdorf sind, abgeholt und direkt nach Świnoujście gebracht — Zentrum, Promenade, Bahnhof oder ein Restaurant Ihrer Wahl. Kein Umsteigen, kein Warten auf Bus oder Sammeltaxi.</p>
<p>Wir fahren die Strecke täglich mehrfach, unsere Fahrer kennen alle Grenzübergänge und die kürzesten Wege zu jedem Ziel in Świnoujście.</p>
</div>
<div class="card">
<h2>Vorteile gegenüber Bus / Grenzbus</h2>
<ul>
<li><strong>Kein Umstieg</strong> — Bus erfordert oft Umstieg an der Grenze, Fußweg 500m+</li>
<li><strong>Direkte Adresse</strong> — Sie werden am Zielhotel/Restaurant abgesetzt, nicht am nächsten Bahnhof</li>
<li><strong>Flexibel</strong> — jede Uhrzeit, auch nachts wenn keine Busse fahren</li>
<li><strong>Rückfahrt garantiert</strong> — nicht auf letzte Rückfahrt angewiesen</li>
<li><strong>Gepäck-freundlich</strong> — Koffer im Kofferraum, nicht schleppen</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Ist der Grenzübergang immer offen?',
         'Ja, der Übergang zwischen Ahlbeck und Świnoujście ist 24/7 offen. Nur bei Ausnahmesituationen (letzte 2020) gab es Kontrollen — aktuell freier Verkehr.'),
        ('Kann ich die Fahrt vorher buchen?',
         'Ja — online über unser Formular mit Datum/Zeit oder telefonisch unter 038378 22022. Bei Voranmeldung ist der Wagen pünktlich zur gewünschten Zeit vor Ihrer Tür.'),
        ('Was ist der Unterschied zum Bus?',
         'Der Bus fährt zwischen festen Haltestellen. Wir fahren direkt von Haustür zu Haustür — ohne Umsteigen oder Warten. Bei Regen oder mit Gepäck ein deutlicher Komfort-Gewinn.'),
        ('Ist der Fahrer polnisch- oder deutschsprachig?',
         'Alle unsere Fahrer sprechen Deutsch. Grundkenntnisse in Polnisch oder Englisch für Notfälle in Świnoujście vorhanden.'),
    ]
    return base_template(
        slug='taxi-heringsdorf-swinemuende',
        title='Was kostet Taxi von Heringsdorf nach Świnoujście? · 25 EUR Festpreis',
        meta_desc='Taxi Heringsdorf → Świnoujście: 25 EUR Festpreis für bis zu 4 Personen. Direkt, kein Umsteigen, 24/7. Buchbar online oder unter 038378 22022.',
        h1='Taxi <span class="em">Heringsdorf → Świnoujście</span>',
        subline='25 EUR Festpreis · ca. 15 Min Fahrt · bis 4 Personen · 24/7',
        hero_extra='',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords='taxi heringsdorf swinemünde, taxi heringsdorf swinoujscie, taxi kosten heringsdorf polen, taxi von heringsdorf nach swinemünde, was kostet taxi heringsdorf swinemünde',
        buchen_to='from=' + 'Heringsdorf'.replace(' ','%20') + '&to=' + 'Świnoujście, Polen'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.911&toLon=14.247',
    )

# ─── PAGE 3: taxi-ahlbeck-swinemuende.html ─────────────────────────────
def page_ahl_swi():
    preis_table = '''
<section>
<div class="card">
<h2>Taxi Ahlbeck → Świnoujście: der kürzeste Weg</h2>
<p style="font-size:20px;margin-bottom:16px;"><strong class="price">20 EUR Festpreis</strong> — nur ~5 km über die Grenze.</p>
<table>
<tr><th>Distanz</th><td>~5 km (kürzeste deutsch-polnische Taxi-Strecke!)</td></tr>
<tr><th>Fahrtdauer</th><td>ca. 10 Min</td></tr>
<tr><th>Preis</th><td class="price">20 EUR fest (bis 4 Pers.)</td></tr>
<tr><th>Großraum bis 8 Pers.</th><td class="price">30 EUR</td></tr>
<tr><th>Nachtzuschlag</th><td>+5 EUR</td></tr>
</table>
</div>
</section>
'''
    content = '''
<section>
<div class="card">
<h2>Vom Ahlbecker Strand nach Świnoujście</h2>
<p>Ahlbeck liegt direkt an der polnischen Grenze — die Fahrt nach Świnoujście ist eine der kürzesten und günstigsten grenzüberschreitenden Taxi-Verbindungen an der Ostsee. In nur 10 Minuten sind Sie vom Ahlbecker Strand am Promenaden-Zentrum von Świnoujście.</p>
</div>
<div class="card">
<h2>Beliebte Ziele in Świnoujście ab Ahlbeck</h2>
<ul>
<li>Promenade Zdrojowa (Kurpromenade)</li>
<li>Muschel-Konzertmuschel / Freilichtbühne</li>
<li>Galeria Corso (Shopping)</li>
<li>Hafen mit Fähranleger</li>
<li>Kurhaus / Salzgrotte</li>
<li>Restaurants in der Innenstadt</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Warum ist die Fahrt so günstig?',
         'Weil die Distanz nur 5 km beträgt. Ahlbeck grenzt direkt an Świnoujście — kein deutsches Taxi hat kürzere internationale Fahrten.'),
        ('Muss ich vorher tanken/wechseln?',
         'Nein — wir akzeptieren Zahlung in EUR (Bar oder Karte). Sie brauchen keine polnischen Zloty.'),
        ('Läuft der Taxameter mit?',
         'Nein. 20 EUR Festpreis fix — kein Taxameter, keine Überraschung am Ende.'),
    ]
    return base_template(
        slug='taxi-ahlbeck-swinemuende',
        title='Taxi Ahlbeck → Świnoujście · 20 EUR Festpreis, 10 Min | Funk Taxi',
        meta_desc='Taxi Ahlbeck nach Świnoujście: nur 20 EUR für 5 km. Direkte Fahrt in 10 Minuten. Buchen unter 038378 22022 oder online.',
        h1='Taxi <span class="em">Ahlbeck → Świnoujście</span>',
        subline='20 EUR Festpreis · nur 10 Min · direkt über die Grenze',
        hero_extra='',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords='taxi ahlbeck swinemünde, taxi ahlbeck grenze, taxi von ahlbeck nach swinemünde, taxi ahlbeck polen',
        buchen_to='from=' + 'Ahlbeck'.replace(' ','%20') + '&to=' + 'Świnoujście, Polen'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.911&toLon=14.247',
    )

# ─── PAGE 4: taxi-usedom-preise.html ───────────────────────────────────
def page_usedom_preise():
    preis_table = '''
<section>
<div class="card">
<h2>Preisübersicht Taxi Insel Usedom</h2>
<p>Landestarif Mecklenburg-Vorpommern + unsere Festpreise für häufige Strecken. Alle Preise inkl. MwSt., pro Fahrt (bis 4 Personen).</p>
<h3 style="margin-top:20px;">Grundtarif nach Landestarif MV</h3>
<table>
<tr><th>Grundgebühr</th><td class="price">4,50 EUR</td></tr>
<tr><th>Pro Kilometer (Tag)</th><td class="price">2,20 EUR</td></tr>
<tr><th>Pro Kilometer (Nacht 22-6, So/Feiertag)</th><td class="price">2,50 EUR</td></tr>
<tr><th>Wartezeit / Std.</th><td class="price">30,00 EUR</td></tr>
<tr><th>Großraum-Zuschlag (bis 8 Pers.)</th><td class="price">+10 EUR</td></tr>
</table>
<h3 style="margin-top:20px;">Festpreise häufige Strecken (Beispiele)</h3>
<table>
<tr><th>Strecke</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Bahnhof Heringsdorf → Strandpromenade</td><td>2 km</td><td class="price">10 EUR</td></tr>
<tr><td>Bansin → Ahlbeck</td><td>5 km</td><td class="price">18 EUR</td></tr>
<tr><td>Heringsdorf → Flughafen</td><td>10 km</td><td class="price">28 EUR</td></tr>
<tr><td>Heringsdorf → Świnoujście</td><td>8 km</td><td class="price">25 EUR</td></tr>
<tr><td>Ahlbeck → Świnoujście</td><td>5 km</td><td class="price">20 EUR</td></tr>
<tr><td>Heringsdorf → Zinnowitz</td><td>25 km</td><td class="price">55 EUR</td></tr>
<tr><td>Heringsdorf → Berlin BER</td><td>230 km</td><td class="price">350 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:13px;color:#64748b;">Weitere Strecken siehe <a href="taxi-preise.html" style="color:#0369a1;">Preisliste alle Strecken</a> oder einfach anfragen — Sie erhalten immer einen verbindlichen Festpreis vorab.</p>
</div>
</section>
'''
    content = '''
<section>
<div class="card">
<h2>Warum Festpreise statt Taxameter?</h2>
<p>Bei uns wissen Sie den Preis <strong>vorab</strong>. Kein Blick auf den Taxameter, keine Sorge dass ein Umweg teurer wird. Das schafft Vertrauen und beugt Missverständnissen vor — besonders im Urlaub.</p>
<p>Alle Festpreise entsprechen dem Landestarif oder liegen darunter. Wir garantieren: <strong>Sie zahlen nie mehr als den angesagten Preis.</strong></p>
</div>
</section>
'''
    faqs = [
        ('Wie kommt der Preis zustande?',
         'Grundgebühr + Kilometerpreis nach Landestarif MV. Alternativ verhandeln wir einen Festpreis für die Strecke — Sie wissen dann exakt was Sie zahlen.'),
        ('Ist Kartenzahlung möglich?',
         'Ja — in fast allen unseren Fahrzeugen. Bitte bei der Buchung angeben.'),
        ('Gibt es Zuschläge?',
         'Nachts (22–6 Uhr), So+Feiertag: +30 Cent/km. Großraumtaxi (bis 8 Pers.): +10 EUR pauschal. Gepäck kostenlos.'),
    ]
    return base_template(
        slug='taxi-usedom-preise',
        title='Taxi Usedom Preise · Festpreise + Landestarif MV | Funk Taxi',
        meta_desc='Taxi Preise Insel Usedom: Grundgebühr 4,50 EUR + 2,20 EUR/km. Festpreise für häufige Strecken (Bahnhof, Flughafen, Świnoujście). Transparent + fair.',
        h1='Taxi <span class="em">Usedom Preise</span>',
        subline='Grundtarif + Festpreise für die häufigsten Strecken — transparent, fair',
        hero_extra='',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords='taxi usedom preise, taxi preise usedom, was kostet taxi usedom, taxi heringsdorf preise, taxi kosten kaiserbäder, taxameter usedom',
        buchen_to='',
        buchen_lat_lon='',
    )

# ─── PAGE 5: taxi-22022.html ────────────────────────────────────────────
def page_22022():
    preis_table = '''
<section>
<div class="card" style="text-align:center;background:#fef3c7;border:2px solid #fbbf24;">
<h2 style="font-size:36px;color:#78350f;">📞 038378 · 22022</h2>
<p style="font-size:18px;color:#78350f;margin-top:8px;">Ihre Taxi-Nummer für die Insel Usedom · 24/7</p>
<a href="tel:+493837822022" class="cta phone" style="margin-top:16px;">Jetzt anrufen</a>
</div>
</section>
'''
    content = '''
<section>
<div class="card">
<h2>Die Nummer für Taxi auf Usedom: 22022</h2>
<p>Seit über 30 Jahren steht die <strong>22022</strong> für zuverlässiges Taxi in Heringsdorf, Ahlbeck, Bansin und der ganzen Insel Usedom. Egal ob Sie Ihren Zug am Bahnhof erwischen müssen, vom Flughafen abgeholt werden wollen oder einfach eine Fahrt zum Restaurant brauchen — wir sind da.</p>
</div>
<div class="card">
<h2>Wann Sie uns anrufen sollten</h2>
<ul>
<li><strong>Sofort-Fahrt</strong> — meist innerhalb 5–15 Min bei Ihnen</li>
<li><strong>Vorbestellung</strong> — Termin, Flug, Zug: fest reservieren</li>
<li><strong>Bahnhoftransfer</strong> — Heringsdorf, Ahlbeck, Bansin, Züssow</li>
<li><strong>Flughafentransfer</strong> — Heringsdorf, Berlin BER, Rostock, Hamburg</li>
<li><strong>Grenzfahrt</strong> — nach Świnoujście, Misdroy, Stettin</li>
<li><strong>Krankenfahrt</strong> — mit Transportschein, Abrechnung über Krankenkasse</li>
</ul>
</div>
<div class="card">
<h2>Alternativ: Online buchen mit Festpreis-Anzeige</h2>
<p>Wenn Sie lieber online buchen — auf unserer <a href="buchen.html" style="color:#0369a1;">Buchungsseite</a> geben Sie einfach Abholort und Ziel ein und sehen sofort den Festpreis. Nach Bestätigung ist Ihr Taxi automatisch bestellt.</p>
</div>
</section>
'''
    faqs = [
        ('Wie erreiche ich die 22022?',
         'Die vollständige Nummer ist 038378 22022 (Vorwahl 038378 für Heringsdorf + Ostseebad). Aus dem Ausland: +49 38378 22022.'),
        ('Kostet der Anruf extra?',
         'Nein — es ist ein normaler Festnetzanruf zur Vorwahl von Heringsdorf. Ihre Standard-Telefontarife gelten.'),
        ('Ist die Nummer 24/7 besetzt?',
         'Ja — 24 Stunden am Tag, 7 Tage die Woche. Auch an Sonn- und Feiertagen.'),
        ('Kann ich statt anrufen auch schreiben?',
         'Ja — WhatsApp: 0151 27585179. Oder E-Mail: taxiwydra@googlemail.com. Für kurzfristige Fahrten ist Anruf schneller.'),
    ]
    return base_template(
        slug='taxi-22022',
        title='Taxi 22022 Heringsdorf · 038378 22022 · 24/7 Insel Usedom',
        meta_desc='Taxi-Nummer 22022 für die Insel Usedom — 038378 22022 · 24/7 · Heringsdorf, Ahlbeck, Bansin, Flughafen, Świnoujście. Sofort oder vorbestellen.',
        h1='Taxi <span class="em">22022</span> — Ihre Nummer auf Usedom',
        subline='038378 22022 · 24 Stunden erreichbar · seit 1991 zuverlässig',
        hero_extra='',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords='taxi 22022, taxi nummer heringsdorf, 038378 22022, taxi nummer usedom, funk taxi 22022, ruftaxi heringsdorf',
        buchen_to='',
        buchen_lat_lon='',
    )

# ─── PAGE 6: taxi-usedom-zinnowitz.html ────────────────────────────────
def page_zinnowitz():
    preis_table = '''
<section>
<div class="card">
<h2>Festpreise nach / von Zinnowitz</h2>
<table>
<tr><th>Ab / Nach</th><th>Zinnowitz</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Heringsdorf</td><td>Zentrum</td><td>~25 km</td><td class="price">55 EUR</td></tr>
<tr><td>Ahlbeck</td><td>Zentrum</td><td>~30 km</td><td class="price">65 EUR</td></tr>
<tr><td>Bansin</td><td>Zentrum</td><td>~18 km</td><td class="price">45 EUR</td></tr>
<tr><td>Koserow</td><td>Zentrum</td><td>~10 km</td><td class="price">28 EUR</td></tr>
<tr><td>Flughafen Heringsdorf</td><td>Zentrum</td><td>~32 km</td><td class="price">75 EUR</td></tr>
<tr><td>Bahnhof Züssow</td><td>Bahnhof</td><td>~35 km</td><td class="price">75 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:13px;color:#64748b;">Preise inkl. Anfahrt. Nachtzuschlag +5 EUR. Großraum-Taxi (bis 8 Pers.) +10 EUR.</p>
</div>
</section>
'''
    content = '''
<section>
<div class="card">
<h2>Taxi Nord-Usedom: Zinnowitz, Karlshagen, Trassenheide</h2>
<p>Zinnowitz liegt im nördlichen Teil der Insel Usedom — vom Kaiserbäder-Zentrum (Heringsdorf/Ahlbeck/Bansin) rund 25–30 km entfernt. Wir bringen Sie zuverlässig zum Ostseestrand Zinnowitz, zur Vineta-Bühne, zum Karls-Erlebnisdorf oder zu jedem anderen Ziel im Norden.</p>
</div>
<div class="card">
<h2>Beliebte Ziele in Zinnowitz und Umgebung</h2>
<ul>
<li><strong>Vineta-Festspiele</strong> — Freilichttheater direkt am Wasser</li>
<li><strong>Karls Erlebnisdorf Koserow</strong> — Freizeitpark für Familien</li>
<li><strong>Baumwipfelpfad Heringsdorf</strong> — Weg dorthin auch von Zinnowitz</li>
<li><strong>Peenemünde</strong> — Historisches Museum</li>
<li><strong>Trassenheide</strong> — Schmetterlingsfarm</li>
<li><strong>Karlshagen</strong> — Fähranleger, ruhiger Strand</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Wie lange dauert die Fahrt von Heringsdorf nach Zinnowitz?',
         'Ca. 30–40 Minuten je nach Verkehr. Die Strecke geht über Ückeritz und Koserow entlang der Ostseeküste.'),
        ('Fahrt ihr auch nachts nach Zinnowitz zurück?',
         'Ja — 24/7. Nachtzuschlag +5 EUR. Auch nach Vineta-Vorstellungen oder Konzerten sind wir für die Rückfahrt buchbar.'),
        ('Kann ich einen Rundtrip mit Wartezeit buchen?',
         'Ja — z.B. Heringsdorf → Vineta-Bühne, Wartezeit während der Show, Rückfahrt. Wartezeit 1 EUR/Min.'),
    ]
    return base_template(
        slug='taxi-usedom-zinnowitz',
        title='Taxi nach Zinnowitz · Festpreise ab 45 EUR ab Kaiserbädern | Funk Taxi',
        meta_desc='Taxi von Heringsdorf, Ahlbeck, Bansin nach Zinnowitz — Festpreise ab 45 EUR, direkte Fahrt zum Nord-Usedom. Vineta, Karls Erlebnisdorf, Peenemünde.',
        h1='Taxi Usedom <span class="em">Zinnowitz</span>',
        subline='Ab Kaiserbädern ins nördliche Usedom — Festpreise ab 45 EUR',
        hero_extra='',
        preis_table=preis_table,
        content_blocks=content,
        faq_items=faqs,
        keywords='taxi usedom zinnowitz, taxi zinnowitz, taxi heringsdorf zinnowitz, taxi ahlbeck zinnowitz, taxi nord usedom, vineta taxi, taxi karls koserow',
        buchen_to='to=' + 'Zinnowitz'.replace(' ','%20'),
        buchen_lat_lon='&toLat=54.069&toLon=13.91',
    )

# ─── MAIN ───────────────────────────────────────────────────────────────
def main():
    pages = [
        ('taxi-swinemuende.html', page_swinemuende()),
        ('taxi-heringsdorf-swinemuende.html', page_hdf_swi()),
        ('taxi-ahlbeck-swinemuende.html', page_ahl_swi()),
        ('taxi-usedom-preise.html', page_usedom_preise()),
        ('taxi-22022.html', page_22022()),
        ('taxi-usedom-zinnowitz.html', page_zinnowitz()),
    ]
    for fn, html in pages:
        (REPO / fn).write_text(html, encoding='utf-8')
        print(f'✅ {fn} ({len(html)} bytes)')

    # Sitemap update
    from datetime import date
    today = date.today().isoformat()
    sitemap = (REPO / 'sitemap.xml').read_text(encoding='utf-8')
    for fn, _ in pages:
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
    print(f'✅ sitemap.xml aktualisiert (+{len(pages)} URLs, priority 0.85)')

if __name__ == '__main__':
    main()
