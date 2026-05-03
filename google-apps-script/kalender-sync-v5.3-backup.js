// 📅 FUNK TAXI KALENDER-SYNCHRONISATION
// Google Apps Script für automatische Kalender-Einträge
// Version: 5.3 - Zwischenstopp-Adressen im Titel nicht mehr abgeschnitten (Patrick: 'Stops sind abgeschnitten genau wie in meinem google kalender')
// Version: 5.2 - Volle Sync-Symmetrie: stornierte UND geloeschte Rides werden auch rueckwirkend (90 Tage) aus Kalender entfernt
// Version: 5.1 - Stop-Timeline mit OSRM-Etappenzeiten + Wartezeiten pro Zwischenstopp
// Version: 5.0 - Fix: Zeitzonen-korrektes Datum-Parsing + findExistingEvent sucht jetzt breit (nicht nur am Zieltag)
// REGELN:
//   1. Nur ZUKÜNFTIGE Fahrten synchronisieren (ab heute 00:00)
//   2. Vergangene/abgeschlossene Termine im Kalender NIE anfassen
//   3. Alle zukünftigen Fahrten die noch keinen Eintrag haben → erstellen
//   4. Geänderte zukünftige Fahrten (updatedAt neuer) → aktualisieren
//   5. Nur stornierte → aus Kalender löschen
//   6. Abgeschlossene/abgelaufene → im Kalender lassen!
// ═══════════════════════════════════════════════════════════════
// 🔧 KONFIGURATION
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  // 🔥 Firebase Realtime Database URL
  FIREBASE_URL: 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app',

  // 📅 Google Kalender ID (normalerweise deine Email)
  CALENDAR_ID: 'primary',

  // ⏱️ Wie oft synchronisieren? (Minuten)
  SYNC_INTERVAL: 5,  // Kann öfter laufen, macht nur bei Änderungen was!

  // 🎨 Farbe für Taxi-Termine (1-11)
  EVENT_COLOR: 5
};
// 🆕 v3.8: Property-Keys für letzten Sync
const LAST_SYNC_KEY = 'lastSyncTimestamp';
// Export-Einstellungen
let EXPORT_SETTINGS = {
  showCustomerName: true,
  showGuestName: true,
  showGuestPhone: true,
  showPhone: true,
  showPickup: true,
  showDestination: true,
  showPassengers: true,
  showPrice: true,
  showDistance: true,
  showVehicle: true,
  showNotes: true,
  showReminder: true
};
// ═══════════════════════════════════════════════════════════════
// 🆕 v3.8: LETZTEN SYNC-ZEITSTEMPEL LADEN/SPEICHERN
// ═══════════════════════════════════════════════════════════════
function getLastSyncTimestamp() {
  const props = PropertiesService.getScriptProperties();
  const lastSync = props.getProperty(LAST_SYNC_KEY);

  if (lastSync) {
    return parseInt(lastSync);
  }

  // Beim ersten Mal: vor 24h
  return Date.now() - (24 * 60 * 60 * 1000);
}
function setLastSyncTimestamp(timestamp) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(LAST_SYNC_KEY, timestamp.toString());
}
// ═══════════════════════════════════════════════════════════════
// 🆕 v2.5: HILFSFUNKTION - IST ES EINE MOBILNUMMER?
// ═══════════════════════════════════════════════════════════════
function isMobileNumber(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/[\s\-\/\(\)]/g, '');
  return /^(\+49|0049|0)?1[567]\d/.test(cleaned);
}
// ═══════════════════════════════════════════════════════════════
// 🆕 v2.5: EXPORT-EINSTELLUNGEN AUS FIREBASE LADEN
// ═══════════════════════════════════════════════════════════════
function loadExportSettings() {
  try {
    const url = CONFIG.FIREBASE_URL + '/settings/calendarExport.json';
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());

    if (data) {
      EXPORT_SETTINGS = { ...EXPORT_SETTINGS, ...data };
      console.log('✅ Export-Einstellungen aus Firebase geladen');
    }
  } catch (error) {
    console.log('⚠️ Nutze Default Export-Einstellungen');
  }
}
// ═══════════════════════════════════════════════════════════════
// 🚀 HAUPT-FUNKTION - NUR GEÄNDERTE TERMINE!
// ═══════════════════════════════════════════════════════════════
function syncFirebaseToCalendar() {
  console.log('🚀 Starte SMARTE Kalender-Synchronisation v5.0...');

  // 🆕 v3.8: Hole letzten Sync-Zeitpunkt
  const lastSync = getLastSyncTimestamp();
  const lastSyncDate = new Date(lastSync);
  const now = Date.now();
  const nowDate = new Date(now);

  console.log('⏰ Letzter Sync:', lastSyncDate.toLocaleString('de-DE'));
  console.log('⏰ Jetziger Sync:', nowDate.toLocaleString('de-DE'));
  console.log('⏱️ Zeitspanne:', Math.round((now - lastSync) / 60000), 'Minuten');
  console.log('');

  loadExportSettings();

  try {
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    if (!calendar) {
      throw new Error('❌ Kalender nicht gefunden: ' + CONFIG.CALENDAR_ID);
    }

    // Hole alle Fahrten
    const allRides = fetchRidesFromFirebase();
    console.log('📊 Fahrten in Firebase (gesamt):', allRides.length);

    // 🔧 v4.0: SICHERHEITSCHECK - Bei leerem Ergebnis ABBRECHEN
    if (allRides.length === 0) {
      console.log('⚠️ SICHERHEITSCHECK: Keine Fahrten aus Firebase erhalten!');
      console.log('⚠️ Möglicher Firebase-Fehler - überspringe diesen Sync-Zyklus');
      console.log('⚠️ KEINE Termine werden gelöscht (Schutz vor Massen-Löschung)');
      return;
    }

    // Filter: Nur zukünftige Fahrten
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const futureRides = allRides.filter(ride => {
      const rideTime = ride.pickupTimestamp || ride.createdAt || 0;
      if (!rideTime || rideTime < todayStartMs) return false;

      const testDate = new Date(rideTime);
      if (isNaN(testDate.getTime())) return false;

      return true;
    });

    console.log('📌 Zukünftige Fahrten:', futureRides.length);

    // 🔧 v4.0: BLACKLIST - stornierte Fahrten ausschließen
    const excludeStatuses = ['storniert', 'cancelled', 'deleted'];
    const activeFutureRides = futureRides.filter(ride => !excludeStatuses.includes(ride.status));

    console.log('✅ Aktive zukünftige Fahrten:', activeFutureRides.length);

    // 🆕 v4.1: ZWEISTUFIGER SYNC
    // Stufe 1: Geänderte Fahrten seit letztem Sync (schnell)
    const changedRides = activeFutureRides.filter(ride => {
      const updatedAt = ride.updatedAt || ride.createdAt || 0;
      if (updatedAt > lastSync) return true;
      const createdAt = ride.createdAt || 0;
      if (createdAt > lastSync) return true;
      return false;
    });

    console.log('🔄 Geänderte Termine seit letztem Sync:', changedRides.length);

    // Stufe 2: Prüfe ALLE aktiven Fahrten auf fehlende ODER veraltete Kalender-Einträge
    // 🔧 v4.9: Auch Fahrzeug-Änderungen erkennen (Titel-Vergleich)
    const unchangedRides = activeFutureRides.filter(ride => !changedRides.includes(ride));
    const missingRides = [];

    if (unchangedRides.length > 0) {
      console.log('🔍 Prüfe', unchangedRides.length, 'unveränderte Fahrten auf fehlende/veraltete Kalender-Einträge...');
      for (const ride of unchangedRides) {
        const existing = findExistingEvent(calendar, ride.firebaseId);
        if (!existing) {
          missingRides.push(ride);
          console.log('📌 Fehlender Eintrag gefunden:', ride.firebaseId);
        } else {
          // 🔧 v4.9: Prüfe ob Fahrzeug im Kalender-Titel noch stimmt
          const currentTitle = existing.getTitle() || '';
          const currentVehicle = ride.vehicleLabel || ride.vehicle || ride.assignedVehicle || '';
          const currentPlate = ride.vehiclePlate ? ' (' + ride.vehiclePlate + ')' : '';
          const expectedVehicle = currentVehicle ? currentVehicle + currentPlate : '';
          // Prüfe ob das Fahrzeug im Titel enthalten ist (oder ob kein Fahrzeug mehr zugewiesen)
          if (expectedVehicle && !currentTitle.includes(currentVehicle)) {
            missingRides.push(ride);
            console.log('🔄 Fahrzeug-Änderung erkannt:', ride.firebaseId, '- Kalender:', currentTitle.split('|').pop()?.trim(), '→ Firebase:', expectedVehicle);
          }
          // Auch Preis-Änderungen erkennen
          const currentDesc = existing.getDescription() || '';
          const ridePrice = ride.price || ride.finalPrice || ride.actualPrice;
          if (ridePrice && currentDesc.includes('Preis:')) {
            const descPriceMatch = currentDesc.match(/Preis:\s*([\d.,]+)/);
            if (descPriceMatch) {
              const calPrice = parseFloat(descPriceMatch[1].replace(',', '.'));
              if (Math.abs(calPrice - parseFloat(ridePrice)) > 0.01) {
                if (!missingRides.includes(ride)) {
                  missingRides.push(ride);
                  console.log('💰 Preis-Änderung erkannt:', ride.firebaseId, '- Kalender:', calPrice + '€', '→ Firebase:', ridePrice + '€');
                }
              }
            }
          }
        }
      }
      console.log('📌 Fehlende/veraltete Kalender-Einträge:', missingRides.length);
    }

    // Kombiniere: geänderte + fehlende
    const ridesToSync = [...changedRides, ...missingRides];
    console.log('📊 Gesamt zu synchronisieren:', ridesToSync.length);
    console.log('⏭️ Übersprungen (bereits aktuell):', activeFutureRides.length - ridesToSync.length);
    console.log('');

    // Erstelle/Aktualisiere
    let created = 0;
    let updated = 0;
    let skipped = 0;

    ridesToSync.forEach(ride => {
      const result = createOrUpdateCalendarEvent(calendar, ride);
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else skipped++;
    });

    // Nur stornierte zukünftige Events entfernen (vergangene NIE anfassen!)
    const removed = removeOldEvents(calendar, allRides);

    // 🆕 v3.8: Speichere aktuellen Zeitstempel
    setLastSyncTimestamp(now);

    // Zusammenfassung
    console.log('\n✅ SYNCHRONISATION ABGESCHLOSSEN:');
    console.log('  📊 Geprüft:', futureRides.length, 'zukünftige Fahrten');
    console.log('  🔍 Geändert:', changedRides.length, '| Fehlend nachgeholt:', missingRides.length);
    console.log('  ➕ Erstellt:', created);
    console.log('  🔄 Aktualisiert:', updated);
    console.log('  ⏭️ Übersprungen:', skipped);
    console.log('  🗑️ Entfernt:', removed);
    console.log('  💾 Nächster Check: alle', CONFIG.SYNC_INTERVAL, 'Min');

  } catch (error) {
    console.error('❌ FEHLER:', error);
    sendErrorEmail(error);
  }
}
// ═══════════════════════════════════════════════════════════════
// 🔥 FIREBASE DATEN HOLEN
// ═══════════════════════════════════════════════════════════════
function fetchRidesFromFirebase() {
  const url = CONFIG.FIREBASE_URL + '/rides.json';

  try {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());

    if (!data) {
      console.log('⚠️ Keine Fahrten in Firebase');
      return [];
    }

    const rides = [];
    for (const [id, ride] of Object.entries(data)) {
      ride.firebaseId = id;
      rides.push(ride);
    }

    return rides;

  } catch (error) {
    console.error('❌ Fehler beim Laden aus Firebase:', error);
    return [];
  }
}
// ═══════════════════════════════════════════════════════════════
// 📅 KALENDER-EINTRAG ERSTELLEN/AKTUALISIEREN
// ═══════════════════════════════════════════════════════════════
function createOrUpdateCalendarEvent(calendar, ride) {
  try {
    let startTime;

    if (ride.pickupTimestamp) {
      // pickupTimestamp ist UTC-Epoch (ms) — new Date() erzeugt korrektes Date-Objekt
      // Google Calendar API nutzt die Script-Zeitzone (muss Europe/Berlin sein!)
      startTime = new Date(ride.pickupTimestamp);
    } else if (ride.pickupDate && ride.pickupTime) {
      // 🔧 v5.0: Explizit als Europe/Berlin parsen um Zeitzonen-Fehler zu vermeiden
      // Format: "2026-04-02T09:00:00" → wird als Script-Zeitzone interpretiert
      startTime = new Date(ride.pickupDate + 'T' + ride.pickupTime + ':00');
    } else if (ride.createdAt) {
      startTime = new Date(ride.createdAt + 15 * 60000);
    } else {
      startTime = new Date(Date.now() + 15 * 60000);
    }

    if (isNaN(startTime.getTime())) {
      console.log('⚠️ Überspringe Fahrt mit ungültigem Datum:', ride.firebaseId);
      return 'skipped';
    }

    // 🔧 v5.0: Zeitzonen-Diagnose loggen (hilft bei Debugging)
    const scriptTz = Session.getScriptTimeZone();
    if (scriptTz !== 'Europe/Berlin') {
      console.log('⚠️ WARNUNG: Script-Zeitzone ist "' + scriptTz + '" statt "Europe/Berlin"!');
      console.log('⚠️ → In Projekteinstellungen → Zeitzone auf "Europe/Berlin" setzen!');
    }

    const durationMinutes = ride.duration || 30;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    // 🔧 v4.4: Fallback - 'phone' Feld als customerPhone übernehmen
    // Manche Buchungsflows (AI-Assistant, ältere Buchungen) speichern als 'phone' statt 'customerPhone'
    if (!ride.customerPhone && ride.phone) {
      ride.customerPhone = ride.phone;
      console.log('📱 phone → customerPhone übernommen für:', ride.firebaseId);
    }

    const vehicleName = ride.vehicleLabel || ride.vehicle || ride.assignedVehicle || ride.assignedDriver || '';
    const vehiclePlate = ride.vehiclePlate ? ` (${ride.vehiclePlate})` : '';
    const vehicleDisplay = vehicleName ? vehicleName + vehiclePlate : '';

    let titleParts = [];

    // 🆕 v4.8: Zwischenstopps im Titel anzeigen
    // 🆕 v5.3: Patrick (01.05.): "Zwischenstops abgeschnitten genau wie in meinem
    // Google Kalender". Vorher: substring(0,18)+'…' kappte "aja Strandhotel Bansin"
    // zu "aja Strandhotel Ba…". Jetzt: ersten Adressteil (vor Komma — meist Hotel/POI-
    // Name) ungekuerzt + optional Pax-Name in Klammern. Volle Adresse steht weiter
    // in der Beschreibung. Titel ist immer noch lesbar, aber alles ist drin.
    // v5.4: Pauschalpreis-Marker im Titel — Patrick (03.05.): "Wie wird das nachher
    // uebernommen? Wird das als Pauschalpreis angezeigt im Kalender?"
    var _isFlatPrice = ride.priceFixed === true || ride.fixedPrice === true ||
        (ride.notes && /^pauschalpreis\b/i.test(String(ride.notes).trim())) ||
        (ride.notes && /\bpauschalpreis\s+\d/i.test(String(ride.notes)));
    var _flatPrefix = _isFlatPrice ? '🏷️ ' : '';
    if (ride.waypoints && ride.waypoints.length > 0) {
      var wpNames = Array.isArray(ride.waypoints) ? ride.waypoints : [ride.waypoints];
      var wpShort = wpNames.map(function(w) {
        var addr = (typeof w === 'object') ? (w.address || '') : String(w || '');
        var shortPart = addr.split(',')[0].trim();
        var paxName = (typeof w === 'object') ? (w.name || '') : '';
        if (paxName) shortPart += ' (' + paxName + ')';
        return shortPart || addr;
      });
      titleParts.push(`${_flatPrefix}🚕 ${ride.pickup || 'Unbekannt'} → 🔶${wpShort.join(' → 🔶')} → ${ride.destination || 'Unbekannt'}`);
    } else {
      titleParts.push(`${_flatPrefix}🚕 ${ride.pickup || 'Unbekannt'} → ${ride.destination || 'Unbekannt'}`);
    }

    if (EXPORT_SETTINGS.showPassengers) {
      titleParts.push(`${ride.passengers || 1} Pers.`);
    }

    if (EXPORT_SETTINGS.showCustomerName && ride.customerName) {
      titleParts.push(ride.customerName);
    }

    if (EXPORT_SETTINGS.showGuestName && ride.guestName) {
      let guestText = '🧳' + ride.guestName;
      if (EXPORT_SETTINGS.showGuestPhone && ride.guestPhone && isMobileNumber(ride.guestPhone)) {
        guestText += ' 📱' + ride.guestPhone;
      }
      titleParts.push(guestText);
    }

    // 🔧 v4.4: Nur Mobilnummern im Titel (Festnetz nur in Beschreibung)
    if (EXPORT_SETTINGS.showPhone) {
      if (ride.customerMobile) {
        titleParts.push('📱' + ride.customerMobile);
      } else if (ride.customerPhone && isMobileNumber(ride.customerPhone)) {
        titleParts.push('📱' + ride.customerPhone);
      }
    }

    if (EXPORT_SETTINGS.showVehicle && vehicleDisplay) {
      titleParts.push(vehicleDisplay);
    }

    const title = titleParts.join(' | ');
    const description = createEventDescription(ride);

    const existingEvent = findExistingEvent(calendar, ride.firebaseId);

    if (existingEvent) {
      existingEvent.setTitle(title);
      existingEvent.setDescription(description);
      existingEvent.setTime(startTime, endTime);
      existingEvent.setLocation(ride.pickup || '');
      existingEvent.setColor(CONFIG.EVENT_COLOR);

      // 🔧 v4.2: Erinnerung setzen wenn aktiviert
      if (EXPORT_SETTINGS.showReminder) {
        existingEvent.removeAllReminders();
        existingEvent.addPopupReminder(30); // 30 Min vorher
      }

      console.log('🔄 Aktualisiert:', ride.firebaseId);
      return 'updated';

    } else {
      const event = calendar.createEvent(title, startTime, endTime, {
        description: description,
        location: ride.pickup || '',
        guests: '',
        sendInvites: false
      });

      event.setColor(CONFIG.EVENT_COLOR);
      event.setTag('firebaseId', ride.firebaseId);

      // 🔧 v4.2: Erinnerung setzen wenn aktiviert
      if (EXPORT_SETTINGS.showReminder) {
        event.removeAllReminders();
        event.addPopupReminder(30); // 30 Min vorher
      }

      console.log('➕ Erstellt:', ride.firebaseId);
      return 'created';
    }

  } catch (error) {
    console.error('❌ Fehler bei Event:', ride.firebaseId, error);
    return 'error';
  }
}
// ═══════════════════════════════════════════════════════════════
// 📝 EVENT-BESCHREIBUNG ERSTELLEN
// ═══════════════════════════════════════════════════════════════
function createEventDescription(ride) {
  const lines = [];

  lines.push('🚕 TAXI-FAHRT');
  lines.push('');

  if (EXPORT_SETTINGS.showCustomerName) {
    lines.push('👤 Kunde: ' + (ride.customerName || 'Unbekannt'));
  }

  if (EXPORT_SETTINGS.showGuestName && ride.guestName) {
    let guestLine = '🧳 Gast: ' + ride.guestName;
    if (EXPORT_SETTINGS.showGuestPhone && ride.guestPhone) {
      guestLine += ' (' + ride.guestPhone + ')';
    }
    lines.push(guestLine);
  }

  if (EXPORT_SETTINGS.showPhone) {
    if (ride.customerMobile) {
      lines.push('📱 Handy: ' + ride.customerMobile);
    } else if (ride.customerPhone && isMobileNumber(ride.customerPhone)) {
      lines.push('📱 Handy: ' + ride.customerPhone);
    }

    if (ride.customerPhone && !isMobileNumber(ride.customerPhone)) {
      lines.push('☎️ Festnetz: ' + ride.customerPhone);
    }

    if (ride.customerMobile && ride.customerPhone && isMobileNumber(ride.customerPhone)) {
      lines.push('📱 Handy 2: ' + ride.customerPhone);
    }
  }

  lines.push('');

  if (EXPORT_SETTINGS.showPickup) {
    // 🆕 v4.9: pickupName am Pickup anzeigen (Hotel-Gast / Familie etc.)
    var _pickupLine = '📍 Von: ' + (ride.pickup || '-');
    if (ride.pickupName) _pickupLine += ' — ' + ride.pickupName;
    lines.push(_pickupLine);
  }
  // 🆕 v4.8 + v4.9: Zwischenstopps anzeigen MIT NAMEN (Patrick: 'Familie Luettig fehlt
  // im Kalender — der Code nimmt nur address ODER name, nicht beides').
  if (ride.waypoints && ride.waypoints.length > 0) {
    var waypoints = Array.isArray(ride.waypoints) ? ride.waypoints : [ride.waypoints];
    for (var w = 0; w < waypoints.length; w++) {
      var _wp = waypoints[w];
      var _wpAddr = (typeof _wp === 'object') ? (_wp.address || '') : String(_wp || '');
      var _wpName = (typeof _wp === 'object') ? (_wp.name || '') : '';
      var _line = '🔶 Zwischenstopp: ' + _wpAddr;
      if (_wpName) _line += ' — ' + _wpName;
      lines.push(_line);
    }
  }
  if (EXPORT_SETTINGS.showDestination) {
    // 🆕 v4.9: destinationName am Ziel anzeigen (Patrick: 'Frau Bohner beim Seehotel Esplanade')
    var _destLine = '🎯 Nach: ' + (ride.destination || '-');
    if (ride.destinationName) _destLine += ' — ' + ride.destinationName;
    lines.push(_destLine);
  }

  // 🆕 v5.0: Stop-Timeline (OSRM-Etappen + Wartezeiten) — wenn ride.timeline aus Auftrag-Import vorhanden
  if (ride.timeline && Array.isArray(ride.timeline) && ride.timeline.length > 0) {
    lines.push('');
    lines.push('⏱ Stop-Timeline:');
    for (var sIdx = 0; sIdx < ride.timeline.length; sIdx++) {
      var s = ride.timeline[sIdx];
      var _ic = s.kind === 'pickup' ? '📍' : (s.kind === 'destination' ? '🎯' : '🔶');
      var _lbl = s.kind === 'pickup' ? 'Abholung' : (s.kind === 'destination' ? 'Ziel' : 'Stopp ' + sIdx);
      var _time = '';
      if (s.arrivalTime) {
        var d = new Date(s.arrivalTime);
        _time = Utilities.formatDate(d, 'Europe/Berlin', 'HH:mm');
      }
      var _line = '   ' + (_time || '--:--') + '  ' + _ic + ' ' + _lbl;
      if (s.name) _line += ' — ' + s.name;
      if (s.address) _line += ' (' + s.address + ')';
      if (s.dwellMin) _line += '  +' + s.dwellMin + ' Min Wartezeit';
      lines.push(_line);
    }
  }

  lines.push('');

  if (EXPORT_SETTINGS.showPrice && ride.price) {
    // 🆕 v5.4: Pauschalpreis-Marker. Erkennung via:
    //  a) ride.priceFixed === true (Buchung hat Festpreis-Flag, ab v6.62.21x)
    //  b) ride.notes startet mit 'Pauschalpreis' (Anfrage-Pfad aus anfrage.html)
    //  c) ride.notes enthaelt 'Pauschalpreis ' und Eurobetrag
    var _isFlat = ride.priceFixed === true || ride.fixedPrice === true ||
        (ride.notes && /^pauschalpreis\b/i.test(String(ride.notes).trim())) ||
        (ride.notes && /\bpauschalpreis\s+\d/i.test(String(ride.notes)));
    if (_isFlat) {
      lines.push('🏷️ <b>Pauschalpreis: ' + ride.price + '€</b> (Festpreis, nicht KM-basiert)');
    } else {
      lines.push('💰 Preis: ' + ride.price + '€');
    }
  }
  if (EXPORT_SETTINGS.showDistance && ride.distance) {
    lines.push('📏 Distanz: ' + ride.distance + ' km');
  }
  lines.push('⏱️ Dauer: ~' + (ride.duration || '?') + ' Min' + (ride.totalDwellMin ? ' + ' + ride.totalDwellMin + ' Min Wartezeit' : ''));
  if (EXPORT_SETTINGS.showPassengers) {
    lines.push('👥 Personen: ' + (ride.passengers || '1'));
  }

  if (EXPORT_SETTINGS.showNotes && ride.notes) {
    lines.push('');
    lines.push('📝 Notizen: ' + ride.notes);
  }

  lines.push('');
  lines.push('📊 Status: ' + (ride.status || 'unbekannt'));

  if (EXPORT_SETTINGS.showVehicle) {
    if (ride.assignedDriver) {
      lines.push('🚗 Fahrer: ' + ride.assignedDriver);
    }
    if (ride.vehicleLabel || ride.vehicle) {
      lines.push('🚗 Fahrzeug: ' + (ride.vehicleLabel || ride.vehicle));
    }
  }

  lines.push('');
  lines.push('🆔 Firebase ID: ' + ride.firebaseId);

  // 🆕 v4.0: SIGNATUR
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📝 Erstellt von: CalendarSync v5.3 (volle Stop-Adressen)');
  lines.push('🖥️ Script-Account: ' + Session.getActiveUser().getEmail());
  lines.push('⏰ Sync-Zeit: ' + new Date().toLocaleString('de-DE'));
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}
// ═══════════════════════════════════════════════════════════════
// 🔍 EXISTIERENDES EVENT FINDEN
// ═══════════════════════════════════════════════════════════════
function findExistingEvent(calendar, firebaseId) {
  // 🔧 v5.0: Kein Zeitfilter! Suche ALLE zukünftigen Events.
  // Wenn eine Fahrt geändert wurde, muss das Event gefunden werden — egal an welchem Datum es steht.
  const searchStart = new Date();
  searchStart.setDate(searchStart.getDate() - 1);
  searchStart.setHours(0, 0, 0, 0);
  const searchEnd = new Date();
  searchEnd.setFullYear(searchEnd.getFullYear() + 1);


  const events = calendar.getEvents(searchStart, searchEnd);
  const matchingEvents = [];

  for (const event of events) {
    const title = event.getTitle() || '';
    if (!title.startsWith('🚕')) continue;

    const description = event.getDescription() || '';
    if (description.includes(firebaseId)) {
      matchingEvents.push(event);
    }
  }

  if (matchingEvents.length > 1) {
    console.log('⚠️ Duplikate gefunden für: ' + firebaseId + ' (' + matchingEvents.length + ' Events)');
    for (let i = 1; i < matchingEvents.length; i++) {
      console.log('🗑️ Lösche Duplikat #' + (i+1));
      matchingEvents[i].deleteEvent();
    }
  }

  return matchingEvents.length > 0 ? matchingEvents[0] : null;
}
// ═══════════════════════════════════════════════════════════════
// 🗑️ NUR STORNIERTE EVENTS ENTFERNEN + DUPLIKATE BEREINIGEN
// 🔧 v4.1: Vergangene/abgeschlossene Termine werden NIE angefasst!
// Nur ZUKÜNFTIGE stornierte Fahrten werden aus dem Kalender entfernt.
// Alles andere bleibt wie es ist.
// ═══════════════════════════════════════════════════════════════
function removeOldEvents(calendar, currentRides) {
  // SICHERHEITSCHECK - Bei leerem Firebase-Ergebnis NICHTS tun
  if (!currentRides || currentRides.length === 0) {
    console.log('⚠️ SICHERHEITSCHECK: Keine Rides vorhanden - überspringe komplett!');
    return 0;
  }

  // 🆕 v5.2: Map firebaseId → ride fuer schnellen Lookup
  // Wir brauchen sowohl "storniert"-Erkennung als auch "komplett geloescht"-Erkennung.
  const ridesById = new Map();
  currentRides.forEach(r => {
    if (r.firebaseId) ridesById.set(r.firebaseId, r);
  });

  const cancelStatuses = ['storniert', 'cancelled', 'deleted'];

  // 🆕 v5.2: Zeitfenster auf 90 Tage zurueck erweitert (vorher 24h).
  // Grund: stornierte Fahrten von vor mehreren Tagen blieben sonst dauerhaft im Kalender haengen,
  // obwohl sie in Firebase laengst weg / storniert sind (Vetter Touristik 25.04. = 6 Tage).
  // Web-App Fahrtenkalender und Google-Kalender muessen synchron sein.
  const now = new Date();
  const past90d = new Date(now.getTime() - 90 * 24 * 3600000);
  const future = new Date(now.getTime() + 90 * 24 * 3600000);
  const events = calendar.getEvents(past90d, future);

  let removed = 0;

  // Events nach Firebase-ID gruppieren (fuer Duplikat-Erkennung)
  const eventsByFirebaseId = new Map();
  events.forEach(event => {
    const title = event.getTitle();
    if (!title || !title.startsWith('🚕')) return;
    const description = event.getDescription() || '';
    const match = description.match(/🆔 Firebase ID: ([^\s\n]+)/);
    if (match && match[1]) {
      if (!eventsByFirebaseId.has(match[1])) eventsByFirebaseId.set(match[1], []);
      eventsByFirebaseId.get(match[1]).push(event);
    }
  });

  eventsByFirebaseId.forEach((eventsWithSameId, firebaseId) => {
    const ride = ridesById.get(firebaseId);
    // 🆕 v5.2: Drei Loesch-Faelle (statt nur "storniert"):
    //   1) Ride existiert NICHT mehr in Firebase  → komplett geloescht → Event weg
    //   2) Ride hat Status storniert/cancelled/deleted → Event weg
    //   3) Duplikate (mehrere Events fuer gleiche firebaseId) → nur 1 behalten
    const rideMissing = !ride;
    const rideCancelled = ride && cancelStatuses.includes(ride.status);

    if (rideMissing || rideCancelled) {
      eventsWithSameId.forEach(e => {
        e.deleteEvent();
        removed++;
      });
      console.log(rideMissing
        ? '🗑️ v5.2 Geloeschte Ride (Firebase weg) entfernt: ' + firebaseId
        : '🗑️ Storniert entfernt: ' + firebaseId);
    } else if (eventsWithSameId.length > 1) {
      // Aktive Ride mit Duplikaten → erstes behalten, Rest weg
      console.log('🔍 Duplikate für ' + firebaseId + ': ' + eventsWithSameId.length);
      for (let i = 1; i < eventsWithSameId.length; i++) {
        eventsWithSameId[i].deleteEvent();
        removed++;
      }
    }
  });

  return removed;
}
// ═══════════════════════════════════════════════════════════════
// 📧 FEHLER-EMAIL SENDEN
// ═══════════════════════════════════════════════════════════════
function sendErrorEmail(error) {
  try {
    MailApp.sendEmail({
      to: Session.getActiveUser().getEmail(),
      subject: '❌ Fehler bei Taxi-Kalender-Sync',
      body: 'Es gab einen Fehler:\n\n' + error.toString()
    });
  } catch (e) {
    console.error('❌ Konnte Fehler-Email nicht senden');
  }
}
// ═══════════════════════════════════════════════════════════════
// ⏰ AUTOMATISCHE TRIGGER EINRICHTEN
// ═══════════════════════════════════════════════════════════════
function setupAutomaticSync() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;

  triggers.forEach(trigger => {
    const func = trigger.getHandlerFunction();
    if (func === 'syncFirebaseToCalendar' ||
        func === 'syncRidesToCalendar' ||
        func.includes('sync') ||
        func.includes('Sync') ||
        func.includes('Calendar') ||
        func.includes('calendar')) {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
      console.log('🗑️ Alter Trigger gelöscht:', func);
    }
  });

  console.log('✅ ' + deleted + ' alte Trigger gelöscht!');

  ScriptApp.newTrigger('syncFirebaseToCalendar')
    .timeBased()
    .everyMinutes(CONFIG.SYNC_INTERVAL)
    .create();

  console.log('✅ Neuer Safe-Sync Trigger erstellt: alle ' + CONFIG.SYNC_INTERVAL + ' Min');
}
// ═══════════════════════════════════════════════════════════════
// 🧪 TEST-FUNKTION
// ═══════════════════════════════════════════════════════════════
function testSync() {
  console.log('🧪 TEST-MODUS v4.7');
  console.log('═══════════════════════════════════════════');
  console.log('🔧 FIX 1: Blacklist statt Whitelist (alle Status außer storniert)');
  console.log('🔧 FIX 2: Sicherheitscheck bei leerem Firebase-Ergebnis');
  console.log('🔧 FIX 3: Nur stornierte Termine löschen (nicht fehlende)');
  console.log('🔧 FIX 4: Fehlende Kalender-Einträge werden automatisch nachgeholt');
  console.log('');

  syncFirebaseToCalendar();

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ Test abgeschlossen!');
}
// ═══════════════════════════════════════════════════════════════
// 🆕 v3.8: LETZTEN SYNC ZURÜCKSETZEN (für Test)
// ═══════════════════════════════════════════════════════════════
function resetLastSync() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(LAST_SYNC_KEY);
  console.log('✅ Letzter Sync-Timestamp zurückgesetzt!');
  console.log('   Beim nächsten Sync werden alle Termine aktualisiert.');
}
