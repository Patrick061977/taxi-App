// 📅 FUNK TAXI KALENDER-SYNCHRONISATION
// Google Apps Script für automatische Kalender-Einträge
// Version: 4.1 - VOLLSTÄNDIGE SYNC + SICHERHEITSFIX
// 🔧 FIX 1: Blacklist statt Whitelist - alle Status außer storniert werden synchronisiert
// 🔧 FIX 2: Sicherheitscheck - bei leerem Firebase-Ergebnis NICHT löschen
// 🔧 FIX 3: Minimum-Check verhindert versehentliches Massen-Löschen
// 🔧 FIX 4: Fahrten OHNE Kalender-Eintrag werden IMMER synchronisiert (auch wenn updatedAt älter)
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
  console.log('🚀 Starte SMARTE Kalender-Synchronisation v4.1...');

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

    // Stufe 2: Prüfe ALLE aktiven Fahrten auf fehlende Kalender-Einträge
    // (fängt Fahrten auf die vor dem ersten Sync erstellt wurden)
    const unchangedRides = activeFutureRides.filter(ride => !changedRides.includes(ride));
    const missingRides = [];

    if (unchangedRides.length > 0) {
      console.log('🔍 Prüfe', unchangedRides.length, 'unveränderte Fahrten auf fehlende Kalender-Einträge...');
      for (const ride of unchangedRides) {
        let startTime;
        if (ride.pickupTimestamp) {
          startTime = new Date(ride.pickupTimestamp);
        } else if (ride.pickupDate && ride.pickupTime) {
          startTime = new Date(ride.pickupDate + 'T' + ride.pickupTime + ':00');
        }
        if (!startTime || isNaN(startTime.getTime())) continue;

        const existing = findExistingEvent(calendar, ride.firebaseId, startTime);
        if (!existing) {
          missingRides.push(ride);
          console.log('📌 Fehlender Eintrag gefunden:', ride.firebaseId);
        }
      }
      console.log('📌 Fehlende Kalender-Einträge:', missingRides.length);
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

    // Entferne alte/stornierte (immer prüfen!)
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
      startTime = new Date(ride.pickupTimestamp);
    } else if (ride.pickupDate && ride.pickupTime) {
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

    const durationMinutes = ride.duration || 30;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    const vehicleName = ride.vehicleLabel || ride.vehicle || ride.assignedVehicle || ride.assignedDriver || '';
    const vehiclePlate = ride.vehiclePlate ? ` (${ride.vehiclePlate})` : '';
    const vehicleDisplay = vehicleName ? vehicleName + vehiclePlate : '';

    let titleParts = [];

    titleParts.push(`🚕 ${ride.pickup || 'Unbekannt'} → ${ride.destination || 'Unbekannt'}`);

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

    const existingEvent = findExistingEvent(calendar, ride.firebaseId, startTime);

    if (existingEvent) {
      existingEvent.setTitle(title);
      existingEvent.setDescription(description);
      existingEvent.setTime(startTime, endTime);
      existingEvent.setLocation(ride.pickup || '');
      existingEvent.setColor(CONFIG.EVENT_COLOR);

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
    lines.push('📍 Von: ' + (ride.pickup || '-'));
  }
  if (EXPORT_SETTINGS.showDestination) {
    lines.push('🎯 Nach: ' + (ride.destination || '-'));
  }

  lines.push('');

  if (EXPORT_SETTINGS.showPrice && ride.price) {
    lines.push('💰 Preis: ' + ride.price + '€');
  }
  if (EXPORT_SETTINGS.showDistance && ride.distance) {
    lines.push('📏 Distanz: ' + ride.distance + ' km');
  }
  lines.push('⏱️ Dauer: ~' + (ride.duration || '?') + ' Min');
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
  lines.push('📝 Erstellt von: CalendarSync v4.1 (Vollständige Sync)');
  lines.push('🖥️ Script-Account: ' + Session.getActiveUser().getEmail());
  lines.push('⏰ Sync-Zeit: ' + new Date().toLocaleString('de-DE'));
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}
// ═══════════════════════════════════════════════════════════════
// 🔍 EXISTIERENDES EVENT FINDEN
// ═══════════════════════════════════════════════════════════════
function findExistingEvent(calendar, firebaseId, startTime) {
  const dayStart = new Date(startTime);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startTime);
  dayEnd.setHours(23, 59, 59, 999);

  const events = calendar.getEvents(dayStart, dayEnd);
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
    console.log('⚠️ Duplikate gefunden für: ' + firebaseId);
    for (let i = 1; i < matchingEvents.length; i++) {
      console.log('🗑️ Lösche Duplikat #' + (i+1));
      matchingEvents[i].deleteEvent();
    }
  }

  return matchingEvents.length > 0 ? matchingEvents[0] : null;
}
// ═══════════════════════════════════════════════════════════════
// 🗑️ ALTE & STORNIERTE EVENTS ENTFERNEN
// 🔧 v4.0: MIT SICHERHEITSCHECKS!
// ═══════════════════════════════════════════════════════════════
function removeOldEvents(calendar, currentRides) {
  // 🔧 v4.0: SICHERHEITSCHECK #1 - Niemals bei leeren Daten löschen!
  if (!currentRides || currentRides.length === 0) {
    console.log('⚠️ SICHERHEITSCHECK: Keine Rides vorhanden - überspringe Löschung!');
    console.log('⚠️ Dies verhindert versehentliches Massen-Löschen bei Firebase-Fehlern');
    return 0;
  }

  // 🔧 v4.0: SICHERHEITSCHECK #2 - Minimum-Anzahl prüfen
  if (currentRides.length < 10) {
    console.log('⚠️ WARNUNG: Nur ' + currentRides.length + ' Rides in Firebase (erwartet: >100)');
    console.log('⚠️ Möglicher partieller Datenverlust - Löschung wird trotzdem ausgeführt');
    // Trotzdem fortfahren, aber warnen
  }

  const currentIds = new Set(currentRides.map(r => r.firebaseId));

  // 🔧 v4.0: Auch 'deleted' als storniert behandeln
  const cancelledIds = new Set(
    currentRides
      .filter(r => ['storniert', 'cancelled', 'deleted'].includes(r.status))
      .map(r => r.firebaseId)
  );

  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 3600000);
  const events = calendar.getEvents(now, future);

  let removed = 0;

  const eventsByFirebaseId = new Map();

  events.forEach(event => {
    const title = event.getTitle();
    if (!title || !title.startsWith('🚕')) return;

    const description = event.getDescription() || '';
    const match = description.match(/🆔 Firebase ID: ([^\s\n]+)/);
    const firebaseId = match ? match[1] : null;

    if (firebaseId) {
      if (!eventsByFirebaseId.has(firebaseId)) {
        eventsByFirebaseId.set(firebaseId, []);
      }
      eventsByFirebaseId.get(firebaseId).push(event);
    }
  });

  eventsByFirebaseId.forEach((eventsWithSameId, firebaseId) => {
    if (eventsWithSameId.length > 1) {
      console.log('🔍 Duplikate für ' + firebaseId + ': ' + eventsWithSameId.length);
      for (let i = 1; i < eventsWithSameId.length; i++) {
        eventsWithSameId[i].deleteEvent();
        removed++;
        console.log('🗑️ Duplikat entfernt');
      }
    }
  });

  events.forEach(event => {
    const title = event.getTitle();
    if (!title || !title.startsWith('🚕')) return;

    const firebaseId = event.getTag('firebaseId');
    let shouldDelete = false;

    if (!firebaseId) {
      const description = event.getDescription();
      const match = description ? description.match(/🆔 Firebase ID: (.+)/) : null;
      const extractedId = match ? match[1].trim() : null;

      if (!extractedId) return;

      // 🔧 v4.0: NUR stornierte löschen, NICHT "nicht mehr vorhanden"
      // Grund: Bei Firebase-Fehlern könnten Rides temporär fehlen
      if (cancelledIds.has(extractedId)) {
        shouldDelete = true;
      }
    } else {
      // 🔧 v4.0: NUR stornierte löschen
      if (cancelledIds.has(firebaseId)) {
        shouldDelete = true;
      }
    }

    if (shouldDelete) {
      event.deleteEvent();
      removed++;
      console.log('🗑️ Entfernt (storniert):', title.substring(0, 50) + '...');
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
  console.log('🧪 TEST-MODUS v4.1 - VOLLSTÄNDIGE SYNC');
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
