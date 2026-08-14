#!/usr/bin/env python3
"""Generator Batch 3: 11 weitere Long-Tail-Landings — alle offenen Kandidaten.

Patrick 14.08.: 'alle machen'.

Kategorien:
  A) Grenzfahrten:  bansin-swinemuende, koserow-swinemuende, heringsdorf-misdroy
  B) Fernstrecken:  heringsdorf-berlin
  C) Flughafen:     flughafen-heringsdorf-bansin
  D) Ort-Allgemein: usedom-koserow, usedom-trassenheide
  E) Themen:        grosstaxi-usedom, sammeltaxi-ahlbeck, ruftaxi-usedom, krankenfahrt-usedom
"""
import sys
from pathlib import Path

# base_template + REPO/DOMAIN via exec aus batch1
_here = Path(__file__).resolve().parent
_gt_src = (_here / 'generate-longtail-landings.py').read_text(encoding='utf-8')
_ns = {'__file__': str(_here / 'generate-longtail-landings.py'), '__name__': '_gt'}
exec(compile(_gt_src, str(_here / 'generate-longtail-landings.py'), 'exec'), _ns)
base_template = _ns['base_template']
REPO = _ns['REPO']
DOMAIN = _ns['DOMAIN']

def de_umlaut(s):
    return s.replace('ü','ue').replace('ö','oe').replace('ä','ae').replace('ß','ss')

# ═══════════════════════════════════════════════════════════════════════
# A) GRENZFAHRTEN
# ═══════════════════════════════════════════════════════════════════════

def page_bansin_swi():
    preis_table = '''
<section><div class="card">
<h2>Festpreis Bansin → Świnoujście</h2>
<p style="font-size:20px;margin-bottom:12px;"><strong class="price">35 EUR Festpreis</strong> (bis 4 Personen)</p>
<table>
<tr><th>Distanz</th><td>~12 km</td></tr>
<tr><th>Fahrtdauer</th><td>ca. 20 Min</td></tr>
<tr><th>Preis</th><td class="price">35 EUR</td></tr>
<tr><th>Nachtzuschlag</th><td>+5 EUR</td></tr>
<tr><th>Großraum bis 8 Pers.</th><td class="price">45 EUR</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Vom Bansiner Strand nach Świnoujście — die entspannte Alternative zum Auto</h2>
<p>Bansin ist das westlichste der drei Kaiserbäder. Von hier ist Świnoujście etwa 12 km entfernt — mit dem Auto durch Heringsdorf/Ahlbeck über die Grenze in Kamminke oder alternativ am Wasser entlang.</p>
<p>Warum Taxi statt eigenes Auto?
Parkplätze in Świnoujście-Zentrum sind Mangelware. Als Fahrer nach 2-3 Wodka bei „Karczma Polska" wollen Sie ohnehin nicht mehr fahren. Wir bringen Sie hin und wieder zurück — Festpreis, kein Parkplatz-Stress.</p>
</div>
<div class="card">
<h2>Beliebte Ziele in Świnoujście ab Bansin</h2>
<ul>
<li><strong>Promenade Zdrojowa</strong> — Kurpromenade mit Cafés, Restaurants, Wellness</li>
<li><strong>Galeria Corso</strong> — Einkaufszentrum am Stadtrand</li>
<li><strong>Kurhaus + Salzgrotte</strong> — Wellness-Erlebnis</li>
<li><strong>Hafen mit Fähre</strong> — Übersetzten nach Schweden</li>
<li><strong>Woliński Nationalpark</strong> — Naturausflug jenseits der Stadt</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Wie lange dauert die Fahrt Bansin → Świnoujście?',
         'Ca. 20 Minuten. Zur Hauptsaison kann Grenzverkehr die Fahrt auf 25-30 Min verlängern.'),
        ('Zahlung EUR oder PLN?',
         'Nur EUR — Bar oder Karte. Sie brauchen keine polnischen Zloty.'),
        ('Wartet ihr auf die Rückfahrt?',
         'Ja auf Wunsch. Wartezeit 1 EUR/Min. Oder wir vereinbaren feste Abholzeit.'),
    ]
    return base_template(
        slug='taxi-bansin-swinemuende',
        title='Taxi Bansin → Świnoujście · 35 EUR Festpreis | Funk Taxi',
        meta_desc='Taxi Bansin nach Świnoujście: 35 EUR Festpreis für 12 km. Direkte Fahrt in 20 Min, 24/7, Bar oder Karte in EUR.',
        h1='Taxi <span class="em">Bansin → Świnoujście</span>',
        subline='35 EUR Festpreis · ca. 20 Min · 24/7 verfügbar',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi bansin swinemünde, taxi bansin polen, taxi bansin swinoujscie, taxi von bansin nach swinemünde',
        buchen_to='from=Bansin&to=' + 'Świnoujście, Polen'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.911&toLon=14.247',
    )

def page_koserow_swi():
    preis_table = '''
<section><div class="card">
<h2>Festpreis Koserow → Świnoujście</h2>
<p style="font-size:20px;margin-bottom:12px;"><strong class="price">75 EUR Festpreis</strong> (bis 4 Personen)</p>
<table>
<tr><th>Distanz</th><td>~30 km über Ahlbecker Grenze</td></tr>
<tr><th>Fahrtdauer</th><td>ca. 40 Min</td></tr>
<tr><th>Preis</th><td class="price">75 EUR</td></tr>
<tr><th>Großraum bis 8 Pers.</th><td class="price">85 EUR</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Vom Streckelsberg nach Świnoujście — 40 Min ohne Umsteigen</h2>
<p>Koserow liegt im Zentrum der Insel Usedom. Bis Świnoujście sind es 30 km entlang der Küste über Ückeritz, Bansin, Ahlbeck. Bus wäre 1,5-2 Stunden mit mindestens einem Umstieg. Mit uns direkt in 40 Min.</p>
</div>
<div class="card">
<h2>Wann Koserower ins polnische Seebad fahren</h2>
<ul>
<li>Sonntagsausflug zur Promenade in Świnoujście</li>
<li>Einkauf im Galeria Corso</li>
<li>Fährverbindung nach Schweden</li>
<li>Termine in polnischen Kliniken/Zahnärzten</li>
<li>Abendessen in Restaurants der Świnoujście-Altstadt</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Warum ist die Fahrt teurer als Bansin → Świnoujście?',
         'Weil die Distanz mit 30 km mehr als doppelt so weit ist (Bansin nur 12 km). Kilometerpreis nach Landestarif.'),
        ('Fährt der Bus nicht auch?',
         'Ja aber mit 1,5-2 Stunden Fahrzeit inkl. Umstieg. Wir sind in 40 Min direkt am Ziel.'),
    ]
    return base_template(
        slug='taxi-koserow-swinemuende',
        title='Taxi Koserow → Świnoujście · 75 EUR Festpreis, 40 Min | Funk Taxi',
        meta_desc='Taxi Koserow nach Świnoujście: 75 EUR Festpreis für 30 km. Direkt in 40 Minuten, ohne Umsteigen. 24/7 unter 038378 22022.',
        h1='Taxi <span class="em">Koserow → Świnoujście</span>',
        subline='75 EUR Festpreis · 30 km · 40 Min direkt ohne Umsteigen',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi koserow swinemünde, taxi koserow polen, taxi von koserow nach swinemünde',
        buchen_to='from=Koserow&to=' + 'Świnoujście, Polen'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.911&toLon=14.247',
    )

def page_hdf_misdroy():
    preis_table = '''
<section><div class="card">
<h2>Festpreis Heringsdorf → Misdroy (Międzyzdroje)</h2>
<p style="font-size:20px;margin-bottom:12px;"><strong class="price">65 EUR Festpreis</strong> (bis 4 Personen)</p>
<table>
<tr><th>Distanz</th><td>~25 km über Świnoujście</td></tr>
<tr><th>Fahrtdauer</th><td>ca. 35 Min</td></tr>
<tr><th>Preis</th><td class="price">65 EUR</td></tr>
<tr><th>Rückfahrt Wartezeit</th><td>+30 EUR/h</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Nach Misdroy — Polens „St. Tropez"</h2>
<p>Międzyzdroje (deutsch Misdroy) ist ein charmanter polnischer Kurort mit ~5 km Promenade, Vergnügungspark, Steilküsten und dem Wolin-Nationalpark. Von Heringsdorf 25 km Richtung Osten — Fahrt geht durch Świnoujście entlang der Ostseeküste.</p>
</div>
<div class="card">
<h2>Warum Taxi statt Bus/Auto?</h2>
<ul>
<li><strong>Kein Grenzfahrt-Stress</strong> — wir kennen die Route</li>
<li><strong>Rückfahrt sicher</strong> — Bus fährt selten und macht 2h+ mit Umstieg</li>
<li><strong>Direkt zum Ziel</strong> — Promenade, Restaurant, Museum</li>
<li><strong>Rundfahrt möglich</strong> — mit Wartezeit während Sie am Strand oder essen sind</li>
</ul>
</div>
'''
    faqs = [
        ('Ist die Grenze zu Misdroy jederzeit offen?',
         'Ja — auch nachts. Wir passieren Świnoujście und fahren dann noch 15 km die Küste entlang.'),
        ('Kann man einen Tagesausflug mit Wartezeit buchen?',
         'Ja — Hinfahrt 65 EUR, dann Wartezeit 30 EUR/h während Ihres Aufenthalts, Rückfahrt weitere 65 EUR. Alternativ 2 Einzelfahrten wenn Sie später zurück wollen.'),
    ]
    return base_template(
        slug='taxi-heringsdorf-misdroy',
        title='Taxi Heringsdorf → Misdroy (Międzyzdroje) · 65 EUR | Funk Taxi',
        meta_desc='Taxi von Heringsdorf nach Misdroy/Międzyzdroje: 65 EUR Festpreis, 35 Min über Świnoujście. Tagesausflug mit Wartezeit möglich.',
        h1='Taxi <span class="em">Heringsdorf → Misdroy</span>',
        subline='65 EUR Festpreis · 25 km · Międzyzdroje polnisches St. Tropez',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi heringsdorf misdroy, taxi misdroy, taxi międzyzdroje, taxi swinemünde nach misdroy',
        buchen_to='from=Heringsdorf&to=' + 'Międzyzdroje, Polen'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.929&toLon=14.451',
    )

# ═══════════════════════════════════════════════════════════════════════
# B) FERNSTRECKE
# ═══════════════════════════════════════════════════════════════════════

def page_hdf_berlin():
    preis_table = '''
<section><div class="card">
<h2>Festpreis Heringsdorf → Berlin</h2>
<table>
<tr><th>Ziel Berlin</th><th>Distanz</th><th>Fahrtdauer</th><th>Preis (Festpreis)</th></tr>
<tr><td>Berlin Hbf</td><td>~230 km</td><td>~2:45 h</td><td class="price">350 EUR</td></tr>
<tr><td>Flughafen BER</td><td>~250 km</td><td>~3:00 h</td><td class="price">380 EUR</td></tr>
<tr><td>Berlin Innenstadt (Hotel)</td><td>~230 km</td><td>~2:45 h</td><td class="price">350 EUR</td></tr>
<tr><td>Berlin-Charité</td><td>~230 km</td><td>~2:45 h</td><td class="price">350 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:13px;color:#64748b;">Preise inkl. Anfahrt Rückfahrt-leer. Großraum-Taxi (bis 8 Pers.) +30 EUR. Zwischenstopp +15 EUR. Nachtaufschlag entfällt bei Vorbestellung.</p>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Direktfahrt Kaiserbäder → Berlin — komfortabler als Bahn</h2>
<p>Von Heringsdorf zum Berliner Hauptbahnhof sind es 230 km — mit uns direkt in 2:45 Stunden. Zum Vergleich: Bahn braucht 3-4 Stunden mit mind. einem Umstieg in Züssow, oft Stralsund.</p>
<p>Wir holen Sie vor Ihrer Haustür / Hotel ab und bringen Sie direkt zum Zielhotel, Bahnhof oder Flughafen BER — ohne Umstiege, ohne schweres Gepäck-Schleppen.</p>
</div>
<div class="card">
<h2>Wann sich Taxi statt Bahn lohnt</h2>
<ul>
<li><strong>Zu zweit+ oder mit Familie</strong> — Bahn 4x60 EUR = 240 EUR, Taxi 350 EUR fest</li>
<li><strong>Mit viel Gepäck</strong> — kein Schleppen zwischen Bahnhöfen</li>
<li><strong>Ferienbeginn/-ende</strong> — Züge oft überfüllt</li>
<li><strong>Zeitzwang</strong> — Flug in Berlin, keine Anschluss-Verspätung riskieren</li>
<li><strong>Krankheit/Mobilität</strong> — Direktfahrt ohne Umstieg</li>
<li><strong>Frühmorgens / Spätnachts</strong> — wenn kaum Bahn-Verbindungen</li>
</ul>
</div>
<div class="card">
<h2>Was inklusive ist</h2>
<ul>
<li>Abholung ab Ihrer Adresse in Heringsdorf/Ahlbeck/Bansin (kein Aufschlag Kaiserbäder-Bereich)</li>
<li>Direkte Autobahn-Fahrt A20/A19 → Berlin</li>
<li>Gepäck-Handling</li>
<li>Bei Bedarf Kindersitze (kostenlos, bitte anfragen)</li>
<li>Kartenzahlung möglich</li>
</ul>
</div>
</section>
'''
    faqs = [
        ('Wie lange im Voraus muss ich buchen?',
         'Für Berlin-Fahrten mindestens 24 Stunden Vorlauf empfohlen. Kurzfristig ab 2 Stunden möglich falls Fahrzeug frei.'),
        ('Was passiert bei Stau?',
         'Der Festpreis bleibt fix. Wir kalkulieren mit typischen Verkehrszeiten und übernehmen das Risiko.'),
        ('Rückfahrt am gleichen Tag mit Wartezeit?',
         'Möglich, aber teuer — ca. 35 EUR/h Wartezeit + 350 EUR Rückfahrt. Meist günstiger: 2. Einzelfahrt beauftragen.'),
        ('Zahlung: Bar / Karte / Überweisung?',
         'Alle drei möglich. Bei Überweisung: Vorkasse-Vereinbarung vor Fahrtantritt.'),
    ]
    return base_template(
        slug='taxi-heringsdorf-berlin',
        title='Taxi Heringsdorf → Berlin · 350 EUR direkt zum Ziel | Funk Taxi',
        meta_desc='Taxi Direktfahrt Heringsdorf → Berlin: 350 EUR für 230 km, 2:45h, keine Umstiege. Berlin Hbf / BER Flughafen / Hotels. 24h vorbestellen unter 038378 22022.',
        h1='Taxi <span class="em">Heringsdorf → Berlin</span>',
        subline='350 EUR Festpreis · Berlin Hbf · Flughafen BER · Hotels · direkt & komfortabel',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi heringsdorf berlin, taxi usedom berlin, berlin shuttle usedom, taxi zum BER flughafen, taxi kaiserbäder berlin',
        buchen_to='from=Heringsdorf&to=Berlin',
        buchen_lat_lon='',
    )

# ═══════════════════════════════════════════════════════════════════════
# C) FLUGHAFEN LONG-TAIL
# ═══════════════════════════════════════════════════════════════════════

def page_flg_hdf_bansin():
    preis_table = '''
<section><div class="card">
<h2>Festpreis Flughafen Heringsdorf → Bansin</h2>
<p style="font-size:20px;"><strong class="price">18 EUR Festpreis</strong> · ca. 15 Min</p>
<table>
<tr><th>Distanz</th><td>~6 km</td></tr>
<tr><th>Fahrtdauer</th><td>ca. 15 Min inkl. Gepäck-Handling</td></tr>
<tr><th>Preis</th><td class="price">18 EUR (bis 4 Pers., 2 Koffer)</td></tr>
<tr><th>Großraum bis 8 Pers.</th><td class="price">28 EUR</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Vom Flughafen Heringsdorf nach Bansin — in 15 Min am Hotel</h2>
<p>Der Flughafen Heringsdorf (EDAH / HDF) liegt bei Zirchow-Katschow, nur 6 km vom Bansiner Zentrum entfernt. Nach Ihrer Landung sind Sie in 15 Minuten im Hotel — falls Sie vorher reservieren, warten wir direkt am Terminal.</p>
</div>
<div class="card">
<h2>So läuft die Abholung</h2>
<ol style="margin-left:24px;">
<li>Buchen Sie bei uns online oder telefonisch mit Ihrer Flug-Nummer</li>
<li>Wir tracken den Flug und passen die Wartezeit an (Verspätung ist kostenfrei)</li>
<li>Fahrer wartet mit Namensschild am Ankunftsbereich</li>
<li>Wir bringen Sie direkt zum Hotel in Bansin (jede Adresse)</li>
</ol>
</div>
<div class="card">
<h2>Beliebte Hotels in Bansin</h2>
<ul>
<li>Kaiserstrand Beachhotel Bansin</li>
<li>Villen Bansin (mehrere)</li>
<li>Traumdomizil Usedom</li>
<li>Hotel Wald und See</li>
</ul>
</div>
'''
    faqs = [
        ('Was kostet die Rückfahrt Bansin → Flughafen?',
         'Ebenfalls 18 EUR Festpreis. Feste Abholzeit sichern (mind. 30 Min vor Check-in-Ende empfohlen).'),
        ('Wo genau treffen wir uns am Flughafen?',
         'Vor dem Terminal-Ausgang. Fahrer hat Namensschild mit Ihrem Namen.'),
        ('Was wenn Flug Verspätung hat?',
         'Kein Problem — wir tracken den Flug und warten bis Sie da sind. Keine Zusatzkosten für Wartezeit bei Verspätung.'),
    ]
    return base_template(
        slug='taxi-flughafen-heringsdorf-bansin',
        title='Taxi Flughafen Heringsdorf → Bansin · 18 EUR Festpreis | Funk Taxi',
        meta_desc='Vom Flughafen Heringsdorf direkt nach Bansin: 18 EUR Festpreis, 15 Min. Fahrer mit Namensschild am Terminal. 24/7 unter 038378 22022.',
        h1='Taxi <span class="em">Flughafen Heringsdorf → Bansin</span>',
        subline='18 EUR Festpreis · 15 Min · direkt zum Hotel · Flug-Tracking',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi flughafen heringsdorf bansin, flughafentransfer bansin, taxi HDF bansin, taxi vom flughafen heringsdorf, airport taxi bansin',
        buchen_to='from=' + 'Flughafen Heringsdorf'.replace(' ','%20') + '&to=Bansin',
        buchen_lat_lon='&toLat=53.972&toLon=14.143',
    )

# ═══════════════════════════════════════════════════════════════════════
# D) ORT-ALLGEMEIN
# ═══════════════════════════════════════════════════════════════════════

def page_usedom_koserow():
    preis_table = '''
<section><div class="card">
<h2>Taxi in Koserow — Festpreise</h2>
<table>
<tr><th>Von / Nach Koserow</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Bahnhof Koserow → Ort</td><td>1 km</td><td class="price">7 EUR</td></tr>
<tr><td>Koserow → Streckelsberg</td><td>2 km</td><td class="price">10 EUR</td></tr>
<tr><td>Koserow → Karls Erlebnisdorf</td><td>3 km</td><td class="price">12 EUR</td></tr>
<tr><td>Koserow → Zinnowitz</td><td>10 km</td><td class="price">28 EUR</td></tr>
<tr><td>Koserow → Heringsdorf</td><td>20 km</td><td class="price">45 EUR</td></tr>
<tr><td>Koserow → Ahlbeck</td><td>22 km</td><td class="price">49 EUR</td></tr>
<tr><td>Koserow → Flughafen Heringsdorf</td><td>23 km</td><td class="price">55 EUR</td></tr>
<tr><td>Koserow → Świnoujście</td><td>30 km</td><td class="price">75 EUR</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Taxi ab / nach Koserow — mitten auf der Insel</h2>
<p>Koserow liegt zwischen Zinnowitz (Nord) und Bansin (Süd), dazwischen die höchste Erhebung der Insel — der Streckelsberg. Von hier ist es zu jedem Kaiserbad oder Ausflugsziel schnell mit dem Taxi.</p>
</div>
<div class="card">
<h2>Typische Anlässe für Taxi in Koserow</h2>
<ul>
<li>Ankunft am Bahnhof Koserow → weiter zum Hotel oder Ferienwohnung</li>
<li>Ausflug nach Karls Erlebnisdorf Koserow mit Kindern + Gepäck</li>
<li>Restaurant im Ort → Rückweg mit müden Kindern</li>
<li>Zum Streckelsberg-Aussichtspunkt (2 km)</li>
<li>Ferienwohnung außerhalb → Strand oder Zentrum</li>
</ul>
</div>
'''
    faqs = [
        ('Wie schnell ist ein Taxi in Koserow?',
         'Meist 10-15 Minuten wenn Sie anrufen — kürzer wenn Fahrzeug in der Nähe.'),
        ('Fährt ihr auch nach Zinnowitz / Vineta?',
         'Ja — 10 km, ca. 28 EUR Festpreis. Auch für Vineta-Aufführungen inkl. Rückfahrt.'),
    ]
    return base_template(
        slug='taxi-usedom-koserow',
        title='Taxi Koserow · Festpreise · Bahnhof · Streckelsberg | Funk Taxi',
        meta_desc='Taxi in Koserow: Festpreise ab 7 EUR (Bahnhof). Nach Heringsdorf, Ahlbeck, Zinnowitz, Świnoujście. 24/7 unter 038378 22022.',
        h1='Taxi <span class="em">Koserow</span>',
        subline='Festpreise ab Koserow — Bahnhof, Streckelsberg, Kaiserbäder, Grenze',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi koserow, taxi usedom koserow, taxi bahnhof koserow, taxi streckelsberg, taxi karls koserow',
        buchen_to='from=Koserow',
        buchen_lat_lon='',
    )

def page_usedom_trassenheide():
    preis_table = '''
<section><div class="card">
<h2>Taxi in Trassenheide — Festpreise</h2>
<table>
<tr><th>Von / Nach Trassenheide</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Trassenheide → Zinnowitz</td><td>5 km</td><td class="price">15 EUR</td></tr>
<tr><td>Trassenheide → Karlshagen</td><td>3 km</td><td class="price">12 EUR</td></tr>
<tr><td>Trassenheide → Peenemünde</td><td>10 km</td><td class="price">28 EUR</td></tr>
<tr><td>Trassenheide → Koserow</td><td>15 km</td><td class="price">38 EUR</td></tr>
<tr><td>Trassenheide → Heringsdorf</td><td>28 km</td><td class="price">61 EUR</td></tr>
<tr><td>Trassenheide → Flughafen Heringsdorf</td><td>31 km</td><td class="price">70 EUR</td></tr>
<tr><td>Trassenheide → Świnoujście</td><td>35 km</td><td class="price">85 EUR</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Taxi ab / nach Trassenheide — Nord-Usedom nahe Peenemünde</h2>
<p>Trassenheide ist ein ruhiger Urlaubsort im nördlichen Teil der Insel Usedom mit langem Sandstrand und Schmetterlingsfarm. Anschluss zum Bahnhof Karlshagen oder Zinnowitz für Rückreise Richtung Berlin.</p>
</div>
<div class="card">
<h2>Beliebte Ziele ab Trassenheide</h2>
<ul>
<li><strong>Schmetterlingsfarm Trassenheide</strong> — vor Ort, kein Taxi nötig</li>
<li><strong>Historisch-Technisches Museum Peenemünde</strong> (10 km)</li>
<li><strong>Karls Erlebnisdorf Koserow</strong> (Familien)</li>
<li><strong>Vineta-Festspiele Zinnowitz</strong></li>
<li><strong>Baumwipfelpfad Heringsdorf</strong> (28 km, 61 EUR Hin+Zurück-Preis anfragen)</li>
</ul>
</div>
'''
    faqs = [
        ('Ist Trassenheide gut mit Taxi versorgt?',
         'Ja — wir haben mehrere Fahrzeuge auf Nord-Usedom stationiert. Wartezeit meist unter 15 Min.'),
        ('Kann ich einen Rundtrip zum Museum Peenemünde buchen?',
         'Ja — Hinfahrt, Wartezeit während des Besuchs (30 EUR/h), Rückfahrt. Alternativ 2 Einzelfahrten.'),
    ]
    return base_template(
        slug='taxi-usedom-trassenheide',
        title='Taxi Trassenheide · Festpreise · Peenemünde · Zinnowitz | Funk Taxi',
        meta_desc='Taxi in Trassenheide: Festpreise ab 12 EUR (Karlshagen). Nach Peenemünde, Zinnowitz, Heringsdorf, Świnoujście. 24/7.',
        h1='Taxi <span class="em">Trassenheide</span>',
        subline='Festpreise ab Trassenheide — Karlshagen, Peenemünde, Zinnowitz, Kaiserbäder',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi trassenheide, taxi usedom trassenheide, taxi trassenheide peenemünde, taxi trassenheide zinnowitz',
        buchen_to='from=Trassenheide',
        buchen_lat_lon='',
    )

# ═══════════════════════════════════════════════════════════════════════
# E) THEMEN-LANDINGS
# ═══════════════════════════════════════════════════════════════════════

def page_grosstaxi():
    preis_table = '''
<section><div class="card">
<h2>Großraum-Taxi (bis 8 Personen) — Festpreise auf Usedom</h2>
<p>Für Gruppen, Familienausflüge, Hotel-Transfer oder Reisegepäck: unser 8-Sitzer bringt Sie und Ihre Reisegruppe komplett zusammen ans Ziel. Kein Aufteilen auf mehrere Fahrzeuge.</p>
<table>
<tr><th>Strecke</th><th>Preis Großraum (bis 8 Pers.)</th></tr>
<tr><td>Kaiserbäder-intern (Heringsdorf/Ahlbeck/Bansin)</td><td class="price">15-20 EUR</td></tr>
<tr><td>Flughafen Heringsdorf → Kaiserbäder</td><td class="price">28-35 EUR</td></tr>
<tr><td>Bahnhof Züssow → Kaiserbäder</td><td class="price">85 EUR</td></tr>
<tr><td>Heringsdorf → Świnoujście</td><td class="price">35 EUR</td></tr>
<tr><td>Heringsdorf → Berlin</td><td class="price">380 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:13px;color:#64748b;">Aufschlag +10 EUR gegenüber Standard-PKW für die meisten Strecken. Kindersitze auf Anfrage.</p>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Wann brauchen Sie Großraum-Taxi?</h2>
<ul>
<li><strong>Familienurlaub</strong> — 5-8 Personen mit Koffern passen locker rein</li>
<li><strong>Reisegruppe</strong> — Hochzeit, Familienfeier, Firmenausflug</li>
<li><strong>Hotelgruppe</strong> — Transfer bei Ankunft/Abreise</li>
<li><strong>Sportverein</strong> — Fahrt zum Sportplatz oder Wettkampf</li>
<li><strong>Beerdigung</strong> — Fahrt zum Friedhof oder Bestattungshaus mit ganzer Familie</li>
</ul>
</div>
<div class="card">
<h2>Was ist unser Großraum-Fahrzeug?</h2>
<p>Wir setzen einen <strong>Mercedes-Benz Vito</strong> ein — 8 Sitze inkl. Fahrer, großer Kofferraum für 8 Koffer, Klimaanlage, Ledersitze. Auch für Rollstühle geeignet (bitte bei Buchung angeben).</p>
</div>
'''
    faqs = [
        ('Ist der Preis pro Person oder pro Fahrzeug?',
         'Pro Fahrzeug (bis 8 Personen). Beispiel: 35 EUR nach Świnoujście gilt für 1 bis 8 Fahrgäste.'),
        ('Muss ich vorbestellen?',
         'Empfohlen ja — Großraum-Fahrzeug ist eines. Kurzfristig oft trotzdem möglich, aber Reservierung sichert.'),
        ('Ist ein Kindersitz enthalten?',
         'Auf Anfrage kostenlos. Bitte bei der Buchung Anzahl + Alter der Kinder angeben.'),
    ]
    return base_template(
        slug='grosstaxi-usedom',
        title='Großraum-Taxi Usedom · 8-Sitzer für Gruppen | Funk Taxi Heringsdorf',
        meta_desc='Großraum-Taxi (Mercedes Vito, 8 Sitze) auf Usedom für Familien, Reisegruppen, Firmenausflüge. Festpreise ab 15 EUR. 24/7 unter 038378 22022.',
        h1='<span class="em">Großraum-Taxi</span> Insel Usedom',
        subline='8-Sitzer für Gruppen · Familie, Reisegruppe, Hotel-Transfer, Beerdigung',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='großraumtaxi usedom, großraum taxi heringsdorf, 8 sitzer taxi usedom, minivan taxi kaiserbäder, gruppentaxi usedom, familientaxi usedom',
        buchen_to='', buchen_lat_lon='',
    )

def page_sammeltaxi():
    preis_table = '''
<section><div class="card">
<h2>Sammeltaxi in Ahlbeck? — Wir erklären was möglich ist</h2>
<p>Klassisches Sammeltaxi (mehrere Fahrgäste einer Fahrt teilen sich das Fahrzeug) bieten wir nicht regulär an. Aber wir haben Alternativen die für Ihre Situation passen können:</p>
<table>
<tr><th>Situation</th><th>Unsere Lösung</th></tr>
<tr><td>Sie sind eine kleine Gruppe (2-4 Pers.)</td><td>Standard-Taxi zum Festpreis — pro Fahrzeug!</td></tr>
<tr><td>Sie sind eine große Gruppe (5-8 Pers.)</td><td>Großraum-Taxi bis 8 Pers. — nur +10 EUR Aufschlag</td></tr>
<tr><td>Sie kennen andere Fahrgäste für dieselbe Strecke</td><td>Bar zusammen buchen — Preis unter Ihnen teilen</td></tr>
<tr><td>Sie wollen zur Vineta / Konzert mit vielen anderen</td><td>Bus-Charter für Gruppen ab 15 Pers. auf Anfrage</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Warum kein klassisches Sammeltaxi?</h2>
<p>Sammeltaxi lohnt sich nur auf festen Routen mit vielen Fahrgästen — ansonsten wartet ein Fahrzeug zu lange auf den zweiten Fahrgast. Auf Usedom mit den kurzen Kaiserbäder-Distanzen ist ein Standard-Taxi zum Festpreis oft günstiger und deutlich schneller.</p>
</div>
<div class="card">
<h2>Alternative: Preis-Teilen unter Freunden</h2>
<p>Wenn Sie mit anderen (Familie, Bekannten) dieselbe Strecke fahren wollen, buchen Sie einfach zusammen ein Standard-Taxi oder Großraum — und teilen den Festpreis unter sich.</p>
<p>Beispiel: 4 Personen von Ahlbeck zum Flughafen (18 EUR Festpreis) = <strong>4,50 EUR pro Person</strong>. Kein Bus kommt da mit.</p>
</div>
'''
    faqs = [
        ('Ich hab einen Fahrgast der auch nach Świnoujście muss — können wir zusammenfahren?',
         'Ja klar — buchen Sie zusammen 1 Taxi (25 EUR Festpreis), teilen Sie die Kosten unter sich. Kein Aufschlag.'),
        ('Gibt es günstigere Alternativen zu 4 Einzeltaxis für eine Gruppe?',
         'Ja: Großraum-Taxi (bis 8 Pers.) für nur ca. 10 EUR Aufschlag = deutlich günstiger als 2-3 Standard-Taxis.'),
        ('Wo finde ich Menschen die dieselbe Strecke fahren?',
         'Fragen Sie an Rezeption Ihres Hotels — oft gibt es andere Gäste mit gleichem Ziel.'),
    ]
    return base_template(
        slug='sammeltaxi-ahlbeck',
        title='Sammeltaxi Ahlbeck? · Alternativen + Gruppen-Tarife | Funk Taxi',
        meta_desc='Sammeltaxi in Ahlbeck: klassisches Modell existiert nicht auf Usedom. Alternative: Standard-Taxi (bis 4 Pers.) oder Großraum (bis 8) zum Teilen — deutlich günstiger.',
        h1='<span class="em">Sammeltaxi</span> Ahlbeck?',
        subline='Klassisches Sammeltaxi gibt es auf Usedom nicht — hier unsere Alternativen',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='sammeltaxi ahlbeck, sammeltaxi usedom, taxi teilen ahlbeck, gruppentaxi ahlbeck, günstig taxi ahlbeck',
        buchen_to='', buchen_lat_lon='',
    )

def page_ruftaxi():
    preis_table = '''
<section><div class="card">
<h2>Ruftaxi Insel Usedom — Wie funktioniert es?</h2>
<p><strong>Ruftaxi</strong> = Sie rufen an, wir kommen. Klassisches Bestell-Taxi ohne feste Taxi-Stände.</p>
<table>
<tr><th>Nummer</th><td class="price">038378 22022</td></tr>
<tr><th>Erreichbarkeit</th><td>24 Stunden · 7 Tage die Woche</td></tr>
<tr><th>Anfahrt Kaiserbäder</th><td>meist 10-15 Min</td></tr>
<tr><th>Anfahrt Nord-Insel</th><td>15-25 Min</td></tr>
<tr><th>Preis</th><td class="price">Landestarif MV oder Festpreis</td></tr>
</table>
<a href="tel:+493837822022" class="cta phone" style="margin-top:16px;">Jetzt anrufen</a>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Ruftaxi vs Buchen — was ist der Unterschied?</h2>
<ul>
<li><strong>Ruftaxi (Anruf)</strong> — spontan, Fahrzeug kommt so schnell wie möglich, Preis nach Taxameter oder Festpreis auf Nachfrage</li>
<li><strong>Vorbestellung (online / telefonisch)</strong> — für feste Termine (Flug, Zug, Restaurant), Fahrzeug wartet zur vereinbarten Zeit</li>
</ul>
<p>Beide sind gleich zuverlässig. Wählen Sie je nach Situation.</p>
</div>
<div class="card">
<h2>Wann Sie uns rufen können</h2>
<ul>
<li><strong>Sofort</strong> — 24/7, auch nachts und an Feiertagen</li>
<li><strong>Regen / plötzlich müde</strong> — wir sind schnell da</li>
<li><strong>Restaurant / Bar</strong> — Sie bleiben, wir holen Sie ab</li>
<li><strong>Krankenhaus / Arzt</strong> — auch für Krankenfahrten mit Transportschein</li>
<li><strong>Bahnhof / Flughafen</strong> — Ankunft oder Abreise</li>
</ul>
</div>
'''
    faqs = [
        ('Wie schnell ist ein Ruftaxi normalerweise da?',
         'In den Kaiserbädern meist 10-15 Min. Auf Nord-Usedom oder abgelegenen Orten 15-25 Min.'),
        ('Kann ich statt anrufen auch schreiben?',
         'Ja — WhatsApp 0151 27585179 oder online über unser Buchungsformular.'),
        ('Fährt das Ruftaxi auch nachts?',
         'Ja — 24/7 verfügbar. Nachtaufschlag +30 Cent/km ab 22 Uhr.'),
    ]
    return base_template(
        slug='ruftaxi-usedom',
        title='Ruftaxi Insel Usedom · 038378 22022 · 24/7 | Funk Taxi Heringsdorf',
        meta_desc='Ruftaxi Usedom: anrufen, wir kommen. 24/7 unter 038378 22022. Kaiserbäder 10-15 Min Anfahrt. Nord-Usedom 15-25 Min.',
        h1='<span class="em">Ruftaxi</span> Insel Usedom',
        subline='Anrufen — wir kommen · 038378 22022 · 24 Stunden erreichbar',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='ruftaxi usedom, ruftaxi heringsdorf, taxi rufen usedom, taxi bestellen heringsdorf, 24h taxi kaiserbäder',
        buchen_to='', buchen_lat_lon='',
    )

def page_krankenfahrt():
    preis_table = '''
<section><div class="card">
<h2>Krankenfahrten auf Usedom — mit Transportschein</h2>
<p>Wenn Ihr Arzt Ihnen einen <strong>Transportschein</strong> ausgestellt hat, rechnen wir direkt mit Ihrer Krankenkasse ab (über DMRZ). Sie zahlen nur die gesetzliche Zuzahlung (10 EUR pro Fahrt, max. 2% Jahreseinkommen).</p>
<table>
<tr><th>Ziel</th><th>Für welche Kunden</th></tr>
<tr><td>Reha-Klinik Heringsdorf</td><td>Kur-/Rehabilitationspatienten</td></tr>
<tr><td>Klinikum Karlsburg</td><td>Diabetes / Kardiologie</td></tr>
<tr><td>Kreiskrankenhaus Wolgast</td><td>Notfall / OP / stationär</td></tr>
<tr><td>Universitätsmedizin Greifswald</td><td>Spezialbehandlung / Tumorzentrum</td></tr>
<tr><td>Arztpraxen auf Usedom</td><td>Ambulante Termine mit Transportschein</td></tr>
<tr><td>Dialyse-Zentren</td><td>3x pro Woche wiederkehrend — feste Abholzeit</td></tr>
</table>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Was ist ein Transportschein?</h2>
<p>Ein <strong>Transportschein</strong> ist ein ärztliches Formular, das Ihre medizinisch notwendige Beförderung genehmigt. Er wird vor der Fahrt (bei Wiederholung: quartalsweise) vom Arzt ausgestellt.</p>
<p>Mit gültigem Transportschein zahlen Sie nur die gesetzliche <strong>Zuzahlung von 10 EUR pro Fahrt</strong> (max. 2% Ihres Jahreseinkommens pro Jahr, Kinder unter 18 sind zuzahlungsfrei). Den Rest übernimmt Ihre Krankenkasse.</p>
</div>
<div class="card">
<h2>Wann bekommen Sie einen Transportschein?</h2>
<ul>
<li>Bei <strong>stationären Aufenthalten</strong> (Ein- und Auslieferung)</li>
<li>Für <strong>Dialyse, Chemo, Strahlentherapie</strong> (Dauergenehmigung)</li>
<li>Bei <strong>Pflegegrad 3+</strong> mit dauerhafter Mobilitätseinschränkung</li>
<li>Nach <strong>OP oder Verletzung</strong> temporär</li>
</ul>
<p>Fragen Sie Ihren Hausarzt oder die Klinik — sie füllen das Formular aus.</p>
</div>
<div class="card">
<h2>So funktioniert die Buchung</h2>
<ol style="margin-left:24px;">
<li>Rufen Sie uns an: 038378 22022</li>
<li>Nennen Sie Ihre Krankenkasse + Transportschein-Nummer</li>
<li>Wir buchen die Fahrt und holen Sie ab</li>
<li>Sie zahlen 10 EUR Zuzahlung an den Fahrer (Bar oder Karte)</li>
<li>Wir rechnen den Rest mit Ihrer Krankenkasse ab</li>
</ol>
</div>
'''
    faqs = [
        ('Was mache ich wenn ich keinen Transportschein habe aber trotzdem zum Arzt muss?',
         'Wir fahren Sie auch ohne Transportschein — dann als reguläre Fahrt (Preis nach Landestarif oder Festpreis). Für Regelfall Krankenkasse-Nachfragen ob nachträglich abrechenbar.'),
        ('Können Sie einen Rollstuhl transportieren?',
         'Ja — bitte bei der Buchung angeben. Wir setzen dann ein passendes Fahrzeug ein (Vito mit Rampe).'),
        ('Muss der Transportschein vor der Fahrt vorliegen?',
         'Ja — sonst können wir nicht mit der Krankenkasse abrechnen. Fragen Sie den Arzt gleich beim Termin danach.'),
        ('Fahrt zur Dialyse — kann ich einen festen Termin buchen?',
         'Ja — wir richten für Dialyse-Patienten feste Abhol- und Rückholzeiten ein (3x pro Woche). Anmelden einmalig, danach läuft es automatisch.'),
    ]
    return base_template(
        slug='krankenfahrt-usedom',
        title='Krankenfahrt Usedom · mit Transportschein · Kasse abrechnen | Funk Taxi',
        meta_desc='Krankenfahrten auf Usedom mit Transportschein — direkte Abrechnung mit Krankenkasse (DMRZ). Nur 10 EUR Zuzahlung. Klinik, Reha, Dialyse. 038378 22022.',
        h1='<span class="em">Krankenfahrt</span> Insel Usedom',
        subline='Mit Transportschein · Direktabrechnung Kasse · nur 10 EUR Zuzahlung',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='krankenfahrt usedom, krankentaxi heringsdorf, transportschein taxi usedom, dialyse fahrt kaiserbäder, taxi klinik heringsdorf, krankenkasse abrechnung taxi',
        buchen_to='', buchen_lat_lon='',
    )

# ═══════════════════════════════════════════════════════════════════════
# F) KRANKENHAUS-SPEZIFISCH (Patrick 14.08.: Wolgast, Greifswald, Anklam)
# ═══════════════════════════════════════════════════════════════════════

def page_kh_wolgast():
    preis_table = '''
<section><div class="card">
<h2>Taxi zum Kreiskrankenhaus Wolgast — Festpreise</h2>
<table>
<tr><th>Ab</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Heringsdorf</td><td>~32 km</td><td class="price">75 EUR</td></tr>
<tr><td>Ahlbeck</td><td>~35 km</td><td class="price">80 EUR</td></tr>
<tr><td>Bansin</td><td>~28 km</td><td class="price">68 EUR</td></tr>
<tr><td>Koserow</td><td>~20 km</td><td class="price">50 EUR</td></tr>
<tr><td>Zinnowitz</td><td>~15 km</td><td class="price">40 EUR</td></tr>
<tr><td>Trassenheide</td><td>~18 km</td><td class="price">45 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:14px;color:#0c4a6e;background:#e0f2fe;padding:12px;border-radius:8px;">
<strong>Mit Transportschein zahlen Sie nur 10 EUR Zuzahlung</strong> — den Rest übernimmt Ihre Krankenkasse (DMRZ-Abrechnung).
</p>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Kreiskrankenhaus Wolgast (KKH) — die Klinik für die Insel Usedom</h2>
<p>Das <strong>Kreiskrankenhaus Wolgast gGmbH</strong> in der Chausseestraße 46 ist die Regelversorgungsklinik für Usedom und Umgebung. Fachabteilungen: Chirurgie, Innere Medizin, Anästhesie/Intensivmedizin, Geburtshilfe/Gynäkologie, Radiologie, Notaufnahme.</p>
<p>Von Heringsdorf sind es 32 km über die Zecheriner Brücke — ca. 35 Min Fahrzeit. Bus/Bahn dauert 1,5-2 Stunden mit Umstieg.</p>
</div>
<div class="card">
<h2>Wann brauchen Sie ein Taxi zum KKH Wolgast?</h2>
<ul>
<li><strong>Ambulante Termine</strong> — Facharzt-Sprechstunde, Vor-OP-Untersuchung</li>
<li><strong>Stationäre Einlieferung</strong> — geplante OP, Behandlung</li>
<li><strong>Entlassung</strong> — zurück nach Hause auf Usedom</li>
<li><strong>Besuch</strong> — Angehörige besuchen Patient</li>
<li><strong>Notfall</strong> — falls Rettungswagen nicht nötig aber schnell hin</li>
<li><strong>Nach Kaiserschnitt</strong> — junge Mutter mit Baby zurück auf die Insel</li>
</ul>
</div>
<div class="card">
<h2>Krankenfahrt mit Transportschein</h2>
<p>Wenn Ihr Arzt einen Transportschein für die Fahrt ausgestellt hat: rechnen wir direkt mit Ihrer Krankenkasse ab. <strong>Sie zahlen nur die gesetzliche Zuzahlung von 10 EUR pro Fahrt.</strong> Details auf <a href="krankenfahrt-usedom.html" style="color:#0369a1;">krankenfahrt-usedom.html</a>.</p>
</div>
'''
    faqs = [
        ('Wie lange dauert die Fahrt Heringsdorf → KKH Wolgast?',
         'Ca. 35 Minuten je nach Verkehr. Über die B111 und Zecheriner Brücke.'),
        ('Warten Sie vor dem Krankenhaus wenn ich einen kurzen Termin habe?',
         'Ja — Wartezeit 30 EUR/h. Alternativ 2 Einzelfahrten wenn länger als 1h.'),
        ('Auch nachts bei Notfall?',
         'Ja — 24/7 verfügbar. Bei akuter Notlage bitte trotzdem 112 rufen — wir sind Taxi, kein Rettungsdienst.'),
        ('Zahlt die Kasse die Fahrt komplett?',
         'Nur mit Transportschein — dann bis auf 10 EUR Zuzahlung ja. Ohne Schein zahlen Sie selbst nach Festpreis (75 EUR ab Heringsdorf).'),
    ]
    return base_template(
        slug='taxi-krankenhaus-wolgast',
        title='Taxi zum Kreiskrankenhaus Wolgast · mit Transportschein | Funk Taxi',
        meta_desc='Taxi zum KKH Wolgast ab allen Kaiserbädern & Nord-Usedom. 75 EUR ab Heringsdorf. Mit Transportschein nur 10 EUR Zuzahlung. 24/7 unter 038378 22022.',
        h1='Taxi zum <span class="em">Kreiskrankenhaus Wolgast</span>',
        subline='Von der Insel Usedom · mit Transportschein Kasse zahlt · Festpreise ab 40 EUR',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi wolgast krankenhaus, kreiskrankenhaus wolgast taxi, krankenfahrt wolgast, taxi zum KKH wolgast, transportschein wolgast, chirurgie wolgast fahrt',
        buchen_to='to=' + 'Kreiskrankenhaus Wolgast, Chausseestraße 46'.replace(' ','%20'),
        buchen_lat_lon='&toLat=54.052&toLon=13.766',
    )

def page_kh_greifswald():
    preis_table = '''
<section><div class="card">
<h2>Taxi zur Universitätsmedizin Greifswald — Festpreise</h2>
<table>
<tr><th>Ab</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Heringsdorf</td><td>~50 km</td><td class="price">115 EUR</td></tr>
<tr><td>Ahlbeck</td><td>~55 km</td><td class="price">125 EUR</td></tr>
<tr><td>Bansin</td><td>~48 km</td><td class="price">110 EUR</td></tr>
<tr><td>Koserow</td><td>~35 km</td><td class="price">80 EUR</td></tr>
<tr><td>Zinnowitz</td><td>~30 km</td><td class="price">70 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:14px;color:#0c4a6e;background:#e0f2fe;padding:12px;border-radius:8px;">
<strong>Mit Transportschein zahlen Sie nur 10 EUR Zuzahlung.</strong> Direktabrechnung mit Krankenkasse via DMRZ.
</p>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>Universitätsmedizin Greifswald — Maximalversorger für die Region</h2>
<p>Die <strong>Universitätsmedizin Greifswald</strong> (Fleischmannstraße 8) ist die einzige Uniklinik in Vorpommern. Über 20 Fachkliniken inkl. Tumorzentrum, Herzchirurgie, Neurologie, Kinderklinik, Transplantationszentrum. Von der Insel Usedom die wichtigste Adresse für Spezial- und Schwerpunktbehandlungen.</p>
<p>Von Heringsdorf sind es 50 km über Wolgast → Greifswald. Fahrzeit ca. 55 Minuten mit Auto/Taxi. Bus/Bahn: 1:45 - 2:15 h mit Umstiegen.</p>
</div>
<div class="card">
<h2>Häufige Anlässe für Fahrt zur Uni Greifswald</h2>
<ul>
<li><strong>Tumorzentrum</strong> — Chemotherapie, Strahlentherapie (oft mehrfach pro Woche)</li>
<li><strong>Herzkatheter / Herzchirurgie</strong> — Vor-/Nachsorge, OP</li>
<li><strong>Neurologische Spezial-Diagnostik</strong> — MRT, EEG</li>
<li><strong>Kinderklinik</strong> — Frühgeborene, Spezialbehandlungen</li>
<li><strong>Transplantation</strong> — Vor- und Nachsorge</li>
<li><strong>Second-Opinion</strong> — Zweitmeinung aus Uniklinik</li>
</ul>
</div>
<div class="card">
<h2>Regelmäßige Fahrten (Chemo, Dialyse)</h2>
<p>Bei wiederkehrenden Terminen (z.B. Chemotherapie alle 2-3 Wochen) richten wir feste Abhol-/Rückholzeiten ein. Sie werden von einem festen Fahrer betreut — Sie kennen sich, Sie fühlen sich sicher. Rufen Sie uns einmal an — der Rest läuft automatisch.</p>
</div>
'''
    faqs = [
        ('Fahren Sie regelmäßig zur Chemo nach Greifswald?',
         'Ja — wir haben viele Patienten die 1-3x pro Woche zur Uni müssen. Feste Zeiten, oft derselbe Fahrer, Transportschein-Abrechnung mit Kasse.'),
        ('Wie viel früher soll ich losfahren wenn ich um 9 Uhr Termin habe?',
         'Ab Heringsdorf mindestens 8 Uhr los — 55 Min Fahrt + Puffer für Parkplatz-Suche. Wir empfehlen 7:45 Uhr Abholung.'),
        ('Kann ein Angehöriger mitfahren?',
         'Ja — bis zu 3 weitere Personen im Standard-PKW ohne Aufschlag.'),
        ('Wenn ich unter Chemo müde bin — warten Sie oder holen Sie mich später?',
         'Beides möglich. Wartezeit 30 EUR/h. Oder wir schreiben Ihnen eine feste Abholzeit auf — dann sind wir wieder pünktlich da.'),
    ]
    return base_template(
        slug='taxi-krankenhaus-greifswald',
        title='Taxi zur Universitätsmedizin Greifswald · Uniklinik | Funk Taxi Usedom',
        meta_desc='Taxi zur Uni Greifswald ab Usedom: 115 EUR ab Heringsdorf. Für Chemo, Herz-OP, Neurologie, Tumorzentrum. Mit Transportschein 10 EUR Zuzahlung. 038378 22022.',
        h1='Taxi zur <span class="em">Universitätsmedizin Greifswald</span>',
        subline='Uniklinik-Fahrten · Chemo · Herzchirurgie · Tumorzentrum · mit Transportschein',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi greifswald krankenhaus, uni greifswald taxi, universitätsmedizin greifswald usedom, chemo greifswald taxi, transportschein greifswald, herzkatheter greifswald fahrt',
        buchen_to='to=' + 'Universitätsmedizin Greifswald, Fleischmannstraße 8'.replace(' ','%20'),
        buchen_lat_lon='&toLat=54.093&toLon=13.402',
    )

def page_kh_anklam():
    preis_table = '''
<section><div class="card">
<h2>Taxi zum Krankenhaus Anklam — Festpreise</h2>
<table>
<tr><th>Ab</th><th>Distanz</th><th>Preis</th></tr>
<tr><td>Heringsdorf</td><td>~55 km</td><td class="price">125 EUR</td></tr>
<tr><td>Ahlbeck</td><td>~60 km</td><td class="price">135 EUR</td></tr>
<tr><td>Bansin</td><td>~52 km</td><td class="price">120 EUR</td></tr>
<tr><td>Koserow</td><td>~40 km</td><td class="price">90 EUR</td></tr>
<tr><td>Zinnowitz</td><td>~35 km</td><td class="price">80 EUR</td></tr>
</table>
<p style="margin-top:12px;font-size:14px;color:#0c4a6e;background:#e0f2fe;padding:12px;border-radius:8px;">
<strong>Mit Transportschein nur 10 EUR Zuzahlung.</strong> Direktabrechnung mit Ihrer Krankenkasse.
</p>
</div></section>
'''
    content = '''
<section>
<div class="card">
<h2>AMEOS Klinikum Anklam — Grund- und Regelversorgung</h2>
<p>Das <strong>AMEOS Klinikum Anklam</strong> (Alt-Karlspromenade 4) ist ein Krankenhaus der Grund- und Regelversorgung im südlichen Vorpommern. Fachabteilungen: Innere Medizin (v.a. Kardiologie), Chirurgie, Anästhesie/Intensivmedizin, Gynäkologie/Geburtshilfe, Radiologie, Notaufnahme.</p>
<p>Von Heringsdorf sind es 55 km über Wolgast → Anklam. Fahrzeit ca. 55 Minuten mit Taxi. Bus/Bahn braucht 2-2:30 Stunden.</p>
</div>
<div class="card">
<h2>Wann Fahrt zum Anklamer Krankenhaus?</h2>
<ul>
<li><strong>Kardiologische Behandlung</strong> — Anklam hat spezialisierte Herzabteilung</li>
<li><strong>Geplante OP</strong> — Ein-/Auslieferung stationär</li>
<li><strong>Geburt</strong> — Geburtshilfe-Abteilung</li>
<li><strong>Notfall</strong> — schnelle Fahrt wenn kein RTW nötig</li>
<li><strong>Angehörigenbesuch</strong> — Verwandte in Behandlung</li>
</ul>
</div>
'''
    faqs = [
        ('Warum Anklam statt Wolgast oder Greifswald?',
         'Anklam hat spezialisierte Kardiologie. Bei Herzproblemen weisen manche Ärzte gezielt dorthin. Oder Sie haben persönliche Präferenz (Ärzte, Zimmer-Auslastung).'),
        ('Wie lange dauert die Fahrt Heringsdorf → Anklam?',
         'Ca. 55 Minuten über Wolgast. Bei viel Verkehr im Sommer bis zu 1:15h.'),
        ('Auch für Geburt möglich (Wehen)?',
         'Ja — dann bitte SOFORT 112 rufen wenn Wehen kurz. Für frühzeitige Fahrten mit Zeit-Puffer sind wir OK.'),
    ]
    return base_template(
        slug='taxi-krankenhaus-anklam',
        title='Taxi zum Krankenhaus Anklam (AMEOS) · Festpreise ab Usedom | Funk Taxi',
        meta_desc='Taxi zum AMEOS Klinikum Anklam ab Kaiserbädern: 125 EUR ab Heringsdorf. Kardiologie, Chirurgie, Geburtshilfe. Mit Transportschein 10 EUR Zuzahlung.',
        h1='Taxi zum <span class="em">Krankenhaus Anklam</span>',
        subline='AMEOS Klinikum · Kardiologie · Geburtshilfe · Chirurgie · mit Transportschein',
        hero_extra='', preis_table=preis_table, content_blocks=content, faq_items=faqs,
        keywords='taxi anklam krankenhaus, ameos klinikum anklam, taxi zum krankenhaus anklam, krankenfahrt anklam, kardiologie anklam',
        buchen_to='to=' + 'AMEOS Klinikum Anklam, Alt-Karlspromenade 4'.replace(' ','%20'),
        buchen_lat_lon='&toLat=53.856&toLon=13.694',
    )

def main():
    pages = [
        ('taxi-bansin-swinemuende.html',         page_bansin_swi()),
        ('taxi-koserow-swinemuende.html',        page_koserow_swi()),
        ('taxi-heringsdorf-misdroy.html',        page_hdf_misdroy()),
        ('taxi-heringsdorf-berlin.html',         page_hdf_berlin()),
        ('taxi-flughafen-heringsdorf-bansin.html', page_flg_hdf_bansin()),
        ('taxi-usedom-koserow.html',             page_usedom_koserow()),
        ('taxi-usedom-trassenheide.html',        page_usedom_trassenheide()),
        ('grosstaxi-usedom.html',                page_grosstaxi()),
        ('sammeltaxi-ahlbeck.html',              page_sammeltaxi()),
        ('ruftaxi-usedom.html',                  page_ruftaxi()),
        ('krankenfahrt-usedom.html',             page_krankenfahrt()),
        # Patrick 14.08. Ergänzung: 3 Krankenhaus-Landings
        ('taxi-krankenhaus-wolgast.html',        page_kh_wolgast()),
        ('taxi-krankenhaus-greifswald.html',     page_kh_greifswald()),
        ('taxi-krankenhaus-anklam.html',         page_kh_anklam()),
    ]
    for fn, html in pages:
        (REPO / fn).write_text(html, encoding='utf-8')
        print(f'✅ {fn} ({len(html)} bytes)')

    # Sitemap
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
    print(f'✅ sitemap.xml aktualisiert (+{len(pages)} URLs)')

if __name__ == '__main__':
    main()
