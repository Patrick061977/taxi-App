#!/usr/bin/env python3
"""ICS-Datei → CalenGoo-CSV im Format:
Start date;Start time;End date;End time;Weekday;Holiday;Title;Description;

Weekday: Mo/Di/Mi/Do/Fr/Sa/So
Holiday: Name des Feiertags (MV) wenn zutreffend, sonst leer

Aufruf: python ics-to-csv.py <ics-file> <output-csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
"""
import sys, re, io, math
from datetime import datetime, timedelta, date

PAX_CAP = 8  # ab 9 Pax = 2 Fahrzeuge (Patrick 02.08. 12:16 "Flughafen ab 9 Personen 2 Fahrzeuge").

def extract_pax(text):
    """'2 Pax', '5PAX', '3 pax', '10 personen' → int. Fallback 1."""
    m = re.search(r'(\d{1,2})\s?(?:Pax|PAX|pax|Personen|personen|PERSONEN|p\b|P\b)', text)
    if m:
        return int(m.group(1))
    return 1  # unklar → 1

def extract_direction(text):
    """'outbound' (Hotel→BHF) | 'inbound' (BHF→Hotel) | 'unknown'"""
    t = text.lower()
    # Position von Hotel vs Bahnhof/Flughafen
    hotel_pos = -1
    for kw in ('hotel', 'kaiserhof'):
        p = t.find(kw)
        if p >= 0 and (hotel_pos == -1 or p < hotel_pos): hotel_pos = p
    dest_pos = -1
    for kw in ('bhf', 'bahnhof', 'flughafen', 'airport', 'flg'):
        p = t.find(kw)
        if p >= 0 and (dest_pos == -1 or p < dest_pos): dest_pos = p
    if hotel_pos == -1 or dest_pos == -1: return 'unknown'
    return 'outbound' if hotel_pos < dest_pos else 'inbound'

WEEKDAYS_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

def easter_sunday(year):
    """Meeus/Jones/Butcher-Algorithmus fuer westliches Osterdatum."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)

def holidays_mv(year):
    """Gesetzliche Feiertage in Mecklenburg-Vorpommern (Stand 2025+)."""
    e = easter_sunday(year)
    hol = {
        date(year, 1, 1): 'Neujahr',
        date(year, 3, 8): 'Internationaler Frauentag',
        e - timedelta(days=2): 'Karfreitag',
        e + timedelta(days=1): 'Ostermontag',
        date(year, 5, 1): 'Tag der Arbeit',
        e + timedelta(days=39): 'Christi Himmelfahrt',
        e + timedelta(days=50): 'Pfingstmontag',
        date(year, 10, 3): 'Tag der Deutschen Einheit',
        date(year, 10, 31): 'Reformationstag',
        date(year, 12, 25): '1. Weihnachtstag',
        date(year, 12, 26): '2. Weihnachtstag',
    }
    return hol

def get_holiday(d):
    """d = date → Feiertagsname oder ''"""
    return holidays_mv(d.year).get(d, '')

# Preis-Regeln (Patrick 02.08.):
# - Bahnhof Mo-Sa 06:00-22:00 = 8 EUR, sonst (Nacht + So/Feiertag) = 9 EUR
# - Flughafen 35 EUR immer
# - Sonstiges siehe Firebase pricingRules (Mo-Fr=20, Sa=25, So+Feiertag=30) — vorlaeufig
# - SZ (Selbstzahler) = 0 EUR

def classify_ride(title, descr):
    """title/descr → 'bahnhof' | 'flughafen' | 'sonstiges'
    Patrick 03.08. 12:22: 'auch bahnhof' — Fahrten ohne Bahnhof/Flughafen-Keyword
    (z.B. 'Andrea Belistai 2Pax & 1 Hund') sind in der Praxis meist Bahnhof-Fahrten.
    Neue Default-Regel: NUR Flughafen wird explizit erkannt, alles andere = bahnhof.
    Ausser: der Titel enthaelt 'SZ' oder 'Selbstzahler' → dann bleibt es SZ (0€) durch
    die separate is_sz-Detection im main()."""
    t = (title + ' ' + descr).lower()
    if re.search(r'\b(flughafen|flug|airport|flgh?)\b', t):
        return 'flughafen'
    # Alles was nicht Flughafen ist → bahnhof (Standard fuer die Hotels)
    return 'bahnhof'

# Patrick 12.08.2026 (Strandhotel-07/25-Bug-Analyse): Private/spezielle Ziele die
# NICHT als Hotel-Pauschale gelten sollen — Fahrer sollte Selbstzahler kassieren.
# Ohne diese Blacklist wurden Loddin/Bestattungshaus/Maxim-Gorki-Straße irrtuemlich
# als bahnhof mit 8 EUR dem Hotel berechnet.
PRIVATE_DEST_KEYWORDS = [
    'bestattungshaus', 'kruse',  # Bestattungshaus Kruse Heringsdorf
    'maxim-gorki-str', 'maxim gorki', 'maximgorki',  # Maxim-Gorki-Straße (private Adresse)
    'loddin',  # Ortsteil ohne Bahnhof
    'anklam',  # Stadt ohne Vertragsleistung
    'restaurant', 'kulmeck',  # Restaurant-Fahrten
    'seebrücke', 'seebruecke',  # Seebrücke (Ausflug, kein Bahnhof)
    'strand ',  # Strand-Fahrten (nur mit Space, damit "Strandhotel" nicht triggert)
    'braca',  # BRACA Restaurant
    'waldstraße', 'waldstrasse',  # Waldstraße (Restaurant Athen liegt dort)
]

def has_private_destination(title, descr):
    """True wenn Ziel eine private/nicht-Vertragsadresse ist → sollte SZ sein.
    Ausnahme: wenn zusaetzlich Bahnhof oder Flughafen im Titel → bleibt bei bahnhof/flughafen
    (z.B. 'Loddin Bahnhof' wäre echter Bahnhof-Transfer, nicht privat)."""
    t = (title + ' ' + descr).lower()
    # Wenn Bahnhof/Flughafen explizit erwaehnt → NICHT als privat behandeln
    if re.search(r'\b(bahnhof|bhf|flughafen|flug|airport|flgh?)\b', t):
        return False
    return any(kw in t for kw in PRIVATE_DEST_KEYWORDS)

BAHNHOF_FLAT = False  # Strandhotel-Modus (immer 8€, kein Sonntagstarif)

def compute_price(sdate_dt, kind, is_sz):
    """sdate_dt=datetime (mit Uhrzeit), kind=classify_ride, is_sz=bool → Preis EUR"""
    if is_sz:
        return 0
    if kind == 'sonstiges':
        return 0  # implizit SZ
    if kind == 'flughafen':
        return 35
    # bahnhof
    if BAHNHOF_FLAT:
        return 8  # Strandhotel: immer 8€, kein 9€-Aufschlag
    d = sdate_dt.date()
    h = sdate_dt.hour
    is_sunday_or_holiday = (d.weekday() == 6) or bool(get_holiday(d))
    if is_sunday_or_holiday:
        return 9
    if 6 <= h < 22:
        return 8
    return 9  # Mo-Sa Nachttarif

def parse_ics(path):
    """Iteriere VEVENTs, unfolde continuation lines (Zeile mit ' ' oder '\t' prefix = Fortsetzung der vorherigen)."""
    with open(path, encoding='utf-8') as f:
        text = f.read()
    # RFC 5545: continuation lines start with space/tab
    unfolded = re.sub(r'\r?\n[ \t]', '', text)
    events = []
    for match in re.finditer(r'BEGIN:VEVENT\s*(.*?)\s*END:VEVENT', unfolded, re.DOTALL):
        block = match.group(1)
        e = {}
        for line in block.split('\n'):
            line = line.strip()
            if not line: continue
            m = re.match(r'^([A-Z-]+)(?:;[^:]*)?:(.*)$', line)
            if not m: continue
            key, val = m.group(1), m.group(2)
            if key in ('DTSTART', 'DTEND'):
                # kann DATE oder DATETIME sein
                e[key] = val
            elif key in ('SUMMARY', 'DESCRIPTION'):
                # unescape
                val = val.replace('\\n', ' ').replace('\\,', ',').replace('\\;', ';').replace('\\\\', '\\')
                e[key] = val
        if 'DTSTART' in e:
            events.append(e)
    return events

def parse_dt(s):
    """DTSTART kann '20260701T093000' oder '20260701' (all-day) sein."""
    if not s: return None
    s = s.strip('Z')  # UTC-suffix ignorieren fuer Zeit-Zwecke
    if 'T' in s:
        try: return datetime.strptime(s[:15], '%Y%m%dT%H%M%S')
        except:
            try: return datetime.strptime(s[:13], '%Y%m%dT%H%M')
            except: return None
    else:
        try: return datetime.strptime(s[:8], '%Y%m%d')
        except: return None

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    ics_path = sys.argv[1]
    csv_path = sys.argv[2]
    dt_from = None
    dt_to = None
    args = sys.argv[3:]
    while args:
        a = args.pop(0)
        if a == '--from': dt_from = datetime.strptime(args.pop(0), '%Y-%m-%d')
        elif a == '--to': dt_to = datetime.strptime(args.pop(0), '%Y-%m-%d')
        elif a == '--bahnhof-flat':
            global BAHNHOF_FLAT
            BAHNHOF_FLAT = True

    events = parse_ics(ics_path)
    rows = []
    for e in events:
        start = parse_dt(e.get('DTSTART'))
        end = parse_dt(e.get('DTEND')) or start
        if not start: continue
        if dt_from and start < dt_from: continue
        if dt_to and start > dt_to: continue
        title = (e.get('SUMMARY') or '').replace(';', ',').replace('"', "'")
        descr = (e.get('DESCRIPTION') or '').replace(';', ',').replace('"', "'").replace('\n', ' ')
        sday = start.date()
        # Selbstzahler-Erkennung: SZ als eigenes Wort, Selbstzahler, sz!, etc.
        # v2 Patrick 12.08.2026 (Loddin-Bug): auch Tippfehler "Selbszahler" (ohne 't') matchen
        combined = title + ' ' + descr
        is_sz = bool(re.search(r'(?<![A-Za-z])(SZ|sz)(?![A-Za-z])|[Ss]elbs[tz]?zahler|SELBSZ?ZAHLER', combined))
        kind = classify_ride(title, descr)
        # Patrick 02.08. 12:05: Sonstiges impliziert SZ (Selbstzahler) → SZ-Spalte auch fuellen
        if kind == 'sonstiges' and not is_sz:
            is_sz = True
        # Patrick 12.08.2026 (Strandhotel-07/25 Loddin/Bestattungshaus/Maxim-Gorki-Bug):
        # Wenn Ziel eine private/nicht-Vertragsadresse ist → automatisch SZ, egal ob
        # der Titel das Wort "Selbstzahler" enthaelt oder nicht.
        if not is_sz and has_private_destination(title, descr):
            is_sz = True
        price = compute_price(start, kind, is_sz)
        rows.append({
            'sdate': start.strftime('%d.%m.%y'),
            'stime': start.strftime('%H:%M'),
            'edate': end.strftime('%d.%m.%y'),
            'etime': end.strftime('%H:%M'),
            'wday': WEEKDAYS_DE[sday.weekday()],
            'holiday': get_holiday(sday),
            'sz': 'SZ' if is_sz else '',
            'kind': kind,
            'price': price,
            'pax': extract_pax(title + ' ' + descr),
            'direction': extract_direction(title + ' ' + descr),
            'vehicles': 1,
            'title': title,
            'desc': descr,
            '_sortkey': start
        })

    # Patrick 03.08. 12:38 "doppelt": Duplikat-Erkennung vor Merge.
    # 2 Zeilen mit gleichem Tag + Zeit-Differenz <= 10 Min + gleiche Kategorie + gleicher Pax
    # + gleicher extrahierter Name → als Duplikat markieren (2. Zeile Preis 0, Merge-Note).
    def _short_name_early(t):
        m = re.search(r"['\"]([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ\.\-\s]{2,25})['\"]", t)
        if m: return m.group(1).strip(' .').lower()
        m = re.search(r'\b(?:Fr\.|Frau|Hr\.|Herr)\s+([A-ZÄÖÜ][a-zäöüß\-]+)', t)
        if m: return m.group(1).lower()
        return ''
    by_day = {}
    for r in rows:
        by_day.setdefault(r['sdate'], []).append(r)
    for day, drs in by_day.items():
        drs.sort(key=lambda r: r['_sortkey'])
        for i, a in enumerate(drs):
            if a.get('_duplicate'): continue
            for b in drs[i+1:]:
                if b.get('_duplicate'): continue
                if a['kind'] != b['kind']: continue
                if a['pax'] != b['pax']: continue
                # Patrick 03.08. 12:44: Duplikat bis 30 Min Zeitdifferenz (bei gleichem Namen +
                # gleicher Kategorie + gleicher Pax-Anzahl). Ab 30 Min = extra Fahrt (nicht abgesagt).
                th1 = int(a['stime'].split(':')[0]) * 60 + int(a['stime'].split(':')[1])
                th2 = int(b['stime'].split(':')[0]) * 60 + int(b['stime'].split(':')[1])
                if abs(th1 - th2) >= 30: continue
                na = _short_name_early(a['title'])
                nb = _short_name_early(b['title'])
                if not na or na != nb: continue
                # Duplikat: b markieren
                b['_duplicate'] = True
                b['price'] = 0
                b['_dup_of'] = a['stime']
                b['_dup_name'] = na

    # Patrick 02.08. 12:31 "warum nimmst du nicht die originale Datei":
    # Detail-Zeilen bleiben UNGEMERGT (1 Zeile pro Original-Kalender-Event, wie im Google-Kalender).
    # Merge-Berechnung nur im Zusammenfassungsblock unten.
    # Preis in der Detail-Zeile = normaler Einzelpreis (nicht ×Fahrzeuge).
    for r in rows:
        r['group_pax'] = r['pax']  # Default: alleinstehend
        r['group_veh'] = 1
        r['merge_note'] = ''
    # Patrick 03.08. 12:20: Merge nur wenn Start UND End identisch — sonst sind es
    # unterschiedliche Zuege/Ankuenfte (z.B. 14:25/14:25 = Zug 14:25, 14:25/14:55 = Zug 14:55).
    merge_buckets = {}
    for r in rows:
        if r['kind'] not in ('bahnhof', 'flughafen') or r['sz']: continue
        if r.get('_duplicate'): continue  # Duplikate nicht in Merge einbeziehen
        key = (r['sdate'], r['stime'], r['etime'], r['kind'], r['direction'])
        merge_buckets.setdefault(key, []).append(r)
    def _short_name(title):
        # 1. Name in Anfuehrungszeichen: 'Kubina' oder "Kubina"
        m = re.search(r"['\"]([A-ZÄÖÜ][a-zäöüßA-ZÄÖÜ\.\-\s]{2,30})['\"]", title)
        if m: return m.group(1).strip(' .')
        # 2. Fr./Frau/Hr./Herr NAME
        m = re.search(r'\b(?:Fr\.|Frau|Hr\.|Herr)\s+([A-ZÄÖÜ][a-zäöüß\-]+)', title)
        if m: return m.group(1)
        # 3. ", N Pax, NAME" oder ", NAME"
        m = re.search(r',\s*(?:\d+\s?Pax,\s*)?([A-ZÄÖÜ][a-zäöüß\-]{2,20})(?:$|\s*[.,;])', title)
        if m: return m.group(1)
        # 4. Fallback: erstes GroßbuchstabenWort > 3 Zeichen (skip 'Hotel', 'Bahnhof', etc.)
        for w in re.findall(r'\b([A-ZÄÖÜ][a-zäöüß\-]{3,})\b', title):
            if w.lower() not in ('hotel', 'bahnhof', 'flughafen', 'darek', 'danilo', 'patrick', 'christian', 'transfer', 'ankunft', 'landung', 'abflug', 'kaiserhof', 'kassel', 'mannheim', 'frankfurt', 'friedrichshafen', 'zuerich', 'zürich', 'luxemburg'):
                return w
        return title[:20]

    for key, bucket in merge_buckets.items():
        if len(bucket) == 1: continue
        total_pax = sum(b['pax'] for b in bucket)
        n_vehicles = max(1, math.ceil(total_pax / PAX_CAP))
        names = [_short_name(b['title']) for b in bucket]
        # Sortiere Bucket stabil nach Original-Reihenfolge (haben schon _sortkey)
        bucket_sorted = sorted(bucket, key=lambda b: b['_sortkey'])
        for i, b in enumerate(bucket_sorted):
            others = [names[j] for j in range(len(bucket)) if bucket[j] is not b]
            b['group_pax'] = total_pax
            b['group_veh'] = n_vehicles
            # Patrick 02.08. 12:36: Nur die ersten n_vehicles Zeilen tragen den Preis,
            # die restlichen 0€ (weil "im gleichen Fahrzeug mit drin").
            if i < n_vehicles:
                b['merge_note'] = f"Gruppe {total_pax}p, {n_vehicles} Fzg → mit: {', '.join(others)}"
            else:
                b['price'] = 0
                b['merge_note'] = f"→ mit im Fzg von {bucket_sorted[i % n_vehicles]['stime']} (Gruppe {total_pax}p, {n_vehicles} Fzg)"

    # Fuer Zusammenfassung: dedupe pro Gruppe (nur 1x zaehlen)
    seen_group_keys = set()
    summary = {}  # (kind, unit_price) → {'count', 'total'}
    total_invoice = 0
    for r in rows:
        if r['sz'] or r['kind'] not in ('bahnhof', 'flughafen'): continue
        gk = (r['sdate'], r['stime'], r['kind'], r['direction'])
        if gk in seen_group_keys: continue
        seen_group_keys.add(gk)
        unit_price = r['price']  # pro Fahrzeug
        veh = r['group_veh']
        row_total = unit_price * veh
        total_invoice += row_total
        skey = (r['kind'], unit_price)
        s = summary.setdefault(skey, {'count': 0, 'total': 0})
        s['count'] += veh
        s['total'] += row_total
    sort_order = {('bahnhof', 8): 1, ('bahnhof', 9): 2, ('flughafen', 35): 3}

    # Patrick 02.08. 12:41: Sortieren nach Datum+Uhrzeit chronologisch (Bug: sort war weg).
    rows.sort(key=lambda r: r['_sortkey'])

    with io.open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write('Start date;Start time;End date;End time;Weekday;Holiday;Selbstzahler;Kategorie;Pax;Preis EUR;Merge-Hinweis;Title;Description;\n')
        for r in rows:
            price_str = f"{r['price']:.2f}".replace('.', ',')
            f.write(f"{r['sdate']};{r['stime']};{r['edate']};{r['etime']};{r['wday']};{r['holiday']};{r['sz']};{r['kind']};{r['pax']};{price_str};{r['merge_note']};{r['title']};{r['desc']};\n")
        f.write(';;;;;;;;;;;;;\n')
        f.write(';;;;;;;;;;=== ZUSAMMENFASSUNG (Rechnungspositionen mit Merge) ===;;;;\n')
        for (kind, unit_price), s in sorted(summary.items(), key=lambda kv: sort_order.get(kv[0], 99)):
            label_kind = 'Bahnhof' if kind == 'bahnhof' else 'Flughafen'
            label_ext = ' (Werktag)' if (kind=='bahnhof' and unit_price==8) else ' (So/Feiertag/Nacht)' if (kind=='bahnhof' and unit_price==9) else ''
            total_str = f"{s['total']:.2f}".replace('.', ',')
            f.write(f";;;;;;;;;;{s['count']}x {label_kind} {unit_price} EUR{label_ext} = {total_str} EUR;;;\n")
        f.write(';;;;;;;;;;;;;\n')
        total_str = f"{total_invoice:.2f}".replace('.', ',')
        f.write(f";;;;;;;;;;GESAMT-RECHNUNG: {total_str} EUR;;;\n")
    print(f'{len(rows)} Events -> {csv_path}')

if __name__ == '__main__':
    main()
