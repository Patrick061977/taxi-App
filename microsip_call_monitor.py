#!/usr/bin/env python3
"""
MicroSIP Call Monitor für Taxi-App
Überwacht eingehende Anrufe und schreibt sie in Firebase

INSTALLATION:
1. Python 3.7+ installieren
2. Bibliotheken installieren: pip install firebase-admin pywin32
3. Firebase Admin SDK JSON-Key herunterladen und als 'firebase-key.json' speichern
4. Script als Windows-Service oder Autostart einrichten

VERWENDUNG:
python microsip_call_monitor.py
"""

import os
import sys
import time
import json
import re
from datetime import datetime
from pathlib import Path

try:
    import firebase_admin
    from firebase_admin import credentials, db
except ImportError:
    print("❌ FEHLER: firebase-admin nicht installiert!")
    print("📥 Installation: pip install firebase-admin")
    sys.exit(1)

try:
    import win32evtlog
    import win32evtlogutil
    import win32con
except ImportError:
    print("❌ FEHLER: pywin32 nicht installiert!")
    print("📥 Installation: pip install pywin32")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════
# KONFIGURATION
# ══════════════════════════════════════════════════════════════

# Firebase Konfiguration
FIREBASE_DATABASE_URL = "https://taxi-app-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app/"
FIREBASE_KEY_PATH = "firebase-key.json"

# MicroSIP Log-Pfade (kann angepasst werden)
MICROSIP_LOG_PATHS = [
    os.path.expanduser("~\\AppData\\Roaming\\MicroSIP\\log.txt"),
    os.path.expanduser("~\\Documents\\MicroSIP\\log.txt"),
    "C:\\Program Files\\MicroSIP\\log.txt",
    "C:\\Program Files (x86)\\MicroSIP\\log.txt"
]

# Deine Telefonnummer (für Anrufe an deine Nummer)
YOUR_PHONE_NUMBER = "+4915127585179"  # ANPASSEN!

# ══════════════════════════════════════════════════════════════
# FIREBASE INITIALISIERUNG
# ══════════════════════════════════════════════════════════════

def init_firebase():
    """Initialisiere Firebase Admin SDK"""
    print("🔥 Initialisiere Firebase...")

    if not os.path.exists(FIREBASE_KEY_PATH):
        print(f"❌ FEHLER: Firebase Key nicht gefunden: {FIREBASE_KEY_PATH}")
        print("")
        print("📋 SO BEKOMMST DU DEN KEY:")
        print("1. Gehe zu: https://console.firebase.google.com/")
        print("2. Wähle dein Projekt: taxi-app-heringsdorf")
        print("3. Projekteinstellungen → Dienstkonten")
        print("4. 'Neuen privaten Schlüssel generieren'")
        print("5. Speichere die JSON-Datei als 'firebase-key.json' in diesem Ordner")
        sys.exit(1)

    try:
        cred = credentials.Certificate(FIREBASE_KEY_PATH)
        firebase_admin.initialize_app(cred, {
            'databaseURL': FIREBASE_DATABASE_URL
        })
        print("✅ Firebase erfolgreich initialisiert!")
        return True
    except Exception as e:
        print(f"❌ Firebase Initialisierung fehlgeschlagen: {e}")
        return False

# ══════════════════════════════════════════════════════════════
# MICROSIP LOG MONITORING
# ══════════════════════════════════════════════════════════════

def find_microsip_log():
    """Finde MicroSIP Log-Datei"""
    for path in MICROSIP_LOG_PATHS:
        if os.path.exists(path):
            print(f"✅ MicroSIP Log gefunden: {path}")
            return path

    print("⚠️ MicroSIP Log nicht gefunden!")
    print("📋 Geprüfte Pfade:")
    for path in MICROSIP_LOG_PATHS:
        print(f"   - {path}")
    print("")
    print("💡 LÖSUNG: Gib den richtigen Pfad zur MicroSIP Log-Datei ein:")
    custom_path = input("Pfad zur log.txt: ").strip()
    if os.path.exists(custom_path):
        return custom_path
    else:
        print(f"❌ Datei nicht gefunden: {custom_path}")
        return None

def parse_incoming_call(line):
    """Extrahiere Anruf-Daten aus Log-Zeile

    Beispiel-Zeilen:
    [2025-02-05 14:30:15] INCOMING CALL from: +491234567890
    [2025-02-05 14:30:15] Call from +491234567890 to +4915127585179
    """

    # Verschiedene Log-Formate unterstützen
    patterns = [
        r'INCOMING\s+CALL\s+from:\s*([+\d\s\-\(\)]+)',
        r'Call\s+from\s+([+\d\s\-\(\)]+)\s+to',
        r'Incoming.*?:\s*([+\d\s\-\(\)]+)',
    ]

    for pattern in patterns:
        match = re.search(pattern, line, re.IGNORECASE)
        if match:
            caller = match.group(1).strip()
            # Bereinige Telefonnummer
            caller = re.sub(r'[\s\-\(\)]', '', caller)
            return caller

    return None

async def check_customer_in_firebase(phone_number):
    """Prüfe ob Kunde in Firebase existiert"""
    try:
        # Normalisiere Telefonnummer (entferne +, Leerzeichen, etc.)
        clean_number = re.sub(r'[^\d]', '', phone_number)

        # Suche in customers nach Telefonnummer
        customers_ref = db.reference('customers')
        snapshot = customers_ref.order_by_child('phone').equal_to(phone_number).get()

        if not snapshot:
            # Versuche auch mit bereinigter Nummer
            snapshot = customers_ref.order_by_child('phone').equal_to(clean_number).get()

        if snapshot:
            # Kunde gefunden!
            customer_id = list(snapshot.keys())[0]
            customer_data = snapshot[customer_id]

            # Hole letzte Fahrten
            rides_ref = db.reference('rides')
            rides_snapshot = rides_ref.order_by_child('customerId').equal_to(customer_id).limit_to_last(5).get()

            last_rides = []
            if rides_snapshot:
                for ride_id, ride_data in rides_snapshot.items():
                    last_rides.append({
                        'pickup': ride_data.get('pickup', ''),
                        'destination': ride_data.get('destination', ''),
                        'timestamp': ride_data.get('timestamp', 0)
                    })

            return {
                'type': 'existing',
                'customer': {
                    'id': customer_id,
                    'name': customer_data.get('name', 'Unbekannt'),
                    'address': customer_data.get('address', ''),
                    'email': customer_data.get('email', '')
                },
                'lastRides': last_rides
            }
        else:
            return {'type': 'new'}

    except Exception as e:
        print(f"⚠️ Fehler bei Kunden-Suche: {e}")
        return {'type': 'new'}

def send_to_firebase(caller_number):
    """Sende Anruf-Daten an Firebase"""
    print(f"📞 Eingehender Anruf von: {caller_number}")
    print(f"⏰ Zeitpunkt: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")

    try:
        # Prüfe ob Kunde existiert
        customer_info = check_customer_in_firebase(caller_number)

        # Erstelle Anruf-Daten
        call_data = {
            'type': customer_info['type'],
            'caller': caller_number,
            'called': YOUR_PHONE_NUMBER,
            'timestamp': int(time.time() * 1000),  # Millisekunden
        }

        if customer_info['type'] == 'existing':
            call_data['customer'] = customer_info['customer']
            call_data['lastRides'] = customer_info.get('lastRides', [])
            print(f"✅ Bekannter Kunde: {customer_info['customer']['name']}")
        else:
            print(f"🆕 Neuer Kunde")

        # Schreibe in Firebase
        call_popup_ref = db.reference('callPopup')
        call_popup_ref.set(call_data)

        print(f"✅ Anruf-Daten an Firebase gesendet!")
        print(f"📊 Daten: {json.dumps(call_data, indent=2, ensure_ascii=False)}")

        # Speichere auch in callHistory
        call_history_ref = db.reference('callHistory').push()
        call_history_ref.set({
            **call_data,
            'customerFound': customer_info['type'] == 'existing',
            'customerId': customer_info.get('customer', {}).get('id', None) if customer_info['type'] == 'existing' else None
        })

        return True

    except Exception as e:
        print(f"❌ Fehler beim Senden an Firebase: {e}")
        return False

def monitor_microsip_log(log_path):
    """Überwache MicroSIP Log-Datei auf neue Anrufe"""
    print(f"👂 Überwache MicroSIP Log: {log_path}")
    print(f"⏰ Gestartet: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
    print("")
    print("💡 WICHTIG:")
    print("   - Script läuft jetzt im Hintergrund")
    print("   - Bei eingehenden Anrufen werden Daten an Firebase gesendet")
    print("   - Die Taxi-App zeigt dann automatisch das Popup")
    print("")
    print("⌨️  Zum Beenden: Strg+C drücken")
    print("═" * 70)
    print("")

    # Lese aktuelle Dateigröße
    file_size = os.path.getsize(log_path)
    processed_calls = set()  # Verhindere Duplikate

    try:
        with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
            # Springe ans Ende der Datei
            f.seek(file_size)

            while True:
                line = f.readline()

                if not line:
                    # Keine neue Zeile, warte kurz
                    time.sleep(0.5)

                    # Prüfe ob Datei gewachsen ist
                    current_size = os.path.getsize(log_path)
                    if current_size < file_size:
                        # Datei wurde zurückgesetzt (neu erstellt)
                        print("🔄 Log-Datei wurde zurückgesetzt, starte neu...")
                        f.seek(0)
                        file_size = 0
                    continue

                file_size = f.tell()

                # Prüfe auf eingehenden Anruf
                caller = parse_incoming_call(line)
                if caller:
                    # Verhindere Duplikate (gleiche Nummer innerhalb 10 Sek)
                    call_id = f"{caller}_{int(time.time() / 10)}"
                    if call_id not in processed_calls:
                        processed_calls.add(call_id)
                        send_to_firebase(caller)
                        print("")

                        # Cleanup alte Calls (älter als 1 Minute)
                        current_time = int(time.time() / 10)
                        processed_calls = {cid for cid in processed_calls
                                         if int(cid.split('_')[1]) >= current_time - 6}

    except KeyboardInterrupt:
        print("")
        print("⏹️  Script beendet.")
        print(f"⏰ Beendet: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
    except Exception as e:
        print(f"❌ Fehler beim Monitoring: {e}")

# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

def main():
    print("═" * 70)
    print("  📞 MicroSIP Call Monitor für Taxi-App")
    print("═" * 70)
    print("")

    # 1. Firebase initialisieren
    if not init_firebase():
        sys.exit(1)

    print("")

    # 2. MicroSIP Log finden
    log_path = find_microsip_log()
    if not log_path:
        sys.exit(1)

    print("")

    # 3. Monitoring starten
    monitor_microsip_log(log_path)

if __name__ == "__main__":
    main()
