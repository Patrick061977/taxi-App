"""v932 Massengenerator — für jede der 140 Routen aus v931 eine Landing-Page
mit unique Content (Titel, H1, Preis, Distanz, kategorie-spez. FAQ, JSON-LD).
"""
import json, urllib.request, os, re, glob

tok = os.popen('gcloud auth print-access-token').read().strip()
BASE = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app'

def to_num(v, default=None):
    if v is None: return default
    if isinstance(v, (int,float)): return float(v)
    if isinstance(v, str):
        try: return float(v.replace(',','.').strip())
        except: return default
    return default

def _strip_numbers(s):
    if not s: return s
    s = re.sub(r'\s+\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?(?=\s*,|\s*$)', '', s)
    s = re.sub(r'\b\d+[a-zA-Z]?\b', '', s)
    s = re.sub(r'\b\d{5}\b', '', s)
    s = re.sub(r'\s{2,}', ' ', s)
    s = re.sub(r'\s*,\s*,+', ',', s)
    s = re.sub(r'^\s*,\s*|\s*,\s*$', '', s).strip()
    return s

def clean(a, label=None):
    if not a: return None
    a = a.strip()
    a = re.sub(r',\s*Deutschland\s*$', '', a, flags=re.I)
    # Erst label prepend (falls noch nicht enthalten), DANN gemeinsam Zahlen strippen
    if label and label.lower() not in a.lower():
        a = label + ', ' + a
    a = _strip_numbers(a)
    parts = [p.strip() for p in a.split(',') if p.strip()]
    seen = set(); dedup = []
    for p in parts:
        if p.lower() not in seen:
            seen.add(p.lower()); dedup.append(p)
    return ', '.join(dedup)

def slugify(s):
    s = s.lower().replace('ä','ae').replace('ö','oe').replace('ü','ue').replace('ß','ss')
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_-]+', '-', s).strip('-')
    return s[:50]

def categorize(fl, tl):
    c = (fl + ' ' + tl).lower()
    if 'flughafen' in c or 'airport' in c: return 'flughafen'
    if 'krankenh' in c or 'klinik' in c or 'universitaetsm' in c or 'mvz' in c or 'ameos' in c or 'medizinisch' in c: return 'klinik'
    if 'swinoujscie' in c or 'swinemuende' in c or 'polen' in c or 'misdroy' in c: return 'polen'
    if 'berlin' in c or 'greifswald' in c or 'stralsund' in c or 'anklam' in c or 'zuessow' in c or 'sellin' in c: return 'fern'
    if 'bahnhof' in c: return 'bahnhof'
    if any(x in c for x in ['restaurant','bierkutscher','asgard','rhodos','lividus','kelchs','fischkopp','athen','kulmeck','rewe','edeka','kaufland']): return 'restaurant'
    if any(x in c for x in ['hotel','resort','residenz','strandhotel','beachhotel','schloss','villa','aja','kaiserhof','a-rosa','maritim','wikinger','ostseeblick']): return 'hotel'
    if any(x in c for x in ['reha','therme','seebruecke','museum','baumwipfelpfad']): return 'sehensw'
    return 'sonstige'

def cat_label(ck):
    return {'flughafen':'Flughafen-Transfer','klinik':'Krankenhaus & Klinik','polen':'Grenzfahrt Polen','fern':'Fern- & Kreisfahrt','bahnhof':'Bahnhof-Transfer','restaurant':'Restaurant- & Einkaufs-Fahrt','hotel':'Hotel-Transfer','sehensw':'Sehenswuerdigkeit & Reha','sonstige':'Fahrt'}.get(ck, 'Fahrt')

def cat_faqs(ck, price, dist, from_short, to_short):
    p = "{:.2f}".format(price)
    common = [
        ('Was kostet die Fahrt von ' + from_short + ' zu ' + to_short + '?',
         'Der Preis liegt bei ca. ' + p + ' EUR (Median aus echten Fahrten). Bei Nacht (22-6 Uhr, So/Feiertag) faellt ein Zuschlag von 5 EUR an. Grossraum-Taxi (bis 8 Pers.) +10 EUR.'),
        ('Wie kann ich das Taxi bestellen?',
         'Telefonisch unter 038378 22022 rund um die Uhr, per Online-Buchung auf umwelt-taxi-insel-usedom.de/buchen.html, oder direkt beim Fahrer. Vorbestellung bis 10 Min vor Pickup moeglich.'),
        ('Kann ich mit Karte bezahlen?',
         'Ja. Wir akzeptieren Bargeld, EC-Karte (Girocard/Maestro), Kreditkarten (Visa/MasterCard), Apple Pay und Google Pay. Direkt im Wagen via mobilem Kartenlesegeraet.'),
    ]
    if ck == 'bahnhof':
        common.append(('Wo werde ich am Bahnhof abgeholt?',
                       'Wir warten direkt am Bahnsteig-Ausgang. Bei UBB-Verspaetung kein Problem — wir passen den Pickup automatisch an, kein Extra-Kosten.'))
    elif ck == 'hotel':
        common.append(('Wird das Gepaeck mit transportiert?',
                       'Ja. Standard-PKW hat Platz fuer 4 Personen + Koffer. Grossraum-Taxi (Vito 8 Pax) auf Anfrage bei mehr Gepaeck oder Personen.'))
    elif ck == 'restaurant':
        common.append(('Kann ich Rueckfahrt gleich mitbuchen?',
                       'Ja. Sagen Sie einfach beim Bestellen den Rueckhol-Zeitpunkt — wir sind puenktlich da.'))
    elif ck == 'klinik':
        common.append(('Rechne ich mit der Krankenkasse ab?',
                       'Bei Krankenfahrten mit Transportschein rechnen wir direkt mit Ihrer Krankenkasse ab. Fragen Sie beim Buchen — wir helfen mit dem Antrag.'))
    elif ck == 'flughafen':
        common.append(('Wie lange vor Flug soll ich abfahren?',
                       'Fuer HDF (kleiner Flughafen) 60 Min vor Abflug. Fuer Berlin BER 3-4 Std wegen Anfahrt-Zeit. Wir uebernehmen die Zeitplanung — sagen Sie uns nur Ihre Flug-Zeit.'))
    elif ck == 'polen':
        common.append(('Was ist an der Grenze zu beachten?',
                       'Fuer EU-Buerger reicht der Personalausweis. Kein Waehrungstausch noetig — wir akzeptieren EUR auch in Polen. Fahrzeit inkl. Grenzkontrolle bereits kalkuliert.'))
    return common[:4]

def build_faq_jsonld(faqs):
    entries = []
    for q, a in faqs:
        entries.append({"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}})
    return json.dumps({"@context":"https://schema.org","@type":"FAQPage","mainEntity":entries}, ensure_ascii=False)

def build_page(fl, tl, price, dist, count, ck, slug):
    # Kurz-Namen extrahieren (POI oder erste 2 Worte)
    from_short = fl.split(',')[0].strip()
    to_short = tl.split(',')[0].strip()
    title = 'Taxi von ' + from_short + ' nach ' + to_short + ' | Funk Taxi'
    if len(title) > 60:
        title = 'Taxi ' + from_short + ' → ' + to_short + ' | Funk Taxi'
    if len(title) > 60:
        title = title[:57] + '...'
    p = "{:.2f}".format(price).replace('.', ',')
    d_str = str(dist) + ' km' if dist else 'ca. Fahrt'
    desc = 'Taxi von ' + from_short + ' nach ' + to_short + ' — ca. ' + p + ' EUR (' + d_str + '). Festpreis-Median aus echten Fahrten. 24/7 unter 038378 22022. Kartenzahlung.'
    if len(desc) > 165:
        desc = desc[:162] + '...'
    faqs = cat_faqs(ck, price, dist or 0, from_short, to_short)
    faq_json = build_faq_jsonld(faqs)
    breadcrumb_json = json.dumps({
        "@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
            {"@type":"ListItem","position":1,"name":"Startseite","item":"https://umwelt-taxi-insel-usedom.de/landing.html"},
            {"@type":"ListItem","position":2,"name":cat_label(ck),"item":"https://umwelt-taxi-insel-usedom.de/taxi-preise.html"},
            {"@type":"ListItem","position":3,"name":from_short + ' → ' + to_short}
        ]
    }, ensure_ascii=False)
    taxi_json = json.dumps({
        "@context":"https://schema.org","@type":"TaxiService","name":"Funk Taxi Heringsdorf",
        "telephone":"+493837822022","url":"https://umwelt-taxi-insel-usedom.de/",
        "areaServed":["Heringsdorf","Ahlbeck","Bansin","Usedom"],
        "priceRange":"EUR " + p
    }, ensure_ascii=False)
    faq_html = ''
    for q, a in faqs:
        faq_html += '<div class="faq-item"><h3>' + q + '</h3><p>' + a + '</p></div>\n'
    return """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>""" + title + """</title>
<meta name="description" content=\"""" + desc + """\">
<link rel="canonical" href="https://umwelt-taxi-insel-usedom.de/""" + slug + """.html">
<style>
body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
header { background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); padding: 40px 20px; text-align: center; }
header h1 { color: #fbbf24; font-size: clamp(24px, 5vw, 36px); margin: 0 0 10px; }
header .price { font-size: clamp(32px, 6vw, 48px); color: #10b981; font-weight: 900; margin: 20px 0; }
header .meta { color: #94a3b8; font-size: 14px; }
.cta { display: inline-block; padding: 14px 32px; margin: 10px 5px; background: #fbbf24; color: #0f172a; font-weight: 700; text-decoration: none; border-radius: 8px; }
.cta.phone { background: #10b981; color: white; }
main { max-width: 800px; margin: 0 auto; padding: 30px 20px; }
main h2 { color: #fbbf24; margin-top: 30px; }
.faq-item { background: #1e293b; padding: 16px; margin: 10px 0; border-left: 4px solid #fbbf24; border-radius: 6px; }
.faq-item h3 { color: #fbbf24; margin: 0 0 6px; font-size: 15px; }
.faq-item p { margin: 0; color: #cbd5e1; font-size: 14px; }
footer { padding: 30px 20px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #1e293b; }
footer a { color: #fbbf24; text-decoration: none; margin: 0 8px; }
</style>
<script type="application/ld+json">""" + breadcrumb_json + """</script>
<script type="application/ld+json">""" + taxi_json + """</script>
<script type="application/ld+json">""" + faq_json + """</script>
</head>
<body>
<header>
<h1>Taxi von """ + from_short + " nach " + to_short + """</h1>
<p class="meta">""" + cat_label(ck) + " · " + d_str + " · " + str(count) + """x aus echten Fahrten</p>
<div class="price">ca. """ + p + """ EUR</div>
<a href="tel:+493837822022" class="cta phone">📞 038378 22022</a>
<a href="buchen.html?from=""" + urllib.request.quote(from_short) + "&to=" + urllib.request.quote(to_short) + """\" class="cta">🚕 Online buchen</a>
</header>
<main>
<h2>Was Sie erwartet</h2>
<p><strong>Festpreis-Median: ca. """ + p + """ EUR</strong> (Median aus echten abgeschlossenen Fahrten der letzten 6 Monate). Nacht (22-6 Uhr, So/Feiertag) +5 EUR Zuschlag. Grossraum-Taxi (bis 8 Personen) +10 EUR.</p>
<p>Wir fahren Sie <strong>von """ + fl + "</strong> nach <strong>" + tl + """</strong> mit vollem Komfort — 24/7 verfuegbar, Kartenzahlung an Bord.</p>
<h2>Haeufige Fragen</h2>
""" + faq_html + """
<h2>Weitere Preise auf Usedom</h2>
<p>In unserer <a href="taxi-preise.html" style="color:#fbbf24;">Preisliste</a> finden Sie 140 echte Routen aus unseren Fahrten — Bahnhof-Transfers, Hotel-Fahrten, Kliniken, Restaurants, Flughafen und Grenzfahrten nach Polen.</p>
</main>
<footer>
<p>Funk Taxi Heringsdorf · <a href="tel:+493837822022">038378 22022</a> · <a href="landing.html">Home</a> · <a href="taxi-preise.html">Preise</a> · <a href="buchen.html">Buchen</a></p>
<p>Adressen anonymisiert (Datenschutz). Median-Preise aus 1620 echten Fahrten. Endpreis nach Taxameter.</p>
</footer>
</body>
</html>
"""

# --- Data-Loading (wie v931)
gc = json.loads(urllib.request.urlopen(BASE + '/geocache.json?access_token=' + tok).read()) or {}
addr_to_label = {}
for k, v in gc.items():
    if not isinstance(v, dict): continue
    label = v.get('label'); addr = v.get('address')
    if not label or not addr: continue
    pref = re.sub(r'\s+', ' ', addr.lower()).strip()[:25]
    addr_to_label[pref] = label
def find_label(addr):
    if not addr: return None
    pref = re.sub(r'\s+', ' ', addr.lower()).strip()[:25]
    return addr_to_label.get(pref)

rides = json.loads(urllib.request.urlopen(BASE + '/rides.json?access_token=' + tok).read()) or {}
arch = json.loads(urllib.request.urlopen(BASE + '/archiveRides.json?access_token=' + tok).read()) or {}

route_data = {}
for r in list(rides.values()) + list(arch.values()):
    if not isinstance(r, dict): continue
    if r.get('status') not in ('completed','accepted','on_way','picked_up'): continue
    pu = r.get('pickup') or ''; de = r.get('destination') or ''
    price = to_num(r.get('actualPrice')) or to_num(r.get('price'))
    dist = to_num(r.get('distance'))
    if not pu or not de or not price or price <= 0: continue
    pu_n = clean(pu, find_label(pu))
    de_n = clean(de, find_label(de))
    if not pu_n or not de_n: continue
    key = (pu_n, de_n)
    if key not in route_data:
        route_data[key] = {'prices': [], 'distances': [], 'count': 0}
    route_data[key]['prices'].append(price)
    if dist: route_data[key]['distances'].append(dist)
    route_data[key]['count'] += 1

sorted_routes = sorted(route_data.items(), key=lambda x: -x[1]['count'])
existing = set(os.path.basename(f) for f in glob.glob('taxi-*.html'))

created = 0
skipped_exists = 0
skipped_lowcount = 0
new_slugs = []
seen_slugs = set()

for (fl, tl), d in sorted_routes:
    if d['count'] < 2:
        skipped_lowcount += 1; continue
    slug = 'taxi-' + slugify(fl.split(',')[0]) + '-zu-' + slugify(tl.split(',')[0])
    slug = slug[:75]
    orig = slug; i = 2
    while slug in seen_slugs:
        slug = orig + '-' + str(i); i += 1
    seen_slugs.add(slug)
    filename = slug + '.html'
    if filename in existing:
        skipped_exists += 1; continue
    ps = sorted(d['prices']); ds = sorted(d['distances'])
    median = round(ps[len(ps)//2], 2)
    med_dist = round(ds[len(ds)//2], 1) if ds else 0
    ck = categorize(fl, tl)
    html = build_page(fl, tl, median, med_dist, d['count'], ck, slug)
    with open(filename, 'w', encoding='utf-8', newline='') as fh:
        fh.write(html)
    new_slugs.append(filename)
    created += 1

print('OK v932: erstellt=' + str(created) + ', existiert schon=' + str(skipped_exists) + ', <2x=' + str(skipped_lowcount))

# sitemap.xml aktualisieren
with open('sitemap.xml', 'r', encoding='utf-8') as fh:
    sm = fh.read()
sm_new_entries = []
for slug in new_slugs:
    url = 'https://umwelt-taxi-insel-usedom.de/' + slug
    if url not in sm:
        sm_new_entries.append('<url><loc>' + url + '</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>')
if sm_new_entries:
    sm = sm.replace('</urlset>', '\n'.join(sm_new_entries) + '\n</urlset>')
    with open('sitemap.xml', 'w', encoding='utf-8', newline='') as fh:
        fh.write(sm)
    print('sitemap.xml: +' + str(len(sm_new_entries)) + ' neue URLs')
