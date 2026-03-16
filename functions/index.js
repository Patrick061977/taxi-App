/**
 * Firebase Cloud Function: Telegram Bot Webhook Handler
 * Funk Taxi Heringsdorf - 24/7 Telegram Bot
 *
 * Ersetzt das browser-basierte Polling durch einen serverseitigen Webhook.
 * Der Bot antwortet jetzt auch wenn kein Browser-Tab offen ist.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueCreated, onValueUpdated, onValueDeleted } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();

// 🔧 v6.21.0: Stripe SDK (lazy-init mit Secret Key aus Firebase)
let stripeInstance = null;
async function getStripe() {
    if (stripeInstance) return stripeInstance;
    const snap = await db.ref('settings/stripe').once('value');
    const cfg = snap.val();
    if (!cfg || !cfg.secretKey) throw new Error('Stripe Secret Key nicht konfiguriert');
    const Stripe = require('stripe');
    stripeInstance = new Stripe(cfg.secretKey);
    return stripeInstance;
}

// ═══════════════════════════════════════════════════════════════
// KONSTANTEN
// ═══════════════════════════════════════════════════════════════

// 🔧 v6.14.6: Mobilnummer-Erkennung (DE/AT/CH) — gleiche Logik wie index.html
function isMobileNumber(phone) {
    if (!phone) return false;
    const n = String(phone).replace(/[\s\-\/\(\)]/g, '');
    if (/^\+49(1[567])/.test(n)) return true;   // DE: +4915x, +4916x, +4917x
    if (/^\+43(6)/.test(n)) return true;         // AT: +436xx
    if (/^\+41(7[5-9])/.test(n)) return true;    // CH: +417x
    if (/^\+491/.test(n)) return true;            // DE allgemein
    // Ohne Vorwahl (lokales Format)
    if (/^(0049|0)?1[567]\d/.test(n)) return true;
    return false;
}

// 🆕 v6.25.1: Telefonnummer-Validierung — prüft Länge und Format
function validatePhoneNumber(phone) {
    if (!phone) return { valid: false, warning: 'Keine Nummer' };
    const clean = String(phone).replace(/[\s\-\/\(\)]/g, '');
    const digits = clean.replace(/[^\d]/g, '');

    if (clean.startsWith('+49') || clean.startsWith('0049')) {
        const national = clean.startsWith('+49') ? digits.substring(2) : digits.substring(4);
        const isMobil = /^1[567]\d/.test(national);
        if (isMobil) {
            if (national.length < 10) return { valid: false, warning: `Mobilnummer zu kurz (${national.length} Ziffern nach +49, erwartet 10-11)` };
            if (national.length > 11) return { valid: false, warning: `Mobilnummer zu lang (${national.length} Ziffern nach +49, erwartet 10-11)` };
        } else {
            if (national.length < 6) return { valid: false, warning: `Festnetznummer zu kurz (${national.length} Ziffern)` };
            if (national.length > 11) return { valid: false, warning: `Festnetznummer zu lang (${national.length} Ziffern)` };
        }
        return { valid: true };
    }
    if (clean.startsWith('0') && !clean.startsWith('00')) {
        // Lokales deutsches Format
        if (digits.length < 7) return { valid: false, warning: `Nummer zu kurz (${digits.length} Ziffern)` };
        if (digits.length > 12) return { valid: false, warning: `Nummer zu lang (${digits.length} Ziffern)` };
        return { valid: true };
    }
    // International
    if (digits.length < 7) return { valid: false, warning: `Nummer zu kurz (${digits.length} Ziffern)` };
    if (digits.length > 15) return { valid: false, warning: `Nummer zu lang (${digits.length} Ziffern)` };
    return { valid: true };
}

// 🔧 v6.15.9: Robuste JSON-Extraktion aus KI-Antworten
// Die KI schreibt manchmal Text vor/nach dem JSON — dieses Hilfsmittel extrahiert nur den JSON-Teil
function extractJsonFromAiResponse(text) {
    // Erst Markdown-Code-Blöcke entfernen
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    // Versuche direktes Parsing
    try { return JSON.parse(cleaned); } catch(e) { /* weiter */ }
    // Suche erstes { und letztes } — extrahiere den JSON-Block
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1);
        try { return JSON.parse(jsonCandidate); } catch(e) { /* weiter */ }
    }
    // Letzter Versuch: Alles nach dem JSON-Block abschneiden (z.B. Erklärungstext)
    // Finde die erste Zeile die mit { beginnt
    const lines = cleaned.split('\n');
    let jsonLines = [];
    let inJson = false;
    let braceCount = 0;
    for (const line of lines) {
        if (!inJson && line.trim().startsWith('{')) inJson = true;
        if (inJson) {
            jsonLines.push(line);
            braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
            if (braceCount <= 0) break;
        }
    }
    if (jsonLines.length > 0) {
        try { return JSON.parse(jsonLines.join('\n')); } catch(e) { /* aufgeben */ }
    }
    // Nichts hat funktioniert → Originalfehler werfen
    return JSON.parse(cleaned);
}

// 🧠 v6.15.8: KI-Trainings-Regeln aus Firebase laden
// Gespeichert unter settings/aiRules als Array von { rule, createdAt, createdBy }
async function loadAiRules() {
    try {
        const snap = await db.ref('settings/aiRules').once('value');
        if (!snap.exists()) return '';
        const rules = snap.val();
        const ruleList = Object.values(rules)
            .filter(r => r && r.rule)
            .map((r, i) => `${i + 1}. ${r.rule}`)
            .join('\n');
        if (!ruleList) return '';
        return `\n━━━ GELERNTE REGELN (Admin-definiert) ━━━\n${ruleList}\n`;
    } catch (e) {
        console.warn('AI-Regeln laden fehlgeschlagen:', e.message);
        return '';
    }
}

// 🛡️ SPAM-SCHUTZ: Nachrichten pro Minute
const SPAM_WARN_THRESHOLD = 40;    // Ab 40/Min → Warnung
const SPAM_MAX_MESSAGES = 60;      // Ab 60/Min → Sperre
const SPAM_WINDOW_MS = 60 * 1000;  // Zeitfenster: 60 Sekunden
const SPAM_COOLDOWN_MS = 3 * 60 * 1000; // 3 Min Sperre
const SPAM_MAX_STRIKES = 3;        // 3× Sperre → dauerhafter Block
const spamTracker = {}; // { chatId: { timestamps: [], blocked: false, blockedUntil: 0, warned: false, strikes: 0, permBlocked: false } }

function checkSpam(chatId) {
    const now = Date.now();
    if (!spamTracker[chatId]) {
        spamTracker[chatId] = { timestamps: [], blocked: false, blockedUntil: 0, warned: false, strikes: 0, permBlocked: false };
    }
    const tracker = spamTracker[chatId];

    // Dauerhaft geblockt? → Nur Admin kann das aufheben (in Firebase)
    if (tracker.permBlocked) {
        return 'permblocked';
    }

    // Temporäre Sperre aktiv?
    if (tracker.blocked && now < tracker.blockedUntil) {
        return 'blocked';
    }
    // Sperre abgelaufen → zurücksetzen
    if (tracker.blocked && now >= tracker.blockedUntil) {
        tracker.blocked = false;
        tracker.warned = false;
        tracker.timestamps = [];
    }

    // Alte Timestamps entfernen (außerhalb des Zeitfensters)
    tracker.timestamps = tracker.timestamps.filter(t => now - t < SPAM_WINDOW_MS);
    tracker.timestamps.push(now);

    // Spam erkannt?
    if (tracker.timestamps.length > SPAM_MAX_MESSAGES) {
        tracker.strikes++;
        tracker.blocked = true;
        tracker.blockedUntil = now + SPAM_COOLDOWN_MS;

        // 3. Strike → dauerhaft blocken
        if (tracker.strikes >= SPAM_MAX_STRIKES) {
            tracker.permBlocked = true;
            return 'permblock_new';
        }
        return 'spam';
    }

    // Warnung ab 40 Nachrichten/Min
    if (tracker.timestamps.length >= SPAM_WARN_THRESHOLD && !tracker.warned) {
        tracker.warned = true;
        return 'warning';
    }

    return 'ok';
}

// Speicher alle 10 Minuten aufräumen (verhindert Memory-Leak bei Cloud Functions)
setInterval(() => {
    const now = Date.now();
    for (const chatId of Object.keys(spamTracker)) {
        if (now - (spamTracker[chatId].blockedUntil || 0) > 600000 &&
            (spamTracker[chatId].timestamps.length === 0 ||
             now - spamTracker[chatId].timestamps[spamTracker[chatId].timestamps.length - 1] > 600000)) {
            delete spamTracker[chatId];
        }
    }
}, 600000);

// Standard-Tarif (wird beim Start aus Firebase überschrieben falls vorhanden)
const TARIF = {
    grundgebuehr: 4.00,
    km_1_2: 3.30, km_3_4: 2.80, km_ab_5: 2.20,
    nacht_grundgebuehr: 5.50,
    nacht_km_1_2: 3.30, nacht_km_3_4: 2.80, nacht_km_ab_5: 2.40
};
let tarifLoaded = false;

async function loadTarifFromFirebase() {
    if (tarifLoaded) return;
    try {
        const snap = await db.ref('settings/tarif').once('value');
        const saved = snap.val();
        if (saved) {
            Object.keys(TARIF).forEach(k => {
                if (saved[k] !== undefined) TARIF[k] = parseFloat(saved[k]);
            });
            console.log('[Tarif] Aus Firebase geladen:', TARIF);
        }
        tarifLoaded = true;
    } catch (e) {
        console.warn('[Tarif] Firebase-Fehler, nutze Standard:', e.message);
    }
}

const FEIERTAGE = ['01-01','05-01','10-03','12-24','12-25','12-26','12-31'];

const OFFICIAL_VEHICLES = {
    'pw-my-222-e': { name: 'Tesla Model Y', plate: 'PW-MY 222 E', capacity: 4, priority: 1 },
    'pw-ik-222': { name: 'Toyota Prius IK', plate: 'PW-IK 222', capacity: 4, priority: 2 },
    'pw-ki-222': { name: 'Toyota Prius II', plate: 'PW-KI 222', capacity: 4, priority: 3 },
    'pw-sk-222': { name: 'Renault Traffic 8 Pax', plate: 'PW-SK 222', capacity: 8, priority: 4 },
    'vg-lk-111': { name: 'Mercedes Vito 8 Pax', plate: 'VG-LK 111', capacity: 8, priority: 5 }
};

// ═══════════════════════════════════════════════════════════════
// 🆕 v6.15.1: AUTO-ZUWEISUNG FÜR TELEGRAM-SOFORTFAHRTEN
// Läuft server-seitig → funktioniert 24/7 ohne Browser!
// ═══════════════════════════════════════════════════════════════

function gpsDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isVehicleInShift(vehicleId, shiftsData, dateStr, timeStr) {
    const shifts = shiftsData[vehicleId];
    if (!shifts) return Object.keys(shiftsData).length === 0;

    // Tag aktiv?
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    if (shifts[dateStr] !== undefined) {
        if (shifts[dateStr].active === false) return false;
    } else {
        const defaults = shifts.defaults || { 0:false, 1:true, 2:true, 3:true, 4:true, 5:true, 6:false };
        if (defaults[dow] !== true) return false;
    }

    // Schichtzeiten ermitteln
    let times = null;
    const dayEntry = shifts[dateStr];
    if (dayEntry && (dayEntry.startTime || dayEntry.endTime)) {
        const defaultEntry = (shifts.defaultTimes || {})[dow] || null;
        if (dayEntry.additiveException) {
            // 🔧 v6.15.10: KEIN Fallback auf 06:00-22:00!
            // Wochenplan (defaultTimes) ist Gesetz – ohne eingetragene Zeiten = kein Standard-Block
            const _effDefault = defaultEntry;
            if (_effDefault) {
                const defRanges = (_effDefault.timeRanges && _effDefault.timeRanges.length > 1)
                    ? _effDefault.timeRanges
                    : [{ startTime: _effDefault.startTime, endTime: _effDefault.endTime }];
                const exRanges = (dayEntry.timeRanges && dayEntry.timeRanges.length >= 1)
                    ? dayEntry.timeRanges
                    : [{ startTime: dayEntry.startTime, endTime: dayEntry.endTime }];
                times = { timeRanges: [...defRanges, ...exRanges] };
            } else {
                // Kein Standard und kein aktiver Wochentag → nur Exception-Zeiten
                times = { startTime: dayEntry.startTime || '00:00', endTime: dayEntry.endTime || '23:59' };
                if (dayEntry.timeRanges && dayEntry.timeRanges.length > 1) times.timeRanges = dayEntry.timeRanges;
            }
        } else {
            times = { startTime: dayEntry.startTime || '00:00', endTime: dayEntry.endTime || '23:59' };
            if (dayEntry.timeRanges && dayEntry.timeRanges.length > 1) times.timeRanges = dayEntry.timeRanges;
        }
    } else {
        const defaultEntry = (shifts.defaultTimes || {})[dow];
        if (defaultEntry) {
            times = { startTime: defaultEntry.startTime || '00:00', endTime: defaultEntry.endTime || '23:59' };
            if (defaultEntry.timeRanges && defaultEntry.timeRanges.length > 1) times.timeRanges = defaultEntry.timeRanges;
        }
    }

    if (!times) return Object.keys(shiftsData).length === 0;
    if (!timeStr) return true;

    if (times.timeRanges && times.timeRanges.length > 1) {
        return times.timeRanges.some(r => timeStr >= r.startTime && timeStr <= r.endTime);
    }
    return timeStr >= times.startTime && timeStr <= times.endTime;
}

async function autoAssignRide(rideId, rideData) {
    console.log('🎯 v6.15.1: Cloud-AutoAssign für Fahrt:', rideId);
    try {
        const [vehiclesSnap, shiftsSnap, ridesSnap] = await Promise.all([
            db.ref('vehicles').once('value'),
            db.ref('vehicleShifts').once('value'),
            db.ref('rides').once('value')
        ]);
        const vehicles = vehiclesSnap.val() || {};
        const shiftsData = shiftsSnap.val() || {};
        const allRides = [];
        ridesSnap.forEach(c => allRides.push({ ...c.val(), firebaseId: c.key }));

        // 🔧 v6.15.10: Zwei Modi — Sofortfahrt (GPS first) vs. Vorbestellung (Schichtplan/Priorität)
        const now = new Date();
        const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
        const minutesUntilPickup = rideData.pickupTimestamp ? (rideData.pickupTimestamp - Date.now()) / 60000 : 0;
        const isSofort = minutesUntilPickup <= 60;

        // 🔧 v6.25.4: Schicht-Check IMMER gegen Abholzeit prüfen, nicht aktuelle Uhrzeit!
        // Vorher: Sofortfahrten nutzten berlin (aktuelle Uhrzeit) → Fahrzeug bekam Fahrt außerhalb seiner Schicht
        const pickupDate = rideData.pickupTimestamp
            ? new Date(new Date(rideData.pickupTimestamp).toLocaleString('en-US', { timeZone: 'Europe/Berlin' }))
            : berlin;
        const dateStr = pickupDate.getFullYear() + '-' + String(pickupDate.getMonth()+1).padStart(2,'0') + '-' + String(pickupDate.getDate()).padStart(2,'0');
        const timeStr = String(pickupDate.getHours()).padStart(2,'0') + ':' + String(pickupDate.getMinutes()).padStart(2,'0');
        const MAX_GPS_AGE = 10 * 60 * 1000;
        const dow = pickupDate.getDay();
        const passengers = rideData.passengers || 1;
        const candidates = [];

        console.log(`🎯 Modus: ${isSofort ? 'SOFORTFAHRT (GPS schlägt alles)' : 'VORBESTELLUNG (Schichtplan + Priorität)'} | Abholzeit: ${dateStr} ${timeStr}`);

        for (const [vehicleId, info] of Object.entries(OFFICIAL_VEHICLES)) {
            if (info.capacity < passengers) continue;
            if (!isVehicleInShift(vehicleId, shiftsData, dateStr, timeStr)) {
                console.log(`   ❌ ${info.name}: Kein Dienst am ${dateStr} um ${timeStr}`);
                continue;
            }

            // Besetzt-Check: Fahrzeug gerade aktiv unterwegs?
            const busy = allRides.some(r =>
                (r.vehicleId === vehicleId || r.assignedTo === vehicleId || r.assignedVehicle === vehicleId) &&
                (r.status === 'on_way' || r.status === 'picked_up')
            );
            if (busy && isSofort) { console.log(`   ❌ ${info.name}: Aktuell besetzt`); continue; }

            // Zeitkonflikt mit bestehenden Fahrten prüfen
            if (rideData.pickupTimestamp) {
                const newPickup = rideData.pickupTimestamp;
                const newDur = (rideData.duration || rideData.estimatedDuration || 20) * 60000;
                const bufferMs = 4 * 60000;
                const hasTimeConflict = allRides.some(r => {
                    if (r.firebaseId === rideId) return false;
                    if (r.vehicleId !== vehicleId && r.assignedTo !== vehicleId && r.assignedVehicle !== vehicleId) return false;
                    if (!r.pickupTimestamp) return false;
                    if (['deleted','cancelled','storniert','cancelled_pending_driver','completed'].includes(r.status)) return false;
                    const rDur = (r.duration || r.estimatedDuration || 20) * 60000;
                    const rStart = r.pickupTimestamp;
                    const rEnd = rStart + rDur + bufferMs;
                    const newEnd = newPickup + newDur + bufferMs;
                    return (newPickup < rEnd) && (rStart < newEnd);
                });
                if (hasTimeConflict) {
                    console.log(`   ⚠️ ${info.name}: Zeitkonflikt → übersprungen`);
                    continue;
                }
            }

            const driver = vehicles[vehicleId];

            if (isSofort) {
                // ═══ SOFORTFAHRT: GPS schlägt alles ═══
                let vLat = null, vLon = null, posSource = '';

                // 1. Aktives GPS (< 10 Min)
                if (driver && driver.lat && driver.lon && driver.timestamp && (Date.now() - driver.timestamp <= MAX_GPS_AGE)) {
                    vLat = driver.lat; vLon = driver.lon; posSource = 'GPS';
                } else {
                    // 2. Heimatstandort aus Schichtplan
                    const vShift = shiftsData[vehicleId];
                    if (vShift) {
                        const defTimes = vShift.defaultTimes || {};
                        const dayEntry = vShift[dateStr];
                        const homeCoords = (dayEntry && dayEntry.homeCoords) || (defTimes[dow] && defTimes[dow].homeCoords) || null;
                        if (homeCoords && homeCoords.lat && homeCoords.lon) {
                            vLat = homeCoords.lat; vLon = homeCoords.lon; posSource = 'Schichtplan-Home';
                        }
                    }
                    // 3. Letzter bekannter GPS-Standort
                    if (!vLat && driver && driver.lat && driver.lon) {
                        vLat = driver.lat; vLon = driver.lon; posSource = 'Letzter-GPS';
                    }
                }

                if (rideData.pickupCoords && vLat && vLon) {
                    const dist = gpsDistanceKm(rideData.pickupCoords.lat, rideData.pickupCoords.lon, vLat, vLon);
                    candidates.push({ vehicleId, name: info.name, distance: dist, priority: info.priority, telegramChatId: driver?.telegramChatId, posSource });
                    console.log(`   ✅ ${info.name}: ${dist.toFixed(1)} km (${posSource})`);
                } else {
                    // Kein Standort → trotzdem aufnehmen, nach Priorität
                    candidates.push({ vehicleId, name: info.name, distance: 999, priority: info.priority, telegramChatId: driver?.telegramChatId, posSource: posSource || 'kein-Standort' });
                    console.log(`   ⚠️ ${info.name}: Kein Standort → Priorität ${info.priority}`);
                }
            } else {
                // ═══ VORBESTELLUNG: Schichtplan + Priorität ═══
                candidates.push({ vehicleId, name: info.name, distance: 0, priority: info.priority, telegramChatId: driver?.telegramChatId, posSource: 'Schichtplan' });
                console.log(`   ✅ ${info.name}: Im Dienst, Prio ${info.priority}`);
            }
        }

        if (candidates.length === 0) {
            console.log('⚠️ Kein Fahrzeug verfügbar für ' + (isSofort ? 'Sofortfahrt' : 'Vorbestellung'));
            return null;
        }

        if (isSofort) {
            candidates.sort((a, b) => a.distance - b.distance || a.priority - b.priority);
        } else {
            candidates.sort((a, b) => a.priority - b.priority);
        }
        const best = candidates[0];
        const drivingTimeMin = isSofort ? Math.max(3, Math.round((best.distance / 40) * 60)) : 0;

        // Status: Sofortfahrt → assigned, Vorbestellung → vorbestellt (mit zugewiesenem Fahrzeug)
        const rideUpdate = {
            status: isSofort ? 'assigned' : 'vorbestellt',
            assignedTo: best.vehicleId,
            vehicleId: best.vehicleId,
            vehicle: best.name,
            vehicleLabel: best.name,
            assignedVehicleName: best.name,
            assignedVehicle: best.vehicleId,
            assignedAt: Date.now(),
            assignedBy: 'cloud-auto-assign',
            updatedAt: Date.now()
        };
        if (isSofort) {
            rideUpdate.assignmentDistance = best.distance;
            rideUpdate.drivingTimeToPickup = drivingTimeMin;
            rideUpdate.estimatedArrivalAt = Date.now() + (drivingTimeMin * 60000);
            rideUpdate.assignmentExpiresAt = Date.now() + 60000;
        }
        await db.ref('rides/' + rideId).update(rideUpdate);

        console.log(`✅ ${rideId} → ${best.name} (${isSofort ? best.distance.toFixed(1) + ' km, ~' + drivingTimeMin + ' Min' : 'Prio ' + best.priority}) [${isSofort ? 'Sofort' : 'Vorbestellung'}]`);

        // Fahrer per Telegram benachrichtigen
        if (best.telegramChatId) {
            const pickupLabel = rideData.pickupTime || (isSofort ? 'Sofort' : timeStr + ' Uhr');
            await sendTelegramMessage(best.telegramChatId,
                `🚕 <b>${isSofort ? 'NEUE FAHRT!' : '📅 NEUE VORBESTELLUNG!'}</b>\n\n` +
                `📍 <b>Von:</b> ${rideData.pickup}\n` +
                `🎯 <b>Nach:</b> ${rideData.destination}\n` +
                `👤 <b>Kunde:</b> ${rideData.customerName}\n` +
                (rideData.customerPhone ? `📱 <b>Tel:</b> ${rideData.customerPhone}\n` : '') +
                `🕐 <b>Abholung:</b> ${pickupLabel}\n` +
                (isSofort ? `🚗 <b>Anfahrt:</b> ~${drivingTimeMin} Min (${best.distance.toFixed(1)} km)\n\n` : '\n') +
                (isSofort ? `⏱️ <i>60 Sek zum Annehmen</i>` : `💡 <i>Fahrt vorgemerkt für ${pickupLabel}</i>`)
            );
        }

        best.drivingTimeMin = drivingTimeMin;
        return best;
    } catch (err) {
        console.error('❌ v6.15.1: AutoAssign Fehler:', err);
        return null;
    }
}

// 🔧 v6.20.2: Wartezeit schätzen wenn alle Fahrer besetzt sind
async function estimateWaitTime(pickupCoords) {
    try {
        const [vehiclesSnap, ridesSnap] = await Promise.all([
            db.ref('vehicles').once('value'),
            db.ref('rides').once('value')
        ]);
        const vehicles = vehiclesSnap.val() || {};
        const activeRides = [];
        ridesSnap.forEach(c => {
            const r = c.val();
            if (r.status === 'on_way' || r.status === 'picked_up' || r.status === 'assigned') {
                activeRides.push(r);
            }
        });

        if (activeRides.length === 0) return { waitMin: 0, busyCount: 0 };

        // Kürzeste verbleibende Fahrzeit aller aktiven Fahrten schätzen
        let shortestRemaining = Infinity;
        const now = Date.now();

        for (const ride of activeRides) {
            let remainingMin;
            if (ride.status === 'assigned' || ride.status === 'on_way') {
                // Noch nicht abgeholt → Anfahrt + Fahrzeit
                const estDuration = ride.duration || ride.estimatedDuration || 20;
                const startedAt = ride.assignedAt || ride.pickupTimestamp || now;
                const elapsed = (now - startedAt) / 60000;
                remainingMin = Math.max(5, estDuration - elapsed + 5); // +5 Min Rückfahrt-Puffer
            } else if (ride.status === 'picked_up') {
                // Unterwegs → nur restliche Fahrzeit
                const estDuration = ride.duration || ride.estimatedDuration || 20;
                const pickedUpAt = ride.pickedUpAt || ride.assignedAt || now;
                const elapsed = (now - pickedUpAt) / 60000;
                remainingMin = Math.max(3, estDuration - elapsed + 5);
            } else {
                remainingMin = 20;
            }
            if (remainingMin < shortestRemaining) shortestRemaining = remainingMin;
        }

        // Zusätzliche Anfahrt zum neuen Kunden schätzen (~10 Min Durchschnitt auf Usedom)
        const totalWait = Math.round(shortestRemaining + 10);
        // Auf 5er-Schritte runden und Bereich angeben
        const waitMin = Math.max(10, Math.ceil(totalWait / 5) * 5);
        const waitMax = waitMin + 10;

        return { waitMin, waitMax, busyCount: activeRides.length };
    } catch (e) {
        console.error('[WaitEstimate] Fehler:', e.message);
        return { waitMin: 20, waitMax: 30, busyCount: 0 };
    }
}

// 🆕 v6.11.4: KNOWN_PLACES synchronisiert mit index.html (vollständige Liste)
const KNOWN_PLACES = {
    // Usedom Orte
    'heringsdorf': { lat: 53.9533, lon: 14.1633, name: 'Heringsdorf' },
    'ahlbeck': { lat: 53.9444, lon: 14.1933, name: 'Ahlbeck' },
    'bansin': { lat: 53.9633, lon: 14.1433, name: 'Bansin' },
    'zinnowitz': { lat: 54.0908, lon: 13.9167, name: 'Zinnowitz' },
    'ückeritz': { lat: 53.9878, lon: 14.0519, name: 'Ückeritz' },
    'loddin': { lat: 54.0083, lon: 13.9917, name: 'Loddin' },
    'zempin': { lat: 54.0194, lon: 13.9611, name: 'Zempin' },
    'koserow': { lat: 54.0681, lon: 13.9764, name: 'Koserow' },
    'karlshagen': { lat: 54.1078, lon: 13.8333, name: 'Karlshagen' },
    'peenemünde': { lat: 54.1422, lon: 13.7753, name: 'Peenemünde' },
    'trassenheide': { lat: 54.0997, lon: 13.8875, name: 'Trassenheide' },
    'usedom': { lat: 53.9533, lon: 14.1633, name: 'Usedom' },
    // Seebrücken (mit Adresse)
    'seebrücke ahlbeck': { lat: 53.9375, lon: 14.1983, name: 'Seebrücke Ahlbeck, Dünenstraße, 17419 Ahlbeck' },
    'seebrücke bansin': { lat: 53.9652, lon: 14.1350, name: 'Seebrücke Bansin, Bergstraße, 17429 Bansin' },
    'seebrücke heringsdorf': { lat: 53.9504, lon: 14.1656, name: 'Seebrücke Heringsdorf, Strandpromenade, 17424 Heringsdorf' },
    'seebrücke zinnowitz': { lat: 54.0747, lon: 13.9130, name: 'Seebrücke Zinnowitz, Strandpromenade, 17454 Zinnowitz' },
    'seebrücke koserow': { lat: 54.0536, lon: 13.9792, name: 'Seebrücke Koserow, Am Strande, 17459 Koserow' },
    // Polen
    'swinemünde': { lat: 53.9108, lon: 14.2482, name: 'Swinemünde' },
    'swinemunde': { lat: 53.9108, lon: 14.2482, name: 'Swinemünde' },
    'świnoujście': { lat: 53.9108, lon: 14.2482, name: 'Świnoujście' },
    'swinoujscie': { lat: 53.9108, lon: 14.2482, name: 'Świnoujście' },
    'misdroy': { lat: 53.9283, lon: 14.4017, name: 'Misdroy' },
    'międzyzdroje': { lat: 53.9283, lon: 14.4017, name: 'Międzyzdroje' },
    'miedzyzdroje': { lat: 53.9283, lon: 14.4017, name: 'Międzyzdroje' },
    'wollin': { lat: 53.8406, lon: 14.6175, name: 'Wollin' },
    'wolin': { lat: 53.8406, lon: 14.6175, name: 'Wolin' },
    'stettin': { lat: 53.4285, lon: 14.5528, name: 'Stettin' },
    'szczecin': { lat: 53.4285, lon: 14.5528, name: 'Szczecin' },
    'kolberg': { lat: 54.1756, lon: 15.5831, name: 'Kolberg' },
    'kołobrzeg': { lat: 54.1756, lon: 15.5831, name: 'Kołobrzeg' },
    'kolobrzeg': { lat: 54.1756, lon: 15.5831, name: 'Kołobrzeg' },
    // Bahnhöfe (alle Varianten)
    'bahnhof heringsdorf': { lat: 53.9492, lon: 14.1700, name: 'Bahnhof Heringsdorf, Bahnhofstraße 2, 17424 Heringsdorf' },
    'heringsdorf bahnhof': { lat: 53.9492, lon: 14.1700, name: 'Bahnhof Heringsdorf, Bahnhofstraße 2, 17424 Heringsdorf' },
    'bahnhof ahlbeck': { lat: 53.9356, lon: 14.1878, name: 'Bahnhof Ahlbeck, Bahnhofstraße 5, 17419 Ahlbeck' },
    'ahlbeck bahnhof': { lat: 53.9356, lon: 14.1878, name: 'Bahnhof Ahlbeck, Bahnhofstraße 5, 17419 Ahlbeck' },
    'bahnhof bansin': { lat: 53.9644, lon: 14.1293, name: 'Bahnhof Bansin, Bahnhofstraße 3, 17429 Bansin' },
    'bansin bahnhof': { lat: 53.9644, lon: 14.1293, name: 'Bahnhof Bansin, Bahnhofstraße 3, 17429 Bansin' },
    'bahnhof zinnowitz': { lat: 54.0758, lon: 13.9028, name: 'Bahnhof Zinnowitz, Bahnhofstraße 40, 17454 Zinnowitz' },
    'zinnowitz bahnhof': { lat: 54.0758, lon: 13.9028, name: 'Bahnhof Zinnowitz, Bahnhofstraße 40, 17454 Zinnowitz' },
    'bahnhof koserow': { lat: 54.0681, lon: 13.9764, name: 'Bahnhof Koserow, 17459 Koserow' },
    'koserow bahnhof': { lat: 54.0681, lon: 13.9764, name: 'Bahnhof Koserow, 17459 Koserow' },
    'bahnhof zempin': { lat: 54.0194, lon: 13.9611, name: 'Bahnhof Zempin, 17459 Zempin' },
    'bahnhof ückeritz': { lat: 53.9878, lon: 14.0519, name: 'Bahnhof Ückeritz, 17459 Ückeritz' },
    'bahnhof karlshagen': { lat: 54.1078, lon: 13.8333, name: 'Bahnhof Karlshagen, 17449 Karlshagen' },
    'bahnhof wolgast': { lat: 54.0525, lon: 13.7619, name: 'Bahnhof Wolgast, 17438 Wolgast' },
    'wolgast bahnhof': { lat: 54.0525, lon: 13.7619, name: 'Bahnhof Wolgast, 17438 Wolgast' },
    'bahnhof greifswald': { lat: 54.0939, lon: 13.3878, name: 'Bahnhof Greifswald, Bahnhofsstraße 1, 17489 Greifswald' },
    'bahnhof anklam': { lat: 53.8549, lon: 13.6909, name: 'Bahnhof Anklam' },
    'züssow': { lat: 53.9224, lon: 13.5287, name: 'Bahnhof Züssow' },
    'bahnhof züssow': { lat: 53.9224, lon: 13.5287, name: 'Bahnhof Züssow' },
    // Flughäfen
    'flughafen heringsdorf': { lat: 53.8786, lon: 14.1525, name: 'Flughafen Heringsdorf (HDF), 17459 Peenemünde' },
    'flughafen hdf': { lat: 53.8786, lon: 14.1525, name: 'Flughafen Heringsdorf (HDF), 17459 Peenemünde' },
    'hdf': { lat: 53.8786, lon: 14.1525, name: 'Flughafen Heringsdorf (HDF), 17459 Peenemünde' },
    'airport heringsdorf': { lat: 53.8786, lon: 14.1525, name: 'Flughafen Heringsdorf (HDF), 17459 Peenemünde' },
    'ber': { lat: 52.3667, lon: 13.5033, name: 'Flughafen BER Berlin, 12529 Schönefeld' },
    'flughafen ber': { lat: 52.3667, lon: 13.5033, name: 'Flughafen BER Berlin, 12529 Schönefeld' },
    'flughafen berlin': { lat: 52.3667, lon: 13.5033, name: 'Flughafen BER Berlin, 12529 Schönefeld' },
    'berlin schönefeld': { lat: 52.3667, lon: 13.5033, name: 'Flughafen BER Berlin, 12529 Schönefeld' },
    // Fernziele + Kliniken
    'wolgast': { lat: 54.0525, lon: 13.7619, name: 'Wolgast' },
    'greifswald': { lat: 54.0939, lon: 13.3878, name: 'Greifswald' },
    'anklam': { lat: 53.8614, lon: 13.6908, name: 'Anklam' },
    'stralsund': { lat: 54.3130, lon: 13.0881, name: 'Stralsund' },
    'rostock': { lat: 54.0887, lon: 12.1404, name: 'Rostock' },
    'berlin': { lat: 52.5200, lon: 13.4050, name: 'Berlin' },
    'hamburg': { lat: 53.5753, lon: 10.0153, name: 'Hamburg' },
    'berlin hbf': { lat: 52.5251, lon: 13.3694, name: 'Bahnhof Berlin Hbf, Europaplatz 1, 10557 Berlin' },
    'bahnhof berlin': { lat: 52.5251, lon: 13.3694, name: 'Bahnhof Berlin Hbf, Europaplatz 1, 10557 Berlin' },
    'uni klinik greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'uniklinik greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'universitätsklinik greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'universitätsmedizin greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'krankenhaus greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'klinikum greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'fleischmannstraße greifswald': { lat: 54.0932, lon: 13.3851, name: 'Universitätsmedizin Greifswald, Fleischmannstraße 8, 17475 Greifswald' },
    'sauerbruchstraße greifswald': { lat: 54.0932, lon: 13.3840, name: 'Sauerbruchstraße, 17475 Greifswald' },
    'greifswald sauerbruchstraße': { lat: 54.0932, lon: 13.3840, name: 'Sauerbruchstraße, 17475 Greifswald' }
};

const PENDING_TIMEOUT_MS = 30 * 60 * 1000; // 30 Minuten

// Usedom-Region Bounding Box (großzügig: Usedom + Swinemünde + Wolgast + Anklam)
const USEDOM_BOUNDS = { minLat: 53.75, maxLat: 54.20, minLon: 13.60, maxLon: 14.45 };
function isNearUsedom(lat, lon) {
    return lat >= USEDOM_BOUNDS.minLat && lat <= USEDOM_BOUNDS.maxLat &&
           lon >= USEDOM_BOUNDS.minLon && lon <= USEDOM_BOUNDS.maxLon;
}

// 🔧 v6.25.4: PLZ-Zentren für Koordinaten-Plausibilitätsprüfung
// Wenn User PLZ angibt, müssen Ergebnisse in der Nähe des PLZ-Zentrums liegen
const PLZ_CENTERS = {
    '17424': { lat: 53.9533, lon: 14.1633, name: 'Heringsdorf' },
    '17419': { lat: 53.9444, lon: 14.1933, name: 'Ahlbeck' },
    '17429': { lat: 53.9633, lon: 14.1433, name: 'Bansin' },
    '17449': { lat: 54.0997, lon: 13.8875, name: 'Trassenheide' },
    '17454': { lat: 54.0908, lon: 13.9167, name: 'Zinnowitz' },
    '17459': { lat: 54.0681, lon: 13.9764, name: 'Koserow' },
    '17438': { lat: 54.0525, lon: 13.7619, name: 'Wolgast' },
    '17440': { lat: 54.0525, lon: 13.7619, name: 'Wolgast' }
};
// Haversine-Distanz in km (vereinfacht für kurze Distanzen)
function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const PLZ_MAX_RADIUS_KM = 7; // Max Entfernung vom PLZ-Zentrum

let botToken = null;

// ═══════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN
// ═══════════════════════════════════════════════════════════════

async function loadBotToken() {
    if (botToken) return botToken;
    const snap = await db.ref('settings/telegram/botToken').once('value');
    botToken = snap.val();
    return botToken;
}

async function ensureWebhookSecret() {
    const snap = await db.ref('settings/telegram/webhookSecret').once('value');
    if (snap.val()) return snap.val();
    // Kein Secret vorhanden → automatisch generieren und speichern
    const { randomBytes } = await import('crypto');
    const secret = randomBytes(32).toString('hex');
    await db.ref('settings/telegram/webhookSecret').set(secret);
    return secret;
}

async function sendTelegramMessage(chatId, text, extraParams = {}) {
    const token = await loadBotToken();
    if (!token) { console.error('Kein Bot-Token!'); return null; }
    try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extraParams })
        });
        const data = await resp.json();
        if (!data.ok) console.error('sendMessage Fehler:', data.description);
        return data.ok ? data.result : null;
    } catch (e) {
        console.error('sendMessage Exception:', e.message);
        return null;
    }
}

async function answerCallbackQuery(callbackId) {
    const token = await loadBotToken();
    if (!token) return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackId })
        });
    } catch (err) {
        console.error('answerCallbackQuery fehlgeschlagen:', err.message);
    }
}

async function editTelegramMessage(chatId, messageId, text, extraParams = {}) {
    const token = await loadBotToken();
    if (!token) { console.error('Kein Bot-Token!'); return null; }
    try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extraParams })
        });
        const data = await resp.json();
        if (!data.ok) {
            console.error('editMessageText Fehler:', data.description);
            return await sendTelegramMessage(chatId, text, extraParams);
        }
        return data.result;
    } catch (e) {
        console.error('editMessageText Exception:', e.message);
        return await sendTelegramMessage(chatId, text, extraParams);
    }
}

// Tages-Key für Log-Strukturierung (Berlin-Zeit)
function getTodayLogKey() {
    const now = new Date();
    const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    return berlin.toISOString().slice(0, 10); // "2026-03-05"
}

async function addTelegramLog(emoji, chatId, msg, details = null) {
    try {
        const dayKey = getTodayLogKey();
        const logRef = db.ref(`settings/telegram/botlog/${dayKey}`);
        const entry = {
            time: Date.now(),
            emoji, chatId: String(chatId), msg,
            ...(details ? { details: JSON.stringify(details).substring(0, 500) } : {})
        };
        await logRef.push(entry);
        // Tages-Logs auf max 500 pro Tag begrenzen + alte Tage aufräumen (ca. 1 von 20 Aufrufen)
        if (Math.random() < 0.05) {
            trimTelegramLogs(dayKey);
        }
    } catch (e) { /* Log-Fehler ignorieren */ }
    console.log(`${emoji} [${chatId}] ${msg}`);
}

function trimTelegramLogs(currentDay) {
    const rootRef = db.ref('settings/telegram/botlog');
    rootRef.once('value').then(snap => {
        if (!snap.exists()) return;
        const days = [];
        snap.forEach(dayChild => { days.push(dayChild.key); });
        // Alte Tage löschen (älter als 7 Tage behalten)
        const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        for (const day of days) {
            if (day < cutoffDate) {
                rootRef.child(day).remove().catch(() => {});
            }
        }
        // Heutigen Tag auf max 500 Einträge begrenzen
        const todayRef = rootRef.child(currentDay);
        todayRef.once('value').then(todaySnap => {
            const count = todaySnap.numChildren();
            if (count > 520) {
                const toDelete = count - 500;
                let deleted = 0;
                todaySnap.forEach(child => {
                    if (deleted < toDelete) { child.ref.remove(); deleted++; }
                });
            }
        }).catch(() => {});
    }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// KUNDEN-VERWALTUNG
// ═══════════════════════════════════════════════════════════════

async function getTelegramCustomer(chatId) {
    const snap = await db.ref('settings/telegram/customers/' + chatId).once('value');
    return snap.val() || null;
}

async function saveTelegramCustomer(chatId, data) {
    await db.ref('settings/telegram/customers/' + chatId).set(data);
    await addTelegramLog('🔗', chatId, `Kunde verknüpft: ${data.name} (${data.phone || 'kein Tel.'})`);
}

async function isTelegramAdmin(chatId) {
    const snap = await db.ref('settings/telegram/adminChats').once('value');
    const admins = snap.val() || [];
    const id = Number(chatId);
    return admins.includes(id) || admins.includes(String(chatId));
}

// 🆕 v6.16.3: Admin-Bestätigung für Kunden-Änderungen an Fahrten
// Speichert die gewünschte Änderung als pendingChange und schickt Admin eine Bestätigungs-Nachricht
async function requestAdminApprovalForRideChange(customerChatId, rideId, changeType, changeData, rideInfo) {
    const changeId = `chg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Änderung in Firebase speichern (pendingChanges)
    await db.ref(`settings/telegram/pendingChanges/${changeId}`).set({
        rideId,
        customerChatId: String(customerChatId),
        changeType, // 'time', 'pickup', 'destination'
        changeData, // Die Update-Daten für Firebase
        rideInfo,   // Anzeige-Infos (aktuelle Fahrtdaten)
        createdAt: Date.now(),
        status: 'pending'
    });

    // Admin-Nachricht zusammenbauen
    let changeDesc = '';
    if (changeType === 'time') {
        changeDesc = `⏰ <b>Neue Uhrzeit:</b> ${changeData.pickupTime} Uhr`;
    } else if (changeType === 'pickup') {
        changeDesc = `📍 <b>Neuer Abholort:</b> ${changeData.pickup}`;
    } else if (changeType === 'destination') {
        changeDesc = `🎯 <b>Neues Ziel:</b> ${changeData.destination}`;
    }

    const adminMsg = `🔔 <b>Änderungsanfrage von Kunde!</b>\n\n` +
        `👤 ${rideInfo.customerName || 'Kunde'}\n` +
        `📅 ${rideInfo.dateStr} um ${rideInfo.timeStr} Uhr\n` +
        `📍 ${rideInfo.pickup || '?'} → ${rideInfo.destination || '?'}\n\n` +
        `${changeDesc}\n\n` +
        `<b>Änderung bestätigen?</b>`;

    // An alle Admins senden (mit Kategorie-Filter)
    const adminSnap = await db.ref('settings/telegram/adminChats').once('value');
    const adminChats = adminSnap.val() || [];
    for (const adminChatId of adminChats) {
        try {
            const prefs = await getAdminNotifyPrefs(adminChatId);
            if (prefs && prefs.change_request === false) continue;
            await sendTelegramMessage(adminChatId, adminMsg, {
                reply_markup: { inline_keyboard: [
                    [
                        { text: '✅ Bestätigen', callback_data: `approve_chg_${changeId}` },
                        { text: '❌ Ablehnen', callback_data: `reject_chg_${changeId}` }
                    ]
                ]}
            });
        } catch (e) { console.error('Admin-Benachrichtigung fehlgeschlagen:', e.message); }
    }

    // Kunde informieren, dass Änderung zur Bestätigung weitergeleitet wurde
    await sendTelegramMessage(customerChatId,
        `⏳ <b>Änderung angefragt!</b>\n\n${changeDesc}\n\n<i>Ihre Anfrage wurde an die Zentrale weitergeleitet. Sie erhalten eine Bestätigung sobald die Änderung genehmigt wird.</i>`
    );

    await addTelegramLog('🔔', customerChatId, `Änderungsanfrage: ${changeType} für Fahrt ${rideId}`);
    return changeId;
}

async function loadAllCustomers() {
    const snap = await db.ref('customers').once('value');
    const data = snap.val() || {};
    return Object.entries(data).map(([id, c]) => ({ ...c, id, customerId: id }));
}

function findAllCustomersForSecretary(allCustomers, searchName) {
    if (!searchName) return [];
    const normalized = searchName.toLowerCase().trim();
    const seen = new Set();
    const results = [];

    // Hilfsfunktion: Levenshtein-Distanz für Fuzzy-Matching (Whisper-Tippfehler)
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
        }
        return dp[m][n];
    }

    // Hilfsfunktion: Prüfe ob Name fuzzy passt (max 2 Zeichen Unterschied bei langen Namen, max 1 bei kurzen)
    function fuzzyMatch(name, search) {
        const maxDist = Math.max(name.length, search.length) >= 6 ? 2 : 1;
        return levenshtein(name, search) <= maxDist;
    }

    // 1. Exakt
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        if (!seen.has(c.id) && (c.name || '').toLowerCase() === normalized) { seen.add(c.id); results.push(c); }
    }
    // 2. Partiell (Substring)
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        const name = (c.name || '').toLowerCase();
        if (!seen.has(c.id) && (name.includes(normalized) || normalized.includes(name))) {
            const shorter = Math.min(name.length, normalized.length);
            const longer = Math.max(name.length, normalized.length);
            if (shorter >= longer * 0.5) {
                seen.add(c.id); results.push(c);
            }
        }
    }
    // 2b. 🆕 v6.14.2: Vorname-Match — "Nicole" findet "Nicole Schindel"
    if (normalized.length >= 3) {
        for (const c of allCustomers) {
            if (results.length >= 5) break;
            const nameParts = (c.name || '').toLowerCase().split(/\s+/);
            if (!seen.has(c.id) && nameParts.length >= 1) {
                // Exakter Vorname-Match oder Vorname beginnt mit Suchbegriff (min 3 Zeichen)
                if (nameParts[0] === normalized || (normalized.length >= 4 && nameParts[0].startsWith(normalized))) {
                    seen.add(c.id); results.push(c);
                }
            }
        }
    }
    // 3. Nachname-Match (exakt + Substring)
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        const lastName = (c.name || '').toLowerCase().split(' ').pop();
        const searchLast = normalized.split(' ').pop();
        if (!seen.has(c.id) && lastName.length > 2 && (lastName === searchLast || lastName.includes(searchLast) || searchLast.includes(lastName))) { seen.add(c.id); results.push(c); }
    }
    // 3b. 🆕 v6.14.2: Fuzzy Vorname + Nachname separat — "Schindl" findet "Nicole Schindel"
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        const nameParts = (c.name || '').toLowerCase().split(/\s+/);
        if (!seen.has(c.id) && normalized.length >= 3) {
            for (const part of nameParts) {
                if (part.length >= 3 && (part.startsWith(normalized) || normalized.startsWith(part))) {
                    seen.add(c.id); results.push(c);
                    break;
                }
            }
        }
    }
    // 4. 🆕 v6.14.1: Fuzzy-Match (Levenshtein) für Whisper-Tippfehler
    // z.B. "Nicole Schindl" findet "Nicole Schindel" (1 Buchstabe Unterschied)
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        const name = (c.name || '').toLowerCase();
        if (!seen.has(c.id)) {
            // Ganzen Namen fuzzy vergleichen
            if (fuzzyMatch(name, normalized)) {
                seen.add(c.id); results.push(c);
            } else {
                // Nachnamen fuzzy vergleichen
                const lastName = name.split(' ').pop();
                const searchLast = normalized.split(' ').pop();
                if (lastName.length > 2 && searchLast.length > 2 && fuzzyMatch(lastName, searchLast)) {
                    // Prüfe auch ob Vorname halbwegs passt (wenn angegeben)
                    const searchParts = normalized.split(' ');
                    const nameParts = name.split(' ');
                    if (searchParts.length < 2 || nameParts.length < 2 || nameParts[0].startsWith(searchParts[0]) || searchParts[0].startsWith(nameParts[0])) {
                        seen.add(c.id); results.push(c);
                    }
                }
                // 🆕 v6.14.2: Einzelne Namensteile fuzzy vergleichen
                if (!seen.has(c.id)) {
                    const nameParts = name.split(/\s+/);
                    for (const part of nameParts) {
                        if (part.length >= 3 && fuzzyMatch(part, normalized)) {
                            seen.add(c.id); results.push(c);
                            break;
                        }
                    }
                }
            }
        }
    }
    // 5. 🆕 v6.14.2: Kreuz-Match — Wörter des Suchbegriffs gegen Wörter des CRM-Namens
    // "Hotel Kaiserhof" findet "Kaiserhof Heringsdorf" (weil "Kaiserhof" in beiden vorkommt)
    if (normalized.includes(' ') && results.length === 0) {
        const searchWords = normalized.split(/\s+/).filter(w => w.length >= 4);
        for (const c of allCustomers) {
            if (results.length >= 5) break;
            if (seen.has(c.id)) continue;
            const nameParts = (c.name || '').toLowerCase().split(/\s+/);
            for (const sw of searchWords) {
                let matched = false;
                for (const np of nameParts) {
                    if (np.length >= 4 && (np === sw || np.startsWith(sw) || sw.startsWith(np) || fuzzyMatch(np, sw))) {
                        matched = true;
                        break;
                    }
                }
                if (matched) { seen.add(c.id); results.push(c); break; }
            }
        }
    }
    return results.map(c => ({ name: c.name, phone: c.phone || c.mobile || '', address: c.address || '', defaultPickup: c.defaultPickup || '', customerId: c.id }));
}

// 🆕 v6.15.0: Auftraggeber-Erkennung — Hotels, Firmen, Kliniken die für Andere buchen
// 🆕 v6.15.1: Auch Lieferanten (type='supplier') buchen für Gäste → Gastname + Gast-Telefon abfragen
function isAuftraggeber(customerKind, customerType) {
    return customerKind === 'hotel' || customerKind === 'auftraggeber' || customerType === 'supplier';
}

// 🆕 v6.14.0: Admin — Neuen Kunden im CRM anlegen und Buchung fortsetzen
// 🆕 v6.11.5: customerKind Parameter (stammkunde/gelegenheitskunde)
// 🔧 v6.15.1: mobilePhone als separater Parameter (für Festnetz + Mobil getrennt)
async function createAdminNewCustomer(chatId, name, phone, address, originalText, userName, addrCoords, customerKind, mobilePhone) {
    try {
        const kind = customerKind || 'stammkunde';
        const isStammkunde = kind === 'stammkunde';
        const isHotel = kind === 'hotel';
        const _isAuftraggeber = isAuftraggeber(kind, null);
        // 🔧 v6.15.1: Festnetz/Mobil-Trennung — wenn mobilePhone separat übergeben, phone = Festnetz
        // Wenn kein separates mobilePhone → Auto-Erkennung wie bisher
        const _hasSeparateMobile = mobilePhone && mobilePhone.length > 3;
        const _phoneIsMobile = isMobileNumber(phone);
        const crmPhone = _hasSeparateMobile ? phone : (_phoneIsMobile ? '' : phone);
        const crmMobilePhone = _hasSeparateMobile ? mobilePhone : (_phoneIsMobile ? phone : '');
        const newRef = db.ref('customers').push();
        await newRef.set({
            name: name,
            phone: crmPhone || '',
            mobilePhone: crmMobilePhone || '',
            address: address || '',
            defaultPickup: (isStammkunde || _isAuftraggeber) ? (address || '') : '',  // Stammkunde + Auftraggeber: Adresse = Standard-Abholort
            email: '',
            createdAt: Date.now(),
            createdBy: 'telegram-admin',
            source: 'telegram-admin',
            customerKind: kind,  // 🆕 v6.11.5: stammkunde oder gelegenheitskunde
            totalRides: 0,
            isVIP: false,
            notes: ''
        });

        const customerId = newRef.key;
        const kindLabel = isHotel ? '🏨 Hotel/Pension' : (_isAuftraggeber ? '🏢 Auftraggeber (bucht für Andere)' : (isStammkunde ? '🏠 Stammkunde' : '🧳 Gelegenheitskunde'));
        await addTelegramLog('🆕', chatId, `Neuer CRM-Kunde angelegt: ${name} (${customerId}) [${kind}]`);

        let confirmMsg = `✅ <b>Kunde im CRM angelegt!</b>\n\n`;
        confirmMsg += `👤 <b>${name}</b>\n`;
        confirmMsg += `${kindLabel}\n`;
        // 🔧 v6.15.1: Festnetz + Mobil getrennt anzeigen
        if (crmPhone) confirmMsg += `☎️ Festnetz: ${crmPhone}\n`;
        if (crmMobilePhone) confirmMsg += `📱 Mobil: ${crmMobilePhone}\n`;
        if (!crmPhone && !crmMobilePhone && phone) confirmMsg += `📱 ${phone}\n`;
        if (address) confirmMsg += `${isHotel ? '🏨 Hoteladresse' : (_isAuftraggeber ? '🏢 Firmenadresse' : (isStammkunde ? '🏠 Wohnanschrift' : '📍 Abholadresse'))}: ${address}\n`;

        await sendTelegramMessage(chatId, confirmMsg);
        await deletePending(chatId);

        // Buchung mit dem neuen Kunden fortsetzen
        if (originalText) {
            const preselectedCustomer = {
                name: name,
                phone: crmPhone || phone || '',
                mobilePhone: crmMobilePhone || '', // 🔧 v6.15.1: Mobilnummer separat weitergeben
                address: address || '',
                defaultPickup: address || '',
                customerId: customerId,
                customerKind: kind  // 🆕 v6.15.0: Kundenart weitergeben
            };
            // 🔧 v6.14.3: Koordinaten weitergeben damit Adresse nicht erneut per Nominatim aufgelöst wird
            if (addrCoords && addrCoords.lat && addrCoords.lon) {
                preselectedCustomer.addressLat = addrCoords.lat;
                preselectedCustomer.addressLon = addrCoords.lon;
            }
            await sendTelegramMessage(chatId, '🤖 <i>Analysiere Buchung...</i>');
            await analyzeTelegramBooking(chatId, originalText, userName, { isAdmin: true, preselectedCustomer });
        }
    } catch (e) {
        console.error('CRM-Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ CRM-Fehler: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// PENDING-BUCHUNGEN (Firebase statt Memory)
// ═══════════════════════════════════════════════════════════════

async function getPending(chatId) {
    const snap = await db.ref('settings/telegram/pending/' + chatId).once('value');
    return snap.val() || null;
}

async function setPending(chatId, data) {
    data._createdAt = data._createdAt || Date.now();
    // Firebase erlaubt kein undefined – rekursiv entfernen
    const clean = JSON.parse(JSON.stringify(data));
    await db.ref('settings/telegram/pending/' + chatId).set(clean);
}

async function deletePending(chatId) {
    await db.ref('settings/telegram/pending/' + chatId).remove();
}

function isPendingExpired(pending) {
    if (!pending || !pending._createdAt) return false;
    return (Date.now() - pending._createdAt) > PENDING_TIMEOUT_MS;
}

// ═══════════════════════════════════════════════════════════════
// INTENT-ERKENNUNG
// ═══════════════════════════════════════════════════════════════

function isTelegramBookingQuery(text) {
    const t = text.toLowerCase();
    return /vergangen.{0,15}fahrt/i.test(t) ||
        /meine.{0,20}(fahrt|buchung|termin|reservierung)/i.test(t) ||
        /welche.{0,10}(fahrt|buchung)/i.test(t) ||
        /(fahrt|buchung|termin).{0,20}eingetragen/i.test(t) ||
        /schon.{0,15}(gebucht|bestellt|eingetragen|buchung)/i.test(t) ||
        /bereits.{0,15}(gebucht|bestellt|buchung|fahrt)/i.test(t) ||
        /wann.{0,15}(fahrt|buchung|termin)/i.test(t) ||
        /zu wann/i.test(t) ||
        /(fahrt|buchung).{0,15}(status|stornieren|löschen|absagen)/i.test(t) ||
        /hab.{0,10}(schon|bereits).{0,10}(fahrt|buchung|bestellt)/i.test(t) ||
        /zeig.{0,10}(mir.{0,10})?(meine.{0,10})?(fahrt|buchung)/i.test(t) ||
        /liste.{0,10}(fahrt|buchung)/i.test(t);
}

// 🆕 v6.10.0: Erkennt "Buchen"-Intent als Freitext
function isTelegramBookCommand(text) {
    const t = text.toLowerCase().trim();
    return /^(buchen|fahrt buchen|taxi buchen|bestellen|taxi bestellen|fahrt bestellen|neue fahrt|taxi rufen|ich brauche ein taxi|ich möchte buchen|taxi bitte)$/i.test(t) ||
        /^(buch|bestell).{0,5}(fahrt|taxi|wagen)/i.test(t) ||
        /^(fahrt|taxi|wagen).{0,5}(buch|bestell)/i.test(t);
}

function isTelegramDeleteQuery(text) {
    const t = text.toLowerCase().trim();
    return /^(löschen|stornieren|storno|cancel|absagen|lösch|storniere|abmelden|kündigen)$/i.test(t) ||
        /(buchung|fahrt|termin).{0,20}(löschen|stornieren|absagen|entfernen|cancel|weg|streichen)/i.test(t) ||
        /(löschen|stornieren|absagen|storno).{0,20}(buchung|fahrt|termin)/i.test(t);
}

function isTelegramModifyQuery(text) {
    const t = text.toLowerCase().trim();
    return /^(ändern|umbuchen|änderung|verschieben|verlegen|umändern)$/i.test(t) ||
        /(buchung|fahrt|termin|uhrzeit|abholung|zeit).{0,25}(ändern|änder|verschieben|verlegen|umbuchen|abändern)/i.test(t) ||
        /(ändern|umbuchen|verschieben|verlegen|neue uhrzeit|andere uhrzeit).{0,25}(buchung|fahrt|termin)/i.test(t);
}

// ═══════════════════════════════════════════════════════════════
// GEOCODING & ROUTING
// ═══════════════════════════════════════════════════════════════

async function geocode(address) {
    const searchKey = address.toLowerCase().trim();
    if (KNOWN_PLACES[searchKey]) return KNOWN_PLACES[searchKey];

    const cacheKey = 'geocodeCache/' + searchKey.replace(/[.#$/[\]]/g, '_');

    // Geocoding-Cache aus Firebase (mit Validierung)
    try {
        const cacheSnap = await db.ref(cacheKey).once('value');
        const cached = cacheSnap.val();
        if (cached && typeof cached.lat === 'number' && typeof cached.lon === 'number' && cached.lat !== 0 && cached.lon !== 0) {
            // Cache-Treffer nur verwenden wenn Koordinaten plausibel
            if (isNearUsedom(cached.lat, cached.lon)) {
                // 🔧 v6.15.7+v6.25.4: PLZ-Validierung — Cache mit falscher PLZ oder zu weit vom PLZ-Zentrum verwerfen!
                const plzInAddr = address.match(/\b(1742[0-9]|1741[0-9]|1743[0-9]|1744[0-9]|1745[0-9])\b/);
                if (plzInAddr) {
                    const _plzC = PLZ_CENTERS[plzInAddr[1]];
                    // 🔧 v6.25.4: Koordinaten-Distanz-Check statt nur display_name-PLZ
                    if (_plzC && distanceKm(cached.lat, cached.lon, _plzC.lat, _plzC.lon) > PLZ_MAX_RADIUS_KM) {
                        console.log(`[Geocode] Cache-PLZ-Distanz-Mismatch: Adresse hat PLZ ${plzInAddr[1]}, Cache-Koordinaten ${cached.lat.toFixed(4)},${cached.lon.toFixed(4)} sind ${distanceKm(cached.lat, cached.lon, _plzC.lat, _plzC.lon).toFixed(1)}km entfernt → wird neu geocodiert`);
                        try { await db.ref(cacheKey).remove(); } catch (e) {}
                    } else {
                        return cached;
                    }
                } else {
                    return cached;
                }
            } else {
                // Cache-Eintrag außerhalb Usedom → löschen und neu geocodieren
                console.log(`[Geocode] Cache-Eintrag für "${address}" außerhalb Usedom (${cached.lat}, ${cached.lon}) → wird neu geocodiert`);
                try { await db.ref(cacheKey).remove(); } catch (e) {}
            }
        }
    } catch (e) { /* Cache-Fehler ignorieren */ }

    try {
        // 🔧 v6.15.7: PLZ aus Adresse extrahieren für besseres Matching
        const plzMatch = address.match(/\b(1742[0-9]|1741[0-9]|1743[0-9]|1744[0-9]|1745[0-9])\b/);
        const addressPLZ = plzMatch ? plzMatch[1] : null;
        if (addressPLZ) console.log(`[Geocode] PLZ in Adresse erkannt: ${addressPLZ}`);

        // Nominatim-Ergebnisse durchsuchen: bevorzugt Usedom-Region + PLZ-Match
        const fetchAndValidate = async (url) => {
            const resp = await fetch(url, { headers: { 'User-Agent': 'TaxiHeringsdorf/1.0' } });
            const data = await resp.json();
            if (!data || !data.length) return null;

            // Alle Usedom-Treffer sammeln
            const usedomHits = [];
            for (const item of data) {
                const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
                if (isNearUsedom(lat, lon)) {
                    usedomHits.push({ lat, lon, display_name: item.display_name, address: item.address });
                }
            }

            if (usedomHits.length > 0) {
                // 🔧 v6.25.4: PLZ-Zentrum für Koordinaten-Distanz-Check
                const _plzC = addressPLZ ? PLZ_CENTERS[addressPLZ] : null;

                // 🔧 v6.25.4: Wenn PLZ angegeben → Ergebnisse nach Distanz zum PLZ-Zentrum filtern
                if (_plzC && usedomHits.length > 1) {
                    // Sortiere nach Distanz zum PLZ-Zentrum
                    usedomHits.sort((a, b) => {
                        const aDist = distanceKm(a.lat, a.lon, _plzC.lat, _plzC.lon);
                        const bDist = distanceKm(b.lat, b.lon, _plzC.lat, _plzC.lon);
                        return aDist - bDist;
                    });
                    // Nur Ergebnisse innerhalb PLZ_MAX_RADIUS_KM vom PLZ-Zentrum akzeptieren
                    const nearHits = usedomHits.filter(h => distanceKm(h.lat, h.lon, _plzC.lat, _plzC.lon) <= PLZ_MAX_RADIUS_KM);
                    if (nearHits.length > 0) {
                        console.log(`[Geocode] "${address}" → PLZ-Distanz-Match (${addressPLZ}, ${nearHits.length} Treffer): ${nearHits[0].lat}, ${nearHits[0].lon} (${nearHits[0].display_name})`);
                        return nearHits[0];
                    }
                    console.log(`[Geocode] "${address}" → Kein Treffer innerhalb ${PLZ_MAX_RADIUS_KM}km von PLZ ${addressPLZ}, nutze nächsten: ${usedomHits[0].display_name}`);
                } else if (_plzC && usedomHits.length === 1) {
                    // Einzeltreffer: Warnung wenn zu weit weg
                    const dist = distanceKm(usedomHits[0].lat, usedomHits[0].lon, _plzC.lat, _plzC.lon);
                    if (dist > PLZ_MAX_RADIUS_KM) {
                        console.warn(`[Geocode] ⚠️ "${address}" → Einziger Treffer ${dist.toFixed(1)}km von PLZ ${addressPLZ} entfernt! ${usedomHits[0].display_name}`);
                    }
                }
                // Kein PLZ-Filter oder Fallback → ersten Usedom-Treffer nehmen
                console.log(`[Geocode] "${address}" → Usedom-Treffer: ${usedomHits[0].lat}, ${usedomHits[0].lon} (${usedomHits[0].display_name})`);
                return usedomHits[0];
            }

            // 2. Fallback: Erstes Ergebnis (für Fern-Ziele wie Berlin, Hamburg)
            const first = data[0];
            const lat = parseFloat(first.lat), lon = parseFloat(first.lon);
            console.log(`[Geocode] "${address}" → Kein Usedom-Treffer, nutze erstes Ergebnis: ${lat}, ${lon} (${first.display_name})`);
            return { lat, lon, display_name: first.display_name };
        };

        // Nominatim-Suche mit Viewbox-Präferenz für Usedom
        let result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Usedom, Deutschland')}&limit=5&addressdetails=1&viewbox=13.6,54.2,14.45,53.75&bounded=0`);
        if (!result) result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Świnoujście, Polska')}&limit=5&addressdetails=1`);
        if (!result) result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&viewbox=13.6,54.2,14.45,53.75&bounded=1&limit=5&addressdetails=1`);
        if (!result) result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Deutschland')}&limit=5&addressdetails=1`);

        if (result) {
            // Nur in Usedom-Nähe cachen (Fern-Ziele nicht cachen, da diese eher variieren)
            if (isNearUsedom(result.lat, result.lon)) {
                try { await db.ref(cacheKey).set(result); } catch (e) {}
            }
        }
        return result;
    } catch (e) {
        console.warn('Geocoding Fehler:', e.message);
        return null;
    }
}

// Reverse-Geocoding: Koordinaten → Adresse
async function reverseGeocode(lat, lon) {
    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&zoom=18`, {
            headers: { 'User-Agent': 'TaxiHeringsdorf/1.0' }
        });
        const data = await resp.json();
        if (data && data.address) {
            const addr = data.address;
            const poiName = (data.namedetails?.name || data.name || addr.amenity || addr.tourism || addr.shop || addr.leisure || '');
            let streetPart = '';
            const _road = addr.road || addr.residential || addr.neighbourhood || addr.suburb || addr.hamlet || '';
            if (_road) streetPart = _road + (addr.house_number ? ' ' + addr.house_number : '');
            else if (addr.pedestrian) streetPart = addr.pedestrian;
            const town = addr.town || addr.city || addr.village || addr.municipality || '';
            const postcode = addr.postcode || '';
            let fullName;
            if (poiName && streetPart && !poiName.includes(streetPart.split(' ')[0])) {
                fullName = `${poiName}, ${streetPart}` + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
            } else if (streetPart) {
                fullName = streetPart + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
            } else if (poiName) {
                fullName = poiName + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
            } else if (data.display_name) {
                fullName = data.display_name.split(',').slice(0, 3).join(',').trim();
            } else {
                fullName = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            }
            return { name: fullName, lat: parseFloat(data.lat), lon: parseFloat(data.lon), display_name: data.display_name, address: addr };
        }
        return null;
    } catch (e) {
        console.warn('Reverse-Geocoding Fehler:', e.message);
        return null;
    }
}

// 🔧 v6.11.0: Adresse sauber validieren – wenn nur POI-Name ohne Straße, per Reverse-Geocoding nachrüsten
async function cleanupAddress(currentName, lat, lon) {
    if (!lat || !lon) return currentName;
    // Prüfe ob Adresse schon "sauber" ist (enthält Nummer + PLZ oder Komma)
    const hasStreetNumber = /\d/.test(currentName) && currentName.includes(',');
    if (hasStreetNumber) return currentName;
    // Reverse-Geocoding für saubere Adresse
    try {
        const rev = await reverseGeocode(lat, lon);
        if (rev && rev.name && rev.name.length > currentName.length) {
            console.log(`[CleanupAddr] "${currentName}" → "${rev.name}"`);
            return rev.name;
        }
    } catch (e) {}
    return currentName;
}

// 🔧 v6.15.1: Komplett überarbeitet — POIs + Kunden priorisiert, Nominatim nur als Ergänzung
// Gleiche Logik wie Browser-Autocomplete in index.html
async function searchNominatimForTelegram(query) {
    if (!query) return [];
    // 🔧 v6.25.4: Hausnummern-Bereiche normalisieren ("7 bis 8" → "7", "7-8" → "7")
    // Nominatim kann keine Hausnummern-Bereiche, nimmt nur die erste Nummer
    query = query.replace(/(\d+)\s*(?:bis|[-–])\s*\d+/gi, '$1');
    const searchKey = query.toLowerCase().trim();
    const fetchOpts = { headers: { 'User-Agent': 'TaxiHeringsdorf/1.0' } };
    const searchWords = searchKey.replace(/[,./]/g, ' ').split(/\s+/).filter(w => w.length > 1);

    // Hilfsfunktion: Wort-Anfang-Match (höhere Priorität als includes)
    const wordBoundaryRegex = new RegExp('(^|\\s|,)' + searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // ═══════════════════════════════════════════════════════════
    // STUFE 1: LOKALE QUELLEN (gepflegte Daten — höchste Priorität)
    // ═══════════════════════════════════════════════════════════
    const localResults = [];
    const seen = new Set();

    const addIfNew = (entry) => {
        const coordKey = `${parseFloat(entry.lat).toFixed(3)}_${parseFloat(entry.lon).toFixed(3)}`;
        if (!seen.has(coordKey)) {
            seen.add(coordKey);
            localResults.push(entry);
        }
    };

    // 1a) POIs aus Firebase (⭐ deine gepflegten Favoriten)
    try {
        const poisSnap = await db.ref('pois').once('value');
        if (poisSnap.exists()) {
            poisSnap.forEach(child => {
                const poi = child.val();
                if (!poi.name || !poi.lat || !poi.lon) return;
                const poiName = poi.name.toLowerCase();
                const poiAddr = (poi.address || '').toLowerCase();
                const isExact = wordBoundaryRegex.test(poiName) || wordBoundaryRegex.test(poiAddr);
                const isIncludes = poiName.includes(searchKey) || poiAddr.includes(searchKey);
                const isWordMatch = searchWords.length > 0 && searchWords.every(w => poiName.includes(w) || poiAddr.includes(w));
                if (isExact || isIncludes || isWordMatch) {
                    const displayName = poi.address ? `${poi.name}, ${poi.address}` : poi.name;
                    addIfNew({ name: displayName, lat: poi.lat, lon: poi.lon, source: 'poi', priority: isExact ? 0 : 1 });
                }
            });
        }
    } catch (e) { console.warn('POI-Suche Fehler:', e.message); }

    // 1b) KNOWN_PLACES (hardcoded Bahnhöfe, Flughäfen etc. — Fallback bis in POIs gepflegt)
    for (const [key, place] of Object.entries(KNOWN_PLACES)) {
        const placeName = (place.name || '').toLowerCase();
        const isExact = wordBoundaryRegex.test(key) || wordBoundaryRegex.test(placeName);
        const isIncludes = key.includes(searchKey) || placeName.includes(searchKey);
        const isWordMatch = searchWords.length > 0 && searchWords.every(w => key.includes(w) || placeName.includes(w));
        if (isExact || isIncludes || isWordMatch) {
            addIfNew({ name: place.name || key, lat: place.lat, lon: place.lon, source: 'known', priority: isExact ? 0 : 1 });
        }
    }

    // 🔧 v6.25.4: PLZ aus Query extrahieren für lokale Quellen-Filterung
    const _queryPLZ = query.match(/\b(1742[0-9]|1741[0-9]|1743[0-9]|1744[0-9]|1745[0-9])\b/);
    const _queryPostcode = _queryPLZ ? _queryPLZ[1] : null;
    const _plzCenter = _queryPostcode ? PLZ_CENTERS[_queryPostcode] : null;

    // 1c) CRM-Kunden mit Adressen
    // 🔧 v6.15.7: Usedom-PLZ-Erkennung für Koordinaten-Validierung
    const USEDOM_PLZ = ['17424', '17429', '17419', '17438', '17440', '17449', '17454', '17459'];
    const _looksLikeUsedom = (text) => {
        const t = text.toLowerCase();
        return USEDOM_PLZ.some(p => t.includes(p)) ||
            /\b(usedom|heringsdorf|ahlbeck|bansin|zinnowitz|trassenheide|karlshagen|koserow|loddin|ückeritz|zempin|peenemünde|wolgast)\b/i.test(t);
    };
    try {
        const custSnap = await db.ref('customers').once('value');
        if (custSnap.exists()) {
            custSnap.forEach(child => {
                const c = child.val();
                if (!c.name || !c.address) return;
                const cName = c.name.toLowerCase();
                const cAddr = c.address.toLowerCase();
                const isMatch = cName.includes(searchKey) || cAddr.includes(searchKey) ||
                    (searchWords.length > 0 && searchWords.every(w => cName.includes(w) || cAddr.includes(w)));
                if (isMatch) {
                    const lat = c.lat || c.pickupLat;
                    const lon = c.lon || c.pickupLon;
                    if (lat && lon) {
                        // 🔧 v6.15.7: Usedom-Adresse muss Usedom-Koordinaten haben
                        if (_looksLikeUsedom(c.address) && !isNearUsedom(parseFloat(lat), parseFloat(lon))) {
                            return; // Falsche Koordinaten → überspringen
                        }
                        // 🔧 v6.25.4: PLZ-Distanz-Check — CRM-Koordinaten müssen zum angefragten PLZ-Gebiet passen
                        if (_plzCenter) {
                            const dist = distanceKm(parseFloat(lat), parseFloat(lon), _plzCenter.lat, _plzCenter.lon);
                            if (dist > PLZ_MAX_RADIUS_KM) {
                                console.log(`[PLZ-Filter] CRM "${c.name}" übersprungen: ${dist.toFixed(1)}km von PLZ ${_queryPostcode} entfernt`);
                                return;
                            }
                        }
                        addIfNew({ name: `${c.name}, ${c.address}`, lat, lon, source: 'customer', priority: 2 });
                    }
                }
            });
        }
    } catch (e) { console.warn('Kunden-Suche Fehler:', e.message); }

    // 1d) Häufige Ziele aus letzten Buchungen (nutzt USEDOM_PLZ/_looksLikeUsedom von oben)
    try {
        const ridesSnap = await db.ref('rides').orderByChild('createdAt').limitToLast(200).once('value');
        const destCount = {};
        ridesSnap.forEach(child => {
            const ride = child.val();
            // Zielorte
            const dest = ride.destination;
            const lat = ride.destinationLat || (ride.destCoords && ride.destCoords.lat);
            const lon = ride.destinationLon || (ride.destCoords && ride.destCoords.lon);
            if (dest && lat && lon) {
                // 🔧 v6.15.7: Koordinaten-Plausibilitätsprüfung — Usedom-Adresse muss Usedom-Koordinaten haben!
                if (_looksLikeUsedom(dest) && !isNearUsedom(parseFloat(lat), parseFloat(lon))) {
                    // Falsche Koordinaten: Usedom-Adresse aber Koordinaten woanders → NICHT übernehmen
                    return;
                }
                const key = dest.toLowerCase().trim();
                if (!destCount[key]) destCount[key] = { name: dest, lat, lon, count: 0 };
                destCount[key].count++;
            }
            // Abholorte
            const pickup = ride.pickup;
            const pLat = ride.pickupLat || (ride.pickupCoords && ride.pickupCoords.lat);
            const pLon = ride.pickupLon || (ride.pickupCoords && ride.pickupCoords.lon);
            if (pickup && pLat && pLon) {
                // 🔧 v6.15.7: Gleiches für Abholorte
                if (_looksLikeUsedom(pickup) && !isNearUsedom(parseFloat(pLat), parseFloat(pLon))) {
                    return;
                }
                const key = pickup.toLowerCase().trim();
                if (!destCount[key]) destCount[key] = { name: pickup, lat: pLat, lon: pLon, count: 0 };
                destCount[key].count++;
            }
        });
        const frequent = Object.values(destCount).sort((a, b) => b.count - a.count);
        for (const freq of frequent) {
            const freqName = freq.name.toLowerCase();
            // 🔧 v6.25.3: Flexiblerer Match — mind. 2/3 der Suchworte müssen treffen
            // UND Straßenname muss matchen (erstes Wort mit >3 Buchstaben)
            const mainWord = searchWords.find(w => w.length > 3) || searchWords[0] || '';
            const wordMatchCount = searchWords.filter(w => freqName.includes(w)).length;
            const wordMatchRatio = searchWords.length > 0 ? wordMatchCount / searchWords.length : 0;
            if (freqName.includes(searchKey) ||
                (searchWords.length > 0 && searchWords.every(w => freqName.includes(w))) ||
                (mainWord && freqName.includes(mainWord) && wordMatchRatio >= 0.6)) {
                // 🔧 v6.25.4: PLZ-Distanz-Check für Buchungs-Historie
                if (_plzCenter) {
                    const dist = distanceKm(parseFloat(freq.lat), parseFloat(freq.lon), _plzCenter.lat, _plzCenter.lon);
                    if (dist > PLZ_MAX_RADIUS_KM) continue;
                }
                addIfNew({ name: freq.name, lat: freq.lat, lon: freq.lon, source: 'booking', priority: 3 });
            }
        }
    } catch (e) { console.warn('Buchungs-Suche Fehler:', e.message); }

    // Sortiere lokale Ergebnisse: exakte Treffer zuerst, dann nach Quelle
    localResults.sort((a, b) => (a.priority || 0) - (b.priority || 0));

    // ═══════════════════════════════════════════════════════════
    // STUFE 2: NOMINATIM (nur als Ergänzung — wenn lokale Treffer da sind, weniger Nominatim)
    // ═══════════════════════════════════════════════════════════
    const nominatimResults = [];
    // Wenn schon 3+ lokale Treffer → max 2 Nominatim, sonst bis zu 5
    const maxNominatim = localResults.length >= 3 ? 2 : (localResults.length >= 1 ? 3 : 5);

    try {
        const [usedomResp, generalResp] = await Promise.all([
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Usedom')}&limit=10&addressdetails=1&extratags=1&namedetails=1&viewbox=11.0,54.7,14.5,53.3&bounded=0`, fetchOpts),
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=de,pl&viewbox=11.0,54.7,14.5,53.3&bounded=1&limit=10&addressdetails=1&extratags=1&namedetails=1`, fetchOpts)
        ]);
        const usedomData = await usedomResp.json();
        const generalData = await generalResp.json();

        // Fallback: Unbounded-Suche für Orte außerhalb Usedom (Greifswald, Berlin, Anklam etc.)
        let wideData = [];
        if (usedomData.length === 0 && generalData.length === 0) {
            try {
                const wideResp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=de,pl&limit=10&addressdetails=1&extratags=1&namedetails=1`, fetchOpts);
                wideData = await wideResp.json();
            } catch (e) { console.warn('Nominatim Wide-Suche Fehler:', e); }
        }

        // 🔧 v6.15.7: PLZ aus Query extrahieren für besseres Sortieren
        const queryPLZ = query.match(/\b(1742[0-9]|1741[0-9]|1743[0-9]|1744[0-9]|1745[0-9])\b/);
        const queryPostcode = queryPLZ ? queryPLZ[1] : null;
        // 🔧 v6.25.4: PLZ-Zentrum für Koordinaten-Plausibilitätsprüfung
        const plzCenter = queryPostcode ? PLZ_CENTERS[queryPostcode] : null;

        // Usedom-Ergebnisse zuerst, PLZ-Match bevorzugt, dann allgemeine
        let allItems = [...usedomData, ...generalData, ...wideData];

        // 🔧 v6.25.4: Ergebnisse filtern deren Koordinaten zu weit vom angegebenen PLZ-Zentrum entfernt sind
        if (plzCenter) {
            const before = allItems.length;
            allItems = allItems.filter(item => {
                const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
                const dist = distanceKm(lat, lon, plzCenter.lat, plzCenter.lon);
                if (dist > PLZ_MAX_RADIUS_KM) {
                    console.log(`[PLZ-Filter] "${item.display_name}" rausgefiltert: ${dist.toFixed(1)}km von PLZ ${queryPostcode} ${plzCenter.name} entfernt`);
                    return false;
                }
                return true;
            });
            if (before > allItems.length) {
                console.log(`[PLZ-Filter] ${before - allItems.length} Ergebnisse wegen PLZ-Distanz gefiltert (PLZ ${queryPostcode}, max ${PLZ_MAX_RADIUS_KM}km)`);
            }
        }

        allItems.sort((a, b) => {
            const aUsedom = isNearUsedom(parseFloat(a.lat), parseFloat(a.lon)) ? 0 : 1;
            const bUsedom = isNearUsedom(parseFloat(b.lat), parseFloat(b.lon)) ? 0 : 1;
            if (aUsedom !== bUsedom) return aUsedom - bUsedom;
            // 🔧 v6.15.7: Bei gleicher Usedom-Zugehörigkeit → PLZ-Match bevorzugen
            if (queryPostcode) {
                const aPLZ = (a.address && a.address.postcode === queryPostcode) ? 0 : 1;
                const bPLZ = (b.address && b.address.postcode === queryPostcode) ? 0 : 1;
                return aPLZ - bPLZ;
            }
            return 0;
        });

        for (const item of allItems) {
            if (nominatimResults.length >= maxNominatim) break;
            const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
            const coordKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
            if (!seen.has(coordKey)) {
                seen.add(coordKey);
                const addr = item.address || {};
                const poiName = item.name || '';
                const road = addr.road || addr.residential || addr.neighbourhood || addr.suburb || addr.hamlet || addr.pedestrian || '';
                const houseNr = addr.house_number || '';
                const town = addr.town || addr.city || addr.village || addr.municipality || '';
                const postcode = addr.postcode || '';
                let streetPart = road ? (road + (houseNr ? ' ' + houseNr : '')) : '';
                let displayName;
                if (poiName && streetPart && !poiName.includes(road)) {
                    displayName = `${poiName}, ${streetPart}` + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
                } else if (streetPart) {
                    displayName = streetPart + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
                } else if (poiName) {
                    displayName = poiName + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
                } else {
                    displayName = item.display_name.split(',').slice(0, 3).join(',').trim();
                }
                nominatimResults.push({ name: displayName, lat, lon, source: 'nominatim' });
            }
        }
    } catch (e) { console.warn('Nominatim Fehler:', e); }

    // ═══════════════════════════════════════════════════════════
    // ERGEBNIS: Lokale Treffer zuerst, dann Nominatim — max 5 gesamt
    // ═══════════════════════════════════════════════════════════
    return [...localResults, ...nominatimResults].slice(0, 5);
}

async function calculateRoute(from, to) {
    try {
        const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`);
        const data = await resp.json();
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            return {
                distance: (route.distance / 1000).toFixed(1),
                duration: Math.round(route.duration / 60)
            };
        }
    } catch (e) { console.warn('Route Fehler:', e.message); }
    return null;
}

function isFeiertag(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return FEIERTAGE.includes(`${month}-${day}`);
}

function calculatePrice(distance, timestamp = null) {
    const calcTime = timestamp ? new Date(timestamp) : new Date();
    const hour = calcTime.getHours(), day = calcTime.getDay();
    const istFeiertag_ = isFeiertag(calcTime);
    const isNight = (hour >= 22 || hour < 6) || (day === 0) || istFeiertag_;

    const grundgebuehr = isNight ? TARIF.nacht_grundgebuehr : TARIF.grundgebuehr;
    const km_1_2 = isNight ? TARIF.nacht_km_1_2 : TARIF.km_1_2;
    const km_3_4 = isNight ? TARIF.nacht_km_3_4 : TARIF.km_3_4;
    const km_ab_5 = isNight ? TARIF.nacht_km_ab_5 : TARIF.km_ab_5;

    let kmPreis = 0;
    if (distance <= 2) { kmPreis = distance * km_1_2; }
    else if (distance <= 4) { kmPreis = (2 * km_1_2) + ((distance - 2) * km_3_4); }
    else { kmPreis = (2 * km_1_2) + (2 * km_3_4) + ((distance - 4) * km_ab_5); }

    let base = grundgebuehr + kmPreis;
    const text = [];
    if (istFeiertag_) text.push('Feiertag (Nachttarif)');
    else if (day === 0) text.push('Sonntag (Nachttarif)');
    else if (isNight) text.push('Nachttarif');

    const totalRounded = Math.round(base / 0.1) * 0.1;
    return { total: totalRounded.toFixed(2), zuschlagText: text, distance, basePrice: base.toFixed(2) };
}

// Parse datetime string as German time (CET/CEST) → returns UTC timestamp
// ═══════════════════════════════════════════════════════════════
// VERFÜGBARKEITS-PRÜFUNG (Telegram-Bot)
// ═══════════════════════════════════════════════════════════════

async function checkTelegramTimeConflict(pickupTimestamp, estimatedDuration) {
    try {
        const requestedDate = new Date(pickupTimestamp);
        // Nur Fahrten vom selben Tag laden
        const dayStart = new Date(requestedDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(requestedDate);
        dayEnd.setHours(23, 59, 59, 999);

        const ridesSnap = await db.ref('rides')
            .orderByChild('pickupTimestamp')
            .startAt(dayStart.getTime())
            .endAt(dayEnd.getTime())
            .once('value');

        const rides = ridesSnap.val();
        if (!rides) return null; // Keine Fahrten → kein Konflikt

        const activeStatuses = ['new', 'open', 'assigned', 'vorbestellt', 'picked_up', 'ongoing', 'accepted'];
        const duration = estimatedDuration || 30; // Fallback: 30 Min
        const requestedEnd = pickupTimestamp + (duration * 60000);
        const bufferMs = 10 * 60000; // 10 Min Puffer zwischen Fahrten

        const conflicts = [];
        for (const [rideId, ride] of Object.entries(rides)) {
            if (!activeStatuses.includes(ride.status)) continue;
            const rideStart = ride.pickupTimestamp || 0;
            const rideDuration = ride.duration ? parseInt(ride.duration) : (ride.estimatedDuration ? parseInt(ride.estimatedDuration) : 30);
            const rideEnd = rideStart + (rideDuration * 60000);

            // Überlappungs-Check mit Puffer
            if (pickupTimestamp < (rideEnd + bufferMs) && requestedEnd > (rideStart - bufferMs)) {
                const rideTime = new Date(rideStart).toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });
                const rideEndTime = new Date(rideEnd).toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });
                conflicts.push({
                    rideId,
                    pickup: ride.pickup || '?',
                    destination: ride.destination || '?',
                    startTime: rideTime,
                    endTime: rideEndTime,
                    rideStart,
                    rideEnd
                });
            }
        }

        if (conflicts.length === 0) return null;

        // Fahrzeug-Anzahl prüfen (mehrere Fahrzeuge = evtl. kein echter Konflikt)
        let vehicleCount = 1;
        try {
            const vehiclesSnap = await db.ref('vehicles').once('value');
            const vehicles = vehiclesSnap.val();
            if (vehicles) {
                vehicleCount = Object.values(vehicles).filter(v => v.active !== false).length;
            }
        } catch (e) { /* Fallback: 1 Fahrzeug */ }

        // Wenn mehr Fahrzeuge als Konflikte → kein Problem
        if (vehicleCount > conflicts.length) return null;

        // Frühestmöglichen freien Slot berechnen
        const allEnds = conflicts.map(c => c.rideEnd + bufferMs).sort((a, b) => a - b);
        const earliestFree = allEnds[allEnds.length - 1];
        const earliestFreeTime = new Date(earliestFree).toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });

        return { conflicts, earliestFree, earliestFreeTime, vehicleCount };
    } catch (e) {
        console.error('[Verfügbarkeit] Prüfung fehlgeschlagen:', e.message);
        return null; // Im Fehlerfall Buchung trotzdem zulassen
    }
}

// 🆕 v6.11.6: Fahrer-Online-Check für Sofortfahrten
async function checkDriversOnline() {
    try {
        const vehiclesSnap = await db.ref('vehicles').once('value');
        const vehicles = vehiclesSnap.val();
        if (!vehicles) return { online: false, count: 0, total: 0 };

        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 Minuten

        let total = 0;
        let onlineCount = 0;
        const onlineDrivers = [];

        for (const [id, v] of Object.entries(vehicles)) {
            if (v.active === false) continue;
            total++;
            const gpsAge = v.timestamp ? (now - v.timestamp) : Infinity;
            const isOnline = gpsAge <= maxAge && v.online !== false && v.dispatchStatus !== 'offline' && v.lat && v.lon;
            if (isOnline) {
                onlineCount++;
                onlineDrivers.push({ id, name: v.name || id, lat: v.lat, lon: v.lon });
            }
        }

        return { online: onlineCount > 0, count: onlineCount, total, drivers: onlineDrivers };
    } catch (e) {
        console.error('[DriverCheck] Fehler:', e.message);
        return { online: true, count: 0, total: 0 }; // Im Fehlerfall optimistisch
    }
}

// 🆕 v6.14.7: Freitext-Datum parsen ("morgen 14:00", "15.03. 10 Uhr", "14:30", etc.)
function parseFreeformDatetime(text) {
    if (!text) return null;
    const now = new Date();
    const berlinNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));

    let targetDate = new Date(berlinNow);
    let hours = null, minutes = null;

    const t = text.toLowerCase().trim();

    // "morgen", "übermorgen", "heute"
    if (/morgen/i.test(t) && !/übermorgen/i.test(t)) {
        targetDate.setDate(targetDate.getDate() + 1);
    } else if (/übermorgen/i.test(t)) {
        targetDate.setDate(targetDate.getDate() + 2);
    }
    // Wochentage
    const wochentage = { montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0 };
    for (const [tag, dow] of Object.entries(wochentage)) {
        if (t.includes(tag)) {
            let diff = dow - targetDate.getDay();
            if (diff <= 0) diff += 7;
            targetDate.setDate(targetDate.getDate() + diff);
            break;
        }
    }
    // Datum: "15.03.", "15.3.2026", "15.03.2026"
    const dateMatch = t.match(/(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/);
    if (dateMatch) {
        targetDate.setDate(parseInt(dateMatch[1]));
        targetDate.setMonth(parseInt(dateMatch[2]) - 1);
        if (dateMatch[3]) {
            let year = parseInt(dateMatch[3]);
            if (year < 100) year += 2000;
            targetDate.setFullYear(year);
        }
        // Wenn Datum in Vergangenheit → nächstes Jahr
        if (targetDate < berlinNow && !dateMatch[3]) {
            targetDate.setFullYear(targetDate.getFullYear() + 1);
        }
    }
    // Uhrzeit: "14:00", "14 Uhr", "14.30", "14:30 Uhr"
    const timeMatch = t.match(/(\d{1,2})[:\.](\d{2})/);
    const timeMatch2 = t.match(/(\d{1,2})\s*uhr/i);
    if (timeMatch) {
        hours = parseInt(timeMatch[1]);
        minutes = parseInt(timeMatch[2]);
    } else if (timeMatch2) {
        hours = parseInt(timeMatch2[1]);
        minutes = 0;
    }

    if (hours === null) return null; // Mindestens Uhrzeit muss angegeben sein

    targetDate.setHours(hours, minutes, 0, 0);

    // Convert Berlin local time to UTC timestamp
    const berlinStr = targetDate.toLocaleString('en-US');
    const berlinAsUTC = new Date(berlinStr);
    const offsetMs = berlinAsUTC.getTime() - targetDate.getTime();
    return targetDate.getTime() - offsetMs;
}

function parseGermanDatetime(datetimeStr) {
    if (!datetimeStr) {
        console.warn('⚠️ parseGermanDatetime: datetimeStr ist leer/null → Fallback auf Date.now()! Das kann zu falscher Sofortfahrt-Erkennung führen.');
        return Date.now();
    }
    const d = new Date(datetimeStr);
    if (isNaN(d.getTime())) {
        console.warn(`⚠️ parseGermanDatetime: "${datetimeStr}" konnte NICHT geparst werden → Fallback auf Date.now()! Sofortfahrt-Fehlklassifizierung möglich.`);
        return Date.now();
    }
    // If already has explicit timezone suffix (Z or +/-offset), use as-is
    if (typeof datetimeStr === 'string' && (datetimeStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(datetimeStr))) {
        return d.getTime();
    }
    // Treat as Europe/Berlin: compute offset and correct
    const berlinStr = d.toLocaleString('en-US', { timeZone: 'Europe/Berlin' });
    const berlinAsUTC = new Date(berlinStr);
    const offsetMs = berlinAsUTC.getTime() - d.getTime();
    const result = d.getTime() - offsetMs;
    console.log(`📅 parseGermanDatetime: "${datetimeStr}" → ${new Date(result).toISOString()} (Berlin: ${new Date(result).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })})`);
    return result;
}

const TZ_BERLIN = { timeZone: 'Europe/Berlin' };

async function calculateTelegramRoutePrice(booking) {
    if (!booking.pickupLat || !booking.destinationLat) return null;
    try {
        console.log(`[RoutePrice] Berechne Route: (${booking.pickupLat}, ${booking.pickupLon}) → (${booking.destinationLat}, ${booking.destinationLon})`);
        const route = await calculateRoute(
            { lat: booking.pickupLat, lon: booking.pickupLon },
            { lat: booking.destinationLat, lon: booking.destinationLon }
        );
        if (!route || !route.distance) return null;
        console.log(`[RoutePrice] OSRM Ergebnis: ${route.distance} km, ${route.duration} min`);
        if (parseFloat(route.distance) > 500) {
            console.warn(`[RoutePrice] Unrealistische Distanz: ${route.distance} km → Berechnung übersprungen`);
            return null;
        }
        const pickupTimestamp = booking.datetime ? parseGermanDatetime(booking.datetime) : Date.now();
        const pricing = calculatePrice(parseFloat(route.distance), pickupTimestamp);
        console.log(`[RoutePrice] Preis: ${pricing.total}€ für ${route.distance} km`);
        return { distance: route.distance, duration: route.duration, price: pricing.total, zuschlagText: pricing.zuschlagText };
    } catch (e) {
        console.error('[RoutePrice] Fehler:', e.message);
        return null;
    }
}

async function validateTelegramAddresses(chatId, booking, originalText) {
    await sendTelegramMessage(chatId, '📍 <i>Prüfe Adressen...</i>');
    await addTelegramLog('📍', chatId, `Adress-Check: "${booking.pickup}" → "${booking.destination}"`);

    // Bereits gesetzte Koordinaten überspringen (z.B. GPS-Standort, beliebte Ziele)
    const hasPickupCoords = !!(booking.pickupLat && booking.pickupLon);
    const hasDestCoords = !!(booking.destinationLat && booking.destinationLon);

    const needPickup = !hasPickupCoords && !!booking.pickup;
    const needDest = !hasDestCoords && !!booking.destination;

    // Wenn Adressen per Text eingegeben → IMMER Vorschläge zeigen, Kunde wählt selbst
    if (needPickup || needDest) {
        // Zuerst Pickup lösen, dann Destination
        const fieldToResolve = needPickup ? 'pickup' : 'destination';
        const addressToResolve = needPickup ? booking.pickup : booking.destination;
        const fieldLabel = needPickup ? '📍 Abholort' : '🎯 Zielort';
        const prefix = needPickup ? 'np' : 'nd';

        try {
            const suggestions = await searchNominatimForTelegram(addressToResolve);

            if (suggestions.length > 0) {
                // 🔧 v6.25.4: Zurück-Button bei Adressvorschlägen
                const addrBottomRow = [{ text: '✏️ Andere Adresse eingeben', callback_data: `addr_retry_${fieldToResolve}` }];
                const addrLastRow = [];
                if (!needPickup && needDest) {
                    // Zielort-Vorschläge: Zurück = Abholort nochmal ändern
                    addrLastRow.push({ text: '◀️ Zurück', callback_data: 'addr_back_to_pickup' });
                }
                addrLastRow.push({ text: '⏩ Weiter ohne Preis', callback_data: 'addr_skip' });
                addrLastRow.push({ text: '❌ Abbrechen', callback_data: 'cancel_booking' });
                const keyboard = {
                    inline_keyboard: [
                        ...suggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `${prefix}_${i}` }]),
                        addrBottomRow,
                        addrLastRow
                    ]
                };

                const pendingState = { partial: { ...booking, missing: [] }, originalText };
                pendingState.nominatimResults = suggestions;
                if (hasPickupCoords) { pendingState.partial.pickupLat = booking.pickupLat; pendingState.partial.pickupLon = booking.pickupLon; }
                if (hasDestCoords) { pendingState.partial.destinationLat = booking.destinationLat; pendingState.partial.destinationLon = booking.destinationLon; }
                // Wenn beide Adressen noch aufgelöst werden müssen, Destination nachher
                pendingState.pendingDestValidation = (needPickup && needDest);
                await setPending(chatId, pendingState);

                await addTelegramLog('🔍', chatId, `${fieldLabel} "${addressToResolve}" → ${suggestions.length} Vorschläge`);
                await sendTelegramMessage(chatId,
                    `🔍 <b>${fieldLabel}: "${addressToResolve}"</b>\n\n` +
                    `Bitte wählen Sie die korrekte Adresse:`,
                    { reply_markup: keyboard }
                );
                return null; // Warte auf Kundenauswahl
            } else {
                // Keine exakten Ergebnisse → Fuzzy-Suche in KNOWN_PLACES + POIs + Buchungen + Kunden
                const fuzzyWords = addressToResolve.toLowerCase().replace(/[,./]/g, ' ').split(/\s+/).filter(w => w.length > 2);
                const similarPlaces = [];
                // 1. KNOWN_PLACES
                for (const [key, place] of Object.entries(KNOWN_PLACES)) {
                    const pName = (place.name || '').toLowerCase();
                    const matchCount = fuzzyWords.filter(w => key.includes(w) || pName.includes(w)).length;
                    if (matchCount > 0) {
                        similarPlaces.push({ ...place, name: place.name || key, score: matchCount });
                    }
                }
                // 2. POIs aus Firebase
                try {
                    const poisSnap = await db.ref('pois').once('value');
                    if (poisSnap.exists()) {
                        poisSnap.forEach(child => {
                            const poi = child.val();
                            if (!poi.name || !poi.lat || !poi.lon) return;
                            const pName = poi.name.toLowerCase();
                            const pAddr = (poi.address || '').toLowerCase();
                            const matchCount = fuzzyWords.filter(w => pName.includes(w) || pAddr.includes(w)).length;
                            if (matchCount > 0) {
                                const displayName = poi.address ? `${poi.name}, ${poi.address}` : poi.name;
                                similarPlaces.push({ name: displayName, lat: poi.lat, lon: poi.lon, score: matchCount });
                            }
                        });
                    }
                } catch (e) { console.warn('Fuzzy POI-Suche Fehler:', e.message); }
                // 3. Häufige Ziele aus Buchungen
                try {
                    const ridesSnap = await db.ref('rides').orderByChild('createdAt').limitToLast(200).once('value');
                    const seen = new Set();
                    ridesSnap.forEach(child => {
                        const r = child.val();
                        for (const [addr, lat, lon] of [
                            [r.destination, r.destinationLat || (r.destCoords && r.destCoords.lat), r.destinationLon || (r.destCoords && r.destCoords.lon)],
                            [r.pickup, r.pickupLat || (r.pickupCoords && r.pickupCoords.lat), r.pickupLon || (r.pickupCoords && r.pickupCoords.lon)]
                        ]) {
                            if (!addr || !lat || !lon) continue;
                            const key = addr.toLowerCase().trim();
                            if (seen.has(key)) continue;
                            seen.add(key);
                            const matchCount = fuzzyWords.filter(w => key.includes(w)).length;
                            if (matchCount > 0) {
                                similarPlaces.push({ name: addr, lat, lon, score: matchCount });
                            }
                        }
                    });
                } catch (e) { console.warn('Fuzzy Buchungs-Suche Fehler:', e.message); }
                // 4. Kunden mit Adressen
                try {
                    const custSnap = await db.ref('customers').once('value');
                    if (custSnap.exists()) {
                        custSnap.forEach(child => {
                            const c = child.val();
                            if (!c.name || !c.address) return;
                            const cName = c.name.toLowerCase();
                            const cAddr = c.address.toLowerCase();
                            const lat = c.lat || c.pickupLat;
                            const lon = c.lon || c.pickupLon;
                            if (!lat || !lon) return;
                            const matchCount = fuzzyWords.filter(w => cName.includes(w) || cAddr.includes(w)).length;
                            if (matchCount > 0) {
                                similarPlaces.push({ name: `${c.name}, ${c.address}`, lat, lon, score: matchCount });
                            }
                        });
                    }
                } catch (e) { console.warn('Fuzzy Kunden-Suche Fehler:', e.message); }
                // Deduplizieren und sortieren
                const deduped = [];
                for (const p of similarPlaces) {
                    const exists = deduped.some(d => Math.abs(d.lat - p.lat) < 0.001 && Math.abs(d.lon - p.lon) < 0.001);
                    if (!exists) deduped.push(p);
                }
                deduped.sort((a, b) => b.score - a.score);
                const topSimilar = deduped.slice(0, 5);

                if (topSimilar.length > 0) {
                    // Ähnliche Orte gefunden → als Buttons anbieten
                    const simSuggestions = topSimilar.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, source: 'known' }));
                    const keyboard = {
                        inline_keyboard: [
                            ...simSuggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `${prefix}_${i}` }]),
                            [{ text: '✏️ Andere Adresse eingeben', callback_data: `addr_retry_${fieldToResolve}` }],
                            [{ text: '⏩ Weiter ohne Preis', callback_data: 'addr_skip' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                        ]
                    };
                    const pendingState = { partial: { ...booking, missing: [] }, originalText };
                    pendingState.nominatimResults = simSuggestions;
                    if (hasPickupCoords) { pendingState.partial.pickupLat = booking.pickupLat; pendingState.partial.pickupLon = booking.pickupLon; }
                    if (hasDestCoords) { pendingState.partial.destinationLat = booking.destinationLat; pendingState.partial.destinationLon = booking.destinationLon; }
                    pendingState.pendingDestValidation = (needPickup && needDest);
                    await setPending(chatId, pendingState);

                    await addTelegramLog('🔍', chatId, `${fieldLabel} "${addressToResolve}" → ${topSimilar.length} ähnliche Vorschläge`);
                    await sendTelegramMessage(chatId,
                        `🔍 <b>${fieldLabel}: "${addressToResolve}"</b>\n\n` +
                        `Exakte Adresse nicht gefunden. Meinten Sie vielleicht:`,
                        { reply_markup: keyboard }
                    );
                    return null;
                }

                // Wirklich nichts gefunden → Neu eingeben (aber freundlicher)
                await addTelegramLog('⚠️', chatId, `${fieldLabel} "${addressToResolve}" → keine Ergebnisse`);
                await sendTelegramMessage(chatId,
                    `⚠️ <b>${fieldLabel}: "${addressToResolve}" nicht gefunden.</b>\n\n` +
                    `Bitte versuchen Sie es mit:\n• Einem bekannten Ortsnamen (z.B. <i>Seebrücke Heringsdorf</i>)\n• Einer Adresse (z.B. <i>Dünenweg 10, Heringsdorf</i>)\n• Oder senden Sie einen 📍 Standort`
                );
                booking[fieldToResolve] = null;
                if (!booking.missing) booking.missing = [];
                if (!booking.missing.includes(fieldToResolve)) booking.missing.push(fieldToResolve);
                await setPending(chatId, { partial: booking, originalText });
                return null;
            }
        } catch (e) {
            console.warn('Adress-Suche Fehler:', e);
            await addTelegramLog('⚠️', chatId, 'Adress-Suche Fehler: ' + e.message);
        }
    }

    // Beide Adressen haben bereits Koordinaten (GPS, beliebte Ziele, vorherige Auswahl)
    if (hasPickupCoords && hasDestCoords) {
        await addTelegramLog('📍', chatId, `Koordinaten: Pickup(${booking.pickupLat?.toFixed(4)}, ${booking.pickupLon?.toFixed(4)}) → Dest(${booking.destinationLat?.toFixed(4)}, ${booking.destinationLon?.toFixed(4)})`);
        await sendTelegramMessage(chatId, `✅ <b>Adressen verifiziert:</b>\n📍 ${booking.pickup}\n🎯 ${booking.destination}`);
    }
    return booking;
}

// ═══════════════════════════════════════════════════════════════
// ANTHROPIC AI ANALYSE
// ═══════════════════════════════════════════════════════════════

async function callAnthropicAPI(apiKey, model, maxTokens, messages) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages })
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`API-Fehler: ${resp.status} - ${err.error?.message || 'Unbekannt'}`);
    }
    return resp.json();
}

async function getAnthropicApiKey() {
    const snap = await db.ref('settings/anthropic/apiKey').once('value');
    return snap.val() || null;
}


// ═══════════════════════════════════════════════════════════════
// 🆕 v6.10.1: POI-VORSCHLÄGE AUS FAVORITEN
// Durchsucht /pois in Firebase nach passender Kategorie
// ═══════════════════════════════════════════════════════════════

const POI_CATEGORY_KEYWORDS = {
    tierarzt:         { keywords: ['tierarzt', 'tierärztin', 'tierarztpraxis', 'tierklinik', 'tiermedizin', 'veterinär'], label: 'Tierarzt' },
    restaurant:       { keywords: ['restaurant', 'essen', 'essen gehen', 'mittag', 'abendessen', 'speisen', 'gaststätte', 'gasthof', 'lokal'], label: 'Restaurant' },
    cafe:             { keywords: ['café', 'cafe', 'kaffee', 'kuchen', 'frühstück', 'frühstücken', 'torte'], label: 'Café' },
    arzt:             { keywords: ['arzt', 'ärztin', 'doktor', 'praxis', 'arztpraxis', 'hausarzt', 'zahnarzt', 'augenarzt', 'kinderarzt', 'orthopäde', 'facharzt', 'frauenarzt', 'hautarzt', 'hno'], label: 'Arzt' },
    krankenhaus:      { keywords: ['krankenhaus', 'klinik', 'klinikum', 'hospital', 'notaufnahme', 'notarzt'], label: 'Krankenhaus' },
    apotheke:         { keywords: ['apotheke', 'medikamente', 'medizin', 'rezept'], label: 'Apotheke' },
    supermarkt:       { keywords: ['supermarkt', 'einkaufen', 'lebensmittel', 'edeka', 'rewe', 'aldi', 'lidl', 'netto', 'penny'], label: 'Supermarkt' },
    hotel:            { keywords: ['hotel', 'pension', 'unterkunft', 'übernachtung', 'ferienwohnung'], label: 'Hotel' },
    bahnhof:          { keywords: ['bahnhof', 'bahn', 'zug', 'zugfahrt', 'gleis'], label: 'Bahnhof' },
    flughafen:        { keywords: ['flughafen', 'airport', 'fliegen', 'flug'], label: 'Flughafen' },
    faehre:           { keywords: ['fähre', 'faehre', 'fährhafen', 'fährverbindung', 'überfahrt'], label: 'Fähre' },
    strand:           { keywords: ['strand', 'meer', 'ostsee', 'baden', 'schwimmen', 'strandkorb'], label: 'Strand' },
    bank:             { keywords: ['bank', 'geldautomat', 'sparkasse', 'volksbank', 'atm', 'geld abheben'], label: 'Bank' },
    bar:              { keywords: ['bar', 'kneipe', 'cocktail', 'ausgehen', 'trinken gehen', 'nachtleben', 'disco', 'club'], label: 'Bar' },
    kirche:           { keywords: ['kirche', 'gottesdienst', 'kapelle', 'dom'], label: 'Kirche' },
    museum:           { keywords: ['museum', 'ausstellung', 'galerie', 'kultur', 'sehenswürdigkeit', 'besichtigung'], label: 'Museum' },
    post:             { keywords: ['post', 'postamt', 'paket', 'brief', 'dhl'], label: 'Post' },
    behoerde:         { keywords: ['behörde', 'amt', 'rathaus', 'bürgeramt', 'gemeinde', 'verwaltung', 'standesamt'], label: 'Behörde' },
    tankstelle:       { keywords: ['tankstelle', 'tanken', 'benzin', 'diesel', 'ladestation'], label: 'Tankstelle' },
    friseur:          { keywords: ['friseur', 'frisör', 'haare', 'haarschnitt', 'friseurin'], label: 'Friseur' },
    fitness:          { keywords: ['fitness', 'sport', 'gym', 'fitnessstudio', 'schwimmbad', 'hallenbad', 'therme', 'spa', 'wellness'], label: 'Fitness & Wellness' },
    schule:           { keywords: ['schule', 'kindergarten', 'kita', 'gymnasium', 'grundschule'], label: 'Schule' },
    einkaufszentrum:  { keywords: ['einkaufszentrum', 'shopping', 'mall', 'geschäft', 'boutique'], label: 'Einkaufszentrum' },
    werkstatt:        { keywords: ['werkstatt', 'autowerkstatt', 'reparatur', 'tüv', 'reifenwechsel'], label: 'Werkstatt' }
};

async function findPOISuggestionsForText(text) {
    const lower = text.toLowerCase().replace(/[?!.,;:]/g, '');
    const words = lower.split(/\s+/);

    // Finde passende Kategorie – spezifische zuerst (tierarzt vor arzt)
    let matchedCat = null;
    let matchedLabel = null;
    let bestScore = 0;
    for (const [cat, config] of Object.entries(POI_CATEGORY_KEYWORDS)) {
        for (const kw of config.keywords) {
            const kwWords = kw.split(/\s+/);
            let matches = false;
            if (kwWords.length > 1) {
                // Mehrwort-Keyword: muss als Phrase vorkommen
                matches = lower.includes(kw);
            } else {
                // Einzel-Keyword: muss als ganzes Wort vorkommen
                matches = words.some(w => w === kw);
            }
            if (matches && kw.length > bestScore) {
                bestScore = kw.length;
                matchedCat = cat;
                matchedLabel = config.label;
            }
        }
    }
    if (!matchedCat) return null;

    const results = [];
    const seen = new Set();

    // 1. POIs aus /pois laden
    try {
        const snap = await db.ref('pois').orderByChild('category').equalTo(matchedCat).once('value');
        if (snap.exists()) {
            snap.forEach(child => {
                const p = child.val();
                if (p.name && !seen.has(p.name.toLowerCase())) {
                    seen.add(p.name.toLowerCase());
                    results.push({ name: p.name, address: p.address || null, lat: p.lat || null, lon: p.lon || null, matchedCategory: matchedLabel });
                }
            });
        }
    } catch (e) { console.warn('⚠️ POI-Suche (/pois) fehlgeschlagen:', e.message); }

    // 2. CRM-Kunden aus /customers mit passender Kategorie laden
    try {
        const custSnap = await db.ref('customers').orderByChild('category').equalTo(matchedCat).once('value');
        if (custSnap.exists()) {
            custSnap.forEach(child => {
                const c = child.val();
                if (c.name && !seen.has(c.name.toLowerCase())) {
                    seen.add(c.name.toLowerCase());
                    results.push({ name: c.name, address: c.address || null, lat: c.lat || null, lon: c.lon || null, matchedCategory: matchedLabel });
                }
            });
        }
    } catch (e) { console.warn('⚠️ POI-Suche (/customers) fehlgeschlagen:', e.message); }

    return results.length > 0 ? results.slice(0, 5) : null;
}

// ═══════════════════════════════════════════════════════════════
// 🧠 INTELLIGENTER KONVERSATIONS-HANDLER
// Klassifiziert Nachrichten und antwortet kontextbezogen
// ═══════════════════════════════════════════════════════════════

async function handleSmartConversation(chatId, text, userName, knownCustomer) {
    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
        // Ohne API-Key: Fallback auf Buchungsanalyse
        return { intent: 'booking' };
    }

    try {
        const customerContext = knownCustomer
            ? `Der Kunde heißt ${knownCustomer.name}, Tel: ${knownCustomer.phone || 'unbekannt'}.`
            : `Der Nutzer ist noch nicht registriert.`;

        const now = new Date();
        const berlinTime = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const response = await callAnthropicAPI(apiKey, 'claude-haiku-4-5-20251001', 1200, [{
            role: 'user',
            content: `Du bist "Sven", der freundliche Telegram-Assistent von Funk Taxi Heringsdorf auf Usedom.
Du antwortest wie ein netter, hilfsbereiter Taxifahrer – locker aber respektvoll, mit "Sie".
Du denkst mit: Wenn jemand "Tierarzt" schreibt, weisst du dass er einen Tierarzt sucht (nicht einen normalen Arzt).
Wenn jemand "Essen" schreibt, will er Restaurant-Tipps. Du verstehst Kontext und Absicht.
Du beantwortest JEDE Frage – du bist nicht nur ein Buchungsbot, sondern ein hilfreicher Assistent der sich auf Usedom auskennt.

ZEIT: ${berlinTime}
KUNDE: ${customerContext}
NACHRICHT: "${text}"

KLASSIFIZIERE die Nachricht:

"booking" = Will eine FAHRT (nennt Ziel, Zeit, oder sagt "Taxi/abholen/Fahrt"):
  - "Zum Flughafen", "Morgen 10 Uhr Bahnhof", "Kannst du mich zu Dr. Sabel fahren"
  - Entscheidend: Es geht um TRANSPORT von A nach B

"price_inquiry" = Fragt nach PREIS: "Was kostet...", "Wie teuer..."

"question" = Hat eine FRAGE oder sucht EMPFEHLUNGEN:
  - Einzelne Woerter wie "Essen", "Tierarzt", "Hotel", "Strand" = sucht Empfehlungen
  - "Wo ist...", "Gibt es...", "Wann hat... geoeffnet?"
  - Fragen ueber uns (Bezahlung, Kindersitze, Fahrzeuge)
  - Fragen ueber Usedom, Sehenswuerdigkeiten, Tipps, Wetter, Events

"status" = Fragt nach eigenen Buchungen

"greeting" = Hallo, Danke, Tschuess

"unclear" = Passt nicht rein

WICHTIG: Ein einzelnes Wort (Ort/Einrichtung) ohne "Fahrt/Taxi/zum/nach" = question, NICHT booking!

ANTWORT (nur bei question/price_inquiry/greeting/unclear):
- Antworte natuerlich und menschlich, 2-5 Saetze, Deutsch, informativ und hilfreich
- HTML-Tags <b> und <i> erlaubt
- Beantworte die Frage VOLLSTAENDIG mit deinem Wissen – gib echte, nuetzliche Infos!
- Wenn du etwas nicht sicher weisst, sag es ehrlich, aber versuche trotzdem zu helfen

DEIN WISSEN UEBER FUNK TAXI HERINGSDORF:
- 24/7 erreichbar, Tel: 038378/22022
- Fahrzeuge: 2x Toyota Prius (4 Personen), Tesla Model Y (4P), Renault Traffic (8P), Mercedes Vito (8P)
- Bezahlung: Bar + Karte | Kindersitze: auf Anfrage | Haustiere: nach Absprache
- Gebiete: ganz Usedom, Swinemuende (Polen), Flughafen Heringsdorf, Festland-Transfers (Greifswald, Wolgast, Anklam)
- Grundgebuehr: ~4€ (Tag) / ~5,50€ (Nacht 22-6h), dann km-Preis nach Taxameter
- Flughafentransfers, Krankenhaus-Fahrten, Hotelabholung, Ausfluege

DEIN WISSEN UEBER USEDOM (Insel, Ostsee, Mecklenburg-Vorpommern):
Drei Kaiserbaeder: Heringsdorf (groesste, laengste Seebruecke Europas 508m), Ahlbeck (historische Seebruecke von 1882), Bansin (familiaer)
Weitere Orte: Zinnowitz (zweitgroesster Badeort, Seebruecke, Vineta-Festspiele), Koserow (Seebruecke, Streckelsberg 58m hohe Steilkueste, Salzhütten), Ückeritz, Loddin (Loddiner Hoeft Aussichtspunkt), Zempin (kleinster Badeort), Trassenheide (Schmetterlingsfarm), Karlshagen (laengster Sandstrand), Peenemünde (Historisch-Technisches Museum, U-Boot), Wolgast (Tor zur Insel, Peene-Bruecke)
Swinemuende/Swinoujscie (Polen): Grenze zu Fuss/Rad, Mueller-Strand, Festungsanlage, Leuchtturm (hoechster an der Ostsee 68m)

SEHENSWUERDIGKEITEN: Seebruecken (Heringsdorf, Ahlbeck, Zinnowitz, Koserow, Bansin), Baederarchitektur (Villen der Kaiserzeit), Schmetterlingsfarm Trassenheide, Phänomenta Peenemünde, Historisch-Technisches Museum Peenemünde, Wildlife Usedom, Tropenhaus Bansin, Hans-Werner-Richter-Haus Bansin, Kunstpavillon Heringsdorf, OstSee-Therme Ahlbeck/Usedom, Achterland (Naturschutzgebiet), Gothensee, Schmollensee, Achterwasser

STRAENDE: Alle Orte haben Ostsee-Sandstraende, FKK-Straende bei Ückeritz und Bansin, Hundestraende in jedem Ort ausgeschildert

ESSEN & TRINKEN (bekannte Orte):
- Zum Bierkutscher (Bansin, Seestrasse) – rustikal, Fleisch
- Fischbrötchen/Raeucherfisch: Fischkisten an Seebruecken, Aal- und Fischräuchereien
- Café Asgard (Bansin, Strandpromenade) – Kaffee, Kuchen
- Waterfront (Heringsdorf, Seebruecke) – gehobene Kueche
- Typisch: Fischbroetchen, Matjes, Raeucherfisch, Sanddorn-Produkte

NATUR & AKTIVITAETEN: Ostsee-Radweg (Kuesten-Radweg), Wandern (Streckelsberg, Loddiner Hoeft), Bernstein-Suche (nach Sturm), Kitesurfen, SUP, Segeln, Reiten, Golf Balm

ANREISE/TRANSFER: Flughafen Heringsdorf (HDF, saisonal Zuerich/Dortmund), Bahnhof Heringsdorf/Ahlbeck/Zinnowitz (Usedomer Baederbahn UBB von Zuerich/Stralsund/Greifswald), Wolgast (A20 Festland), Faehre Swinemuende

NUR gueltiges JSON, sonst nichts:
{"intent": "...", "response": "..."}`
        }]);

        const content = response?.content?.[0]?.text || '';
        const result = extractJsonFromAiResponse(content);
        return result;
    } catch (e) {
        console.warn('Smart-Konversation Fehler:', e.message);
        return { intent: 'booking' }; // Fallback
    }
}

async function analyzeTelegramBooking(chatId, text, userName, options = {}) {
    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
        await sendTelegramMessage(chatId, '⚠️ AI-Assistent nicht konfiguriert. Bitte Anthropic API-Key in der App eintragen.');
        return;
    }

    const isAdmin = options.forSelf ? false : (options.isAdmin !== undefined ? options.isAdmin : await isTelegramAdmin(chatId));
    const preselected = options.preselectedCustomer || null;
    const forCustomerName = options.forCustomerName || (preselected ? preselected.name : null);
    const hotelGuestName = options.hotelGuestName || null;

    const knownCustomer = preselected ? null : (isAdmin ? null : await getTelegramCustomer(chatId));
    const prefilledName = preselected ? preselected.name : (knownCustomer ? knownCustomer.name : (isAdmin ? forCustomerName : userName));
    const prefilledPhone = preselected ? (preselected.mobilePhone || preselected.phone || null) : (knownCustomer ? (knownCustomer.mobile || knownCustomer.phone || null) : null);
    const phoneRequired = !knownCustomer && !preselected && !isAdmin;

    let homeAddressHint = '';
    if (preselected && preselected.address) homeAddressHint = preselected.address;
    else if (knownCustomer && knownCustomer.address) homeAddressHint = knownCustomer.address;

    await addTelegramLog('👤', chatId, preselected ? `Admin: Vorausgewählter Kunde: ${preselected.name}` : (knownCustomer ? `Bekannter Kunde: ${knownCustomer.name}` : (isAdmin ? 'Admin-Modus' : 'Unbekannter Kunde')));

    const _bookingKeywords = /\b(taxi|cab|fahrt|abholen|mitnehmen|fahrzeug|fahren|bringen)\b/i;
    const _isObviousBooking = _bookingKeywords.test(text);

    const _today = new Date();
    const _todayStr = _today.toISOString().slice(0, 10);
    const _tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const _dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const _todayName = _dayNames[_today.getDay()];
    const _timeStr = `${String(_today.getHours()).padStart(2, '0')}:${String(_today.getMinutes()).padStart(2, '0')}`;

    // 🧠 v6.15.8: KI-Trainings-Regeln laden
    const aiRulesBlock = await loadAiRules();

    try {
        const data = await callAnthropicAPI(apiKey, 'claude-haiku-4-5-20251001', 800, [{
            role: 'user',
            content: `Du bist die Telefonzentrale von "Funk Taxi Heringsdorf" auf Usedom.
Ein Fahrgast schreibt per Telegram. Deine Aufgabe: Buchungsdaten extrahieren und fehlende Infos freundlich erfragen.

FAHRGAST-NACHRICHT: "${text}"
${prefilledName ? `BEKANNTER KUNDE: ${prefilledName}${prefilledPhone ? ` | Tel: ${prefilledPhone}` : ''}` : ''}
${homeAddressHint ? `HEIMADRESSE: "${homeAddressHint}" → bei "zu Hause" / "von zu Hause" verwenden` : ''}${aiRulesBlock}
${hotelGuestName ? `GASTNAME (bereits bekannt): ${hotelGuestName}` : (preselected && isAuftraggeber(preselected.customerKind, preselected.type) ? `${preselected.type === 'supplier' ? '🚚 LIEFERANT' : '🏢 AUFTRAGGEBER'}-ANRUF: ${preselected.name} bucht für einen GAST/PATIENTEN/KUNDEN. Extrahiere:\n- GASTNAME aus dem Gespräch (z.B. "Frau Dahn", "Herr Müller", "Familie Schmidt") → "guestName"\n- GAST-TELEFONNUMMER falls genannt (z.B. Handynummer des Fahrgasts) → "guestPhone"\nWenn nicht erkennbar → null` : '')}

━━━ SCHRITT 1: INTENT ━━━
Ist das eine Taxi-Buchung (oder könnte es eine sein)?
→ JA (intent="buchung"): "Taxi", "Fahrt", "abholen", "ich brauche...", konkrete Fahrtangaben, jede Buchungsabsicht
→ NEIN (intent="sonstiges"): Nur Grüße, Profiländerungen, Abmeldungen, reines Feedback ohne Fahrtbezug
REGEL: Im Zweifel IMMER intent="buchung". Lieber zu großzügig als zu eng.

━━━ SCHRITT 2: DATEN EXTRAHIEREN ━━━
Heute: ${_todayStr} (${_todayName}), Uhrzeit: ${_timeStr} Uhr

DATUM + UHRZEIT → ISO-Format YYYY-MM-DDTHH:MM:
• "morgen 10 Uhr" → ${_tomorrowStr}T10:00
• "heute 18 Uhr" → ${_todayStr}T18:00
• "Freitag 14:30" → [nächster Freitag]T14:30
• Nur Uhrzeit ohne Datum → Datum = heute
• Nur Datum ohne Uhrzeit → datetime = null, "datetime" in missing
• KEIN Datum UND KEINE Uhrzeit genannt → datetime = null, "datetime" MUSS in missing!
• NIEMALS ein Datum/Uhrzeit erfinden oder raten! Nur setzen wenn EXPLIZIT vom Fahrgast genannt!
• NIEMALS 00:00 verwenden!

ADRESSEN:
• Straße + Hausnummer immer vollständig übernehmen
• Bekannte Ziele: "Bahnhof Heringsdorf", "Flughafen Heringsdorf (HDF)", "Seebrücke Heringsdorf"
• Unklare Orte (z.B. nur "Bahnhof", "Kirche", "Hotel") → kurz nachfragen
• NUR ORTSNAME (z.B. "Bansin", "Ahlbeck", "Heringsdorf") OHNE Straße → Adresse übernehmen ABER in question freundlich nach genauer Straße fragen: "Haben Sie eine genaue Adresse in [Ort]? Straße und Hausnummer wäre ideal – oder soll ich den Ortskern nehmen?"
• "zu Hause" / "nach Hause" ohne bekannte Heimadresse → null, in missing, nach Straße fragen
• NIEMALS eine Adresse erfinden oder raten! Nur Adressen setzen die EXPLIZIT im Text stehen.
• Wenn nur ein Name/Titel genannt wird (z.B. "Dr. Krohn", "Hotel Maritim") OHNE Straße → NUR den Namen als Adresse übernehmen, KEINE Straße/Hausnummer dazuerfinden!
• Pickup und Destination müssen UNTERSCHIEDLICHE Orte sein. NIEMALS Teile der Abholadresse (Straße/Hausnummer) für das Ziel verwenden oder umgekehrt.
• Abgeschnittener/unvollständiger Text (z.B. endet mitten im Satz) → fehlende Adressen als null setzen und in missing aufnehmen, NICHT aus dem Kontext raten.

ZWISCHENSTOPPS:
• "Zwischenstopp", "Zwischenhalt", "über", "via", "mit Stopp in/bei/am" → waypoints-Array!
• Beispiel: "Von A nach C mit Zwischenstopp in B" → pickup="A", waypoints=["B"], destination="C"
• Beispiel: "Von A über B nach C" → pickup="A", waypoints=["B"], destination="C"
• Mehrere Stopps möglich: waypoints=["B", "C"] für "über B und C"
• Zwischenstopps sind ADRESSEN, NICHT Notizen! Nie in notes schreiben!
• Wenn keine Zwischenstopps → waypoints=[]${options.isAudioTranscript ? `
⚠️ ACHTUNG: Dies ist ein Audio-Transkript eines Telefonats. Der Text kann abgeschnitten oder unvollständig sein! Besondere Vorsicht: Adressen NUR übernehmen wenn sie KLAR und VOLLSTÄNDIG im Text stehen. Bei abgeschnittenem Text lieber nachfragen als raten.` : ''}

TELEFON: 0157... → +49157... | bereits bekannte Nummer nicht erneut fragen

EMAIL: Wenn eine E-Mail-Adresse im Text vorkommt → in "email" speichern. NICHT aktiv danach fragen.

━━━ SCHRITT 3: FEHLENDE PFLICHTFELDER ━━━
Pflicht: datetime, pickup, destination${phoneRequired ? ', phone' : ''}
Optional (NICHT in missing): passengers (default 1), notes, email${!phoneRequired ? ' | phone ist gespeichert – ABER wenn eine Telefonnummer im Text steht, trotzdem in "phone" extrahieren!' : ''}

⚠️ ERLAUBTE WERTE für "missing": NUR ["datetime", "pickup", "destination"${phoneRequired ? ', "phone"' : ''}]
NIEMALS andere Feldnamen verwenden! Kein "destination_street", "return_datetime", "return_destination", "pickup_street" etc.!

━━━ RÜCKFAHRT / HIN- UND RÜCKFAHRT ━━━
• IMMER NUR EINE FAHRT pro Buchung! Die HINFAHRT hat Priorität.
• Wenn der Kunde Hin- UND Rückfahrt erwähnt → NUR die Hinfahrt in die Felder eintragen
• Rückfahrt-Infos (Rückfahrt-Uhrzeit, Rückfahrt-Ziel) → in "notes" speichern, z.B.: "Rückfahrt gewünscht: ca. 21 Uhr zurück zum Ahlbecker Hof"
• KEINE Rückfahrt-Felder in "missing"! Das System erstellt Rückfahrten separat nach der Hinfahrt.

━━━ SCHRITT 4: RÜCKFRAGE FORMULIEREN ━━━
Wenn Felder fehlen → "question" = EINE einzige, kurze, natürliche Frage
• Reihenfolge: erst datetime, dann pickup, dann destination, dann phone
• Wenn alles vollständig: question = null
${isAdmin ? `
━━━ DISPONENTEN-MODUS ━━━
Du buchst für einen Kunden (nicht für den Disponenten selbst):
• Kundenname → forCustomer
• Kein Name genannt → forCustomer: null` : ''}

━━━ ANTWORT ━━━
Nur gültiges JSON, kein Markdown:
{
  "intent": "buchung",
  "datetime": null,
  "pickup": null,
  "destination": null,
  "waypoints": [],
  "passengers": 1,
  "name": "${prefilledName || (isAdmin ? 'Admin' : userName)}",
  "phone": ${prefilledPhone ? `"${prefilledPhone}"` : 'null'},
  "notes": null,
  "email": null,${isAdmin ? '\n  "forCustomer": null,' : ''}${(preselected && isAuftraggeber(preselected.customerKind, preselected.type)) || hotelGuestName ? '\n  "guestName": null,\n  "guestPhone": null,' : ''}
  "missing": ["datetime", "pickup", "destination"${phoneRequired ? ', "phone"' : ''}],
  "question": "Für wann und von wo nach wo soll die Fahrt gehen?",
  "summary": "Kurze Zusammenfassung der Buchung"
}`
        }]);

        const textContent = data.content.find(c => c.type === 'text')?.text || '';
        const booking = extractJsonFromAiResponse(textContent);

        // 🛡️ v6.16.2: Ungültige missing-Felder entfernen (KI erfindet manchmal eigene Feldnamen)
        const _validMissing = ['datetime', 'pickup', 'destination', 'phone'];
        if (booking.missing && Array.isArray(booking.missing)) {
            const _invalidFields = booking.missing.filter(f => !_validMissing.includes(f));
            if (_invalidFields.length > 0) {
                await addTelegramLog('🛡️', chatId, `Ungültige missing-Felder entfernt: ${_invalidFields.join(', ')}`);
                booking.missing = booking.missing.filter(f => _validMissing.includes(f));
            }
        }

        // Datum-Halluzinations-Schutz: Wenn der User kein Datum/Uhrzeit geschrieben hat, datetime löschen
        const _timeKeywords = /\b(\d{1,2}[:.]\d{2}|\d{1,2}\s*uhr|heute|morgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|nächst|um\s+\d|ab\s+\d|sofort|jetzt|gleich|nachher|abend|mittag|früh|vormittag|nachmittag|nacht)\b/i;
        if (booking.datetime && !_timeKeywords.test(text)) {
            await addTelegramLog('🛡️', chatId, `Datum-Schutz: AI hat "${booking.datetime}" gesetzt, aber User schrieb "${text}" ohne Zeitangabe → datetime gelöscht`);
            booking.datetime = null;
            if (!booking.missing) booking.missing = [];
            if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
        }

        // Jahres-Sanitycheck
        if (booking.datetime && typeof booking.datetime === 'string') {
            const correctYear = new Date().getFullYear();
            const dtYear = parseInt(booking.datetime.slice(0, 4));
            if (dtYear < correctYear || dtYear > correctYear + 1) {
                booking.datetime = correctYear + booking.datetime.slice(4);
            }
        }

        // 🕐 v6.11.6: "jetzt"/"sofort"/"gleich" Fix — aktuelle Zeit + 10 Min statt 00:00
        const _jetztKeywords = /\b(jetzt|sofort|gleich|so schnell wie möglich|asap|schnellstmöglich)\b/i;
        if (_jetztKeywords.test(text)) {
            const berlinNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
            berlinNow.setMinutes(berlinNow.getMinutes() + 10);
            const pad = n => String(n).padStart(2, '0');
            const jetztDatetime = `${berlinNow.getFullYear()}-${pad(berlinNow.getMonth() + 1)}-${pad(berlinNow.getDate())}T${pad(berlinNow.getHours())}:${pad(berlinNow.getMinutes())}`;
            if (!booking.datetime || booking.datetime.endsWith('T00:00')) {
                await addTelegramLog('🕐', chatId, `Jetzt-Fix: "${text}" → ${jetztDatetime} (aktuelle Zeit + 10 Min)`);
                booking.datetime = jetztDatetime;
                booking._isJetzt = true;  // Flag für Sofortfahrt-Anzeige
                // "datetime" aus missing entfernen falls vorhanden
                if (booking.missing && Array.isArray(booking.missing)) {
                    booking.missing = booking.missing.filter(m => m !== 'datetime');
                }
            }
        }

        // 🛡️ v6.15.1: Vergangenheits-Schutz — wenn Datum+Uhrzeit in der Vergangenheit liegt, nachfragen
        if (booking.datetime && typeof booking.datetime === 'string' && booking.datetime.includes('T')) {
            const berlinNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
            const [datePart, timePart] = booking.datetime.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const [hours, minutes] = timePart.split(':').map(Number);
            const bookingDate = new Date(year, month - 1, day, hours, minutes);
            // Prüfe ob der Termin mehr als 15 Minuten in der Vergangenheit liegt
            const diffMinutes = (bookingDate - berlinNow) / 60000;
            if (diffMinutes < -15) {
                const pad = n => String(n).padStart(2, '0');
                const bookingTimeStr = `${pad(hours)}:${pad(minutes)}`;
                const nowTimeStr = `${pad(berlinNow.getHours())}:${pad(berlinNow.getMinutes())}`;
                await addTelegramLog('🛡️', chatId, `Vergangenheits-Schutz: Termin ${booking.datetime} liegt in der Vergangenheit (jetzt: ${nowTimeStr}) → datetime gelöscht, wird nachgefragt`);
                booking.datetime = null;
                if (!booking.missing) booking.missing = [];
                if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
                // Spezifische Rückfrage: Heute-gleicher-Tag oder anderer Tag?
                const isToday = bookingDate.getDate() === berlinNow.getDate() && bookingDate.getMonth() === berlinNow.getMonth();
                if (isToday) {
                    booking.question = `⏰ ${bookingTimeStr} Uhr ist leider schon vorbei (es ist ${nowTimeStr} Uhr). Meinen Sie morgen ${bookingTimeStr} Uhr, oder eine andere Uhrzeit?`;
                } else {
                    booking.question = `⏰ Der Termin ${pad(day)}.${pad(month)}. ${bookingTimeStr} Uhr liegt in der Vergangenheit. Bitte nennen Sie ein aktuelles Datum.`;
                }
            }
        }

        // 🛡️ v6.15.2: Adress-Duplikat-Schutz — nur echte Straßen-Duplikate erkennen (PLZ + Ortsname ignorieren)
        if (booking.pickup && booking.destination) {
            const _pickupLower = booking.pickup.toLowerCase();
            const _destLower = booking.destination.toLowerCase();
            // PLZ extrahieren (5-stellige Zahlen)
            const _pickupPLZ = (_pickupLower.match(/\b\d{5}\b/g) || []);
            // Ortsname = letztes Wort nach PLZ (z.B. "Heringsdorf", "Bansin", "Ahlbeck")
            const _pickupOrt = (_pickupLower.match(/\b\d{5}\s+(\w+)/g) || []).map(m => m.replace(/\d{5}\s+/, ''));
            // Wörter die ignoriert werden: PLZ + Ortsname + generische Begriffe
            const _ignoreWords = [..._pickupPLZ, ..._pickupOrt, 'straße', 'strasse', 'weg', 'ring', 'platz', 'allee', 'gasse'];

            const _pickupParts = _pickupLower.replace(/[,.\-\/]/g, ' ').split(/\s+/).filter(p => p.length > 3);
            // Nur Straßen-relevante Teile vergleichen: Wörter mit Ziffern (Hausnummern) oder lange Wörter, ABER keine PLZ/Ortsnamen
            const _streetMatch = _pickupParts
                .filter(p => /\d/.test(p) || p.length > 5)
                .filter(p => !_ignoreWords.some(iw => p === iw || p === iw))
                .filter(p => !/^\d{5}$/.test(p)) // PLZ ausschließen
                .filter(p => _destLower.includes(p));
            if (_streetMatch.length >= 2 && _pickupLower !== _destLower) {
                await addTelegramLog('🛡️', chatId, `Adress-Schutz: Ziel "${booking.destination}" enthält Teile der Abholadresse "${booking.pickup}" → Ziel gelöscht, wird nachgefragt`, { matchedParts: _streetMatch });
                booking.destination = null;
                if (!booking.missing) booking.missing = [];
                if (!booking.missing.includes('destination')) booking.missing.push('destination');
                booking.question = booking.question || 'Wohin soll die Fahrt gehen?';
            }
        }

        await addTelegramLog('🤖', chatId, `KI-Analyse: ${booking.summary || '(kein Summary)'}`, {
            intent: booking.intent, datetime: booking.datetime, pickup: booking.pickup,
            destination: booking.destination, missing: booking.missing
        });

        // Intent-Check
        const _hasBookingData = booking.pickup || booking.destination || booking.datetime;
        if (_isObviousBooking && booking.intent !== 'buchung') booking.intent = 'buchung';
        if ((booking.intent && booking.intent !== 'buchung') || (!booking.intent && !_hasBookingData)) {
            await sendTelegramMessage(chatId,
                '😊 Das habe ich leider nicht als Taxifahrt erkannt.\n\n' +
                'Ich bin speziell für <b>Taxi-Buchungen</b> da! Schreiben Sie mir zum Beispiel:\n' +
                '<i>„Morgen 10 Uhr vom Bahnhof Heringsdorf nach Ahlbeck"</i>'
            );
            return;
        }

        // Admin-Modus
        if (isAdmin) {
            booking._adminBooked = true;
            booking._adminChatId = chatId;
            if (preselected) {
                booking.name = preselected.name;
                // 🔧 v6.14.7: mobilePhone bevorzugen — nicht nur phone!
                booking.phone = preselected.mobilePhone || preselected.phone || booking.phone;
                booking._customerAddress = preselected.address;
                booking._forCustomer = preselected.name;
                booking._crmCustomerId = preselected.customerId || null;
                if ((preselected.mobilePhone || preselected.phone) && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');
                const pickupDefault = preselected.defaultPickup || preselected.address;
                const _isAuftraggeberKunde = isAuftraggeber(preselected.customerKind, preselected.type);

                // 🆕 v6.15.0: Auftraggeber (Hotel/Firma/Klinik) → CRM-Adresse NICHT automatisch als Pickup
                // Stattdessen: In continueBookingFlow fragen "Abholort oder Zielort?"
                if (_isAuftraggeberKunde && pickupDefault) {
                    booking._auftraggeberAddress = pickupDefault;
                    booking._auftraggeberName = preselected.name;
                    if (preselected.addressLat && preselected.addressLon) {
                        booking._auftraggeberLat = parseFloat(preselected.addressLat);
                        booking._auftraggeberLon = parseFloat(preselected.addressLon);
                    }
                    // Nur "zu Hause"/"nach Hause" direkt auflösen
                    if (booking.pickup && /^(zu hause|zuhause|von zu hause|von zuhause)$/i.test(booking.pickup.trim())) {
                        booking.pickup = pickupDefault;
                        booking.missing = (booking.missing || []).filter(f => f !== 'pickup');
                        if (preselected.addressLat && preselected.addressLon) {
                            booking.pickupLat = parseFloat(preselected.addressLat);
                            booking.pickupLon = parseFloat(preselected.addressLon);
                        }
                    }
                    if (booking.destination && /^(zu hause|zuhause|nach hause)$/i.test(booking.destination.trim())) {
                        booking.destination = pickupDefault;
                        booking.missing = (booking.missing || []).filter(f => f !== 'destination');
                        if (preselected.addressLat && preselected.addressLon) {
                            booking.destinationLat = parseFloat(preselected.addressLat);
                            booking.destinationLon = parseFloat(preselected.addressLon);
                        }
                    }
                } else if (pickupDefault) {
                    if (!booking.pickup || /^(zu hause|zuhause|von zu hause|von zuhause)$/i.test((booking.pickup || '').trim())) {
                        booking.pickup = pickupDefault;
                        booking.missing = (booking.missing || []).filter(f => f !== 'pickup');
                        // 🔧 v6.14.3: Koordinaten aus Kunden-Geocoding übernehmen → keine erneute Nominatim-Abfrage
                        if (preselected.addressLat && preselected.addressLon) {
                            booking.pickupLat = parseFloat(preselected.addressLat);
                            booking.pickupLon = parseFloat(preselected.addressLon);
                        }
                    }
                    if (preselected.address && /^(zu hause|zuhause|nach hause)$/i.test((booking.destination || '').trim())) {
                        booking.destination = preselected.address;
                        booking.missing = (booking.missing || []).filter(f => f !== 'destination');
                        // 🔧 v6.14.3: Koordinaten für Ziel übernehmen
                        if (preselected.addressLat && preselected.addressLon) {
                            booking.destinationLat = parseFloat(preselected.addressLat);
                            booking.destinationLon = parseFloat(preselected.addressLon);
                        }
                    }
                }
            } else if (forCustomerName) {
                booking.name = forCustomerName;
                booking._forCustomer = forCustomerName;
                booking._crmCustomerId = null;
            }

            // 🆕 v6.15.0: Gastname/Gast-Telefon — für alle Auftraggeber (Hotel, Firma, Klinik)
            if (hotelGuestName) {
                booking.guestName = hotelGuestName;
                booking._isAuftraggeberBooking = true;
            } else if (preselected && isAuftraggeber(preselected.customerKind, preselected.type)) {
                booking._isAuftraggeberBooking = true;
                const _isSupplier = preselected.type === 'supplier';
                if (_isSupplier) booking._isSupplierBooking = true; // 🆕 v6.15.1: Lieferant-Flag
                const _logEmoji = _isSupplier ? '🚚' : '🏢';
                const _logLabel = _isSupplier ? 'Lieferant' : 'Auftraggeber';
                if (booking.guestName) {
                    await addTelegramLog(_logEmoji, chatId, `KI hat Gastname aus Transkript erkannt: "${booking.guestName}"`);
                } else {
                    await addTelegramLog(_logEmoji, chatId, `${_logLabel}-Buchung ohne Gastname — wird nachgefragt`);
                }
                // 🆕 v6.15.0: Gast-Telefonnummer aus KI-Analyse übernehmen
                if (booking.guestPhone) {
                    await addTelegramLog('📱', chatId, `KI hat Gast-Telefon aus Transkript erkannt: "${booking.guestPhone}"`);
                }
            }

            // CRM-Suche wenn Kundenname in Nachricht
            const customerSearchName = (!preselected && !forCustomerName) ? (booking.forCustomer || null) : null;
            if (customerSearchName) {
                const allCust = await loadAllCustomers();
                const matches = findAllCustomersForSecretary(allCust, customerSearchName);
                if (matches.length === 1) {
                    const found = matches[0];
                    const confirmId = Date.now().toString(36);
                    await setPending(chatId, { partial: booking, crmConfirm: { found, confirmId }, originalText: text });
                    let confirmMsg = `🔍 <b>Kunden im CRM gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
                    // 🔧 v6.14.7: Auch mobilePhone anzeigen
            const _dispPhone = found.mobilePhone || found.phone;
            if (_dispPhone) confirmMsg += `📱 ${_dispPhone}\n`;
                    if (found.address) confirmMsg += `🏠 ${found.address}\n`;
                    confirmMsg += `\n<b>Ist das der richtige Kunde?</b>`;
                    await sendTelegramMessage(chatId, confirmMsg, { reply_markup: { inline_keyboard: [[
                        { text: '✅ Ja, genau!', callback_data: `crm_confirm_yes_${confirmId}` },
                        { text: '❌ Anderer Kunde', callback_data: `crm_confirm_no_${confirmId}` }
                    ]] } });
                    return;
                } else if (matches.length > 1) {
                    const confirmId = Date.now().toString(36);
                    await setPending(chatId, { partial: booking, crmMultiSelect: { matches, confirmId }, originalText: text });
                    let selectMsg = `🔍 <b>Mehrere Kunden gefunden für „${customerSearchName}":</b>\n\nWelchen Kunden meinen Sie?`;
                    const buttons = matches.map((m, i) => {
                        let label = `👤 ${m.name}`;
                        if (m.address) label += ` · 📍 ${m.address.length > 30 ? m.address.slice(0, 28) + '…' : m.address}`;
                        return [{ text: label, callback_data: `crm_select_${i}_${confirmId}` }];
                    });
                    buttons.push([{ text: '🆕 Keiner davon – neu anlegen', callback_data: `crm_confirm_no_${confirmId}` }]);
                    await sendTelegramMessage(chatId, selectMsg, { reply_markup: { inline_keyboard: buttons } });
                    return;
                } else {
                    booking.name = customerSearchName;
                    booking._forCustomer = customerSearchName;
                    booking._crmCustomerId = null;
                    // 🔧 v6.15.6: Telefonnummer aus Originaltext extrahieren bevor wir fragen
                    if (!booking.phone && text) {
                        const _phoneMatch = text.match(/(?:\+49|0049|0)\s*(\d[\d\s\-\/]{6,14}\d)/);
                        if (_phoneMatch) {
                            let _extractedPhone = _phoneMatch[0].replace(/[\s\-\/]/g, '');
                            if (_extractedPhone.startsWith('0') && !_extractedPhone.startsWith('00')) {
                                _extractedPhone = '+49' + _extractedPhone.slice(1);
                            } else if (_extractedPhone.startsWith('0049')) {
                                _extractedPhone = '+49' + _extractedPhone.slice(4);
                            }
                            // 🆕 v6.25.1: Validierung der extrahierten Nummer
                            const _phoneValid = validatePhoneNumber(_extractedPhone);
                            booking.phone = _extractedPhone;
                            if (_phoneValid.valid) {
                                await addTelegramLog('📱', chatId, `Telefonnummer aus Text extrahiert: ${_extractedPhone}`);
                            } else {
                                await addTelegramLog('⚠️', chatId, `Telefonnummer extrahiert aber möglicherweise ungültig: ${_extractedPhone} — ${_phoneValid.warning}`);
                            }
                        }
                    }
                    if (!booking.phone) {
                        booking.missing = booking.missing || [];
                        if (!booking.missing.includes('phone')) booking.missing.push('phone');
                    }
                }
            }
        }

        // 🆕 Vorausgefüllte Koordinaten aus Favoriten übernehmen (überspringt Adress-Bestätigung)
        // 🔧 v6.25.4: PLZ-Distanz-Check — bei Mismatch Koordinaten verwerfen und neu geocodieren lassen
        const prefilledCoords = options.prefilledCoords || null;
        if (prefilledCoords) {
            const _checkPlzDist = (addr, lat, lon) => {
                if (!addr || !lat || !lon) return true;
                const plzM = addr.match(/\b(1742[0-9]|1741[0-9]|1743[0-9]|1744[0-9]|1745[0-9])\b/);
                if (!plzM || !PLZ_CENTERS[plzM[1]]) return true;
                const c = PLZ_CENTERS[plzM[1]];
                return distanceKm(parseFloat(lat), parseFloat(lon), c.lat, c.lon) <= PLZ_MAX_RADIUS_KM;
            };
            if (prefilledCoords.pickupLat && prefilledCoords.pickupLon) {
                if (_checkPlzDist(booking.pickup, prefilledCoords.pickupLat, prefilledCoords.pickupLon)) {
                    booking.pickupLat = prefilledCoords.pickupLat;
                    booking.pickupLon = prefilledCoords.pickupLon;
                } else {
                    console.log(`[PLZ-Filter] Prefilled Pickup-Koordinaten verworfen (PLZ-Mismatch für "${booking.pickup}")`);
                }
            }
            if (prefilledCoords.destinationLat && prefilledCoords.destinationLon) {
                if (_checkPlzDist(booking.destination, prefilledCoords.destinationLat, prefilledCoords.destinationLon)) {
                    booking.destinationLat = prefilledCoords.destinationLat;
                    booking.destinationLon = prefilledCoords.destinationLon;
                } else {
                    console.log(`[PLZ-Filter] Prefilled Destination-Koordinaten verworfen (PLZ-Mismatch für "${booking.destination}")`);
                }
            }
            await addTelegramLog('📍', chatId, `Koordinaten aus Favoriten: Pickup(${booking.pickupLat?.toFixed?.(4) || '–'}, ${booking.pickupLon?.toFixed?.(4) || '–'}) → Dest(${booking.destinationLat?.toFixed?.(4) || '–'}, ${booking.destinationLon?.toFixed?.(4) || '–'})`);
        }

        // Defensive missing-Prüfung
        if (!booking.missing) booking.missing = [];
        if (!booking.pickup && !booking.missing.includes('pickup')) booking.missing.push('pickup');
        if (!booking.destination && !booking.missing.includes('destination')) booking.missing.push('destination');
        if (!booking.datetime && !booking.missing.includes('datetime')) booking.missing.push('datetime');

        // 🆕 v6.20.1: Erkannte Daten als Übersicht anzeigen
        const _recognized = [];
        if (booking.datetime) {
            const _dt = new Date(booking.datetime.includes('T') ? booking.datetime : booking.datetime + 'T00:00');
            _recognized.push(`📅 ${_dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit' })} um ${_dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr`);
        }
        if (booking.pickup) _recognized.push(`📍 Von: ${booking.pickup}`);
        if (booking.destination) _recognized.push(`🎯 Nach: ${booking.destination}`);
        if (booking.notes) _recognized.push(`📝 ${booking.notes}`);
        if (_recognized.length > 0) {
            await sendTelegramMessage(chatId, `🤖 <b>Erkannt:</b>\n${_recognized.join('\n')}`);
        }

        await continueBookingFlow(chatId, booking, text);

    } catch (e) {
        console.error('Analyse-Fehler:', e);
        await addTelegramLog('❌', chatId, 'Analyse-Fehler: ' + e.message);
        await sendTelegramMessage(chatId, '⚠️ Fehler bei der Analyse: ' + e.message + '\n\nBitte versuche es nochmal.');
    }
}

// ═══════════════════════════════════════════════════════════════
// BUCHUNGS-FLOW
// ═══════════════════════════════════════════════════════════════

async function continueBookingFlow(chatId, booking, originalText) {
    try {
        if (!booking.missing) booking.missing = [];
        if (!booking.pickup && !booking.missing.includes('pickup')) booking.missing.push('pickup');
        if (!booking.destination && !booking.missing.includes('destination')) booking.missing.push('destination');
        if (!booking.datetime && !booking.missing.includes('datetime')) booking.missing.push('datetime');

        // 🆕 v6.15.0: Auftraggeber-Adresse → "Abholort oder Zielort?" fragen
        // Wenn Auftraggeber-Adresse bekannt, aber sowohl pickup als auch destination fehlen
        if (booking._auftraggeberAddress && !booking._auftraggeberResolved) {
            const _needsPickup = !booking.pickup || booking.missing.includes('pickup');
            const _needsDest = !booking.destination || booking.missing.includes('destination');
            // Prüfe ob die Auftraggeber-Adresse schon als Pickup oder Destination zugeordnet ist
            const _addrAlreadyUsed = (booking.pickup && booking.pickup === booking._auftraggeberAddress) ||
                                      (booking.destination && booking.destination === booking._auftraggeberAddress);
            if ((_needsPickup || _needsDest) && !_addrAlreadyUsed) {
                const _shortAddr = booking._auftraggeberAddress.length > 35
                    ? booking._auftraggeberAddress.substring(0, 33) + '…'
                    : booking._auftraggeberAddress;
                const bookingId = Date.now().toString(36);
                await setPending(chatId, {
                    partial: booking, originalText, bookingId,
                    _awaitingAuftraggeberRole: true
                });
                const noted = [];
                if (booking.datetime) {
                    const d = new Date(parseGermanDatetime(booking.datetime));
                    noted.push(`📅 ${d.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${d.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr`);
                }
                if (booking.pickup) noted.push(`📍 Von: ${booking.pickup}`);
                if (booking.destination) noted.push(`🎯 Nach: ${booking.destination}`);
                let msg = '';
                if (noted.length > 0) msg += `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;
                msg += `🏢 <b>${booking._auftraggeberName || 'Auftraggeber'}</b>\n📍 ${booking._auftraggeberAddress}\n\n`;
                msg += `Ist <b>${_shortAddr}</b> der Abholort oder das Ziel?`;
                await addTelegramLog('🏢', chatId, `Auftraggeber-Adresse: Frage Abholort/Zielort für "${booking._auftraggeberAddress}"`);
                await sendTelegramMessage(chatId, msg, {
                    reply_markup: { inline_keyboard: [
                        [{ text: '📍 Abholort (von dort)', callback_data: `auftr_pickup_${bookingId}` }],
                        [{ text: '🎯 Zielort (dorthin)', callback_data: `auftr_dest_${bookingId}` }],
                        [{ text: '❌ Weder noch', callback_data: `auftr_skip_${bookingId}` }]
                    ] }
                });
                return;
            }
        }

        // 🆕 v6.25.3: CRM-Adresse als Shortcut — wenn Kunde bekannt ist und Adresse ähnlich,
        // direkt CRM-Koordinaten verwenden statt neu zu geocoden
        if (booking.customerId && (booking.pickup && !booking.pickupLat || booking.destination && !booking.destinationLat)) {
            try {
                const _crmSnap = await db.ref('customers/' + booking.customerId).once('value');
                const _crm = _crmSnap.val();
                if (_crm && _crm.address) {
                    const _crmAddr = _crm.address.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
                    const _crmLat = _crm.lat || _crm.pickupLat;
                    const _crmLon = _crm.lon || _crm.pickupLon;
                    if (_crmLat && _crmLon) {
                        // Pickup prüfen
                        if (booking.pickup && !booking.pickupLat) {
                            const _pAddr = booking.pickup.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
                            // Ähnlichkeits-Check: CRM-Adresse enthält Pickup oder umgekehrt (min. 10 Zeichen Übereinstimmung)
                            if (_crmAddr.length > 10 && (_crmAddr.includes(_pAddr.substring(0, 15)) || _pAddr.includes(_crmAddr.substring(0, 15)))) {
                                booking.pickup = _crm.address; // Vollständige CRM-Adresse verwenden
                                booking.pickupLat = _crmLat;
                                booking.pickupLon = _crmLon;
                                console.log('📍 CRM-Adresse erkannt für Pickup:', _crm.address, _crmLat, _crmLon);
                                await addTelegramLog('📍', chatId, `Adress-Check: "${booking.pickup}" → CRM-Match: ${_crm.address}`);
                            }
                        }
                        // Destination prüfen
                        if (booking.destination && !booking.destinationLat) {
                            const _dAddr = booking.destination.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
                            if (_crmAddr.length > 10 && (_crmAddr.includes(_dAddr.substring(0, 15)) || _dAddr.includes(_crmAddr.substring(0, 15)))) {
                                booking.destination = _crm.address;
                                booking.destinationLat = _crmLat;
                                booking.destinationLon = _crmLon;
                                console.log('📍 CRM-Adresse erkannt für Destination:', _crm.address, _crmLat, _crmLon);
                            }
                        }
                    }
                }
            } catch(e) { console.warn('CRM-Adress-Check Fehler:', e.message); }
        }

        // 🆕 v6.11.4: Adressen SOFORT validieren – "Meinten Sie...?" bevor nach fehlenden Feldern gefragt wird
        // Nur wenn Adresse da ist ABER noch keine Koordinaten
        const needsPickupResolve = booking.pickup && !booking.pickupLat && !booking.pickupLon;
        const needsDestResolve = booking.destination && !booking.destinationLat && !booking.destinationLon;

        if (needsPickupResolve || needsDestResolve) {
            const fieldToResolve = needsPickupResolve ? 'pickup' : 'destination';
            const addressToResolve = needsPickupResolve ? booking.pickup : booking.destination;
            const fieldLabel = needsPickupResolve ? '📍 Abholort' : '🎯 Zielort';
            const prefix = needsPickupResolve ? 'np' : 'nd';

            const suggestions = await searchNominatimForTelegram(addressToResolve);

            if (suggestions.length > 0) {
                // Prüfe ob erster Treffer exakt passt (Name enthält Suchbegriff und umgekehrt)
                const topHit = suggestions[0];
                const searchLower = addressToResolve.toLowerCase().trim();
                const topLower = topHit.name.toLowerCase().trim();
                const isExactMatch = topLower === searchLower || (topLower.startsWith(searchLower) && topHit.source === 'known');

                if (isExactMatch && suggestions.length === 1) {
                    // Exakter Treffer – direkt übernehmen, keine Rückfrage nötig
                    if (needsPickupResolve) {
                        booking.pickup = topHit.name;
                        booking.pickupLat = topHit.lat;
                        booking.pickupLon = topHit.lon;
                    } else {
                        booking.destination = topHit.name;
                        booking.destinationLat = topHit.lat;
                        booking.destinationLon = topHit.lon;
                    }
                    await addTelegramLog('✅', chatId, `${fieldLabel} "${addressToResolve}" → exakt: ${topHit.name}`);
                    // Falls die andere Adresse auch aufgelöst werden muss, rekursiv
                    if (needsPickupResolve && needsDestResolve) {
                        return await continueBookingFlow(chatId, booking, originalText);
                    }
                } else {
                    // Mehrere Treffer oder kein exakter → "Meinten Sie...?" Buttons zeigen
                    // 🔧 v6.25.4: Zurück-Button bei Zielort-Vorschlägen
                    const _addrLastRow2 = [];
                    if (!needsPickupResolve && needsDestResolve) {
                        _addrLastRow2.push({ text: '◀️ Zurück', callback_data: 'addr_back_to_pickup' });
                    }
                    _addrLastRow2.push({ text: '❌ Abbrechen', callback_data: 'cancel_booking' });
                    const keyboard = {
                        inline_keyboard: [
                            ...suggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `${prefix}_${i}` }]),
                            [{ text: '✏️ Andere Adresse eingeben', callback_data: `addr_retry_${fieldToResolve}` }],
                            _addrLastRow2
                        ]
                    };

                    const pendingState = { partial: { ...booking, missing: booking.missing }, originalText };
                    pendingState.nominatimResults = suggestions;
                    pendingState.pendingDestValidation = (needsPickupResolve && needsDestResolve);
                    await setPending(chatId, pendingState);

                    await addTelegramLog('🔍', chatId, `${fieldLabel} "${addressToResolve}" → ${suggestions.length} Vorschläge`);
                    await sendTelegramMessage(chatId,
                        `🔍 <b>${fieldLabel}: "${addressToResolve}"</b>\n\n` +
                        `Meinten Sie:`,
                        { reply_markup: keyboard }
                    );
                    return; // Warte auf Kundenauswahl
                }
            }
            // Keine Ergebnisse → Adresse trotzdem behalten, wird am Ende nochmal validiert
        }

        if (booking.missing && booking.missing.length > 0) {
            let msg = '';
            const noted = [];
            if (booking.datetime) {
                const d = new Date(parseGermanDatetime(booking.datetime));
                noted.push(`📅 ${d.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${d.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr`);
            }
            if (booking.pickup) noted.push(`📍 Von: ${booking.pickup}`);
            if (booking.destination) noted.push(`🎯 Nach: ${booking.destination}`);
            if (booking.passengers > 1) noted.push(`👥 ${booking.passengers} Personen`);
            if (noted.length > 0) msg += `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;
            if (booking.question) {
                msg += `💬 ${booking.question}`;
            } else {
                const firstMissing = booking.missing[0];
                const fallbacks = { datetime: '<b>Wann</b> soll das Taxi kommen?\n⌨️ Tippen Sie <b>Datum + Uhrzeit</b> unten ins Eingabefeld, z.B. <b>15.06.2026 14:30</b>', pickup: '<b>Abholort</b> – wo sollen wir Sie abholen?\n⌨️ <b>Adresse</b> unten ins Eingabefeld tippen\n📎 Oder: <b>Büroklammer 📎</b> → <b>Standort senden</b>', destination: '<b>Zielort</b> – wohin soll die Fahrt gehen?\n⌨️ <b>Adresse</b> unten ins Eingabefeld tippen\n📎 Oder: <b>Büroklammer 📎</b> → <b>Standort senden</b>', phone: '⌨️ Bitte <b>Telefonnummer</b> unten ins Eingabefeld tippen, z.B. <b>0171 1234567</b>' };
                msg += `💬 ${fallbacks[firstMissing] || 'Können Sie mir noch mehr Details geben?'}`;
            }
            // 🆕 v6.16.1: DATETIME → Datum/Uhrzeit-Picker anzeigen
            const _firstMissing = (booking.missing && booking.missing.length > 0) ? booking.missing[0] : null;
            if (_firstMissing === 'datetime') {
                await showDateTimePicker(chatId, booking, originalText);
                return;
            }

            // 🆕 v6.14.0: Inline-Buttons für Abholort/Zielort mit Zuhause-Frage
            const _inlineButtons = [];

            // 🆕 v6.14.0: ABHOLORT → Frage "Von zu Hause oder anderer Ort?"
            if (_firstMissing === 'pickup' && !booking._adminBooked) {
                const _knownCust = await getTelegramCustomer(chatId);
                if (_knownCust && _knownCust.address) {
                    // Kunde hat Adresse → Zuhause-Button + Anderer Ort
                    msg = '';
                    if (noted.length > 0) msg += `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;
                    msg += '📍 <b>Abholort – wo sollen wir Sie abholen?</b>\nWählen Sie unten oder senden Sie Ihren <b>Standort 📎</b>';
                    _inlineButtons.push([{ text: '🏠 Von zu Hause (' + (_knownCust.address.length > 25 ? _knownCust.address.substring(0, 23) + '…' : _knownCust.address) + ')', callback_data: 'use_home_pickup' }]);
                }
                // Favoriten-Abholort (wenn vorhanden und anders als Zuhause)
                if (_knownCust && _knownCust.customerId) {
                    try {
                        const _custSnap = await db.ref('customers/' + _knownCust.customerId).once('value');
                        const _custData = _custSnap.val();
                        if (_custData && _custData.defaultPickup && _custData.defaultPickup !== (_knownCust ? _knownCust.address : '')) {
                            _inlineButtons.push([{ text: '📍 ' + (_custData.defaultPickup.length > 35 ? _custData.defaultPickup.substring(0, 33) + '…' : _custData.defaultPickup), callback_data: 'use_default_pickup' }]);
                        }
                    } catch(_e) { /* ignore */ }
                }
                _inlineButtons.push([{ text: '📍 Anderer Ort (Standort senden)', callback_data: 'pickup_other_location' }]);
            } else if (_firstMissing === 'pickup') {
                // Admin-Modus oder kein Kunde → nur Standort-Tipp
                msg += '\n\n📍 Oder: <b>Büroklammer 📎</b> antippen → <b>Standort senden</b>';
            }

            // 🆕 v6.14.0: ZIELORT → Frage "Nach Hause oder anderes Ziel?"
            if (_firstMissing === 'destination' && !booking._adminBooked) {
                const _knownCust2 = await getTelegramCustomer(chatId);
                if (_knownCust2 && _knownCust2.address) {
                    // Kunde hat Adresse → Nach-Hause-Button
                    msg = '';
                    if (noted.length > 0) msg += `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;
                    msg += '🎯 <b>Zielort – wohin soll die Fahrt gehen?</b>\nWählen Sie unten oder senden Sie den <b>Standort 📎</b>';
                    _inlineButtons.push([{ text: '🏠 Nach Hause (' + (_knownCust2.address.length > 25 ? _knownCust2.address.substring(0, 23) + '…' : _knownCust2.address) + ')', callback_data: 'use_home_dest' }]);
                }
                // Favoriten-Ziele
                if (_knownCust2 && _knownCust2.customerId) {
                    try {
                        const favDests = await getCustomerFavoriteDestinations(_knownCust2.name, _knownCust2.phone);
                        if (favDests && favDests.length > 0) {
                            const destBtns = favDests.slice(0, 3).map((d, i) => ({
                                text: '⭐ ' + (d.name || d.address || '').substring(0, 30),
                                callback_data: 'fav_dest_' + i
                            }));
                            _inlineButtons.push(destBtns);
                        }
                    } catch(_e) { /* ignore */ }
                }
                _inlineButtons.push([{ text: '📍 Anderes Ziel (Standort/Adresse)', callback_data: 'dest_other_location' }]);
            } else if (_firstMissing === 'destination') {
                msg += '\n\n📍 Oder: <b>Büroklammer 📎</b> antippen → <b>Standort senden</b>';
            }

            // 🔧 v6.25.4: Zurück-Button je nach Schritt
            const _backRow = [];
            if (_firstMissing === 'destination' && booking.pickup) {
                // Zielort fehlt → Zurück = Abholort nochmal ändern
                _backRow.push({ text: '◀️ Zurück', callback_data: 'addr_back_to_pickup' });
            } else if (_firstMissing === 'pickup' && booking.destination) {
                // Abholort fehlt aber Ziel schon da → Zurück = Ziel nochmal ändern
                _backRow.push({ text: '◀️ Zurück', callback_data: 'addr_back_to_dest' });
            }
            _backRow.push({ text: '❌ Abbrechen', callback_data: 'cancel_booking' });
            _inlineButtons.push(_backRow);

            await setPending(chatId, { partial: booking, originalText, lastQuestion: booking.question || null });
            await sendTelegramMessage(chatId, msg, {
                reply_markup: { inline_keyboard: _inlineButtons }
            });
            return;
        }

        const validated = await validateTelegramAddresses(chatId, booking, originalText);
        if (!validated) return;
        Object.assign(booking, validated);
        const routePrice = await calculateTelegramRoutePrice(booking);
        await askPassengersOrConfirm(chatId, booking, routePrice, originalText);
    } catch (e) {
        console.error('continueBookingFlow Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

async function analyzeTelegramFollowUp(chatId, newText, userName, pending) {
    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
        await sendTelegramMessage(chatId, '⚠️ AI-Assistent nicht konfiguriert.');
        return;
    }

    const partial = pending.partial;
    const originalText = pending.originalText || '';
    const isAdminFollowUp = !!(partial._adminBooked);
    const knownCustomer = isAdminFollowUp ? null : await getTelegramCustomer(chatId);
    const prefilledPhone = isAdminFollowUp ? (partial.phone || null) : (knownCustomer ? (knownCustomer.phone || knownCustomer.mobile || null) : (partial.phone || null));
    const lastQuestion = pending.lastQuestion || null;

    let followUpHomeAddress = '';
    if (isAdminFollowUp && partial._customerAddress) followUpHomeAddress = partial._customerAddress;
    else if (!isAdminFollowUp && knownCustomer && knownCustomer.address) followUpHomeAddress = knownCustomer.address;

    // 🔧 v6.15.5: Rückfahrt-Datum für KI-Prompt (nur Uhrzeit → Datum der Hinfahrt)
    const _returnOrigDate = partial._returnOrigDate || null;

    // 🧠 v6.15.8: KI-Trainings-Regeln laden
    const aiRulesBlock = await loadAiRules();

    try {
        const _pDatetime = partial.datetime || null;
        const _pPickup = partial.pickup || null;
        const _pDest = partial.destination || null;
        const _pPhone = prefilledPhone || null;
        const _pName = partial.name || userName;
        const _pPax = partial.passengers || 1;
        const _pNotes = partial.notes || null;
        const _pFor = isAdminFollowUp ? (partial._forCustomer || null) : undefined;
        const _missingNow = partial.missing || [];

        const data = await callAnthropicAPI(apiKey, 'claude-haiku-4-5-20251001', 750, [{
            role: 'user',
            content: `Du ergänzt eine laufende Taxi-Buchung um die neue Antwort des Fahrgasts.

BISHERIGE BUCHUNGSDATEN (unveränderlich, außer Fahrgast korrigiert explizit):
• datetime:    ${_pDatetime || '— fehlt'}
• pickup:      ${_pPickup || '— fehlt'}
• destination: ${_pDest || '— fehlt'}
• waypoints:   ${partial.waypoints && partial.waypoints.length > 0 ? JSON.stringify(partial.waypoints) : '[]'}
• passengers:  ${_pPax}
• name:        ${_pName}
• phone:       ${_pPhone || '— fehlt'}${_pNotes ? `\n• notes: ${_pNotes}` : ''}${_pFor !== undefined ? `\n• forCustomer: ${_pFor || '—'}` : ''}

NOCH FEHLEND: ${_missingNow.length > 0 ? _missingNow.join(', ') : '✅ alles vollständig'}
${lastQuestion ? `ZULETZT GEFRAGT: "${lastQuestion}"` : ''}

NEUE ANTWORT: "${newText}"

REGELN:
1. FELD-ZUORDNUNG: Die Antwort füllt das erste fehlende Feld ("${_missingNow[0] || 'keines'}"), außer der Fahrgast benennt explizit ein anderes
2. BESTEHENDE FELDER: Nie überschreiben, außer Fahrgast korrigiert explizit
3. DATUM: ISO YYYY-MM-DDTHH:MM | heute=${new Date().toISOString().slice(0, 10)} | morgen=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)} | nur Uhrzeit → Datum=${_returnOrigDate ? _returnOrigDate + ' (Rückfahrt-Datum der Hinfahrt!)' : 'heute'} | nur Datum → datetime=null+missing | KEIN Datum/Uhrzeit in Antwort → datetime NICHT setzen, in missing lassen! | nie 00:00!
4. HEIMADRESSE: ${followUpHomeAddress ? `"${followUpHomeAddress}" → bei "zu Hause"/"nach Hause" verwenden` : 'unbekannt → frage "Welche Adresse ist Ihr Zuhause?"'}
5. UNKLARE ORTE → kurz nachfragen
6. NUR ORTSNAME ohne Straße (z.B. "Bansin", "Ahlbeck") → Ort übernehmen, aber in question nach genauer Adresse fragen
7. ABBRECHEN: Wenn der Fahrgast "abbrechen", "stop", "nein danke", "doch nicht" sagt → setze intent auf "cancel"
8. ADRESSEN NIE ERFINDEN: Nur Adressen setzen die explizit genannt werden. Nur Name/Titel (z.B. "Dr. Krohn") → NUR den Namen übernehmen, KEINE Straße dazuerfinden. Pickup und Destination müssen unterschiedliche Orte sein.
9. ZWISCHENSTOPPS: "Zwischenstopp", "Zwischenhalt", "über", "via", "mit Stopp in/bei/am" → waypoints-Array! Das sind ADRESSEN, nicht Notizen.
10. ERLAUBTE WERTE für "missing": NUR ["datetime", "pickup", "destination", "phone"]. NIEMALS andere Feldnamen wie "destination_street", "return_datetime", "return_destination" etc.!
11. RÜCKFAHRT: IMMER NUR EINE FAHRT pro Buchung (die aktuelle). Rückfahrt-Infos in "notes" speichern, NICHT in missing oder als separate Felder.
${aiRulesBlock}
Nur gültiges JSON, kein Markdown:
{
  "datetime": ${_pDatetime ? `"${_pDatetime}"` : 'null'},
  "pickup": ${_pPickup ? `"${_pPickup}"` : 'null'},
  "destination": ${_pDest ? `"${_pDest}"` : 'null'},
  "waypoints": ${partial.waypoints && partial.waypoints.length > 0 ? JSON.stringify(partial.waypoints) : '[]'},
  "passengers": ${_pPax},
  "name": "${_pName}",${isAdminFollowUp ? `\n  "forCustomer": ${_pFor ? `"${_pFor}"` : 'null'},` : ''}
  "phone": ${_pPhone ? `"${_pPhone}"` : 'null'},
  "notes": ${_pNotes ? `"${_pNotes}"` : 'null'},
  "missing": [],
  "question": null,
  "summary": "Kurze Zusammenfassung"
}`
        }]);

        const textContent = data.content.find(c => c.type === 'text')?.text || '';
        const booking = extractJsonFromAiResponse(textContent);

        // Schutzmaßnahmen
        if (partial.phone) booking.phone = partial.phone;
        if (partial.name && partial._crmCustomerId) booking.name = partial.name;

        // 🛡️ v6.16.2: Ungültige missing-Felder entfernen (KI erfindet manchmal eigene Feldnamen)
        const _validMissingFU = ['datetime', 'pickup', 'destination', 'phone'];
        if (booking.missing && Array.isArray(booking.missing)) {
            const _invalidFieldsFU = booking.missing.filter(f => !_validMissingFU.includes(f));
            if (_invalidFieldsFU.length > 0) {
                await addTelegramLog('🛡️', chatId, `Follow-Up: Ungültige missing-Felder entfernt: ${_invalidFieldsFU.join(', ')}`);
                booking.missing = booking.missing.filter(f => _validMissingFU.includes(f));
            }
        }

        // Datum-Halluzinations-Schutz für Follow-Up: Wenn vorher kein datetime und User kein Datum nennt → nicht erfinden
        const _fuTimeKeywords = /\b(\d{1,2}[:.]\d{2}|\d{1,2}\s*uhr|heute|morgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|nächst|um\s+\d|ab\s+\d|sofort|jetzt|gleich|nachher|abend|mittag|früh|vormittag|nachmittag|nacht)\b/i;
        if (!_pDatetime && booking.datetime && !_fuTimeKeywords.test(newText)) {
            await addTelegramLog('🛡️', chatId, `Follow-Up Datum-Schutz: AI hat "${booking.datetime}" gesetzt, aber Antwort "${newText}" enthält keine Zeitangabe → datetime gelöscht`);
            booking.datetime = null;
            if (!booking.missing) booking.missing = [];
            if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
        }

        // Jahres-Sanitycheck
        if (booking.datetime && typeof booking.datetime === 'string') {
            const correctYear = new Date().getFullYear();
            const dtYear = parseInt(booking.datetime.slice(0, 4));
            if (dtYear < correctYear || dtYear > correctYear + 1) booking.datetime = correctYear + booking.datetime.slice(4);
        }

        // 🛡️ v6.15.1: Vergangenheits-Schutz auch im Follow-Up
        if (booking.datetime && typeof booking.datetime === 'string' && booking.datetime.includes('T')) {
            const _fuBerlinNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
            const [_fuDatePart, _fuTimePart] = booking.datetime.split('T');
            const [_fuYear, _fuMonth, _fuDay] = _fuDatePart.split('-').map(Number);
            const [_fuHours, _fuMinutes] = _fuTimePart.split(':').map(Number);
            const _fuBookingDate = new Date(_fuYear, _fuMonth - 1, _fuDay, _fuHours, _fuMinutes);
            const _fuDiffMinutes = (_fuBookingDate - _fuBerlinNow) / 60000;
            if (_fuDiffMinutes < -15) {
                const _fuPad = n => String(n).padStart(2, '0');
                const _fuBookingTimeStr = `${_fuPad(_fuHours)}:${_fuPad(_fuMinutes)}`;
                const _fuNowTimeStr = `${_fuPad(_fuBerlinNow.getHours())}:${_fuPad(_fuBerlinNow.getMinutes())}`;
                await addTelegramLog('🛡️', chatId, `Follow-Up Vergangenheits-Schutz: ${booking.datetime} liegt in der Vergangenheit (jetzt: ${_fuNowTimeStr}) → nachfragen`);
                booking.datetime = null;
                if (!booking.missing) booking.missing = [];
                if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
                const _fuIsToday = _fuBookingDate.getDate() === _fuBerlinNow.getDate() && _fuBookingDate.getMonth() === _fuBerlinNow.getMonth();
                if (_fuIsToday) {
                    booking.question = `⏰ ${_fuBookingTimeStr} Uhr ist leider schon vorbei (es ist ${_fuNowTimeStr} Uhr). Meinen Sie morgen ${_fuBookingTimeStr} Uhr, oder eine andere Uhrzeit?`;
                } else {
                    booking.question = `⏰ Der Termin ${_fuPad(_fuDay)}.${_fuPad(_fuMonth)}. ${_fuBookingTimeStr} Uhr liegt in der Vergangenheit. Bitte nennen Sie ein aktuelles Datum.`;
                }
            }
        }

        if (isAdminFollowUp && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');

        // 🆕 v6.20.1: Änderungs-Übersicht erstellen (was hat sich gegenüber vorher geändert?)
        const _changes = [];
        if (booking.datetime && booking.datetime !== _pDatetime) {
            const dtNew = new Date(booking.datetime.includes('T') ? booking.datetime : booking.datetime + 'T00:00');
            const dtLabel = dtNew.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) +
                ' um ' + dtNew.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' }) + ' Uhr';
            if (_pDatetime) _changes.push(`📅 Datum: <s>${_pDatetime}</s> → <b>${dtLabel}</b>`);
            else _changes.push(`📅 Datum: <b>${dtLabel}</b>`);
        }
        if (booking.pickup && booking.pickup !== _pPickup) {
            if (_pPickup) _changes.push(`📍 Abholort: <s>${_pPickup}</s> → <b>${booking.pickup}</b>`);
            else _changes.push(`📍 Abholort: <b>${booking.pickup}</b>`);
        }
        if (booking.destination && booking.destination !== _pDest) {
            if (_pDest) _changes.push(`🎯 Zielort: <s>${_pDest}</s> → <b>${booking.destination}</b>`);
            else _changes.push(`🎯 Zielort: <b>${booking.destination}</b>`);
        }
        if (booking.passengers && booking.passengers !== _pPax) {
            _changes.push(`👥 Personen: <s>${_pPax}</s> → <b>${booking.passengers}</b>`);
        }
        if (booking.notes && booking.notes !== _pNotes) {
            if (_pNotes) _changes.push(`📝 Notiz: <s>${_pNotes}</s> → <b>${booking.notes}</b>`);
            else _changes.push(`📝 Notiz: <b>${booking.notes}</b>`);
        }

        // Änderungs-Nachricht senden wenn etwas geändert wurde
        if (_changes.length > 0) {
            await sendTelegramMessage(chatId, `✏️ <b>Aktualisiert:</b>\n${_changes.join('\n')}`);
        }

        await addTelegramLog('🤖', chatId, 'Follow-Up Antwort', { summary: booking.summary, missing: booking.missing, changes: _changes.length > 0 ? _changes : undefined });

        // Admin-Flags übertragen — partial hat immer Vorrang vor KI-Antwort!
        if (isAdminFollowUp) {
            booking._adminBooked = partial._adminBooked || true;
            booking._adminChatId = partial._adminChatId || chatId;
            // 🔧 v6.14.2: partial._forCustomer hat Vorrang – KI darf Admin-Kundennamen nicht überschreiben
            booking._forCustomer = partial._forCustomer || booking._forCustomer || booking.forCustomer;
            booking._customerAddress = partial._customerAddress;
            // 🔧 v6.14.2: CRM-ID zuverlässig übertragen (auch null/undefined aus Firebase)
            if (partial._crmCustomerId !== undefined) {
                booking._crmCustomerId = partial._crmCustomerId;
            } else if (booking._crmCustomerId === undefined) {
                // Firebase entfernt null-Werte → wenn partial keinen Key hat, prüfe ob ursprünglich gesetzt
                booking._crmCustomerId = null;
            }
        }

        // Koordinaten aus partial übernehmen (z.B. aus Favoriten)
        if (partial.pickupLat && partial.pickupLon && !booking.pickupLat) {
            booking.pickupLat = partial.pickupLat;
            booking.pickupLon = partial.pickupLon;
        }
        if (partial.destinationLat && partial.destinationLon && !booking.destinationLat) {
            booking.destinationLat = partial.destinationLat;
            booking.destinationLon = partial.destinationLon;
        }

        // 🆕 v6.11.4: Follow-Up nutzt jetzt continueBookingFlow für sofortige Adress-Validierung
        await continueBookingFlow(chatId, booking, originalText);

    } catch (e) {
        console.error('Follow-Up Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// BESTÄTIGUNG & BUCHUNG
// ═══════════════════════════════════════════════════════════════

// 🔧 v6.20.2: Datum-Picker — Schritt 1: "Heute" vs "Vorbestellen"
// "Jetzt/Sofort" erscheint erst UNTER "Heute" bei den Uhrzeiten
async function showDateTimePicker(chatId, booking, originalText) {
    const noted = [];
    if (booking.pickup) noted.push(`📍 Von: ${booking.pickup}`);
    if (booking.destination) noted.push(`🎯 Nach: ${booking.destination}`);
    let header = '';
    if (noted.length > 0) header = `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;

    await setPending(chatId, { partial: booking, originalText, _dtPicker: true });
    // 🔧 v6.25.4: Zurück-Button → Adressen nochmal ändern
    await sendTelegramMessage(chatId,
        header + '📅 <b>Wann soll das Taxi kommen?</b>', {
        reply_markup: { inline_keyboard: [
            [{ text: '🚖 Jetzt / Sofort', callback_data: 'datetime_now' }],
            [{ text: '🚕 Heute (Uhrzeit wählen)', callback_data: 'dtchoice_heute' }],
            [{ text: '📅 Vorbestellen (anderer Tag)', callback_data: 'dtchoice_vorbestellen' }],
            [{ text: '◀️ Zurück', callback_data: 'dtpicker_back' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
        ]}
    });
}

async function askPassengersOrConfirm(chatId, booking, routePrice, originalText) {
    // 🔧 v6.11.0: Adressen sauber validieren (POI-Namen durch vollständige Adressen ersetzen)
    if (booking.pickup && booking.pickupLat && booking.pickupLon) {
        booking.pickup = await cleanupAddress(booking.pickup, booking.pickupLat, booking.pickupLon);
    }
    if (booking.destination && booking.destinationLat && booking.destinationLon) {
        booking.destination = await cleanupAddress(booking.destination, booking.destinationLat, booking.destinationLon);
    }

    // Sicherheitscheck: datetime muss gesetzt sein bevor Buchung bestätigt werden kann
    // 🔧 v6.16.1: Datum/Uhrzeit-Picker statt "Jetzt/Sofort"-Button
    if (!booking.datetime) {
        await addTelegramLog('🛡️', chatId, 'Datum fehlt → Datum/Uhrzeit-Picker anzeigen');
        if (!booking.missing) booking.missing = [];
        if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
        await showDateTimePicker(chatId, booking, originalText);
        return;
    }

    // 🆕 v6.15.0: Auftraggeber-Buchung ohne Gastname → nachfragen bevor Bestätigung
    if ((booking._isAuftraggeberBooking || booking._isHotelBooking) && !booking.guestName) {
        const bookingId = Date.now().toString(36);
        await setPending(chatId, { booking, bookingId, routePrice, originalText, _awaitingBookingGuest: true });
        const label = booking._isHotelBooking ? '🏨 Hotel' : (booking._isSupplierBooking ? '🚚 Lieferant' : '🏢 Auftraggeber');
        // 🔧 v6.25.4: Zurück geht zur Uhrzeit-Auswahl statt zum Menü
        await sendTelegramMessage(chatId,
            `${label} <b>Gastname fehlt</b>\n\n👤 Für welchen Gast/Patienten ist die Fahrt?\n<i>Bitte den Namen eingeben:</i>`, {
            reply_markup: { inline_keyboard: [
                [{ text: '⏭️ Ohne Gastname weiter', callback_data: `skip_guest_${bookingId}` }],
                [{ text: '◀️ Zurück', callback_data: 'guest_back' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    const hasExplicitPassengers = booking._passengersExplicit || (booking.passengers && booking.passengers > 1);
    if (hasExplicitPassengers) {
        await addTelegramLog('👥', chatId, `Personen explizit (${booking.passengers}) → direkt zur Bestätigung`);
        return showTelegramConfirmation(chatId, booking, routePrice);
    }

    const bookingId = Date.now().toString(36);
    await addTelegramLog('👥', chatId, `Frage Personenzahl ab (bookingId=${bookingId})`);
    await setPending(chatId, { booking, bookingId, routePrice, originalText, _awaitingPassengers: true });

    // Prüfe ob setPending erfolgreich war
    const verifyPending = await getPending(chatId);
    if (!verifyPending || !verifyPending.booking) {
        await addTelegramLog('❌', chatId, `setPending FEHLGESCHLAGEN! verify: exists=${!!verifyPending}, hasBooking=${!!(verifyPending && verifyPending.booking)}`);
    }

    // 🔧 v6.25.4: Zurück-Button geht zur Uhrzeit-Auswahl statt zum Menü
    const msgResult = await sendTelegramMessage(chatId, '👥 <b>Wie viele Personen fahren mit?</b>', {
        reply_markup: { inline_keyboard: [
            [
                { text: '🧑 1', callback_data: `pax_1_${bookingId}` },
                { text: '👥 2', callback_data: `pax_2_${bookingId}` },
                { text: '👨‍👩‍👦 3', callback_data: `pax_3_${bookingId}` },
                { text: '👨‍👩‍👧‍👦 4', callback_data: `pax_4_${bookingId}` }
            ],
            [
                { text: '5', callback_data: `pax_5_${bookingId}` },
                { text: '6', callback_data: `pax_6_${bookingId}` },
                { text: '7+', callback_data: `pax_7_${bookingId}` }
            ],
            [
                { text: '◀️ Zurück', callback_data: 'pax_back' },
                { text: '❌ Abbrechen', callback_data: 'cancel_booking' }
            ]
        ]}
    });
    if (!msgResult) await addTelegramLog('❌', chatId, 'Personenzahl-Buttons senden FEHLGESCHLAGEN!');
}

function buildTelegramConfirmMsg(booking, routePrice) {
    let msg = booking._adminBooked
        ? `🕵️ <b>Buchung für ${booking._forCustomer || booking.name}</b>\n\n`
        : '✅ <b>Termin erkannt!</b>\n\n';
    if (booking.datetime) {
        if (booking._isJetzt) {
            msg += `🚖 <b>Sofortfahrt</b> – ein verfügbarer Fahrer wird für Sie gesucht!\n`;
        } else {
            const dt = new Date(parseGermanDatetime(booking.datetime));
            msg += `📅 ${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr\n`;
        }
    }
    if (booking.pickup) msg += `📍 Von: ${booking.pickup} ✅\n`;
    // 🔧 v6.11.0: Zwischenstopps anzeigen
    if (booking.waypoints && booking.waypoints.length > 0) {
        booking.waypoints.forEach((wp, i) => {
            msg += `📍 Stopp ${i + 1}: ${wp}\n`;
        });
    }
    if (booking.destination) msg += `🎯 Nach: ${booking.destination} ✅\n`;
    msg += `👥 ${booking.passengers || 1} Person(en)\n`;
    if (booking.name) msg += `👤 ${booking.name}\n`;
    if (booking.guestName) msg += `🧑 Fahrgast: ${booking.guestName}\n`;
    if (booking.guestPhone) msg += `📱 Gast-Tel: ${booking.guestPhone}\n`;
    if (booking.phone) {
        const cleanPhone = String(booking.phone).replace(/[^+\d\s\-()]/g, '').trim();
        if (cleanPhone) msg += `📱 ${cleanPhone}\n`;
    }
    if (booking.notes && booking.notes !== 'null') msg += `📝 ${booking.notes}\n`;
    // Zahlungsmethode anzeigen
    const payMethod = booking.paymentMethod || 'bar';
    msg += `💳 Zahlung: ${payMethod === 'karte' ? 'Kartenzahlung' : 'Barzahlung'}\n`;
    if (routePrice) {
        msg += `\n🗺️ Strecke: ca. ${routePrice.distance} km (~${routePrice.duration} Min)\n`;
        msg += `💰 Geschätzter Preis: ca. ${routePrice.price} €`;
        if (routePrice.zuschlagText && routePrice.zuschlagText.length > 0) msg += ` (${routePrice.zuschlagText.join(', ')})`;
        msg += '\n';
    }
    msg += '\n<b>Soll ich den Termin eintragen?</b>';
    return msg;
}

function buildBookingConfirmKeyboard(bookingId, chatId, booking) {
    const keyboard = { inline_keyboard: [] };
    // 🆕 v6.11.5: Datum ändern + Gastname oben
    keyboard.inline_keyboard.push([
        { text: '📅 Datum ändern', callback_data: `change_time_${bookingId}` },
        { text: '👤 Gastname', callback_data: `book_guest_${bookingId}` }
    ]);
    // 🆕 v6.15.5: Personenzahl ändern
    const _paxLabel = booking?.passengers ? `👥 ${booking.passengers} Pers.` : '👥 Personen';
    keyboard.inline_keyboard.push([
        { text: _paxLabel, callback_data: `change_pax_${bookingId}` }
    ]);
    // 🔧 v6.11.0: Tauschen + Zwischenstopp
    keyboard.inline_keyboard.push([
        { text: '🔄 Tauschen', callback_data: `swap_${bookingId}` },
        { text: '📍 Zwischenstopp', callback_data: `waypoint_${bookingId}` }
    ]);
    // Zahlungsmethode umschalten
    const currentPay = booking?.paymentMethod || 'bar';
    keyboard.inline_keyboard.push([
        { text: currentPay === 'bar' ? '💵 Bar ✓' : '💵 Bar', callback_data: `pay_bar_${bookingId}` },
        { text: currentPay === 'karte' ? '💳 Karte ✓' : '💳 Karte', callback_data: `pay_karte_${bookingId}` }
    ]);
    if (!booking || !booking.notes || booking.notes === 'null') {
        keyboard.inline_keyboard.push([
            { text: '📝 Bemerkung hinzufügen', callback_data: `book_note_${bookingId}` }
        ]);
    }
    // 🆕 v6.11.5: Eintragen + Ändern unten links (statt oben)
    keyboard.inline_keyboard.push([
        { text: '✅ Jetzt eintragen!', callback_data: `book_yes_${bookingId}` },
        { text: '✏️ Ändern', callback_data: `book_no_${bookingId}` }
    ]);
    // Menü + Abbrechen ganz unten
    keyboard.inline_keyboard.push([
        { text: '🏠 Menü', callback_data: 'back_to_menu' },
        { text: '❌ Abbrechen', callback_data: 'cancel_booking' }
    ]);
    return keyboard;
}

async function showTelegramConfirmation(chatId, booking, routePrice) {
    routePrice = routePrice || null;
    const confirmMsg = buildTelegramConfirmMsg(booking, routePrice);
    const bookingId = Date.now().toString(36);
    await setPending(chatId, { booking, bookingId, routePrice });
    const btnSent = await sendTelegramMessage(chatId, confirmMsg, {
        reply_markup: buildBookingConfirmKeyboard(bookingId, chatId, booking)
    });
    if (!btnSent) {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Senden der Bestätigung. Bitte nochmal versuchen.');
    } else {
        // Message-ID speichern für späteres Inline-Editieren
        await setPending(chatId, { booking, bookingId, routePrice, _confirmMsgId: btnSent.message_id });
    }
}

function getLocalDateString(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function linkTelegramChatToCustomer(chatId, booking) {
    const phone = booking.phone;
    const name = booking.name;
    if (!phone && !name) return;

    // Sicherheitscheck: Admin-ChatIDs NIEMALS als Kunden speichern
    if (await isTelegramAdmin(chatId)) {
        await addTelegramLog('🛡️', chatId, `Admin-Schutz: chatId ${chatId} wird NICHT als Kunde "${name}" gespeichert`);
        return;
    }

    try {
        const snap = await db.ref('customers').once('value');
        let customerId = null;
        let customerData = null;
        const digits = (phone || '').replace(/\D/g, '');

        snap.forEach(child => {
            if (customerId) return;
            const c = child.val();
            // 🔧 v6.14.7: Auch mobilePhone in CRM-Suche berücksichtigen
            const cPhone = (c.mobilePhone || c.phone || c.mobile || '').replace(/\D/g, '');
            if (digits && digits.length > 5 && cPhone.endsWith(digits.slice(-9))) {
                customerId = child.key;
                customerData = c;
            }
        });

        if (customerId && customerData) {
            await saveTelegramCustomer(chatId, {
                customerId, name: customerData.name || name,
                phone: customerData.mobilePhone || customerData.phone || phone,
                mobile: customerData.mobilePhone || null,
                address: customerData.address || null, linkedAt: Date.now()
            });
            await db.ref('customers/' + customerId).update({ telegramChatId: String(chatId) });
        } else {
            await saveTelegramCustomer(chatId, {
                customerId: null, name: name || 'Telegram-Gast',
                phone: phone || '', linkedAt: Date.now()
            });
        }
    } catch (e) { console.warn('linkTelegramChatToCustomer:', e.message); }
}

// ═══════════════════════════════════════════════════════════════
// BELIEBTE ZIELE (Kundenhistorie)
// ═══════════════════════════════════════════════════════════════

async function getCustomerFavoriteDestinations(customerName, customerPhone) {
    try {
        const snap = await db.ref('rides').orderByChild('customerName').equalTo(customerName).limitToLast(50).once('value');
        if (!snap.exists()) return [];

        const destCount = {};
        const destDetails = {};
        snap.forEach(child => {
            const r = child.val();
            if (!r.destination || r.status === 'cancelled' || r.status === 'storniert') return;
            const dest = r.destination.trim();
            const key = dest.toLowerCase();
            destCount[key] = (destCount[key] || 0) + 1;
            if (!destDetails[key]) {
                destDetails[key] = {
                    name: dest,
                    lat: r.destinationLat || null,
                    lon: r.destinationLon || null
                };
            }
            // Pickup als mögliche "Von"-Adresse merken (häufigster = Zuhause)
            if (!destDetails[key].lastPickup && r.pickup) {
                destDetails[key].lastPickup = r.pickup;
                destDetails[key].pickupLat = r.pickupLat || null;
                destDetails[key].pickupLon = r.pickupLon || null;
            }
        });

        // Sortiere nach Häufigkeit, max 4 Ziele
        return Object.entries(destCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([key, count]) => ({
                destination: destDetails[key].name,
                destinationLat: destDetails[key].lat,
                destinationLon: destDetails[key].lon,
                lastPickup: destDetails[key].lastPickup,
                pickupLat: destDetails[key].pickupLat,
                pickupLon: destDetails[key].pickupLon,
                count
            }));
    } catch (e) {
        console.warn('getCustomerFavoriteDestinations:', e.message);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// NACHRICHT-HANDLER (handleTelegramIncoming equivalent)
// ═══════════════════════════════════════════════════════════════

async function handleTelegramBookingQuery(chatId, text, knownCustomer) {
    if (!knownCustomer) {
        await sendTelegramMessage(chatId, '❓ Ich habe noch keine Buchungen für Sie gespeichert.\n\nBitte teilen Sie Ihre Telefonnummer.');
        return;
    }
    const phone = knownCustomer.phone || knownCustomer.mobile || '';
    const cleanPhone = phone.replace(/\s/g, '');
    try {
        const ridesSnap = await db.ref('rides').once('value');
        const allRides = Object.entries(ridesSnap.val() || {});
        const now = Date.now();
        const upcoming = allRides.filter(([, r]) => {
            if (r.status === 'deleted' || r.status === 'storniert') return false;
            const rPhone = (r.customerPhone || '').replace(/\s/g, '');
            return rPhone && cleanPhone && rPhone.slice(-9) === cleanPhone.slice(-9) && (r.pickupTimestamp || 0) >= now - 3600000;
        }).sort((a, b) => (a[1].pickupTimestamp || 0) - (b[1].pickupTimestamp || 0)).slice(0, 5);

        if (upcoming.length === 0) {
            await sendTelegramMessage(chatId, `📋 <b>${knownCustomer.name}</b>, Sie haben keine bevorstehenden Buchungen.\n\nSchreiben Sie jederzeit eine neue Anfrage!`, {
                reply_markup: { inline_keyboard: [[{ text: '🏠 Menü', callback_data: 'back_to_menu' }]] }
            });
            return;
        }
        let msg = `📋 <b>Ihre Buchungen, ${knownCustomer.name}:</b>\n\n`;
        const buttons = [];
        const statusIcons = { open: '🟢', vorbestellt: '🔵', unterwegs: '🚕', completed: '✅', abgeschlossen: '✅' };

        upcoming.forEach(([rideId, r]) => {
            const dt = new Date(r.pickupTimestamp || 0);
            const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const icon = statusIcons[r.status] || '⚪';
            msg += `${icon} <b>${timeStr} Uhr</b>\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n\n`;

            // Nur zukünftige Fahrten bearbeitbar
            if ((r.pickupTimestamp || 0) > now && r.status !== 'unterwegs') {
                buttons.push([
                    { text: `✏️ ${dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr ändern`, callback_data: `cust_edit_${rideId}` },
                    { text: '🗑️ Stornieren', callback_data: `cust_del_${rideId}` }
                ]);
            }
        });

        if (buttons.length === 0) {
            msg += '<i>Keine Fahrten zum Bearbeiten verfügbar.</i>';
        }
        buttons.push([{ text: '📋 Vergangene Fahrten', callback_data: 'menu_history' }]);
        buttons.push([{ text: '🏠 Menü', callback_data: 'back_to_menu' }]);

        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Abrufen der Buchungen.');
    }
}

// 🆕 v6.14.0: VERGANGENE FAHRTEN ANZEIGEN (Kunden)
async function handleTelegramHistoryQuery(chatId, knownCustomer) {
    if (!knownCustomer) {
        await sendTelegramMessage(chatId, '❓ Bitte zuerst Telefonnummer teilen.');
        return;
    }
    const phone = knownCustomer.phone || knownCustomer.mobile || '';
    const cleanPhone = phone.replace(/\s/g, '');
    try {
        const ridesSnap = await db.ref('rides').once('value');
        const allRides = Object.entries(ridesSnap.val() || {});
        const now = Date.now();

        // Vergangene Fahrten (abgeschlossen, storniert, nicht erschienen - letzte 30 Tage)
        const thirtyDaysAgo = now - (30 * 86400000);
        const pastRides = allRides.filter(([, r]) => {
            const rPhone = (r.customerPhone || '').replace(/\s/g, '');
            const phoneMatch = rPhone && cleanPhone && rPhone.slice(-9) === cleanPhone.slice(-9);
            if (!phoneMatch) return false;
            const ts = r.pickupTimestamp || 0;
            // Vergangene oder abgeschlossene Fahrten
            return ts < now && ts > thirtyDaysAgo;
        }).sort((a, b) => (b[1].pickupTimestamp || 0) - (a[1].pickupTimestamp || 0)).slice(0, 10);

        if (pastRides.length === 0) {
            await sendTelegramMessage(chatId,
                `📋 <b>${knownCustomer.name}</b>, Sie haben keine vergangenen Fahrten in den letzten 30 Tagen.\n\nSchreiben Sie jederzeit eine neue Anfrage!`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '🚕 Neue Fahrt buchen', callback_data: 'menu_buchen' }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                ] } }
            );
            return;
        }

        let msg = `📋 <b>Ihre vergangenen Fahrten, ${knownCustomer.name}:</b>\n\n`;
        msg += '<i>Tippen Sie auf „Nochmal buchen" um eine Fahrt zu wiederholen.</i>\n\n';
        const buttons = [];
        const statusIcons = { completed: '✅', abgeschlossen: '✅', storniert: '❌', 'nicht erschienen': '🚫', abgesagt: '❌' };

        pastRides.forEach(([rideId, r]) => {
            const dt = new Date(r.pickupTimestamp || 0);
            const dateStr = dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit' });
            const timeStr = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
            const icon = statusIcons[r.status] || '⚪';
            const pickup = (r.pickup || '?').substring(0, 30);
            const dest = (r.destination || '?').substring(0, 30);
            const price = r.price ? ` · ${parseFloat(r.price).toFixed(2)}€` : '';

            msg += `${icon} <b>${dateStr} ${timeStr}</b>${price}\n`;
            msg += `   📍 ${pickup} → ${dest}\n\n`;

            buttons.push([{ text: `🔄 Nochmal: ${pickup.substring(0, 12)} → ${dest.substring(0, 12)}`, callback_data: `rebook_ride_${rideId}` }]);
        });

        buttons.push([
            { text: '🚕 Neue Fahrt', callback_data: 'menu_buchen' },
            { text: '🏠 Menü', callback_data: 'back_to_menu' }
        ]);

        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
        await addTelegramLog('📋', chatId, `Vergangene Fahrten: ${pastRides.length} angezeigt`);
    } catch (e) {
        console.error('Vergangene Fahrten Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Laden der vergangenen Fahrten.');
    }
}

// ═══════════════════════════════════════════════════════════════
// ADMIN: FAHRTEN-ÜBERSICHT & VERWALTUNG
// ═══════════════════════════════════════════════════════════════

async function handleAdminRidesOverview(chatId, filter = 'today') {
    if (!await isTelegramAdmin(chatId)) {
        await sendTelegramMessage(chatId, '⛔ Nur für Admins verfügbar.');
        return;
    }
    try {
        const ridesSnap = await db.ref('rides').once('value');
        const allRides = Object.entries(ridesSnap.val() || {});
        const now = new Date();
        const berlinNow = new Date(now.toLocaleString('en-US', TZ_BERLIN));

        // Tagesgrenzen in Berlin-Zeit
        const todayStart = new Date(berlinNow); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(berlinNow); todayEnd.setHours(23, 59, 59, 999);
        const tomorrowEnd = new Date(todayEnd.getTime() + 86400000);

        let filtered;
        let title;

        // 🆕 v6.25.4: Datum-Filter (YYYY-MM-DD) für beliebiges Datum
        const isDateFilter = /^\d{4}-\d{2}-\d{2}$/.test(filter);

        if (filter === 'open') {
            // Nur offene + vorbestellte (ab jetzt, nächste 7 Tage)
            const weekEnd = Date.now() + 7 * 86400000;
            filtered = allRides.filter(([, r]) => {
                if (r.status === 'deleted' || r.status === 'storniert' || r.status === 'completed' || r.status === 'abgeschlossen') return false;
                const ts = r.pickupTimestamp || 0;
                return ts >= Date.now() - 3600000 && ts <= weekEnd;
            });
            title = '📋 <b>Offene Fahrten</b> (nächste 7 Tage)';
        } else if (filter === 'tomorrow') {
            const tomorrowStart = new Date(todayEnd.getTime() + 1);
            filtered = allRides.filter(([, r]) => {
                if (r.status === 'deleted' || r.status === 'storniert') return false;
                const ts = r.pickupTimestamp || 0;
                const rideDate = new Date(new Date(ts).toLocaleString('en-US', TZ_BERLIN));
                return rideDate >= tomorrowStart && rideDate <= tomorrowEnd;
            });
            title = `📋 <b>Fahrten morgen</b> (${new Date(tomorrowEnd).toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' })})`;
        } else if (isDateFilter) {
            // 🆕 v6.25.4: Beliebiges Datum
            const [y, m, d] = filter.split('-').map(Number);
            const dateStart = new Date(berlinNow);
            dateStart.setFullYear(y, m - 1, d);
            dateStart.setHours(0, 0, 0, 0);
            const dateEnd = new Date(dateStart);
            dateEnd.setHours(23, 59, 59, 999);
            filtered = allRides.filter(([, r]) => {
                if (r.status === 'deleted' || r.status === 'storniert') return false;
                const ts = r.pickupTimestamp || 0;
                const rideDate = new Date(new Date(ts).toLocaleString('en-US', TZ_BERLIN));
                return rideDate >= dateStart && rideDate <= dateEnd;
            });
            const dateFmt = dateStart.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
            title = `📋 <b>Fahrten am ${dateFmt}</b>`;
        } else {
            // Heute (default)
            filtered = allRides.filter(([, r]) => {
                if (r.status === 'deleted' || r.status === 'storniert') return false;
                const ts = r.pickupTimestamp || 0;
                const rideDate = new Date(new Date(ts).toLocaleString('en-US', TZ_BERLIN));
                return rideDate >= todayStart && rideDate <= todayEnd;
            });
            title = `📋 <b>Fahrten heute</b> (${berlinNow.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })})`;
        }

        filtered.sort((a, b) => (a[1].pickupTimestamp || 0) - (b[1].pickupTimestamp || 0));

        if (filtered.length === 0) {
            const noRidesMsg = filter === 'open' ? 'Keine offenen Fahrten in den nächsten 7 Tagen.'
                : filter === 'tomorrow' ? 'Keine Fahrten für morgen eingetragen.'
                : 'Keine Fahrten für heute eingetragen.';
            await sendTelegramMessage(chatId, `${title}\n\n${noRidesMsg}\n\n/buchen – Neue Fahrt eintragen`);
            return;
        }

        const statusIcon = (s) => {
            const icons = { open: '🟢', vorbestellt: '🔵', unterwegs: '🚕', completed: '✅', abgeschlossen: '✅' };
            return icons[s] || '⚪';
        };

        let msg = `${title}\n📊 ${filtered.length} Fahrt(en)\n\n`;
        const buttons = [];

        filtered.forEach(([rideId, r]) => {
            const dt = new Date(r.pickupTimestamp || 0);
            const timeStr = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
            const dateStr = filter !== 'today' ? ` ${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, day: '2-digit', month: '2-digit' })}` : '';
            const status = statusIcon(r.status);
            const pax = r.passengers || 1;
            const name = r.customerName || 'Unbekannt';
            const pickup = (r.pickup || '?').substring(0, 25);
            const dest = (r.destination || '?').substring(0, 25);
            const price = r.estimatedPrice ? ` · ~${r.estimatedPrice}€` : '';

            msg += `${status} <b>${timeStr}${dateStr}</b> · ${name} (${pax}P)\n`;
            msg += `   📍 ${pickup} → ${dest}${price}\n\n`;

            const shortLabel = `${timeStr} ${name.substring(0, 12)}`;
            buttons.push([{ text: `📄 ${shortLabel}`, callback_data: `adm_ride_${rideId}` }]);
        });

        // Navigation-Buttons
        const navRow = [];
        if (filter !== 'today') navRow.push({ text: '📅 Heute', callback_data: 'adm_rides_today' });
        if (filter !== 'tomorrow') navRow.push({ text: '📅 Morgen', callback_data: 'adm_rides_tomorrow' });
        if (filter !== 'open') navRow.push({ text: '📋 Offene', callback_data: 'adm_rides_open' });
        if (navRow.length > 0) buttons.push(navRow);
        // 🆕 v6.25.4: Datum wählen + Vor/Zurück Navigation
        const dateNavRow = [];
        if (isDateFilter || filter === 'today' || filter === 'tomorrow') {
            // Vorheriger/Nächster Tag
            let refDate;
            if (isDateFilter) {
                const [y, m, d] = filter.split('-').map(Number);
                refDate = new Date(berlinNow); refDate.setFullYear(y, m - 1, d);
            } else if (filter === 'tomorrow') {
                refDate = new Date(todayEnd.getTime() + 1);
            } else {
                refDate = new Date(berlinNow);
            }
            const prevDate = new Date(refDate); prevDate.setDate(prevDate.getDate() - 1);
            const nextDate = new Date(refDate); nextDate.setDate(nextDate.getDate() + 1);
            const prevStr = prevDate.toLocaleDateString('en-CA'); // YYYY-MM-DD
            const nextStr = nextDate.toLocaleDateString('en-CA');
            const prevLabel = prevDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
            const nextLabel = nextDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
            dateNavRow.push({ text: `◀ ${prevLabel}`, callback_data: `adm_rides_date_${prevStr}` });
            dateNavRow.push({ text: '🗓️ Datum', callback_data: 'adm_rides_datepicker' });
            dateNavRow.push({ text: `${nextLabel} ▶`, callback_data: `adm_rides_date_${nextStr}` });
        } else {
            dateNavRow.push({ text: '🗓️ Datum wählen', callback_data: 'adm_rides_datepicker' });
        }
        buttons.push(dateNavRow);
        buttons.push([{ text: '🏠 Menü', callback_data: 'back_to_menu' }]);

        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
        await addTelegramLog('📋', chatId, `Admin: ${filtered.length} Fahrten angezeigt (${filter})`);

    } catch (e) {
        console.error('Admin Fahrten-Übersicht Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Laden der Fahrten: ' + e.message);
    }
}

async function handleAdminRideDetail(chatId, rideId) {
    if (!await isTelegramAdmin(chatId)) return;
    try {
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

        const dt = new Date(r.pickupTimestamp || 0);
        const dateStr = dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
        const statusLabels = { open: '🟢 Offen', vorbestellt: '🔵 Vorbestellt', unterwegs: '🚕 Unterwegs', completed: '✅ Abgeschlossen', abgeschlossen: '✅ Abgeschlossen', deleted: '🗑️ Gelöscht', storniert: '❌ Storniert' };

        let msg = '📄 <b>Fahrt-Details</b>\n\n';
        msg += `📅 <b>${dateStr} um ${timeStr} Uhr</b>\n`;
        msg += `📍 Von: ${r.pickup || '?'}\n`;
        msg += `🎯 Nach: ${r.destination || '?'}\n`;
        msg += `👤 ${r.customerName || 'Unbekannt'}`;
        if (r.customerPhone) msg += ` · 📱 ${r.customerPhone}`;
        msg += '\n';
        msg += `👥 ${r.passengers || 1} Person(en)\n`;
        msg += `📋 Status: ${statusLabels[r.status] || r.status || 'Unbekannt'}\n`;
        if (r.estimatedPrice) msg += `💰 ~${r.estimatedPrice} €\n`;
        if (r.estimatedDistance) msg += `🗺️ ~${r.estimatedDistance} km\n`;
        if (r.notes) msg += `📝 ${r.notes}\n`;
        if (r.assignedVehicleName || r.vehicle || r.vehicleLabel) {
            msg += `🚗 Fahrzeug: ${r.assignedVehicleName || r.vehicle || r.vehicleLabel}`;
            if (r.assignedVehiclePlate || r.vehiclePlate) msg += ` (${r.assignedVehiclePlate || r.vehiclePlate})`;
            msg += '\n';
        }
        msg += `\n🔑 ID: <code>${rideId}</code>`;
        if (r.source) msg += `\n📡 Quelle: ${r.source}`;

        const isActive = r.status !== 'deleted' && r.status !== 'storniert';
        const keyboard = [];

        if (isActive) {
            keyboard.push([
                { text: '⏰ Zeit ändern', callback_data: `adm_edit_time_${rideId}` },
                { text: '📍 Ort ändern', callback_data: `adm_edit_addr_${rideId}` }
            ]);
            keyboard.push([
                { text: '👥 Personen', callback_data: `adm_edit_pax_${rideId}` },
                { text: '📋 Status', callback_data: `adm_edit_status_${rideId}` }
            ]);
            keyboard.push([
                { text: '🚗 Fahrzeug', callback_data: `adm_assign_${rideId}` },
                { text: '🗑️ Löschen', callback_data: `adm_del_${rideId}` }
            ]);
        }
        // 🆕 v6.29.3: Fahrt kopieren — startet normalen Buchungsflow mit vorausgefüllten Daten
        keyboard.push([
            { text: '📋 Kopieren', callback_data: `adm_copy_${rideId}` }
        ]);
        // 🆕 v6.25.4: Zurück zur Liste geht zum Datum der Fahrt (nicht immer "heute")
        const rideDateStr = dt.toLocaleDateString('en-CA', TZ_BERLIN); // YYYY-MM-DD
        const berlinToday = new Date(new Date().toLocaleString('en-US', TZ_BERLIN)).toLocaleDateString('en-CA');
        const backCallback = rideDateStr === berlinToday ? 'adm_rides_today' : `adm_rides_date_${rideDateStr}`;
        keyboard.push([
            { text: '◀ Zurück zur Liste', callback_data: backCallback },
            { text: '🏠 Menü', callback_data: 'back_to_menu' }
        ]);

        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: keyboard } });

    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

async function handleAdminEditTime(chatId, rideId) {
    if (!await isTelegramAdmin(chatId)) return;
    try {
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

        const dt = new Date(r.pickupTimestamp || 0);
        const currentTime = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });

        const timeButtons = [];
        for (const offset of [-60, -30, -15, 15, 30, 60]) {
            const alt = new Date(dt.getTime() + offset * 60000);
            const altTime = alt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
            const label = offset < 0 ? `${offset}min → ${altTime}` : `+${offset}min → ${altTime}`;
            timeButtons.push({ text: label, callback_data: `adm_settime_${rideId}_${offset}` });
        }

        await sendTelegramMessage(chatId,
            `⏰ <b>Zeit ändern</b>\n\nAktuell: <b>${currentTime} Uhr</b>\n\nWähle neue Zeit oder schreibe sie direkt (z.B. "14:30"):`,
            { reply_markup: { inline_keyboard: [
                [timeButtons[0], timeButtons[1], timeButtons[2]],
                [timeButtons[3], timeButtons[4], timeButtons[5]],
                [{ text: '◀ Zurück', callback_data: `adm_ride_${rideId}` }]
            ]}}
        );
        await setPending(chatId, { _adminEditRide: rideId, _adminEditField: 'time' });
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

async function handleAdminEditPax(chatId, rideId) {
    if (!await isTelegramAdmin(chatId)) return;
    try {
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

        await sendTelegramMessage(chatId,
            `👥 <b>Personenzahl ändern</b>\n\nAktuell: <b>${r.passengers || 1} Person(en)</b>`,
            { reply_markup: { inline_keyboard: [
                [
                    { text: '1', callback_data: `adm_setpax_${rideId}_1` },
                    { text: '2', callback_data: `adm_setpax_${rideId}_2` },
                    { text: '3', callback_data: `adm_setpax_${rideId}_3` },
                    { text: '4', callback_data: `adm_setpax_${rideId}_4` }
                ],
                [
                    { text: '5', callback_data: `adm_setpax_${rideId}_5` },
                    { text: '6', callback_data: `adm_setpax_${rideId}_6` },
                    { text: '7', callback_data: `adm_setpax_${rideId}_7` },
                    { text: '8', callback_data: `adm_setpax_${rideId}_8` }
                ],
                [{ text: '◀ Zurück', callback_data: `adm_ride_${rideId}` }]
            ]}}
        );
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

async function handleAdminEditStatus(chatId, rideId) {
    if (!await isTelegramAdmin(chatId)) return;
    try {
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

        const statusLabels = { open: '🟢 Offen', vorbestellt: '🔵 Vorbestellt', unterwegs: '🚕 Unterwegs', abgeschlossen: '✅ Abgeschlossen' };

        await sendTelegramMessage(chatId,
            `📋 <b>Status ändern</b>\n\nAktuell: <b>${statusLabels[r.status] || r.status || '?'}</b>`,
            { reply_markup: { inline_keyboard: [
                [{ text: '🟢 Offen', callback_data: `adm_setstatus_${rideId}_open` }, { text: '🔵 Vorbestellt', callback_data: `adm_setstatus_${rideId}_vorbestellt` }],
                [{ text: '🚕 Unterwegs', callback_data: `adm_setstatus_${rideId}_unterwegs` }, { text: '✅ Abgeschlossen', callback_data: `adm_setstatus_${rideId}_abgeschlossen` }],
                [{ text: '◀ Zurück', callback_data: `adm_ride_${rideId}` }]
            ]}}
        );
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

async function handleAdminDeleteRide(chatId, rideId) {
    if (!await isTelegramAdmin(chatId)) return;
    try {
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

        const dt = new Date(r.pickupTimestamp || 0);
        const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        await sendTelegramMessage(chatId,
            `🗑️ <b>Fahrt wirklich löschen?</b>\n\n📅 ${timeStr} Uhr\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n👤 ${r.customerName || '?'}`,
            { reply_markup: { inline_keyboard: [
                [{ text: '🗑️ Ja, löschen!', callback_data: `adm_delconfirm_${rideId}` }, { text: '✖ Abbrechen', callback_data: `adm_ride_${rideId}` }]
            ]}}
        );
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

function isAdminRidesQuery(text) {
    const t = text.toLowerCase();
    return /\b(fahrten|rides|übersicht|dashboard)\b/.test(t) ||
        /welche.{0,15}(fahrt|termin|buchung).{0,10}(haben|gibt|stehen|sind)/i.test(t) ||
        /was.{0,10}(steht|liegt|haben).{0,10}(an|vor|heute|morgen)/i.test(t) ||
        /zeig.{0,10}(alle|die|mir).{0,10}(fahrt|buchung|termin)/i.test(t) ||
        /alle.{0,10}(fahrt|buchung|termin)/i.test(t) ||
        /\b(heute|morgen).{0,15}(fahrt|buchung|termin|los)/i.test(t) ||
        /was.{0,10}(geht|geht's|los).{0,10}(heute|morgen|ab)/i.test(t);
}

async function handleTelegramDeleteQuery(chatId, knownCustomer) {
    if (!knownCustomer) {
        await sendTelegramMessage(chatId, '❓ Bitte teilen Sie Ihre Telefonnummer damit ich Ihre Buchungen finde.');
        return;
    }
    try {
        const ridesSnap = await db.ref('rides').once('value');
        const allRides = Object.entries(ridesSnap.val() || {});
        const cleanPhone = (knownCustomer.phone || knownCustomer.mobile || '').replace(/\s/g, '');
        const now = Date.now();
        const upcoming = allRides.filter(([, r]) => {
            if (r.status === 'deleted') return false;
            const rPhone = (r.customerPhone || '').replace(/\s/g, '');
            return rPhone && rPhone.slice(-9) === cleanPhone.slice(-9) && (r.pickupTimestamp || 0) >= now - 3600000;
        }).sort((a, b) => (a[1].pickupTimestamp || 0) - (b[1].pickupTimestamp || 0)).slice(0, 5);

        if (upcoming.length === 0) {
            await sendTelegramMessage(chatId, `📋 <b>${knownCustomer.name}</b>, keine löschbaren Buchungen vorhanden.`);
            return;
        }
        let msg = `📋 <b>Welche Buchung löschen?</b>\n\n`;
        const buttons = [];
        upcoming.forEach(([rideId, r]) => {
            const dt = new Date(r.pickupTimestamp || 0);
            const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            msg += `📅 <b>${timeStr} Uhr</b>\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n\n`;
            buttons.push([{ text: `🗑️ ${timeStr}: ${(r.pickup || '?').substring(0, 20)}...`, callback_data: `del_ride_${rideId}` }]);
        });
        buttons.push([{ text: '✖️ Nichts löschen', callback_data: 'del_cancel' }]);
        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Abrufen der Buchungen.');
    }
}

async function handleTelegramModifyQuery(chatId, knownCustomer) {
    if (!knownCustomer) {
        await sendTelegramMessage(chatId, '❓ Bitte teilen Sie Ihre Telefonnummer damit ich Ihre Buchungen finde.');
        return;
    }
    try {
        const ridesSnap = await db.ref('rides').once('value');
        const allRides = Object.entries(ridesSnap.val() || {});
        const cleanPhone = (knownCustomer.phone || knownCustomer.mobile || '').replace(/\s/g, '');
        const now = Date.now();
        const upcoming = allRides.filter(([, r]) => {
            if (r.status === 'deleted' || r.status === 'storniert' || r.status === 'unterwegs') return false;
            const rPhone = (r.customerPhone || '').replace(/\s/g, '');
            return rPhone && rPhone.slice(-9) === cleanPhone.slice(-9) && (r.pickupTimestamp || 0) > now;
        }).sort((a, b) => (a[1].pickupTimestamp || 0) - (b[1].pickupTimestamp || 0)).slice(0, 5);

        if (upcoming.length === 0) {
            await sendTelegramMessage(chatId, `📋 <b>${knownCustomer.name}</b>, keine änderbaren Buchungen vorhanden.\n\nNur zukünftige Fahrten können geändert werden.`);
            return;
        }
        let msg = `✏️ <b>Welche Buchung ändern?</b>\n\n`;
        const buttons = [];
        upcoming.forEach(([rideId, r]) => {
            const dt = new Date(r.pickupTimestamp || 0);
            const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            msg += `📅 <b>${timeStr} Uhr</b>\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n\n`;
            buttons.push([{ text: `✏️ ${timeStr}: ${(r.pickup || '?').substring(0, 18)}`, callback_data: `cust_edit_${rideId}` }]);
        });
        buttons.push([{ text: '✖ Nichts ändern', callback_data: 'cust_edit_cancel' }]);
        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Abrufen der Buchungen.');
    }
}

// 🆕 v6.16.2: Web App Daten verarbeiten (Datetime-Picker)
async function handleWebAppData(message) {
    const chatId = message.chat.id;
    try {
        const data = JSON.parse(message.web_app_data.data);
        if (data.type === 'datetime' && data.datetime) {
            const pending = await getPending(chatId);
            if (!pending || !pending.partial) {
                await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden. Bitte neu starten.');
                return;
            }
            const booking = pending.partial;
            booking.datetime = data.datetime;
            if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'datetime');
            await addTelegramLog('📅', chatId, `Web-App Datum/Uhrzeit: ${data.label || data.datetime}`);
            await sendTelegramMessage(chatId, `✅ <b>${data.label || data.datetime}</b>`);
            // Weiter im Buchungsflow
            await continueBookingFlow(chatId, booking, pending.originalText || '');
        }
    } catch (e) {
        console.error('handleWebAppData Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ Fehler bei der Verarbeitung. Bitte erneut versuchen.');
    }
}

async function handleMessage(message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    if (!text) return;
    const textCmd = text.toLowerCase();
    const userName = message.from?.first_name || 'Unbekannt';

    addTelegramLog('📩', chatId, `Nachricht von ${userName}`, { text: text.substring(0, 100) });

    // === COMMANDS ===
    if (textCmd === '/start') {
        await addTelegramLog('🚀', chatId, '/start Kommando');
        // Bot-Menü bei Telegram registrieren (≡ Menü Button unten links)
        const token = await loadBotToken();
        if (token) {
            fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    commands: [
                        { command: 'start', description: '🏠 Hauptmenü anzeigen' },
                        { command: 'buchen', description: '🚕 Neue Fahrt buchen' },
                        { command: 'status', description: '📊 Meine heutigen Fahrten' },
                        { command: 'profil', description: '👤 Profil bearbeiten' },
                        { command: 'hilfe', description: 'ℹ️ Alle Funktionen anzeigen' },
                        { command: 'abbrechen', description: '❌ Aktuelle Buchung abbrechen' }
                    ]
                })
            }).catch(err => console.warn('setMyCommands Fehler:', err.message));
        }
        const knownCustomer = await getTelegramCustomer(chatId);
        let greeting = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        if (knownCustomer) {
            greeting += `👋 Hallo <b>${knownCustomer.name}</b>! Schön, Sie wieder zu sehen.\n`;
            greeting += `📱 ${knownCustomer.phone || 'Telefon gespeichert'}\n\n`;
        } else {
            greeting += '👋 Herzlich willkommen! Ich bin Ihr <b>interaktiver Taxibot</b> für die Insel Usedom.\n\n';
        }
        greeting += '<b>So buchen Sie am schnellsten:</b>\n';
        greeting += '1️⃣ <b>Büroklammer 📎 unten antippen</b> → <b>„Standort"</b> wählen → das wird Ihr <b>Abholort</b>\n';
        greeting += '2️⃣ <b>Nochmal Standort senden</b> → das wird Ihr <b>Zielort</b>\n';
        greeting += '3️⃣ <b>Datum + Uhrzeit</b> wählen → <b>fertig!</b>\n\n';
        greeting += '<b>Oder schreiben Sie Ihren Wunsch als Text:</b>\n';
        greeting += '✍️ z.B. <b>„Morgen 10 Uhr vom Bahnhof nach Ahlbeck"</b>\n';
        greeting += '🎙️ Oder als <b>Sprachnachricht</b> einsprechen\n\n';
        greeting += '<b>Weitere Funktionen:</b>\n';
        greeting += '📊 Fahrten ansehen · ✏️ Ändern · 🗑️ Stornieren\n\n';
        greeting += '📞 Fragen? Rufen Sie uns an: <b>038378 / 22022</b>';
        if (!knownCustomer) {
            greeting += '\n\n📱 <i>Tipp: Teilen Sie einmalig Ihre Telefonnummer, damit wir Sie beim nächsten Mal sofort erkennen.</i>';
        }
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '✏️ Fahrt ändern', callback_data: 'menu_aendern' }],
            [{ text: '📋 Vergangene Fahrten', callback_data: 'menu_history' }, { text: '🗑️ Stornieren', callback_data: 'menu_loeschen' }],
            [{ text: '👤 Profil', callback_data: 'menu_profil' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        // 🆕 v6.25.4: Admin bekommt Fahrten-Buttons + CRM + KI-Training
        if (await isTelegramAdmin(chatId)) {
            keyboard.inline_keyboard.splice(3, 0, [{ text: '📅 Fahrten heute', callback_data: 'adm_rides_today' }, { text: '📅 Morgen', callback_data: 'adm_rides_tomorrow' }]);
            keyboard.inline_keyboard.splice(4, 0, [{ text: '📋 Kundendaten bearbeiten', callback_data: 'menu_crm_edit' }]);
            keyboard.inline_keyboard.splice(5, 0, [{ text: '🧠 KI-Training', callback_data: 'menu_ai_rules' }, { text: '🔔 Benachrichtigungen', callback_data: 'menu_notify_prefs' }]);
        }
        await sendTelegramMessage(chatId, greeting, { reply_markup: keyboard });
        if (!knownCustomer) {
            await sendTelegramMessage(chatId, '📱 <b>Telefonnummer teilen</b> – einmalig, damit wir Sie sofort erkennen:', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
        }
        return;
    }

    // 🆕 v6.16.0: /menü Befehl — zeigt das Inline-Button-Hauptmenü (statt nur Slash-Befehle)
    if (textCmd === '/menü' || textCmd === '/menu' || textCmd === '/menue') {
        await addTelegramLog('📋', chatId, '/menü Kommando — Hauptmenü angezeigt');
        const knownCustomer = await getTelegramCustomer(chatId);
        let greeting = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        if (knownCustomer) greeting += `👋 Hallo <b>${knownCustomer.name}</b>!\n\n`;
        greeting += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>';
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '✏️ Fahrt ändern', callback_data: 'menu_aendern' }],
            [{ text: '📋 Vergangene Fahrten', callback_data: 'menu_history' }, { text: '🗑️ Stornieren', callback_data: 'menu_loeschen' }],
            [{ text: '👤 Profil', callback_data: 'menu_profil' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        if (await isTelegramAdmin(chatId)) {
            keyboard.inline_keyboard.splice(3, 0, [{ text: '📅 Fahrten heute', callback_data: 'adm_rides_today' }, { text: '📅 Morgen', callback_data: 'adm_rides_tomorrow' }]);
            keyboard.inline_keyboard.splice(4, 0, [{ text: '📋 Kundendaten bearbeiten', callback_data: 'menu_crm_edit' }]);
            keyboard.inline_keyboard.splice(5, 0, [{ text: '🧠 KI-Training', callback_data: 'menu_ai_rules' }, { text: '🔔 Benachrichtigungen', callback_data: 'menu_notify_prefs' }]);
        }
        await sendTelegramMessage(chatId, greeting, { reply_markup: keyboard });
        return;
    }

    if (textCmd === '/buchen') {
        let msg = '🚕 <b>Neue Fahrt buchen</b>\n\n';
        msg += '<b>Am schnellsten per Standort:</b>\n';
        msg += '1️⃣ <b>Büroklammer 📎 unten antippen</b> → <b>„Standort"</b> wählen = <b>Abholort</b>\n';
        msg += '2️⃣ <b>Nochmal Standort senden</b> = <b>Zielort</b>\n\n';
        msg += '<b>Oder als Text schreiben:</b>\n';
        msg += '• <b>„Jetzt vom Bahnhof Heringsdorf nach Ahlbeck"</b>\n';
        msg += '• <b>„Morgen 10 Uhr Hotel Maritim → Flughafen BER"</b>\n';
        msg += '• <b>„Freitag 14:30 Seebrücke Bansin, 3 Personen"</b>\n\n';
        msg += '🎙️ Oder als <b>Sprachnachricht</b> einsprechen';
        await sendTelegramMessage(chatId, msg);
        return;
    }

    if (textCmd === '/hilfe' || textCmd === '/help') {
        const knownCustomer = await getTelegramCustomer(chatId);
        let hilfeMsg = '🚕 <b>Funk Taxi Heringsdorf – Taxibot</b>\n\n<b>So buchen Sie:</b>\nSchreiben Sie einfach eine Nachricht, z.B.:\n• <i>Morgen 10 Uhr vom Bahnhof nach Ahlbeck</i>\n• <i>Freitag 14:30 Seebrücke Bansin – Flughafen Berlin</i>\n\n';
        hilfeMsg += '<b>Befehle (Slash):</b>\n/buchen – 🚕 Neue Fahrt bestellen\n/status – 📊 Ihre Fahrten\n/ändern – ✏️ Fahrt bearbeiten\n/löschen – 🗑️ Fahrt stornieren\n/profil – 👤 Profil bearbeiten\n/abbrechen – ❌ Buchung abbrechen\n/abmelden – 🔓 Abmelden\n/hilfe – ℹ️ Übersicht\n\n';
        hilfeMsg += '<b>Oder einfach als Text schreiben:</b>\n• „<i>Fahrt buchen</i>" oder „<i>Taxi bestellen</i>"\n• „<i>Fahrt löschen</i>" oder „<i>Stornieren</i>"\n• „<i>Fahrt ändern</i>" oder „<i>Umbuchen</i>"\n• „<i>Meine Fahrten</i>" oder „<i>Status</i>"';
        if (await isTelegramAdmin(chatId)) {
            hilfeMsg += '\n\n<b>Admin-Befehle:</b>\n/fahrten – 📋 Heutige Fahrten\n/offen – 📋 Offene Fahrten\n/morgen – 📋 Morgen\n\n💡 <i>Du kannst auch schreiben: "Welche Fahrten haben wir heute?"</i>';
        }
        if (knownCustomer) hilfeMsg += `\n\n<b>Ihr Profil:</b>\n👤 ${knownCustomer.name}\n📱 ${knownCustomer.phone || 'keine Telefonnummer'}`;
        hilfeMsg += '\n\n📞 <b>Fragen oder Probleme?</b>\nRufen Sie uns an: <b>038378 / 22022</b>';
        await sendTelegramMessage(chatId, hilfeMsg, { reply_markup: { inline_keyboard: [
            [{ text: '🏠 Menü', callback_data: 'main_menu' }]
        ] } });
        return;
    }

    if (textCmd === '/profil' || textCmd === '/profile') {
        const knownCustomer = await getTelegramCustomer(chatId);
        if (!knownCustomer) {
            await sendTelegramMessage(chatId, '❓ Sie sind noch nicht angemeldet.\n\nBitte teilen Sie zuerst Ihre Telefonnummer:', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
            return;
        }
        // 🔧 v6.15.8: Admin-Status im Profil anzeigen
        const isAdminProfil = await isTelegramAdmin(chatId);
        let profilMsg = '👤 <b>Mein Profil</b>\n\n';
        if (isAdminProfil) profilMsg += '🔑 Rolle: <b>Administrator</b>\n\n';
        profilMsg += `📛 Name: <b>${knownCustomer.name || '—'}</b>\n`;
        profilMsg += `📱 Telefon: <b>${knownCustomer.phone || '—'}</b>\n`;
        if (knownCustomer.mobile) profilMsg += `📱 Mobil: <b>${knownCustomer.mobile}</b>\n`;
        profilMsg += `🏠 Adresse: <b>${knownCustomer.address || 'nicht hinterlegt'}</b>\n`;
        if (isAdminProfil) profilMsg += `\n🆔 Chat-ID: <code>${chatId}</code>\n`;
        profilMsg += '\n<i>Tippen Sie auf einen Button um Ihre Daten zu ändern:</i>';
        await sendTelegramMessage(chatId, profilMsg, { reply_markup: { inline_keyboard: [
            [{ text: '📛 Name ändern', callback_data: 'profil_edit_name' }],
            [{ text: '📱 Telefon ändern', callback_data: 'profil_edit_phone' }],
            [{ text: '🏠 Adresse ändern', callback_data: 'profil_edit_address' }],
            [{ text: '🏠 Menü', callback_data: 'main_menu' }]
        ] } });
        return;
    }

    if (textCmd === '/abmelden') {
        const wasKnown = await getTelegramCustomer(chatId);
        if (wasKnown) {
            await db.ref('settings/telegram/customers/' + chatId).remove();
            await sendTelegramMessage(chatId, `✅ <b>Abgemeldet!</b>\n\nIhr Profil (${wasKnown.name}) wurde gelöscht.\n\nTippen Sie /start um sich wieder anzumelden.`);
        } else {
            await sendTelegramMessage(chatId, 'ℹ️ Sie sind aktuell nicht angemeldet. Tippen Sie /start.');
        }
        return;
    }

    if (textCmd === '/abbrechen' || textCmd === '/reset' || textCmd === '/neu') {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '🔄 Buchung abgebrochen.\n\nSchreiben Sie jederzeit eine neue Anfrage.');
        return;
    }

    // 🆕 v6.16.0: Natürlicher Sprach-Befehl "Menü" / "Hauptmenü" → zeigt Inline-Button-Menü
    if (/^(men[üu]|menue|hauptmen[üu]|hauptmenue)[\s!.?]*$/i.test(text)) {
        await addTelegramLog('🎙️', chatId, `Sprach-Befehl erkannt: "${text}" → Hauptmenü`);
        const knownCustomer = await getTelegramCustomer(chatId);
        let greeting = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        if (knownCustomer) greeting += `👋 Hallo <b>${knownCustomer.name}</b>!\n\n`;
        greeting += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>';
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '✏️ Fahrt ändern', callback_data: 'menu_aendern' }],
            [{ text: '📋 Vergangene Fahrten', callback_data: 'menu_history' }, { text: '🗑️ Stornieren', callback_data: 'menu_loeschen' }],
            [{ text: '👤 Profil', callback_data: 'menu_profil' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        if (await isTelegramAdmin(chatId)) {
            keyboard.inline_keyboard.splice(3, 0, [{ text: '📅 Fahrten heute', callback_data: 'adm_rides_today' }, { text: '📅 Morgen', callback_data: 'adm_rides_tomorrow' }]);
            keyboard.inline_keyboard.splice(4, 0, [{ text: '📋 Kundendaten bearbeiten', callback_data: 'menu_crm_edit' }]);
            keyboard.inline_keyboard.splice(5, 0, [{ text: '🧠 KI-Training', callback_data: 'menu_ai_rules' }, { text: '🔔 Benachrichtigungen', callback_data: 'menu_notify_prefs' }]);
        }
        await sendTelegramMessage(chatId, greeting, { reply_markup: keyboard });
        return;
    }

    // 🆕 v6.14.2: Natürliche Sprach-Befehle (ohne Slash) — wichtig für Sprachnachrichten
    if (/^(abbrechen|abbruch|stopp?|cancel|nein danke|doch nicht|lass gut|vergiss es)[\s!.?]*$/i.test(text)) {
        await addTelegramLog('🎙️', chatId, `Sprach-Befehl erkannt: "${text}" → Abbrechen`);
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '🔄 Buchung abgebrochen.\n\nSchreiben Sie jederzeit eine neue Anfrage.');
        return;
    }
    if (/^(hilfe|help|info)[\s!.?]*$/i.test(text)) {
        await addTelegramLog('🎙️', chatId, `Sprach-Befehl erkannt: "${text}" → Hilfe`);
        // Hilfe-Inhalt identisch mit /hilfe
        const knownForHelp = await getTelegramCustomer(chatId);
        let hilfeMsg = '🚕 <b>Funk Taxi Heringsdorf – Taxibot</b>\n\n<b>So buchen Sie:</b>\nSchreiben Sie einfach eine Nachricht, z.B.:\n• <i>Morgen 10 Uhr vom Bahnhof nach Ahlbeck</i>\n• <i>Freitag 14:30 Seebrücke Bansin – Flughafen Berlin</i>\n\n';
        hilfeMsg += '<b>Befehle (Slash):</b>\n/buchen – 🚕 Neue Fahrt bestellen\n/status – 📊 Ihre Fahrten\n/ändern – ✏️ Fahrt bearbeiten\n/löschen – 🗑️ Fahrt stornieren\n/profil – 👤 Profil bearbeiten\n/abbrechen – ❌ Buchung abbrechen\n/abmelden – 🔓 Abmelden\n/hilfe – ℹ️ Übersicht\n\n';
        hilfeMsg += '<b>Oder einfach als Text schreiben:</b>\n• „<i>Fahrt buchen</i>" oder „<i>Taxi bestellen</i>"\n• „<i>Fahrt löschen</i>" oder „<i>Stornieren</i>"\n• „<i>Fahrt ändern</i>" oder „<i>Umbuchen</i>"\n• „<i>Meine Fahrten</i>" oder „<i>Status</i>"';
        if (await isTelegramAdmin(chatId)) {
            hilfeMsg += '\n\n<b>Admin-Befehle:</b>\n/fahrten – 📋 Heutige Fahrten\n/offen – 📋 Offene Fahrten\n/morgen – 📋 Morgen\n\n💡 <i>Du kannst auch schreiben: "Welche Fahrten haben wir heute?"</i>';
        }
        if (knownForHelp) hilfeMsg += `\n\n<b>Ihr Profil:</b>\n👤 ${knownForHelp.name}\n📱 ${knownForHelp.phone || 'keine Telefonnummer'}`;
        hilfeMsg += '\n\n📞 <b>Fragen oder Probleme?</b>\nRufen Sie uns an: <b>038378 / 22022</b>';
        await sendTelegramMessage(chatId, hilfeMsg);
        return;
    }

    // 🆕 v6.10.0: /löschen, /stornieren → Fahrt löschen
    if (textCmd === '/löschen' || textCmd === '/loeschen' || textCmd === '/stornieren') {
        const knownForDelete = await getTelegramCustomer(chatId);
        await handleTelegramDeleteQuery(chatId, knownForDelete);
        return;
    }

    // 🆕 v6.10.0: /ändern, /bearbeiten → Fahrt ändern
    if (textCmd === '/ändern' || textCmd === '/aendern' || textCmd === '/bearbeiten') {
        const knownForModify = await getTelegramCustomer(chatId);
        await handleTelegramModifyQuery(chatId, knownForModify);
        return;
    }

    if (textCmd === '/status') {
        const knownCustomer = await getTelegramCustomer(chatId);
        if (knownCustomer) await handleTelegramBookingQuery(chatId, 'meine Fahrten', knownCustomer);
        else await sendTelegramMessage(chatId, '📊 <b>Status</b>\n\nBitte teilen Sie Ihre Telefonnummer!', {
            reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        });
        return;
    }

    // Admin: Nutzer entblocken
    if (textCmd.startsWith('/entblocken ') || textCmd.startsWith('/unblock ')) {
        if (await isTelegramAdmin(chatId)) {
            const targetId = text.split(' ')[1]?.trim();
            if (!targetId) {
                await sendTelegramMessage(chatId, '⚠️ Bitte Chat-ID angeben: <code>/entblocken 123456789</code>');
                return;
            }
            try {
                await db.ref(`settings/telegram/blockedUsers/${targetId}`).remove();
                if (spamTracker[targetId]) delete spamTracker[targetId];
                await addTelegramLog('✅', chatId, `Admin: Nutzer ${targetId} entblockt`);
                await sendTelegramMessage(chatId, `✅ <b>Nutzer ${targetId} entblockt!</b>\n\nDer Nutzer kann den Bot wieder nutzen.`);
                // Den entblockten Nutzer informieren
                sendTelegramMessage(targetId, '✅ <b>Ihre Sperre wurde aufgehoben.</b>\n\nSie können den Bot wieder nutzen. Bitte senden Sie Ihre Nachrichten normal.').catch(() => {});
            } catch(e) {
                await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
            }
        }
        return;
    }

    // Admin-Befehle
    if (textCmd === '/fahrten' || textCmd === '/rides') {
        if (await isTelegramAdmin(chatId)) { await handleAdminRidesOverview(chatId, 'today'); return; }
    }
    if (textCmd === '/offen' || textCmd === '/open') {
        if (await isTelegramAdmin(chatId)) { await handleAdminRidesOverview(chatId, 'open'); return; }
    }
    if (textCmd === '/morgen' || textCmd === '/tomorrow') {
        if (await isTelegramAdmin(chatId)) { await handleAdminRidesOverview(chatId, 'tomorrow'); return; }
    }

    if (textCmd.startsWith('/')) {
        const isAdminForHelp = await isTelegramAdmin(chatId);
        const adminCmds = isAdminForHelp ? '\n\n<b>Admin:</b>\n/fahrten – 📋 Heutige Fahrten\n/offen – 📋 Offene Fahrten\n/morgen – 📋 Morgen' : '';
        await sendTelegramMessage(chatId, `❓ Befehl <b>${text}</b> nicht erkannt.\n\n/buchen – 🚕 Neue Fahrt\n/status – 📊 Meine Fahrten\n/ändern – ✏️ Fahrt bearbeiten\n/löschen – 🗑️ Fahrt stornieren\n/profil – 👤 Profil bearbeiten\n/abbrechen – ❌ Abbrechen\n/hilfe – ℹ️ Hilfe${adminCmds}\n\n<i>💡 Sie können auch als Text schreiben: „Fahrt buchen", „Fahrt löschen", „Fahrt ändern"</i>`);
        return;
    }

    // === PENDING-BUCHUNGEN PRÜFEN ===
    const pending = await getPending(chatId);

    // Auto-Timeout
    if (pending && isPendingExpired(pending)) {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '⏰ <b>Ihre vorherige Anfrage ist abgelaufen</b> (nach 30 Minuten).\n\nSchreiben Sie einfach eine neue Anfrage!');
    }

    // 🆕 v6.11.6: NUMMER ZU BESTEHENDEM KUNDEN HINZUFÜGEN — Admin sucht Kunden
    if (pending && pending._awaitingAddPhoneToCustomer && !isPendingExpired(pending)) {
        const searchName = text.trim();
        const phoneToAdd = pending._callerPhone;
        try {
            const allCust = await loadAllCustomers();
            const matches = findAllCustomersForSecretary(allCust, searchName);
            if (matches.length === 0) {
                await sendTelegramMessage(chatId, `❌ Kein Kunde "${searchName}" gefunden.\n\nBitte nochmal versuchen oder /abbrechen`);
                return;
            }
            if (matches.length === 1) {
                const found = matches[0];
                const confirmId = Date.now().toString(36);
                await setPending(chatId, {
                    ...pending,
                    _awaitingAddPhoneToCustomer: false,
                    _addPhoneConfirm: { customerId: found.customerId || found.id, name: found.name, confirmId }
                });
                await sendTelegramMessage(chatId,
                    `📞 <b>Nummer ${phoneToAdd} zu diesem Kunden hinzufügen?</b>\n\n` +
                    `👤 <b>${found.name}</b>\n` +
                    (found.address ? `📍 ${found.address}\n` : '') +
                    (found.phone ? `📱 ${found.phone}\n` : '') +
                    (found.mobilePhone ? `📱 ${found.mobilePhone}\n` : ''), {
                    reply_markup: { inline_keyboard: [
                        [{ text: '✅ Ja, Nummer hinzufügen', callback_data: `confirm_addphone_${confirmId}` }],
                        [{ text: '❌ Nein, anderer Kunde', callback_data: 'add_phone_to_existing' }]
                    ] }
                });
                return;
            }
            // Mehrere Treffer → Auswahl
            const confirmId = Date.now().toString(36);
            await setPending(chatId, {
                ...pending,
                _awaitingAddPhoneToCustomer: false,
                _addPhoneMulti: { matches, confirmId }
            });
            let selectMsg = `📞 <b>Mehrere Kunden gefunden für "${searchName}":</b>\n\nWelchem soll ${phoneToAdd} zugeordnet werden?`;
            const buttons = matches.map((m, i) => {
                let label = `👤 ${m.name}`;
                if (m.address) label += ` · 📍 ${m.address.length > 25 ? m.address.slice(0, 23) + '…' : m.address}`;
                return [{ text: label, callback_data: `addphone_sel_${i}_${confirmId}` }];
            });
            buttons.push([{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]);
            await sendTelegramMessage(chatId, selectMsg, { reply_markup: { inline_keyboard: buttons } });
            return;
        } catch(e) {
            await sendTelegramMessage(chatId, '⚠️ Fehler bei der Kundensuche. Bitte nochmal versuchen.');
            return;
        }
    }

    // 🆕 v6.15.0: AUFTRAGGEBER-GASTNAME — Hotel/Firma/Klinik ruft an, Gastname wird eingegeben
    if (pending && (pending._awaitingHotelGuestName || pending._awaitingAuftraggeberGuestName) && !isPendingExpired(pending)) {
        const guestName = text.trim().slice(0, 100);
        const auftraggeberCustomer = pending._hotelCustomer || pending._auftraggeberCustomer;
        await addTelegramLog('🏢', chatId, `Auftraggeber-Gastname: "${guestName}" für ${auftraggeberCustomer.name}`);

        // Gastname in die Buchung einfügen und Analyse starten
        await sendTelegramMessage(chatId, `🏢 <b>${auftraggeberCustomer.name}</b> → Gast: <b>${guestName}</b>\n🤖 <i>Analysiere Buchung...</i>`);
        await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, {
            isAdmin: true,
            preselectedCustomer: auftraggeberCustomer,
            hotelGuestName: guestName
        });
        return;
    }

    // 🆕 v6.14.7: DATUM ÄNDERN — User hat neues Datum eingegeben
    if (pending && pending._awaitingDateChange && pending._dateChangeRideId && !isPendingExpired(pending)) {
        const rideId = pending._dateChangeRideId;
        const rideInfo = pending._dateChangeRide || {};
        try {
            // Datum parsen: Unterstützt "morgen 14:00", "15.03. 10 Uhr", "14:30", etc.
            const newTimestamp = parseFreeformDatetime(text);
            if (!newTimestamp) {
                await sendTelegramMessage(chatId, '⚠️ Konnte Datum nicht erkennen.\n\nBitte versuche es nochmal, z.B.:\n<i>"morgen 14:00"</i> oder <i>"15.03. 10 Uhr"</i>');
                return;
            }
            const newDt = new Date(newTimestamp);
            const newTimeStr = newDt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
            const newDateStr = newDt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' });

            // Firebase updaten
            await db.ref('rides/' + rideId).update({
                pickupTimestamp: newTimestamp,
                pickupTime: newDt.toISOString(),
                pickupDate: newDt.toLocaleDateString('de-DE', TZ_BERLIN),
                timestamp: newTimestamp,
                updatedAt: Date.now()
            });
            await deletePending(chatId);

            await sendTelegramMessage(chatId,
                `✅ <b>Datum geändert!</b>\n\n` +
                `👤 ${rideInfo.customerName || 'Kunde'}\n` +
                `📍 ${rideInfo.pickup || '?'} → ${rideInfo.destination || '?'}\n` +
                `📅 <b>${newDateStr} um ${newTimeStr} Uhr</b>`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '📋 Meine Buchungen', callback_data: 'cmd_meine' }, { text: '🏠 Hauptmenü', callback_data: 'back_to_menu' }]
                ] } }
            );
            await addTelegramLog('📅', chatId, `Datum geändert für ${rideId}: ${newDateStr} ${newTimeStr}`);
        } catch (e) {
            console.error('Datum-Ändern Fehler:', e);
            await sendTelegramMessage(chatId, '❌ Fehler: ' + e.message);
            await deletePending(chatId);
        }
        return;
    }

    // 🆕 v6.14.7: GASTNAME — User hat Gastnamen eingegeben
    // 🆕 v6.11.5: Gastname für laufende Buchung (vor dem Speichern)
    if (pending && pending._awaitingBookingGuest && !isPendingExpired(pending)) {
        const guestName = text.trim().slice(0, 100);
        const booking = pending.booking || pending.partial;
        if (booking) {
            booking.guestName = guestName;
            delete pending._awaitingBookingGuest;
            await addTelegramLog('👤', chatId, `Gastname für Buchung: "${guestName}"`);
            await showTelegramConfirmation(chatId, booking, pending.routePrice);
        } else {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden.');
            await deletePending(chatId);
        }
        return;
    }

    if (pending && pending._awaitingGuestName && pending._guestNameRideId && !isPendingExpired(pending)) {
        const rideId = pending._guestNameRideId;
        const guestName = text.trim().slice(0, 100);
        try {
            await db.ref('rides/' + rideId).update({
                guestName: guestName,
                updatedAt: Date.now()
            });
            await deletePending(chatId);

            await sendTelegramMessage(chatId,
                `✅ <b>Gastname gespeichert!</b>\n\n👤 Fahrgast: <b>${guestName}</b>`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '📋 Meine Buchungen', callback_data: 'cmd_meine' }, { text: '🏠 Hauptmenü', callback_data: 'back_to_menu' }]
                ] } }
            );
            await addTelegramLog('👤', chatId, `Gastname "${guestName}" für Fahrt ${rideId}`);
        } catch (e) {
            console.error('Gastname Fehler:', e);
            await sendTelegramMessage(chatId, '❌ Fehler: ' + e.message);
            await deletePending(chatId);
        }
        return;
    }

    // Bemerkung zur Buchung hinzufügen (Freitext)
    if (pending && pending._awaitingNote && pending.booking && pending.bookingId && !isPendingExpired(pending)) {
        const noteText = text.trim().slice(0, 500);
        const updatedBooking = { ...pending.booking, notes: noteText };
        const updatedPending = { ...pending, booking: updatedBooking };
        delete updatedPending._awaitingNote;
        await setPending(chatId, updatedPending);
        await addTelegramLog('📝', chatId, `Bemerkung: "${noteText}"`);
        const confirmMsg = buildTelegramConfirmMsg(updatedBooking, pending.routePrice || null);
        const keyboard = buildBookingConfirmKeyboard(pending.bookingId, chatId, updatedBooking);
        // Bestätigungs-Nachricht inline aktualisieren falls möglich
        const savedMsgId = pending._confirmMsgId;
        if (savedMsgId) {
            await editTelegramMessage(chatId, savedMsgId, confirmMsg, { reply_markup: keyboard });
            await sendTelegramMessage(chatId, `✅ Bemerkung "<b>${noteText}</b>" gespeichert!`);
        } else {
            await sendTelegramMessage(chatId, confirmMsg, { reply_markup: keyboard });
        }
        return;
    }

    // 🔧 v6.11.0: Zwischenstopp-Eingabe verarbeiten
    if (pending && pending._awaitingWaypoint && pending.booking && pending.bookingId && !isPendingExpired(pending)) {
        const waypointText = text.trim().slice(0, 200);
        const updatedBooking = { ...pending.booking };
        // Zwischenstopps als Array speichern
        if (!updatedBooking.waypoints) updatedBooking.waypoints = [];
        updatedBooking.waypoints.push(waypointText);
        // Bemerkung mit Zwischenstopps ergänzen
        const wpNote = `Zwischenstopp: ${updatedBooking.waypoints.join(' → ')}`;
        updatedBooking.notes = updatedBooking.notes ? `${updatedBooking.notes} | ${wpNote}` : wpNote;
        const updatedPending = { ...pending, booking: updatedBooking };
        delete updatedPending._awaitingWaypoint;
        await setPending(chatId, updatedPending);
        await addTelegramLog('📍', chatId, `Zwischenstopp: ${waypointText}`);
        const confirmMsg = buildTelegramConfirmMsg(updatedBooking, pending.routePrice || null);
        const keyboard = buildBookingConfirmKeyboard(pending.bookingId, chatId, updatedBooking);
        await sendTelegramMessage(chatId, `✅ Zwischenstopp "<b>${waypointText}</b>" hinzugefügt!\n\n` + confirmMsg, { reply_markup: keyboard });
        return;
    }

    // 🆕 v6.15.7: CRM Kundensuche (Admin-Feature)
    if (pending && pending._crmSearch && !isPendingExpired(pending) && await isTelegramAdmin(chatId)) {
        await deletePending(chatId);
        const searchTerm = text.trim().toLowerCase();
        if (!searchTerm) {
            await sendTelegramMessage(chatId, '⚠️ Bitte einen Suchbegriff eingeben.');
            return;
        }
        try {
            const snap = await db.ref('customers').once('value');
            const results = [];
            snap.forEach(child => {
                const c = child.val();
                const id = child.key;
                const nameMatch = (c.name || '').toLowerCase().includes(searchTerm);
                const phoneMatch = (c.phone || '').replace(/\s/g, '').includes(searchTerm.replace(/\s/g, ''));
                const mobileMatch = (c.mobilePhone || '').replace(/\s/g, '').includes(searchTerm.replace(/\s/g, ''));
                const addrMatch = (c.address || '').toLowerCase().includes(searchTerm);
                if (nameMatch || phoneMatch || mobileMatch || addrMatch) {
                    results.push({ id, name: c.name || '?', phone: c.phone || c.mobilePhone || '?', address: c.address || '' });
                }
            });
            if (results.length === 0) {
                await sendTelegramMessage(chatId, `🔍 Keine Kunden gefunden für "<b>${text.trim()}</b>".\n\nVersuchen Sie einen anderen Suchbegriff:`, {
                    reply_markup: { inline_keyboard: [[{ text: '🏠 Menü', callback_data: 'back_to_menu' }]] }
                });
                await setPending(chatId, { _crmSearch: true });
                return;
            }
            const buttons = results.slice(0, 8).map(c => [{
                text: `${c.name} (${c.phone})`,
                callback_data: `crm_view_${c.id}`
            }]);
            buttons.push([{ text: '🔍 Andere Suche', callback_data: 'menu_crm_edit' }, { text: '🏠 Menü', callback_data: 'back_to_menu' }]);
            await sendTelegramMessage(chatId,
                `🔍 <b>${results.length} Kunde(n) gefunden</b> für "<b>${text.trim()}</b>":\n\nWählen Sie einen Kunden:`, {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.15.7: CRM Feld-Bearbeitung (Admin-Freitext-Eingabe)
    if (pending && pending._crmEditCustomer && pending._crmEditField && !isPendingExpired(pending) && await isTelegramAdmin(chatId)) {
        const custId = pending._crmEditCustomer;
        const field = pending._crmEditField;
        await deletePending(chatId);
        const newValue = text.trim();
        if (!newValue) {
            await sendTelegramMessage(chatId, '⚠️ Leerer Wert.');
            return;
        }
        let finalValue = newValue;
        // Telefonnummer normalisieren
        if (field === 'phone' || field === 'mobilePhone') {
            finalValue = newValue.replace(/\s/g, '');
            if (finalValue.startsWith('+')) { /* ok */ }
            else if (finalValue.startsWith('00')) finalValue = '+' + finalValue.slice(2);
            else if (finalValue.startsWith('49') && finalValue.length >= 12) finalValue = '+' + finalValue;
            else if (finalValue.startsWith('0')) finalValue = '+49' + finalValue.slice(1);
            else finalValue = '+49' + finalValue;
        }
        try {
            const update = {};
            update[field] = finalValue;
            update.updatedAt = Date.now();
            await db.ref('customers/' + custId).update(update);
            const labels = { name: 'Name', phone: 'Telefon', mobilePhone: 'Mobilnummer', address: 'Adresse', defaultPickup: 'Standard-Abholort', notes: 'Notizen' };
            await addTelegramLog('📋', chatId, `CRM: ${field} = "${finalValue}" für ${custId}`);
            // Auch Telegram-Customer-Cache aktualisieren falls verknüpft
            if (field === 'name' || field === 'phone' || field === 'address') {
                try {
                    const tgSnap = await db.ref('settings/telegram/customers').once('value');
                    const tgCustomers = tgSnap.val() || {};
                    for (const [tgChatId, tgCust] of Object.entries(tgCustomers)) {
                        if (tgCust.customerId === custId) {
                            await db.ref('settings/telegram/customers/' + tgChatId + '/' + field).set(finalValue);
                            break;
                        }
                    }
                } catch(e) { /* Telegram-Cache optional */ }
            }
            await sendTelegramMessage(chatId,
                `✅ <b>${labels[field] || field} aktualisiert!</b>\n\nNeu: <b>${finalValue}</b>`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '↩️ Zurück zum Kunden', callback_data: `crm_view_${custId}` }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                ] }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Profil-Bearbeitung: Freitext-Eingabe
    if (pending && pending._profilEdit && !isPendingExpired(pending)) {
        const field = pending._profilEdit;
        await deletePending(chatId);
        const knownCustomer = await getTelegramCustomer(chatId);
        if (!knownCustomer) {
            await sendTelegramMessage(chatId, '❓ Profil nicht gefunden. Bitte /start eingeben.');
            return;
        }
        const newValue = text.trim();
        if (!newValue) {
            await sendTelegramMessage(chatId, '⚠️ Leerer Wert. Bitte nochmal versuchen über /profil');
            return;
        }
        let finalValue = newValue;
        if (field === 'phone') {
            finalValue = newValue.replace(/\s/g, '');
            if (finalValue.startsWith('+')) { /* ok */ }
            else if (finalValue.startsWith('00')) finalValue = '+' + finalValue.slice(2);
            else if (finalValue.startsWith('49') && finalValue.length >= 12) finalValue = '+' + finalValue;
            else if (finalValue.startsWith('0')) finalValue = '+49' + finalValue.slice(1);
            else finalValue = '+49' + finalValue;
        }
        knownCustomer[field] = finalValue;
        await saveTelegramCustomer(chatId, knownCustomer);
        if (knownCustomer.customerId) {
            try {
                const update = {};
                update[field] = finalValue;
                await db.ref('customers/' + knownCustomer.customerId).update(update);
                await addTelegramLog('✏️', chatId, `Profil+CRM: ${field} = "${finalValue}"`);
            } catch (e) {
                await addTelegramLog('⚠️', chatId, `Profil ok, CRM-Fehler: ${e.message}`);
            }
        } else {
            await addTelegramLog('✏️', chatId, `Profil: ${field} = "${finalValue}"`);
        }
        const labels = { name: 'Name', phone: 'Telefonnummer', address: 'Adresse' };
        await sendTelegramMessage(chatId,
            `✅ <b>${labels[field]} aktualisiert!</b>\n\nNeu: <b>${finalValue}</b>` +
            (knownCustomer.customerId ? '\n\n<i>Auch im CRM gespeichert.</i>' : '') +
            '\n\n/profil – Profil anzeigen'
        );
        return;
    }

    // Warte auf Bestätigung
    if (pending && pending.booking && pending.bookingId && !isPendingExpired(pending)) {
        await sendTelegramMessage(chatId, '⏳ <b>Bitte erst die aktuelle Buchung bestätigen oder ablehnen!</b>', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Menü', callback_data: 'back_to_menu' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }
        });
        return;
    }

    // 🧠 v6.15.8: KI-Training — Neue Regel speichern
    if (pending && pending._aiRuleAdd) {
        const ruleText = text.trim();
        if (ruleText.length < 5) {
            await sendTelegramMessage(chatId, '⚠️ Regel zu kurz. Bitte einen vollständigen Satz eingeben.');
            return;
        }
        if (ruleText.length > 500) {
            await sendTelegramMessage(chatId, '⚠️ Regel zu lang (max. 500 Zeichen). Bitte kürzer formulieren.');
            return;
        }
        try {
            const newRef = db.ref('settings/aiRules').push();
            await newRef.set({
                rule: ruleText,
                createdAt: Date.now(),
                createdBy: userName || 'Admin'
            });
            await deletePending(chatId);
            await addTelegramLog('🧠', chatId, `KI-Regel hinzugefügt: "${ruleText}"`);
            await sendTelegramMessage(chatId, `✅ <b>KI-Regel gespeichert!</b>\n\n🧠 <i>"${ruleText}"</i>\n\n<i>Die KI wird diese Regel ab sofort bei jeder Buchungsanalyse beachten.</i>`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '➕ Noch eine Regel', callback_data: 'ai_rule_add' }],
                    [{ text: '↩️ Alle Regeln anzeigen', callback_data: 'menu_ai_rules' }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                ] }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.14.0: Admin — Neuen Kunden Schritt für Schritt anlegen
    if (pending && pending._adminNewCust && !isPendingExpired(pending)) {
        const step = pending._adminNewCustStep;

        if (step === 'name') {
            const custName = text.trim();
            // 🆕 v6.11.5: Wenn Telefon aus Audio bekannt → Telefon-Schritt überspringen
            if (pending._callerPhone) {
                // 🔧 v6.15.1: Festnetz aus Audio → Mobilnummer optional abfragen
                if (!isMobileNumber(pending._callerPhone)) {
                    await addTelegramLog('☎️', chatId, `Festnetz aus Audio erkannt: ${pending._callerPhone} → frage nach Mobilnummer`);
                    await setPending(chatId, {
                        ...pending,
                        _adminNewCustStep: 'mobilePhone',
                        _adminNewCustName: custName,
                        _adminNewCustPhone: pending._callerPhone
                    });
                    await sendTelegramMessage(chatId,
                        `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${custName}</b>\n☎️ Festnetz: <b>${pending._callerPhone}</b> <i>(aus Audiodatei)</i>\n\n📱 Möchtest du eine <b>Mobilnummer</b> hinzufügen?`,
                        { reply_markup: { inline_keyboard: [
                            [{ text: '⏩ Ohne Mobilnummer weiter', callback_data: 'admin_newcust_nomobile' }]
                        ] } }
                    );
                    return;
                }
                await addTelegramLog('📱', chatId, `Telefon aus Audio übernommen: ${pending._callerPhone} → weiter zu Adresse`);
                await setPending(chatId, {
                    ...pending,
                    _adminNewCustStep: 'address',
                    _adminNewCustName: custName,
                    _adminNewCustPhone: pending._callerPhone
                });
                await sendTelegramMessage(chatId,
                    `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${custName}</b>\n📱 Telefon: <b>${pending._callerPhone}</b> <i>(aus Audiodatei)</i>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
                    { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }}
                );
                return;
            }
            // Name eingegeben → weiter mit Telefon
            await setPending(chatId, {
                ...pending,
                _adminNewCustStep: 'phone',
                _adminNewCustName: custName
            });
            await sendTelegramMessage(chatId,
                `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${custName}</b>\n\n📱 Bitte die <b>Telefonnummer</b> eingeben:`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '⏩ Ohne Telefon weiter', callback_data: 'admin_newcust_nophone' }]
                ] } }
            );
            return;
        }

        if (step === 'phone') {
            // 🔧 v6.15.9: Wenn Audio-Datei mit Telefonnummer kommt → Nummer aus Dateiname verwenden
            const audioPhone = message._callerPhone || pending._callerPhone || null;
            if (audioPhone && message._isVoiceTranscript) {
                // Audio-Transkript kam rein, aber Telefonnummer aus Dateiname nutzen (nicht den Text!)
                await addTelegramLog('📱', chatId, `Telefon aus Audio übernommen (Phone-Step): ${audioPhone} → überspringe manuelle Eingabe`);
                if (!isMobileNumber(audioPhone)) {
                    await setPending(chatId, {
                        ...pending,
                        _adminNewCustStep: 'mobilePhone',
                        _adminNewCustPhone: audioPhone,
                        _callerPhone: audioPhone
                    });
                    await sendTelegramMessage(chatId,
                        `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n☎️ Festnetz: <b>${audioPhone}</b> <i>(aus Audiodatei)</i>\n\n📱 Möchtest du eine <b>Mobilnummer</b> hinzufügen?`,
                        { reply_markup: { inline_keyboard: [
                            [{ text: '⏩ Ohne Mobilnummer weiter', callback_data: 'admin_newcust_nomobile' }]
                        ] } }
                    );
                    return;
                }
                await setPending(chatId, {
                    ...pending,
                    _adminNewCustStep: 'address',
                    _adminNewCustPhone: audioPhone,
                    _callerPhone: audioPhone
                });
                await sendTelegramMessage(chatId,
                    `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n📱 Telefon: <b>${audioPhone}</b> <i>(aus Audiodatei)</i>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
                    { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }}
                );
                return;
            }

            // 🔧 v6.15.9: Validierung — nur echte Telefonnummern akzeptieren, keine Transkript-Texte
            const phoneLike = text.trim().replace(/[\s\-\/\(\)]/g, '');
            if (phoneLike.length > 20 || /[a-zA-ZäöüÄÖÜß]{3,}/.test(phoneLike)) {
                await addTelegramLog('⚠️', chatId, `Phone-Step: "${text.substring(0, 50)}..." ist keine Telefonnummer → ignoriert`);
                await sendTelegramMessage(chatId,
                    `⚠️ Das sieht nicht wie eine Telefonnummer aus.\n\n📱 Bitte eine <b>Telefonnummer</b> eingeben (z.B. +49 171 1234567):`,
                    { reply_markup: { inline_keyboard: [
                        [{ text: '⏩ Ohne Telefon weiter', callback_data: 'admin_newcust_nophone' }]
                    ] } }
                );
                return;
            }

            // Telefon eingegeben → prüfen ob Festnetz oder Mobil
            let normalizedPhone = text.trim().replace(/\s/g, '');
            if (normalizedPhone.startsWith('0') && !normalizedPhone.startsWith('00')) {
                normalizedPhone = '+49' + normalizedPhone.slice(1);
            }
            // 🔧 v6.15.1: Festnetz erkannt → Mobilnummer optional abfragen
            if (!isMobileNumber(normalizedPhone)) {
                await setPending(chatId, {
                    ...pending,
                    _adminNewCustStep: 'mobilePhone',
                    _adminNewCustPhone: normalizedPhone
                });
                await sendTelegramMessage(chatId,
                    `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n☎️ Festnetz: <b>${normalizedPhone}</b>\n\n📱 Möchtest du eine <b>Mobilnummer</b> hinzufügen?`,
                    { reply_markup: { inline_keyboard: [
                        [{ text: '⏩ Ohne Mobilnummer weiter', callback_data: 'admin_newcust_nomobile' }]
                    ] } }
                );
                return;
            }
            await setPending(chatId, {
                ...pending,
                _adminNewCustStep: 'address',
                _adminNewCustPhone: normalizedPhone
            });
            await sendTelegramMessage(chatId,
                `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n📱 Telefon: <b>${normalizedPhone}</b>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
                { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }}
            );
            return;
        }

        // 🔧 v6.15.1: Mobilnummer eingegeben nach Festnetz-Erkennung
        if (step === 'mobilePhone') {
            // 🔧 v6.15.9: Validierung — keine Transkript-Texte als Mobilnummer akzeptieren
            const mobileLike = text.trim().replace(/[\s\-\/\(\)]/g, '');
            if (mobileLike.length > 20 || /[a-zA-ZäöüÄÖÜß]{3,}/.test(mobileLike)) {
                await addTelegramLog('⚠️', chatId, `MobilePhone-Step: "${text.substring(0, 50)}..." ist keine Telefonnummer → ignoriert`);
                await sendTelegramMessage(chatId,
                    `⚠️ Das sieht nicht wie eine Mobilnummer aus.\n\n📱 Bitte eine <b>Mobilnummer</b> eingeben oder überspringen:`,
                    { reply_markup: { inline_keyboard: [
                        [{ text: '⏩ Ohne Mobilnummer weiter', callback_data: 'admin_newcust_nomobile' }]
                    ] } }
                );
                return;
            }
            let normalizedMobile = text.trim().replace(/\s/g, '');
            if (normalizedMobile.startsWith('0') && !normalizedMobile.startsWith('00')) {
                normalizedMobile = '+49' + normalizedMobile.slice(1);
            }
            await setPending(chatId, {
                ...pending,
                _adminNewCustStep: 'address',
                _adminNewCustMobilePhone: normalizedMobile
            });
            await sendTelegramMessage(chatId,
                `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n☎️ Festnetz: <b>${pending._adminNewCustPhone}</b>\n📱 Mobil: <b>${normalizedMobile}</b>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
                { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }}
            );
            return;
        }

        // 🔧 v6.25.4: Wenn Admin im address_select/address_confirm Schritt Text tippt
        // statt Button → als neue Adress-Eingabe behandeln (zurück zu 'address')
        if (step === 'address_select' || step === 'address_confirm') {
            await addTelegramLog('🔄', chatId, `Neukunde: Text "${text.trim()}" im ${step}-Schritt → neue Adress-Suche`);
            // Schritt zurücksetzen und als neue Adresse verarbeiten
            pending._adminNewCustStep = 'address';
            await setPending(chatId, { ...pending, _adminNewCustStep: 'address' });
            // Fällt direkt in den address-Handler unten
        }

        if (step === 'address' || pending._adminNewCustStep === 'address') {
            // 🆕 v6.11.5: Erweiterte Suche — POIs, Kunden, Buchungen + Nominatim
            // 🔧 v6.16.1: try/catch + Logging für Adress-Schritt (Race-Condition-Debug)
            const rawAddress = text.trim();
            await addTelegramLog('🏠', chatId, `Neukunde Adress-Eingabe: "${rawAddress}" (Phone: ${pending._adminNewCustPhone || '?'})`);
            let suggestions = [];
            try {
                suggestions = await searchNominatimForTelegram(rawAddress);
            } catch (addrErr) {
                console.error('Neukunde Adress-Suche Fehler:', addrErr);
                await addTelegramLog('⚠️', chatId, `Neukunde Adress-Suche Fehler: ${addrErr.message}`);
                // Bei Fehler: Adresse trotzdem verwenden lassen
                suggestions = [];
            }

            if (suggestions.length > 0) {
                // Vorschläge als Buttons zeigen (max 5)
                const confirmId = Date.now().toString(36);
                const keyboard = suggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `admin_newcust_adr_${i}_${confirmId}` }]);
                keyboard.push([{ text: '📝 Original verwenden: ' + (rawAddress.length > 25 ? rawAddress.slice(0, 23) + '…' : rawAddress), callback_data: `admin_newcust_addr_raw_${confirmId}` }]);
                keyboard.push([{ text: '✏️ Andere Adresse eingeben', callback_data: `admin_newcust_addr_retry_${confirmId}` }]);

                await setPending(chatId, {
                    ...pending,
                    _adminNewCustStep: 'address_select',
                    _adminNewCustAddr: rawAddress,
                    _adminNewCustSuggestions: suggestions,
                    _addrConfirmId: confirmId
                });
                await sendTelegramMessage(chatId,
                    `🔍 <b>Adresse: "${rawAddress}"</b>\n\nBitte wähle die richtige Adresse:`, {
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                // Keine Treffer → trotzdem verwenden oder neu eingeben
                const confirmId = Date.now().toString(36);
                await setPending(chatId, {
                    ...pending,
                    _adminNewCustStep: 'address_confirm',
                    _adminNewCustAddr: rawAddress,
                    _addrConfirmId: confirmId
                });
                await sendTelegramMessage(chatId,
                    `⚠️ <b>Keine Ergebnisse für:</b> "${rawAddress}"\n\nWas möchtest du tun?`, {
                    reply_markup: { inline_keyboard: [
                        [{ text: '📝 Trotzdem verwenden', callback_data: `admin_newcust_addr_raw_${confirmId}` }],
                        [{ text: '✏️ Andere Adresse eingeben', callback_data: `admin_newcust_addr_retry_${confirmId}` }]
                    ] }
                });
            }
            return;
        }
    }

    // 🆕 v6.14.2: Admin hat "Für Kunden oder für sich?" offen aber tippt direkt einen Kundennamen
    // → Behandle Text als Kundenname (überspringe Button-Auswahl)
    if (pending && pending.taxiChoice && !isPendingExpired(pending)) {
        const customerName = text.trim();
        await addTelegramLog('🔄', chatId, `Admin tippt Kundenname "${customerName}" direkt (statt Button)`);
        const { text: originalText, userName: savedUserName } = pending.taxiChoice;
        const allCust = await loadAllCustomers();
        const matches = findAllCustomersForSecretary(allCust, customerName);
        if (matches.length === 1) {
            const found = matches[0];
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText, userName: savedUserName, crmConfirm: { found, confirmId }, customerName });
            let confirmMsg = `🔍 <b>Kunde im CRM gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
            // 🔧 v6.14.7: Auch mobilePhone anzeigen
            const _dispPhone = found.mobilePhone || found.phone;
            if (_dispPhone) confirmMsg += `📱 ${_dispPhone}\n`;
            if (found.address) confirmMsg += `🏠 ${found.address}\n`;
            confirmMsg += `\n<b>Ist das der richtige Kunde?</b>`;
            await sendTelegramMessage(chatId, confirmMsg, { reply_markup: { inline_keyboard: [[
                { text: '✅ Ja, genau!', callback_data: `admin_cust_yes_${confirmId}` },
                { text: '❌ Anderer Kunde', callback_data: `admin_cust_no_${confirmId}` }
            ]] } });
        } else if (matches.length > 1) {
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText, userName: savedUserName, crmMultiSelect: { matches, confirmId }, customerName });
            let selectMsg = `🔍 <b>Mehrere Kunden gefunden für „${customerName}":</b>`;
            const buttons = matches.map((m, i) => {
                let label = `👤 ${m.name}`;
                if (m.address) label += ` · 📍 ${m.address.length > 30 ? m.address.slice(0, 28) + '…' : m.address}`;
                return [{ text: label, callback_data: `admin_cust_sel_${i}_${confirmId}` }];
            });
            buttons.push([{ text: '🆕 Keiner davon', callback_data: `admin_cust_no_${confirmId}` }]);
            await sendTelegramMessage(chatId, selectMsg, { reply_markup: { inline_keyboard: buttons } });
        } else {
            // Nicht gefunden → Kundennamen-Suche anbieten
            await setPending(chatId, { awaitingCustomerName: true, originalText, userName: savedUserName });
            await sendTelegramMessage(chatId,
                `🔍 <b>"${customerName}" nicht im CRM gefunden.</b>\n\nBitte nochmal den Kundennamen eingeben oder:`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '🆕 Neuen Kunden anlegen', callback_data: 'admin_new_customer' }],
                    [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ] }
            });
        }
        return;
    }

    // 🆕 v6.14.2: Admin hat Kunden-Bestätigung offen aber tippt statt Button zu drücken
    // → Text als neue Kundensuche behandeln (Kontext beibehalten!)
    if (pending && pending.awaitingAdminCrmConfirm && !isPendingExpired(pending)) {
        const customerName = text.trim();
        await addTelegramLog('🔄', chatId, `Kundensuche aktualisiert: "${customerName}" (statt Button)`);
        const allCust = await loadAllCustomers();
        const matches = findAllCustomersForSecretary(allCust, customerName);
        if (matches.length === 1) {
            const found = matches[0];
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: pending.originalText, userName: pending.userName, crmConfirm: { found, confirmId }, customerName });
            let confirmMsg = `🔍 <b>Kunde im CRM gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
            // 🔧 v6.14.7: Auch mobilePhone anzeigen
            const _dispPhone = found.mobilePhone || found.phone;
            if (_dispPhone) confirmMsg += `📱 ${_dispPhone}\n`;
            if (found.address) confirmMsg += `🏠 ${found.address}\n`;
            confirmMsg += `\n<b>Ist das der richtige Kunde?</b>`;
            await sendTelegramMessage(chatId, confirmMsg, { reply_markup: { inline_keyboard: [[
                { text: '✅ Ja, genau!', callback_data: `admin_cust_yes_${confirmId}` },
                { text: '❌ Anderer Kunde', callback_data: `admin_cust_no_${confirmId}` }
            ]] } });
        } else if (matches.length > 1) {
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: pending.originalText, userName: pending.userName, crmMultiSelect: { matches, confirmId }, customerName });
            let selectMsg = `🔍 <b>Mehrere Kunden gefunden für „${customerName}":</b>`;
            const buttons = matches.map((m, i) => {
                let label = `👤 ${m.name}`;
                if (m.address) label += ` · 📍 ${m.address.length > 30 ? m.address.slice(0, 28) + '…' : m.address}`;
                return [{ text: label, callback_data: `admin_cust_sel_${i}_${confirmId}` }];
            });
            buttons.push([{ text: '🆕 Keiner davon', callback_data: `admin_cust_no_${confirmId}` }]);
            await sendTelegramMessage(chatId, selectMsg, { reply_markup: { inline_keyboard: buttons } });
        } else {
            const _newCustId = Date.now().toString(36);
            await setPending(chatId, {
                awaitingNewCustomerChoice: true,
                newCustomerName: customerName,
                originalText: pending.originalText,
                userName: pending.userName,
                _callerPhone: pending._callerPhone || null, // 🆕 v6.11.5: Telefon durchreichen
                _newCustId
            });
            await sendTelegramMessage(chatId,
                `🔍 <b>"${customerName}" nicht im CRM gefunden.</b>\n\nWas möchtest du tun?`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '🆕 Neuen Kunden anlegen', callback_data: `admin_create_cust_${_newCustId}` }],
                    [{ text: '➡️ Trotzdem buchen (ohne CRM)', callback_data: `admin_skip_crm_${_newCustId}` }],
                    [{ text: '🔍 Anderen Namen suchen', callback_data: `admin_retry_name_${_newCustId}` }]
                ] }
            });
        }
        return;
    }

    // Admin wartet auf Kundennamen
    if (pending && pending.awaitingCustomerName && !isPendingExpired(pending)) {
        const customerName = text.trim();
        if (/^(neu|new|skip|ohne)$/i.test(customerName)) {
            await deletePending(chatId);
            await sendTelegramMessage(chatId, '🤖 <i>Analysiere Buchung ohne CRM-Zuordnung...</i>');
            await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, { isAdmin: true });
            return;
        }

        const allCust = await loadAllCustomers();

        // 🆕 v6.15.1: Telefonnummer-Suche — wenn Eingabe wie Telefonnummer aussieht, CRM nach Nummer durchsuchen
        const normalizedInput = customerName.replace(/[\s\-\/\(\)]/g, '');
        const looksLikePhone = /^(\+?\d{6,})$/.test(normalizedInput);
        let matches = [];
        if (looksLikePhone) {
            // Suche nach Telefonnummer in allen CRM-Feldern
            matches = allCust.filter(c => {
                const phones = [c.phone, c.mobilePhone, ...(c.additionalPhones || []).map(p => p.number)].filter(Boolean);
                return phones.some(p => {
                    const norm = String(p).replace(/[\s\-\/\(\)]/g, '');
                    return norm === normalizedInput || norm.endsWith(normalizedInput.slice(-8)) || normalizedInput.endsWith(norm.slice(-8));
                });
            }).slice(0, 5);
            if (matches.length > 0) {
                await addTelegramLog('📱', chatId, `Telefonnummer-Suche: "${customerName}" → ${matches.length} Treffer (${matches.map(m => m.name).join(', ')})`);
            }
        }
        // Fallback: Namenssuche wenn keine Telefon-Treffer
        if (matches.length === 0) {
            matches = findAllCustomersForSecretary(allCust, customerName);
        }
        if (matches.length === 1) {
            const found = matches[0];
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: pending.originalText, userName: pending.userName, crmConfirm: { found, confirmId }, customerName });
            let confirmMsg = `🔍 <b>Kunde im CRM gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
            // 🔧 v6.14.7: Auch mobilePhone anzeigen
            const _dispPhone = found.mobilePhone || found.phone;
            if (_dispPhone) confirmMsg += `📱 ${_dispPhone}\n`;
            if (found.address) confirmMsg += `🏠 ${found.address}\n`;
            confirmMsg += `\n<b>Ist das der richtige Kunde?</b>`;
            await sendTelegramMessage(chatId, confirmMsg, { reply_markup: { inline_keyboard: [[
                { text: '✅ Ja, genau!', callback_data: `admin_cust_yes_${confirmId}` },
                { text: '❌ Anderer Kunde', callback_data: `admin_cust_no_${confirmId}` }
            ]] } });
        } else if (matches.length > 1) {
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: pending.originalText, userName: pending.userName, crmMultiSelect: { matches, confirmId }, customerName });
            let selectMsg = `🔍 <b>Mehrere Kunden gefunden für „${customerName}":</b>`;
            const buttons = matches.map((m, i) => {
                let label = `👤 ${m.name}`;
                if (m.address) label += ` · 📍 ${m.address.length > 30 ? m.address.slice(0, 28) + '…' : m.address}`;
                return [{ text: label, callback_data: `admin_cust_sel_${i}_${confirmId}` }];
            });
            buttons.push([{ text: '🆕 Keiner davon', callback_data: `admin_cust_no_${confirmId}` }]);
            await sendTelegramMessage(chatId, selectMsg, { reply_markup: { inline_keyboard: buttons } });
        } else {
            // 🆕 v6.14.0: Nicht gefunden → Neuen Kunden anlegen anbieten
            const _newCustId = Date.now().toString(36);
            await setPending(chatId, {
                awaitingNewCustomerChoice: true,
                newCustomerName: customerName,
                originalText: pending.originalText,
                userName: pending.userName,
                _callerPhone: pending._callerPhone || null, // 🆕 v6.11.5: Telefon durchreichen
                _newCustId
            });
            await sendTelegramMessage(chatId,
                `🔍 <b>"${customerName}" nicht im CRM gefunden.</b>\n\nWas möchtest du tun?`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '🆕 Neuen Kunden anlegen', callback_data: `admin_create_cust_${_newCustId}` }],
                    [{ text: '➡️ Trotzdem buchen (ohne CRM)', callback_data: `admin_skip_crm_${_newCustId}` }],
                    [{ text: '🔍 Anderen Namen suchen', callback_data: `admin_retry_name_${_newCustId}` }]
                ] }
            });
        }
        return;
    }

    // Kunden: Freitext-Eingabe für Fahrt-Bearbeitung (z.B. "14:30" oder neue Adresse)
    if (pending && pending._custEditRide && pending._custEditField && !isPendingExpired(pending)) {
        const rideId = pending._custEditRide;
        const field = pending._custEditField;
        await deletePending(chatId);

        if (field === 'time') {
            const timeMatch = text.match(/(\d{1,2})[:.:](\d{2})/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]), mins = parseInt(timeMatch[2]);
                if (hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59) {
                    // 🔧 v6.16.3: Admin-Bestätigung statt direktem Update
                    try {
                        const snap = await db.ref(`rides/${rideId}`).once('value');
                        const r = snap.val();
                        if (r) {
                            const oldDt = new Date(r.pickupTimestamp || Date.now());
                            const berlinDate = new Date(oldDt.toLocaleString('en-US', TZ_BERLIN));
                            berlinDate.setHours(hours, mins, 0, 0);
                            const berlinAsUTC = new Date(berlinDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
                            const offsetMs = berlinAsUTC.getTime() - berlinDate.getTime();
                            const newTimestamp = berlinDate.getTime() - offsetMs;
                            const newTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

                            const dt = new Date(r.pickupTimestamp || 0);
                            const rideInfo = {
                                customerName: r.guestName || r.customerName || 'Kunde',
                                dateStr: dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' }),
                                timeStr: dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' }),
                                pickup: r.pickup || '?',
                                destination: r.destination || '?'
                            };
                            await requestAdminApprovalForRideChange(chatId, rideId, 'time', {
                                pickupTimestamp: newTimestamp, pickupTime: newTime
                            }, rideInfo);
                        }
                    } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
                    return;
                }
            }
            await sendTelegramMessage(chatId, '⚠️ Ungültige Uhrzeit. Bitte z.B. 14:30 eingeben.');
            return;
        }

        if (field === 'pickup' || field === 'destination') {
            try {
                const label = field === 'pickup' ? 'Abholort' : 'Zielort';
                // Nominatim-Suche → Vorschläge anzeigen
                const suggestions = await searchNominatimForTelegram(text);
                if (suggestions.length > 0) {
                    const keyboard = suggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `cust_asel_${i}_${rideId}_${field}` }]);
                    keyboard.push([{ text: '✖ Abbrechen', callback_data: `cust_edit_${rideId}` }]);
                    await setPending(chatId, { _custAddrResults: suggestions, _custAddrRaw: text, _custAddrRide: rideId, _custAddrField: field });
                    await addTelegramLog('🔍', chatId, `Kunde: ${label} "${text}" → ${suggestions.length} Vorschläge`);
                    await sendTelegramMessage(chatId, `🔍 <b>${label}: "${text}"</b>\n\nBitte wählen Sie die korrekte Adresse:`, { reply_markup: { inline_keyboard: keyboard } });
                } else {
                    // 🔧 v6.16.3: Keine Vorschläge → Geocode + Admin-Bestätigung
                    const geo = await geocode(text);
                    const changeData = { [field]: text };
                    if (geo) {
                        changeData[field + 'Lat'] = geo.lat;
                        changeData[field + 'Lon'] = geo.lon;
                        changeData[field === 'pickup' ? 'pickupCoords' : 'destCoords'] = { lat: geo.lat, lon: geo.lon };
                    }

                    const rideSnap = await db.ref(`rides/${rideId}`).once('value');
                    const rideData = rideSnap.val() || {};
                    const dt = new Date(rideData.pickupTimestamp || 0);
                    const rideInfo = {
                        customerName: rideData.guestName || rideData.customerName || 'Kunde',
                        dateStr: dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' }),
                        timeStr: dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' }),
                        pickup: rideData.pickup || '?',
                        destination: rideData.destination || '?'
                    };
                    await requestAdminApprovalForRideChange(chatId, rideId, field, changeData, rideInfo);
                    if (!geo) {
                        await sendTelegramMessage(chatId, `⚠️ <i>Hinweis: Adresse "${text}" konnte nicht verifiziert werden.</i>`);
                    }
                }
            } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
            return;
        }
    }

    // 🆕 v6.25.4: Admin Datum-Eingabe für Fahrtenübersicht (z.B. "20.03" oder "2026-03-20")
    if (pending && pending._adminDatePicker && !isPendingExpired(pending)) {
        await deletePending(chatId);
        // Parse deutsches Datum: DD.MM oder DD.MM.YYYY
        const deMatch = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
        // Parse ISO Datum: YYYY-MM-DD
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (deMatch) {
            const day = parseInt(deMatch[1]), month = parseInt(deMatch[2]);
            let year = deMatch[3] ? parseInt(deMatch[3]) : new Date().getFullYear();
            if (year < 100) year += 2000;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            await handleAdminRidesOverview(chatId, dateStr);
            return;
        } else if (isoMatch) {
            await handleAdminRidesOverview(chatId, text.trim());
            return;
        } else {
            await sendTelegramMessage(chatId, '⚠️ Datum nicht erkannt. Bitte im Format <b>TT.MM</b> oder <b>TT.MM.JJJJ</b> eingeben.\n\nBeispiel: <i>20.03</i> oder <i>20.03.2026</i>');
            await setPending(chatId, { _adminDatePicker: true }); // Nochmal versuchen
            return;
        }
    }

    // Admin: Freitext-Eingabe für Fahrt-Bearbeitung (z.B. "14:30" nach Zeit-Ändern)
    if (pending && pending._adminEditRide && pending._adminEditField && !isPendingExpired(pending)) {
        const rideId = pending._adminEditRide;
        const field = pending._adminEditField;
        await deletePending(chatId);

        if (field === 'time') {
            // Parse Uhrzeit aus Freitext
            const timeMatch = text.match(/(\d{1,2})[:.:](\d{2})/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]), mins = parseInt(timeMatch[2]);
                if (hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59) {
                    try {
                        const snap = await db.ref(`rides/${rideId}`).once('value');
                        const r = snap.val();
                        if (r) {
                            const oldDt = new Date(r.pickupTimestamp || Date.now());
                            const berlinDate = new Date(oldDt.toLocaleString('en-US', TZ_BERLIN));
                            berlinDate.setHours(hours, mins, 0, 0);
                            // Konvertiere Berlin-Zeit zurück zu UTC-Timestamp
                            const berlinAsUTC = new Date(berlinDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
                            const offsetMs = berlinAsUTC.getTime() - berlinDate.getTime();
                            const newTimestamp = berlinDate.getTime() - offsetMs;

                            await db.ref(`rides/${rideId}`).update({
                                pickupTimestamp: newTimestamp,
                                pickupTime: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
                                editedAt: Date.now(), editedBy: 'telegram-admin'
                            });
                            await addTelegramLog('✏️', chatId, `Admin: Zeit geändert auf ${hours}:${String(mins).padStart(2, '0')}`);
                            await sendTelegramMessage(chatId, `✅ Zeit geändert auf <b>${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} Uhr</b>`);
                            await handleAdminRideDetail(chatId, rideId);
                        }
                    } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
                    return;
                }
            }
            await sendTelegramMessage(chatId, '⚠️ Ungültige Uhrzeit. Bitte im Format HH:MM eingeben (z.B. 14:30).');
            return;
        }

        if (field === 'pickup' || field === 'destination') {
            try {
                const label = field === 'pickup' ? 'Abholort' : 'Zielort';
                // Nominatim-Suche → Vorschläge anzeigen statt blind speichern
                const suggestions = await searchNominatimForTelegram(text);
                if (suggestions.length > 0) {
                    const keyboard = suggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `adm_addr_${i}_${rideId}_${field}` }]);
                    keyboard.push([{ text: '💾 Trotzdem speichern: ' + (text.length > 25 ? text.slice(0, 23) + '…' : text), callback_data: `adm_addr_raw_${rideId}_${field}` }]);
                    keyboard.push([{ text: '✖ Abbrechen', callback_data: `adm_ride_${rideId}` }]);
                    // Vorschläge + Rohtext im Pending speichern
                    await setPending(chatId, { _adminAddrResults: suggestions, _adminAddrRaw: text, _adminAddrRide: rideId, _adminAddrField: field });
                    await addTelegramLog('🔍', chatId, `${label} "${text}" → ${suggestions.length} Vorschläge`);
                    await sendTelegramMessage(chatId, `🔍 <b>${label}: "${text}"</b>\n\nBitte wähle die korrekte Adresse:`, { reply_markup: { inline_keyboard: keyboard } });
                } else {
                    // Keine Ergebnisse → direkt speichern mit Warnung
                    await applyAdminAddressChange(chatId, rideId, field, text, null);
                }
            } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
            return;
        }
    }

    // "Anderes Ziel" → Admin hat Freitext für neue Buchung eingegeben
    if (pending && pending._awaitingNewBookingText) {
        const { preselectedCustomer, userName: savedUserName } = pending;
        await deletePending(chatId);
        await sendTelegramMessage(chatId, `🤖 <i>Analysiere Buchung für ${preselectedCustomer.name}...</i>`);
        await analyzeTelegramBooking(chatId, text, savedUserName || userName, { isAdmin: true, preselectedCustomer });
        return;
    }

    // 🆕 v6.20.1: Freitext-Uhrzeit bei aktivem Datum-Picker (z.B. "14:30" oder "14 Uhr 30")
    if (pending && pending._selectedDate && pending.partial) {
        const timeMatch = text.trim().match(/^(\d{1,2})[:\s.]+(\d{2})$|^(\d{1,2})\s*uhr\s*(\d{0,2})$/i);
        if (timeMatch) {
            const hh = String(timeMatch[1] || timeMatch[3]).padStart(2, '0');
            const mi = String(timeMatch[2] || timeMatch[4] || '00').padStart(2, '0');
            const h = parseInt(hh), m = parseInt(mi);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                const datetime = `${pending._selectedDate}T${hh}:${mi}`;
                const dayLabel = pending._selectedDateLabel || pending._selectedDate;
                pending.partial.datetime = datetime;
                if (pending.partial.missing) pending.partial.missing = pending.partial.missing.filter(f => f !== 'datetime');
                delete pending._dtPicker;
                delete pending._selectedDate;
                delete pending._selectedDateLabel;
                delete pending.lastQuestion;
                await setPending(chatId, pending);
                await addTelegramLog('🕐', chatId, `Freitext-Uhrzeit: ${hh}:${mi} am ${dayLabel}`);
                await sendTelegramMessage(chatId, `✅ <b>${dayLabel} um ${hh}:${mi} Uhr</b>`);
                await continueBookingFlow(chatId, pending.partial, pending.originalText || '');
                return;
            }
        }
    }

    // Follow-Up: Unvollständige Buchung ergänzen
    if (pending && pending.partial && !isPendingExpired(pending)) {
        // 🆕 v6.11.4: Prüfe ob der Kunde eine FRAGE stellt statt Buchungsdaten zu liefern
        const questionPattern = /^(wo |wann |wie |was |gibt es |welche |kannst du |kennt |hast du |weißt du |sag mir |erzähl|öffnungszeit|sehenswürd|empfehl|tipp)/i;
        const isQuestion = questionPattern.test(text.trim()) && !(/\b(uhr|morgen|heute|taxi|abhol|fahr)\b/i.test(text));
        if (isQuestion) {
            await addTelegramLog('💬', chatId, `Frage während Buchung erkannt: "${text}"`);
            // Frage beantworten, Buchung bleibt im Pending
            const knownForQ = await getTelegramCustomer(chatId);
            const isAdminQ = await isTelegramAdmin(chatId);
            const classification = await handleSmartConversation(chatId, text, userName, knownForQ);
            if (classification.response) {
                let qResponse = classification.response;
                // POI-Vorschläge anhängen
                const poiSuggestions = await findPOISuggestionsForText(text);
                if (poiSuggestions && poiSuggestions.length > 0) {
                    const catLabel = poiSuggestions[0].matchedCategory || 'Ort';
                    qResponse += `\n\n📍 <b>${catLabel}-Empfehlungen:</b>`;
                    poiSuggestions.forEach((poi, i) => {
                        qResponse += `\n${i + 1}. <b>${poi.name}</b>`;
                        if (poi.address) qResponse += ` – ${poi.address}`;
                    });
                }
                // Erinnerung an laufende Buchung
                const missing = pending.partial.missing || [];
                if (missing.length > 0) {
                    const fieldNames = { datetime: 'Wann', pickup: 'Abholort', destination: 'Zielort', phone: 'Telefonnummer' };
                    const missingNames = missing.map(f => fieldNames[f] || f).join(', ');
                    qResponse += `\n\n📋 <i>Ihre Buchung läuft noch – mir fehlt: ${missingNames}</i>`;
                }
                await sendTelegramMessage(chatId, qResponse);
                return;
            }
        }
        await addTelegramLog('🔄', chatId, 'Follow-Up Analyse');
        await sendTelegramMessage(chatId, '🤖 <i>Ergänze fehlende Infos...</i>');
        await analyzeTelegramFollowUp(chatId, text, userName, pending);
        return;
    }

    // === NEUE NACHRICHT ===
    const [, knownForGreeting, isAdminUser] = await Promise.all([
        addTelegramLog('🆕', chatId, 'Neue Buchungs-Analyse gestartet'),
        getTelegramCustomer(chatId),
        isTelegramAdmin(chatId)
    ]);

    // Unbekannter Nutzer → vollständige Begrüßung mit Übersicht
    if (!knownForGreeting && !isAdminUser) {
        let welcomeMsg = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        welcomeMsg += '👋 Herzlich willkommen! Ich bin Ihr <b>interaktiver Taxibot</b> für die Insel Usedom.\n\n';
        welcomeMsg += '<b>Das kann ich für Sie tun:</b>\n';
        welcomeMsg += '🚕 <b>Fahrt buchen</b> – Schreiben Sie einfach wann und wohin\n';
        welcomeMsg += '📊 <b>Fahrten ansehen</b> – Ihre gebuchten Fahrten einsehen\n';
        welcomeMsg += '✏️ <b>Fahrten bearbeiten</b> – Zeit, Adresse oder Details ändern\n';
        welcomeMsg += '🗑️ <b>Fahrten stornieren</b> – Buchungen absagen\n';
        welcomeMsg += '📍 <b>Standort senden</b> – Tippen Sie auf 📎 → Standort, um sofort eine Fahrt ab Ihrem Standort zu starten\n\n';
        welcomeMsg += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>\n\n';
        welcomeMsg += '📞 <b>Fragen?</b> Rufen Sie uns an: <b>038378 / 22022</b>\n\n';
        welcomeMsg += '📱 <i>Tipp: Teilen Sie einmalig Ihre Telefonnummer, damit wir Sie beim nächsten Mal sofort erkennen.</i>';
        const welcomeKeyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '📋 Vergangene', callback_data: 'menu_history' }],
            [{ text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        await sendTelegramMessage(chatId, welcomeMsg, { reply_markup: welcomeKeyboard });
        await sendTelegramMessage(chatId, '📱 <b>Telefonnummer teilen</b> – einmalig, damit wir Sie sofort erkennen:', {
            reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        });
    }

    // Buchungsabfrage?
    if (isTelegramBookingQuery(text)) {
        await handleTelegramBookingQuery(chatId, text, knownForGreeting);
        return;
    }

    // 🆕 v6.10.0: "Fahrt buchen", "Taxi buchen" etc. → Buchungsassistent
    if (isTelegramBookCommand(text)) {
        await addTelegramLog('🚕', chatId, 'Buchen-Intent erkannt → Buchungsassistent');
        await sendTelegramMessage(chatId, '🚕 <b>Neue Fahrt buchen</b>\n\nSchreiben Sie mir einfach Ihre Fahrtwünsche:\n\n• <i>Jetzt vom Bahnhof Heringsdorf nach Ahlbeck</i>\n• <i>Morgen 10 Uhr Hotel Maritim → Flughafen BER</i>\n• <i>Freitag 14:30 Seebrücke Bansin nach Zinnowitz, 3 Personen</i>\n\n📍 <b>Oder:</b> Tippen Sie auf 📎 → <b>Standort</b>, um direkt ab Ihrem aktuellen Standort zu buchen!\n\n<i>Ich analysiere Ihre Nachricht automatisch.</i>');
        return;
    }

    // Lösch-Intent?
    if (isTelegramDeleteQuery(text)) {
        await handleTelegramDeleteQuery(chatId, knownForGreeting);
        return;
    }

    // Änderungs-Intent? (Kunde will Fahrt bearbeiten)
    if (isTelegramModifyQuery(text)) {
        await handleTelegramModifyQuery(chatId, knownForGreeting);
        return;
    }

    // Admin: Fahrten-Abfrage per natürlicher Sprache
    if (isAdminUser && isAdminRidesQuery(text)) {
        const filter = /morgen/i.test(text) ? 'tomorrow' : /offen|nächst/i.test(text) ? 'open' : 'today';
        await handleAdminRidesOverview(chatId, filter);
        return;
    }

    // Admin-Modus: Erst prüfen ob es eine Frage ist, sonst Buchung
    if (isAdminUser) {
        const adminClass = await handleSmartConversation(chatId, text, userName, knownForGreeting);
        if (['question', 'price_inquiry', 'greeting'].includes(adminClass.intent)) {
            await addTelegramLog('🧠', chatId, `Admin-Intent: ${adminClass.intent}`);
            let adminResponse = adminClass.response || '';
            if (adminClass.intent !== 'greeting') adminResponse += '\n\n💡 <i>Willst du buchen? Schreib einfach den Fahrtwunsch.</i>';
            // 🆕 POI-Vorschläge auch für Admins (Restaurant, Krankenhaus etc.)
            if (adminClass.intent !== 'greeting') {
                const poiSuggestions = await findPOISuggestionsForText(text);
                if (poiSuggestions && poiSuggestions.length > 0) {
                    const catLabel = poiSuggestions[0].matchedCategory || 'Ort';
                    adminResponse += `\n\n📍 <b>${catLabel}-Empfehlungen:</b>`;
                    poiSuggestions.forEach((poi, i) => {
                        adminResponse += `\n${i + 1}. <b>${poi.name}</b>`;
                        if (poi.address) adminResponse += ` – ${poi.address}`;
                    });
                    adminResponse += '\n\n🚕 <i>Buchung? Schreib z.B. "Fahrt zum ' + poiSuggestions[0].name + '"</i>';
                    await addTelegramLog('📍', chatId, `POI-Vorschläge (${catLabel}): ${poiSuggestions.map(p => p.name).join(', ')}`);
                }
            }
            await sendTelegramMessage(chatId, adminResponse);
            return;
        }
        // 🆕 v6.14.8: AUDIO-ANRUFER — wenn Kunde aus Dateiname erkannt wurde, direkt vorauswählen
        if (message._callerCustomer && message._isAudioFile) {
            const caller = message._callerCustomer;
            const _isAuftraggeberCaller = isAuftraggeber(caller.customerKind, caller.type);
            const isHotelCaller = caller.customerKind === 'hotel';
            const isSupplierCaller = caller.type === 'supplier';
            const callerKindLabel = isHotelCaller ? '🏨 Hotel' : (isSupplierCaller ? '🚚 Lieferant' : (_isAuftraggeberCaller ? '🏢 Auftraggeber' : ''));
            await addTelegramLog('📞', chatId, `Audio-Anrufer erkannt: ${caller.name}${callerKindLabel ? ' (' + callerKindLabel + ')' : ''} → direkte Buchung`);
            const preselectedCustomer = {
                name: caller.name,
                phone: caller.phone || '',
                mobilePhone: caller.mobilePhone || '',
                address: caller.address || '',
                defaultPickup: caller.defaultPickup || caller.address || '',
                customerId: caller.customerId || caller.id,
                customerKind: caller.customerKind || 'stammkunde',
                type: caller.type || null  // 🆕 v6.15.1: Lieferant-Typ weitergeben
            };
            if (caller.lat && caller.lon) {
                preselectedCustomer.addressLat = caller.lat;
                preselectedCustomer.addressLon = caller.lon;
            }

            // 🆕 v6.15.0: Auftraggeber-Anrufer → KI extrahiert Gastname + Gast-Telefon aus Transkript
            if (_isAuftraggeberCaller) {
                await sendTelegramMessage(chatId, `${callerKindLabel} <b>${caller.name} ruft an!</b>\n📍 ${caller.address || ''}\n🤖 <i>Analysiere Buchung + Gastname...</i>`);
            } else {
                await sendTelegramMessage(chatId, `📞 <b>Anrufer erkannt:</b> ${caller.name}\n🤖 <i>Analysiere Buchung...</i>`);
            }
            await analyzeTelegramBooking(chatId, text, userName, { isAdmin: true, preselectedCustomer, isAudioTranscript: true });
            return;
        }
        // 🆕 v6.14.8: AUDIO-NEUKUNDE — Telefonnummer aus Dateiname, aber nicht im CRM
        // 🔧 v6.11.6: Direkt Admin-Auswahl zeigen, Namens-Matching überspringen (zu fehleranfällig bei Transkripten)
        if (message._callerPhone && !message._callerCustomer && message._isAudioFile) {
            await addTelegramLog('📞', chatId, `Audio-Anrufer (Neukunde): ${message._callerPhone}`);
            await setPending(chatId, { taxiChoice: { text, userName }, _callerPhone: message._callerPhone });
            await sendTelegramMessage(chatId,
                `📞 <b>Unbekannte Nummer:</b> ${message._callerPhone}\n<i>(nicht im CRM)</i>\n\n🚕 <b>Was möchtest du tun?</b>`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '👤 Neukunde anlegen & buchen', callback_data: 'taxi_for_customer' }],
                    [{ text: '📞 Nummer zu bestehendem Kunden hinzufügen', callback_data: 'add_phone_to_existing' }],
                    [{ text: '🙋 Für mich selber buchen', callback_data: 'taxi_for_self' }]
                ]}
            });
            return;
        }

        // 🆕 v6.15.1: Telefonnummer in Nachricht → CRM-Suche nach Nummer
        const phoneInText = text.match(/(\+?\d[\d\s\-\/]{7,})/);
        if (phoneInText) {
            const phoneNorm = phoneInText[1].replace(/[\s\-\/\(\)]/g, '');
            if (/^\+?\d{8,}$/.test(phoneNorm)) {
                const allCustPhone = await loadAllCustomers();
                const phoneMatches = allCustPhone.filter(c => {
                    const phones = [c.phone, c.mobilePhone, ...(c.additionalPhones || []).map(p => p.number)].filter(Boolean);
                    return phones.some(p => {
                        const norm = String(p).replace(/[\s\-\/\(\)]/g, '');
                        return norm === phoneNorm || norm.endsWith(phoneNorm.slice(-8)) || phoneNorm.endsWith(norm.slice(-8));
                    });
                });
                if (phoneMatches.length >= 1) {
                    const found = phoneMatches[0];
                    await addTelegramLog('📱', chatId, `Admin: Telefonnummer "${phoneInText[1]}" in Nachricht → CRM-Treffer: ${found.name}`);
                    const confirmId = Date.now().toString(36);
                    await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: text, userName, crmConfirm: { found, confirmId }, customerName: found.name });
                    let confirmMsg = `📱 <b>Kunde per Telefonnummer gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
                    const _dispPhone = found.mobilePhone || found.phone;
                    if (_dispPhone) confirmMsg += `📱 ${_dispPhone}\n`;
                    if (found.address) confirmMsg += `🏠 ${found.address}\n`;
                    confirmMsg += `\n<b>Ist das der richtige Kunde?</b>`;
                    await sendTelegramMessage(chatId, confirmMsg, { reply_markup: { inline_keyboard: [[
                        { text: '✅ Ja, genau!', callback_data: `admin_cust_yes_${confirmId}` },
                        { text: '❌ Anderer Kunde', callback_data: `admin_cust_no_${confirmId}` }
                    ]] } });
                    return;
                }
            }
        }

        // 🆕 v6.14.2: Prüfe ob Kundenname schon in der Nachricht steht
        // Pattern 1: "für [Name]" — "für Nicole Schindel", "für Kunde Kaiserhof"
        const fuerMatch = text.match(/\bf[üu]r\s+(?:(?:den|einen?|unseren?)\s+)?(?:(?:frau|herrn?|herr|familie|fam\.?|kunde[n]?|gast)\s+)?([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\-]+(?:\s+[A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\-]+)?)\b/i);
        // Pattern 2: "vom/von [Name]" — "Taxi vom Kaiserhof", "von Hotel Residenz"
        const vomMatch = !fuerMatch && text.match(/\b(?:vom|von(?:\s+dem)?)\s+(?:(?:hotel|pension|haus|gasthof|gasthaus)\s+)?([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\-]+(?:\s+[A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\-]+)?)\b/i);
        let extractedCustomerName = fuerMatch ? fuerMatch[1].trim() : (vomMatch ? vomMatch[1].trim() : null);
        // Filtere generische Wörter die kein Kundenname sind
        const genericWords = ['mich', 'uns', 'sich', 'morgen', 'heute', 'jetzt', 'gleich', 'sofort', 'personen', 'person', 'leute', 'gäste', 'gast', 'uhr', 'taxi', 'fahrt', 'buchung', 'hause', 'zuhause', 'hier', 'dort', 'haus'];
        const isGenericWord = extractedCustomerName && genericWords.includes(extractedCustomerName.toLowerCase());
        // 🆕 v6.14.2: Bei "vom"-Pattern nur akzeptieren wenn CRM-Treffer existiert (sonst ist es ein Ortsname)
        const isVomPattern = !fuerMatch && !!vomMatch;

        if (extractedCustomerName && !isGenericWord) {
            // Kundenname erkannt → direkt CRM-Suche, kein Nachfragen
            await addTelegramLog('👔', chatId, `Admin erkannt → Kundenname "${extractedCustomerName}" in Nachricht gefunden${isVomPattern ? ' (vom-Pattern)' : ''}, überspringe Auswahl`);
            const allCust = await loadAllCustomers();
            const matches = findAllCustomersForSecretary(allCust, extractedCustomerName);

            // 🆕 v6.14.2: Bei "vom"-Pattern ohne CRM-Treffer → ist kein Kundenname sondern ein Ort
            if (isVomPattern && matches.length === 0) {
                await addTelegramLog('👔', chatId, `"${extractedCustomerName}" (vom-Pattern) nicht im CRM → normaler Buchungsflow`);
                // Weiter unten als normale Buchung ohne Kundenname behandeln
            } else if (matches.length === 1) {
                const found = matches[0];
                const confirmId = Date.now().toString(36);
                await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: text, userName, crmConfirm: { found, confirmId }, customerName: extractedCustomerName });
                let confirmMsg = `🔍 <b>Kunde im CRM gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
                // 🔧 v6.14.7: Auch mobilePhone anzeigen
            const _dispPhone = found.mobilePhone || found.phone;
            if (_dispPhone) confirmMsg += `📱 ${_dispPhone}\n`;
                if (found.address) confirmMsg += `🏠 ${found.address}\n`;
                confirmMsg += `\n<b>Ist das der richtige Kunde?</b>`;
                await sendTelegramMessage(chatId, confirmMsg, { reply_markup: { inline_keyboard: [[
                    { text: '✅ Ja, genau!', callback_data: `admin_cust_yes_${confirmId}` },
                    { text: '❌ Anderer Kunde', callback_data: `admin_cust_no_${confirmId}` }
                ]] } });
                return;
            } else if (matches.length > 1) {
                const confirmId = Date.now().toString(36);
                await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: text, userName, crmMultiSelect: { matches, confirmId }, customerName: extractedCustomerName });
                let selectMsg = `🔍 <b>Mehrere Kunden gefunden für „${extractedCustomerName}":</b>`;
                const buttons = matches.map((m, i) => {
                    let label = `👤 ${m.name}`;
                    if (m.address) label += ` · 📍 ${m.address.length > 30 ? m.address.slice(0, 28) + '…' : m.address}`;
                    return [{ text: label, callback_data: `admin_cust_sel_${i}_${confirmId}` }];
                });
                buttons.push([{ text: '🆕 Keiner davon', callback_data: `admin_cust_no_${confirmId}` }]);
                await sendTelegramMessage(chatId, selectMsg, { reply_markup: { inline_keyboard: buttons } });
                return;
            } else {
                // "für"-Pattern aber nicht im CRM → direkt als Kundenname verwenden
                if (!isVomPattern) {
                    await addTelegramLog('👔', chatId, `"${extractedCustomerName}" nicht im CRM → Buchung ohne CRM`);
                    await sendTelegramMessage(chatId, `🤖 <i>Buchung für <b>${extractedCustomerName}</b> wird analysiert...</i>`);
                    await analyzeTelegramBooking(chatId, text, userName, { isAdmin: true, forCustomerName: extractedCustomerName });
                    return;
                }
            }
        }
        {
            // Kein Kundenname erkannt → Auswahl anzeigen wie bisher
            await addTelegramLog('👔', chatId, 'Admin erkannt → Frage: Für Kunden oder für sich selbst?');
            await setPending(chatId, { taxiChoice: { text, userName } });
            await sendTelegramMessage(chatId, '🚕 <b>Neue Buchung</b>\n\nMöchtest du für einen Kunden buchen oder für dich selber?', {
                reply_markup: { inline_keyboard: [
                    [{ text: '👤 Für einen Kunden', callback_data: 'taxi_for_customer' }],
                    [{ text: '🙋 Für mich selber', callback_data: 'taxi_for_self' }],
                    [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ]}
            });
        }
        return;
    }

    // 🧠 Intelligente Konversation: Erst klassifizieren, dann reagieren
    const classification = await handleSmartConversation(chatId, text, userName, knownForGreeting);
    await addTelegramLog('🧠', chatId, `Intent: ${classification.intent}`);

    if (classification.intent === 'question' || classification.intent === 'price_inquiry' || classification.intent === 'greeting' || classification.intent === 'unclear') {
        let response = classification.response || '';
        // Bei "unclear": Hilfe-Hinweis anhängen
        if (classification.intent === 'unclear' && !response) {
            response = '🤔 Ich bin mir nicht sicher, was Sie meinen.';
        }
        if (classification.intent === 'unclear') {
            response += '\n\n💡 <b>Das kann ich für Sie tun:</b>\n🚕 Fahrt buchen – schreiben Sie wann & wohin\n📊 /status – Ihre Fahrten\n✏️ /ändern – Fahrt bearbeiten\n🗑️ /löschen – Fahrt stornieren\nℹ️ /hilfe – Alle Befehle';
        }
        // Bei Fragen + Preisanfragen: Buchungs-Hinweis anhängen
        if (classification.intent === 'question' || classification.intent === 'price_inquiry') {
            response += '\n\n🚕 <i>Möchten Sie gleich buchen? Schreiben Sie einfach wann und wohin – ich zeige Ihnen den genauen Preis!</i>';
        }

        // 🆕 v6.10.1: POI-Vorschläge wenn Nachricht eine Kategorie enthält
        if (classification.intent !== 'greeting') {
            const poiSuggestions = await findPOISuggestionsForText(text);
            if (poiSuggestions && poiSuggestions.length > 0) {
                const catLabel = poiSuggestions[0].matchedCategory || 'Ort';
                response += `\n\n📍 <b>Unsere ${catLabel}-Empfehlungen:</b>`;
                poiSuggestions.forEach((poi, i) => {
                    response += `\n${i + 1}. <b>${poi.name}</b>`;
                    if (poi.address) response += ` – ${poi.address}`;
                });
                response += '\n\n🚕 <i>Soll ich Sie hinfahren? Schreiben Sie einfach z.B. "Fahrt zum ' + poiSuggestions[0].name + '"!</i>';
                await addTelegramLog('📍', chatId, `POI-Vorschläge (${catLabel}): ${poiSuggestions.map(p => p.name).join(', ')}`);
            }
        }

        await sendTelegramMessage(chatId, response);
        return;
    }

    if (classification.intent === 'status') {
        if (knownForGreeting) {
            await handleTelegramBookingQuery(chatId, 'meine Fahrten', knownForGreeting);
        } else {
            await sendTelegramMessage(chatId, '📊 <b>Ihre Fahrten</b>\n\nBitte teilen Sie Ihre Telefonnummer, damit ich Ihre Buchungen finden kann.', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
        }
        return;
    }

    // Intent "booking" → normale Buchungsanalyse
    sendTelegramMessage(chatId, '🤖 <i>Analysiere Ihre Nachricht...</i>').catch(() => {});
    await analyzeTelegramBooking(chatId, text, userName);
}

// ═══════════════════════════════════════════════════════════════
// Adressänderung anwenden (Admin + Kunden-Edit)
async function applyAdminAddressChange(chatId, rideId, field, addressText, geo) {
    try {
        const update = { editedAt: Date.now(), editedBy: 'telegram-admin' };
        update[field] = addressText;
        let geoInfo = '';
        if (geo) {
            update[field + 'Lat'] = geo.lat;
            update[field + 'Lon'] = geo.lon;
            const coordsKey = field === 'pickup' ? 'pickupCoords' : 'destCoords';
            update[coordsKey] = { lat: geo.lat, lon: geo.lon };
            geoInfo = ` (📍 ${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)})`;
        } else {
            geoInfo = ' ⚠️ (nicht geocodiert)';
        }
        // Preis/Strecke neu berechnen wenn beide Koordinaten vorhanden
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const existingRide = snap.val() || {};
        const pLat = field === 'pickup' ? (geo ? geo.lat : null) : existingRide.pickupLat;
        const pLon = field === 'pickup' ? (geo ? geo.lon : null) : existingRide.pickupLon;
        const dLat = field === 'destination' ? (geo ? geo.lat : null) : existingRide.destinationLat;
        const dLon = field === 'destination' ? (geo ? geo.lon : null) : existingRide.destinationLon;
        if (pLat && pLon && dLat && dLon) {
            try {
                const route = await calculateRoute({ lat: pLat, lon: pLon }, { lat: dLat, lon: dLon });
                if (route && route.distance && parseFloat(route.distance) <= 500) {
                    const pickupTs = existingRide.pickupTimestamp || Date.now();
                    const pricing = calculatePrice(parseFloat(route.distance), pickupTs);
                    update.price = pricing.total;
                    update.estimatedPrice = pricing.total;
                    update.distance = route.distance;
                    update.estimatedDistance = route.distance;
                    update.duration = route.duration;
                    update.estimatedDuration = route.duration;
                    geoInfo += ` | ${route.distance} km, ~${pricing.total} €`;
                }
            } catch (routeErr) { /* Preis-Update optional */ }
        }
        await db.ref(`rides/${rideId}`).update(update);
        const label = field === 'pickup' ? 'Abholort' : 'Zielort';
        await addTelegramLog('✏️', chatId, `Admin: ${label} geändert auf "${addressText}"${geoInfo}`);
        await sendTelegramMessage(chatId, `✅ ${label} geändert auf <b>${addressText}</b>${geoInfo}`);
        await handleAdminRideDetail(chatId, rideId);
    } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
}

// CALLBACK-HANDLER (Inline Keyboard Buttons)
// ═══════════════════════════════════════════════════════════════

async function handleCallback(callback) {
    const chatId = callback.message.chat.id;
    const data = callback.data;
    await addTelegramLog('🖱️', chatId, `Button: ${data.substring(0, 25)}`);
    await answerCallbackQuery(callback.id);

    // Menü-Buttons
    if (data === 'menu_buchen') {
        let _buchenMsg = '🚕 <b>Neue Fahrt buchen</b>\n\n';
        _buchenMsg += '<b>Am schnellsten per Standort:</b>\n';
        _buchenMsg += '1️⃣ <b>Büroklammer 📎 unten antippen</b> → <b>„Standort"</b> wählen = <b>Abholort</b>\n';
        _buchenMsg += '2️⃣ <b>Nochmal Standort senden</b> = <b>Zielort</b>\n\n';
        _buchenMsg += '<b>Oder als Text schreiben:</b>\n';
        _buchenMsg += '• <b>„Jetzt vom Bahnhof Heringsdorf nach Ahlbeck"</b>\n';
        _buchenMsg += '• <b>„Morgen 10 Uhr Hotel Maritim → Flughafen BER"</b>\n\n';
        _buchenMsg += '🎙️ Oder als <b>Sprachnachricht</b> einsprechen';
        await sendTelegramMessage(chatId, _buchenMsg);
        return;
    }
    // 🆕 "Meine Buchungen" Button nach Buchungsbestätigung
    if (data === 'cmd_meine') {
        const knownForMeine = await getTelegramCustomer(chatId);
        if (knownForMeine) await handleTelegramBookingQuery(chatId, 'meine Fahrten', knownForMeine);
        else await sendTelegramMessage(chatId, '📋 <b>Meine Buchungen</b>\n\nBitte teilen Sie Ihre Telefonnummer!', {
            reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        });
        return;
    }
    if (data === 'menu_status') {
        const knownForStatus = await getTelegramCustomer(chatId);
        if (knownForStatus) await handleTelegramBookingQuery(chatId, 'meine Fahrten', knownForStatus);
        else await sendTelegramMessage(chatId, '📊 <b>Status</b>\n\nBitte teilen Sie Ihre Telefonnummer!', {
            reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        });
        return;
    }
    if (data === 'menu_hilfe') {
        let hilfeMsg = '🚕 <b>Funk Taxi Heringsdorf – Taxibot</b>\n\n';
        hilfeMsg += '<b>Das kann ich für Sie tun:</b>\n';
        hilfeMsg += '🚕 <b>Fahrt buchen</b> – Schreiben Sie einfach wann und wohin\n';
        hilfeMsg += '📊 <b>Fahrten ansehen</b> – Gebuchte Fahrten einsehen\n';
        hilfeMsg += '✏️ <b>Fahrten bearbeiten</b> – Zeit, Adresse oder Details ändern\n';
        hilfeMsg += '🗑️ <b>Fahrten stornieren</b> – Buchungen absagen\n';
        hilfeMsg += '👤 <b>Profil verwalten</b> – Name, Telefon, Adresse\n';
        hilfeMsg += '📍 <b>Standort senden</b> – Tippen Sie auf 📎 → Standort, um sofort ab Ihrem Standort zu buchen\n\n';
        hilfeMsg += '<b>Befehle (Slash):</b>\n';
        hilfeMsg += '/buchen – 🚕 Neue Fahrt buchen\n';
        hilfeMsg += '/status – 📊 Ihre Fahrten\n';
        hilfeMsg += '/ändern – ✏️ Fahrt bearbeiten\n';
        hilfeMsg += '/löschen – 🗑️ Fahrt stornieren\n';
        hilfeMsg += '/profil – 👤 Profil bearbeiten\n';
        hilfeMsg += '/abbrechen – ❌ Buchung abbrechen\n';
        hilfeMsg += '/abmelden – 🔓 Abmelden\n';
        hilfeMsg += '/hilfe – ℹ️ Diese Übersicht\n\n';
        hilfeMsg += '<b>Oder einfach als Text schreiben:</b>\n';
        hilfeMsg += '• „<i>Fahrt buchen</i>" oder „<i>Taxi bestellen</i>"\n';
        hilfeMsg += '• „<i>Fahrt löschen</i>" oder „<i>Stornieren</i>"\n';
        hilfeMsg += '• „<i>Fahrt ändern</i>" oder „<i>Umbuchen</i>"\n';
        hilfeMsg += '• „<i>Meine Fahrten</i>" oder „<i>Status</i>"\n\n';
        hilfeMsg += '📞 <b>Fragen oder Probleme?</b>\nRufen Sie uns an: <b>038378 / 22022</b>';
        await sendTelegramMessage(chatId, hilfeMsg, { reply_markup: { inline_keyboard: [
            [{ text: '🏠 Menü', callback_data: 'main_menu' }]
        ] } });
        return;
    }
    if (data === 'menu_abmelden') {
        const wasKnown = await getTelegramCustomer(chatId);
        if (wasKnown) {
            await db.ref('settings/telegram/customers/' + chatId).remove();
            await sendTelegramMessage(chatId, `✅ <b>Abgemeldet!</b> Profil <b>${wasKnown.name}</b> gelöscht.\n\nTippen Sie /start um sich wieder anzumelden.`);
        } else await sendTelegramMessage(chatId, 'ℹ️ Sie sind nicht angemeldet. Tippen Sie /start.');
        return;
    }

    // 🆕 v6.10.0: Menü-Buttons für Ändern und Löschen
    if (data === 'menu_aendern') {
        const knownForModify = await getTelegramCustomer(chatId);
        if (knownForModify) {
            await handleTelegramModifyQuery(chatId, knownForModify);
        } else {
            await sendTelegramMessage(chatId, '❓ Ich kann Sie noch nicht zuordnen.\nBitte teilen Sie Ihre Telefonnummer damit ich Ihre Buchungen finde.', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
        }
        return;
    }
    if (data === 'menu_loeschen') {
        const knownForDelete = await getTelegramCustomer(chatId);
        await handleTelegramDeleteQuery(chatId, knownForDelete);
        return;
    }

    // Profil anzeigen (Menü-Button)
    if (data === 'menu_profil') {
        const knownCustomer = await getTelegramCustomer(chatId);
        if (!knownCustomer) {
            await sendTelegramMessage(chatId, '❓ Bitte zuerst Telefonnummer teilen.', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
            return;
        }
        // 🔧 v6.15.8: Admin-Status im Profil anzeigen
        const isAdminProfile = await isTelegramAdmin(chatId);
        let msg = '👤 <b>Mein Profil</b>\n\n';
        if (isAdminProfile) msg += '🔑 Rolle: <b>Administrator</b>\n\n';
        msg += `📛 Name: <b>${knownCustomer.name || '—'}</b>\n`;
        msg += `📱 Telefon: <b>${knownCustomer.phone || '—'}</b>\n`;
        if (knownCustomer.mobile) msg += `📱 Mobil: <b>${knownCustomer.mobile}</b>\n`;
        msg += `🏠 Adresse: <b>${knownCustomer.address || 'nicht hinterlegt'}</b>\n`;
        if (isAdminProfile) msg += `\n🆔 Chat-ID: <code>${chatId}</code>\n`;
        msg += '\n<i>Tippen Sie auf einen Button um Ihre Daten zu ändern:</i>';
        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: [
            [{ text: '📛 Name ändern', callback_data: 'profil_edit_name' }],
            [{ text: '📱 Telefon ändern', callback_data: 'profil_edit_phone' }],
            [{ text: '🏠 Adresse ändern', callback_data: 'profil_edit_address' }],
            [{ text: '🏠 Menü', callback_data: 'main_menu' }]
        ] } });
        return;
    }

    // Profil-Feld bearbeiten
    if (data.startsWith('profil_edit_')) {
        const field = data.replace('profil_edit_', '');
        const knownCustomer = await getTelegramCustomer(chatId);
        if (!knownCustomer) {
            await sendTelegramMessage(chatId, '❓ Profil nicht gefunden. Bitte /start eingeben.');
            return;
        }
        const labels = { name: '📛 Name', phone: '📱 Telefonnummer', address: '🏠 Adresse' };
        const hints = { name: 'Ihren vollständigen Namen', phone: 'Ihre neue Telefonnummer (z.B. 0152 12345678)', address: 'Ihre Heimadresse (Straße Hausnummer, Ort)' };
        const current = { name: knownCustomer.name || '—', phone: knownCustomer.phone || '—', address: knownCustomer.address || 'nicht hinterlegt' };
        await setPending(chatId, { _profilEdit: field });
        await sendTelegramMessage(chatId,
            `✏️ <b>${labels[field]} ändern</b>\n\nAktuell: <b>${current[field]}</b>\n\nBitte geben Sie ${hints[field]} ein:\n\n<i>Tippe /abbrechen zum Abbrechen</i>`
        );
        return;
    }

    // 🆕 v6.15.7: CRM Kundendaten bearbeiten (Admin-Feature)
    if (data === 'menu_crm_edit') {
        if (!await isTelegramAdmin(chatId)) {
            await sendTelegramMessage(chatId, '⚠️ Nur für Admins verfügbar.');
            return;
        }
        await setPending(chatId, { _crmSearch: true });
        await sendTelegramMessage(chatId,
            '📋 <b>Kundendaten bearbeiten</b>\n\n🔍 Geben Sie den <b>Namen</b> oder die <b>Telefonnummer</b> des Kunden ein:', {
            reply_markup: { inline_keyboard: [
                [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
            ] }
        });
        return;
    }

    // 🆕 v6.15.7: CRM Kunde ausgewählt → Details anzeigen
    if (data.startsWith('crm_view_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const custId = data.replace('crm_view_', '');
        try {
            const snap = await db.ref('customers/' + custId).once('value');
            const cust = snap.val();
            if (!cust) { await sendTelegramMessage(chatId, '⚠️ Kunde nicht gefunden.'); return; }
            let msg = '📋 <b>Kundendaten</b>\n\n';
            msg += `📛 Name: <b>${cust.name || '—'}</b>\n`;
            msg += `📱 Telefon: <b>${cust.phone || '—'}</b>\n`;
            msg += `📱 Mobil: <b>${cust.mobilePhone || '—'}</b>\n`;
            msg += `🏠 Adresse: <b>${cust.address || '—'}</b>\n`;
            msg += `📍 Std. Abholort: <b>${cust.defaultPickup || '—'}</b>\n`;
            msg += `🏷️ Kategorie: <b>${cust.customerKind || '—'}</b>\n`;
            msg += `📝 Notizen: <b>${cust.notes || '—'}</b>\n`;
            msg += `\n<i>Tippen Sie auf ein Feld zum Ändern:</i>`;
            await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: [
                [{ text: '📛 Name', callback_data: `crm_edit_${custId}_name` }, { text: '📱 Telefon', callback_data: `crm_edit_${custId}_phone` }],
                [{ text: '📱 Mobil', callback_data: `crm_edit_${custId}_mobilePhone` }, { text: '🏠 Adresse', callback_data: `crm_edit_${custId}_address` }],
                [{ text: '📍 Std. Abholort', callback_data: `crm_edit_${custId}_defaultPickup` }, { text: '📝 Notizen', callback_data: `crm_edit_${custId}_notes` }],
                [{ text: '🏷️ Stammkunde/Gelegenheit', callback_data: `crm_kind_${custId}` }],
                [{ text: '🔍 Anderen Kunden suchen', callback_data: 'menu_crm_edit' }, { text: '🏠 Menü', callback_data: 'back_to_menu' }]
            ] } });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.15.7: CRM Feld bearbeiten
    if (data.startsWith('crm_edit_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const rest = data.replace('crm_edit_', '');
        const lastUnderscore = rest.lastIndexOf('_');
        const custId = rest.substring(0, lastUnderscore);
        const field = rest.substring(lastUnderscore + 1);
        const labels = { name: '📛 Name', phone: '📱 Telefon', mobilePhone: '📱 Mobilnummer', address: '🏠 Adresse', defaultPickup: '📍 Standard-Abholort', notes: '📝 Notizen' };
        const hints = { name: 'den neuen Namen', phone: 'die neue Festnetznummer', mobilePhone: 'die neue Mobilnummer', address: 'die neue Adresse (Straße Hausnr, Ort)', defaultPickup: 'den neuen Standard-Abholort', notes: 'die neuen Notizen' };
        try {
            const snap = await db.ref('customers/' + custId + '/' + field).once('value');
            const currentVal = snap.val() || '—';
            await setPending(chatId, { _crmEditCustomer: custId, _crmEditField: field });
            await sendTelegramMessage(chatId,
                `✏️ <b>${labels[field] || field} ändern</b>\n\nAktuell: <b>${currentVal}</b>\n\nBitte geben Sie ${hints[field] || 'den neuen Wert'} ein:`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '↩️ Zurück zum Kunden', callback_data: `crm_view_${custId}` }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                ] }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.15.7: CRM Kundenart (Stammkunde/Gelegenheit) per Button
    if (data.startsWith('crm_kind_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const custId = data.replace('crm_kind_', '');
        try {
            const snap = await db.ref('customers/' + custId + '/customerKind').once('value');
            const current = snap.val() || '—';
            await sendTelegramMessage(chatId,
                `🏷️ <b>Kundenart ändern</b>\n\nAktuell: <b>${current}</b>`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '⭐ Stammkunde', callback_data: `crm_setkind_${custId}_stammkunde` }],
                    [{ text: '👤 Gelegenheitskunde', callback_data: `crm_setkind_${custId}_gelegenheitskunde` }],
                    [{ text: '↩️ Zurück', callback_data: `crm_view_${custId}` }]
                ] }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.15.7: CRM Kundenart setzen
    if (data.startsWith('crm_setkind_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const rest = data.replace('crm_setkind_', '');
        const lastUnderscore = rest.lastIndexOf('_');
        const custId = rest.substring(0, lastUnderscore);
        const kind = rest.substring(lastUnderscore + 1);
        try {
            await db.ref('customers/' + custId).update({ customerKind: kind, updatedAt: Date.now() });
            await addTelegramLog('🏷️', chatId, `CRM: customerKind = "${kind}" für ${custId}`);
            await sendTelegramMessage(chatId, `✅ <b>Kundenart aktualisiert!</b>\n\n🏷️ ${kind === 'stammkunde' ? '⭐ Stammkunde' : '👤 Gelegenheitskunde'}`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '↩️ Zurück zum Kunden', callback_data: `crm_view_${custId}` }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                ] }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🧠 v6.15.8: KI-Training Menü
    if (data === 'menu_ai_rules') {
        if (!await isTelegramAdmin(chatId)) return;
        try {
            const snap = await db.ref('settings/aiRules').once('value');
            const rules = snap.exists() ? snap.val() : {};
            const ruleEntries = Object.entries(rules).filter(([, r]) => r && r.rule);
            let msg = '🧠 <b>KI-Training</b>\n\n';
            msg += '<i>Hier kannst du Regeln definieren, die die KI bei jeder Buchungsanalyse beachtet.</i>\n\n';
            if (ruleEntries.length === 0) {
                msg += '📭 <i>Noch keine Regeln gespeichert.</i>\n\n';
                msg += '💡 <b>Beispiele:</b>\n';
                msg += '• "Café Asgard liegt in Bansin, Seestraße 12"\n';
                msg += '• "Seepark bedeutet immer Seepark Heringsdorf"\n';
                msg += '• "Bei Klinik-Fahrten immer nach Patientenname fragen"\n';
            } else {
                msg += `📋 <b>${ruleEntries.length} Regel(n):</b>\n\n`;
                ruleEntries.forEach(([key, r], i) => {
                    const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('de-DE') : '?';
                    msg += `${i + 1}. ${r.rule}\n   <i>(${date})</i>\n\n`;
                });
            }
            const keyboard = [[{ text: '➕ Neue Regel hinzufügen', callback_data: 'ai_rule_add' }]];
            if (ruleEntries.length > 0) {
                keyboard.push([{ text: '🗑️ Regel löschen', callback_data: 'ai_rule_delete' }]);
            }
            keyboard.push([{ text: '🏠 Menü', callback_data: 'back_to_menu' }]);
            await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: keyboard } });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🧠 v6.15.8: KI-Regel hinzufügen
    if (data === 'ai_rule_add') {
        if (!await isTelegramAdmin(chatId)) return;
        await setPending(chatId, { _aiRuleAdd: true });
        await sendTelegramMessage(chatId, '🧠 <b>Neue KI-Regel</b>\n\n✏️ Schreibe die Regel als <b>klaren Satz</b>:\n\n💡 <b>Beispiele:</b>\n• <i>"Café Asgard ist in Bansin, Seestraße 12"</i>\n• <i>"Seepark 13 liegt in Bansin, nicht in Heringsdorf"</i>\n• <i>"Bei Hotels immer nach dem Gastnamen fragen"</i>\n• <i>"Köste ist ein Ortsteil von Heringsdorf"</i>', {
            reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'menu_ai_rules' }]] }
        });
        return;
    }

    // 🧠 v6.15.8: KI-Regel löschen — Liste anzeigen
    if (data === 'ai_rule_delete') {
        if (!await isTelegramAdmin(chatId)) return;
        try {
            const snap = await db.ref('settings/aiRules').once('value');
            if (!snap.exists()) { await sendTelegramMessage(chatId, '📭 Keine Regeln vorhanden.'); return; }
            const rules = snap.val();
            const entries = Object.entries(rules).filter(([, r]) => r && r.rule);
            if (entries.length === 0) { await sendTelegramMessage(chatId, '📭 Keine Regeln vorhanden.'); return; }
            const keyboard = entries.map(([key, r], i) => {
                const short = r.rule.length > 40 ? r.rule.slice(0, 38) + '…' : r.rule;
                return [{ text: `🗑️ ${i + 1}. ${short}`, callback_data: `ai_rule_del_${key}` }];
            });
            keyboard.push([{ text: '↩️ Zurück', callback_data: 'menu_ai_rules' }]);
            await sendTelegramMessage(chatId, '🗑️ <b>Welche Regel löschen?</b>', { reply_markup: { inline_keyboard: keyboard } });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🧠 v6.15.8: KI-Regel tatsächlich löschen
    if (data.startsWith('ai_rule_del_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const ruleKey = data.replace('ai_rule_del_', '');
        try {
            const ruleSnap = await db.ref('settings/aiRules/' + ruleKey).once('value');
            const ruleText = ruleSnap.exists() ? ruleSnap.val().rule : '?';
            await db.ref('settings/aiRules/' + ruleKey).remove();
            await addTelegramLog('🧠', chatId, `KI-Regel gelöscht: "${ruleText}"`);
            await sendTelegramMessage(chatId, `✅ <b>Regel gelöscht:</b>\n\n<s>${ruleText}</s>`, {
                reply_markup: { inline_keyboard: [[{ text: '↩️ Zurück zu KI-Training', callback_data: 'menu_ai_rules' }]] }
            });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🔔 v6.20.1: Benachrichtigungs-Einstellungen Menü
    if (data === 'menu_notify_prefs') {
        if (!await isTelegramAdmin(chatId)) return;
        const prefs = await getAdminNotifyPrefs(chatId) || {};
        const keyboard = [];
        for (const [key, cat] of Object.entries(NOTIFY_CATEGORIES)) {
            const isOn = prefs[key] !== false; // Standard: alles an
            keyboard.push([{
                text: `${isOn ? '✅' : '❌'} ${cat.emoji} ${cat.label}`,
                callback_data: `notify_toggle_${key}`
            }]);
        }
        keyboard.push([{ text: '🏠 Menü', callback_data: 'back_to_menu' }]);
        await sendTelegramMessage(chatId,
            '🔔 <b>Benachrichtigungen</b>\n\n<i>Wählen Sie aus, welche Nachrichten Sie erhalten möchten.\nTippen Sie zum Ein-/Ausschalten:</i>', {
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }

    // 🔔 v6.20.1: Benachrichtigungs-Kategorie umschalten
    if (data.startsWith('notify_toggle_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const category = data.replace('notify_toggle_', '');
        if (!NOTIFY_CATEGORIES[category]) return;
        const prefs = await getAdminNotifyPrefs(chatId) || {};
        const wasOn = prefs[category] !== false;
        prefs[category] = !wasOn;
        await db.ref(`settings/telegram/adminNotifyPrefs/${chatId}`).set(prefs);
        const cat = NOTIFY_CATEGORIES[category];
        await addTelegramLog('🔔', chatId, `Benachrichtigung ${wasOn ? 'deaktiviert' : 'aktiviert'}: ${cat.label}`);
        // Menü aktualisieren
        const keyboard = [];
        for (const [key, c] of Object.entries(NOTIFY_CATEGORIES)) {
            const isOn = prefs[key] !== false;
            keyboard.push([{
                text: `${isOn ? '✅' : '❌'} ${c.emoji} ${c.label}`,
                callback_data: `notify_toggle_${key}`
            }]);
        }
        keyboard.push([{ text: '🏠 Menü', callback_data: 'back_to_menu' }]);
        await sendTelegramMessage(chatId,
            `🔔 <b>Benachrichtigungen</b>\n\n${wasOn ? '❌' : '✅'} <b>${cat.label}</b> ${wasOn ? 'deaktiviert' : 'aktiviert'}\n\n<i>Tippen Sie zum Ein-/Ausschalten:</i>`, {
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }

    // 🆕 v6.11.6: Nummer-Zuordnung bestätigt → additionalPhones aktualisieren
    if (data.startsWith('confirm_addphone_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._addPhoneConfirm || !pending._callerPhone) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.');
            return;
        }
        const { customerId, name } = pending._addPhoneConfirm;
        const phoneToAdd = pending._callerPhone;
        try {
            // additionalPhones Array laden und erweitern
            const custSnap = await db.ref('customers/' + customerId).once('value');
            const custData = custSnap.val();
            const existing = custData.additionalPhones || [];
            if (!existing.includes(phoneToAdd)) {
                existing.push(phoneToAdd);
                await db.ref('customers/' + customerId).update({
                    additionalPhones: existing,
                    updatedAt: Date.now()
                });
            }
            await addTelegramLog('📞', chatId, `Nummer ${phoneToAdd} zu ${name} (${customerId}) hinzugefügt`);
            await sendTelegramMessage(chatId,
                `✅ <b>Nummer hinzugefügt!</b>\n\n` +
                `👤 ${name}\n📞 Neue Nummer: ${phoneToAdd}\n` +
                `📱 Gesamt: ${existing.length} Nummer(n) hinterlegt\n\n` +
                `🤖 <i>Nächster Anruf von dieser Nummer wird automatisch erkannt!</i>`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '🚕 Jetzt für diesen Kunden buchen', callback_data: 'taxi_for_customer' }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                ] }
            });
            // Pending aktualisieren damit taxi_for_customer den Kunden findet
            await setPending(chatId, {
                taxiChoice: { text: pending.taxiChoice?.text || '', userName: pending.taxiChoice?.userName || '' },
                _callerPhone: phoneToAdd,
                awaitingCustomerName: false
            });
        } catch(e) {
            await sendTelegramMessage(chatId, '⚠️ Fehler beim Speichern: ' + e.message);
        }
        return;
    }

    // 🆕 v6.11.6: Kunde aus Multi-Select für Nummer-Zuordnung gewählt
    if (data.startsWith('addphone_sel_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._addPhoneMulti || !pending._callerPhone) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.');
            return;
        }
        const parts = data.replace('addphone_sel_', '').split('_');
        const idx = parseInt(parts[0]);
        const selected = pending._addPhoneMulti.matches[idx];
        if (!selected) {
            await sendTelegramMessage(chatId, '⚠️ Auswahl nicht mehr gefunden.');
            return;
        }
        const confirmId = Date.now().toString(36);
        await setPending(chatId, {
            ...pending,
            _addPhoneMulti: null,
            _addPhoneConfirm: { customerId: selected.customerId || selected.id, name: selected.name, confirmId }
        });
        await sendTelegramMessage(chatId,
            `📞 <b>Nummer ${pending._callerPhone} zu ${selected.name} hinzufügen?</b>`, {
            reply_markup: { inline_keyboard: [
                [{ text: '✅ Ja, Nummer hinzufügen', callback_data: `confirm_addphone_${confirmId}` }],
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    // 🆕 v6.11.6: Nummer zu bestehendem Kunden hinzufügen
    if (data === 'add_phone_to_existing') {
        const pending = await getPending(chatId);
        if (!pending || !pending._callerPhone) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.');
            return;
        }
        await setPending(chatId, {
            ...pending,
            _awaitingAddPhoneToCustomer: true
        });
        await sendTelegramMessage(chatId,
            `📞 <b>Nummer ${pending._callerPhone} zuordnen</b>\n\n` +
            `Welchem Kunden soll diese Nummer hinzugefügt werden?\n` +
            `<i>Bitte den Kundennamen eingeben:</i>`, {
            reply_markup: { inline_keyboard: [
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    // Admin: Für Kunden oder für sich selbst
    if (data === 'taxi_for_customer' || data === 'taxi_for_self') {
        const pending = await getPending(chatId);
        if (!pending || !pending.taxiChoice) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden. Bitte nochmal senden.');
            return;
        }
        const { text, userName } = pending.taxiChoice;
        await deletePending(chatId);
        if (data === 'taxi_for_self') {
            await sendTelegramMessage(chatId, '🤖 <i>Analysiere deine Nachricht...</i>');
            await analyzeTelegramBooking(chatId, text, userName, { forSelf: true });
        } else {
            // 🔧 v6.15.8: _callerPhone durchreichen damit Telefon-Schritt übersprungen wird
            await setPending(chatId, { awaitingCustomerName: true, originalText: text, userName, _callerPhone: pending._callerPhone || null });
            await sendTelegramMessage(chatId, '👤 <b>Für welchen Kunden?</b>\n\nBitte den Kundennamen eingeben:', {
                reply_markup: { inline_keyboard: [
                    [{ text: '🆕 Neuen Kunden anlegen', callback_data: 'admin_new_customer' }],
                    [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ] }
            });
        }
        return;
    }

    // Buchung trotz Zeitkonflikt / kein Fahrer eintragen (Override)
    if (data.startsWith('book_force_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.booking) {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden. Bitte nochmal senden.');
            return;
        }
        if (data.includes('nodriver')) {
            pending._noDriverOverride = true;
            await setPending(chatId, pending);
            await addTelegramLog('⚡', chatId, 'Kein-Fahrer-Override: Sofortfahrt wird trotzdem eingetragen');
        } else {
            pending._conflictOverride = true;
            await setPending(chatId, pending);
            await addTelegramLog('⚡', chatId, 'Zeitkonflikt-Override: Buchung wird trotzdem eingetragen');
        }
        // Weiterleiten an book_yes_ Handler
        data = 'book_yes_' + (pending.bookingId || '');
    }

    // Buchung bestätigen
    if (data.startsWith('book_yes_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.booking) {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden. Bitte nochmal senden.');
            return;
        }

        // Duplikat-Schutz via Firebase-Transaktion
        const bookingLockId = pending.bookingId || chatId;
        const lockRef = db.ref(`telegram/bookingLocks/${bookingLockId}`);
        let lockAcquired = false;
        try {
            const txResult = await lockRef.transaction(current => {
                if (current !== null) return;
                return Date.now();
            });
            lockAcquired = txResult.committed;
        } catch (e) { lockAcquired = true; }
        if (!lockAcquired) return;
        // Lock nach 60s freigeben
        setTimeout(() => lockRef.remove().catch(() => {}), 60000);

        // Timeout-Check
        if (isPendingExpired(pending)) {
            await deletePending(chatId);
            await sendTelegramMessage(chatId, '⏰ <b>Buchung abgelaufen</b> (nach 30 Min).\n\nBitte senden Sie Ihre Anfrage nochmal!');
            return;
        }

        try {
            const booking = pending.booking;
            // Letzter Schutz: Ohne datetime keine Buchung
            if (!booking.datetime) {
                await addTelegramLog('🛡️', chatId, 'Buchung abgebrochen: Kein Datum/Uhrzeit gesetzt');
                await sendTelegramMessage(chatId, '⚠️ <b>Datum/Uhrzeit fehlt!</b>\n\nBitte nenne mir zuerst, wann du das Taxi brauchst (Datum und Uhrzeit).');
                if (!booking.missing) booking.missing = [];
                if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
                await setPending(chatId, { partial: booking, originalText: '' });
                return;
            }
            const pickupTimestamp = parseGermanDatetime(booking.datetime);
            const dt = new Date(pickupTimestamp);
            const minutesUntilPickup = (pickupTimestamp - Date.now()) / 60000;
            const isVorbestellung = minutesUntilPickup > 60;
            // 🔍 v6.25.4: Diagnose-Logging für Sofort/Vorbestellung-Erkennung
            console.log(`🔍 Buchung Sofort/Vorbestellung-Check:`, JSON.stringify({
                'booking.datetime': booking.datetime,
                'pickupTimestamp': pickupTimestamp,
                'pickupTime (Berlin)': dt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
                'Date.now()': Date.now(),
                'minutesUntilPickup': Math.round(minutesUntilPickup),
                'isVorbestellung': isVorbestellung,
                'isJetzt': booking._isJetzt || false
            }));
            await addTelegramLog('🔍', chatId, `Sofort-Check: datetime="${booking.datetime}" → ${Math.round(minutesUntilPickup)} Min bis Abholung → ${isVorbestellung ? 'VORBESTELLUNG' : 'SOFORTFAHRT'}`);
            const passengers = booking.passengers || 1;
            const timeStr = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });

            // Verfügbarkeits-Check: Zeitkonflikt erkennen und melden
            const estDuration = pending.routePrice?.duration ? parseInt(pending.routePrice.duration) : null;
            const conflict = await checkTelegramTimeConflict(pickupTimestamp, estDuration);
            if (conflict && !pending._conflictOverride) {
                // Detaillierte Konflikt-Meldung senden
                let conflictMsg = '⚠️ <b>Zeitkonflikt erkannt!</b>\n\n';
                conflictMsg += `Du möchtest ein Taxi um <b>${timeStr} Uhr</b>.\n\n`;
                conflictMsg += '❌ <b>Problem:</b> Zu dieser Zeit ';
                conflictMsg += conflict.conflicts.length === 1 ? 'ist bereits eine Fahrt gebucht' : `sind bereits ${conflict.conflicts.length} Fahrten gebucht`;
                conflictMsg += `:\n\n`;
                for (const c of conflict.conflicts) {
                    conflictMsg += `🚕 ${c.startTime}–${c.endTime} Uhr\n`;
                    conflictMsg += `   📍 ${c.pickup} → ${c.destination}\n\n`;
                }
                conflictMsg += `💡 <b>Warum?</b> `;
                if (conflict.vehicleCount <= 1) {
                    conflictMsg += 'Es ist nur 1 Fahrzeug verfügbar. Das Taxi ist zu dieser Zeit noch unterwegs und kann dich nicht gleichzeitig abholen.';
                } else {
                    conflictMsg += `Es sind ${conflict.vehicleCount} Fahrzeuge verfügbar, aber alle bereits belegt zu dieser Zeit.`;
                }
                conflictMsg += `\n\n🕐 <b>Frühestens frei:</b> ${conflict.earliestFreeTime} Uhr`;
                conflictMsg += '\n\n<b>Was möchtest du tun?</b>';

                // Buttons: Alternative Zeit oder trotzdem buchen
                const conflictKeyboard = { inline_keyboard: [] };
                // Alternative Zeitvorschläge
                const altTime = new Date(conflict.earliestFree);
                const altTimeStr = altTime.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });
                const [altHH, altMM] = altTimeStr.split(':');
                conflictKeyboard.inline_keyboard.push([
                    { text: `🕐 ${altTimeStr} Uhr (nächster freier Slot)`, callback_data: `slot_${chatId}_${altHH}_${altMM}` }
                ]);
                // ±30 Min vom freien Slot
                const alt30 = new Date(conflict.earliestFree + 30 * 60000);
                const alt30Str = alt30.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });
                const [a30HH, a30MM] = alt30Str.split(':');
                conflictKeyboard.inline_keyboard.push([
                    { text: `🕐 ${alt30Str} Uhr (+30 Min)`, callback_data: `slot_${chatId}_${a30HH}_${a30MM}` }
                ]);
                // Trotzdem eintragen (Admin-Override)
                conflictKeyboard.inline_keyboard.push([
                    { text: '⚡ Trotzdem eintragen', callback_data: `book_force_${pending.bookingId}` }
                ]);
                conflictKeyboard.inline_keyboard.push([
                    { text: '❌ Abbrechen', callback_data: `book_no_${pending.bookingId}` }
                ]);

                await sendTelegramMessage(chatId, conflictMsg, { reply_markup: conflictKeyboard });
                await addTelegramLog('⚠️', chatId, `Zeitkonflikt: ${timeStr} Uhr – ${conflict.conflicts.length} Fahrt(en) belegt, frei ab ${conflict.earliestFreeTime}`);
                return;
            }

            // 🔧 v6.20.2: Sofortfahrt — Schichtplan-Check statt GPS-Check
            // Geht durch wenn mindestens 1 Fahrzeug im Schichtdienst ist
            if (booking._isJetzt && !pending._noDriverOverride) {
                const _shiftsSnap = await db.ref('vehicleShifts').once('value');
                const _shiftsData = _shiftsSnap.val() || {};
                const _now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
                const _dateStr = _now.getFullYear() + '-' + String(_now.getMonth()+1).padStart(2,'0') + '-' + String(_now.getDate()).padStart(2,'0');
                const _timeStr = String(_now.getHours()).padStart(2,'0') + ':' + String(_now.getMinutes()).padStart(2,'0');
                let _anyInShift = false;
                for (const [vId] of Object.entries(OFFICIAL_VEHICLES)) {
                    if (isVehicleInShift(vId, _shiftsData, _dateStr, _timeStr)) { _anyInShift = true; break; }
                }
                if (!_anyInShift) {
                    await sendTelegramMessage(chatId,
                        `😔 <b>Zur Zeit ist leider kein Fahrer online erreichbar.</b>\n\n` +
                        `📞 Bitte rufen Sie uns an: <b>038378 / 22022</b>`,
                        { reply_markup: { inline_keyboard: [
                            [{ text: '🏠 Menü', callback_data: 'back_to_menu' }]
                        ] } }
                    );
                    await addTelegramLog('😔', chatId, `Sofortfahrt blockiert: Kein Fahrzeug im Schichtdienst (${_dateStr} ${_timeStr})`);
                    return;
                }
                await addTelegramLog('🟢', chatId, `Sofortfahrt: Fahrzeug im Schichtdienst → wird eingetragen`);
            }

            // Preis: gespeicherten verwenden, nur als Fallback neu berechnen
            let telegramRoutePrice = pending.routePrice || null;
            if (!telegramRoutePrice && booking.pickupLat && booking.destinationLat) {
                try { telegramRoutePrice = await calculateTelegramRoutePrice(booking); } catch (e) {}
            }

            // 🔧 v6.14.2: Telefonnummer-Absicherung — wenn phone fehlt, aus CRM nachladen
            if (!booking.phone && booking._crmCustomerId) {
                try {
                    const _custSnap = await db.ref('customers/' + booking._crmCustomerId).once('value');
                    const _custData = _custSnap.val();
                    if (_custData && (_custData.mobilePhone || _custData.phone)) {
                        booking.phone = _custData.mobilePhone || _custData.phone;
                        await addTelegramLog('📱', chatId, `Telefon aus CRM nachgeladen: ${booking.phone}`);
                    }
                } catch (_e) { /* ignore */ }
            }

            const rideData = {
                pickup: booking.pickup || 'Abholort offen',
                destination: booking.destination || 'Zielort offen',
                pickupTimestamp,
                pickupTime: dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' }),
                pickupDate: dt.toLocaleDateString('de-DE', TZ_BERLIN),
                passengers,
                customerName: booking.name || 'Telegram',
                customerPhone: booking.phone || '',
                // 🔧 v6.14.4: Mobilnummer separat für Google Calendar Sync!
                // 🔧 v6.14.6: isMobileNumber() statt Inline-Regex — erkennt jetzt auch AT/CH
                ...(isMobileNumber(booking.phone) && { customerMobile: booking.phone }),
                ...(booking.email && { customerEmail: booking.email }),
                telegramChatId: String(chatId),
                notes: booking.notes && booking.notes !== 'null' ? booking.notes : '',
                // 🔧 v6.14.7: 'new' statt 'open' — damit Auto-Assign auch Telegram-Sofortfahrten zuweist!
                status: isVorbestellung ? 'vorbestellt' : 'new',
                ...(booking._isJetzt && { isJetzt: true }),
                source: booking._adminBooked ? 'telegram-admin' : 'telegram-bot',
                createdAt: Date.now(),
                createdBy: booking._adminBooked ? `admin-telegram-${booking._adminChatId}` : 'telegram-cloud-function',
                ...(booking._adminBooked && { adminBookedBy: String(booking._adminChatId), bookedForCustomer: booking._forCustomer || booking.name }),
                // 🔧 v6.11.0: Koordinaten als flache Felder UND Objekte (für Kalender/AutoAssign)
                ...(booking.pickupLat && { pickupLat: booking.pickupLat, pickupLon: booking.pickupLon, pickupCoords: { lat: booking.pickupLat, lon: booking.pickupLon } }),
                ...(booking.destinationLat && { destinationLat: booking.destinationLat, destinationLon: booking.destinationLon, destCoords: { lat: booking.destinationLat, lon: booking.destinationLon } }),
                // 🔧 v6.11.0: Preis als 'price' UND 'estimatedPrice' (Kalender zeigt ride.price)
                ...(telegramRoutePrice && { price: telegramRoutePrice.price, estimatedPrice: telegramRoutePrice.price, distance: telegramRoutePrice.distance, estimatedDistance: telegramRoutePrice.distance, estimatedDuration: telegramRoutePrice.duration, duration: telegramRoutePrice.duration }),
                paymentMethod: booking.paymentMethod || 'bar',
                // 🆕 v6.11.5: Gastname (wenn eingetragen)
                ...(booking.guestName && { guestName: booking.guestName }),
                // 🆕 v6.15.0: Gast-Telefon (bei Auftraggeber-Buchungen)
                ...(booking.guestPhone && { guestPhone: booking.guestPhone }),
                // 🔧 v6.11.0: Zwischenstopps
                ...(booking.waypoints && booking.waypoints.length > 0 && { waypoints: booking.waypoints })
            };

            const newRef = db.ref('rides').push();
            rideData.id = newRef.key;
            await newRef.set(rideData);

            // Erfolgsmeldung
            const successHeader = booking._adminBooked
                ? `✅ <b>Buchung für ${booking._forCustomer || rideData.customerName} eingetragen!</b>\n\n`
                : '🎉 <b>Termin eingetragen!</b>\n\n';
            // 🔧 v6.11.0: Rückfahrt-Button nach Buchung
            // 🔧 v6.14.7: + Datum ändern + Gastname Buttons
            // 🔧 v6.15.5: + Personenzahl ändern Button
            const returnKeyboard = { inline_keyboard: [
                [{ text: '🔄 Rückfahrt buchen', callback_data: `return_${rideData.id}` }],
                [{ text: '📅 Datum ändern', callback_data: `chdate_${rideData.id}` }, { text: '👥 Personen', callback_data: `chpax_${rideData.id}` }],
                [{ text: '👤 Gastname', callback_data: `chguest_${rideData.id}` }],
                [{ text: '📋 Meine Buchungen', callback_data: 'cmd_meine' }, { text: '🏠 Hauptmenü', callback_data: 'back_to_menu' }]
            ]};
            const _isJetztFahrt = booking._isJetzt;
            await sendTelegramMessage(chatId,
                successHeader +
                (_isJetztFahrt
                    ? `🚖 <b>Sofortfahrt</b> – ein verfügbarer Fahrer wird gesucht!\n`
                    : `📅 ${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' })} um ${timeStr} Uhr\n`) +
                `📍 ${rideData.pickup} → ${rideData.destination}\n` +
                `👤 ${rideData.customerName}` + (rideData.customerPhone ? ` · 📱 ${rideData.customerPhone}` : '') + '\n' +
                `👥 ${passengers} Person(en)\n` +
                (telegramRoutePrice ? `🗺️ ca. ${telegramRoutePrice.distance} km (~${telegramRoutePrice.duration} Min)\n💰 ca. ${telegramRoutePrice.price} €\n` : '') +
                `📋 Status: ${_isJetztFahrt ? 'Sofortfahrt' : (isVorbestellung ? 'Vorbestellt' : 'Offen')}\n\n✅ Fahrt ist im System!\n\n💡 <i>Sie werden benachrichtigt, sobald ein Fahrer zugewiesen ist.</i>`,
                { reply_markup: returnKeyboard }
            );

            await addTelegramLog('💾', chatId, `Fahrt erstellt: ${rideData.pickup} → ${rideData.destination}`, { rideId: rideData.id });

            // 🔧 v6.25.4: Auto-Zuweisung NUR für Sofortfahrten — Vorbestellungen NICHT sofort zuweisen
            if (rideData.pickupCoords && !isVorbestellung) {
                const assignResult = await autoAssignRide(rideData.id, rideData);
                if (assignResult) {
                    const etaMin = assignResult.drivingTimeMin || Math.max(3, Math.round((assignResult.distance / 40) * 60));
                    await sendTelegramMessage(chatId,
                        `🚗 <b>Fahrer gefunden!</b>\n\n` +
                        `🚕 <b>${assignResult.name}</b>\n` +
                        `📏 ${assignResult.distance.toFixed(1)} km entfernt\n` +
                        `⏱️ <b>Geschätzte Ankunft: ca. ${etaMin} Minuten</b>\n\n` +
                        `💡 <i>Sie werden benachrichtigt sobald der Fahrer losfährt.</i>`
                    );
                    await addTelegramLog('🚗', chatId, `Auto-Zuweisung: ${assignResult.name} (${assignResult.distance.toFixed(1)} km, ~${etaMin} Min)`);
                } else if (_isJetztFahrt) {
                    // 🔧 v6.20.2: Sofortfahrt ohne Auto-Zuweisung → Admin-Vermittlung
                    await db.ref('rides/' + rideData.id).update({ status: 'warteschlange', updatedAt: Date.now() });

                    // Kunde beruhigen
                    await sendTelegramMessage(chatId,
                        `🚕 <b>Wir suchen einen Fahrer für Sie!</b>\n\n` +
                        `📢 Sie werden in wenigen Minuten benachrichtigt.\n\n` +
                        `💡 <i>Sie müssen nichts weiter tun — der Fahrer meldet sich automatisch bei Ihnen.</i>`,
                        { reply_markup: { inline_keyboard: [
                            [{ text: '📅 Lieber für später buchen', callback_data: `chdate_${rideData.id}` }],
                            [{ text: '🗑️ Stornieren', callback_data: `cancel_ride_${rideData.id}` }]
                        ] } }
                    );

                    // 🚨 Admin-Sofort-Push mit Zuweisungs-Buttons
                    try {
                        const _adminSnap = await db.ref('settings/telegram/adminChats').once('value');
                        const _adminChats = _adminSnap.val() || [];
                        if (_adminChats.length > 0) {
                            // Verfügbare Fahrzeuge für Quick-Assign-Buttons sammeln
                            const _assignButtons = [];
                            for (const [vId, vInfo] of Object.entries(OFFICIAL_VEHICLES)) {
                                _assignButtons.push([{ text: `🚕 ${vInfo.name} zuweisen`, callback_data: `qassign_${rideData.id}_${vId}` }]);
                                if (_assignButtons.length >= 4) break;
                            }
                            const _urgentMsg = `🚨 <b>SOFORTFAHRT – Fahrer gesucht!</b>\n\n` +
                                `📍 <b>Von:</b> ${rideData.pickup}\n` +
                                `🎯 <b>Nach:</b> ${rideData.destination}\n` +
                                `👤 <b>Name:</b> ${rideData.customerName}\n` +
                                (rideData.customerPhone ? `📱 <b>Tel:</b> ${rideData.customerPhone}\n` : '') +
                                `👥 <b>Personen:</b> ${passengers}\n` +
                                (telegramRoutePrice ? `💰 ca. ${telegramRoutePrice.price} €\n` : '') +
                                `\n⚡ <b>Bitte Fahrer zuweisen:</b>`;
                            for (const adminChatId of _adminChats) {
                                sendTelegramMessage(adminChatId, _urgentMsg, { reply_markup: { inline_keyboard: _assignButtons } }).catch(() => {});
                            }
                        }
                    } catch (_e) { console.error('Admin-Sofort-Push Fehler:', _e.message); }

                    await addTelegramLog('🚨', chatId, `Sofortfahrt: Kein Fahrer auto-zugewiesen → Admin-Vermittlung`);
                } else {
                    await addTelegramLog('⚠️', chatId, 'Kein Fahrzeug für Auto-Zuweisung verfügbar');
                }
            }

            await deletePending(chatId);

            // Kunden-Erkennung
            if (!booking._adminBooked && (booking.phone || booking.name)) {
                linkTelegramChatToCustomer(chatId, booking).catch(() => {});
            }

            // Admin-Benachrichtigung bei ALLEN Buchungen (Kunden + Admin)
            try {
                const adminSnap = await db.ref('settings/telegram/adminChats').once('value');
                const adminChats = adminSnap.val() || [];
                if (adminChats.length > 0) {
                    const now = new Date();
                    const isTodayBerlin = dt.toLocaleDateString('de-DE', TZ_BERLIN) === now.toLocaleDateString('de-DE', TZ_BERLIN);
                    let timeLabel;
                    if (!isVorbestellung) {
                        timeLabel = 'SOFORT';
                    } else if (isTodayBerlin) {
                        timeLabel = `Heute ${timeStr} Uhr`;
                    } else {
                        timeLabel = `${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, day: '2-digit', month: '2-digit', year: '2-digit' })} ${timeStr} Uhr`;
                    }
                    const sentAt = now.toLocaleString('de-DE', { ...TZ_BERLIN, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const statusEmoji = isVorbestellung ? '📅' : '🚕';
                    const statusText = isVorbestellung ? 'VORBESTELLUNG' : 'SOFORT-FAHRT!';
                    const adminBookedHint = booking._adminBooked ? `\n👔 <i>Admin-Buchung für ${booking._forCustomer || rideData.customerName}</i>` : '';
                    const adminMsg = `${statusEmoji} <b>${statusText}</b>\n` +
                        `🆔 <b>ID:</b> <code>${rideData.id}</code>\n\n` +
                        `📍 <b>Von:</b> ${rideData.pickup}\n` +
                        `🎯 <b>Nach:</b> ${rideData.destination}\n` +
                        `👤 <b>Name:</b> ${rideData.customerName}\n` +
                        (rideData.customerPhone ? `📱 <b>Tel:</b> ${rideData.customerPhone}\n` : '') +
                        `🕐 <b>Abholung:</b> ${timeLabel}\n` +
                        `👥 <b>Personen:</b> ${passengers}\n` +
                        (telegramRoutePrice ? `💰 <b>Preis:</b> ca. ${telegramRoutePrice.price} €\n` : '') +
                        `⏰ <b>Gesendet:</b> ${sentAt}` +
                        adminBookedHint + `\n\n` +
                        `📱 <i>Via Telegram-Bot</i>`;
                    // Bei Admin-Buchungen: An ANDERE Admins senden (nicht an den Buchenden selbst)
                    for (const adminChatId of adminChats) {
                        if (booking._adminBooked && String(adminChatId) === String(chatId)) continue;
                        const prefs = await getAdminNotifyPrefs(adminChatId);
                        if (prefs && prefs.new_ride === false) continue;
                        sendTelegramMessage(adminChatId, adminMsg).catch(() => {});
                    }
                    // Bei Admin-Buchungen: Dem buchenden Admin eine Kurzbestätigung senden (als separater Block)
                    if (booking._adminBooked) {
                        await addTelegramLog(statusEmoji, 'system', `${statusText}: ${rideData.customerName} → ${timeLabel}`, { rideId: rideData.id, adminBooked: true });
                    }
                }
            } catch (e) {
                console.error('Admin-Benachrichtigung Fehler:', e.message);
            }

            // 🆕 v6.14.0: Admin-Buchung → CRM-Eintrag AUTOMATISCH anlegen!
            // 🔧 v6.14.2: Auch undefined prüfen (Firebase entfernt null-Werte) + Duplikat-Check
            if (booking._adminBooked && booking._forCustomer && (booking._crmCustomerId === null || booking._crmCustomerId === undefined)) {
                try {
                    const _crmName = booking._forCustomer || booking.name;
                    const _crmPhone = booking.phone || '';
                    const _crmPickup = booking.pickup || '';

                    // 🔧 v6.14.2: Duplikat-Check — nicht anlegen wenn Kunde mit gleichem Namen/Telefon schon existiert
                    let _alreadyExists = false;
                    try {
                        const _allCust = await loadAllCustomers();
                        const _nameLower = _crmName.toLowerCase().trim();
                        const _phoneDigits = _crmPhone.replace(/\D/g, '');
                        for (const c of _allCust) {
                            const cNameMatch = (c.name || '').toLowerCase().trim() === _nameLower;
                            // 🔧 v6.14.6: Auch mobilePhone prüfen — nicht nur phone!
                            const cPhoneDigits = (c.mobilePhone || c.phone || '').replace(/\D/g, '');
                            const cPhone2Digits = (c.mobilePhone && c.phone) ? (c.phone || '').replace(/\D/g, '') : '';
                            const cPhoneMatch = _phoneDigits.length > 5 && (
                                (cPhoneDigits.length > 5 && cPhoneDigits.endsWith(_phoneDigits.slice(-9))) ||
                                (cPhone2Digits.length > 5 && cPhone2Digits.endsWith(_phoneDigits.slice(-9)))
                            );
                            if (cNameMatch || cPhoneMatch) {
                                _alreadyExists = true;
                                // Fahrt mit gefundenem Kunden verknüpfen + Telefonnummer übernehmen
                                const _rideUpdate = { customerId: c.customerId };
                                // 🔧 v6.14.3: Telefonnummer aus CRM in Fahrt speichern (für Google Calendar Sync)
                                if (c.mobilePhone) _rideUpdate.customerMobile = c.mobilePhone;
                                if (!rideData.customerPhone && (c.mobilePhone || c.phone)) {
                                    _rideUpdate.customerPhone = c.mobilePhone || c.phone;
                                }
                                await db.ref('rides/' + rideData.id).update(_rideUpdate);
                                await addTelegramLog('🔗', chatId, `CRM-Kunde bereits vorhanden: ${c.name} (${c.customerId}) → Fahrt verknüpft`);
                                break;
                            }
                        }
                    } catch (_dupErr) { console.warn('CRM Duplikat-Check Fehler:', _dupErr.message); }

                    if (!_alreadyExists) {
                        // 🔧 v6.14.5: Auto-Erkennung Mobil vs. Festnetz
                        // 🔧 v6.14.6: isMobileNumber() statt Inline-Regex
                        const _isCrmMobil = isMobileNumber(_crmPhone);
                        const newCrmRef = db.ref('customers').push();
                        await newCrmRef.set({
                            name: _crmName,
                            phone: _isCrmMobil ? '' : (_crmPhone || ''),
                            mobilePhone: _isCrmMobil ? _crmPhone : '',
                            address: '',
                            defaultPickup: _crmPickup,
                            email: booking.email || '',
                            createdAt: Date.now(),
                            createdBy: 'telegram-admin-auto',
                            source: 'telegram-admin',
                            totalRides: 1,
                            isVIP: false,
                            notes: ''
                        });

                        // Fahrt mit CRM verknüpfen + Telefonnummer übernehmen
                        const _newCrmUpdate = { customerId: newCrmRef.key };
                        if (_crmPhone && !rideData.customerPhone) _newCrmUpdate.customerPhone = _crmPhone;
                        // 🔧 v6.14.4: Mobilnummer für Google Calendar Sync
                        // 🔧 v6.14.6: isMobileNumber() statt Inline-Regex
                        if (isMobileNumber(_crmPhone)) {
                            _newCrmUpdate.customerMobile = _crmPhone;
                        }
                        await db.ref('rides/' + rideData.id).update(_newCrmUpdate);

                        await addTelegramLog('🆕', chatId, `CRM auto-angelegt: ${_crmName} (${newCrmRef.key})`);
                        await sendTelegramMessage(chatId,
                            `✅ <b>${_crmName}</b> automatisch im CRM angelegt!\n` +
                            (_crmPhone ? `📱 ${_crmPhone}\n` : '') +
                            (_crmPickup ? `📍 Standard-Abholort: ${_crmPickup}` : '')
                        );
                    }
                } catch (e) {
                    console.error('CRM Auto-Anlage Fehler:', e);
                }
            }
        } catch (e) {
            await addTelegramLog('❌', chatId, 'Fehler: ' + e.message);
            await sendTelegramMessage(chatId, '⚠️ Fehler beim Eintragen: ' + e.message);
        }
        return;
    }

    // Zahlungsmethode umschalten
    if (data.startsWith('pay_bar_') || data.startsWith('pay_karte_')) {
        const isKarte = data.startsWith('pay_karte_');
        const payBookingId = data.replace(/^pay_(bar|karte)_/, '');
        const payPending = await getPending(chatId);
        if (payPending && payPending.bookingId === payBookingId && payPending.booking) {
            payPending.booking.paymentMethod = isKarte ? 'karte' : 'bar';
            await setPending(chatId, payPending);
            // Bestätigung inline aktualisieren (kein neues Nachricht)
            const updatedMsg = buildTelegramConfirmMsg(payPending.booking, payPending.routePrice || null);
            const updatedKeyboard = buildBookingConfirmKeyboard(payBookingId, chatId, payPending.booking);
            const msgId = callback.message?.message_id;
            if (msgId) {
                await editTelegramMessage(chatId, msgId, updatedMsg, { reply_markup: updatedKeyboard });
            } else {
                await sendTelegramMessage(chatId, updatedMsg, { reply_markup: updatedKeyboard });
            }
            await addTelegramLog('💳', chatId, `Zahlungsmethode: ${isKarte ? 'Karte' : 'Bar'}`);
        }
        return;
    }

    // 🔧 v6.11.0: Tauschen (Von ↔ Nach) in der Bestätigungsansicht
    if (data.startsWith('swap_')) {
        const swapBookingId = data.replace('swap_', '');
        const swapPending = await getPending(chatId);
        if (swapPending && swapPending.bookingId === swapBookingId && swapPending.booking) {
            const b = swapPending.booking;
            // Adressen tauschen
            const tmpPickup = b.pickup;
            b.pickup = b.destination;
            b.destination = tmpPickup;
            // Koordinaten tauschen
            const tmpLat = b.pickupLat; const tmpLon = b.pickupLon;
            b.pickupLat = b.destinationLat; b.pickupLon = b.destinationLon;
            b.destinationLat = tmpLat; b.destinationLon = tmpLon;
            // Route neu berechnen
            let newRoutePrice = null;
            if (b.pickupLat && b.destinationLat) {
                try { newRoutePrice = await calculateRoutePrice(b); } catch(e) {}
            }
            swapPending.routePrice = newRoutePrice;
            await setPending(chatId, swapPending);
            // Nachricht aktualisieren
            const swapMsg = buildTelegramConfirmMsg(b, newRoutePrice);
            const swapKeyboard = buildBookingConfirmKeyboard(swapBookingId, chatId, b);
            const msgId = callback.message?.message_id;
            if (msgId) {
                await editTelegramMessage(chatId, msgId, '🔄 <b>Getauscht!</b>\n\n' + swapMsg, { reply_markup: swapKeyboard });
            } else {
                await sendTelegramMessage(chatId, '🔄 <b>Getauscht!</b>\n\n' + swapMsg, { reply_markup: swapKeyboard });
            }
            await addTelegramLog('🔄', chatId, `Adressen getauscht: ${b.pickup} → ${b.destination}`);
        }
        return;
    }

    // 🔧 v6.11.0: Zwischenstopp hinzufügen
    if (data.startsWith('waypoint_')) {
        const wpBookingId = data.replace('waypoint_', '');
        const wpPending = await getPending(chatId);
        if (wpPending && wpPending.bookingId === wpBookingId && wpPending.booking) {
            await setPending(chatId, { ...wpPending, _awaitingWaypoint: true });
            await sendTelegramMessage(chatId,
                '📍 <b>Zwischenstopp hinzufügen</b>\n\n' +
                'Wo soll der Zwischenstopp sein?\n' +
                '<i>z.B. "Edeka Heringsdorf" oder "Bahnhof Bansin"</i>\n\n' +
                '💡 Der Zwischenstopp wird zwischen Abholort und Zielort eingefügt.',
                { reply_markup: { inline_keyboard: [
                    [{ text: '◀️ Zurück', callback_data: 'back_to_confirm_' + wpBookingId }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ]}}
            );
            await addTelegramLog('📍', chatId, 'Zwischenstopp wird abgefragt');
        }
        return;
    }

    // Buchung ablehnen / ändern
    // Bemerkung zur Buchung hinzufügen
    if (data.startsWith('book_note_')) {
        const noteBookingId = data.replace('book_note_', '');
        const notePending = await getPending(chatId);
        if (notePending && notePending.bookingId === noteBookingId && notePending.booking) {
            await setPending(chatId, { ...notePending, _awaitingNote: true });
            await sendTelegramMessage(chatId, '📝 <b>Bemerkung zur Fahrt</b>\n\nBitte schreiben Sie Ihre Bemerkung:\n<i>z.B. Kindersitz, Rollstuhl, großer Koffer, Hund, etc.</i>', { reply_markup: { inline_keyboard: [
                [{ text: '◀️ Zurück', callback_data: 'back_to_confirm_' + noteBookingId }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ]}});
        } else {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden. Bitte nochmal senden.');
        }
        return;
    }

    // 🆕 v6.15.0: Gastname überspringen → weiter mit Personenzahl/Bestätigung
    if (data.startsWith('skip_guest_')) {
        const pending = await getPending(chatId);
        const booking = pending && (pending.booking || pending.partial);
        if (booking) {
            delete pending._awaitingBookingGuest;
            await addTelegramLog('⏭️', chatId, 'Gastname übersprungen');
            const routePrice = pending.routePrice || await calculateTelegramRoutePrice(booking);
            // Weiter zu Personenzahl
            const hasExplicitPassengers = booking._passengersExplicit || (booking.passengers && booking.passengers > 1);
            if (hasExplicitPassengers) {
                return showTelegramConfirmation(chatId, booking, routePrice);
            }
            const bookingId = Date.now().toString(36);
            await setPending(chatId, { booking, bookingId, routePrice, originalText: pending.originalText || '', _awaitingPassengers: true });
            // 🔧 v6.25.4: Zurück-Button geht zur Uhrzeit-Auswahl statt zum Menü
            await sendTelegramMessage(chatId, '👥 <b>Wie viele Personen fahren mit?</b>', {
                reply_markup: { inline_keyboard: [
                    [
                        { text: '🧑 1', callback_data: `pax_1_${bookingId}` },
                        { text: '👥 2', callback_data: `pax_2_${bookingId}` },
                        { text: '👨‍👩‍👦 3', callback_data: `pax_3_${bookingId}` },
                        { text: '👨‍👩‍👧‍👦 4', callback_data: `pax_4_${bookingId}` }
                    ],
                    [
                        { text: '5', callback_data: `pax_5_${bookingId}` },
                        { text: '6', callback_data: `pax_6_${bookingId}` },
                        { text: '7+', callback_data: `pax_7_${bookingId}` }
                    ],
                    [
                        { text: '◀️ Zurück', callback_data: 'pax_back' },
                        { text: '❌ Abbrechen', callback_data: 'cancel_booking' }
                    ]
                ]}
            });
        }
        return;
    }

    if (data.startsWith('book_no_')) {
        const noBookingId = data.replace('book_no_', '');
        const noPending = await getPending(chatId);
        const noBooking = noPending && (noPending.booking || noPending.partial);
        if (noBooking && noPending.bookingId === noBookingId) {
            await sendTelegramMessage(chatId, '✏️ <b>Was möchten Sie ändern?</b>', {
                reply_markup: { inline_keyboard: [
                    [{ text: '⏰ Zeit', callback_data: `change_time_${noBookingId}` }, { text: '📅 Datum', callback_data: `change_time_${noBookingId}` }],
                    [{ text: '📍 Abholort', callback_data: `change_pickup_${noBookingId}` }, { text: '🎯 Ziel', callback_data: `change_dest_${noBookingId}` }],
                    [{ text: '↩️ Zurück', callback_data: `back_to_confirm_${noBookingId}` }],
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ]}
            });
        } else {
            await deletePending(chatId);
            await sendTelegramMessage(chatId, '👍 OK, Buchung verworfen.');
        }
        return;
    }

    // 🆕 v6.11.3: Zurück zur Bestätigung
    if (data.startsWith('back_to_confirm_')) {
        const _backPending = await getPending(chatId);
        const _backBooking = _backPending && (_backPending.booking || _backPending.partial);
        if (_backBooking && _backPending.routePrice) {
            await showTelegramConfirmation(chatId, _backBooking, _backPending.routePrice);
        } else if (_backBooking) {
            const routePrice = await calculateTelegramRoutePrice(_backBooking);
            await showTelegramConfirmation(chatId, _backBooking, routePrice);
        } else {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden. Bitte starten Sie eine neue Anfrage.');
        }
        return;
    }

    // Änderungen
    if (data.startsWith('change_time_') || data.startsWith('change_pickup_') || data.startsWith('change_dest_')) {
        const pending = await getPending(chatId);
        const booking = pending && (pending.booking || pending.partial);
        if (!booking) { await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden.'); return; }
        if (data.startsWith('change_time_')) { booking.datetime = null; booking.missing = ['datetime']; }
        else if (data.startsWith('change_pickup_')) { booking.pickup = null; booking.pickupLat = null; booking.pickupLon = null; booking.missing = ['pickup']; }
        else { booking.destination = null; booking.destinationLat = null; booking.destinationLon = null; booking.missing = ['destination']; }
        await continueBookingFlow(chatId, booking, '');
        return;
    }

    // 🆕 v6.15.5: Personenzahl ändern (in Bestätigungs-Übersicht, vor der Buchung)
    if (data.startsWith('change_pax_')) {
        const pending = await getPending(chatId);
        const booking = pending && (pending.booking || pending.partial);
        if (!booking) { await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden.'); return; }
        const currentPax = booking.passengers || 1;
        const bookingId = pending.bookingId || data.replace('change_pax_', '');
        await sendTelegramMessage(chatId,
            `👥 <b>Personenzahl ändern</b>\n\nAktuell: <b>${currentPax} Person(en)</b>`,
            { reply_markup: { inline_keyboard: [
                [
                    { text: currentPax == 1 ? '1 ✓' : '1', callback_data: `setpax_${bookingId}_1` },
                    { text: currentPax == 2 ? '2 ✓' : '2', callback_data: `setpax_${bookingId}_2` },
                    { text: currentPax == 3 ? '3 ✓' : '3', callback_data: `setpax_${bookingId}_3` },
                    { text: currentPax == 4 ? '4 ✓' : '4', callback_data: `setpax_${bookingId}_4` }
                ],
                [
                    { text: currentPax == 5 ? '5 ✓' : '5', callback_data: `setpax_${bookingId}_5` },
                    { text: currentPax == 6 ? '6 ✓' : '6', callback_data: `setpax_${bookingId}_6` },
                    { text: currentPax == 7 ? '7 ✓' : '7', callback_data: `setpax_${bookingId}_7` },
                    { text: currentPax == 8 ? '8 ✓' : '8', callback_data: `setpax_${bookingId}_8` }
                ],
                [{ text: '↩️ Zurück', callback_data: `back_to_confirm_${bookingId}` }]
            ] } }
        );
        return;
    }

    // 🆕 v6.15.5: Personenzahl setzen (Bestätigungs-Flow)
    if (data.startsWith('setpax_')) {
        const match = data.match(/^setpax_(.+)_(\d+)$/);
        if (!match) return;
        const paxCount = parseInt(match[2]);
        const pending = await getPending(chatId);
        if (!pending || !pending.booking) {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden.');
            return;
        }
        pending.booking.passengers = paxCount;
        pending.booking._passengersExplicit = true;
        await addTelegramLog('👥', chatId, `Personenzahl geändert auf ${paxCount} (Bestätigung)`);
        // Zurück zur Bestätigungs-Übersicht
        const rp = pending.routePrice || null;
        await showTelegramConfirmation(chatId, pending.booking, rp);
        return;
    }

    // 🆕 v6.11.5: Gastname für laufende Buchung eintragen (vor dem Speichern)
    if (data.startsWith('book_guest_')) {
        const pending = await getPending(chatId);
        const booking = pending && (pending.booking || pending.partial);
        if (!booking) { await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr vorhanden.'); return; }
        await setPending(chatId, { ...pending, _awaitingBookingGuest: true });
        await sendTelegramMessage(chatId,
            `👤 <b>Gastname eintragen</b>\n\n` +
            (booking.name ? `👤 Auftraggeber: ${booking.name}\n` : '') +
            (booking.guestName ? `👤 Aktueller Gast: <b>${booking.guestName}</b>\n` : '') +
            `\nWie heißt der Fahrgast?`,
            { reply_markup: { inline_keyboard: [
                [{ text: '↩️ Zurück', callback_data: `back_to_confirm_${pending.bookingId}` }]
            ] } }
        );
        return;
    }

    if (data.startsWith('discard_')) {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '👍 OK, Buchung verworfen.');
        return;
    }

    // 🆕 v6.25.4: main_menu Alias für back_to_menu (wird aus Hilfe/Profil referenziert)
    if (data === 'main_menu') {
        await deletePending(chatId);
        const knownForMain = await getTelegramCustomer(chatId);
        let greetMain = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        if (knownForMain) greetMain += `👋 Hallo <b>${knownForMain.name}</b>!\n\n`;
        greetMain += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>';
        const kbMain = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '✏️ Fahrt ändern', callback_data: 'menu_aendern' }],
            [{ text: '📋 Vergangene Fahrten', callback_data: 'menu_history' }, { text: '🗑️ Stornieren', callback_data: 'menu_loeschen' }],
            [{ text: '👤 Profil', callback_data: 'menu_profil' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        if (await isTelegramAdmin(chatId)) {
            kbMain.inline_keyboard.splice(3, 0, [{ text: '📅 Fahrten heute', callback_data: 'adm_rides_today' }, { text: '📅 Morgen', callback_data: 'adm_rides_tomorrow' }]);
            kbMain.inline_keyboard.splice(4, 0, [{ text: '📋 Kundendaten bearbeiten', callback_data: 'menu_crm_edit' }]);
            kbMain.inline_keyboard.splice(5, 0, [{ text: '🧠 KI-Training', callback_data: 'menu_ai_rules' }, { text: '🔔 Benachrichtigungen', callback_data: 'menu_notify_prefs' }]);
        }
        await sendTelegramMessage(chatId, greetMain, { reply_markup: kbMain });
        return;
    }

    // 🆕 v6.12.0: Zurück zum Hauptmenü
    if (data === 'back_to_menu') {
        await deletePending(chatId);
        const knownCustomer = await getTelegramCustomer(chatId);
        let greeting = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        if (knownCustomer) greeting += `👋 Hallo <b>${knownCustomer.name}</b>!\n\n`;
        greeting += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>';
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '✏️ Fahrt ändern', callback_data: 'menu_aendern' }],
            [{ text: '📋 Vergangene Fahrten', callback_data: 'menu_history' }, { text: '🗑️ Stornieren', callback_data: 'menu_loeschen' }],
            [{ text: '👤 Profil', callback_data: 'menu_profil' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        // 🆕 v6.25.4: Admin bekommt Fahrten-Buttons + CRM + KI-Training
        if (await isTelegramAdmin(chatId)) {
            keyboard.inline_keyboard.splice(3, 0, [{ text: '📅 Fahrten heute', callback_data: 'adm_rides_today' }, { text: '📅 Morgen', callback_data: 'adm_rides_tomorrow' }]);
            keyboard.inline_keyboard.splice(4, 0, [{ text: '📋 Kundendaten bearbeiten', callback_data: 'menu_crm_edit' }]);
            keyboard.inline_keyboard.splice(5, 0, [{ text: '🧠 KI-Training', callback_data: 'menu_ai_rules' }, { text: '🔔 Benachrichtigungen', callback_data: 'menu_notify_prefs' }]);
        }
        await sendTelegramMessage(chatId, greeting, { reply_markup: keyboard });
        return;
    }

    // 🆕 v6.25.4: Zurück vom DateTime-Picker → Adressen nochmal ändern
    if (data === 'dtpicker_back') {
        const pending = await getPending(chatId);
        if (!pending) return;
        const booking = pending.partial || pending.booking;
        if (!booking) return;
        // Zielort löschen → wird erneut abgefragt
        if (booking.destination) {
            booking.destination = null;
            booking.destinationLat = null;
            booking.destinationLon = null;
            if (!booking.missing) booking.missing = [];
            if (!booking.missing.includes('destination')) booking.missing.push('destination');
        } else if (booking.pickup) {
            // Kein Zielort vorhanden → Abholort löschen
            booking.pickup = null;
            booking.pickupLat = null;
            booking.pickupLon = null;
            if (!booking.missing) booking.missing = [];
            if (!booking.missing.includes('pickup')) booking.missing.push('pickup');
        }
        delete pending._dtPicker;
        await addTelegramLog('◀️', chatId, 'Zurück von DateTime-Picker → Adresse ändern');
        await continueBookingFlow(chatId, booking, pending.originalText || '');
        return;
    }

    // 🆕 v6.25.4: Zurück zu Abholort-Eingabe (von Zielort-Schritt)
    if (data === 'addr_back_to_pickup') {
        const pending = await getPending(chatId);
        if (!pending) return;
        const booking = pending.partial || pending.booking;
        if (!booking) return;
        booking.pickup = null;
        booking.pickupLat = null;
        booking.pickupLon = null;
        if (!booking.missing) booking.missing = [];
        if (!booking.missing.includes('pickup')) booking.missing.push('pickup');
        // Zielort auch löschen damit er danach erneut abgefragt wird
        booking.destination = null;
        booking.destinationLat = null;
        booking.destinationLon = null;
        if (!booking.missing.includes('destination')) booking.missing.push('destination');
        delete pending.nominatimResults;
        await addTelegramLog('◀️', chatId, 'Zurück → Abholort nochmal eingeben');
        await continueBookingFlow(chatId, booking, pending.originalText || '');
        return;
    }

    // 🆕 v6.25.4: Zurück zu Zielort-Eingabe (von Abholort-Schritt)
    if (data === 'addr_back_to_dest') {
        const pending = await getPending(chatId);
        if (!pending) return;
        const booking = pending.partial || pending.booking;
        if (!booking) return;
        booking.destination = null;
        booking.destinationLat = null;
        booking.destinationLon = null;
        if (!booking.missing) booking.missing = [];
        if (!booking.missing.includes('destination')) booking.missing.push('destination');
        delete pending.nominatimResults;
        await addTelegramLog('◀️', chatId, 'Zurück → Zielort nochmal eingeben');
        await continueBookingFlow(chatId, booking, pending.originalText || '');
        return;
    }

    // 🆕 v6.25.4: Zurück-Button bei Gastname → zurück zur Uhrzeit-Auswahl
    if (data === 'guest_back') {
        const pending = await getPending(chatId);
        if (!pending) return;
        const booking = pending.booking || pending.partial;
        if (!booking) return;
        delete booking.datetime;
        if (!booking.missing) booking.missing = [];
        if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
        delete pending._awaitingBookingGuest;
        await addTelegramLog('◀️', chatId, 'Zurück von Gastname → Uhrzeit-Auswahl');
        await setPending(chatId, { partial: booking, originalText: pending.originalText || '', _dtPicker: true });
        await showDateTimePicker(chatId, booking, pending.originalText || '');
        return;
    }

    // 🆕 v6.25.4: Zurück-Button bei Personenzahl → zurück zur Uhrzeit-Auswahl
    if (data === 'pax_back') {
        const pending = await getPending(chatId);
        if (!pending) return;
        const booking = pending.booking || pending.partial;
        if (!booking) return;
        // Datum/Uhrzeit zurücksetzen → Datetime-Picker erneut anzeigen
        delete booking.datetime;
        if (!booking.missing) booking.missing = [];
        if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
        await addTelegramLog('◀️', chatId, 'Zurück von Personenzahl → Uhrzeit-Auswahl');
        await setPending(chatId, { partial: booking, originalText: pending.originalText || '', _dtPicker: true });
        await showDateTimePicker(chatId, booking, pending.originalText || '');
        return;
    }

    // 🆕 v6.11.3: Abbrechen-Button (überall in der Konversation)
    if (data === 'cancel_booking') {
        await deletePending(chatId);
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '📋 Vergangene', callback_data: 'menu_history' }],
            [{ text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        await sendTelegramMessage(chatId, '🔄 Buchung abgebrochen.\n\n💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>', { reply_markup: keyboard });
        return;
    }

    // 🔧 v6.20.2: "Heute" gewählt → Uhrzeiten + "Jetzt/Sofort" anzeigen
    if (data === 'dtchoice_heute') {
        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;

        const berlinNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
        const todayISO = berlinNow.toISOString().slice(0, 10);
        const nowH = berlinNow.getHours();
        const nowM = berlinNow.getMinutes();
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        const dd = String(berlinNow.getDate()).padStart(2, '0');
        const mm = String(berlinNow.getMonth() + 1).padStart(2, '0');
        const dayLabel = `Heute (${dayNames[berlinNow.getDay()]}, ${dd}.${mm}.)`;

        pending._selectedDate = todayISO;
        pending._selectedDateLabel = dayLabel;
        await setPending(chatId, pending);

        // Zeitslots: nur volle Stunden, Zwischenzeiten per Freitext-Eingabe
        const allSlots = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
        const availableSlots = allSlots.filter(s => {
            const [h, m] = s.split(':').map(Number);
            return h > nowH || (h === nowH && m > nowM);
        });
        const timeRows = [];
        for (let i = 0; i < availableSlots.length; i += 4) {
            timeRows.push(availableSlots.slice(i, i + 4).map(t => ({
                text: `🕐 ${t}`, callback_data: `dttime_${todayISO}_${t.replace(':', '')}`
            })));
        }

        const noted = [];
        if (pending.partial.pickup) noted.push(`📍 Von: ${pending.partial.pickup}`);
        if (pending.partial.destination) noted.push(`🎯 Nach: ${pending.partial.destination}`);
        let header = '';
        if (noted.length > 0) header = `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;

        await addTelegramLog('📅', chatId, `Heute gewählt → Uhrzeiten anzeigen`);
        await sendTelegramMessage(chatId,
            header + `📅 <b>${dayLabel}</b>\n\n🕐 <b>Uhrzeit wählen:</b>\nButton antippen oder Uhrzeit eintippen, z.B. <b>14:30</b>`, {
            reply_markup: { inline_keyboard: [
                ...timeRows,
                [{ text: '◀️ Zurück', callback_data: 'dtback_choice' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ]}
        });
        return;
    }

    // 🔧 v6.20.2: "Vorbestellen" gewählt → Tage ab morgen anzeigen
    if (data === 'dtchoice_vorbestellen') {
        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;

        const dayNamesShort = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        const days = [];
        for (let i = 1; i <= 7; i++) { // Ab morgen (i=1)
            const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
            d.setDate(d.getDate() + i);
            const iso = d.toISOString().slice(0, 10);
            const dd = String(d.getDate()).padStart(2, '0');
            const mmm = String(d.getMonth() + 1).padStart(2, '0');
            let label;
            if (i === 1) label = '📅 Morgen';
            else label = `${dayNamesShort[d.getDay()]} ${dd}.${mmm}.`;
            days.push({ text: label, callback_data: `dtday_${iso}` });
        }

        const dayRows = [];
        dayRows.push([days[0]]); // Morgen allein
        for (let i = 1; i < days.length; i += 3) {
            dayRows.push(days.slice(i, Math.min(i + 3, days.length)));
        }

        const noted = [];
        if (pending.partial.pickup) noted.push(`📍 Von: ${pending.partial.pickup}`);
        if (pending.partial.destination) noted.push(`🎯 Nach: ${pending.partial.destination}`);
        let header = '';
        if (noted.length > 0) header = `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;

        await addTelegramLog('📅', chatId, `Vorbestellen gewählt → Tage anzeigen`);
        await sendTelegramMessage(chatId,
            header + '📅 <b>Für welchen Tag vorbestellen?</b>\n\nButton antippen oder <b>Datum + Uhrzeit</b> unten ins Eingabefeld tippen:\nz.B. <b>21.06.2026 14:30</b> oder <b>15. Juni 2026 10 Uhr</b>', {
            reply_markup: { inline_keyboard: [
                ...dayRows,
                [{ text: '◀️ Zurück', callback_data: 'dtback_choice' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ]}
        });
        return;
    }

    // 🔧 v6.20.2: Zurück zur Heute/Vorbestellen-Auswahl
    if (data === 'dtback_choice') {
        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;
        delete pending._selectedDate;
        delete pending._selectedDateLabel;
        await setPending(chatId, pending);
        await showDateTimePicker(chatId, pending.partial, pending.originalText || '');
        return;
    }

    // 🆕 v6.20.1: Inline-Datum-Picker — Tag gewählt → Uhrzeit-Buttons zeigen
    if (data.startsWith('dtday_')) {
        const selectedDate = data.replace('dtday_', ''); // z.B. "2026-03-15"
        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;

        // Tag-Label erstellen
        const selDate = new Date(selectedDate + 'T12:00:00');
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        const dd = String(selDate.getDate()).padStart(2, '0');
        const mm = String(selDate.getMonth() + 1).padStart(2, '0');
        const todayISO = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' })).toISOString().slice(0, 10);
        let dayLabel;
        if (selectedDate === todayISO) dayLabel = `Heute (${dayNames[selDate.getDay()]}, ${dd}.${mm}.)`;
        else {
            const tmrw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
            tmrw.setDate(tmrw.getDate() + 1);
            if (selectedDate === tmrw.toISOString().slice(0, 10)) dayLabel = `Morgen (${dayNames[selDate.getDay()]}, ${dd}.${mm}.)`;
            else dayLabel = `${dayNames[selDate.getDay()]}, ${dd}.${mm}.`;
        }

        // Gewählten Tag im Pending speichern
        pending._selectedDate = selectedDate;
        pending._selectedDateLabel = dayLabel;
        await setPending(chatId, pending);

        // Uhrzeit-Buttons: Häufige Zeiten + Freitext-Hinweis
        const berlinNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
        const nowH = berlinNow.getHours();
        const nowM = berlinNow.getMinutes();
        const isToday = selectedDate === todayISO;

        // Zeitslots: nur volle Stunden, Zwischenzeiten per Freitext-Eingabe
        const allSlots = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
        const availableSlots = allSlots.filter(s => {
            if (!isToday) return true;
            const [h, m] = s.split(':').map(Number);
            return h > nowH || (h === nowH && m > nowM);
        });

        // In 4er-Reihen aufteilen
        const timeRows = [];
        for (let i = 0; i < availableSlots.length; i += 4) {
            timeRows.push(availableSlots.slice(i, i + 4).map(t => ({
                text: `🕐 ${t}`, callback_data: `dttime_${selectedDate}_${t.replace(':', '')}`
            })));
        }

        await addTelegramLog('📅', chatId, `Tag gewählt: ${dayLabel}`);
        await sendTelegramMessage(chatId,
            `📅 <b>${dayLabel}</b>\n\n🕐 <b>Uhrzeit wählen:</b>\nButton antippen oder Uhrzeit eintippen, z.B. <b>14:30</b>`, {
            reply_markup: { inline_keyboard: [
                ...timeRows,
                [{ text: '◀️ Anderen Tag', callback_data: 'dtback_day' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ]}
        });
        return;
    }

    // 🔧 v6.25.4: Stunde gewählt → Minuten-Auswahl anzeigen (statt direkt zu buchen)
    if (data.startsWith('dttime_')) {
        const parts = data.replace('dttime_', '').split('_'); // z.B. "2026-03-15_1400"
        const selectedDate = parts[0];
        const timeStr = parts[1]; // "1400"
        const hh = timeStr.slice(0, 2);

        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;

        const dayLabel = pending._selectedDateLabel || selectedDate;
        await addTelegramLog('🕐', chatId, `Stunde gewählt: ${hh}:xx → Minuten-Auswahl`);

        // Minuten-Buttons: 10-Minuten-Schritte (:00, :10, :20, :30, :40, :50)
        await sendTelegramMessage(chatId,
            `🕐 <b>${hh}:__ Uhr</b> — Minuten wählen:`, {
            reply_markup: { inline_keyboard: [
                [
                    { text: `${hh}:00`, callback_data: `dtmin_${selectedDate}_${hh}00` },
                    { text: `${hh}:10`, callback_data: `dtmin_${selectedDate}_${hh}10` },
                    { text: `${hh}:20`, callback_data: `dtmin_${selectedDate}_${hh}20` }
                ],
                [
                    { text: `${hh}:30`, callback_data: `dtmin_${selectedDate}_${hh}30` },
                    { text: `${hh}:40`, callback_data: `dtmin_${selectedDate}_${hh}40` },
                    { text: `${hh}:50`, callback_data: `dtmin_${selectedDate}_${hh}50` }
                ],
                [{ text: '◀️ Zurück', callback_data: `dtback_minutes_${selectedDate}` }]
            ]}
        });
        return;
    }

    // 🔧 v6.25.4: Minuten gewählt → Buchung fortsetzen
    if (data.startsWith('dtmin_')) {
        const parts = data.replace('dtmin_', '').split('_'); // z.B. "2026-03-15_1430"
        const selectedDate = parts[0];
        const timeStr = parts[1]; // "1430"
        const hh = timeStr.slice(0, 2);
        const mi = timeStr.slice(2, 4);
        const datetime = `${selectedDate}T${hh}:${mi}`;

        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;

        pending.partial.datetime = datetime;
        if (pending.partial.missing) pending.partial.missing = pending.partial.missing.filter(m => m !== 'datetime');
        delete pending._dtPicker;
        delete pending._selectedDate;
        delete pending._selectedDateLabel;
        delete pending.lastQuestion;
        await setPending(chatId, pending);

        const dayLabel = pending._selectedDateLabel || selectedDate;
        await addTelegramLog('🕐', chatId, `Uhrzeit gewählt: ${hh}:${mi} am ${dayLabel}`);
        await sendTelegramMessage(chatId, `✅ <b>${dayLabel} um ${hh}:${mi} Uhr</b>`);

        // Buchung fortsetzen
        await continueBookingFlow(chatId, pending.partial, pending.originalText || '');
        return;
    }

    // 🔧 v6.25.4: Zurück von Minuten-Auswahl → Stunden-Buttons erneut anzeigen
    if (data.startsWith('dtback_minutes_')) {
        const selectedDate = data.replace('dtback_minutes_', '');
        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;

        // Stunden-Buttons erneut anzeigen (wie dtchoice_heute / dtday_)
        const berlinNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
        const todayISO = berlinNow.toISOString().slice(0, 10);
        const nowH = berlinNow.getHours();
        const nowM = berlinNow.getMinutes();
        const isToday = selectedDate === todayISO;

        const allSlots = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
        const availableSlots = allSlots.filter(s => {
            if (!isToday) return true;
            const [h, m] = s.split(':').map(Number);
            return h > nowH || (h === nowH && m > nowM);
        });
        const timeRows = [];
        for (let i = 0; i < availableSlots.length; i += 4) {
            timeRows.push(availableSlots.slice(i, i + 4).map(t => ({
                text: `🕐 ${t}`, callback_data: `dttime_${selectedDate}_${t.replace(':', '')}`
            })));
        }

        const dayLabel = pending._selectedDateLabel || selectedDate;
        await addTelegramLog('◀️', chatId, `Zurück von Minuten → Stunden-Auswahl`);
        await sendTelegramMessage(chatId,
            `📅 <b>${dayLabel}</b>\n\n🕐 <b>Uhrzeit wählen:</b>\nButton antippen oder Uhrzeit eintippen, z.B. <b>14:30</b>`, {
            reply_markup: { inline_keyboard: [
                ...timeRows,
                [{ text: '◀️ Zurück', callback_data: isToday ? 'dtback_choice' : 'dtback_day' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ]}
        });
        return;
    }

    // 🆕 v6.20.1: Zurück zur Tag-Auswahl
    if (data === 'dtback_day') {
        const pending = await getPending(chatId);
        if (!pending || !pending.partial) return;
        delete pending._selectedDate;
        delete pending._selectedDateLabel;
        await setPending(chatId, pending);
        await showDateTimePicker(chatId, pending.partial, pending.originalText || '');
        return;
    }

    // 🔧 v6.15.11: "Jetzt/Sofort" Button für Datum/Zeit → continueBookingFlow
    if (data === 'datetime_now') {
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            pending.partial.datetime = 'jetzt';
            // 'datetime' aus missing entfernen
            if (pending.partial.missing) {
                pending.partial.missing = pending.partial.missing.filter(m => m !== 'datetime');
            }
            delete pending.lastQuestion;
            delete pending._dtPicker;
            await setPending(chatId, pending);
            await addTelegramLog('🕐', chatId, 'Sofort-Button gedrückt → "jetzt"');
            // Buchungsfluss fortsetzen (nächstes fehlendes Feld abfragen)
            await continueBookingFlow(chatId, pending.partial, pending.originalText || '');
        } else {
            await addTelegramLog('⚠️', chatId, 'datetime_now: Kein Pending/Partial gefunden');
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden. Bitte nochmal starten.');
        }
        return;
    }

    // 🆕 v6.11.3: Kundenadresse als Abholort übernehmen
    if (data === 'use_home_pickup' || data === 'use_default_pickup') {
        const _homePending = await getPending(chatId);
        const _homeBooking = _homePending && _homePending.partial;
        if (_homeBooking) {
            const _homeCust = await getTelegramCustomer(chatId);
            let _homeAddr = '';
            if (data === 'use_home_pickup' && _homeCust?.address) {
                _homeAddr = _homeCust.address;
            } else if (data === 'use_default_pickup' && _homeCust?.customerId) {
                const _dpSnap = await db.ref('customers/' + _homeCust.customerId + '/defaultPickup').once('value');
                _homeAddr = _dpSnap.val() || '';
            }
            if (_homeAddr) {
                _homeBooking.pickup = _homeAddr;
                // 🔧 v6.25.3: Koordinaten aus CRM laden → kein erneutes Geocoding nötig!
                if (_homeCust?.lat && _homeCust?.lon) {
                    _homeBooking.pickupLat = _homeCust.lat;
                    _homeBooking.pickupLon = _homeCust.lon;
                    console.log('📍 Von-zu-Hause: Koordinaten aus CRM:', _homeCust.lat, _homeCust.lon);
                } else if (_homeCust?.customerId) {
                    // Fallback: Koordinaten direkt aus CRM laden
                    try {
                        const _custSnap = await db.ref('customers/' + _homeCust.customerId).once('value');
                        const _custData = _custSnap.val();
                        if (_custData) {
                            const _lat = _custData.lat || _custData.pickupLat;
                            const _lon = _custData.lon || _custData.pickupLon;
                            if (_lat && _lon) {
                                _homeBooking.pickupLat = _lat;
                                _homeBooking.pickupLon = _lon;
                                console.log('📍 Von-zu-Hause: Koordinaten aus CRM geladen:', _lat, _lon);
                            }
                        }
                    } catch(e) { console.warn('CRM-Koordinaten Fehler:', e.message); }
                }
                if (_homeBooking.missing) _homeBooking.missing = _homeBooking.missing.filter(m => m !== 'pickup');
                await sendTelegramMessage(chatId, '✅ Abholort gesetzt: <b>' + _homeAddr + '</b>');
                await continueBookingFlow(chatId, _homeBooking, _homePending.originalText || '');
            } else {
                await sendTelegramMessage(chatId, '⚠️ Adresse nicht gefunden. Bitte tippen Sie den Abholort ein.');
            }
        }
        return;
    }

    // 🆕 v6.14.0: "Nach Hause" als Zielort
    if (data === 'use_home_dest') {
        const _destPending = await getPending(chatId);
        const _destBooking = _destPending && _destPending.partial;
        if (_destBooking) {
            const _destCust = await getTelegramCustomer(chatId);
            if (_destCust && _destCust.address) {
                _destBooking.destination = _destCust.address;
                // 🔧 v6.25.3: Koordinaten aus CRM laden → kein erneutes Geocoding nötig!
                if (_destCust.lat && _destCust.lon) {
                    _destBooking.destinationLat = _destCust.lat;
                    _destBooking.destinationLon = _destCust.lon;
                } else if (_destCust.customerId) {
                    try {
                        const _dSnap = await db.ref('customers/' + _destCust.customerId).once('value');
                        const _dData = _dSnap.val();
                        if (_dData) {
                            const _lat = _dData.lat || _dData.pickupLat;
                            const _lon = _dData.lon || _dData.pickupLon;
                            if (_lat && _lon) {
                                _destBooking.destinationLat = _lat;
                                _destBooking.destinationLon = _lon;
                            }
                        }
                    } catch(e) {}
                }
                if (_destBooking.missing) _destBooking.missing = _destBooking.missing.filter(m => m !== 'destination');
                await sendTelegramMessage(chatId, '✅ Zielort gesetzt: <b>' + _destCust.address + '</b>');
                await continueBookingFlow(chatId, _destBooking, _destPending.originalText || '');
            } else {
                await sendTelegramMessage(chatId, '⚠️ Adresse nicht gefunden. Bitte tippen Sie das Ziel ein.');
            }
        }
        return;
    }

    // 🆕 v6.14.0: "Anderer Ort" → Standort oder Adresse eingeben
    if (data === 'pickup_other_location' || data === 'dest_other_location') {
        const _locPending = await getPending(chatId);
        if (_locPending && _locPending.partial) {
            const isPickup = data === 'pickup_other_location';
            const label = isPickup ? 'Abholort' : 'Zielort';
            await sendTelegramMessage(chatId,
                `📍 <b>${label} eingeben</b>\n\n` +
                `Sie haben 2 Möglichkeiten:\n\n` +
                `1️⃣ <b>Standort senden:</b> Tippen Sie auf 📎 und dann auf „Standort"\n\n` +
                `2️⃣ <b>Adresse eintippen:</b> Schreiben Sie einfach die Adresse als Nachricht`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '🏠 Menü', callback_data: 'back_to_menu' }, { text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ] } }
            );
        }
        return;
    }

    // 🔧 v6.15.8: GPS-Standort als Abholort oder Zielort setzen (Auswahl)
    if (data === 'gps_set_pickup' || data === 'gps_set_dest') {
        const _gpsPending = await getPending(chatId);
        if (!_gpsPending || !_gpsPending._gpsChoice) {
            await sendTelegramMessage(chatId, '⚠️ Standort nicht mehr verfügbar. Bitte nochmal senden.');
            return;
        }
        const { addressName: gpsAddr, lat: gpsLat, lon: gpsLon } = _gpsPending._gpsChoice;
        const booking = _gpsPending.partial || _gpsPending.booking || { missing: ['pickup', 'destination', 'datetime'], intent: 'buchung' };
        const isPickup = data === 'gps_set_pickup';

        if (isPickup) {
            booking.pickup = gpsAddr;
            booking.pickupLat = gpsLat;
            booking.pickupLon = gpsLon;
            if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'pickup');
            await addTelegramLog('📍', chatId, `GPS als Abholort: ${gpsAddr}`);
            await sendTelegramMessage(chatId, `✅ <b>Abholort gesetzt:</b> ${gpsAddr}`);
        } else {
            booking.destination = gpsAddr;
            booking.destinationLat = gpsLat;
            booking.destinationLon = gpsLon;
            if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'destination');
            await addTelegramLog('📍', chatId, `GPS als Zielort: ${gpsAddr}`);
            await sendTelegramMessage(chatId, `✅ <b>Zielort gesetzt:</b> ${gpsAddr}`);
        }

        // _gpsChoice entfernen und Buchungsfluss fortsetzen
        delete _gpsPending._gpsChoice;
        if (_gpsPending.partial) _gpsPending.partial = booking;
        else _gpsPending.booking = booking;
        await setPending(chatId, _gpsPending);
        await continueBookingFlow(chatId, booking, _gpsPending.originalText || '');
        return;
    }

    // 🆕 v6.14.0: Vergangene Fahrt nochmal buchen (Kopieren)
    if (data.startsWith('rebook_ride_')) {
        const rideId = data.replace('rebook_ride_', '');
        const _rebookSnap = await db.ref('rides/' + rideId).once('value');
        const _rebookRide = _rebookSnap.val();
        if (!_rebookRide) {
            await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.');
            return;
        }
        // Erstelle Buchungs-Objekt aus vergangener Fahrt
        const _rebookData = {
            intent: 'buchung',
            pickup: _rebookRide.pickup || null,
            destination: _rebookRide.destination || null,
            pickupLat: _rebookRide.pickupCoords ? _rebookRide.pickupCoords.lat : null,
            pickupLon: _rebookRide.pickupCoords ? _rebookRide.pickupCoords.lon : null,
            destinationLat: _rebookRide.destCoords ? _rebookRide.destCoords.lat : null,
            destinationLon: _rebookRide.destCoords ? _rebookRide.destCoords.lon : null,
            passengers: _rebookRide.passengers || 1,
            datetime: null,
            name: _rebookRide.customerName || '',
            // 🔧 v6.14.7: Auch customerMobile als Fallback
            phone: _rebookRide.customerPhone || _rebookRide.customerMobile || '',
            notes: _rebookRide.notes || '',
            missing: ['datetime'], // Nur Datum fehlt noch
            summary: 'Nochmal buchen von vergangener Fahrt'
        };
        // 🔧 v6.14.2: Admin-Flags + CRM-Daten aus Originalfahrt übernehmen
        if (_rebookRide.source === 'telegram-admin' || _rebookRide.adminBookedBy) {
            _rebookData._adminBooked = true;
            _rebookData._adminChatId = chatId;
            _rebookData._forCustomer = _rebookRide.bookedForCustomer || _rebookRide.customerName || '';
            if (_rebookRide.customerId) {
                _rebookData._crmCustomerId = _rebookRide.customerId;
                // Telefon aus CRM nachladen wenn in Fahrt fehlend
                if (!_rebookData.phone) {
                    try {
                        const _cSnap = await db.ref('customers/' + _rebookRide.customerId).once('value');
                        const _cData = _cSnap.val();
                        if (_cData) {
                            _rebookData.phone = _cData.phone || '';
                            _rebookData._customerAddress = _cData.address || '';
                        }
                    } catch (_e) { /* ignore */ }
                }
            }
        }
        // Kundeninfo setzen
        const _rebookCust = await getTelegramCustomer(chatId);
        if (_rebookCust) {
            _rebookData.name = _rebookCust.name || _rebookData.name;
            _rebookData.phone = _rebookCust.phone || _rebookData.phone;
        }
        await sendTelegramMessage(chatId,
            '📋 <b>Fahrt nochmal buchen:</b>\n\n' +
            `📍 Von: <b>${_rebookData.pickup || '?'}</b>\n` +
            `🎯 Nach: <b>${_rebookData.destination || '?'}</b>\n` +
            `👥 ${_rebookData.passengers} Person(en)\n\n` +
            '💬 <b>Für wann soll ich das Taxi bestellen?</b>\n<i>Bitte mit Datum und Uhrzeit.</i>'
        );
        await setPending(chatId, { partial: _rebookData, originalText: 'Nochmal buchen' });
        await addTelegramLog('📋', chatId, `Rebook: ${_rebookData.pickup} → ${_rebookData.destination}`);
        return;
    }

    // 🆕 v6.14.0: Vergangene Fahrten anzeigen
    if (data === 'menu_history') {
        const knownForHistory = await getTelegramCustomer(chatId);
        if (knownForHistory) {
            await handleTelegramHistoryQuery(chatId, knownForHistory);
        } else {
            await sendTelegramMessage(chatId, '📋 <b>Vergangene Fahrten</b>\n\nBitte teilen Sie Ihre Telefonnummer!', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
        }
        return;
    }

    // 🆕 v6.11.3: Favoriten-Ziel als Quick-Button
    // Personenzahl
    if (data.startsWith('pax_')) {
        const match = data.match(/^pax_(\d+)_(.+)$/);
        if (!match) {
            await addTelegramLog('⚠️', chatId, `pax_ Regex fehlgeschlagen für: ${data}`);
            return;
        }
        const paxCount = parseInt(match[1]);
        await addTelegramLog('🔍', chatId, `pax_ Handler: count=${paxCount}, lade Pending...`);
        const pending = await getPending(chatId);
        await addTelegramLog('🔍', chatId, `pax_ Pending: exists=${!!pending}, hasBooking=${!!(pending && pending.booking)}, keys=${pending ? Object.keys(pending).join(',') : 'null'}`);
        if (!pending || !pending.booking) {
            await addTelegramLog('⚠️', chatId, `Personenzahl-Button: Buchungsdaten nicht gefunden (pending=${!!pending})`);
            await sendTelegramMessage(chatId, '⚠️ Sitzung abgelaufen. Bitte schreiben Sie Ihren Buchungswunsch noch einmal.');
            return;
        }
        pending.booking.passengers = paxCount;
        pending.booking._passengersExplicit = true;
        await addTelegramLog('👥', chatId, `${paxCount} Person(en) gewählt → zeige Bestätigung`);
        try {
            let rp = pending.routePrice || null;
            if (!rp && pending.booking.pickupLat && pending.booking.destinationLat) {
                rp = await calculateTelegramRoutePrice(pending.booking);
            }
            await showTelegramConfirmation(chatId, pending.booking, rp);
            await addTelegramLog('✅', chatId, 'Bestätigung gesendet');
        } catch (confirmErr) {
            await addTelegramLog('❌', chatId, `Bestätigung Fehler: ${confirmErr.message}`);
            await sendTelegramMessage(chatId, '⚠️ Fehler bei der Bestätigung: ' + confirmErr.message);
        }
        return;
    }

    // Beliebtes Ziel ausgewählt
    if (data.startsWith('fav_dest_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.awaitingFavDestination) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden. Bitte nochmal starten.');
            return;
        }

        const { preselectedCustomer, originalText, userName, favorites } = pending;

        if (data.startsWith('fav_dest_other_')) {
            // "Anderes Ziel" → Freitext-Eingabe für neue Buchung
            await setPending(chatId, {
                _awaitingNewBookingText: true,
                preselectedCustomer,
                userName
            });
            await sendTelegramMessage(chatId, `📝 <b>Neue Buchung für ${preselectedCustomer.name}</b>\n\nBitte schreibe den Fahrtwunsch (z.B. <i>Morgen 10 Uhr vom Bahnhof nach Ahlbeck</i>):`);
            return;
        }

        const favMatch = data.match(/^fav_dest_(\d+)_(.+)$/);
        if (!favMatch || !favorites) return;
        const favIndex = parseInt(favMatch[1]);
        const fav = favorites[favIndex];
        if (!fav) { await sendTelegramMessage(chatId, '⚠️ Ungültige Auswahl.'); return; }

        await addTelegramLog('⭐', chatId, `Beliebtes Ziel gewählt: ${fav.destination} (${fav.count}x gebucht)`);

        // Buchungstext mit dem gewählten Ziel + ggf. Abholadresse zusammenbauen
        const pickup = preselectedCustomer.address || fav.lastPickup || null;
        let enrichedText = originalText || '';
        if (pickup) enrichedText += ` von ${pickup}`;
        enrichedText += ` nach ${fav.destination}`;

        // 🆕 Koordinaten aus Favoriten übernehmen → überspringt Adress-Bestätigung
        // Falls Koordinaten fehlen (alte Fahrten), per Geocoding nachladen
        const prefilledCoords = {};
        // 🔧 v6.25.4: PLZ-Distanz-Check für Favoriten-Koordinaten — bei Mismatch neu geocodieren
        const _validateFavCoords = (addr, lat, lon) => {
            if (!addr || !lat || !lon) return false;
            const plzM = addr.match(/\b(1742[0-9]|1741[0-9]|1743[0-9]|1744[0-9]|1745[0-9])\b/);
            if (!plzM) return true; // Ohne PLZ kein Check möglich
            const center = PLZ_CENTERS[plzM[1]];
            if (!center) return true;
            const dist = distanceKm(parseFloat(lat), parseFloat(lon), center.lat, center.lon);
            if (dist > PLZ_MAX_RADIUS_KM) {
                console.log(`[PLZ-Filter] Favoriten-Koordinaten ${lat},${lon} sind ${dist.toFixed(1)}km von PLZ ${plzM[1]} entfernt → neu geocodieren`);
                return false;
            }
            return true;
        };
        if (fav.destinationLat && fav.destinationLon && _validateFavCoords(fav.destination, fav.destinationLat, fav.destinationLon)) {
            prefilledCoords.destinationLat = fav.destinationLat;
            prefilledCoords.destinationLon = fav.destinationLon;
        } else if (fav.destination) {
            const destGeo = await geocode(fav.destination);
            if (destGeo) {
                prefilledCoords.destinationLat = destGeo.lat;
                prefilledCoords.destinationLon = destGeo.lon;
            }
        }
        if (pickup && fav.pickupLat && fav.pickupLon && _validateFavCoords(pickup, fav.pickupLat, fav.pickupLon)) {
            prefilledCoords.pickupLat = fav.pickupLat;
            prefilledCoords.pickupLon = fav.pickupLon;
        } else if (pickup) {
            const pickGeo = await geocode(pickup);
            if (pickGeo) {
                prefilledCoords.pickupLat = pickGeo.lat;
                prefilledCoords.pickupLon = pickGeo.lon;
            }
        }

        await deletePending(chatId);
        await sendTelegramMessage(chatId, `⭐ <b>${fav.destination}</b>\n🤖 <i>Analysiere Buchung...</i>`);
        await analyzeTelegramBooking(chatId, enrichedText, userName, { isAdmin: true, preselectedCustomer, prefilledCoords });
        return;
    }

    // 🔧 v6.11.0: Rückfahrt buchen (Von ↔ Nach tauschen)
    if (data.startsWith('return_')) {
        const origRideId = data.replace('return_', '');
        try {
            const rideSnap = await db.ref(`rides/${origRideId}`).once('value');
            const origRide = rideSnap.val();
            if (!origRide) {
                await sendTelegramMessage(chatId, '⚠️ Originalfahrt nicht gefunden.');
                return;
            }
            // Rückfahrt-Text zusammenbauen: Von und Nach getauscht
            const returnText = `${origRide.destination} nach ${origRide.pickup}`;
            // 🔧 v6.15.5: Datum + Personenzahl aus Hinfahrt anzeigen
            let _returnDateHint = '';
            if (_returnOrigDate) {
                const [_ry, _rm, _rd] = _returnOrigDate.split('-');
                _returnDateHint = `\n📅 Hinfahrt am ${_rd}.${_rm}.${_ry}`;
            }
            await sendTelegramMessage(chatId, `🔄 <b>Rückfahrt:</b> ${origRide.destination} → ${origRide.pickup}${_returnDateHint}\n👥 ${origPassengers} Person${origPassengers > 1 ? 'en' : ''}\n\n🤖 <i>Wann soll die Rückfahrt sein?</i>\n\n💡 Schreibe einfach die Uhrzeit (z.B. "18:00")`);
            // Pending mit vorausgefüllten Adressen erstellen
            // 🔧 v6.14.7: Auch customerMobile als Fallback
            let _returnPhone = origRide.customerPhone || origRide.customerMobile || '';
            // 🔧 v6.14.2: Telefon aus CRM nachladen wenn in Fahrt fehlend
            if (!_returnPhone && origRide.customerId) {
                try {
                    const _rcSnap = await db.ref('customers/' + origRide.customerId).once('value');
                    const _rcData = _rcSnap.val();
                    // 🔧 v6.14.7: mobilePhone bevorzugen
                    if (_rcData && (_rcData.mobilePhone || _rcData.phone)) _returnPhone = _rcData.mobilePhone || _rcData.phone;
                } catch (_e) { /* ignore */ }
            }
            // 🔧 v6.15.5: Personenzahl + Datum der Originalfahrt übernehmen
            const origPassengers = parseInt(origRide.passengers) || 1;
            const origDatetime = origRide.datetime || origRide.scheduledTime || null;
            // Datum aus der Originalfahrt extrahieren (für "nur Uhrzeit" → gleicher Tag)
            let _returnOrigDate = null;
            if (origDatetime) {
                const _dt = new Date(origDatetime);
                if (!isNaN(_dt.getTime())) {
                    const _pad = n => String(n).padStart(2, '0');
                    _returnOrigDate = `${_dt.getFullYear()}-${_pad(_dt.getMonth()+1)}-${_pad(_dt.getDate())}`;
                }
            }
            const returnBooking = {
                pickup: origRide.destination,
                destination: origRide.pickup,
                name: origRide.customerName || '',
                phone: _returnPhone,
                passengers: origPassengers,
                _passengersExplicit: true,
                // Koordinaten tauschen
                pickupLat: origRide.destinationLat || origRide.destCoords?.lat || null,
                pickupLon: origRide.destinationLon || origRide.destCoords?.lon || null,
                destinationLat: origRide.pickupLat || origRide.pickupCoords?.lat || null,
                destinationLon: origRide.pickupLon || origRide.pickupCoords?.lon || null,
                missing: ['datetime'],
                _returnOf: origRideId,
                _returnOrigDate: _returnOrigDate
            };
            // 🔧 v6.14.2: Admin-Flags aus Originalfahrt übernehmen
            if (origRide.source === 'telegram-admin' || origRide.adminBookedBy) {
                returnBooking._adminBooked = true;
                returnBooking._adminChatId = chatId;
                returnBooking._forCustomer = origRide.bookedForCustomer || origRide.customerName || '';
                if (origRide.customerId) returnBooking._crmCustomerId = origRide.customerId;
            }
            const bookingId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            await setPending(chatId, {
                booking: returnBooking,
                bookingId,
                _awaitingDateTime: true,
                _createdAt: Date.now(),
                originalText: `Rückfahrt: ${returnText}`
            });
            await addTelegramLog('🔄', chatId, `Rückfahrt gestartet: ${origRide.destination} → ${origRide.pickup}`);
        } catch (e) {
            console.error('Rückfahrt-Fehler:', e);
            await sendTelegramMessage(chatId, '❌ Fehler beim Erstellen der Rückfahrt.');
        }
        return;
    }

    // 🆕 v6.15.5: PERSONENZAHL ÄNDERN für bestellte Fahrt
    if (data.startsWith('chpax_')) {
        const rideId = data.replace('chpax_', '');
        await handleAdminEditPax(chatId, rideId);
        return;
    }

    // 🆕 v6.14.7: DATUM ÄNDERN für bestellte Fahrt
    if (data.startsWith('chdate_')) {
        const rideId = data.replace('chdate_', '');
        try {
            const rideSnap = await db.ref('rides/' + rideId).once('value');
            const ride = rideSnap.val();
            if (!ride) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

            await setPending(chatId, {
                _awaitingDateChange: true,
                _dateChangeRideId: rideId,
                _dateChangeRide: { customerName: ride.customerName, pickup: ride.pickup, destination: ride.destination },
                _createdAt: Date.now()
            });

            const currentTime = ride.pickupTimestamp ? new Date(ride.pickupTimestamp).toLocaleString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'unbekannt';
            await sendTelegramMessage(chatId,
                `📅 <b>Datum/Zeit ändern</b>\n\n` +
                `👤 ${ride.customerName}\n` +
                `📍 ${ride.pickup} → ${ride.destination}\n` +
                `🕐 Aktuell: <b>${currentTime}</b>\n\n` +
                `Neues Datum/Uhrzeit eingeben:\n` +
                `<i>z.B. "morgen 14:00" oder "15.03. 10 Uhr"</i>`,
                { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] } }
            );
            await addTelegramLog('📅', chatId, `Datum ändern gestartet für Fahrt ${rideId}`);
        } catch (e) {
            console.error('Datum-Ändern Fehler:', e);
            await sendTelegramMessage(chatId, '❌ Fehler: ' + e.message);
        }
        return;
    }

    // 🆕 v6.14.7: GASTNAME EINTRAGEN für Fahrt
    if (data.startsWith('chguest_')) {
        const rideId = data.replace('chguest_', '');
        try {
            const rideSnap = await db.ref('rides/' + rideId).once('value');
            const ride = rideSnap.val();
            if (!ride) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

            await setPending(chatId, {
                _awaitingGuestName: true,
                _guestNameRideId: rideId,
                _createdAt: Date.now()
            });

            await sendTelegramMessage(chatId,
                `👤 <b>Gastname eintragen</b>\n\n` +
                `📍 ${ride.pickup} → ${ride.destination}\n` +
                `👤 Auftraggeber: ${ride.customerName}\n` +
                (ride.guestName ? `👤 Aktueller Gast: <b>${ride.guestName}</b>\n` : '') +
                `\nWie heißt der Fahrgast?`,
                { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] } }
            );
            await addTelegramLog('👤', chatId, `Gastname eintragen gestartet für Fahrt ${rideId}`);
        } catch (e) {
            console.error('Gastname Fehler:', e);
            await sendTelegramMessage(chatId, '❌ Fehler: ' + e.message);
        }
        return;
    }

    // Zeitslot-Auswahl
    if (data.startsWith('slot_')) {
        const match = data.match(/^slot_(-?\d+)_(\d{2})_(\d{2})$/);
        if (!match) return;
        const [, , hh, mm] = match;
        const pending = await getPending(chatId);
        if (!pending || !pending.booking) {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden.');
            return;
        }
        const existingTimestamp = parseGermanDatetime(pending.booking.datetime);
        const berlinDate = new Date(existingTimestamp).toLocaleDateString('en-CA', TZ_BERLIN); // YYYY-MM-DD
        pending.booking.datetime = `${berlinDate}T${hh}:${mm}:00`;
        pending._prevalidatedSlot = true;
        pending._prevalidatedAt = Date.now();
        await setPending(chatId, pending);

        // Bestätigung inline aktualisieren mit neuer Zeit
        const updatedMsg = buildTelegramConfirmMsg(pending.booking, pending.routePrice || null);
        const updatedKeyboard = buildBookingConfirmKeyboard(pending.bookingId, chatId, pending.booking);
        const msgId = callback.message?.message_id;
        if (msgId) {
            await editTelegramMessage(chatId, msgId, updatedMsg, { reply_markup: updatedKeyboard });
        } else {
            await sendTelegramMessage(chatId, updatedMsg, { reply_markup: updatedKeyboard });
        }
        return;
    }

    // ═══ ADMIN: Fahrten-Verwaltung Callbacks ═══
    if (data === 'adm_rides_today') { await handleAdminRidesOverview(chatId, 'today'); return; }
    if (data === 'adm_rides_tomorrow') { await handleAdminRidesOverview(chatId, 'tomorrow'); return; }
    if (data === 'adm_rides_open') { await handleAdminRidesOverview(chatId, 'open'); return; }

    // 🆕 v6.25.4: Datum-Navigation (Vor/Zurück)
    if (data.startsWith('adm_rides_date_')) {
        const dateStr = data.replace('adm_rides_date_', '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            await handleAdminRidesOverview(chatId, dateStr);
        }
        return;
    }

    // 🆕 v6.25.4: Datum-Picker — zeigt Wochenübersicht zur Auswahl
    if (data === 'adm_rides_datepicker') {
        if (!await isTelegramAdmin(chatId)) return;
        const now = new Date();
        const berlinNow = new Date(now.toLocaleString('en-US', TZ_BERLIN));
        const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

        let msg = '🗓️ <b>Datum wählen</b>\n\nWählen Sie einen Tag oder schreiben Sie ein Datum (z.B. <i>20.03</i> oder <i>2026-03-20</i>):';
        const buttons = [];

        // Aktuelle Woche + nächste Woche (14 Tage)
        for (let week = 0; week < 2; week++) {
            const row = [];
            for (let d = 0; d < 7; d++) {
                const dayOffset = week * 7 + d;
                const date = new Date(berlinNow);
                date.setDate(date.getDate() + dayOffset);
                const dateStr = date.toLocaleDateString('en-CA'); // YYYY-MM-DD
                const dayLabel = `${weekdays[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`;
                row.push({ text: dayOffset === 0 ? `📍${dayLabel}` : dayLabel, callback_data: `adm_rides_date_${dateStr}` });
            }
            buttons.push(row);
        }

        // Vergangene Woche
        const pastRow = [];
        for (let d = 7; d >= 1; d--) {
            const date = new Date(berlinNow);
            date.setDate(date.getDate() - d);
            const dateStr = date.toLocaleDateString('en-CA');
            const dayLabel = `${weekdays[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`;
            pastRow.push({ text: dayLabel, callback_data: `adm_rides_date_${dateStr}` });
        }
        buttons.push([{ text: '── Vergangene Woche ──', callback_data: 'noop' }]);
        buttons.push(pastRow);

        buttons.push([{ text: '📅 Heute', callback_data: 'adm_rides_today' }, { text: '🏠 Menü', callback_data: 'back_to_menu' }]);

        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
        await setPending(chatId, { _adminDatePicker: true });
        return;
    }

    // 🆕 v6.25.4: noop — ignoriert leere Callbacks (z.B. Trennzeile)
    if (data === 'noop') return;

    // 🆕 v6.29.3: Admin — Fahrt kopieren → Auswahl: Eintragen (gleiche Richtung) oder Tauschen (Hin↔Rück)
    if (data.startsWith('adm_copy_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const _copyRideId = data.replace('adm_copy_', '');
        try {
            const _copySnap = await db.ref('rides/' + _copyRideId).once('value');
            const _copyRide = _copySnap.val();
            if (!_copyRide) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

            const _dt = new Date(_copyRide.pickupTimestamp || 0);
            const _timeStr = _dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
            const _dateStr = _dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, day: '2-digit', month: '2-digit' });

            let _copyMsg = '📋 <b>Fahrt kopieren</b>\n\n';
            _copyMsg += `📍 Von: <b>${_copyRide.pickup || '?'}</b>\n`;
            _copyMsg += `🎯 Nach: <b>${_copyRide.destination || '?'}</b>\n`;
            _copyMsg += `👤 ${_copyRide.customerName || 'Unbekannt'}`;
            if (_copyRide.customerPhone) _copyMsg += ` · 📱 ${_copyRide.customerPhone}`;
            _copyMsg += '\n';
            _copyMsg += `👥 ${_copyRide.passengers || 1} Person(en)\n`;
            _copyMsg += `📅 Original: ${_dateStr} um ${_timeStr} Uhr\n`;
            _copyMsg += '\n<b>Wie möchtest du kopieren?</b>';

            await sendTelegramMessage(chatId, _copyMsg, { reply_markup: { inline_keyboard: [
                [{ text: '📋 Eintragen (gleiche Richtung)', callback_data: `adm_copygo_${_copyRideId}` }],
                [{ text: '🔄 Tauschen (Hin ↔ Rück)', callback_data: `adm_copyswap_${_copyRideId}` }],
                [{ text: '◀ Zurück', callback_data: `adm_ride_${_copyRideId}` }]
            ]}});
            await addTelegramLog('📋', chatId, `Admin kopiert Fahrt: ${_copyRide.pickup} → ${_copyRide.destination}`);
        } catch (e) {
            console.error('Admin Fahrt kopieren Fehler:', e);
            await sendTelegramMessage(chatId, '⚠️ Fehler beim Kopieren: ' + e.message);
        }
        return;
    }

    // 🆕 v6.29.3: Admin — Fahrt kopieren: Eintragen (gleiche Richtung) oder Tauschen (swap)
    if (data.startsWith('adm_copygo_') || data.startsWith('adm_copyswap_')) {
        if (!await isTelegramAdmin(chatId)) return;
        const _isSwap = data.startsWith('adm_copyswap_');
        const _copyRideId2 = data.replace(_isSwap ? 'adm_copyswap_' : 'adm_copygo_', '');
        try {
            const _copySnap2 = await db.ref('rides/' + _copyRideId2).once('value');
            const _copyRide2 = _copySnap2.val();
            if (!_copyRide2) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

            // Buchungs-Objekt erstellen — bei Tauschen: Abholort ↔ Zielort
            const _pickup = _isSwap ? (_copyRide2.destination || null) : (_copyRide2.pickup || null);
            const _dest = _isSwap ? (_copyRide2.pickup || null) : (_copyRide2.destination || null);
            const _pLat = _isSwap ? (_copyRide2.destCoords ? _copyRide2.destCoords.lat : null) : (_copyRide2.pickupCoords ? _copyRide2.pickupCoords.lat : null);
            const _pLon = _isSwap ? (_copyRide2.destCoords ? (_copyRide2.destCoords.lon || _copyRide2.destCoords.lng) : null) : (_copyRide2.pickupCoords ? (_copyRide2.pickupCoords.lon || _copyRide2.pickupCoords.lng) : null);
            const _dLat = _isSwap ? (_copyRide2.pickupCoords ? _copyRide2.pickupCoords.lat : null) : (_copyRide2.destCoords ? _copyRide2.destCoords.lat : null);
            const _dLon = _isSwap ? (_copyRide2.pickupCoords ? (_copyRide2.pickupCoords.lon || _copyRide2.pickupCoords.lng) : null) : (_copyRide2.destCoords ? (_copyRide2.destCoords.lon || _copyRide2.destCoords.lng) : null);

            const _copyData2 = {
                intent: 'buchung',
                pickup: _pickup,
                destination: _dest,
                pickupLat: _pLat,
                pickupLon: _pLon,
                destinationLat: _dLat,
                destinationLon: _dLon,
                passengers: _copyRide2.passengers || 1,
                datetime: null,
                name: _copyRide2.customerName || '',
                phone: _copyRide2.customerPhone || _copyRide2.customerMobile || '',
                notes: _copyRide2.notes || '',
                missing: ['datetime'],
                summary: (_isSwap ? 'Rückfahrt von ' : 'Kopie von ') + _copyRideId2
            };

            // Admin-Flags setzen
            _copyData2._adminBooked = true;
            _copyData2._adminChatId = chatId;
            _copyData2._forCustomer = _copyRide2.bookedForCustomer || _copyRide2.customerName || '';
            if (_copyRide2.customerId) {
                _copyData2._crmCustomerId = _copyRide2.customerId;
                try {
                    const _cSnap2 = await db.ref('customers/' + _copyRide2.customerId).once('value');
                    const _cData2 = _cSnap2.val();
                    if (_cData2) {
                        if (!_copyData2.phone) _copyData2.phone = _cData2.phone || '';
                        if (_cData2.address) _copyData2._customerAddress = _cData2.address;
                    }
                } catch (_e) { /* ignore */ }
            }

            let _copyMsg2 = _isSwap ? '🔄 <b>Rückfahrt erstellen</b>\n\n' : '📋 <b>Fahrt kopieren</b>\n\n';
            _copyMsg2 += `📍 Von: <b>${_pickup || '?'}</b>\n`;
            _copyMsg2 += `🎯 Nach: <b>${_dest || '?'}</b>\n`;
            _copyMsg2 += `👤 ${_copyData2.name || 'Unbekannt'} · 👥 ${_copyData2.passengers} Person(en)\n`;
            _copyMsg2 += '\n💬 <b>Für wann soll die Fahrt eingetragen werden?</b>\n<i>Bitte Datum und Uhrzeit angeben (z.B. "morgen 14:30" oder "heute 10 Uhr")</i>';

            await setPending(chatId, { partial: _copyData2, originalText: _isSwap ? 'Admin Rückfahrt' : 'Admin kopiert Fahrt' });
            await sendTelegramMessage(chatId, _copyMsg2);
            await addTelegramLog('📋', chatId, `Admin ${_isSwap ? 'Rückfahrt' : 'Kopie'}: ${_pickup} → ${_dest} (${_copyData2.name})`);
        } catch (e) {
            console.error('Admin Fahrt kopieren/tauschen Fehler:', e);
            await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
        }
        return;
    }

    if (data.startsWith('adm_ride_')) {
        const rideId = data.replace('adm_ride_', '');
        await handleAdminRideDetail(chatId, rideId);
        return;
    }

    if (data.startsWith('adm_edit_time_')) {
        await handleAdminEditTime(chatId, data.replace('adm_edit_time_', ''));
        return;
    }
    if (data.startsWith('adm_edit_addr_')) {
        const rideId = data.replace('adm_edit_addr_', '');
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }
        await sendTelegramMessage(chatId,
            `📍 <b>Adresse ändern</b>\n\n📍 Von: ${r.pickup || '?'}\n🎯 Nach: ${r.destination || '?'}\n\nWas ändern?`,
            { reply_markup: { inline_keyboard: [
                [{ text: '📍 Abholort', callback_data: `adm_setfield_${rideId}_pickup` }, { text: '🎯 Zielort', callback_data: `adm_setfield_${rideId}_destination` }],
                [{ text: '◀ Zurück', callback_data: `adm_ride_${rideId}` }]
            ]}}
        );
        return;
    }
    if (data.startsWith('adm_edit_pax_')) {
        await handleAdminEditPax(chatId, data.replace('adm_edit_pax_', ''));
        return;
    }
    if (data.startsWith('adm_edit_status_')) {
        await handleAdminEditStatus(chatId, data.replace('adm_edit_status_', ''));
        return;
    }
    if (data.startsWith('adm_del_')) {
        await handleAdminDeleteRide(chatId, data.replace('adm_del_', ''));
        return;
    }
    // 🔧 v6.20.2: Quick-Assign aus Sofortfahrt-Push (Admin drückt direkt "Taxi X zuweisen")
    if (data.startsWith('qassign_')) {
        const rest = data.replace('qassign_', '');
        const lastUs = rest.lastIndexOf('_');
        const rideId = rest.substring(0, lastUs);
        const vehicleId = rest.substring(lastUs + 1);
        // Weiterleiten an adm_setvehicle_ Handler (macht Zuweisung + Kundenbenachrichtigung)
        data = `adm_setvehicle_${rideId}_${vehicleId}`;
    }

    if (data.startsWith('adm_assign_')) {
        const rideId = data.replace('adm_assign_', '');
        const snap = await db.ref(`rides/${rideId}`).once('value');
        const r = snap.val();
        if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }
        const currentVehicle = r.assignedVehicleName || r.vehicle || r.vehicleLabel || 'Keins';
        const keyboard = Object.entries(OFFICIAL_VEHICLES).map(([id, v]) => {
            const label = id === (r.assignedVehicle || r.vehicleId) ? `✅ ${v.name}` : `🚗 ${v.name}`;
            return [{ text: label, callback_data: `adm_setvehicle_${rideId}_${id}` }];
        });
        keyboard.push([{ text: '❌ Zuweisung entfernen', callback_data: `adm_setvehicle_${rideId}_none` }]);
        keyboard.push([{ text: '◀ Zurück', callback_data: `adm_ride_${rideId}` }]);
        await sendTelegramMessage(chatId,
            `🚗 <b>Fahrzeug zuweisen</b>\n\nAktuell: <b>${currentVehicle}</b>`,
            { reply_markup: { inline_keyboard: keyboard } }
        );
        return;
    }
    if (data.startsWith('adm_setvehicle_')) {
        const rest = data.replace('adm_setvehicle_', '');
        const lastUs = rest.lastIndexOf('_');
        const rideId = rest.substring(0, lastUs);
        const vehicleId = rest.substring(lastUs + 1);
        try {
            if (vehicleId === 'none') {
                await db.ref(`rides/${rideId}`).update({
                    assignedVehicle: null, vehicleId: null, assignedTo: null,
                    vehicle: null, vehicleLabel: null, vehiclePlate: null,
                    assignedVehicleName: null, assignedVehiclePlate: null,
                    assignedBy: null, assignedAt: null,
                    editedAt: Date.now(), editedBy: 'telegram-admin'
                });
                await addTelegramLog('✏️', chatId, 'Admin: Fahrzeug-Zuweisung entfernt');
                await sendTelegramMessage(chatId, '✅ Fahrzeug-Zuweisung entfernt');
            } else {
                const v = OFFICIAL_VEHICLES[vehicleId];
                if (!v) { await sendTelegramMessage(chatId, '⚠️ Fahrzeug nicht gefunden.'); return; }
                await db.ref(`rides/${rideId}`).update({
                    assignedVehicle: vehicleId, vehicleId: vehicleId, assignedTo: vehicleId,
                    vehicle: v.name, vehicleLabel: v.name, vehiclePlate: v.plate,
                    assignedVehicleName: v.name, assignedVehiclePlate: v.plate,
                    assignedBy: 'telegram-admin', assignedAt: Date.now(),
                    editedAt: Date.now(), editedBy: 'telegram-admin'
                });
                await addTelegramLog('✏️', chatId, `Admin: Fahrzeug zugewiesen → ${v.name} (${v.plate})`);
                await sendTelegramMessage(chatId, `✅ Fahrzeug zugewiesen: <b>${v.name}</b> (${v.plate})`);

                // 🆕 Kunden per Telegram benachrichtigen
                try {
                    const rideSnap = await db.ref(`rides/${rideId}`).once('value');
                    const ride = rideSnap.val();
                    if (ride) {
                        const customerPhone = ride.customerPhone || ride.phone;
                        let customerChatId = null;
                        if (customerPhone) {
                            const normalizedPhone = customerPhone.replace(/\s+/g, '');
                            const custSnap = await db.ref('settings/telegram/customers').once('value');
                            const telegramCustomers = custSnap.val() || {};
                            for (const tcId in telegramCustomers) {
                                const tc = telegramCustomers[tcId];
                                if (tc.phone && tc.phone.replace(/\s+/g, '') === normalizedPhone) {
                                    customerChatId = tcId;
                                    break;
                                }
                            }
                        }
                        if (customerChatId && String(customerChatId) !== String(chatId)) {
                            const dt = new Date(ride.pickupTimestamp || Date.now());
                            const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
                            await sendTelegramMessage(customerChatId,
                                `🚕 <b>Fahrzeug zugewiesen!</b>\n\n` +
                                `🚗 <b>${v.name}</b>\n` +
                                `📍 ${ride.pickup} → ${ride.destination}\n` +
                                `🕐 Abholung: ${timeStr} Uhr\n\n` +
                                `✅ <i>Ihr Fahrer wird pünktlich vor Ort sein.</i>`
                            );
                            await addTelegramLog('📱', chatId, `Kunde benachrichtigt: Fahrzeug ${v.name} zugewiesen`);
                        }
                    }
                } catch (notifyErr) { /* Nicht kritisch */ }
            }
            await handleAdminRideDetail(chatId, rideId);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Admin: Zeit per Offset-Button setzen
    if (data.startsWith('adm_settime_')) {
        const parts = data.replace('adm_settime_', '').split('_');
        const rideId = parts.slice(0, -1).join('_');
        const offset = parseInt(parts[parts.length - 1]);
        try {
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }
            const newTs = (r.pickupTimestamp || Date.now()) + offset * 60000;
            const newDt = new Date(newTs);
            const newTime = newDt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
            await db.ref(`rides/${rideId}`).update({
                pickupTimestamp: newTs, pickupTime: newTime,
                editedAt: Date.now(), editedBy: 'telegram-admin'
            });
            await addTelegramLog('✏️', chatId, `Admin: Zeit geändert auf ${newTime} (${offset > 0 ? '+' : ''}${offset}min)`);
            await sendTelegramMessage(chatId, `✅ Zeit geändert auf <b>${newTime} Uhr</b>`);
            await handleAdminRideDetail(chatId, rideId);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Admin: Adresse ändern - Freitext-Eingabe starten
    if (data.startsWith('adm_setfield_')) {
        const rest = data.replace('adm_setfield_', '');
        const lastUnderscore = rest.lastIndexOf('_');
        const rideId = rest.substring(0, lastUnderscore);
        const field = rest.substring(lastUnderscore + 1);
        const label = field === 'pickup' ? 'Abholort' : 'Zielort';
        await setPending(chatId, { _adminEditRide: rideId, _adminEditField: field });
        await sendTelegramMessage(chatId, `📍 <b>${label} eingeben:</b>\n\nSchreibe die neue Adresse:`, {
            reply_markup: { inline_keyboard: [[{ text: '✖ Abbrechen', callback_data: `adm_ride_${rideId}` }]] }
        });
        return;
    }

    // Admin: Adress-Vorschlag auswählen (Nominatim-Ergebnis)
    if (data.startsWith('adm_addr_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminAddrResults) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage abgelaufen. Bitte nochmal versuchen.');
            return;
        }
        // adm_addr_raw_{rideId}_{field} → Rohtext speichern
        if (data.startsWith('adm_addr_raw_')) {
            const rest = data.replace('adm_addr_raw_', '');
            const lastUs = rest.lastIndexOf('_');
            const rideId = rest.substring(0, lastUs);
            const field = rest.substring(lastUs + 1);
            const rawText = pending._adminAddrRaw || '';
            await deletePending(chatId);
            const geo = await geocode(rawText);
            await applyAdminAddressChange(chatId, rideId, field, rawText, geo);
            return;
        }
        // adm_addr_{index}_{rideId}_{field} → Vorschlag auswählen
        const rest = data.replace('adm_addr_', '');
        const firstUs = rest.indexOf('_');
        const index = parseInt(rest.substring(0, firstUs));
        const remainder = rest.substring(firstUs + 1);
        const lastUs = remainder.lastIndexOf('_');
        const rideId = remainder.substring(0, lastUs);
        const field = remainder.substring(lastUs + 1);
        const selected = pending._adminAddrResults[index];
        if (!selected) { await sendTelegramMessage(chatId, '⚠️ Ungültige Auswahl.'); return; }
        await deletePending(chatId);
        await applyAdminAddressChange(chatId, rideId, field, selected.name, { lat: selected.lat, lon: selected.lon });
        return;
    }

    // Admin: Personenzahl setzen
    if (data.startsWith('adm_setpax_')) {
        const parts = data.replace('adm_setpax_', '').split('_');
        const rideId = parts.slice(0, -1).join('_');
        const pax = parseInt(parts[parts.length - 1]);
        try {
            await db.ref(`rides/${rideId}`).update({ passengers: pax, editedAt: Date.now(), editedBy: 'telegram-admin' });
            await addTelegramLog('✏️', chatId, `Admin: Personenzahl geändert auf ${pax}`);
            await sendTelegramMessage(chatId, `✅ Personenzahl geändert auf <b>${pax}</b>`);
            await handleAdminRideDetail(chatId, rideId);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Admin: Status setzen
    if (data.startsWith('adm_setstatus_')) {
        const parts = data.replace('adm_setstatus_', '').split('_');
        const rideId = parts.slice(0, -1).join('_');
        const newStatus = parts[parts.length - 1];
        const statusLabels = { open: '🟢 Offen', vorbestellt: '🔵 Vorbestellt', unterwegs: '🚕 Unterwegs', abgeschlossen: '✅ Abgeschlossen' };
        try {
            await db.ref(`rides/${rideId}`).update({ status: newStatus, editedAt: Date.now(), editedBy: 'telegram-admin' });
            await addTelegramLog('✏️', chatId, `Admin: Status geändert auf "${newStatus}"`);
            await sendTelegramMessage(chatId, `✅ Status geändert auf <b>${statusLabels[newStatus] || newStatus}</b>`);

            // 🆕 Kunden-Benachrichtigung wenn Fahrer unterwegs
            if (newStatus === 'unterwegs') {
                try {
                    const rideSnap = await db.ref(`rides/${rideId}`).once('value');
                    const ride = rideSnap.val();
                    if (ride) {
                        // Kunden-ChatId finden über Telefonnummer
                        let customerChatId = null;
                        const customerPhone = ride.customerPhone || ride.phone;
                        if (customerPhone) {
                            const normalizedPhone = customerPhone.replace(/\s+/g, '');
                            const custSnap = await db.ref('settings/telegram/customers').once('value');
                            const telegramCustomers = custSnap.val() || {};
                            for (const tcId in telegramCustomers) {
                                const tc = telegramCustomers[tcId];
                                if (tc.phone && tc.phone.replace(/\s+/g, '') === normalizedPhone) {
                                    customerChatId = tcId;
                                    break;
                                }
                            }
                        }
                        if (customerChatId && String(customerChatId) !== String(chatId)) {
                            const vehicleName = ride.assignedVehicleName || ride.vehicle || ride.vehicleLabel || '';
                            const dt = new Date(ride.pickupTimestamp || Date.now());
                            const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
                            await sendTelegramMessage(customerChatId,
                                `🚗 <b>Ihr Fahrer ist unterwegs!</b>\n\n` +
                                (vehicleName ? `🚕 Fahrzeug: <b>${vehicleName}</b>\n` : '') +
                                `📍 ${ride.pickup} → ${ride.destination}\n` +
                                `🕐 Abholung: ${timeStr} Uhr\n\n` +
                                `✅ <i>Bitte halten Sie sich bereit!</i>`,
                                { reply_markup: { inline_keyboard: [
                                    [{ text: '📋 Meine Buchungen', callback_data: 'cmd_meine' }]
                                ]}}
                            );
                            await addTelegramLog('📱', chatId, `Kunde benachrichtigt: Fahrer unterwegs (ChatId: ${customerChatId})`);
                        }
                    }
                } catch (notifyErr) {
                    console.error('Kunden-Benachrichtigung Fehler:', notifyErr.message);
                }
            }

            await handleAdminRideDetail(chatId, rideId);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Admin: Fahrt endgültig löschen
    if (data.startsWith('adm_delconfirm_')) {
        const rideId = data.replace('adm_delconfirm_', '');
        try {
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            await db.ref(`rides/${rideId}`).update({ status: 'storniert', deletedBy: 'telegram-admin', deletedAt: Date.now() });
            await addTelegramLog('🗑️', chatId, `Admin: Fahrt gelöscht: ${r ? r.pickup : '?'} → ${r ? r.destination : '?'}`);
            await sendTelegramMessage(chatId, `🗑️ <b>Fahrt storniert!</b>\n\n${r ? `📍 ${r.pickup} → ${r.destination}\n👤 ${r.customerName || '?'}` : ''}`);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // ═══ KUNDEN: Fahrt bearbeiten/stornieren ═══
    if (data.startsWith('cust_edit_')) {
        const rideId = data.replace('cust_edit_', '');
        try {
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

            const dt = new Date(r.pickupTimestamp || 0);
            const dateStr = dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' });
            const timeStr = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });

            let msg = `✏️ <b>Fahrt bearbeiten</b>\n\n`;
            msg += `📅 ${dateStr} um ${timeStr} Uhr\n`;
            msg += `📍 ${r.pickup || '?'} → ${r.destination || '?'}\n`;
            msg += `👥 ${r.passengers || 1} Person(en)\n\n`;
            msg += `<b>Was möchten Sie ändern?</b>`;

            await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: [
                [{ text: '⏰ Uhrzeit ändern', callback_data: `cust_time_${rideId}` }],
                [{ text: '📍 Abholort ändern', callback_data: `cust_addr_${rideId}_pickup` }, { text: '🎯 Ziel ändern', callback_data: `cust_addr_${rideId}_destination` }],
                [{ text: '🗑️ Stornieren', callback_data: `cust_del_${rideId}` }, { text: '✖ Zurück', callback_data: 'cust_edit_cancel' }]
            ]}});
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Kunden: Adress-Vorschlag auswählen (Nominatim-Ergebnis)
    if (data.startsWith('cust_asel_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._custAddrResults) {
            await sendTelegramMessage(chatId, '⚠️ Anfrage abgelaufen. Bitte nochmal versuchen.');
            return;
        }
        const rest = data.replace('cust_asel_', '');
        const firstUs = rest.indexOf('_');
        const index = parseInt(rest.substring(0, firstUs));
        const remainder = rest.substring(firstUs + 1);
        const lastUs = remainder.lastIndexOf('_');
        const rideId = remainder.substring(0, lastUs);
        const field = remainder.substring(lastUs + 1);
        const selected = pending._custAddrResults[index];
        if (!selected) { await sendTelegramMessage(chatId, '⚠️ Ungültige Auswahl.'); return; }
        await deletePending(chatId);
        try {
            // 🔧 v6.16.3: Admin-Bestätigung statt direktem Update
            const changeData = {};
            changeData[field] = selected.name;
            changeData[field + 'Lat'] = selected.lat;
            changeData[field + 'Lon'] = selected.lon;
            changeData[field === 'pickup' ? 'pickupCoords' : 'destCoords'] = { lat: selected.lat, lon: selected.lon };

            const rideSnap = await db.ref(`rides/${rideId}`).once('value');
            const rideData = rideSnap.val() || {};
            const dt = new Date(rideData.pickupTimestamp || 0);
            const rideInfo = {
                customerName: rideData.guestName || rideData.customerName || 'Kunde',
                dateStr: dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' }),
                timeStr: dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' }),
                pickup: rideData.pickup || '?',
                destination: rideData.destination || '?'
            };
            await requestAdminApprovalForRideChange(chatId, rideId, field, changeData, rideInfo);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    if (data === 'cust_edit_cancel') {
        await sendTelegramMessage(chatId, '✅ OK, nichts geändert.');
        return;
    }

    // Kunden: Uhrzeit ändern
    if (data.startsWith('cust_time_')) {
        const rideId = data.replace('cust_time_', '');
        try {
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }

            const dt = new Date(r.pickupTimestamp || 0);
            const currentTime = dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });

            const timeButtons = [];
            for (const offset of [-60, -30, 30, 60]) {
                const alt = new Date(dt.getTime() + offset * 60000);
                const altTime = alt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });
                const label = offset < 0 ? `${altTime} (${offset}min)` : `${altTime} (+${offset}min)`;
                timeButtons.push({ text: label, callback_data: `cust_settime_${rideId}_${offset}` });
            }

            await sendTelegramMessage(chatId,
                `⏰ <b>Neue Uhrzeit wählen</b>\n\nAktuell: <b>${currentTime} Uhr</b>\n\nWählen Sie eine Zeit oder schreiben Sie z.B. "14:30":`,
                { reply_markup: { inline_keyboard: [
                    [timeButtons[0], timeButtons[1]],
                    [timeButtons[2], timeButtons[3]],
                    [{ text: '◀ Zurück', callback_data: `cust_edit_${rideId}` }]
                ]}}
            );
            await setPending(chatId, { _custEditRide: rideId, _custEditField: 'time' });
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Kunden: Adresse ändern - Freitext starten
    if (data.startsWith('cust_addr_')) {
        const rest = data.replace('cust_addr_', '');
        const lastUnderscore = rest.lastIndexOf('_');
        const rideId = rest.substring(0, lastUnderscore);
        const field = rest.substring(lastUnderscore + 1);
        const label = field === 'pickup' ? 'Abholort' : 'Zielort';
        await setPending(chatId, { _custEditRide: rideId, _custEditField: field });
        await sendTelegramMessage(chatId, `📍 <b>Neuen ${label} eingeben:</b>\n\nSchreiben Sie die neue Adresse:`, {
            reply_markup: { inline_keyboard: [[{ text: '✖ Abbrechen', callback_data: `cust_edit_${rideId}` }]] }
        });
        return;
    }

    // Kunden: Zeit per Button setzen — 🔧 v6.16.3: Mit Admin-Bestätigung!
    if (data.startsWith('cust_settime_')) {
        const parts = data.replace('cust_settime_', '').split('_');
        const rideId = parts.slice(0, -1).join('_');
        const offset = parseInt(parts[parts.length - 1]);
        try {
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }
            const newTs = (r.pickupTimestamp || Date.now()) + offset * 60000;
            const newDt = new Date(newTs);
            const newTime = newDt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' });

            const dt = new Date(r.pickupTimestamp || 0);
            const rideInfo = {
                customerName: r.guestName || r.customerName || 'Kunde',
                dateStr: dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' }),
                timeStr: dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' }),
                pickup: r.pickup || '?',
                destination: r.destination || '?'
            };
            await requestAdminApprovalForRideChange(chatId, rideId, 'time', {
                pickupTimestamp: newTs, pickupTime: newTime
            }, rideInfo);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.16.3: Admin bestätigt Kunden-Änderung
    if (data.startsWith('approve_chg_')) {
        const changeId = data.replace('approve_chg_', '');
        try {
            const chgSnap = await db.ref(`settings/telegram/pendingChanges/${changeId}`).once('value');
            const chg = chgSnap.val();
            if (!chg) { await sendTelegramMessage(chatId, '⚠️ Änderungsanfrage nicht mehr vorhanden.'); return; }
            if (chg.status !== 'pending') { await sendTelegramMessage(chatId, `ℹ️ Diese Anfrage wurde bereits ${chg.status === 'approved' ? 'bestätigt' : 'abgelehnt'}.`); return; }

            // Änderung anwenden
            const update = { ...chg.changeData, editedAt: Date.now(), editedBy: 'telegram-customer', approvedBy: 'admin', approvedAt: Date.now(), updatedAt: Date.now() };
            await db.ref(`rides/${chg.rideId}`).update(update);

            // Status aktualisieren
            await db.ref(`settings/telegram/pendingChanges/${changeId}`).update({ status: 'approved', approvedAt: Date.now() });

            // Admin bestätigen
            let changeDesc = '';
            if (chg.changeType === 'time') changeDesc = `⏰ Uhrzeit → ${chg.changeData.pickupTime} Uhr`;
            else if (chg.changeType === 'pickup') changeDesc = `📍 Abholort → ${chg.changeData.pickup}`;
            else if (chg.changeType === 'destination') changeDesc = `🎯 Ziel → ${chg.changeData.destination}`;
            await sendTelegramMessage(chatId, `✅ <b>Änderung bestätigt!</b>\n\n${changeDesc}\n\nFahrt wurde aktualisiert.`);

            // Kunde informieren
            try {
                await sendTelegramMessage(chg.customerChatId, `✅ <b>Ihre Änderung wurde bestätigt!</b>\n\n${changeDesc}\n\n<i>Vielen Dank, wir freuen uns auf Sie!</i>`);
            } catch (e2) { console.error('Kunde-Benachrichtigung fehlgeschlagen:', e2.message); }

            await addTelegramLog('✅', chatId, `Admin: Änderung bestätigt (${chg.changeType}) für Fahrt ${chg.rideId}`);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // 🆕 v6.16.3: Admin lehnt Kunden-Änderung ab
    if (data.startsWith('reject_chg_')) {
        const changeId = data.replace('reject_chg_', '');
        try {
            const chgSnap = await db.ref(`settings/telegram/pendingChanges/${changeId}`).once('value');
            const chg = chgSnap.val();
            if (!chg) { await sendTelegramMessage(chatId, '⚠️ Änderungsanfrage nicht mehr vorhanden.'); return; }
            if (chg.status !== 'pending') { await sendTelegramMessage(chatId, `ℹ️ Diese Anfrage wurde bereits ${chg.status === 'approved' ? 'bestätigt' : 'abgelehnt'}.`); return; }

            // Status aktualisieren
            await db.ref(`settings/telegram/pendingChanges/${changeId}`).update({ status: 'rejected', rejectedAt: Date.now() });

            let changeDesc = '';
            if (chg.changeType === 'time') changeDesc = `⏰ Uhrzeit → ${chg.changeData.pickupTime} Uhr`;
            else if (chg.changeType === 'pickup') changeDesc = `📍 Abholort → ${chg.changeData.pickup}`;
            else if (chg.changeType === 'destination') changeDesc = `🎯 Ziel → ${chg.changeData.destination}`;
            await sendTelegramMessage(chatId, `❌ <b>Änderung abgelehnt.</b>\n\n${changeDesc}\n\nFahrt bleibt unverändert.`);

            // Kunde informieren
            try {
                await sendTelegramMessage(chg.customerChatId, `❌ <b>Änderung nicht möglich</b>\n\n${changeDesc}\n\n<i>Ihre gewünschte Änderung konnte leider nicht übernommen werden. Bitte kontaktieren Sie uns unter 038378-22200 für weitere Fragen.</i>`);
            } catch (e2) { console.error('Kunde-Benachrichtigung fehlgeschlagen:', e2.message); }

            await addTelegramLog('❌', chatId, `Admin: Änderung abgelehnt (${chg.changeType}) für Fahrt ${chg.rideId}`);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Kunden: Fahrt stornieren
    if (data.startsWith('cust_del_')) {
        const rideId = data.replace('cust_del_', '');
        try {
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            if (!r) { await sendTelegramMessage(chatId, '⚠️ Fahrt nicht gefunden.'); return; }
            const dt = new Date(r.pickupTimestamp || 0);
            const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            await sendTelegramMessage(chatId,
                `🗑️ <b>Fahrt wirklich stornieren?</b>\n\n📅 ${timeStr} Uhr\n📍 ${r.pickup || '?'} → ${r.destination || '?'}`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '🗑️ Ja, stornieren!', callback_data: `cust_delok_${rideId}` }, { text: '✖ Behalten', callback_data: `cust_edit_${rideId}` }]
                ]}}
            );
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
        return;
    }

    // Kunden: Stornierung bestätigt
    if (data.startsWith('cust_delok_')) {
        const rideId = data.replace('cust_delok_', '');
        try {
            await db.ref(`rides/${rideId}`).update({ status: 'storniert', deletedBy: 'telegram-customer', deletedAt: Date.now() });
            const snap = await db.ref(`rides/${rideId}`).once('value');
            const r = snap.val();
            await addTelegramLog('🗑️', chatId, `Kunde hat storniert: ${r ? r.pickup : '?'} → ${r ? r.destination : '?'}`);
            const cancelKeyboard = { inline_keyboard: [
                [{ text: '🚕 Neue Fahrt buchen', callback_data: 'menu_buchen' }],
                [{ text: '📋 Meine Buchungen', callback_data: 'cmd_meine' }, { text: '🏠 Hauptmenü', callback_data: 'back_to_menu' }]
            ]};
            await sendTelegramMessage(chatId, `✅ <b>Fahrt storniert!</b>\n\n📍 ${r ? r.pickup : '?'} → ${r ? r.destination : '?'}\n\n💡 <i>Möchten Sie ein neues Taxi buchen?</i>`, { reply_markup: cancelKeyboard });

            // Admin benachrichtigen
            try {
                const dt = new Date(r.pickupTimestamp || 0);
                const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                await sendToAllAdmins(
                    `⚠️ <b>Stornierung!</b>\n\n👤 ${r.customerName || '?'}\n📅 ${timeStr} Uhr\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n\n<i>Kunde hat per Telegram storniert.</i>`,
                    'cancellation'
                );
            } catch (e) { /* Admin-Benachrichtigung ist nicht kritisch */ }
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler beim Stornieren.'); }
        return;
    }

    // Fahrt löschen (Kunden-Seite, alter Handler)
    if (data.startsWith('del_ride_')) {
        const rideId = data.replace('del_ride_', '');
        try {
            await db.ref(`rides/${rideId}`).update({ status: 'deleted', deletedBy: 'telegram', deletedAt: Date.now() });
            const ridesSnap = await db.ref(`rides/${rideId}`).once('value');
            const r = ridesSnap.val();
            await sendTelegramMessage(chatId, `✅ <b>Buchung gelöscht!</b>\n\n📍 ${r ? r.pickup : '?'} → ${r ? r.destination : '?'}\n\n<i>Neues Taxi? Schreiben Sie wann und wohin!</i>`);
        } catch (e) {
            await sendTelegramMessage(chatId, '⚠️ Fehler beim Löschen.');
        }
        return;
    }
    if (data === 'del_cancel') {
        await sendTelegramMessage(chatId, '✅ Keine Buchung gelöscht.');
        return;
    }

    // Admin Kundenwahl
    if (data.startsWith('admin_cust_yes_') || data.startsWith('admin_cust_sel_')) {
        const pending = await getPending(chatId);
        let found = null;

        if (data.startsWith('admin_cust_yes_')) {
            if (!pending || !pending.crmConfirm) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
            found = pending.crmConfirm.found;
        } else {
            const selectMatch = data.match(/^admin_cust_sel_(\d+)_(.+)$/);
            if (!selectMatch) return;
            if (!pending || !pending.crmMultiSelect) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
            found = pending.crmMultiSelect.matches[parseInt(selectMatch[1])];
            if (!found) { await sendTelegramMessage(chatId, '⚠️ Ungültige Auswahl.'); return; }
        }

        await addTelegramLog('👤', chatId, `Admin: Vorausgewählter Kunde: ${found.name}`);

        // Beliebte Ziele des Kunden laden
        // 🔧 v6.14.7: Auch mobilePhone für Favoriten-Suche nutzen
        const favorites = await getCustomerFavoriteDestinations(found.name, found.mobilePhone || found.phone);
        if (favorites.length > 0) {
            const favId = Date.now().toString(36);
            await setPending(chatId, {
                awaitingFavDestination: true,
                originalText: pending.originalText,
                userName: pending.userName,
                preselectedCustomer: found,
                favorites,
                favId
            });
            // 🔧 v6.11.0: Favoriten-Adressen per Reverse-Geocoding aufhübschen
            for (const f of favorites) {
                if (f.destinationLat && f.destinationLon) {
                    f.destination = await cleanupAddress(f.destination, f.destinationLat, f.destinationLon);
                }
            }
            let favMsg = `✅ <b>${found.name}</b>\n\n⭐ <b>Beliebte Ziele:</b>\n`;
            const buttons = favorites.map((f, i) => {
                favMsg += `${i + 1}. ${f.destination} (${f.count}x)\n`;
                const label = f.destination.length > 35 ? f.destination.slice(0, 33) + '…' : f.destination;
                return [{ text: `📍 ${label}`, callback_data: `fav_dest_${i}_${favId}` }];
            });
            buttons.push([{ text: '📝 Anderes Ziel', callback_data: `fav_dest_other_${favId}` }]);
            await sendTelegramMessage(chatId, favMsg, { reply_markup: { inline_keyboard: buttons } });
        } else {
            // Keine Favoriten → normaler Flow
            await deletePending(chatId);
            await sendTelegramMessage(chatId, `✅ <b>${found.name}</b>\n🤖 <i>Analysiere Buchung...</i>`);
            await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, { isAdmin: true, preselectedCustomer: found });
        }
        return;
    }
    if (data.startsWith('admin_cust_no_')) {
        const pending = await getPending(chatId);
        if (!pending) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        await setPending(chatId, { awaitingCustomerName: true, originalText: pending.originalText, userName: pending.userName, _callerPhone: pending._callerPhone || null });
        await sendTelegramMessage(chatId, '👤 <b>Anderen Kundennamen eingeben:</b>', {
            reply_markup: { inline_keyboard: [
                [{ text: '🆕 Neuen Kunden anlegen', callback_data: 'admin_new_customer' }],
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    // 🆕 v6.14.0: Admin — Neuen Kunden anlegen (direkt aus Menü)
    if (data === 'admin_new_customer') {
        const pending = await getPending(chatId);
        await setPending(chatId, {
            _adminNewCust: true,
            _adminNewCustStep: 'name',
            _callerPhone: pending ? pending._callerPhone || null : null, // 🆕 v6.11.5: Telefon durchreichen
            originalText: pending ? pending.originalText : '',
            userName: pending ? pending.userName : ''
        });
        await sendTelegramMessage(chatId, '🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Bitte den <b>Namen</b> eingeben:', { reply_markup: { inline_keyboard: [
            [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
        ]}});
        return;
    }

    // 🆕 v6.14.0: Admin — Neuen Kunden anlegen nach Suche (nicht gefunden)
    if (data.startsWith('admin_create_cust_')) {
        const pending = await getPending(chatId);
        if (!pending) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }

        // 🆕 v6.11.5: Wenn Telefonnummer aus Audio-Dateiname bekannt → Schritt überspringen
        // 🔧 v6.15.1: Festnetz aus Audio → Mobilnummer optional abfragen
        const knownPhone = pending._callerPhone || '';
        if (knownPhone) {
            if (!isMobileNumber(knownPhone)) {
                await addTelegramLog('☎️', chatId, `Festnetz aus Audio erkannt: ${knownPhone} → frage nach Mobilnummer`);
                await setPending(chatId, {
                    _adminNewCust: true,
                    _adminNewCustStep: 'mobilePhone',
                    _adminNewCustName: pending.newCustomerName || '',
                    _adminNewCustPhone: knownPhone,
                    _callerPhone: knownPhone,
                    originalText: pending.originalText || '',
                    userName: pending.userName || ''
                });
                await sendTelegramMessage(chatId,
                    `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending.newCustomerName}</b>\n☎️ Festnetz: <b>${knownPhone}</b> <i>(aus Audiodatei)</i>\n\n📱 Möchtest du eine <b>Mobilnummer</b> hinzufügen?`,
                    { reply_markup: { inline_keyboard: [
                        [{ text: '⏩ Ohne Mobilnummer weiter', callback_data: 'admin_newcust_nomobile' }]
                    ] } }
                );
                return;
            }
            await addTelegramLog('📱', chatId, `Telefon aus Audio-Datei übernommen: ${knownPhone} → überspringe Telefon-Schritt`);
            await setPending(chatId, {
                _adminNewCust: true,
                _adminNewCustStep: 'address',
                _adminNewCustName: pending.newCustomerName || '',
                _adminNewCustPhone: knownPhone,
                _callerPhone: knownPhone,
                originalText: pending.originalText || '',
                userName: pending.userName || ''
            });
            await sendTelegramMessage(chatId,
                `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending.newCustomerName}</b>\n📱 Telefon: <b>${knownPhone}</b> <i>(aus Audiodatei)</i>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
                { reply_markup: { inline_keyboard: [
                    [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ]}}
            );
            return;
        }

        await setPending(chatId, {
            _adminNewCust: true,
            _adminNewCustStep: 'phone',
            _adminNewCustName: pending.newCustomerName || '',
            originalText: pending.originalText || '',
            userName: pending.userName || ''
        });
        await sendTelegramMessage(chatId,
            `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending.newCustomerName}</b>\n\n📱 Bitte die <b>Telefonnummer</b> eingeben:`,
            { reply_markup: { inline_keyboard: [
                [{ text: '⏩ Ohne Telefon weiter', callback_data: 'admin_newcust_nophone' }],
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] } }
        );
        return;
    }

    // 🆕 v6.14.0: Admin — Ohne CRM buchen
    if (data.startsWith('admin_skip_crm_')) {
        const pending = await getPending(chatId);
        if (!pending) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '🤖 <i>Analysiere Buchung...</i>');
        await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, { isAdmin: true, forCustomerName: pending.newCustomerName || '' });
        return;
    }

    // 🆕 v6.14.0: Admin — Anderen Namen suchen
    if (data.startsWith('admin_retry_name_')) {
        const pending = await getPending(chatId);
        if (!pending) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        await setPending(chatId, { awaitingCustomerName: true, originalText: pending.originalText, userName: pending.userName });
        await sendTelegramMessage(chatId, '👤 <b>Anderen Kundennamen eingeben:</b>', {
            reply_markup: { inline_keyboard: [
                [{ text: '🆕 Neuen Kunden anlegen', callback_data: 'admin_new_customer' }],
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    // 🔧 v6.15.1: Admin — Neuer Kunde: Ohne Mobilnummer weiter (Festnetz bereits gespeichert)
    if (data === 'admin_newcust_nomobile') {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        await setPending(chatId, {
            ...pending,
            _adminNewCustStep: 'address',
            _adminNewCustMobilePhone: ''
        });
        await sendTelegramMessage(chatId,
            `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n☎️ Festnetz: <b>${pending._adminNewCustPhone}</b>\n📱 Mobil: <i>ohne</i>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
            { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }}
        );
        return;
    }

    // 🆕 v6.14.0: Admin — Neuer Kunde ohne Telefon weiter
    if (data === 'admin_newcust_nophone') {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        await setPending(chatId, {
            ...pending,
            _adminNewCustStep: 'address',
            _adminNewCustPhone: ''
        });
        await sendTelegramMessage(chatId,
            `🆕 <b>Neuen Kunden anlegen</b>\n\n👤 Name: <b>${pending._adminNewCustName}</b>\n📱 Telefon: <i>ohne</i>\n\n🏠 Bitte die <b>Adresse</b> eingeben oder 📎 <b>Standort senden</b>:`,
            { reply_markup: { inline_keyboard: [[{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]] }}
        );
        return;
    }

    // 🆕 v6.14.1: Admin — Geocodierte Adresse bestätigt → Kundenart fragen
    if (data.startsWith('admin_newcust_addr_yes_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const resolvedAddress = pending._adminNewCustAddr || '';
        await addTelegramLog('📍', chatId, `Adresse bestätigt: ${resolvedAddress}`);
        // 🆕 v6.11.5: Kundenart fragen (Stammkunde vs. Gelegenheitskunde)
        await setPending(chatId, {
            ...pending,
            _adminNewCustStep: 'customerKind'
        });
        await sendTelegramMessage(chatId,
            `🏷️ <b>Kundenart festlegen</b>\n\n👤 <b>${pending._adminNewCustName}</b>\n🏠 ${resolvedAddress}\n\nIst das die <b>Wohnanschrift</b> oder nur eine <b>Abholadresse</b>?`, {
            reply_markup: { inline_keyboard: [
                [{ text: '🏠 Wohnanschrift (Stammkunde)', callback_data: 'admin_newcust_kind_stamm' }],
                [{ text: '📍 Nur Abholadresse (Gelegenheitskunde)', callback_data: 'admin_newcust_kind_gelegenheit' }],
                [{ text: '🏨 Hotel / Pension (bucht für Gäste)', callback_data: 'admin_newcust_kind_hotel' }],
                [{ text: '🏢 Firma / Klinik (bucht für Andere)', callback_data: 'admin_newcust_kind_auftraggeber' }],
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    // 🆕 v6.11.5: Admin — Adresse aus Vorschlagsliste gewählt → Kundenart fragen
    if (data.startsWith('admin_newcust_adr_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        // Parse Index aus callback_data: admin_newcust_adr_0_confirmId
        const parts = data.replace('admin_newcust_adr_', '').split('_');
        const idx = parseInt(parts[0], 10);
        const suggestions = pending._adminNewCustSuggestions || [];
        if (idx >= 0 && idx < suggestions.length) {
            const selected = suggestions[idx];
            await addTelegramLog('📍', chatId, `Adresse aus Vorschlag gewählt: ${selected.name}`);
            // Kundenart fragen
            await setPending(chatId, {
                ...pending,
                _adminNewCustStep: 'customerKind',
                _adminNewCustAddr: selected.name,
                _adminNewCustAddrLat: selected.lat,
                _adminNewCustAddrLon: selected.lon
            });
            await sendTelegramMessage(chatId,
                `🏷️ <b>Kundenart festlegen</b>\n\n👤 <b>${pending._adminNewCustName}</b>\n📍 ${selected.name}\n\nIst das die <b>Wohnanschrift</b> oder nur eine <b>Abholadresse</b>?`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '🏠 Wohnanschrift (Stammkunde)', callback_data: 'admin_newcust_kind_stamm' }],
                    [{ text: '📍 Nur Abholadresse (Gelegenheitskunde)', callback_data: 'admin_newcust_kind_gelegenheit' }],
                    [{ text: '🏨 Hotel / Pension (bucht für Gäste)', callback_data: 'admin_newcust_kind_hotel' }],
                    [{ text: '🏢 Firma / Klinik (bucht für Andere)', callback_data: 'admin_newcust_kind_auftraggeber' }]
                ] }
            });
        } else {
            await sendTelegramMessage(chatId, '⚠️ Vorschlag nicht mehr gefunden. Bitte Adresse nochmal eingeben.');
            await setPending(chatId, { ...pending, _adminNewCustStep: 'address' });
        }
        return;
    }

    // 🆕 v6.14.1: Admin — Adresse als Rohtext verwenden → Kundenart fragen
    if (data.startsWith('admin_newcust_addr_raw_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const rawAddr = pending._adminNewCustAddr || '';
        await addTelegramLog('📝', chatId, `Adresse ohne Geocoding übernommen: ${rawAddr}`);
        // 🆕 v6.11.5: Kundenart fragen
        await setPending(chatId, {
            ...pending,
            _adminNewCustStep: 'customerKind',
            _adminNewCustAddr: rawAddr
        });
        await sendTelegramMessage(chatId,
            `🏷️ <b>Kundenart festlegen</b>\n\n👤 <b>${pending._adminNewCustName}</b>\n📍 ${rawAddr}\n\nIst das die <b>Wohnanschrift</b> oder nur eine <b>Abholadresse</b>?`, {
            reply_markup: { inline_keyboard: [
                [{ text: '🏠 Wohnanschrift (Stammkunde)', callback_data: 'admin_newcust_kind_stamm' }],
                [{ text: '📍 Nur Abholadresse (Gelegenheitskunde)', callback_data: 'admin_newcust_kind_gelegenheit' }],
                [{ text: '🏨 Hotel / Pension (bucht für Gäste)', callback_data: 'admin_newcust_kind_hotel' }],
                [{ text: '🏢 Firma / Klinik (bucht für Andere)', callback_data: 'admin_newcust_kind_auftraggeber' }],
                [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
            ] }
        });
        return;
    }

    // 🆕 v6.14.1: Admin — Andere Adresse eingeben
    if (data.startsWith('admin_newcust_addr_retry_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        await setPending(chatId, {
            ...pending,
            _adminNewCustStep: 'address'
        });
        await sendTelegramMessage(chatId,
            `🏠 Bitte die <b>Adresse</b> nochmal eingeben oder 📎 <b>Standort senden</b>:`
        );
        return;
    }

    // 🆕 v6.11.5: Admin — Kundenart gewählt: Stammkunde (Wohnanschrift)
    if (data === 'admin_newcust_kind_stamm') {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const addr = pending._adminNewCustAddr || '';
        const addrCoords = { lat: pending._adminNewCustAddrLat || null, lon: pending._adminNewCustAddrLon || null };
        await addTelegramLog('🏠', chatId, `Kundenart: Stammkunde (Wohnanschrift: ${addr})`);
        await createAdminNewCustomer(chatId, pending._adminNewCustName || '', pending._adminNewCustPhone || '', addr, pending.originalText, pending.userName, addrCoords, 'stammkunde', pending._adminNewCustMobilePhone || '');
        return;
    }

    // 🆕 v6.11.5: Admin — Kundenart gewählt: Gelegenheitskunde (nur Abholadresse)
    if (data === 'admin_newcust_kind_gelegenheit') {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const addr = pending._adminNewCustAddr || '';
        const addrCoords = { lat: pending._adminNewCustAddrLat || null, lon: pending._adminNewCustAddrLon || null };
        await addTelegramLog('🧳', chatId, `Kundenart: Gelegenheitskunde (Abholadresse: ${addr})`);
        await createAdminNewCustomer(chatId, pending._adminNewCustName || '', pending._adminNewCustPhone || '', addr, pending.originalText, pending.userName, addrCoords, 'gelegenheitskunde', pending._adminNewCustMobilePhone || '');
        return;
    }

    // 🆕 v6.11.6: Admin — Kundenart gewählt: Hotel/Pension (bucht für Gäste)
    if (data === 'admin_newcust_kind_hotel') {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const addr = pending._adminNewCustAddr || '';
        const addrCoords = { lat: pending._adminNewCustAddrLat || null, lon: pending._adminNewCustAddrLon || null };
        await addTelegramLog('🏨', chatId, `Kundenart: Hotel/Pension (Adresse: ${addr})`);
        await createAdminNewCustomer(chatId, pending._adminNewCustName || '', pending._adminNewCustPhone || '', addr, pending.originalText, pending.userName, addrCoords, 'hotel', pending._adminNewCustMobilePhone || '');
        return;
    }

    // 🆕 v6.15.0: Admin — Kundenart gewählt: Auftraggeber/Firma/Klinik (bucht für Andere)
    if (data === 'admin_newcust_kind_auftraggeber') {
        const pending = await getPending(chatId);
        if (!pending || !pending._adminNewCust) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const addr = pending._adminNewCustAddr || '';
        const addrCoords = { lat: pending._adminNewCustAddrLat || null, lon: pending._adminNewCustAddrLon || null };
        await addTelegramLog('🏢', chatId, `Kundenart: Auftraggeber/Firma (Adresse: ${addr})`);
        await createAdminNewCustomer(chatId, pending._adminNewCustName || '', pending._adminNewCustPhone || '', addr, pending.originalText, pending.userName, addrCoords, 'auftraggeber', pending._adminNewCustMobilePhone || '');
        return;
    }

    // CRM-Bestätigung nach AI-Analyse
    if (data.startsWith('crm_confirm_yes_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.crmConfirm) { await sendTelegramMessage(chatId, '⚠️ Nicht mehr gefunden.'); return; }
        const { found } = pending.crmConfirm;
        const booking = { ...(pending.partial || {}) };
        booking.name = found.name;
        // 🔧 v6.14.7: mobilePhone bevorzugen — nicht nur phone!
        booking.phone = found.mobilePhone || found.phone || booking.phone;
        booking._customerAddress = found.address;
        booking._forCustomer = found.name;
        booking._crmCustomerId = found.customerId || null;
        booking._adminBooked = true;
        booking._adminChatId = chatId;
        if ((found.mobilePhone || found.phone) && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');
        const pickupDefault = found.defaultPickup || found.address;
        if (pickupDefault) {
            if (!booking.pickup || /^(zu hause|zuhause|von zu hause)$/i.test((booking.pickup || '').trim())) {
                booking.pickup = pickupDefault;
                booking.missing = (booking.missing || []).filter(f => f !== 'pickup');
            }
        }
        if (!booking.missing) booking.missing = [];
        if (!booking.pickup && !booking.missing.includes('pickup')) booking.missing.push('pickup');
        if (!booking.destination && !booking.missing.includes('destination')) booking.missing.push('destination');
        if (!booking.datetime && !booking.missing.includes('datetime')) booking.missing.push('datetime');
        await continueBookingFlow(chatId, booking, pending.originalText || '');
        return;
    }
    if (data.startsWith('crm_confirm_no_')) {
        const pending = await getPending(chatId);
        if (!pending) { await sendTelegramMessage(chatId, '⚠️ Nicht mehr gefunden.'); return; }
        const booking = { ...(pending.partial || {}) };
        booking._adminBooked = true;
        booking._adminChatId = chatId;
        booking._crmCustomerId = null;
        // 🔧 v6.15.6: Telefonnummer aus Originaltext extrahieren bevor wir fragen
        if (!booking.phone && pending.originalText) {
            const _phoneMatch = pending.originalText.match(/(?:\+49|0049|0)\s*(\d[\d\s\-\/]{6,14}\d)/);
            if (_phoneMatch) {
                let _extractedPhone = _phoneMatch[0].replace(/[\s\-\/]/g, '');
                if (_extractedPhone.startsWith('0') && !_extractedPhone.startsWith('00')) {
                    _extractedPhone = '+49' + _extractedPhone.slice(1);
                } else if (_extractedPhone.startsWith('0049')) {
                    _extractedPhone = '+49' + _extractedPhone.slice(4);
                }
                // 🆕 v6.25.1: Validierung der extrahierten Nummer
                const _phoneValid = validatePhoneNumber(_extractedPhone);
                booking.phone = _extractedPhone;
                if (!_phoneValid.valid) {
                    await addTelegramLog('⚠️', chatId, `Telefonnummer möglicherweise ungültig: ${_extractedPhone} — ${_phoneValid.warning}`);
                }
            }
        }
        if (!booking.phone) {
            if (!booking.missing) booking.missing = [];
            if (!booking.missing.includes('phone')) booking.missing.push('phone');
        }
        if (!booking.missing) booking.missing = [];
        if (!booking.pickup && !booking.missing.includes('pickup')) booking.missing.push('pickup');
        if (!booking.destination && !booking.missing.includes('destination')) booking.missing.push('destination');
        if (!booking.datetime && !booking.missing.includes('datetime')) booking.missing.push('datetime');
        await continueBookingFlow(chatId, booking, pending.originalText || '');
        return;
    }
    if (data.startsWith('crm_select_')) {
        const selectMatch = data.match(/^crm_select_(\d+)_(.+)$/);
        if (!selectMatch) return;
        const pending = await getPending(chatId);
        if (!pending || !pending.crmMultiSelect) { await sendTelegramMessage(chatId, '⚠️ Nicht mehr gefunden.'); return; }
        const found = pending.crmMultiSelect.matches[parseInt(selectMatch[1])];
        if (!found) { await sendTelegramMessage(chatId, '⚠️ Ungültige Auswahl.'); return; }
        const booking = { ...(pending.partial || {}) };
        booking.name = found.name;
        // 🔧 v6.14.7: mobilePhone bevorzugen — nicht nur phone!
        booking.phone = found.mobilePhone || found.phone || booking.phone;
        booking._customerAddress = found.address;
        booking._forCustomer = found.name;
        booking._crmCustomerId = found.customerId || null;
        booking._adminBooked = true;
        booking._adminChatId = chatId;
        if ((found.mobilePhone || found.phone) && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');
        if (!booking.missing) booking.missing = [];
        if (!booking.pickup && !booking.missing.includes('pickup')) booking.missing.push('pickup');
        if (!booking.destination && !booking.missing.includes('destination')) booking.missing.push('destination');
        if (!booking.datetime && !booking.missing.includes('datetime')) booking.missing.push('datetime');
        await continueBookingFlow(chatId, booking, pending.originalText || '');
        return;
    }

    // CRM anlegen
    if (data.startsWith('crm_create_yes_')) {
        const rideId = data.replace('crm_create_yes_', '');
        const crmSnap = await db.ref('settings/telegram/pending/crm_' + chatId).once('value');
        const crmPending = crmSnap.val();
        if (!crmPending) { await sendTelegramMessage(chatId, '⚠️ Kundendaten nicht mehr vorhanden.'); return; }
        try {
            const newRef = db.ref('customers').push();
            await newRef.set({ name: crmPending.customerName, phone: crmPending.customerPhone || '', address: crmPending.pickupAddress || '', createdAt: Date.now(), createdBy: 'telegram-admin', totalRides: 1, isVIP: false, notes: '' });
            if (rideId) await db.ref(`rides/${rideId}`).update({ customerId: newRef.key });
            await db.ref('settings/telegram/pending/crm_' + chatId).remove();
            await sendTelegramMessage(chatId, `✅ <b>${crmPending.customerName}</b> im CRM angelegt!\n📱 ${crmPending.customerPhone || '(kein Tel.)'}\n🏠 ${crmPending.pickupAddress || '(keine Adresse)'}`);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ CRM-Fehler: ' + e.message); }
        return;
    }
    if (data.startsWith('crm_create_yesnoaddr_')) {
        const rideId = data.replace('crm_create_yesnoaddr_', '');
        const crmSnap = await db.ref('settings/telegram/pending/crm_' + chatId).once('value');
        const crmPending = crmSnap.val();
        if (!crmPending) { await sendTelegramMessage(chatId, '⚠️ Kundendaten nicht mehr vorhanden.'); return; }
        try {
            const newRef = db.ref('customers').push();
            await newRef.set({ name: crmPending.customerName, phone: crmPending.customerPhone || '', address: '', createdAt: Date.now(), createdBy: 'telegram-admin', totalRides: 1, isVIP: false, notes: '' });
            if (rideId) await db.ref(`rides/${rideId}`).update({ customerId: newRef.key });
            await db.ref('settings/telegram/pending/crm_' + chatId).remove();
            await sendTelegramMessage(chatId, `✅ <b>${crmPending.customerName}</b> im CRM angelegt (ohne Adresse)!`);
        } catch (e) { await sendTelegramMessage(chatId, '⚠️ CRM-Fehler: ' + e.message); }
        return;
    }
    if (data.startsWith('crm_create_no_')) {
        await db.ref('settings/telegram/pending/crm_' + chatId).remove();
        await sendTelegramMessage(chatId, '✅ OK, ohne CRM-Eintrag.');
        return;
    }

    // 🆕 v6.15.0: Auftraggeber-Adresse als Abholort gewählt
    if (data.startsWith('auftr_pickup_')) {
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            const booking = pending.partial;
            booking.pickup = booking._auftraggeberAddress;
            booking.missing = (booking.missing || []).filter(f => f !== 'pickup');
            if (booking._auftraggeberLat && booking._auftraggeberLon) {
                booking.pickupLat = booking._auftraggeberLat;
                booking.pickupLon = booking._auftraggeberLon;
            }
            booking._auftraggeberResolved = true;
            await addTelegramLog('📍', chatId, `Auftraggeber-Adresse als ABHOLORT: ${booking._auftraggeberAddress}`);
            await continueBookingFlow(chatId, booking, pending.originalText || '');
        }
        return;
    }

    // 🆕 v6.15.0: Auftraggeber-Adresse als Zielort gewählt
    if (data.startsWith('auftr_dest_')) {
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            const booking = pending.partial;
            booking.destination = booking._auftraggeberAddress;
            booking.missing = (booking.missing || []).filter(f => f !== 'destination');
            if (booking._auftraggeberLat && booking._auftraggeberLon) {
                booking.destinationLat = booking._auftraggeberLat;
                booking.destinationLon = booking._auftraggeberLon;
            }
            booking._auftraggeberResolved = true;
            await addTelegramLog('🎯', chatId, `Auftraggeber-Adresse als ZIELORT: ${booking._auftraggeberAddress}`);
            await continueBookingFlow(chatId, booking, pending.originalText || '');
        }
        return;
    }

    // 🆕 v6.15.0: Auftraggeber-Adresse weder Abholort noch Zielort
    if (data.startsWith('auftr_skip_')) {
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            const booking = pending.partial;
            booking._auftraggeberResolved = true;
            await addTelegramLog('⏭️', chatId, `Auftraggeber-Adresse übersprungen`);
            await continueBookingFlow(chatId, booking, pending.originalText || '');
        }
        return;
    }

    // Adress-Skip
    // Adresse neu eingeben (Kunde will andere Adresse)
    if (data.startsWith('addr_retry_')) {
        const field = data.replace('addr_retry_', ''); // 'pickup' oder 'destination'
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            const booking = pending.partial;
            booking[field] = null;
            if (field === 'pickup') { booking.pickupLat = null; booking.pickupLon = null; }
            else { booking.destinationLat = null; booking.destinationLon = null; }
            if (!booking.missing) booking.missing = [];
            if (!booking.missing.includes(field)) booking.missing.push(field);
            delete pending.nominatimResults;
            const fieldLabel = field === 'pickup' ? 'Abholort' : 'Zielort';
            await sendTelegramMessage(chatId, `✏️ Bitte geben Sie den <b>${fieldLabel}</b> erneut ein:`);
            await setPending(chatId, { partial: booking, originalText: pending.originalText || '' });
        }
        return;
    }

    if (data === 'addr_skip') {
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            const booking = pending.partial;
            // Prüfe ob noch Pflichtfelder fehlen (datetime!)
            if (!booking.datetime) {
                if (!booking.missing) booking.missing = [];
                if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
                await continueBookingFlow(chatId, booking, pending.originalText || '');
                return;
            }
            const routePrice = await calculateTelegramRoutePrice(booking);
            await askPassengersOrConfirm(chatId, booking, routePrice, pending.originalText || '');
        }
        return;
    }

    // Nominatim-Adressauswahl
    if (data.startsWith('np_') || data.startsWith('nd_')) {
        const isPickup = data.startsWith('np_');
        const index = parseInt(data.substring(3));
        const pending = await getPending(chatId);
        if (!pending || !pending.nominatimResults || !pending.partial) return;
        const selected = pending.nominatimResults[index];
        if (!selected) return;

        if (isPickup) {
            pending.partial.pickup = selected.name;
            pending.partial.pickupLat = selected.lat;
            pending.partial.pickupLon = selected.lon;
        } else {
            pending.partial.destination = selected.name;
            pending.partial.destinationLat = selected.lat;
            pending.partial.destinationLon = selected.lon;
        }

        // Prüfe ob noch die andere Adresse fehlt
        if (pending.pendingDestValidation && isPickup) {
            pending.pendingDestValidation = false;
            const destValidated = await validateTelegramAddresses(chatId, pending.partial, pending.originalText || '');
            if (!destValidated) return;
            Object.assign(pending.partial, destValidated);
        }

        const booking = pending.partial;
        delete pending.nominatimResults;
        const routePrice = await calculateTelegramRoutePrice(booking);
        await askPassengersOrConfirm(chatId, booking, routePrice, pending.originalText || '');
        return;
    }
}

// ═══════════════════════════════════════════════════════════════
// KONTAKT-HANDLER (Telefonnummer teilen)
// ═══════════════════════════════════════════════════════════════

async function handleContact(message) {
    const chatId = message.chat.id;
    const contact = message.contact;
    const firstName = contact.first_name || message.from?.first_name || 'Unbekannt';
    const removeKeyboard = { reply_markup: { remove_keyboard: true } };

    let phone = (contact.phone_number || '').replace(/\s/g, '');
    if (phone.startsWith('+')) { /* bereits korrekt */ }
    else if (phone.startsWith('00')) phone = '+' + phone.slice(2);
    else if (phone.startsWith('49') && phone.length >= 12) phone = '+' + phone;
    else if (phone.startsWith('0')) phone = '+49' + phone.slice(1);
    else phone = '+49' + phone;

    await addTelegramLog('📱', chatId, `Kontakt geteilt: ${phone} (${firstName})`);

    // Admin-Check: Auch Admins als Kunde speichern (für /profil)
    if (await isTelegramAdmin(chatId)) {
        const existing = await getTelegramCustomer(chatId);
        if (!existing) {
            await saveTelegramCustomer(chatId, { name: firstName, phone, isAdmin: true, linkedAt: Date.now() });
        }
        await sendTelegramMessage(chatId, `✅ <b>Admin-Profil gespeichert.</b>\n\n👤 ${firstName}\n📱 ${phone}\n\n/profil um Daten zu verwalten.`, removeKeyboard);
        return;
    }

    try {
        const digits = phone.replace(/\D/g, '');
        const snap = await db.ref('customers').once('value');
        let customerId = null;
        let customerData = null;
        snap.forEach(child => {
            if (customerId) return;
            const c = child.val();
            // 🔧 v6.14.7: Auch mobilePhone in CRM-Suche berücksichtigen
            const cPhone = (c.mobilePhone || c.phone || c.mobile || '').replace(/\D/g, '');
            if (digits && digits.length > 5 && (cPhone.endsWith(digits.slice(-9)))) {
                customerId = child.key;
                customerData = c;
            }
        });

        const commandHint = '\n\n<b>Ihre Möglichkeiten:</b>\n🚕 Fahrt buchen – einfach schreiben wann & wohin\n📊 /status – Ihre Fahrten ansehen\n✏️ Fahrten bearbeiten oder stornieren\n👤 /profil – Ihre Daten verwalten\nℹ️ /hilfe – Alle Befehle';
        if (customerId && customerData) {
            // 🔧 v6.25.3: lat/lon aus CRM mitspeichern für Adress-Skip
            await saveTelegramCustomer(chatId, { customerId, name: customerData.name || firstName, phone: customerData.phone || phone, mobile: customerData.mobile || null, address: customerData.address || null, lat: customerData.lat || customerData.pickupLat || null, lon: customerData.lon || customerData.pickupLon || null, linkedAt: Date.now() });
            await db.ref('customers/' + customerId).update({ telegramChatId: String(chatId) });
            await sendTelegramMessage(chatId, `✅ <b>Willkommen zurück, ${customerData.name}!</b>\n\nIhre Nummer <b>${phone}</b> ist gespeichert.${commandHint}`, removeKeyboard);
        } else {
            // 🆕 v6.14.0: Neuen Kunden AUCH im CRM anlegen!
            const newCustRef = db.ref('customers').push();
            await newCustRef.set({
                name: firstName,
                phone: phone,
                address: '',
                email: '',
                createdAt: Date.now(),
                createdBy: 'telegram-self',
                source: 'telegram',
                totalRides: 0,
                telegramChatId: String(chatId)
            });
            const newCustId = newCustRef.key;
            await saveTelegramCustomer(chatId, { customerId: newCustId, name: firstName, phone, linkedAt: Date.now() });
            await addTelegramLog('🆕', chatId, `Neuer CRM-Kunde automatisch angelegt: ${firstName} (${newCustId})`);
            await sendTelegramMessage(chatId, `✅ <b>Danke, ${firstName}!</b>\n\nIhre Nummer <b>${phone}</b> wurde gespeichert.${commandHint}`, removeKeyboard);
        }
    } catch (e) {
        await sendTelegramMessage(chatId, '✅ Telefonnummer erhalten! Sie können jetzt buchen.', removeKeyboard);
    }
}

// ═══════════════════════════════════════════════════════════════
// STANDORT-HANDLER (GPS-Standort als Abholort)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 🆕 v6.11.3: SPRACHNACHRICHTEN – Telegram Voice → OpenAI Whisper → Text
// Whisper API für Transkription, dann Weiterverarbeitung als Textnachricht
// ═══════════════════════════════════════════════════════════════

async function getOpenAiApiKey() {
    const snap = await db.ref('settings/openai/apiKey').once('value');
    return snap.val() || null;
}

async function handleVoice(message) {
    const chatId = message.chat.id;
    const voice = message.voice;
    if (!voice || !voice.file_id) {
        await sendTelegramMessage(chatId, '⚠️ Sprachnachricht konnte nicht verarbeitet werden.');
        return;
    }

    try {
        // 1. Prüfe ob OpenAI API Key vorhanden
        const openaiKey = await getOpenAiApiKey();
        if (!openaiKey) {
            await addTelegramLog('⚠️', chatId, 'Sprachnachricht empfangen, aber kein OpenAI API Key (settings/openai/apiKey)');
            await sendTelegramMessage(chatId, '⚠️ Spracherkennung nicht konfiguriert.\nBitte schreiben Sie Ihre Anfrage als Text.');
            return;
        }

        // 2. Sende "Verarbeite..." Status
        await sendTelegramMessage(chatId, '🎙️ <i>Sprachnachricht wird verarbeitet...</i>');

        // 3. Hole Datei-Info von Telegram
        const token = await loadBotToken();
        const fileResp = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: voice.file_id })
        });
        const fileData = await fileResp.json();
        if (!fileData.ok || !fileData.result?.file_path) {
            await sendTelegramMessage(chatId, '⚠️ Audio-Datei konnte nicht geladen werden.');
            return;
        }

        // 4. Lade die Audio-Datei herunter
        const fileUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
        const audioResp = await fetch(fileUrl);
        if (!audioResp.ok) {
            await sendTelegramMessage(chatId, '⚠️ Audio-Download fehlgeschlagen.');
            return;
        }
        const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

        // 5. Sende an OpenAI Whisper API zur Transkription
        // Whisper erwartet multipart/form-data mit der Audio-Datei
        const boundary = '----WhisperBoundary' + Date.now();
        const formParts = [];
        // model
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`);
        // language (Deutsch)
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde`);
        // prompt (Kontext für bessere Erkennung)
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nTaxi-Buchung Usedom: Heringsdorf, Ahlbeck, Bansin, Zinnowitz, Koserow, Wolgast, Swinemünde, Peenemünde, Trassenheide, Karlshagen, Ückeritz, Loddin, Zempin`);
        // file (Audio als OGG)
        const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`;
        const fileFooter = `\r\n--${boundary}--\r\n`;

        // Baue den multipart Body zusammen
        const textParts = formParts.join('\r\n') + '\r\n';
        const textEncoder = new TextEncoder();
        const textBefore = textEncoder.encode(textParts + fileHeader);
        const textAfter = textEncoder.encode(fileFooter);

        const bodyBuffer = Buffer.concat([
            Buffer.from(textBefore),
            audioBuffer,
            Buffer.from(textAfter)
        ]);

        const transcribeResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: bodyBuffer
        });

        if (!transcribeResp.ok) {
            const errData = await transcribeResp.json().catch(() => ({}));
            const errMsg = errData.error?.message || `HTTP ${transcribeResp.status}`;
            console.error('Whisper Transkription Fehler:', errMsg);
            await addTelegramLog('❌', chatId, `Whisper Voice-Fehler: ${errMsg}`);
            await sendTelegramMessage(chatId, '⚠️ Spracherkennung fehlgeschlagen. Bitte schreiben Sie Ihre Anfrage als Text.');
            return;
        }

        const transcribeResult = await transcribeResp.json();
        const transcript = (transcribeResult.text || '').trim();

        if (!transcript) {
            await sendTelegramMessage(chatId, '⚠️ Konnte keine Sprache erkennen. Bitte sprechen Sie deutlicher oder schreiben Sie Ihre Anfrage.');
            return;
        }

        // 6. Zeige Transkript dem User
        await addTelegramLog('🎙️', chatId, `Sprachnachricht transkribiert: "${transcript}"`);
        await sendTelegramMessage(chatId, `🎙️ <b>Erkannt:</b>\n<i>"${transcript}"</i>\n\n⏳ Wird verarbeitet...`);

        // 7. Verarbeite Transkript wie eine normale Textnachricht
        const fakeMessage = {
            ...message,
            text: transcript,
            _isVoiceTranscript: true
        };
        await handleMessage(fakeMessage);

    } catch (error) {
        console.error('handleVoice Fehler:', error);
        await addTelegramLog('❌', chatId, `Voice-Fehler: ${error.message}`);
        await sendTelegramMessage(chatId, '⚠️ Fehler bei der Sprachverarbeitung: ' + error.message + '\n\nBitte schreiben Sie Ihre Anfrage als Text.');
    }
}

// 🆕 v6.14.0: Prüfe ob ein Dokument eine Audio-Datei ist
function isAudioDocument(doc) {
    if (!doc) return false;
    const mime = (doc.mime_type || '').toLowerCase();
    const name = (doc.file_name || '').toLowerCase();
    const audioMimes = ['audio/', 'video/ogg', 'application/ogg'];
    const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma', '.opus', '.webm', '.mp4', '.3gp', '.amr'];
    if (audioMimes.some(m => mime.startsWith(m) || mime === m)) return true;
    if (audioExts.some(ext => name.endsWith(ext))) return true;
    return false;
}

// 🆕 v6.14.0: Audio-Dateien und Dokumente transkribieren (MP3, WAV, M4A etc.)
async function handleAudioFile(message) {
    const chatId = message.chat.id;
    // Audio kann als message.audio ODER message.document kommen
    const audioObj = message.audio || message.document;
    if (!audioObj || !audioObj.file_id) {
        await sendTelegramMessage(chatId, '⚠️ Audio-Datei konnte nicht verarbeitet werden.');
        return;
    }

    const fileName = audioObj.file_name || audioObj.title || 'audio';
    const mimeType = audioObj.mime_type || 'audio/mpeg';
    const fileSize = audioObj.file_size || 0;

    // Telegram erlaubt max 20MB Download
    if (fileSize > 20 * 1024 * 1024) {
        await sendTelegramMessage(chatId, '⚠️ Die Datei ist zu groß (max. 20 MB). Bitte eine kürzere Aufnahme senden.');
        return;
    }

    try {
        // 1. OpenAI Key prüfen
        const openaiKey = await getOpenAiApiKey();
        if (!openaiKey) {
            await addTelegramLog('⚠️', chatId, `Audio-Datei empfangen (${fileName}), aber kein OpenAI API Key`);
            await sendTelegramMessage(chatId, '⚠️ Spracherkennung nicht konfiguriert.\nBitte schreiben Sie Ihre Anfrage als Text.');
            return;
        }

        await sendTelegramMessage(chatId, `🎙️ <i>Audio-Datei "${fileName}" wird transkribiert...</i>`);
        await addTelegramLog('🎙️', chatId, `Audio-Datei empfangen: ${fileName} (${(fileSize / 1024).toFixed(0)} KB, ${mimeType})`);

        // 2. Datei von Telegram herunterladen
        const token = await loadBotToken();
        const fileResp = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: audioObj.file_id })
        });
        const fileData = await fileResp.json();
        if (!fileData.ok || !fileData.result?.file_path) {
            await sendTelegramMessage(chatId, '⚠️ Datei konnte nicht geladen werden.');
            return;
        }

        const fileUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
        const audioResp = await fetch(fileUrl);
        if (!audioResp.ok) {
            await sendTelegramMessage(chatId, '⚠️ Audio-Download fehlgeschlagen.');
            return;
        }
        const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

        // 3. An OpenAI Whisper senden
        // Dateiendung aus dem Dateinamen oder MIME-Type ableiten
        let ext = 'mp3';
        if (fileName.includes('.')) ext = fileName.split('.').pop().toLowerCase();
        else if (mimeType.includes('ogg')) ext = 'ogg';
        else if (mimeType.includes('wav')) ext = 'wav';
        else if (mimeType.includes('m4a') || mimeType.includes('mp4')) ext = 'm4a';
        else if (mimeType.includes('flac')) ext = 'flac';
        else if (mimeType.includes('webm')) ext = 'webm';

        const boundary = '----WhisperBoundary' + Date.now();
        const formParts = [];
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`);
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde`);
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nTaxi-Buchung Usedom: Heringsdorf, Ahlbeck, Bansin, Zinnowitz, Koserow, Wolgast, Swinemünde, Peenemünde, Trassenheide, Karlshagen, Ückeritz, Loddin, Zempin`);

        const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
        const fileFooter = `\r\n--${boundary}--\r\n`;

        const textParts = formParts.join('\r\n') + '\r\n';
        const textEncoder = new TextEncoder();
        const textBefore = textEncoder.encode(textParts + fileHeader);
        const textAfter = textEncoder.encode(fileFooter);

        const bodyBuffer = Buffer.concat([
            Buffer.from(textBefore),
            audioBuffer,
            Buffer.from(textAfter)
        ]);

        const transcribeResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: bodyBuffer
        });

        if (!transcribeResp.ok) {
            const errData = await transcribeResp.json().catch(() => ({}));
            const errMsg = errData.error?.message || `HTTP ${transcribeResp.status}`;
            console.error('Whisper Audio-Datei Fehler:', errMsg);
            await addTelegramLog('❌', chatId, `Whisper Audio-Fehler: ${errMsg}`);
            await sendTelegramMessage(chatId, '⚠️ Transkription fehlgeschlagen: ' + errMsg + '\n\nBitte schreiben Sie Ihre Anfrage als Text.');
            return;
        }

        const transcribeResult = await transcribeResp.json();
        const transcript = (transcribeResult.text || '').trim();

        if (!transcript) {
            await sendTelegramMessage(chatId, '⚠️ Konnte keine Sprache in der Datei erkennen. Ist die Aufnahme deutlich genug?');
            return;
        }

        await addTelegramLog('🎙️', chatId, `Audio-Datei transkribiert (${fileName}): "${transcript.substring(0, 100)}..."`);

        // 🆕 v6.14.8: TELEFONNUMMER AUS DATEINAMEN EXTRAHIEREN + CRM-SUCHE
        // Dateiname-Format: "+49_172_6324074_+491726324074_2026_03_10_09_33_20_Eingehend.m4a"
        // oder: "Steigenberger_+4938378495901_2026_03_11_08_13_15_Eingehend.m4a"
        // 🔧 v6.11.6: Regex stoppt vor dem Datumsteil _YYYY_ (z.B. _2026_)
        let callerPhone = null;
        let callerCustomer = null;
        // 🔧 v6.25.1: Greedy statt lazy matching — lazy {8,}? schnitt Nummern ab
        const phoneMatch = fileName.match(/\+(\d[\d_]{8,})(?=_20\d{2}_)/);
        if (phoneMatch) {
            callerPhone = '+' + phoneMatch[1].replace(/_/g, '');
            // 🆕 v6.25.1: Validierung der Anrufer-Nummer
            const callerValid = validatePhoneNumber(callerPhone);
            if (callerValid.valid) {
                await addTelegramLog('📞', chatId, `Anrufer-Telefon aus Dateiname: ${callerPhone}`);
            } else {
                await addTelegramLog('⚠️', chatId, `Anrufer-Telefon möglicherweise ungültig: ${callerPhone} — ${callerValid.warning}`);
            }

            // CRM-Suche nach dieser Telefonnummer (inkl. zusätzliche Nummern bei Hotels)
            try {
                const allCust = await loadAllCustomers();
                const phoneDigits = callerPhone.replace(/\D/g, '');
                const last9 = phoneDigits.slice(-9);
                const foundCustomer = allCust.find(c => {
                    const p1 = (c.mobilePhone || '').replace(/\D/g, '');
                    const p2 = (c.phone || '').replace(/\D/g, '');
                    const p3 = (c.phone2 || '').replace(/\D/g, '');  // 🔧 v6.11.6: Zweite Festnetz-Nummer
                    if ((p1.length > 5 && p1.endsWith(last9)) ||
                        (p2.length > 5 && p2.endsWith(last9)) ||
                        (p3.length > 5 && p3.endsWith(last9))) return true;
                    // 🆕 v6.11.6: Zusätzliche Telefonnummern prüfen (z.B. Hotels mit mehreren Leitungen)
                    if (c.additionalPhones && Array.isArray(c.additionalPhones)) {
                        return c.additionalPhones.some(ap => {
                            const apDigits = (ap || '').replace(/\D/g, '');
                            return apDigits.length > 5 && apDigits.endsWith(last9);
                        });
                    }
                    return false;
                });
                if (foundCustomer) {
                    callerCustomer = foundCustomer;
                    await addTelegramLog('✅', chatId, `Anrufer im CRM gefunden: ${foundCustomer.name} (${foundCustomer.customerId || foundCustomer.id})`);
                } else {
                    await addTelegramLog('🆕', chatId, `Anrufer ${callerPhone} nicht im CRM — Neukunde`);
                }
            } catch(e) {
                console.error('CRM-Suche für Audio-Telefon fehlgeschlagen:', e.message);
            }
        }

        // Transkript + Anrufer-Info anzeigen
        let transcriptMsg = `🎙️ <b>Transkript aus "${fileName}":</b>\n<i>"${transcript}"</i>`;
        if (callerCustomer) {
            const kindLabel = callerCustomer.customerKind === 'hotel' ? '🏨 Hotel/Pension' : (callerCustomer.type === 'supplier' ? '🚚 Lieferant' : (callerCustomer.customerKind === 'auftraggeber' ? '🏢 Auftraggeber' : (callerCustomer.customerKind === 'gelegenheitskunde' ? '🧳 Gelegenheitskunde' : '🏠 Stammkunde')));
            transcriptMsg += `\n\n👤 <b>Anrufer erkannt:</b> ${callerCustomer.name}`;
            transcriptMsg += `\n${kindLabel}`;
            if (callerCustomer.mobilePhone || callerCustomer.phone) transcriptMsg += `\n📱 ${callerCustomer.mobilePhone || callerCustomer.phone}`;
            if (callerCustomer.address) transcriptMsg += `\n${callerCustomer.type === 'supplier' ? '🚚' : (isAuftraggeber(callerCustomer.customerKind, callerCustomer.type) ? '🏢' : (callerCustomer.customerKind === 'gelegenheitskunde' ? '📍' : '🏠'))} ${callerCustomer.address}`;
        } else if (callerPhone) {
            transcriptMsg += `\n\n📞 <b>Anrufer:</b> ${callerPhone} (nicht im CRM)`;
        }
        transcriptMsg += '\n\n⏳ Wird verarbeitet...';
        await sendTelegramMessage(chatId, transcriptMsg);

        // Als normale Textnachricht weiterverarbeiten
        const fakeMessage = {
            ...message,
            text: transcript,
            _isVoiceTranscript: true,
            _isAudioFile: true,
            _callerPhone: callerPhone,
            _callerCustomer: callerCustomer
        };
        await handleMessage(fakeMessage);

    } catch (error) {
        console.error('handleAudioFile Fehler:', error);
        await addTelegramLog('❌', chatId, `Audio-Datei Fehler: ${error.message}`);
        await sendTelegramMessage(chatId, '⚠️ Fehler bei der Audio-Verarbeitung: ' + error.message);
    }
}

async function handleLocation(message) {
    const chatId = message.chat.id;
    const lat = message.location.latitude;
    const lon = message.location.longitude;
    const userName = message.from?.first_name || 'Unbekannt';

    await addTelegramLog('📍', chatId, `GPS-Standort empfangen: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);

    // Reverse-Geocoding: Koordinaten → Adresse
    let addressName = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const reversed = await reverseGeocode(lat, lon);
    if (reversed && reversed.name) {
        addressName = reversed.name;
        await addTelegramLog('📍', chatId, `Reverse-Geocoding: ${addressName}`);
    }

    // 🆕 v6.11.5: Prüfe ob Neukunden-Adress-Schritt aktiv → Standort als Kundenadresse übernehmen
    const pending = await getPending(chatId);
    if (pending && pending._adminNewCust && (pending._adminNewCustStep === 'address' || pending._adminNewCustStep === 'address_select')) {
        await addTelegramLog('📍', chatId, `GPS-Standort als Kundenadresse übernommen: ${addressName}`);
        // Wie Adresseingabe behandeln → Vorschläge zeigen mit dieser Adresse
        const suggestions = await searchNominatimForTelegram(addressName);
        const confirmId = Date.now().toString(36);

        if (suggestions.length > 0) {
            const keyboard = suggestions.map((s, i) => [{ text: `${s.source === 'poi' || s.source === 'known' ? '⭐' : s.source === 'customer' ? '👤' : s.source === 'booking' ? '🔁' : '📍'} ${s.name}`, callback_data: `admin_newcust_adr_${i}_${confirmId}` }]);
            keyboard.push([{ text: `📝 GPS-Adresse verwenden: ${addressName.length > 30 ? addressName.slice(0, 28) + '…' : addressName}`, callback_data: `admin_newcust_addr_raw_${confirmId}` }]);
            keyboard.push([{ text: '✏️ Andere Adresse eingeben', callback_data: `admin_newcust_addr_retry_${confirmId}` }]);

            await setPending(chatId, {
                ...pending,
                _adminNewCustStep: 'address_select',
                _adminNewCustAddr: addressName,
                _adminNewCustAddrLat: lat,
                _adminNewCustAddrLon: lon,
                _adminNewCustSuggestions: suggestions,
                _addrConfirmId: confirmId
            });
            await sendTelegramMessage(chatId,
                `📍 <b>GPS-Standort erkannt:</b>\n🏠 ${addressName}\n\nBitte wähle die richtige Adresse:`, {
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await setPending(chatId, {
                ...pending,
                _adminNewCustStep: 'customerKind',
                _adminNewCustAddr: addressName,
                _adminNewCustAddrLat: lat,
                _adminNewCustAddrLon: lon
            });
            await sendTelegramMessage(chatId,
                `🏷️ <b>Kundenart festlegen</b>\n\n👤 <b>${pending._adminNewCustName}</b>\n📍 ${addressName}\n\nIst das die <b>Wohnanschrift</b> oder nur eine <b>Abholadresse</b>?`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '🏠 Wohnanschrift (Stammkunde)', callback_data: 'admin_newcust_kind_stamm' }],
                    [{ text: '📍 Nur Abholadresse (Gelegenheitskunde)', callback_data: 'admin_newcust_kind_gelegenheit' }]
                ] }
            });
        }
        return;
    }

    // 🔧 v6.15.8: Laufende Buchung → prüfe was fehlt
    if (pending) {
        const booking = pending.booking || pending.partial;
        if (booking) {
            const missingPickup = !booking.pickup || (booking.missing && booking.missing.includes('pickup'));
            const missingDest = !booking.destination || (booking.missing && booking.missing.includes('destination'));

            // Nur Abholort fehlt → direkt als Abholort setzen
            if (missingPickup && !missingDest) {
                booking.pickup = addressName;
                booking.pickupLat = lat;
                booking.pickupLon = lon;
                if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'pickup');
                await sendTelegramMessage(chatId, `📍 <b>Abholort per GPS gesetzt:</b>\n🏠 ${addressName}`);
                await continueBookingFlow(chatId, booking, pending.originalText || '');
                return;
            }

            // Nur Zielort fehlt → direkt als Zielort setzen
            if (!missingPickup && missingDest) {
                booking.destination = addressName;
                booking.destinationLat = lat;
                booking.destinationLon = lon;
                if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'destination');
                await sendTelegramMessage(chatId, `📍 <b>Zielort per GPS gesetzt:</b>\n🎯 ${addressName}`);
                await continueBookingFlow(chatId, booking, pending.originalText || '');
                return;
            }

            // Beides fehlt oder beides schon da → Fragen: Abholort oder Zielort?
            await setPending(chatId, {
                ...pending,
                _gpsChoice: { addressName, lat, lon }
            });
            await sendTelegramMessage(chatId,
                `📍 <b>Standort empfangen:</b>\n🏠 ${addressName}\n\n❓ <b>Ist das der Abholort oder der Zielort?</b>`, {
                reply_markup: { inline_keyboard: [
                    [{ text: '📍 Abholort', callback_data: 'gps_set_pickup' }, { text: '🎯 Zielort', callback_data: 'gps_set_dest' }],
                    [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
                ] }
            });
            return;
        }
    }

    // 🔧 v6.16.1: Neukunden-Anlage aktiv → GPS als Kundenadresse behandeln (Race-Condition-Schutz)
    // Erneuter Check nötig, weil pending sich zwischen erstem Check und hier geändert haben kann
    const pendingRecheck = await getPending(chatId);
    if (pendingRecheck && pendingRecheck._adminNewCust && (pendingRecheck._adminNewCustStep === 'address' || pendingRecheck._adminNewCustStep === 'address_select')) {
        await addTelegramLog('📍', chatId, `GPS-Standort als Kundenadresse übernommen (Recheck): ${addressName}`);
        const confirmId = Date.now().toString(36);
        await setPending(chatId, {
            ...pendingRecheck,
            _adminNewCustStep: 'customerKind',
            _adminNewCustAddr: addressName,
            _adminNewCustAddrLat: lat,
            _adminNewCustAddrLon: lon
        });
        await sendTelegramMessage(chatId,
            `🏷️ <b>Kundenart festlegen</b>\n\n👤 <b>${pendingRecheck._adminNewCustName}</b>\n📍 ${addressName}\n\nIst das die <b>Wohnanschrift</b> oder nur eine <b>Abholadresse</b>?`, {
            reply_markup: { inline_keyboard: [
                [{ text: '🏠 Wohnanschrift (Stammkunde)', callback_data: 'admin_newcust_kind_stamm' }],
                [{ text: '📍 Nur Abholadresse (Gelegenheitskunde)', callback_data: 'admin_newcust_kind_gelegenheit' }],
                [{ text: '🏨 Hotel/Pension', callback_data: 'admin_newcust_kind_hotel' }],
                [{ text: '🏢 Auftraggeber/Firma', callback_data: 'admin_newcust_kind_auftraggeber' }]
            ] }
        });
        return;
    }

    // 🔧 v6.15.8: Kein laufender Buchungsvorgang → Fragen ob Abhol- oder Zielort
    const customer = await getTelegramCustomer(chatId);
    const newBooking = {
        missing: ['pickup', 'destination', 'datetime'],
        intent: 'buchung'
    };
    if (customer) {
        newBooking.name = customer.name;
        newBooking.phone = customer.mobile || customer.phone || '';
    }

    await setPending(chatId, {
        partial: newBooking,
        originalText: `GPS: ${addressName}`,
        _gpsChoice: { addressName, lat, lon }
    });
    await sendTelegramMessage(chatId,
        `📍 <b>Standort empfangen!</b>\n🏠 ${addressName}\n\n❓ <b>Ist das der Abholort oder der Zielort?</b>`, {
        reply_markup: { inline_keyboard: [
            [{ text: '📍 Abholort (hier abholen)', callback_data: 'gps_set_pickup' }, { text: '🎯 Zielort (dorthin fahren)', callback_data: 'gps_set_dest' }],
            [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
        ] }
    });
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOK ENTRY POINT
// ═══════════════════════════════════════════════════════════════

exports.telegramWebhook = onRequest(
    { region: 'europe-west1', timeoutSeconds: 120, memory: '256MiB', minInstances: 1, invoker: 'public' },
    async (req, res) => {
        // Nur POST akzeptieren
        if (req.method !== 'POST') {
            res.status(200).send('Funk Taxi Heringsdorf Telegram Bot - Webhook aktiv');
            return;
        }

        // Telegram-Webhook-Secret validieren (X-Telegram-Bot-Api-Secret-Token)
        const webhookSecret = await ensureWebhookSecret();
        const incomingToken = req.headers['x-telegram-bot-api-secret-token'];
        if (!incomingToken || incomingToken !== webhookSecret) {
            console.warn('Webhook: ungültiges oder fehlendes Secret-Token – Anfrage abgelehnt');
            res.status(403).send('Forbidden');
            return;
        }

        // Tarif aus Firebase laden (einmalig pro Cold Start)
        await loadTarifFromFirebase();

        try {
            const update = req.body;

            // 🛡️ Spam-Schutz: chatId ermitteln
            const spamChatId = update.callback_query?.message?.chat?.id || update.message?.chat?.id;
            if (spamChatId) {
                // Zuerst prüfen ob in Firebase dauerhaft geblockt
                if (!spamTracker[spamChatId]?.permBlocked) {
                    try {
                        const blockSnap = await db.ref(`settings/telegram/blockedUsers/${spamChatId}`).once('value');
                        if (blockSnap.val()) {
                            if (!spamTracker[spamChatId]) spamTracker[spamChatId] = { timestamps: [], blocked: false, blockedUntil: 0, warned: false, strikes: 0, permBlocked: true };
                            else spamTracker[spamChatId].permBlocked = true;
                        }
                    } catch(e) {}
                }

                const spamStatus = checkSpam(spamChatId);
                if (spamStatus === 'permblocked' || spamStatus === 'blocked') {
                    // Still ignorieren – keine Antwort
                    res.status(200).send('OK');
                    return;
                }
                if (spamStatus === 'permblock_new') {
                    // Neuer permanenter Block → in Firebase speichern + Admin benachrichtigen
                    const userName = update.message?.from?.first_name || update.callback_query?.from?.first_name || 'Unbekannt';
                    await addTelegramLog('🚫', spamChatId, `PERMANENT GEBLOCKT – 3× Spam-Sperre (${userName})`);
                    await sendTelegramMessage(spamChatId,
                        '🚫 <b>Ihr Zugang wurde gesperrt.</b>\n\n' +
                        'Sie haben wiederholt zu viele Nachrichten gesendet.\n' +
                        'Bitte kontaktieren Sie uns telefonisch: <b>038378 / 22022</b>'
                    );
                    // In Firebase speichern (überlebt Cloud Function Restart)
                    try {
                        await db.ref(`settings/telegram/blockedUsers/${spamChatId}`).set({
                            blockedAt: Date.now(),
                            reason: '3x Spam-Sperre',
                            userName
                        });
                    } catch(e) {}
                    // Admins benachrichtigen
                    try {
                        await sendToAllAdmins(
                            `🚫 <b>Nutzer geblockt (Spam)</b>\n\n👤 ${userName}\n🆔 Chat-ID: <code>${spamChatId}</code>\n\n<i>3× Spam-Limit überschritten. Entblocken:\n/entblocken ${spamChatId}</i>`,
                            'spam_block'
                        );
                    } catch(e) {}
                    res.status(200).send('OK');
                    return;
                }
                if (spamStatus === 'spam') {
                    const tracker = spamTracker[spamChatId];
                    const remaining = SPAM_MAX_STRIKES - (tracker?.strikes || 0);
                    await addTelegramLog('🛡️', spamChatId, `SPAM erkannt – 3 Min Sperre (Strike ${tracker?.strikes || '?'}/${SPAM_MAX_STRIKES})`);
                    await sendTelegramMessage(spamChatId,
                        '⚠️ <b>Zu viele Nachrichten!</b>\n\n' +
                        'Bitte warten Sie einen Moment, bevor Sie weitere Nachrichten senden.\n' +
                        `<i>Sperre wird in 3 Minuten aufgehoben.</i>\n\n` +
                        (remaining > 0 ? `⚠️ <b>Warnung:</b> Nach ${remaining} weiteren Sperre(n) wird Ihr Zugang dauerhaft gesperrt.` : '')
                    );
                    res.status(200).send('OK');
                    return;
                }
                if (spamStatus === 'warning') {
                    await sendTelegramMessage(spamChatId,
                        '⏳ <i>Bitte etwas langsamer – ich bearbeite Ihre Anfragen nacheinander.</i>'
                    );
                }
            }

            if (update.callback_query) {
                await handleCallback(update.callback_query);
            } else if (update.message) {
                if (update.message.contact) {
                    await handleContact(update.message);
                } else if (update.message.location) {
                    await handleLocation(update.message);
                } else if (update.message.voice) {
                    // 🆕 v6.11.3: Sprachnachrichten transkribieren
                    await handleVoice(update.message);
                } else if (update.message.audio) {
                    // 🆕 v6.14.0: Audio-Dateien (MP3 etc.) transkribieren
                    await handleAudioFile(update.message);
                } else if (update.message.document && isAudioDocument(update.message.document)) {
                    // 🆕 v6.14.0: Dokumente die Audio sind (WAV, M4A, OGG etc.)
                    await handleAudioFile(update.message);
                } else if (update.message.web_app_data) {
                    // 🆕 v6.16.2: Daten aus Telegram Web App (Datetime-Picker etc.)
                    await handleWebAppData(update.message);
                } else if (update.message.text) {
                    await handleMessage(update.message);
                }
            }
        } catch (err) {
            console.error('Webhook-Fehler:', err);
        }

        // Immer 200 zurückgeben (sonst wiederholt Telegram den Request)
        res.status(200).send('OK');
    }
);

// ═══════════════════════════════════════════════════════════════
// WEBHOOK SETUP HELPER (einmalig aufrufen per HTTP GET)
// ═══════════════════════════════════════════════════════════════

exports.setupWebhook = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        const token = await loadBotToken();
        if (!token) {
            res.status(500).send('Kein Bot-Token in Firebase!');
            return;
        }

        // Webhook-URL = die URL dieser Cloud Function
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'taxi-heringsdorf';
        const webhookUrl = `https://europe-west1-${projectId}.cloudfunctions.net/telegramWebhook`;

        // Secret automatisch generieren falls noch keins existiert
        const webhookSecret = await ensureWebhookSecret();

        try {
            const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: webhookUrl,
                    allowed_updates: ['message', 'callback_query'],
                    drop_pending_updates: false,
                    secret_token: webhookSecret
                })
            });
            const data = await resp.json();

            if (data.ok) {
                // Webhook-Status in Firebase speichern
                await db.ref('settings/telegram/webhookActive').set(true);
                await db.ref('settings/telegram/webhookUrl').set(webhookUrl);
                await db.ref('settings/telegram/webhookSetAt').set(Date.now());
                await addTelegramLog('🌐', 'system', `Webhook aktiviert: ${webhookUrl}`);
                res.status(200).send(`✅ Webhook gesetzt!\n\nURL: ${webhookUrl}\n\nDer Bot antwortet jetzt 24/7 – auch ohne offenen Browser!`);
            } else {
                res.status(500).send(`❌ Webhook-Fehler: ${data.description}`);
            }
        } catch (e) {
            res.status(500).send(`❌ Fehler: ${e.message}`);
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// WEBHOOK DEAKTIVIEREN (zurück zu Browser-Polling)
// ═══════════════════════════════════════════════════════════════

exports.removeWebhook = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        const token = await loadBotToken();
        if (!token) { res.status(500).send('Kein Bot-Token!'); return; }

        try {
            const resp = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
            const data = await resp.json();
            await db.ref('settings/telegram/webhookActive').set(false);
            await addTelegramLog('🌐', 'system', 'Webhook deaktiviert → Browser-Polling');
            res.status(200).send(data.ok ? '✅ Webhook entfernt. Browser-Polling kann wieder starten.' : `❌ ${data.description}`);
        } catch (e) {
            res.status(500).send(`❌ Fehler: ${e.message}`);
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 🆕 v6.16.0: BOT-BEFEHLE REGISTRIEREN (setMyCommands)
// Registriert /menu als ersten Befehl im Telegram-Menü
// ═══════════════════════════════════════════════════════════════

exports.setupBotCommands = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        const token = await loadBotToken();
        if (!token) { res.status(500).send('Kein Bot-Token!'); return; }

        try {
            const commands = [
                { command: 'menu', description: '🏠 Hauptmenü mit allen Funktionen' },
                { command: 'buchen', description: '🚕 Neue Fahrt buchen' },
                { command: 'status', description: '📊 Meine heutigen Fahrten' },
                { command: 'hilfe', description: 'ℹ️ Hilfe & Übersicht' },
                { command: 'abbrechen', description: '❌ Aktuelle Buchung abbrechen' },
                { command: 'profil', description: '👤 Mein Profil' },
                { command: 'abmelden', description: '🔓 Konto abmelden & Daten löschen' },
                { command: 'start', description: '👋 Bot neu starten' }
            ];

            const resp = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commands })
            });
            const data = await resp.json();
            await addTelegramLog('📋', 'system', 'Bot-Befehle registriert (setMyCommands)');
            res.status(200).send(data.ok ? '✅ Bot-Befehle registriert! /menu ist jetzt im Telegram-Menü.' : `❌ ${data.description}`);
        } catch (e) {
            res.status(500).send(`❌ Fehler: ${e.message}`);
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 🆕 v6.16.2: AUTOMATISCHE KONFLIKT-ERKENNUNG & UMPLANUNG
// Läuft alle 5 Minuten server-seitig — kein Browser nötig!
// Erkennt Zeitkonflikte (gleiches Fahrzeug, überlappende Zeiten)
// und plant automatisch auf ein freies Fahrzeug um.
// ═══════════════════════════════════════════════════════════════

exports.autoResolveConflicts = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '256MiB'
    },
    async (event) => {
        console.log('🔄 Auto-Konflikt-Prüfung gestartet...');

        try {
            // Daten laden
            const [ridesSnap, shiftsSnap, settingsSnap] = await Promise.all([
                db.ref('rides').once('value'),
                db.ref('vehicleShifts').once('value'),
                db.ref('settings/pricing').once('value')
            ]);

            const shiftsData = shiftsSnap.val() || {};
            const pricingSettings = settingsSnap.val() || {};
            const vorlaufMin = pricingSettings.autoOptimierungVorlaufMinuten || 60;
            const boardingTime = pricingSettings.boardingTime || 3;
            const alightingTime = pricingSettings.alightingTime || 2;
            const bufferMs = (boardingTime + alightingTime) * 60000;

            // Alle aktiven zukünftigen Fahrten sammeln
            const now = Date.now();
            const allRides = [];
            ridesSnap.forEach(c => {
                const r = { ...c.val(), firebaseId: c.key };
                if (r.pickupTimestamp &&
                    r.pickupTimestamp > now + vorlaufMin * 60000 &&
                    !['deleted','cancelled','storniert','cancelled_pending_driver','completed'].includes(r.status) &&
                    !r.assignmentLocked &&
                    r.assignedVehicle) {
                    allRides.push(r);
                }
            });

            if (allRides.length === 0) {
                console.log('✅ Keine relevanten Fahrten gefunden');
                return;
            }

            // Berlin-Zeitzone für Datum
            const berlinDate = (ts) => {
                const d = new Date(ts);
                return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); // YYYY-MM-DD
            };
            const berlinTime = (ts) => {
                const d = new Date(ts);
                return d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
            };

            // ═══════════════════════════════════════════════════════════
            // 🚀 v6.26.0: PHASE 0 — SCHICHT-VALIDIERUNG
            // Fahrten auf Fahrzeugen ohne Dienst → sofort umplanen
            // ═══════════════════════════════════════════════════════════
            let totalShiftFixes = 0;

            for (const ride of allRides) {
                if (['accepted', 'picked_up', 'on_way'].includes(ride.status)) continue;
                const rideDateStr = berlinDate(ride.pickupTimestamp);
                const rideTimeStr = berlinTime(ride.pickupTimestamp);

                if (isVehicleInShift(ride.assignedVehicle, shiftsData, rideDateStr, rideTimeStr)) continue;

                // Fahrzeug hat keinen Dienst → Alternative suchen
                const currInfo = OFFICIAL_VEHICLES[ride.assignedVehicle] || {};
                console.warn(`📅 SCHICHT-PROBLEM: ${ride.customerName || '?'} (${rideTimeStr}) auf ${currInfo.name} — kein Dienst am ${rideDateStr}!`);

                const altVehicle = findAlternativeVehicle(
                    ride, ride.assignedVehicle, allRides, shiftsData, rideDateStr, pricingSettings
                );

                if (!altVehicle) {
                    console.warn(`   ❌ Kein alternatives Fahrzeug im Dienst für ${ride.firebaseId}`);
                    continue;
                }

                const altInfo = OFFICIAL_VEHICLES[altVehicle] || {};
                console.log(`   ✅ Schicht-Korrektur: ${ride.firebaseId} → ${altInfo.name}`);

                await db.ref(`rides/${ride.firebaseId}`).update({
                    assignedVehicle: altVehicle,
                    vehicleId: altVehicle,
                    vehicle: altInfo.name || altVehicle,
                    vehicleLabel: altInfo.name || altVehicle,
                    vehiclePlate: altInfo.plate || '',
                    assignedVehicleName: altInfo.name || altVehicle,
                    assignedVehiclePlate: altInfo.plate || '',
                    assignedBy: 'cloud-auto-replan',
                    assignedAt: Date.now(),
                    updatedAt: Date.now(),
                    replanReason: `Schicht-Korrektur: ${currInfo.name} hat keinen Dienst am ${rideDateStr} um ${rideTimeStr}`
                });

                ride.assignedVehicle = altVehicle;
                totalShiftFixes++;

                try {
                    await db.ref('optimierungsLog').push({
                        timestamp: Date.now(),
                        type: 'cloud-replan-schicht',
                        rideId: ride.firebaseId,
                        vonVehicle: currInfo.name || ride.assignedVehicle,
                        zuVehicle: altInfo.name || altVehicle,
                        kunde: ride.customerName || '',
                        uhrzeit: rideTimeStr,
                        datum: rideDateStr,
                        grund: `Kein Dienst: ${currInfo.name}`
                    });
                } catch(e) { /* non-critical */ }

                try {
                    const msg = `📅 *Schicht-Korrektur*\n📋 ${ride.customerName || '?'} • ${rideTimeStr}\n🔄 ${currInfo.name} (kein Dienst) → ${altInfo.name}`;
                    await sendToAllAdmins(msg, 'optimization');
                } catch(e) { /* non-critical */ }
            }

            console.log(`✅ Phase 0 (Schicht): ${totalShiftFixes} Korrektur(en)`);

            // ═══════════════════════════════════════════════════════════
            // PHASE 1 — ZEITKONFLIKT-AUFLÖSUNG (bestehend)
            // ═══════════════════════════════════════════════════════════

            // Nach Fahrzeug + Datum gruppieren
            const byVehicleDate = {};
            for (const r of allRides) {
                const dateStr = berlinDate(r.pickupTimestamp);
                const key = `${r.assignedVehicle}|${dateStr}`;
                if (!byVehicleDate[key]) byVehicleDate[key] = [];
                byVehicleDate[key].push(r);
            }

            let totalReplanned = 0;

            for (const [key, vehicleRides] of Object.entries(byVehicleDate)) {
                if (vehicleRides.length < 2) continue;

                const [vehicleId, dateStr] = key.split('|');
                vehicleRides.sort((a, b) => a.pickupTimestamp - b.pickupTimestamp);

                // Prüfe jedes aufeinanderfolgende Paar
                for (let i = 0; i < vehicleRides.length - 1; i++) {
                    const curr = vehicleRides[i];
                    const next = vehicleRides[i + 1];

                    // Fahrtdauer + Puffer
                    const currDurMs = (curr.duration || curr.estimatedDuration || 20) * 60000;
                    const currEndMs = curr.pickupTimestamp + currDurMs + bufferMs;
                    const nextStartMs = next.pickupTimestamp;

                    // Gibt es Überlappung?
                    if (currEndMs <= nextStartMs) continue; // Kein Konflikt

                    const overlapMin = Math.round((currEndMs - nextStartMs) / 60000);
                    const currTime = berlinTime(curr.pickupTimestamp);
                    const nextTime = berlinTime(next.pickupTimestamp);
                    const vName = OFFICIAL_VEHICLES[vehicleId]?.name || vehicleId;

                    console.warn(`⚠️ KONFLIKT auf ${vName}: ${currTime} (${curr.customerName || '?'}) und ${nextTime} (${next.customerName || '?'}) überlappen um ${overlapMin} Min`);

                    // Nicht umplanen wenn Fahrer bereits akzeptiert
                    if (['accepted', 'picked_up', 'on_way'].includes(next.status)) {
                        console.log(`   🚗 ${next.firebaseId}: Status "${next.status}" → keine Umplanung`);
                        continue;
                    }

                    // Alternatives Fahrzeug suchen
                    const altVehicle = findAlternativeVehicle(
                        next, vehicleId, allRides, shiftsData, dateStr, pricingSettings
                    );

                    if (!altVehicle) {
                        console.warn(`   ❌ Kein alternatives Fahrzeug für ${next.firebaseId}`);
                        continue;
                    }

                    const altInfo = OFFICIAL_VEHICLES[altVehicle] || {};
                    console.log(`   ✅ Umplanung: ${next.firebaseId} → ${altInfo.name || altVehicle}`);

                    // In Firebase aktualisieren
                    await db.ref(`rides/${next.firebaseId}`).update({
                        assignedVehicle: altVehicle,
                        vehicleId: altVehicle,
                        vehicle: altInfo.name || altVehicle,
                        vehicleLabel: altInfo.name || altVehicle,
                        vehiclePlate: altInfo.plate || '',
                        assignedVehicleName: altInfo.name || altVehicle,
                        assignedVehiclePlate: altInfo.plate || '',
                        assignedBy: 'cloud-auto-replan',
                        assignedAt: Date.now(),
                        updatedAt: Date.now(),
                        replanReason: `Zeitkonflikt: ${overlapMin} Min Überlappung mit ${curr.customerName || '?'} (${currTime}) auf ${vName}`
                    });

                    // Lokales Array aktualisieren (für nächste Paare)
                    next.assignedVehicle = altVehicle;
                    totalReplanned++;

                    // Log in Firebase für Transparenz
                    try {
                        await db.ref('optimierungsLog').push({
                            timestamp: Date.now(),
                            type: 'cloud-replan',
                            rideId: next.firebaseId,
                            vonVehicle: vName,
                            zuVehicle: altInfo.name || altVehicle,
                            overlapMin,
                            kunde: next.customerName || '',
                            abholung: (next.pickup || '').substring(0, 50),
                            ziel: (next.destination || '').substring(0, 50),
                            uhrzeit: nextTime,
                            datum: dateStr,
                            grund: `Zeitkonflikt ${overlapMin} Min`
                        });
                    } catch(e) { /* non-critical */ }

                    // 🔧 v6.30.1: Telegram-Benachrichtigung für Konflikt-Umplanung
                    try {
                        const msg = `⚠️ *Zeitkonflikt-Umplanung*\n📋 ${next.customerName || '?'} • ${nextTime}\n🔄 ${vName} → ${altInfo.name || altVehicle}\n📌 ${overlapMin} Min Überlappung mit ${curr.customerName || '?'} (${currTime})`;
                        await sendToAllAdmins(msg, 'optimization');
                    } catch(e) { /* non-critical */ }
                }
            }

            console.log(`✅ Phase 1 (Konflikte) abgeschlossen: ${totalReplanned} Umplanung(en)`);

            // ═══════════════════════════════════════════════════════════
            // 🚀 v6.26.0: PHASE 2 — LEERFAHRT-OPTIMIERUNG
            // Zentrale Umplanung: Fahrzeug mit kürzerer Anfahrt bevorzugen
            // ═══════════════════════════════════════════════════════════

            const minLeerfahrtVorteilMin = pricingSettings.optimierungMinVorteilMinuten || 10;
            const vehiclesSnap = await db.ref('vehicles').once('value');
            const vehiclesData = vehiclesSnap.val() || {};
            let totalOptimized = 0;

            // Alle offenen, nicht akzeptierten Fahrten mit Koordinaten
            const optimizableRides = allRides.filter(r =>
                r.assignedVehicle &&
                !r.assignmentLocked &&
                !['accepted', 'picked_up', 'on_way', 'completed', 'deleted', 'cancelled', 'storniert'].includes(r.status) &&
                r.pickupTimestamp > now + vorlaufMin * 60000 &&
                (r.pickupCoords || (r.pickupLat && r.pickupLon))
            );

            console.log(`🚀 Phase 2 (Optimierung): ${optimizableRides.length} Fahrten prüfen (Mindest-Vorteil: ${minLeerfahrtVorteilMin} Min)...`);

            for (const ride of optimizableRides) {
                const currentVehicle = ride.assignedVehicle;
                const pickupLat = ride.pickupCoords?.lat || ride.pickupLat;
                const pickupLon = ride.pickupCoords?.lon || ride.pickupLon;
                if (!pickupLat || !pickupLon) continue;

                const dateStr = berlinDate(ride.pickupTimestamp);
                const timeStr = berlinTime(ride.pickupTimestamp);

                // 🔧 v6.25.4: Smart Routing via OSRM — echte Fahrzeiten statt Luftlinie
                const currentResult = await estimateVehicleLeerfahrt(
                    currentVehicle, ride, allRides, vehiclesData, shiftsData, dateStr, pricingSettings
                );
                const currentMin = currentResult.durationMin;
                const currentKm = currentResult.distKm;

                // Beste Alternative suchen
                let bestAlt = null;
                let bestMin = currentMin;
                let bestKm = currentKm;
                let bestMethod = currentResult.method;

                const candidates = Object.entries(OFFICIAL_VEHICLES)
                    .filter(([vid]) => vid !== currentVehicle)
                    .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));

                for (const [vehicleId, vInfo] of candidates) {
                    // Kapazität
                    if ((vInfo.capacity || 4) < (ride.passengers || 1)) continue;
                    // Schichtplan
                    if (!isVehicleInShift(vehicleId, shiftsData, dateStr, timeStr)) continue;

                    // Zeitkonflikt prüfen
                    const rideDurMs = (ride.duration || ride.estimatedDuration || 20) * 60000;
                    const hasConflict = allRides.some(r => {
                        if (r.firebaseId === ride.firebaseId) return false;
                        if (r.assignedVehicle !== vehicleId) return false;
                        if (!r.pickupTimestamp) return false;
                        if (['deleted','cancelled','storniert','completed'].includes(r.status)) return false;
                        const rDurMs = (r.duration || r.estimatedDuration || 20) * 60000;
                        const rEnd = r.pickupTimestamp + rDurMs + bufferMs;
                        const newEnd = ride.pickupTimestamp + rideDurMs + bufferMs;
                        return (ride.pickupTimestamp < rEnd) && (r.pickupTimestamp < newEnd);
                    });
                    if (hasConflict) continue;

                    // Leerfahrt für Alternative berechnen (OSRM Smart Routing)
                    const altResult = await estimateVehicleLeerfahrt(
                        vehicleId, ride, allRides, vehiclesData, shiftsData, dateStr, pricingSettings
                    );

                    if (altResult.durationMin < bestMin) {
                        bestMin = altResult.durationMin;
                        bestKm = altResult.distKm;
                        bestMethod = altResult.method;
                        bestAlt = vehicleId;
                    }
                }

                if (!bestAlt) continue;

                // Vorteil direkt in Minuten (OSRM liefert echte Fahrzeiten)
                const vorteilMin = Math.round(currentMin - bestMin);

                if (vorteilMin < minLeerfahrtVorteilMin) continue;

                const altInfo = OFFICIAL_VEHICLES[bestAlt] || {};
                const currInfo = OFFICIAL_VEHICLES[currentVehicle] || {};
                const rideTime = berlinTime(ride.pickupTimestamp);

                console.log(`   🚀 OPTIMIERUNG: ${ride.customerName || '?'} (${rideTime}) | ${currInfo.name} (${currentKm} km, ${currentMin} Min, ${currentResult.method}) → ${altInfo.name} (${bestKm} km, ${bestMin} Min, ${bestMethod}) | Vorteil: ${vorteilMin} Min`);

                // Umplanen in Firebase
                await db.ref(`rides/${ride.firebaseId}`).update({
                    assignedVehicle: bestAlt,
                    vehicleId: bestAlt,
                    vehicle: altInfo.name || bestAlt,
                    vehicleLabel: altInfo.name || bestAlt,
                    vehiclePlate: altInfo.plate || '',
                    assignedVehicleName: altInfo.name || bestAlt,
                    assignedVehiclePlate: altInfo.plate || '',
                    assignedBy: 'cloud-auto-optimize',
                    assignedAt: Date.now(),
                    updatedAt: Date.now(),
                    replanReason: `Smart-Routing: ${currInfo.name} (${currentKm} km, ${currentMin} Min) → ${altInfo.name} (${bestKm} km, ${bestMin} Min), ${vorteilMin} Min kürzer`
                });

                // Lokales Array aktualisieren
                ride.assignedVehicle = bestAlt;
                totalOptimized++;

                // Log
                try {
                    await db.ref('optimierungsLog').push({
                        timestamp: Date.now(),
                        type: 'cloud-optimize-leerfahrt',
                        rideId: ride.firebaseId,
                        vonVehicle: currInfo.name || currentVehicle,
                        zuVehicle: altInfo.name || bestAlt,
                        vonDistanzKm: currentKm,
                        zuDistanzKm: bestKm,
                        vonDauerMin: currentMin,
                        zuDauerMin: bestMin,
                        vonMethod: currentResult.method,
                        zuMethod: bestMethod,
                        vorteilMin,
                        kunde: ride.customerName || '',
                        abholung: (ride.pickup || '').substring(0, 50),
                        ziel: (ride.destination || '').substring(0, 50),
                        uhrzeit: rideTime,
                        datum: dateStr,
                        grund: `Smart-Routing: ${vorteilMin} Min kürzer`
                    });
                } catch(e) { /* non-critical */ }

                // Telegram an Admins
                try {
                    const msg = `🚀 *Optimierung*\n📋 ${ride.customerName || '?'} • ${rideTime}\n🔄 ${currInfo.name} → ${altInfo.name}\n📍 Anfahrt: ${currentKm} km/${currentMin} Min → ${bestKm} km/${bestMin} Min (${vorteilMin} Min kürzer)`;
                    await sendToAllAdmins(msg, 'optimization');
                } catch(e) { /* non-critical */ }
            }

            console.log(`✅ Auto-Optimierung abgeschlossen: ${totalReplanned} Konflikt-Umplanung(en), ${totalOptimized} Leerfahrt-Optimierung(en)`);

        } catch (e) {
            console.error('❌ Auto-Konflikt-Prüfung/Optimierung Fehler:', e.message);
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 🔧 v6.25.4: Homebase aus Schichtplan ermitteln (wie getVehicleHomeForTime in index.html)
// Unterstützt: Split-Schicht (timeRanges), Tagesausnahmen, defaultTimes
function getVehicleHomeCoords(vehicleId, shiftsData, dateStr, timeStr) {
    const vShift = shiftsData[vehicleId];
    if (!vShift) return null;

    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const dayEntry = vShift[dateStr];
    const defTimes = vShift.defaultTimes || {};

    // 1. Tagesausnahme mit timeRanges (Split-Schicht)
    if (dayEntry && dayEntry.timeRanges && dayEntry.timeRanges.length > 1) {
        for (const range of dayEntry.timeRanges) {
            if (timeStr >= range.startTime && timeStr <= range.endTime && range.homeCoords?.lat) {
                return range.homeCoords;
            }
        }
    }
    // 2. Tagesausnahme direkt
    if (dayEntry && dayEntry.homeCoords?.lat) return dayEntry.homeCoords;
    // 3. defaultTimes mit timeRanges (Split-Schicht)
    if (defTimes[dow] && defTimes[dow].timeRanges && defTimes[dow].timeRanges.length > 1) {
        for (const range of defTimes[dow].timeRanges) {
            if (timeStr >= range.startTime && timeStr <= range.endTime && range.homeCoords?.lat) {
                return range.homeCoords;
            }
        }
    }
    // 4. defaultTimes direkt
    if (defTimes[dow] && defTimes[dow].homeCoords?.lat) return defTimes[dow].homeCoords;

    return null;
}

// 🔧 v6.25.4: Smart Routing Leerfahrt-Schätzung via OSRM
// Logik übernommen von autoAssignVehicleToRide + Smart Routing (index.html)
// Berechnet die ECHTE Fahrzeit (Minuten) vom wahrscheinlichen Standort zum Abholort
// Smart Routing: Vergleicht Direkt-Route vs. über-Homebase und nimmt die kürzere
// ═══════════════════════════════════════════════════════════════
async function estimateVehicleLeerfahrt(vehicleId, targetRide, allRides, vehiclesData, shiftsData, dateStr, pricingSettings) {
    const pickupLat = targetRide.pickupCoords?.lat || targetRide.pickupLat;
    const pickupLon = targetRide.pickupCoords?.lon || targetRide.pickupLon;
    if (!pickupLat || !pickupLon) return { durationMin: 999, distKm: 999, method: 'no-coords' };

    const returnBufferMin = (pricingSettings && pricingSettings.standortRueckkehrPufferMinuten != null)
        ? pricingSettings.standortRueckkehrPufferMinuten : 30;

    // Abholzeit als HH:MM für Schichtplan-Lookup
    const pickupDate = new Date(targetRide.pickupTimestamp);
    const month = pickupDate.getUTCMonth() + 1;
    const isSummer = month >= 4 && month <= 10;
    const berlinHour = (pickupDate.getUTCHours() + (isSummer ? 2 : 1)) % 24;
    const timeStr = String(berlinHour).padStart(2, '0') + ':' + String(pickupDate.getUTCMinutes()).padStart(2, '0');

    // Homebase aus Schichtplan
    const homeCoords = getVehicleHomeCoords(vehicleId, shiftsData, dateStr, timeStr);
    const homeLat = homeCoords?.lat || null;
    const homeLon = homeCoords?.lon || null;

    // Vorherige Fahrt auf diesem Fahrzeug AM SELBEN TAG suchen
    const vehicleRides = allRides.filter(r => {
        if (r.assignedVehicle !== vehicleId) return false;
        if (r.firebaseId === targetRide.firebaseId) return false;
        if (!r.pickupTimestamp || r.pickupTimestamp >= targetRide.pickupTimestamp) return false;
        if (['deleted','cancelled','storniert','cancelled_pending_driver'].includes(r.status)) return false;
        // Nur Fahrten desselben Tages
        const rDateStr = berlinDate(r.pickupTimestamp);
        return rDateStr === dateStr;
    }).sort((a, b) => b.pickupTimestamp - a.pickupTimestamp);

    // Keine Vorfahrt am selben Tag → Homebase oder GPS
    if (vehicleRides.length === 0) {
        if (homeLat && homeLon) {
            const route = await calculateRoute({ lat: homeLat, lon: homeLon }, { lat: pickupLat, lon: pickupLon });
            if (route) return { durationMin: route.duration, distKm: parseFloat(route.distance), method: 'homebase' };
            return { durationMin: gpsDistanceKm(homeLat, homeLon, pickupLat, pickupLon) * 2, distKm: gpsDistanceKm(homeLat, homeLon, pickupLat, pickupLon), method: 'homebase-luftlinie' };
        }
        // GPS-Fallback
        const driver = vehiclesData[vehicleId];
        if (driver?.lat && driver?.lon) {
            const route = await calculateRoute({ lat: driver.lat, lon: driver.lon }, { lat: pickupLat, lon: pickupLon });
            if (route) return { durationMin: route.duration, distKm: parseFloat(route.distance), method: 'gps' };
        }
        return { durationMin: 50, distKm: 25, method: 'fallback' };
    }

    // Vorfahrt vorhanden → Smart Routing
    const prevRide = vehicleRides[0];
    const prevDurMs = (prevRide.duration || prevRide.estimatedDuration || 20) * 60000;
    const prevEndTs = prevRide.pickupTimestamp + prevDurMs;
    const gapMinutes = (targetRide.pickupTimestamp - prevEndTs) / 60000;

    const destLat = prevRide.destCoords?.lat || prevRide.destinationLat;
    const destLon = prevRide.destCoords?.lon || prevRide.destinationLon;

    // Kurze Pause → Fahrer noch unterwegs → Direktroute vom letzten Ziel
    if (gapMinutes < returnBufferMin) {
        if (destLat && destLon) {
            const route = await calculateRoute({ lat: destLat, lon: destLon }, { lat: pickupLat, lon: pickupLon });
            if (route) return { durationMin: route.duration, distKm: parseFloat(route.distance), method: 'direkt-kurze-pause' };
            return { durationMin: gpsDistanceKm(destLat, destLon, pickupLat, pickupLon) * 2, distKm: gpsDistanceKm(destLat, destLon, pickupLat, pickupLon), method: 'direkt-luftlinie' };
        }
        if (homeLat && homeLon) {
            const route = await calculateRoute({ lat: homeLat, lon: homeLon }, { lat: pickupLat, lon: pickupLon });
            if (route) return { durationMin: route.duration, distKm: parseFloat(route.distance), method: 'homebase-fallback' };
        }
        return { durationMin: 20, distKm: 10, method: 'schaetzwert' };
    }

    // Lange Pause → Smart Routing: Direkt vs. über Homebase, kürzere gewinnt
    // Route A: Direkt vom letzten Ziel → nächster Abholort
    let direktMin = Infinity, direktKm = 999;
    if (destLat && destLon) {
        const direktRoute = await calculateRoute({ lat: destLat, lon: destLon }, { lat: pickupLat, lon: pickupLon });
        if (direktRoute) {
            direktMin = direktRoute.duration;
            direktKm = parseFloat(direktRoute.distance);
        }
    }

    // Route B: Homebase → nächster Abholort
    let homebaseMin = Infinity, homebaseKm = 999;
    if (homeLat && homeLon) {
        const homeRoute = await calculateRoute({ lat: homeLat, lon: homeLon }, { lat: pickupLat, lon: pickupLon });
        if (homeRoute) {
            homebaseMin = homeRoute.duration;
            homebaseKm = parseFloat(homeRoute.distance);
        }
    }

    // Kürzere Route gewinnt (wie Smart Routing im Browser)
    if (homebaseMin <= direktMin && homebaseMin < Infinity) {
        return { durationMin: homebaseMin, distKm: homebaseKm, method: 'smart-homebase' };
    } else if (direktMin < Infinity) {
        return { durationMin: direktMin, distKm: direktKm, method: 'smart-direkt' };
    }

    // Fallback auf Luftlinie
    if (homeLat && homeLon) {
        const dist = gpsDistanceKm(homeLat, homeLon, pickupLat, pickupLon);
        return { durationMin: Math.round(dist * 2), distKm: dist, method: 'homebase-luftlinie' };
    }
    return { durationMin: 50, distKm: 25, method: 'fallback' };
}

// Hilfsfunktion: Alternatives Fahrzeug ohne Zeitkonflikt finden
function findAlternativeVehicle(ride, excludeVehicleId, allRides, shiftsData, dateStr, pricingSettings) {
    const pickupTs = ride.pickupTimestamp;
    const rideDurMs = (ride.duration || ride.estimatedDuration || 20) * 60000;
    const boardingTime = pricingSettings.boardingTime || 3;
    const alightingTime = pricingSettings.alightingTime || 2;
    const bufferMs = (boardingTime + alightingTime) * 60000;

    const berlinTime = (ts) => {
        const d = new Date(ts);
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const mins = String(d.getUTCMinutes()).padStart(2, '0');
        // Einfache Berlin-Zeit: UTC+1 (Winter) oder UTC+2 (Sommer)
        const month = d.getUTCMonth() + 1;
        const isSummer = month >= 4 && month <= 10;
        const h = (d.getUTCHours() + (isSummer ? 2 : 1)) % 24;
        return String(h).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    };
    const timeStr = berlinTime(pickupTs);

    // Alle Fahrzeuge durchgehen, sortiert nach Priorität
    const candidates = Object.entries(OFFICIAL_VEHICLES)
        .filter(([vid]) => vid !== excludeVehicleId)
        .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));

    for (const [vehicleId, vInfo] of candidates) {
        // Kapazität prüfen
        if ((vInfo.capacity || 4) < (ride.passengers || 1)) continue;

        // Im Schichtplan?
        if (!isVehicleInShift(vehicleId, shiftsData, dateStr, timeStr)) continue;

        // Zeitkonflikt mit bestehenden Fahrten auf diesem Fahrzeug?
        const hasConflict = allRides.some(r => {
            if (r.firebaseId === ride.firebaseId) return false;
            if (r.assignedVehicle !== vehicleId) return false;
            if (!r.pickupTimestamp) return false;
            if (['deleted','cancelled','storniert','completed'].includes(r.status)) return false;

            const rDurMs = (r.duration || r.estimatedDuration || 20) * 60000;
            const rEnd = r.pickupTimestamp + rDurMs + bufferMs;
            const newEnd = pickupTs + rideDurMs + bufferMs;
            return (pickupTs < rEnd) && (r.pickupTimestamp < newEnd);
        });

        if (!hasConflict) {
            return vehicleId;
        }
    }

    return null; // Kein freies Fahrzeug gefunden
}

// ═══════════════════════════════════════════════════════════════
// 🆕 v6.20.0: SERVER-SEITIGE TELEGRAM-BENACHRICHTIGUNGEN
// Firebase Database Triggers — funktionieren OHNE offenen Browser!
// ═══════════════════════════════════════════════════════════════

// Hilfsfunktion: Berlin-Zeit formatieren
function formatBerlinTime(timestamp) {
    const d = new Date(timestamp || Date.now());
    return d.toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// Hilfsfunktion: Admin-Chats laden und Nachricht senden
// 🔔 v6.20.1: Benachrichtigungs-Kategorien für Admins
const NOTIFY_CATEGORIES = {
    new_ride: { emoji: '🚕', label: 'Neue Buchung', desc: 'Neue Fahrten (Sofort + Vorbestellung)' },
    status_change: { emoji: '🔄', label: 'Status-Änderung', desc: 'Angenommen / Unterwegs / Abgeschlossen' },
    cancellation: { emoji: '⚠️', label: 'Stornierung', desc: 'Kunde storniert Fahrt' },
    ride_deleted: { emoji: '🗑️', label: 'Fahrt gelöscht', desc: 'Fahrt wurde gelöscht' },
    unassigned: { emoji: '🚨', label: 'Offene Fahrt', desc: 'Fahrt ohne Fahrer kurz vor Abholung' },
    change_request: { emoji: '🔔', label: 'Änderungsanfrage', desc: 'Kunde möchte Fahrt ändern' },
    spam_block: { emoji: '🚫', label: 'Spam-Blockierung', desc: 'Nutzer wegen Spam geblockt' },
    optimization: { emoji: '🚀', label: 'Optimierung/Umplanung', desc: 'Fahrt automatisch umgeplant (Schicht, Leerfahrt, Konflikt)' }
};

async function getAdminNotifyPrefs(chatId) {
    try {
        const snap = await db.ref(`settings/telegram/adminNotifyPrefs/${chatId}`).once('value');
        return snap.val() || null; // null = alle aktiv (Standard)
    } catch (e) { return null; }
}

async function sendToAllAdmins(message, category) {
    try {
        const snapshot = await db.ref('settings/telegram/adminChats').once('value');
        const adminChats = snapshot.val() || [];
        if (adminChats.length === 0) {
            console.log('⚠️ Keine Telegram-Admin-Chats konfiguriert');
            return;
        }
        for (const chatId of adminChats) {
            // 🔔 v6.20.1: Kategorie-Filter prüfen
            if (category) {
                const prefs = await getAdminNotifyPrefs(chatId);
                if (prefs && prefs[category] === false) continue; // Admin hat diese Kategorie deaktiviert
            }
            await sendTelegramMessage(chatId, message);
        }
    } catch (e) {
        console.error('❌ sendToAllAdmins Fehler:', e.message);
    }
}

// Hilfsfunktion: Telegram Chat-ID eines Fahrers ermitteln
async function getDriverChatId(vehicleId) {
    if (!vehicleId) return null;
    try {
        const driverSnap = await db.ref('vehicles/' + vehicleId).once('value');
        const driverData = driverSnap.val();
        if (!driverData) return null;

        // Zuerst: Chat-ID vom User-Account
        if (driverData.userId) {
            const userSnap = await db.ref('users/' + driverData.userId + '/telegramChatId').once('value');
            if (userSnap.val()) return userSnap.val();
        }
        // Fallback: Chat-ID direkt am Fahrzeug
        return driverData.telegramChatId || null;
    } catch (e) {
        console.error('❌ getDriverChatId Fehler:', e.message);
        return null;
    }
}

// Hilfsfunktion: Kunden-Chat-ID ermitteln (Telegram)
async function getCustomerChatId(ride) {
    // 1. Direkt aus der Ride (Telegram-Buchungen)
    if (ride.telegramChatId) return ride.telegramChatId;

    // 2. Über Telefonnummer in /customers suchen
    const phone = ride.customerPhone || ride.phone;
    if (!phone) return null;
    try {
        const customersSnap = await db.ref('customers').orderByChild('phone').equalTo(phone).once('value');
        const customers = customersSnap.val();
        if (customers) {
            for (const id in customers) {
                if (customers[id].telegramChatId) return customers[id].telegramChatId;
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// TRIGGER 1: Neue Fahrt erstellt → Admin-Benachrichtigung
// ═══════════════════════════════════════════════════════════════
exports.onRideCreated = onValueCreated(
    {
        ref: '/rides/{rideId}',
        region: 'europe-west1',
        instance: 'taxi-heringsdorf-default-rtdb'
    },
    async (event) => {
        const rideId = event.params.rideId;
        const ride = event.data.val();
        if (!ride) return;

        console.log(`📱 onRideCreated: ${rideId} — ${ride.customerName || 'Unbekannt'}`);

        // Prüfe ob Benachrichtigung schon gesendet wurde (z.B. vom Webhook-Handler selbst)
        if (ride.cloudNotificationSent) {
            console.log('⚠️ Benachrichtigung bereits gesendet (cloudNotificationSent flag)');
            return;
        }

        const timestamp = formatBerlinTime();

        // Zeitformatierung
        const now = Date.now();
        const pickupTs = ride.pickupTimestamp || now;
        const isToday = new Date(pickupTs).toDateString() === new Date(now).toDateString();
        // 🔧 v6.25.4: Sofortfahrt = Abholzeit < 60 Min in der Zukunft (einheitlich mit autoAssignRide)
        // isJetzt = explizit "jetzt/sofort" gesagt, ODER keine Abholzeit, ODER < 60 Min
        const isSofort = ride.isJetzt === true || !ride.pickupTimestamp || (pickupTs - now) < 60 * 60 * 1000;

        let pickupTimeFormatted, statusEmoji, statusText;
        if (isSofort) {
            pickupTimeFormatted = 'SOFORT';
            statusEmoji = '🚕';
            statusText = 'SOFORT-FAHRT!';
        } else if (isToday) {
            pickupTimeFormatted = 'Heute ' + new Date(pickupTs).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
            statusEmoji = '📅';
            statusText = 'VORBESTELLUNG';
        } else {
            const dateStr = new Date(pickupTs).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit' });
            const timeStr = new Date(pickupTs).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
            pickupTimeFormatted = `${dateStr} ${timeStr}`;
            statusEmoji = '📅';
            statusText = 'VORBESTELLUNG';
        }

        const message = `${statusEmoji} <b>${statusText}</b>\n` +
            `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
            `📍 <b>Von:</b> ${ride.pickup || '?'}\n` +
            `📍 <b>Nach:</b> ${ride.destination || '?'}\n` +
            `👤 <b>Name:</b> ${ride.customerName || '?'}\n` +
            `📱 <b>Tel:</b> ${ride.customerPhone || '?'}\n` +
            `🕐 <b>Abholung:</b> ${pickupTimeFormatted}\n` +
            `💰 <b>Preis:</b> ${ride.price || 0}€\n` +
            `⏰ <b>Gesendet:</b> ${timestamp}\n` +
            `\n👉 <a href="https://patrick061977.github.io/taxi-App/">App öffnen</a>`;

        await sendToAllAdmins(message, 'new_ride');

        // Flag setzen damit Browser nicht nochmal sendet
        try {
            await db.ref('rides/' + rideId + '/cloudNotificationSent').set(true);
        } catch (e) { /* non-critical */ }

        await addTelegramLog('📱', 'cloud', `Neue Fahrt: ${ride.customerName || '?'} (${statusText})`, { rideId });
        console.log(`✅ Admin-Benachrichtigung gesendet für: ${rideId}`);
    }
);

// ═══════════════════════════════════════════════════════════════
// TRIGGER 2: Fahrt aktualisiert → Status-Updates, Fahrer-Benachrichtigung
// ═══════════════════════════════════════════════════════════════
exports.onRideUpdated = onValueUpdated(
    {
        ref: '/rides/{rideId}',
        region: 'europe-west1',
        instance: 'taxi-heringsdorf-default-rtdb'
    },
    async (event) => {
        const rideId = event.params.rideId;
        const before = event.data.before.val();
        const after = event.data.after.val();
        if (!before || !after) return;

        const oldStatus = before.status;
        const newStatus = after.status;
        const oldVehicle = before.assignedVehicle || before.vehicleId;
        const newVehicle = after.assignedVehicle || after.vehicleId;

        // ─── STATUS-ÄNDERUNG → Admin-Benachrichtigung ───
        if (oldStatus !== newStatus) {
            console.log(`📱 onRideUpdated: ${rideId} Status ${oldStatus} → ${newStatus}`);

            let message = '';
            if (newStatus === 'accepted') {
                message = `✅ <b>FAHRER ZUGEWIESEN!</b>\n` +
                    `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
                    `🚗 <b>Fahrzeug:</b> ${after.vehicle || 'Unbekannt'}${after.vehiclePlate ? ` (${after.vehiclePlate})` : ''}\n` +
                    `👤 <b>Kunde:</b> ${after.customerName || '?'}\n` +
                    `📱 <b>Tel:</b> ${after.customerPhone || '?'}\n` +
                    `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                    `📍 <b>Nach:</b> ${after.destination || '?'}\n` +
                    `💰 <b>Preis:</b> ${after.price || 0}€\n` +
                    `\n👉 <a href="https://patrick061977.github.io/taxi-App/">App öffnen</a>`;

                // Auch Kunden per Telegram benachrichtigen (Bestätigung)
                const customerChatId = await getCustomerChatId(after);
                if (customerChatId) {
                    const driverInfo = after.driverName ? `\n👤 <b>Fahrer:</b> ${after.driverName}` : '';
                    const vehicleInfo = after.vehicle ? `\n🚗 <b>Fahrzeug:</b> ${after.vehicle}${after.vehiclePlate ? ' (' + after.vehiclePlate + ')' : ''}` : '';
                    const trackingLink = `https://patrick061977.github.io/taxi-App/?ride=${rideId}`;
                    const customerMsg = `🚕 <b>IHR TAXI IST UNTERWEGS!</b> 🚕\n\n` +
                        `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                        `🎯 <b>Nach:</b> ${after.destination || '?'}\n` +
                        `🕐 <b>Abholung:</b> ${after.pickupTime || 'Sofort'}\n` +
                        (after.price ? `💰 <b>Preis:</b> ca. ${after.price}€` : '') +
                        driverInfo + vehicleInfo +
                        `\n\n📲 <b>Fahrt live verfolgen:</b>\n<a href="${trackingLink}">🗺️ Tracking öffnen</a>\n\n` +
                        `📞 Bei Fragen: 038378/22022`;
                    await sendTelegramMessage(customerChatId, customerMsg);
                    console.log('📱 Kunden-Telegram gesendet:', customerChatId);
                }

            } else if (newStatus === 'storniert' || newStatus === 'cancelled') {
                message = `🗑️ <b>FAHRT STORNIERT</b>\n` +
                    `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
                    `👤 <b>Kunde:</b> ${after.customerName || '?'}\n` +
                    `📱 <b>Tel:</b> ${after.customerPhone || '?'}\n` +
                    `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                    `📍 <b>Nach:</b> ${after.destination || '?'}\n` +
                    `💰 <b>Preis:</b> ${after.price || 0}€\n` +
                    `\n⚠️ Status: Storniert`;

                // Fahrer benachrichtigen falls zugewiesen
                const vehicleId = after.assignedVehicle || after.vehicleId;
                if (vehicleId) {
                    const driverChatId = await getDriverChatId(vehicleId);
                    if (driverChatId) {
                        const cancelMsg = `🚫 <b>FAHRT STORNIERT!</b>\n\n` +
                            `🆔 <b>ID:</b> <code>${rideId}</code>\n` +
                            `👤 <b>Kunde:</b> ${after.customerName || '?'}\n` +
                            `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                            `📍 <b>Nach:</b> ${after.destination || '?'}\n\n` +
                            `⚠️ Diese Fahrt wurde storniert.`;
                        await sendTelegramMessage(driverChatId, cancelMsg);
                        console.log('📱 Stornierung an Fahrer gesendet:', vehicleId);
                    }
                }

            } else if (newStatus === 'picked_up') {
                message = `🚗 <b>KUNDE ABGEHOLT!</b>\n` +
                    `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
                    `🚗 <b>Fahrzeug:</b> ${after.vehicle || 'Unbekannt'}\n` +
                    `👤 <b>Kunde:</b> ${after.customerName || '?'}\n` +
                    `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                    `📍 <b>Nach:</b> ${after.destination || '?'}\n` +
                    `💰 <b>Preis:</b> ${after.price || 0}€\n` +
                    `\n🎯 Fahrt zum Ziel läuft...`;

            } else if (newStatus === 'completed') {
                message = `✅ <b>FAHRT ABGESCHLOSSEN!</b>\n` +
                    `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
                    `🚗 <b>Fahrzeug:</b> ${after.vehicle || 'Unbekannt'}\n` +
                    `👤 <b>Kunde:</b> ${after.customerName || '?'}\n` +
                    `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                    `📍 <b>Nach:</b> ${after.destination || '?'}\n` +
                    `💰 <b>Preis:</b> ${after.price || 0}€\n` +
                    `\n✅ Status: Abgeschlossen`;
            }

            if (message) {
                await sendToAllAdmins(message, 'status_change');
                await addTelegramLog('📱', 'cloud', `Status: ${oldStatus} → ${newStatus} (${after.customerName || '?'})`, { rideId });
            }
        }

        // ─── FAHRER-ZUWEISUNG (neues Fahrzeug) → Fahrer benachrichtigen ───
        if (newVehicle && newVehicle !== oldVehicle && newStatus !== 'storniert' && newStatus !== 'cancelled') {
            console.log(`📱 Fahrer-Zuweisung: ${rideId} → ${newVehicle}`);

            // Nur benachrichtigen wenn nicht von autoAssignRide (das macht es selbst)
            if (after.assignedBy !== 'cloud-auto-assign' && after.assignedBy !== 'cloud-auto-replan' && after.assignedBy !== 'cloud-auto-optimize') {
                const driverChatId = await getDriverChatId(newVehicle);
                if (driverChatId) {
                    let customerInfo = `👤 <b>Kunde:</b> ${after.customerName || '?'}`;
                    if (after.guestName) customerInfo += `\n🧳 <b>Fahrgast:</b> ${after.guestName}`;
                    if (after.guestPhone) customerInfo += `\n📱 <b>Fahrgast-Tel:</b> ${after.guestPhone}`;

                    const pickupLabel = after.pickupTime || 'Sofort';
                    const isVorbestellung = after.status === 'vorbestellt' || (after.pickupTimestamp && (after.pickupTimestamp - Date.now()) > 60 * 60 * 1000);

                    const driverMsg = `🚨 <b>${isVorbestellung ? '📅 NEUE VORBESTELLUNG!' : 'NEUER AUFTRAG FÜR DICH!'}</b> 🚨\n` +
                        `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
                        `📍 <b>Abholung:</b> ${after.pickup || '?'}\n` +
                        `🎯 <b>Ziel:</b> ${after.destination || '?'}\n` +
                        customerInfo + `\n` +
                        `📱 <b>Tel:</b> ${after.customerPhone || '?'}\n` +
                        `🕐 <b>Abholung:</b> ${pickupLabel}\n` +
                        `💰 <b>Preis:</b> ${after.price || 0}€\n\n` +
                        (isVorbestellung
                            ? `💡 <i>Fahrt vorgemerkt für ${pickupLabel}</i>`
                            : `⏱️ <b>Du hast 60 SEKUNDEN Zeit!</b>\n👉 <b>JETZT App öffnen und ANNEHMEN!</b>\n<a href="https://patrick061977.github.io/taxi-App/">🚕 App öffnen</a>`);

                    await sendTelegramMessage(driverChatId, driverMsg);
                    console.log('📱 Fahrer-Benachrichtigung gesendet:', newVehicle);
                    await addTelegramLog('📱', 'cloud', `Fahrer benachrichtigt: ${after.vehicle || newVehicle}`, { rideId });
                }
            }

            // Kunden-Buchungsbestätigung bei neuer Zuweisung (nicht bei Stornierung)
            if (!after.customerTelegramSent) {
                const customerChatId = await getCustomerChatId(after);
                if (customerChatId) {
                    const trackingLink = `https://patrick061977.github.io/taxi-App/?ride=${rideId}`;
                    const vehicleInfo = after.vehicle ? `\n🚗 <b>Fahrzeug:</b> ${after.vehicle}${after.vehiclePlate ? ' (' + after.vehiclePlate + ')' : ''}` : '';
                    const customerMsg = `🚕 <b>IHRE FAHRT WURDE BESTELLT!</b> 🚕\n\n` +
                        `📍 <b>Von:</b> ${after.pickup || '?'}\n` +
                        `🎯 <b>Nach:</b> ${after.destination || '?'}\n` +
                        `🕐 <b>Abholung:</b> ${after.pickupTime || 'Sofort'}\n` +
                        (after.price ? `💰 <b>Preis:</b> ca. ${after.price}€` : '') +
                        vehicleInfo +
                        `\n\n📲 <b>Fahrt live verfolgen:</b>\n<a href="${trackingLink}">🗺️ Tracking öffnen</a>\n\n` +
                        `✅ Sie erhalten Updates sobald der Fahrer losfährt!\n\n` +
                        `📞 Bei Fragen: 038378/22022`;
                    await sendTelegramMessage(customerChatId, customerMsg);

                    // Flag setzen
                    try {
                        await db.ref('rides/' + rideId + '/customerTelegramSent').set(true);
                    } catch (e) { /* non-critical */ }
                }
            }
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// TRIGGER 3: Fahrt gelöscht → Admin-Benachrichtigung
// ═══════════════════════════════════════════════════════════════
exports.onRideDeleted = onValueDeleted(
    {
        ref: '/rides/{rideId}',
        region: 'europe-west1',
        instance: 'taxi-heringsdorf-default-rtdb'
    },
    async (event) => {
        const rideId = event.params.rideId;
        const ride = event.data.val();
        if (!ride) return;

        console.log(`📱 onRideDeleted: ${rideId} — ${ride.customerName || 'Unbekannt'}`);

        const timestamp = formatBerlinTime();

        let statusText = 'Nicht zugewiesen';
        if (ride.status === 'accepted') statusText = '✅ Angenommen';
        if (ride.status === 'picked_up') statusText = '🚗 Unterwegs';
        if (ride.status === 'vorbestellt') statusText = '📅 Vorbestellt';

        const message = `🗑️ <b>FAHRT GELÖSCHT</b>\n` +
            `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
            `⚠️ <b>Status war:</b> ${statusText}\n` +
            (ride.vehicle ? `🚗 <b>Fahrzeug:</b> ${ride.vehicle}${ride.vehiclePlate ? ` (${ride.vehiclePlate})` : ''}\n` : '') +
            `👤 <b>Kunde:</b> ${ride.customerName || '?'}\n` +
            `📱 <b>Tel:</b> ${ride.customerPhone || '?'}\n` +
            `📍 <b>Von:</b> ${ride.pickup || '?'}\n` +
            `📍 <b>Nach:</b> ${ride.destination || '?'}\n` +
            (ride.pickupTime && ride.pickupTime !== 'Sofort' ? `⏰ <b>Abholung:</b> ${ride.pickupTime}\n` : '') +
            `💰 <b>Preis:</b> ${ride.price || 0}€\n` +
            `⏰ <b>Gelöscht:</b> ${timestamp}\n` +
            `\n🚨 <b>Diese Fahrt wurde gelöscht!</b>`;

        await sendToAllAdmins(message, 'ride_deleted');

        // Fahrer benachrichtigen falls zugewiesen
        const vehicleId = ride.assignedVehicle || ride.vehicleId;
        if (vehicleId) {
            const driverChatId = await getDriverChatId(vehicleId);
            if (driverChatId) {
                await sendTelegramMessage(driverChatId,
                    `🗑️ <b>FAHRT GELÖSCHT!</b>\n\n` +
                    `🆔 <b>ID:</b> <code>${rideId}</code>\n` +
                    `👤 <b>Kunde:</b> ${ride.customerName || '?'}\n` +
                    `📍 <b>Von:</b> ${ride.pickup || '?'}\n\n` +
                    `⚠️ Diese Fahrt wurde vom Admin gelöscht.`
                );
            }
        }

        await addTelegramLog('🗑️', 'cloud', `Fahrt gelöscht: ${ride.customerName || '?'}`, { rideId });
    }
);

// ═══════════════════════════════════════════════════════════════
// 🆕 v6.20.0: OFFENE FAHRTEN PRÜFUNG (alle 1 Minute)
// Warnt Admins wenn Vorbestellungen < 10 Min vor Abholzeit ohne Fahrer sind
// ═══════════════════════════════════════════════════════════════
exports.scheduledOpenRideCheck = onSchedule(
    {
        schedule: 'every 1 minutes',
        region: 'europe-west1',
        timeoutSeconds: 60,
        memory: '256MiB'
    },
    async (event) => {
        try {
            const ridesSnap = await db.ref('rides').once('value');
            if (!ridesSnap.val()) return;

            const now = Date.now();
            const warnings = [];

            ridesSnap.forEach(child => {
                const ride = child.val();
                const rideId = child.key;

                // Nur Fahrten ohne Fahrer prüfen
                if (ride.status !== 'new' && ride.status !== 'vorbestellt') return;
                if (ride.assignedVehicle || ride.vehicleId || ride.driverId) return;

                // Prüfe ob Abholzeit in <= 10 Minuten
                const pickupTime = ride.pickupTimestamp || 0;
                const minutesUntilPickup = (pickupTime - now) / (1000 * 60);

                if (minutesUntilPickup <= 10 && minutesUntilPickup > -5) {
                    // Prüfe ob schon gewarnt (Flag in Firebase)
                    if (!ride.openRideWarned) {
                        warnings.push({ rideId, ride, minutesUntilPickup });
                    }
                }
            });

            if (warnings.length === 0) return;

            const timestamp = formatBerlinTime();

            for (const { rideId, ride, minutesUntilPickup } of warnings) {
                const pickupTimeStr = ride.pickupTime || 'Unbekannt';
                const message = `🚨🚨🚨 <b>ACHTUNG: OFFENE FAHRT!</b> 🚨🚨🚨\n` +
                    `🆔 <b>ID:</b> <code>${rideId}</code>\n\n` +
                    `⏰ <b>Abholzeit:</b> ${pickupTimeStr}\n` +
                    `⚠️ <b>Noch KEIN Fahrer zugewiesen!</b>\n` +
                    `⏳ <b>Noch ${Math.max(0, Math.round(minutesUntilPickup))} Minuten!</b>\n\n` +
                    `👤 <b>Kunde:</b> ${ride.customerName || '?'}\n` +
                    `📱 <b>Tel:</b> ${ride.customerPhone || '?'}\n` +
                    `📍 <b>Von:</b> ${ride.pickup || '?'}\n` +
                    `📍 <b>Nach:</b> ${ride.destination || '?'}\n` +
                    `💰 <b>Preis:</b> ${ride.price || 0}€\n\n` +
                    `🔴 <b>Bitte SOFORT einen Fahrer zuweisen!</b>\n` +
                    `⏰ <b>Warnung:</b> ${timestamp}`;

                await sendToAllAdmins(message, 'unassigned');

                // Flag setzen damit nicht nochmal gewarnt wird
                try {
                    await db.ref('rides/' + rideId + '/openRideWarned').set(true);
                } catch (e) { /* non-critical */ }

                await addTelegramLog('🚨', 'cloud', `OFFENE FAHRT Warnung: ${ride.customerName || '?'} (${pickupTimeStr})`, { rideId });
                console.log(`🚨 Offene-Fahrt-Warnung gesendet: ${rideId}`);
            }
        } catch (e) {
            console.error('❌ scheduledOpenRideCheck Fehler:', e.message);
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 💳 STRIPE CHECKOUT — v6.21.0
// Erstellt eine Stripe Checkout Session für eine Rechnung
// ═══════════════════════════════════════════════════════════════

exports.createStripeCheckout = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        // CORS
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            const { invoiceNumber, amount, customerName, customerEmail, description } = req.body;

            if (!invoiceNumber || !amount) {
                res.status(400).json({ error: 'invoiceNumber und amount sind erforderlich' });
                return;
            }

            const stripe = await getStripe();

            // Betrag in Cent (Stripe erwartet kleinste Währungseinheit)
            const amountInCents = Math.round(parseFloat(amount) * 100);

            if (amountInCents < 50) {
                res.status(400).json({ error: 'Mindestbetrag ist 0,50 €' });
                return;
            }

            // Checkout Session erstellen
            // payment_method_types NICHT setzen → Stripe nutzt automatisch alle im Dashboard aktivierten Methoden
            const sessionParams = {
                mode: 'payment',
                line_items: [{
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Rechnung ${invoiceNumber}`,
                            description: description || `Funk Taxi Heringsdorf — Rechnung ${invoiceNumber}`
                        },
                        unit_amount: amountInCents
                    },
                    quantity: 1
                }],
                metadata: {
                    invoiceNumber: invoiceNumber,
                    source: 'taxi-heringsdorf'
                },
                success_url: `https://taxi-heringsdorf.web.app/payment-success?invoice=${invoiceNumber}`,
                cancel_url: `https://taxi-heringsdorf.web.app/payment-cancel?invoice=${invoiceNumber}`,
                locale: 'de'
            };

            // Optional: Kunden-E-Mail vorausfüllen
            if (customerEmail) {
                sessionParams.customer_email = customerEmail;
            }

            const session = await stripe.checkout.sessions.create(sessionParams);

            // Speichere Checkout-Info in Firebase
            await db.ref(`invoices/${invoiceNumber}`).update({
                stripeSessionId: session.id,
                stripeCheckoutUrl: session.url,
                stripePaymentStatus: 'pending',
                stripeCreatedAt: Date.now()
            });

            console.log(`💳 Stripe Checkout erstellt: ${invoiceNumber} → ${session.id}`);

            res.status(200).json({
                success: true,
                checkoutUrl: session.url,
                sessionId: session.id
            });

        } catch (error) {
            console.error('❌ Stripe Checkout Fehler:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 💳 STRIPE BEZAHL-REDIRECT — v6.22.0
// Kurze URL für QR-Codes: /pay?inv=INV-2026-00123
// Leitet weiter zur Stripe Checkout URL
// ═══════════════════════════════════════════════════════════════

exports.payRedirect = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        const invoiceNumber = req.query.inv || req.params[0];

        if (!invoiceNumber) {
            res.status(400).send('Fehlende Rechnungsnummer');
            return;
        }

        try {
            const snap = await db.ref(`invoices/${invoiceNumber}`).once('value');
            const invoice = snap.val();

            if (!invoice || !invoice.stripeCheckoutUrl) {
                res.status(404).send('Bezahl-Link nicht gefunden oder abgelaufen');
                return;
            }

            // Wenn bereits bezahlt → Bestätigungsseite
            if (invoice.stripePaymentStatus === 'paid') {
                res.status(200).send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;">
                    <h2>✅ Bereits bezahlt</h2>
                    <p>Rechnung ${invoiceNumber} wurde bereits beglichen.</p>
                    <p>Betrag: ${invoice.totalGross ? invoice.totalGross.toFixed(2) : '?'} €</p>
                </body></html>`);
                return;
            }

            console.log(`💳 Pay-Redirect: ${invoiceNumber} → Stripe Checkout`);
            res.redirect(302, invoice.stripeCheckoutUrl);

        } catch (error) {
            console.error('❌ Pay-Redirect Fehler:', error.message);
            res.status(500).send('Fehler beim Laden des Bezahl-Links');
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 💳 STRIPE WEBHOOK — v6.21.0
// Empfängt Zahlungsbestätigungen von Stripe
// ═══════════════════════════════════════════════════════════════

exports.stripeWebhook = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }

        try {
            const stripe = await getStripe();

            // Webhook-Signatur verifizieren (optional, empfohlen für Produktion)
            let event;
            const webhookSecret = await db.ref('settings/stripe/webhookSecret').once('value').then(s => s.val());

            if (webhookSecret) {
                const sig = req.headers['stripe-signature'];
                try {
                    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
                } catch (err) {
                    console.error('⚠️ Stripe Webhook Signatur ungültig:', err.message);
                    res.status(400).send(`Webhook Error: ${err.message}`);
                    return;
                }
            } else {
                // Ohne Secret: Event direkt verwenden (nur für Tests!)
                event = req.body;
                console.warn('⚠️ Stripe Webhook ohne Signatur-Verifizierung!');
            }

            // Verarbeite Event
            if (event.type === 'checkout.session.completed') {
                const session = event.data.object;
                const invoiceNumber = session.metadata?.invoiceNumber;

                if (invoiceNumber) {
                    // Rechnung als bezahlt markieren
                    await db.ref(`invoices/${invoiceNumber}`).update({
                        stripePaymentStatus: 'paid',
                        stripePaidAt: Date.now(),
                        stripePaymentIntentId: session.payment_intent,
                        stripeAmountPaid: session.amount_total,
                        status: 'bezahlt',
                        paidAt: Date.now(),
                        paymentMethod: 'stripe'
                    });

                    console.log(`✅ Stripe Zahlung erhalten: ${invoiceNumber} → ${(session.amount_total / 100).toFixed(2)} €`);

                    // Optional: Admin benachrichtigen via Telegram
                    try {
                        const invoiceSnap = await db.ref(`invoices/${invoiceNumber}`).once('value');
                        const invoice = invoiceSnap.val();
                        const amountEur = (session.amount_total / 100).toFixed(2);

                        const adminMsg = `💳✅ <b>Zahlung eingegangen!</b>\n\n` +
                            `📄 <b>Rechnung:</b> ${invoiceNumber}\n` +
                            `👤 <b>Kunde:</b> ${invoice?.customerName || session.customer_details?.name || '?'}\n` +
                            `💰 <b>Betrag:</b> ${amountEur} €\n` +
                            `💳 <b>Zahlungsart:</b> Stripe Checkout\n` +
                            `⏰ <b>Zeit:</b> ${formatBerlinTime()}`;

                        await sendToAllAdmins(adminMsg, 'payment');
                    } catch (notifyErr) {
                        console.warn('⚠️ Admin-Benachrichtigung fehlgeschlagen:', notifyErr.message);
                    }
                }
            } else if (event.type === 'checkout.session.expired') {
                const session = event.data.object;
                const invoiceNumber = session.metadata?.invoiceNumber;
                if (invoiceNumber) {
                    await db.ref(`invoices/${invoiceNumber}`).update({
                        stripePaymentStatus: 'expired',
                        stripeExpiredAt: Date.now()
                    });
                    console.log(`⏰ Stripe Session abgelaufen: ${invoiceNumber}`);
                }
            }

            res.status(200).json({ received: true });

        } catch (error) {
            console.error('❌ Stripe Webhook Fehler:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 📧 EMAIL-VERSAND — v6.21.0
// Versendet Rechnungen per SMTP (Nodemailer) statt EmailJS
// ═══════════════════════════════════════════════════════════════

exports.sendInvoiceEmail = onRequest(
    { region: 'europe-west1', timeoutSeconds: 60, invoker: 'public' },
    async (req, res) => {
        // CORS
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            const {
                invoiceNumber,
                toEmail,
                toName,
                subject,
                htmlBody,
                paymentLink,  // Optional: Stripe Checkout URL
                pdfUrl,       // Optional: PDF-URL für Anhang
                attachPdf     // Optional: true = PDF als Anhang senden
            } = req.body;

            if (!toEmail || !invoiceNumber) {
                res.status(400).json({ error: 'toEmail und invoiceNumber sind erforderlich' });
                return;
            }

            // SMTP-Einstellungen aus Firebase laden
            const smtpSnap = await db.ref('settings/smtp').once('value');
            const smtp = smtpSnap.val();

            if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
                res.status(400).json({ error: 'SMTP nicht konfiguriert! Bitte unter Einstellungen → Rechnungseinstellungen → SMTP einrichten.' });
                return;
            }

            // Nodemailer Transporter erstellen
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: smtp.host,
                port: parseInt(smtp.port) || 587,
                secure: (parseInt(smtp.port) || 587) === 465,
                auth: {
                    user: smtp.user,
                    pass: smtp.pass
                }
            });

            // Rechnungsdaten aus Firebase laden (wenn kein htmlBody mitgegeben)
            let emailHTML = htmlBody;
            let emailSubject = subject;

            if (!emailHTML) {
                // Rechnung aus Firebase laden und HTML generieren
                const invoiceSnap = await db.ref(`invoices/${invoiceNumber}`).once('value');
                const invoice = invoiceSnap.val();

                if (!invoice) {
                    res.status(404).json({ error: `Rechnung ${invoiceNumber} nicht gefunden` });
                    return;
                }

                // Firmen-Einstellungen laden
                const settingsSnap = await db.ref('settings/invoice').once('value');
                const invSettings = settingsSnap.val() || {};
                const companyName = invSettings.companyName || 'Taxi Wydra';
                const companyPhone = invSettings.phone || '+49 151 27585179';
                const companyEmail = invSettings.email || 'taxiwydra@googlemail.com';
                const ownerName = invSettings.ownerName || 'Patrick Wydra';

                const customerName = toName || invoice.customerName || 'Kunde';
                const pdfUrl = invoice.pdfUrl || '';
                const totalGross = parseFloat(invoice.totalGross) || 0;
                const totalNet = parseFloat(invoice.totalNet) || 0;

                // Positionen-HTML
                const positions = invoice.positions || [];
                const positionsHTML = positions.map(pos => `
                    <tr>
                        <td style="padding:8px;border:1px solid #e5e7eb;">${pos.description || 'Position'}</td>
                        <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${parseFloat(pos.amount).toFixed(2)} &euro;</td>
                    </tr>
                `).join('');

                // MwSt-Aufschlüsselung
                const vatBreakdown = invoice.vatBreakdown || {};
                const netBreakdown = invoice.netBreakdown || {};
                const vatRates = Object.keys(vatBreakdown).sort((a, b) => parseFloat(b) - parseFloat(a));

                let vatHTML = '';
                if (vatRates.length === 1) {
                    const rate = vatRates[0];
                    vatHTML = `<tr><td style="padding:8px;border:1px solid #e5e7eb;">zzgl. MwSt (${parseFloat(rate).toFixed(0)}%):</td><td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${parseFloat(vatBreakdown[rate]).toFixed(2)} &euro;</td></tr>`;
                } else {
                    vatHTML = vatRates.map(rate => `
                        <tr><td style="padding:8px;border:1px solid #e5e7eb;">davon Netto (${parseFloat(rate).toFixed(0)}%):</td><td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${parseFloat(netBreakdown[rate]).toFixed(2)} &euro;</td></tr>
                        <tr><td style="padding:8px;border:1px solid #e5e7eb;">davon MwSt (${parseFloat(rate).toFixed(0)}%):</td><td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${parseFloat(vatBreakdown[rate]).toFixed(2)} &euro;</td></tr>
                    `).join('');
                }

                // Bezahl-Link-Bereich (wenn Stripe aktiv)
                const stripeUrl = paymentLink || invoice.stripeCheckoutUrl || '';
                const paymentSection = stripeUrl ? `
                    <div style="background:#f0f0ff;border:2px solid #635bff;border-radius:8px;padding:15px;margin:20px 0;text-align:center;">
                        <p style="margin:0 0 10px 0;font-weight:700;color:#0a2540;">&#x1F4B3; Jetzt online bezahlen</p>
                        <a href="${stripeUrl}" style="display:inline-block;background:#635bff;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;font-weight:bold;">Zur sicheren Zahlung</a>
                        <p style="font-size:12px;color:#6b7280;margin:10px 0 0 0;">Kreditkarte, Giropay oder Sofort&uuml;berweisung</p>
                    </div>
                ` : '';

                // PDF-Download-Bereich
                const pdfSection = pdfUrl ? `
                    <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:15px;margin:20px 0;">
                        <h3 style="margin-top:0;">&#x1F4C4; Ihre Rechnung als PDF</h3>
                        <p><a href="${pdfUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">&#x1F4E5; Rechnung herunterladen</a></p>
                    </div>
                ` : '';

                emailHTML = `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
                        <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
                            <h2 style="margin:0;">Rechnung ${invoiceNumber}</h2>
                            <p style="margin:5px 0 0 0;opacity:0.9;">${companyName}</p>
                        </div>
                        <div style="padding:20px;background:#ffffff;border:1px solid #e5e7eb;">
                            <p>Guten Tag ${customerName},</p>
                            <p>vielen Dank f&uuml;r Ihre Fahrt mit ${companyName}!</p>

                            <h3>&#x1F4CB; Rechnungsdetails:</h3>
                            <table style="border-collapse:collapse;width:100%;margin:15px 0;">
                                <tr style="background:#f3f4f6;"><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Rechnungsnummer:</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${invoiceNumber}</td></tr>
                                <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Datum:</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${invoice.rideDate || ''} ${invoice.rideTime || ''}</td></tr>
                                <tr style="background:#f3f4f6;"><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Von:</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${invoice.pickup || ''}</td></tr>
                                <tr><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Nach:</strong></td><td style="padding:8px;border:1px solid #e5e7eb;">${invoice.destination || ''}</td></tr>
                            </table>

                            <h3>&#x1F4CA; Positionen:</h3>
                            <table style="border-collapse:collapse;width:100%;margin:15px 0;">
                                <tr style="background:#3b82f6;color:white;"><th style="padding:8px;text-align:left;">Beschreibung</th><th style="padding:8px;text-align:right;">Betrag</th></tr>
                                ${positionsHTML}
                            </table>

                            <table style="border-collapse:collapse;width:100%;margin:15px 0;">
                                <tr style="background:#f3f4f6;"><td style="padding:8px;border:1px solid #e5e7eb;"><strong>Netto:</strong></td><td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${totalNet.toFixed(2)} &euro;</td></tr>
                                ${vatHTML}
                                <tr style="background:#10b981;color:white;"><td style="padding:8px;border:1px solid #059669;"><strong>Gesamt (brutto):</strong></td><td style="padding:8px;border:1px solid #059669;text-align:right;"><strong>${totalGross.toFixed(2)} &euro;</strong></td></tr>
                            </table>

                            ${paymentSection}
                            ${pdfSection}

                            <p>Bei Fragen stehen wir Ihnen gerne zur Verf&uuml;gung.</p>
                            <p>Mit freundlichen Gr&uuml;&szlig;en<br>${ownerName}<br><strong>${companyName}</strong></p>
                        </div>
                        <div style="background:#f9fafb;padding:15px;border-radius:0 0 8px 8px;text-align:center;font-size:12px;color:#6b7280;border:1px solid #e5e7eb;border-top:none;">
                            &#x1F4DE; ${companyPhone} &nbsp;|&nbsp; &#x2709; ${companyEmail}
                        </div>
                    </div>
                `;

                emailSubject = subject || `Ihre Rechnung ${invoiceNumber} - ${companyName}`;
            }

            // Absender-Name aus Settings
            const fromName = smtp.fromName || 'Taxi Wydra';
            const fromEmail = smtp.fromEmail || smtp.user;

            // 🆕 v6.22.0: PDF als Anhang herunterladen (wenn gewünscht)
            let attachments = [];
            const shouldAttachPdf = attachPdf !== false; // Standard: immer anhängen wenn pdfUrl vorhanden
            const effectivePdfUrl = pdfUrl || (emailHTML ? null : (invoice ? invoice.pdfUrl : null));

            if (shouldAttachPdf && effectivePdfUrl) {
                try {
                    console.log('📎 Lade PDF für Anhang:', effectivePdfUrl);
                    const https = require('https');
                    const http = require('http');
                    const pdfBuffer = await new Promise((resolve, reject) => {
                        const client = effectivePdfUrl.startsWith('https') ? https : http;
                        client.get(effectivePdfUrl, (response) => {
                            // Redirects folgen
                            if (response.statusCode === 301 || response.statusCode === 302) {
                                client.get(response.headers.location, (res2) => {
                                    const chunks = [];
                                    res2.on('data', chunk => chunks.push(chunk));
                                    res2.on('end', () => resolve(Buffer.concat(chunks)));
                                    res2.on('error', reject);
                                }).on('error', reject);
                                return;
                            }
                            const chunks = [];
                            response.on('data', chunk => chunks.push(chunk));
                            response.on('end', () => resolve(Buffer.concat(chunks)));
                            response.on('error', reject);
                        }).on('error', reject);
                    });

                    attachments.push({
                        filename: `rechnung-${invoiceNumber}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    });
                    console.log(`📎 PDF-Anhang bereit: ${pdfBuffer.length} Bytes`);
                } catch (pdfError) {
                    console.warn('⚠️ PDF konnte nicht als Anhang geladen werden:', pdfError.message);
                    // Kein Abbruch — E-Mail wird trotzdem gesendet (mit Download-Link)
                }
            }

            // Email senden
            const mailOptions = {
                from: `"${fromName}" <${fromEmail}>`,
                to: toEmail,
                subject: emailSubject || `Rechnung ${invoiceNumber}`,
                html: emailHTML,
                attachments: attachments
            };

            const info = await transporter.sendMail(mailOptions);
            console.log(`📧 Email gesendet: ${invoiceNumber} → ${toEmail} (${info.messageId})`);

            // Status in Firebase aktualisieren
            const updateData = {
                emailSent: true,
                emailSentAt: Date.now(),
                emailSentTo: toEmail,
                emailSentVia: 'smtp',
                emailMessageId: info.messageId,
                status: 'versendet'
            };

            await db.ref(`invoices/${invoiceNumber}`).update(updateData);

            // Auch Ride aktualisieren wenn vorhanden
            const invoiceSnap2 = await db.ref(`invoices/${invoiceNumber}/rideId`).once('value');
            const rideId = invoiceSnap2.val();
            if (rideId) {
                await db.ref(`rides/${rideId}`).update({
                    invoiceSent: true,
                    invoiceSentAt: Date.now(),
                    invoiceSentVia: 'email',
                    invoiceSentTo: toEmail
                });
            }

            res.status(200).json({
                success: true,
                messageId: info.messageId,
                sentTo: toEmail
            });

        } catch (error) {
            console.error('❌ Email-Versand Fehler:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 📧 SMTP TEST — v6.21.0
// Testet SMTP-Verbindung mit Test-Email
// ═══════════════════════════════════════════════════════════════

exports.testSmtpConnection = onRequest(
    { region: 'europe-west1', invoker: 'public' },
    async (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        try {
            const smtpSnap = await db.ref('settings/smtp').once('value');
            const smtp = smtpSnap.val();

            if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
                res.status(400).json({ error: 'SMTP nicht konfiguriert' });
                return;
            }

            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: smtp.host,
                port: parseInt(smtp.port) || 587,
                secure: (parseInt(smtp.port) || 587) === 465,
                auth: { user: smtp.user, pass: smtp.pass }
            });

            // Verbindung testen
            await transporter.verify();

            // Test-Email an sich selbst senden
            const testTo = req.body?.testEmail || smtp.user;
            await transporter.sendMail({
                from: `"${smtp.fromName || 'Taxi Wydra'}" <${smtp.fromEmail || smtp.user}>`,
                to: testTo,
                subject: 'SMTP Test - Taxi App',
                html: '<div style="font-family:Arial;padding:20px;"><h2>&#x2705; SMTP funktioniert!</h2><p>Diese Test-Email wurde erfolgreich von deiner Taxi-App versendet.</p><p style="color:#6b7280;font-size:12px;">Gesendet am: ' + formatBerlinTime() + '</p></div>'
            });

            console.log(`📧 SMTP Test erfolgreich → ${testTo}`);
            res.status(200).json({ success: true, sentTo: testTo });

        } catch (error) {
            console.error('❌ SMTP Test Fehler:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
);

// ═══════════════════════════════════════════════════════════════
// 📧 CRM E-MAIL VERSAND — v6.27.1
// Sendet E-Mails aus dem CRM via SMTP mit optionalem Anhang
// ═══════════════════════════════════════════════════════════════

exports.sendCrmEmail = onRequest(
    { region: 'europe-west1', timeoutSeconds: 60, invoker: 'public' },
    async (req, res) => {
        // CORS
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            const {
                to,
                toName,
                subject,
                htmlBody,
                attachment  // Optional: { filename, content (base64), contentType }
            } = req.body;

            if (!to || !subject) {
                res.status(400).json({ error: 'to und subject sind erforderlich' });
                return;
            }

            // SMTP-Einstellungen aus Firebase laden
            const smtpSnap = await db.ref('settings/smtp').once('value');
            const smtp = smtpSnap.val();

            if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
                res.status(400).json({ error: 'SMTP nicht konfiguriert! Bitte unter CRM → Einstellungen → SMTP einrichten.' });
                return;
            }

            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: smtp.host,
                port: parseInt(smtp.port) || 587,
                secure: (parseInt(smtp.port) || 587) === 465,
                auth: { user: smtp.user, pass: smtp.pass }
            });

            // E-Mail-Optionen
            const mailOptions = {
                from: `"${smtp.fromName || 'Taxi Wydra'}" <${smtp.fromEmail || smtp.user}>`,
                to: toName ? `"${toName}" <${to}>` : to,
                subject: subject,
                html: htmlBody || `<p>${subject}</p>`
            };

            // Anhang hinzufügen wenn vorhanden
            if (attachment && attachment.content && attachment.filename) {
                mailOptions.attachments = [{
                    filename: attachment.filename,
                    content: Buffer.from(attachment.content, 'base64'),
                    contentType: attachment.contentType || 'application/octet-stream'
                }];
            }

            const info = await transporter.sendMail(mailOptions);
            console.log(`📧 CRM E-Mail gesendet → ${to} (${subject})`, info.messageId);

            // In emailLog speichern
            await db.ref('emailLog').push({
                type: 'crm-manual',
                to: to,
                subject: subject,
                sentAt: Date.now(),
                messageId: info.messageId,
                hasAttachment: !!(attachment && attachment.filename),
                attachmentName: attachment?.filename || null
            });

            res.status(200).json({ success: true, messageId: info.messageId });

        } catch (error) {
            console.error('❌ CRM E-Mail Fehler:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
);
