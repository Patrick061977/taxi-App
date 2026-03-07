/**
 * Firebase Cloud Function: Telegram Bot Webhook Handler
 * Funk Taxi Heringsdorf - 24/7 Telegram Bot
 *
 * Ersetzt das browser-basierte Polling durch einen serverseitigen Webhook.
 * Der Bot antwortet jetzt auch wenn kein Browser-Tab offen ist.
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();

// ═══════════════════════════════════════════════════════════════
// KONSTANTEN
// ═══════════════════════════════════════════════════════════════

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
    'pw-my-222-e': { name: 'Tesla Model Y', plate: 'PW-MY 222 E', capacity: 4 },
    'pw-ik-222': { name: 'Toyota Prius IK', plate: 'PW-IK 222', capacity: 4 },
    'pw-ki-222': { name: 'Toyota Prius II', plate: 'PW-KI 222', capacity: 4 },
    'pw-sk-222': { name: 'Renault Traffic 8 Pax', plate: 'PW-SK 222', capacity: 8 },
    'vg-lk-111': { name: 'Mercedes Vito 8 Pax', plate: 'VG-LK 111', capacity: 8 }
};

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
    // Exakt
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        if (!seen.has(c.id) && (c.name || '').toLowerCase() === normalized) { seen.add(c.id); results.push(c); }
    }
    // Partiell
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        const name = (c.name || '').toLowerCase();
        if (!seen.has(c.id) && (name.includes(normalized) || normalized.includes(name))) { seen.add(c.id); results.push(c); }
    }
    // Nachname
    for (const c of allCustomers) {
        if (results.length >= 5) break;
        const lastName = (c.name || '').toLowerCase().split(' ').pop();
        const searchLast = normalized.split(' ').pop();
        if (!seen.has(c.id) && lastName.length > 2 && (lastName === searchLast || lastName.includes(searchLast) || searchLast.includes(lastName))) { seen.add(c.id); results.push(c); }
    }
    return results.map(c => ({ name: c.name, phone: c.phone || c.mobile || '', address: c.address || '', defaultPickup: c.defaultPickup || '', customerId: c.id }));
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
                return cached;
            }
            // Cache-Eintrag außerhalb Usedom → löschen und neu geocodieren
            console.log(`[Geocode] Cache-Eintrag für "${address}" außerhalb Usedom (${cached.lat}, ${cached.lon}) → wird neu geocodiert`);
            try { await db.ref(cacheKey).remove(); } catch (e) {}
        }
    } catch (e) { /* Cache-Fehler ignorieren */ }

    try {
        // Nominatim-Ergebnisse durchsuchen: bevorzugt Usedom-Region
        const fetchAndValidate = async (url) => {
            const resp = await fetch(url, { headers: { 'User-Agent': 'TaxiHeringsdorf/1.0' } });
            const data = await resp.json();
            if (!data || !data.length) return null;

            // 1. Bevorzugt: Ergebnis in der Usedom-Region
            for (const item of data) {
                const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
                if (isNearUsedom(lat, lon)) {
                    console.log(`[Geocode] "${address}" → Usedom-Treffer: ${lat}, ${lon} (${item.display_name})`);
                    return { lat, lon, display_name: item.display_name };
                }
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
            if (addr.road) streetPart = addr.road + (addr.house_number ? ' ' + addr.house_number : '');
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

async function searchNominatimForTelegram(query) {
    if (!query) return [];
    const results = [];
    const searchKey = query.toLowerCase().trim();
    const fetchOpts = { headers: { 'User-Agent': 'TaxiHeringsdorf/1.0' } };

    // KNOWN_PLACES durchsuchen (Fuzzy: alle Suchworte müssen im Key oder Name vorkommen)
    const searchWords = searchKey.replace(/[,./]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    for (const [key, place] of Object.entries(KNOWN_PLACES)) {
        const placeName = (place.name || '').toLowerCase();
        const allWordsMatch = searchWords.length > 0 && searchWords.every(w => key.includes(w) || placeName.includes(w));
        if (key.includes(searchKey) || placeName.includes(searchKey) || allWordsMatch) {
            results.push({ name: place.name || key, lat: place.lat, lon: place.lon, source: 'known' });
        }
    }

    // 🆕 v6.11.4: POIs aus Firebase durchsuchen (wie Autocomplete)
    try {
        const poisSnap = await db.ref('pois').once('value');
        if (poisSnap.exists()) {
            poisSnap.forEach(child => {
                const poi = child.val();
                if (!poi.name || !poi.lat || !poi.lon) return;
                const poiName = poi.name.toLowerCase();
                const poiAddr = (poi.address || '').toLowerCase();
                if (poiName.includes(searchKey) || poiAddr.includes(searchKey) ||
                    (searchWords.length > 0 && searchWords.every(w => poiName.includes(w) || poiAddr.includes(w)))) {
                    const displayName = poi.address ? `${poi.name}, ${poi.address}` : poi.name;
                    results.push({ name: displayName, lat: poi.lat, lon: poi.lon, source: 'poi' });
                }
            });
        }
    } catch (e) { console.warn('POI-Suche Fehler:', e.message); }

    // 🆕 v6.11.4: Häufige Ziele aus letzten Buchungen (wie Autocomplete)
    try {
        const ridesSnap = await db.ref('rides').orderByChild('createdAt').limitToLast(200).once('value');
        const destCount = {};
        ridesSnap.forEach(child => {
            const ride = child.val();
            const dest = ride.destination;
            const lat = ride.destinationLat || (ride.destCoords && ride.destCoords.lat);
            const lon = ride.destinationLon || (ride.destCoords && ride.destCoords.lon);
            if (dest && lat && lon) {
                const key = dest.toLowerCase().trim();
                if (!destCount[key]) destCount[key] = { name: dest, lat, lon, count: 0 };
                destCount[key].count++;
            }
            // Auch Abholorte
            const pickup = ride.pickup;
            const pLat = ride.pickupLat || (ride.pickupCoords && ride.pickupCoords.lat);
            const pLon = ride.pickupLon || (ride.pickupCoords && ride.pickupCoords.lon);
            if (pickup && pLat && pLon) {
                const key = pickup.toLowerCase().trim();
                if (!destCount[key]) destCount[key] = { name: pickup, lat: pLat, lon: pLon, count: 0 };
                destCount[key].count++;
            }
        });
        // Sortiere nach Häufigkeit und matche gegen Suche
        const frequent = Object.values(destCount).sort((a, b) => b.count - a.count);
        for (const freq of frequent) {
            const freqName = freq.name.toLowerCase();
            if (freqName.includes(searchKey) ||
                (searchWords.length > 0 && searchWords.every(w => freqName.includes(w)))) {
                const alreadyExists = results.some(r =>
                    Math.abs(r.lat - freq.lat) < 0.001 && Math.abs(r.lon - freq.lon) < 0.001);
                if (!alreadyExists) {
                    results.push({ name: freq.name, lat: freq.lat, lon: freq.lon, source: 'booking' });
                }
            }
        }
    } catch (e) { console.warn('Buchungs-Suche Fehler:', e.message); }

    // 🆕 v6.11.4: Stammkunden mit Adressen (wie Autocomplete)
    try {
        const custSnap = await db.ref('customers').once('value');
        if (custSnap.exists()) {
            custSnap.forEach(child => {
                const c = child.val();
                if (!c.name || !c.address) return;
                const cName = c.name.toLowerCase();
                const cAddr = c.address.toLowerCase();
                if (cName.includes(searchKey) || cAddr.includes(searchKey) ||
                    (searchWords.length > 0 && searchWords.every(w => cName.includes(w) || cAddr.includes(w)))) {
                    const lat = c.lat || c.pickupLat;
                    const lon = c.lon || c.pickupLon;
                    if (lat && lon) {
                        const alreadyExists = results.some(r =>
                            Math.abs(r.lat - lat) < 0.001 && Math.abs(r.lon - lon) < 0.001);
                        if (!alreadyExists) {
                            results.push({ name: `${c.name}, ${c.address}`, lat, lon, source: 'customer' });
                        }
                    }
                }
            });
        }
    } catch (e) { console.warn('Kunden-Suche Fehler:', e.message); }

    // 🆕 v6.11.4: Nominatim API – gleiche Qualität wie Autocomplete in index.html
    // Größere Viewbox, mehr Ergebnisse, extratags+namedetails für POI-Namen
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
        const seen = new Set(results.map(r => `${r.lat.toFixed(3)}_${r.lon.toFixed(3)}`));

        // Usedom-Ergebnisse zuerst, dann allgemeine, dann weite Suche
        const allItems = [...usedomData, ...generalData, ...wideData];
        // Sortiere: Usedom-Region zuerst
        allItems.sort((a, b) => {
            const aUsedom = isNearUsedom(parseFloat(a.lat), parseFloat(a.lon)) ? 0 : 1;
            const bUsedom = isNearUsedom(parseFloat(b.lat), parseFloat(b.lon)) ? 0 : 1;
            return aUsedom - bUsedom;
        });

        for (const item of allItems) {
            const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
            const coordKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
            if (!seen.has(coordKey)) {
                seen.add(coordKey);
                const addr = item.address || {};
                const poiName = item.name || '';
                const road = addr.road || '';
                const houseNr = addr.house_number || '';
                const town = addr.town || addr.city || addr.village || addr.municipality || '';
                const postcode = addr.postcode || '';
                // Vollständige Adresse bauen: POI-Name + Straße + Hausnr + PLZ + Ort
                let streetPart = road ? (road + (houseNr ? ' ' + houseNr : '')) : '';
                let displayName;
                if (poiName && streetPart && !poiName.includes(road)) {
                    // POI mit Straße: "Café Asgard, Strandpromenade 15, 17429 Bansin"
                    displayName = `${poiName}, ${streetPart}` + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
                } else if (streetPart) {
                    // Nur Straße: "Dünenweg 8, 17424 Heringsdorf"
                    displayName = streetPart + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
                } else if (poiName) {
                    // Nur POI-Name (kein Straßenname verfügbar)
                    displayName = poiName + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
                } else {
                    displayName = item.display_name.split(',').slice(0, 3).join(',').trim();
                }
                results.push({ name: displayName, lat, lon, source: 'nominatim' });
            }
        }
    } catch (e) { console.warn('Nominatim Fehler:', e); }

    return results.slice(0, 5);
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

function parseGermanDatetime(datetimeStr) {
    if (!datetimeStr) return Date.now();
    const d = new Date(datetimeStr);
    if (isNaN(d.getTime())) return Date.now();
    // If already has explicit timezone suffix (Z or +/-offset), use as-is
    if (typeof datetimeStr === 'string' && (datetimeStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(datetimeStr))) {
        return d.getTime();
    }
    // Treat as Europe/Berlin: compute offset and correct
    const berlinStr = d.toLocaleString('en-US', { timeZone: 'Europe/Berlin' });
    const berlinAsUTC = new Date(berlinStr);
    const offsetMs = berlinAsUTC.getTime() - d.getTime();
    return d.getTime() - offsetMs;
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
                const keyboard = {
                    inline_keyboard: [
                        ...suggestions.map((s, i) => [{ text: `📍 ${s.name}`, callback_data: `${prefix}_${i}` }]),
                        [{ text: '✏️ Andere Adresse eingeben', callback_data: `addr_retry_${fieldToResolve}` }],
                        [{ text: '⏩ Weiter ohne Preis', callback_data: 'addr_skip' }]
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
                            ...simSuggestions.map((s, i) => [{ text: `📍 ${s.name}`, callback_data: `${prefix}_${i}` }]),
                            [{ text: '✏️ Andere Adresse eingeben', callback_data: `addr_retry_${fieldToResolve}` }],
                            [{ text: '⏩ Weiter ohne Preis', callback_data: 'addr_skip' }]
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
        const jsonText = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(jsonText);
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

    const knownCustomer = preselected ? null : (isAdmin ? null : await getTelegramCustomer(chatId));
    const prefilledName = preselected ? preselected.name : (knownCustomer ? knownCustomer.name : (isAdmin ? forCustomerName : userName));
    const prefilledPhone = preselected ? (preselected.phone || null) : (knownCustomer ? (knownCustomer.phone || knownCustomer.mobile || null) : null);
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

    try {
        const data = await callAnthropicAPI(apiKey, 'claude-haiku-4-5-20251001', 800, [{
            role: 'user',
            content: `Du bist die Telefonzentrale von "Funk Taxi Heringsdorf" auf Usedom.
Ein Fahrgast schreibt per Telegram. Deine Aufgabe: Buchungsdaten extrahieren und fehlende Infos freundlich erfragen.

FAHRGAST-NACHRICHT: "${text}"
${prefilledName ? `BEKANNTER KUNDE: ${prefilledName}${prefilledPhone ? ` | Tel: ${prefilledPhone}` : ''}` : ''}
${homeAddressHint ? `HEIMADRESSE: "${homeAddressHint}" → bei "zu Hause" / "von zu Hause" verwenden` : ''}

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

TELEFON: 0157... → +49157... | bereits bekannte Nummer nicht erneut fragen

━━━ SCHRITT 3: FEHLENDE PFLICHTFELDER ━━━
Pflicht: datetime, pickup, destination${phoneRequired ? ', phone' : ''}
Optional (NICHT in missing): passengers (default 1), notes${!phoneRequired ? ' | phone ist gespeichert – nicht fragen' : ''}

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
  "passengers": 1,
  "name": "${prefilledName || (isAdmin ? 'Admin' : userName)}",
  "phone": ${prefilledPhone ? `"${prefilledPhone}"` : 'null'},
  "notes": null,${isAdmin ? '\n  "forCustomer": null,' : ''}
  "missing": ["datetime", "pickup", "destination"${phoneRequired ? ', "phone"' : ''}],
  "question": "Für wann und von wo nach wo soll die Fahrt gehen?",
  "summary": "Kurze Zusammenfassung der Buchung"
}`
        }]);

        const textContent = data.content.find(c => c.type === 'text')?.text || '';
        let jsonText = textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const booking = JSON.parse(jsonText);

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
                booking.phone = preselected.phone || booking.phone;
                booking._customerAddress = preselected.address;
                booking._forCustomer = preselected.name;
                booking._crmCustomerId = preselected.customerId || null;
                if (preselected.phone && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');
                const pickupDefault = preselected.defaultPickup || preselected.address;
                if (pickupDefault) {
                    if (!booking.pickup || /^(zu hause|zuhause|von zu hause|von zuhause)$/i.test((booking.pickup || '').trim())) {
                        booking.pickup = pickupDefault;
                        booking.missing = (booking.missing || []).filter(f => f !== 'pickup');
                    }
                    if (preselected.address && /^(zu hause|zuhause|nach hause)$/i.test((booking.destination || '').trim())) {
                        booking.destination = preselected.address;
                        booking.missing = (booking.missing || []).filter(f => f !== 'destination');
                    }
                }
            } else if (forCustomerName) {
                booking.name = forCustomerName;
                booking._forCustomer = forCustomerName;
                booking._crmCustomerId = null;
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
                    if (found.phone) confirmMsg += `📱 ${found.phone}\n`;
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
                    if (!booking.phone) {
                        booking.missing = booking.missing || [];
                        if (!booking.missing.includes('phone')) booking.missing.push('phone');
                    }
                }
            }
        }

        // 🆕 Vorausgefüllte Koordinaten aus Favoriten übernehmen (überspringt Adress-Bestätigung)
        const prefilledCoords = options.prefilledCoords || null;
        if (prefilledCoords) {
            if (prefilledCoords.pickupLat && prefilledCoords.pickupLon) {
                booking.pickupLat = prefilledCoords.pickupLat;
                booking.pickupLon = prefilledCoords.pickupLon;
            }
            if (prefilledCoords.destinationLat && prefilledCoords.destinationLon) {
                booking.destinationLat = prefilledCoords.destinationLat;
                booking.destinationLon = prefilledCoords.destinationLon;
            }
            await addTelegramLog('📍', chatId, `Koordinaten aus Favoriten: Pickup(${booking.pickupLat?.toFixed?.(4) || '–'}, ${booking.pickupLon?.toFixed?.(4) || '–'}) → Dest(${booking.destinationLat?.toFixed?.(4) || '–'}, ${booking.destinationLon?.toFixed?.(4) || '–'})`);
        }

        // Defensive missing-Prüfung
        if (!booking.missing) booking.missing = [];
        if (!booking.pickup && !booking.missing.includes('pickup')) booking.missing.push('pickup');
        if (!booking.destination && !booking.missing.includes('destination')) booking.missing.push('destination');
        if (!booking.datetime && !booking.missing.includes('datetime')) booking.missing.push('datetime');

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
                    const keyboard = {
                        inline_keyboard: [
                            ...suggestions.map((s, i) => [{ text: `📍 ${s.name}`, callback_data: `${prefix}_${i}` }]),
                            [{ text: '✏️ Andere Adresse eingeben', callback_data: `addr_retry_${fieldToResolve}` }],
                            [{ text: '❌ Abbrechen', callback_data: 'cancel_booking' }]
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
                const fallbacks = { datetime: 'Für wann soll ich das Taxi bestellen? Bitte mit Datum und Uhrzeit.', pickup: 'Von welcher Adresse holen wir ab?', destination: 'Wohin geht die Fahrt?', phone: 'Welche Telefonnummer hat der Kunde?' };
                msg += `💬 ${fallbacks[firstMissing] || 'Können Sie mir noch mehr Details geben?'}`;
            }
            // 🆕 v6.11.3: Inline-Buttons für GPS-Standort, Kundenadresse und Abbrechen
            const _inlineButtons = [];
            const _firstMissing = (booking.missing && booking.missing.length > 0) ? booking.missing[0] : null;

            // GPS-Standort-Button bei Abholort oder Ziel
            if (_firstMissing === 'pickup' || _firstMissing === 'destination') {
                msg += '\n\n📍 <i>Tipp: Sie können auch Ihren Standort über die Telegram-Büroklammer 📎 teilen!</i>';
            }

            // Kunden-Adresse als Quick-Button (wenn bekannt und Abholort fehlt)
            if (_firstMissing === 'pickup' && !booking._adminBooked) {
                const _knownCust = await getTelegramCustomer(chatId);
                if (_knownCust && _knownCust.address) {
                    _inlineButtons.push([{ text: '🏠 ' + (_knownCust.address.length > 35 ? _knownCust.address.substring(0, 33) + '…' : _knownCust.address), callback_data: 'use_home_pickup' }]);
                }
                // Favoriten-Ziele als Abholort (letzte bekannte Orte)
                if (_knownCust && _knownCust.customerId) {
                    try {
                        const _custSnap = await db.ref('customers/' + _knownCust.customerId).once('value');
                        const _custData = _custSnap.val();
                        if (_custData && _custData.defaultPickup && _custData.defaultPickup !== _knownCust.address) {
                            _inlineButtons.push([{ text: '📍 ' + (_custData.defaultPickup.length > 35 ? _custData.defaultPickup.substring(0, 33) + '…' : _custData.defaultPickup), callback_data: 'use_default_pickup' }]);
                        }
                    } catch(_e) { /* ignore */ }
                }
            }

            // Favoriten-Ziele als Quick-Buttons (wenn Ziel fehlt)
            if (_firstMissing === 'destination' && !booking._adminBooked) {
                const _knownCust2 = await getTelegramCustomer(chatId);
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
            }

            // Menü + Abbrechen als letzte Zeile
            _inlineButtons.push([
                { text: '🏠 Menü', callback_data: 'back_to_menu' },
                { text: '❌ Abbrechen', callback_data: 'cancel_booking' }
            ]);

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
• passengers:  ${_pPax}
• name:        ${_pName}
• phone:       ${_pPhone || '— fehlt'}${_pNotes ? `\n• notes: ${_pNotes}` : ''}${_pFor !== undefined ? `\n• forCustomer: ${_pFor || '—'}` : ''}

NOCH FEHLEND: ${_missingNow.length > 0 ? _missingNow.join(', ') : '✅ alles vollständig'}
${lastQuestion ? `ZULETZT GEFRAGT: "${lastQuestion}"` : ''}

NEUE ANTWORT: "${newText}"

REGELN:
1. FELD-ZUORDNUNG: Die Antwort füllt das erste fehlende Feld ("${_missingNow[0] || 'keines'}"), außer der Fahrgast benennt explizit ein anderes
2. BESTEHENDE FELDER: Nie überschreiben, außer Fahrgast korrigiert explizit
3. DATUM: ISO YYYY-MM-DDTHH:MM | heute=${new Date().toISOString().slice(0, 10)} | morgen=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)} | nur Uhrzeit → Datum=heute | nur Datum → datetime=null+missing | KEIN Datum/Uhrzeit in Antwort → datetime NICHT setzen, in missing lassen! | nie 00:00!
4. HEIMADRESSE: ${followUpHomeAddress ? `"${followUpHomeAddress}" → bei "zu Hause"/"nach Hause" verwenden` : 'unbekannt → frage "Welche Adresse ist Ihr Zuhause?"'}
5. UNKLARE ORTE → kurz nachfragen
6. NUR ORTSNAME ohne Straße (z.B. "Bansin", "Ahlbeck") → Ort übernehmen, aber in question nach genauer Adresse fragen
7. ABBRECHEN: Wenn der Fahrgast "abbrechen", "stop", "nein danke", "doch nicht" sagt → setze intent auf "cancel"

Nur gültiges JSON, kein Markdown:
{
  "datetime": ${_pDatetime ? `"${_pDatetime}"` : 'null'},
  "pickup": ${_pPickup ? `"${_pPickup}"` : 'null'},
  "destination": ${_pDest ? `"${_pDest}"` : 'null'},
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
        let jsonText = textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const booking = JSON.parse(jsonText);

        // Schutzmaßnahmen
        if (partial.phone) booking.phone = partial.phone;
        if (partial.name && partial._crmCustomerId) booking.name = partial.name;

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

        if (isAdminFollowUp && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');

        await addTelegramLog('🤖', chatId, 'Follow-Up Antwort', { summary: booking.summary, missing: booking.missing });

        // Admin-Flags übertragen
        if (isAdminFollowUp) {
            booking._adminBooked = partial._adminBooked || true;
            booking._adminChatId = partial._adminChatId || chatId;
            booking._forCustomer = booking._forCustomer || booking.forCustomer || partial._forCustomer;
            booking._customerAddress = partial._customerAddress;
            if (partial._crmCustomerId !== undefined) booking._crmCustomerId = partial._crmCustomerId;
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

async function askPassengersOrConfirm(chatId, booking, routePrice, originalText) {
    // 🔧 v6.11.0: Adressen sauber validieren (POI-Namen durch vollständige Adressen ersetzen)
    if (booking.pickup && booking.pickupLat && booking.pickupLon) {
        booking.pickup = await cleanupAddress(booking.pickup, booking.pickupLat, booking.pickupLon);
    }
    if (booking.destination && booking.destinationLat && booking.destinationLon) {
        booking.destination = await cleanupAddress(booking.destination, booking.destinationLat, booking.destinationLon);
    }

    // Sicherheitscheck: datetime muss gesetzt sein bevor Buchung bestätigt werden kann
    if (!booking.datetime) {
        await addTelegramLog('🛡️', chatId, 'Datum fehlt → zurück zur Abfrage');
        if (!booking.missing) booking.missing = [];
        if (!booking.missing.includes('datetime')) booking.missing.push('datetime');
        const noted = [];
        if (booking.pickup) noted.push(`📍 Von: ${booking.pickup}`);
        if (booking.destination) noted.push(`🎯 Nach: ${booking.destination}`);
        let msg = '';
        if (noted.length > 0) msg += `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;
        msg += '💬 Für wann soll ich das Taxi bestellen? Bitte mit Datum und Uhrzeit.\n\n<i>/abbrechen zum Zurücksetzen</i>';
        await setPending(chatId, { partial: booking, originalText, lastQuestion: 'Für wann soll ich das Taxi bestellen?' });
        await sendTelegramMessage(chatId, msg);
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
                { text: '🏠 Menü', callback_data: 'back_to_menu' },
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
        const dt = new Date(parseGermanDatetime(booking.datetime));
        msg += `📅 ${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${dt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr\n`;
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
    keyboard.inline_keyboard.push([
        { text: '✅ Ja, eintragen!', callback_data: `book_yes_${bookingId}` },
        { text: '✏️ Ändern', callback_data: `book_no_${bookingId}` }
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
    // Menü + Abbrechen unten
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
            const cPhone = (c.phone || c.mobile || '').replace(/\D/g, '');
            if (digits && digits.length > 5 && cPhone.endsWith(digits.slice(-9))) {
                customerId = child.key;
                customerData = c;
            }
        });

        if (customerId && customerData) {
            await saveTelegramCustomer(chatId, {
                customerId, name: customerData.name || name,
                phone: customerData.phone || phone,
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
        buttons.push([{ text: '🏠 Menü', callback_data: 'back_to_menu' }]);

        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Abrufen der Buchungen.');
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
        keyboard.push([
            { text: '◀ Zurück zur Liste', callback_data: 'adm_rides_today' },
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
        const knownCustomer = await getTelegramCustomer(chatId);
        let greeting = '🚕 <b>Funk Taxi Heringsdorf</b>\n\n';
        if (knownCustomer) {
            greeting += `👋 Hallo <b>${knownCustomer.name}</b>! Schön, Sie wieder zu sehen.\n`;
            greeting += `📱 ${knownCustomer.phone || 'Telefon gespeichert'}\n\n`;
        } else {
            greeting += '👋 Herzlich willkommen! Ich bin Ihr <b>interaktiver Taxibot</b> für die Insel Usedom.\n\n';
        }
        greeting += '<b>Das kann ich für Sie tun:</b>\n';
        greeting += '🚕 <b>Fahrt buchen</b> – Schreiben oder sprechen Sie einfach wann und wohin\n';
        greeting += '🎙️ <b>Sprachnachricht</b> – Sagen Sie z.B. "Morgen 10 Uhr vom Bahnhof nach Ahlbeck"\n';
        greeting += '📊 <b>Fahrten ansehen</b> – Ihre gebuchten Fahrten einsehen\n';
        greeting += '✏️ <b>Fahrten bearbeiten</b> – Zeit, Adresse oder Details ändern\n';
        greeting += '🗑️ <b>Fahrten stornieren</b> – Buchungen absagen\n\n';
        greeting += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>';
        greeting += '\n\n📞 <b>Fragen?</b> Rufen Sie uns an: <b>038378 / 22022</b>';
        if (!knownCustomer) {
            greeting += '\n\n📱 <i>Tipp: Teilen Sie einmalig Ihre Telefonnummer, damit wir Sie beim nächsten Mal sofort erkennen.</i>';
        }
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: '✏️ Fahrt ändern', callback_data: 'menu_aendern' }],
            [{ text: '🗑️ Fahrt stornieren', callback_data: 'menu_loeschen' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        await sendTelegramMessage(chatId, greeting, { reply_markup: keyboard });
        if (!knownCustomer) {
            await sendTelegramMessage(chatId, '📱 <b>Telefonnummer teilen</b> – einmalig, damit wir Sie sofort erkennen:', {
                reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            });
        }
        return;
    }

    if (textCmd === '/buchen') {
        let msg = '🚕 <b>Neue Fahrt buchen</b>\n\n✍️ Schreiben oder 🎙️ sprechen Sie mir einfach Ihre Fahrtwünsche:\n\n• <i>Jetzt vom Bahnhof Heringsdorf nach Ahlbeck</i>\n• <i>Morgen 10 Uhr Hotel Maritim → Flughafen BER</i>\n• <i>Freitag 14:30 Seebrücke Bansin nach Zinnowitz, 3 Personen</i>\n\n<i>Ich analysiere Ihre Nachricht automatisch.</i>';
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
        await sendTelegramMessage(chatId, hilfeMsg);
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
        let profilMsg = '👤 <b>Mein Profil</b>\n\n';
        profilMsg += `📛 Name: <b>${knownCustomer.name || '—'}</b>\n`;
        profilMsg += `📱 Telefon: <b>${knownCustomer.phone || '—'}</b>\n`;
        profilMsg += `🏠 Adresse: <b>${knownCustomer.address || 'nicht hinterlegt'}</b>\n`;
        profilMsg += '\n<i>Tippen Sie auf einen Button um Ihre Daten zu ändern:</i>';
        await sendTelegramMessage(chatId, profilMsg, { reply_markup: { inline_keyboard: [
            [{ text: '📛 Name ändern', callback_data: 'profil_edit_name' }],
            [{ text: '📱 Telefon ändern', callback_data: 'profil_edit_phone' }],
            [{ text: '🏠 Adresse ändern', callback_data: 'profil_edit_address' }]
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
        const matches = findAllCustomersForSecretary(allCust, customerName);
        if (matches.length === 1) {
            const found = matches[0];
            const confirmId = Date.now().toString(36);
            await setPending(chatId, { awaitingAdminCrmConfirm: true, originalText: pending.originalText, userName: pending.userName, crmConfirm: { found, confirmId }, customerName });
            let confirmMsg = `🔍 <b>Kunde im CRM gefunden:</b>\n\n👤 <b>${found.name}</b>\n`;
            if (found.phone) confirmMsg += `📱 ${found.phone}\n`;
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
            await deletePending(chatId);
            await sendTelegramMessage(chatId, `🔍 <i>"${customerName}" nicht im CRM.</i>\n🤖 <i>Analysiere Buchung...</i>`);
            await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, { isAdmin: true, forCustomerName: customerName });
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
                            await db.ref(`rides/${rideId}`).update({
                                pickupTimestamp: newTimestamp,
                                pickupTime: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
                                editedAt: Date.now(), editedBy: 'telegram-customer'
                            });
                            await addTelegramLog('✏️', chatId, `Kunde: Zeit geändert auf ${hours}:${String(mins).padStart(2, '0')}`);
                            await sendTelegramMessage(chatId, `✅ <b>Uhrzeit geändert!</b>\n\nNeue Zeit: <b>${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} Uhr</b>\n\n<i>Wir freuen uns auf Sie!</i>`);
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
                    const keyboard = suggestions.map((s, i) => [{ text: `📍 ${s.name}`, callback_data: `cust_asel_${i}_${rideId}_${field}` }]);
                    keyboard.push([{ text: '✖ Abbrechen', callback_data: `cust_edit_${rideId}` }]);
                    await setPending(chatId, { _custAddrResults: suggestions, _custAddrRaw: text, _custAddrRide: rideId, _custAddrField: field });
                    await addTelegramLog('🔍', chatId, `Kunde: ${label} "${text}" → ${suggestions.length} Vorschläge`);
                    await sendTelegramMessage(chatId, `🔍 <b>${label}: "${text}"</b>\n\nBitte wählen Sie die korrekte Adresse:`, { reply_markup: { inline_keyboard: keyboard } });
                } else {
                    // Keine Ergebnisse → Geocode-Fallback
                    const geo = await geocode(text);
                    const update = { editedAt: Date.now(), editedBy: 'telegram-customer', [field]: text };
                    let geoNote = '';
                    if (geo) {
                        update[field + 'Lat'] = geo.lat; update[field + 'Lon'] = geo.lon;
                        update[field === 'pickup' ? 'pickupCoords' : 'destCoords'] = { lat: geo.lat, lon: geo.lon };
                    } else {
                        geoNote = '\n\n⚠️ <i>Adresse konnte nicht verifiziert werden. Bitte prüfe Schreibweise.</i>';
                    }
                    await db.ref(`rides/${rideId}`).update(update);
                    await addTelegramLog('✏️', chatId, `Kunde: ${label} geändert auf "${text}"${geo ? '' : ' (nicht geocodiert)'}`);
                    await sendTelegramMessage(chatId, `✅ <b>${label} geändert!</b>\n\nNeu: <b>${text}</b>${geoNote}\n\n<i>Wir freuen uns auf Sie!</i>`);
                }
            } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
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
                    const keyboard = suggestions.map((s, i) => [{ text: `📍 ${s.name}`, callback_data: `adm_addr_${i}_${rideId}_${field}` }]);
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
        welcomeMsg += '🗑️ <b>Fahrten stornieren</b> – Buchungen absagen\n\n';
        welcomeMsg += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>\n\n';
        welcomeMsg += '📞 <b>Fragen?</b> Rufen Sie uns an: <b>038378 / 22022</b>\n\n';
        welcomeMsg += '📱 <i>Tipp: Teilen Sie einmalig Ihre Telefonnummer, damit wir Sie beim nächsten Mal sofort erkennen.</i>';
        const welcomeKeyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
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
        await sendTelegramMessage(chatId, '🚕 <b>Neue Fahrt buchen</b>\n\nSchreiben Sie mir einfach Ihre Fahrtwünsche:\n\n• <i>Jetzt vom Bahnhof Heringsdorf nach Ahlbeck</i>\n• <i>Morgen 10 Uhr Hotel Maritim → Flughafen BER</i>\n• <i>Freitag 14:30 Seebrücke Bansin nach Zinnowitz, 3 Personen</i>\n\n<i>Ich analysiere Ihre Nachricht automatisch.</i>');
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
        await addTelegramLog('👔', chatId, 'Admin erkannt → Frage: Für Kunden oder für sich selbst?');
        await setPending(chatId, { taxiChoice: { text, userName } });
        await sendTelegramMessage(chatId, '🚕 <b>Neue Buchung</b>\n\nMöchtest du für einen Kunden buchen oder für dich selber?', {
            reply_markup: { inline_keyboard: [
                [{ text: '👤 Für einen Kunden', callback_data: 'taxi_for_customer' }],
                [{ text: '🙋 Für mich selber', callback_data: 'taxi_for_self' }]
            ]}
        });
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
        await sendTelegramMessage(chatId, '🚕 <b>Neue Fahrt buchen</b>\n\nSchreiben Sie mir einfach Ihre Fahrtwünsche:\n\n• <i>Jetzt vom Bahnhof Heringsdorf nach Ahlbeck</i>\n• <i>Morgen 10 Uhr Hotel Maritim → Flughafen BER</i>\n\n<i>Ich analysiere Ihre Nachricht automatisch.</i>');
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
        hilfeMsg += '👤 <b>Profil verwalten</b> – Name, Telefon, Adresse\n\n';
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
        await sendTelegramMessage(chatId, hilfeMsg);
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
        let msg = '👤 <b>Mein Profil</b>\n\n';
        msg += `📛 Name: <b>${knownCustomer.name || '—'}</b>\n`;
        msg += `📱 Telefon: <b>${knownCustomer.phone || '—'}</b>\n`;
        msg += `🏠 Adresse: <b>${knownCustomer.address || 'nicht hinterlegt'}</b>\n`;
        msg += '\n<i>Tippen Sie auf einen Button um Ihre Daten zu ändern:</i>';
        await sendTelegramMessage(chatId, msg, { reply_markup: { inline_keyboard: [
            [{ text: '📛 Name ändern', callback_data: 'profil_edit_name' }],
            [{ text: '📱 Telefon ändern', callback_data: 'profil_edit_phone' }],
            [{ text: '🏠 Adresse ändern', callback_data: 'profil_edit_address' }]
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
            await setPending(chatId, { awaitingCustomerName: true, originalText: text, userName });
            await sendTelegramMessage(chatId, '👤 <b>Für welchen Kunden?</b>\n\nBitte den Kundennamen eingeben:');
        }
        return;
    }

    // Buchung trotz Zeitkonflikt eintragen (Override)
    if (data.startsWith('book_force_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.booking) {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden. Bitte nochmal senden.');
            return;
        }
        pending._conflictOverride = true;
        await setPending(chatId, pending);
        await addTelegramLog('⚡', chatId, 'Zeitkonflikt-Override: Buchung wird trotzdem eingetragen');
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
            const isVorbestellung = minutesUntilPickup > 30;
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

            // Preis: gespeicherten verwenden, nur als Fallback neu berechnen
            let telegramRoutePrice = pending.routePrice || null;
            if (!telegramRoutePrice && booking.pickupLat && booking.destinationLat) {
                try { telegramRoutePrice = await calculateTelegramRoutePrice(booking); } catch (e) {}
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
                notes: booking.notes && booking.notes !== 'null' ? booking.notes : '',
                status: isVorbestellung ? 'vorbestellt' : 'open',
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
            const returnKeyboard = { inline_keyboard: [
                [{ text: '🔄 Rückfahrt buchen', callback_data: `return_${rideData.id}` }],
                [{ text: '📋 Meine Buchungen', callback_data: 'cmd_meine' }]
            ]};
            await sendTelegramMessage(chatId,
                successHeader +
                `📅 ${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' })} um ${timeStr} Uhr\n` +
                `📍 ${rideData.pickup} → ${rideData.destination}\n` +
                `👤 ${rideData.customerName}` + (rideData.customerPhone ? ` · 📱 ${rideData.customerPhone}` : '') + '\n' +
                `👥 ${passengers} Person(en)\n` +
                (telegramRoutePrice ? `🗺️ ca. ${telegramRoutePrice.distance} km (~${telegramRoutePrice.duration} Min)\n💰 ca. ${telegramRoutePrice.price} €\n` : '') +
                `📋 Status: ${isVorbestellung ? 'Vorbestellt' : 'Offen'}\n\n✅ Fahrt ist im System!`,
                { reply_markup: returnKeyboard }
            );

            await addTelegramLog('💾', chatId, `Fahrt erstellt: ${rideData.pickup} → ${rideData.destination}`, { rideId: rideData.id });
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
                        if (booking._adminBooked && String(adminChatId) === String(chatId)) continue; // Sich selbst überspringen
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

            // Admin CRM-Anlage anbieten
            if (booking._adminBooked && booking._forCustomer && booking._crmCustomerId === null) {
                try {
                    await db.ref('settings/telegram/pending/crm_' + chatId).set({
                        customerName: booking._forCustomer || booking.name,
                        customerPhone: booking.phone || '',
                        pickupAddress: booking.pickup || '',
                        rideId: rideData.id
                    });
                    const pickupHint = booking.pickup
                        ? `\n📍 Abholadresse: <i>${booking.pickup}</i>\n\nSoll diese Adresse als <b>Wohnanschrift</b> gespeichert werden?`
                        : `\n\nSoll ich diesen Kunden im CRM anlegen?`;
                    await sendTelegramMessage(chatId,
                        `👤 <b>${booking._forCustomer}</b> ist noch nicht im CRM.\n📱 ${booking.phone || '(keine Angabe)'}` + pickupHint,
                        { reply_markup: { inline_keyboard: [
                            booking.pickup ? [
                                { text: '✅ Mit Wohnanschrift', callback_data: `crm_create_yes_${rideData.id}` },
                                { text: '📋 Ohne Adresse', callback_data: `crm_create_yesnoaddr_${rideData.id}` }
                            ] : [{ text: '✅ Im CRM anlegen', callback_data: `crm_create_yesnoaddr_${rideData.id}` }],
                            [{ text: '❌ Nein', callback_data: `crm_create_no_${rideData.id}` }]
                        ]}}
                    );
                } catch (e) {}
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
                '💡 Der Zwischenstopp wird zwischen Abholort und Zielort eingefügt.'
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
            await sendTelegramMessage(chatId, '📝 <b>Bemerkung zur Fahrt</b>\n\nBitte schreiben Sie Ihre Bemerkung:\n<i>z.B. Kindersitz, Rollstuhl, großer Koffer, Hund, etc.</i>');
        } else {
            await sendTelegramMessage(chatId, '⚠️ Buchung nicht mehr gefunden. Bitte nochmal senden.');
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
                    [{ text: '⏰ Zeit', callback_data: `change_time_${noBookingId}` }, { text: '📍 Abholort', callback_data: `change_pickup_${noBookingId}` }],
                    [{ text: '🎯 Ziel', callback_data: `change_dest_${noBookingId}` }, { text: '↩️ Zurück', callback_data: `back_to_confirm_${noBookingId}` }],
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

    if (data.startsWith('discard_')) {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '👍 OK, Buchung verworfen.');
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
            [{ text: '🗑️ Fahrt stornieren', callback_data: 'menu_loeschen' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        await sendTelegramMessage(chatId, greeting, { reply_markup: keyboard });
        return;
    }

    // 🆕 v6.11.3: Abbrechen-Button (überall in der Konversation)
    if (data === 'cancel_booking') {
        await deletePending(chatId);
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }]
        ]};
        await sendTelegramMessage(chatId, '🔄 Buchung abgebrochen.\n\n💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>', { reply_markup: keyboard });
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
                if (_homeBooking.missing) _homeBooking.missing = _homeBooking.missing.filter(m => m !== 'pickup');
                await sendTelegramMessage(chatId, '✅ Abholort gesetzt: <b>' + _homeAddr + '</b>');
                await continueBookingFlow(chatId, _homeBooking, _homePending.originalText || '');
            } else {
                await sendTelegramMessage(chatId, '⚠️ Adresse nicht gefunden. Bitte tippen Sie den Abholort ein.');
            }
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
        if (fav.destinationLat && fav.destinationLon) {
            prefilledCoords.destinationLat = fav.destinationLat;
            prefilledCoords.destinationLon = fav.destinationLon;
        } else if (fav.destination) {
            const destGeo = await geocode(fav.destination);
            if (destGeo) {
                prefilledCoords.destinationLat = destGeo.lat;
                prefilledCoords.destinationLon = destGeo.lon;
            }
        }
        if (pickup && fav.pickupLat && fav.pickupLon) {
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
            await sendTelegramMessage(chatId, `🔄 <b>Rückfahrt:</b> ${origRide.destination} → ${origRide.pickup}\n\n🤖 <i>Wann soll die Rückfahrt sein?</i>\n\n💡 Schreibe einfach die Uhrzeit (z.B. "18:00") oder "heute 18 Uhr"`);
            // Pending mit vorausgefüllten Adressen erstellen
            const returnBooking = {
                pickup: origRide.destination,
                destination: origRide.pickup,
                name: origRide.customerName || '',
                phone: origRide.customerPhone || '',
                // Koordinaten tauschen
                pickupLat: origRide.destinationLat || origRide.destCoords?.lat || null,
                pickupLon: origRide.destinationLon || origRide.destCoords?.lon || null,
                destinationLat: origRide.pickupLat || origRide.pickupCoords?.lat || null,
                destinationLon: origRide.pickupLon || origRide.pickupCoords?.lon || null,
                missing: ['datetime'],
                _returnOf: origRideId
            };
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
            const update = { editedAt: Date.now(), editedBy: 'telegram-customer' };
            update[field] = selected.name;
            update[field + 'Lat'] = selected.lat;
            update[field + 'Lon'] = selected.lon;
            update[field === 'pickup' ? 'pickupCoords' : 'destCoords'] = { lat: selected.lat, lon: selected.lon };
            await db.ref(`rides/${rideId}`).update(update);
            const label = field === 'pickup' ? 'Abholort' : 'Zielort';
            await addTelegramLog('✏️', chatId, `Kunde: ${label} geändert auf "${selected.name}"`);
            await sendTelegramMessage(chatId, `✅ <b>${label} geändert!</b>\n\nNeu: <b>${selected.name}</b>\n\n<i>Wir freuen uns auf Sie!</i>`);
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

    // Kunden: Zeit per Button setzen
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
            await db.ref(`rides/${rideId}`).update({
                pickupTimestamp: newTs, pickupTime: newTime,
                editedAt: Date.now(), editedBy: 'telegram-customer'
            });
            await addTelegramLog('✏️', chatId, `Kunde: Zeit geändert auf ${newTime}`);
            await sendTelegramMessage(chatId, `✅ <b>Uhrzeit geändert!</b>\n\nNeue Zeit: <b>${newTime} Uhr</b>\n\n<i>Wir freuen uns auf Sie!</i>`);
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
            await sendTelegramMessage(chatId, `✅ <b>Fahrt storniert!</b>\n\n📍 ${r ? r.pickup : '?'} → ${r ? r.destination : '?'}\n\n<i>Möchten Sie ein neues Taxi? Schreiben Sie einfach wann und wohin!</i>`);

            // Admin benachrichtigen
            try {
                const adminSnap = await db.ref('settings/telegram/adminChats').once('value');
                const adminChats = adminSnap.val() || [];
                const dt = new Date(r.pickupTimestamp || 0);
                const timeStr = dt.toLocaleString('de-DE', { ...TZ_BERLIN, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                for (const adminChatId of adminChats) {
                    sendTelegramMessage(adminChatId,
                        `⚠️ <b>Stornierung!</b>\n\n👤 ${r.customerName || '?'}\n📅 ${timeStr} Uhr\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n\n<i>Kunde hat per Telegram storniert.</i>`
                    ).catch(() => {});
                }
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
        const favorites = await getCustomerFavoriteDestinations(found.name, found.phone);
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
        await setPending(chatId, { awaitingCustomerName: true, originalText: pending.originalText, userName: pending.userName });
        await sendTelegramMessage(chatId, '👤 <b>Anderen Kundennamen eingeben:</b>\n\n<i>Oder "neu" für ohne CRM-Zuordnung.</i>');
        return;
    }

    // CRM-Bestätigung nach AI-Analyse
    if (data.startsWith('crm_confirm_yes_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.crmConfirm) { await sendTelegramMessage(chatId, '⚠️ Nicht mehr gefunden.'); return; }
        const { found } = pending.crmConfirm;
        const booking = { ...(pending.partial || {}) };
        booking.name = found.name;
        booking.phone = found.phone || booking.phone;
        booking._customerAddress = found.address;
        booking._forCustomer = found.name;
        booking._crmCustomerId = found.customerId || null;
        booking._adminBooked = true;
        booking._adminChatId = chatId;
        if (found.phone && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');
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
        booking.phone = found.phone || booking.phone;
        booking._customerAddress = found.address;
        booking._forCustomer = found.name;
        booking._crmCustomerId = found.customerId || null;
        booking._adminBooked = true;
        booking._adminChatId = chatId;
        if (found.phone && booking.missing) booking.missing = booking.missing.filter(f => f !== 'phone');
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
            const cPhone = (c.phone || c.mobile || '').replace(/\D/g, '');
            if (digits && digits.length > 5 && (cPhone.endsWith(digits.slice(-9)))) {
                customerId = child.key;
                customerData = c;
            }
        });

        const commandHint = '\n\n<b>Ihre Möglichkeiten:</b>\n🚕 Fahrt buchen – einfach schreiben wann & wohin\n📊 /status – Ihre Fahrten ansehen\n✏️ Fahrten bearbeiten oder stornieren\n👤 /profil – Ihre Daten verwalten\nℹ️ /hilfe – Alle Befehle';
        if (customerId && customerData) {
            await saveTelegramCustomer(chatId, { customerId, name: customerData.name || firstName, phone: customerData.phone || phone, mobile: customerData.mobile || null, address: customerData.address || null, linkedAt: Date.now() });
            await db.ref('customers/' + customerId).update({ telegramChatId: String(chatId) });
            await sendTelegramMessage(chatId, `✅ <b>Willkommen zurück, ${customerData.name}!</b>\n\nIhre Nummer <b>${phone}</b> ist gespeichert.${commandHint}`, removeKeyboard);
        } else {
            await saveTelegramCustomer(chatId, { customerId: null, name: firstName, phone, linkedAt: Date.now() });
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

    // Prüfe ob eine Buchung läuft und Abholort fehlt
    const pending = await getPending(chatId);
    if (pending) {
        const booking = pending.booking || pending.partial;
        if (booking && (!booking.pickup || (booking.missing && booking.missing.includes('pickup')))) {
            // Standort als Abholort übernehmen
            booking.pickup = addressName;
            booking.pickupLat = lat;
            booking.pickupLon = lon;
            if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'pickup');

            await sendTelegramMessage(chatId, `📍 <b>Abholort per GPS gesetzt:</b>\n🏠 ${addressName}\n\n<i>Koordinaten: ${lat.toFixed(5)}, ${lon.toFixed(5)}</i>`);

            // Buchungsfluss fortsetzen
            await continueBookingFlow(chatId, booking, pending.originalText || '');
            return;
        }

        // Wenn Zielort fehlt → als Zielort setzen
        if (booking && (!booking.destination || (booking.missing && booking.missing.includes('destination')))) {
            booking.destination = addressName;
            booking.destinationLat = lat;
            booking.destinationLon = lon;
            if (booking.missing) booking.missing = booking.missing.filter(m => m !== 'destination');

            await sendTelegramMessage(chatId, `📍 <b>Zielort per GPS gesetzt:</b>\n🎯 ${addressName}\n\n<i>Koordinaten: ${lat.toFixed(5)}, ${lon.toFixed(5)}</i>`);

            await continueBookingFlow(chatId, booking, pending.originalText || '');
            return;
        }
    }

    // Kein laufender Buchungsvorgang → neue Buchung mit Standort als Abholort starten
    const newBooking = {
        pickup: addressName,
        pickupLat: lat,
        pickupLon: lon,
        missing: ['destination', 'datetime'],
        intent: 'buchung'
    };

    // Kundenname laden
    const customer = await getTelegramCustomer(chatId);
    if (customer) {
        newBooking.name = customer.name;
        newBooking.phone = customer.phone;
    }

    await sendTelegramMessage(chatId, `📍 <b>Standort empfangen!</b>\n🏠 Abholort: ${addressName}\n\n💬 Wohin möchten Sie fahren?`);
    await setPending(chatId, { partial: newBooking, originalText: `GPS: ${addressName}` });
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
                        const adminSnap = await db.ref('settings/telegram/adminChats').once('value');
                        const adminChats = adminSnap.val() || [];
                        for (const adminChatId of adminChats) {
                            sendTelegramMessage(adminChatId,
                                `🚫 <b>Nutzer geblockt (Spam)</b>\n\n👤 ${userName}\n🆔 Chat-ID: <code>${spamChatId}</code>\n\n<i>3× Spam-Limit überschritten. Entblocken:\n/entblocken ${spamChatId}</i>`
                            ).catch(() => {});
                        }
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
