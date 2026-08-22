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

def clean(a, label=None):
    if not a: return None
    a = a.strip()
    a = re.sub(r',\s*Deutschland\s*$', '', a, flags=re.I)
    a = re.sub(r'\s+\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?(?=\s*,|\s*$)', '', a)
    a = re.sub(r'\b\d+[a-zA-Z]?\b', '', a)
    a = re.sub(r'\b\d{5}\b', '', a)
    a = re.sub(r'\s{2,}', ' ', a)
    a = re.sub(r'\s*,\s*,+', ',', a)
    a = re.sub(r'^\s*,\s*|\s*,\s*$', '', a).strip()
    parts = [p.strip() for p in a.split(',') if p.strip()]
    seen = set(); dedup = []
    for p in parts:
        if p.lower() not in seen:
            seen.add(p.lower()); dedup.append(p)
    a = ', '.join(dedup)
    if label and label.lower() not in a.lower():
        a = label + ', ' + a
    return a

def categorize(fl, tl):
    c = (fl + ' ' + tl).lower()
    if 'flughafen' in c or 'airport' in c: return ('flughafen', 'Flughafen-Transfers')
    if 'krankenh' in c or 'klinik' in c or 'universitaetsm' in c or 'mvz' in c or 'ameos' in c or 'medizinisch' in c: return ('klinik', 'Krankenhaus und Klinik')
    if 'swinoujscie' in c or 'swinemuende' in c or 'polen' in c or 'misdroy' in c: return ('polen', 'Grenzfahrten Polen')
    if 'berlin' in c or 'greifswald' in c or 'stralsund' in c or 'anklam' in c or 'zuessow' in c or 'sellin' in c: return ('fern', 'Fern- und Kreisfahrten')
    if 'bahnhof' in c: return ('bahnhof', 'Bahnhof-Transfers')
    if any(x in c for x in ['restaurant','bierkutscher','asgard','rhodos','lividus','kelchs','fischkopp','athen','kulmeck','rewe','edeka','kaufland']): return ('restaurant', 'Restaurant- und Einkaufs-Fahrten')
    if any(x in c for x in ['hotel','resort','residenz','strandhotel','beachhotel','schloss','villa','aja','kaiserhof','a-rosa','maritim','wikinger','ostseeblick']): return ('hotel', 'Hotel-Transfers')
    if any(x in c for x in ['reha','therme','seebruecke','museum','baumwipfelpfad']): return ('sehensw', 'Sehenswuerdigkeiten und Reha')
    return ('sonstige', 'Weitere Routen')

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

def find_landing(fl, tl):
    for kw in re.split(r'[-,\s]+', tl.lower()):
        if len(kw) < 5: continue
        for f in existing:
            if kw in f.replace('.html','').lower():
                return f
    return None

cats_order = ['bahnhof','hotel','restaurant','klinik','flughafen','polen','fern','sehensw','sonstige']
cats = {}
for (fl, tl), d in sorted_routes:
    if d['count'] < 2: continue
    ck, cl = categorize(fl, tl)
    ps = sorted(d['prices']); ds = sorted(d['distances'])
    row = {
        'from': fl, 'to': tl, 'count': d['count'],
        'medianPrice': round(ps[len(ps)//2], 2),
        'medianDist': round(ds[len(ds)//2], 1) if ds else None,
        'landing': find_landing(fl, tl)
    }
    if ck not in cats: cats[ck] = {'label': cl, 'rows': []}
    cats[ck]['rows'].append(row)

total = sum(len(c['rows']) for c in cats.values())

html_parts = []
html_parts.append('<!-- v6.63.931-ROUTES-START -->')
html_parts.append('<!-- ' + str(total) + ' Routen aus 1620 echten Fahrten, min. 2x gefahren, POI-Namen anonymisiert -->')
html_parts.append('<div style="margin:20px 0;padding:12px;background:#fff8e6;border-left:4px solid #f5a623;font-size:13px;color:#5d3a00;">')
html_parts.append('<strong>' + str(total) + ' echte Routen</strong> aus unseren tatsaechlichen Fahrten der letzten 6 Monate — sortiert nach Haeufigkeit. Preise sind Medianwerte, Adressen sind zum Datenschutz auf POI/Strasse reduziert.')
html_parts.append('</div>')

emoji = {'bahnhof':'BHF','hotel':'HOTEL','restaurant':'FOOD','klinik':'KLINIK','flughafen':'HDF','polen':'POLEN','fern':'FERN','sehensw':'POI','sonstige':'MISC'}

for ck in cats_order:
    if ck not in cats: continue
    c = cats[ck]
    html_parts.append('<h2 style="margin-top:30px;">' + c['label'] + ' <span style="font-weight:400;font-size:14px;color:#666;">(' + str(len(c['rows'])) + ' Routen)</span></h2>')
    html_parts.append('<table style="width:100%;border-collapse:collapse;margin:10px 0;">')
    html_parts.append('<tr style="background:#f3f4f6;"><th style="text-align:left;padding:8px;border-bottom:2px solid #ddd;">Von</th><th style="text-align:left;padding:8px;border-bottom:2px solid #ddd;">Nach</th><th style="text-align:right;padding:8px;border-bottom:2px solid #ddd;">Distanz</th><th style="text-align:right;padding:8px;border-bottom:2px solid #ddd;">Preis (Median)</th><th style="text-align:center;padding:8px;border-bottom:2px solid #ddd;">Info</th></tr>')
    for r in c['rows']:
        dist_s = str(r['medianDist']) + ' km' if r['medianDist'] else '—'
        link = '<a href="' + r['landing'] + '" style="color:#0b57d0;text-decoration:none;">Details</a>' if r['landing'] else ''
        html_parts.append('<tr><td style="padding:6px;border-bottom:1px solid #eee;">' + r['from'] + '</td><td style="padding:6px;border-bottom:1px solid #eee;">' + r['to'] + '</td><td style="padding:6px;text-align:right;border-bottom:1px solid #eee;">' + dist_s + '</td><td style="padding:6px;text-align:right;border-bottom:1px solid #eee;font-weight:600;color:#059669;">' + '{:.2f}'.format(r['medianPrice']) + ' EUR</td><td style="padding:6px;text-align:center;border-bottom:1px solid #eee;">' + link + '</td></tr>')
    html_parts.append('</table>')
html_parts.append('<!-- v6.63.931-ROUTES-END -->')

new_block = '\n'.join(html_parts)

with open('taxi-preise.html', 'r', encoding='utf-8') as fh:
    content = fh.read()

marker_start = '<!-- v6.63.931-ROUTES-START -->'
marker_end = '<!-- v6.63.931-ROUTES-END -->'

if marker_start in content:
    content = re.sub(re.escape(marker_start) + r'[\s\S]*?' + re.escape(marker_end), new_block, content)
else:
    m = re.search(r'(</h1>|<main[^>]*>)', content, re.I)
    if m:
        idx = m.end()
        content = content[:idx] + '\n' + new_block + '\n' + content[idx:]
    else:
        content = content.replace('<body>', '<body>\n' + new_block, 1)

with open('taxi-preise.html', 'w', encoding='utf-8', newline='') as fh:
    fh.write(content)

print('OK: taxi-preise.html mit ' + str(total) + ' Routen in ' + str(len(cats)) + ' Kategorien')
for ck in cats_order:
    if ck in cats:
        rows = cats[ck]['rows']
        with_landing = sum(1 for r in rows if r['landing'])
        print('  ' + cats[ck]['label'] + ': ' + str(len(rows)) + ' Rows (' + str(with_landing) + ' mit Landing-Link)')
