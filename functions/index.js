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

const KNOWN_PLACES = {
    'heringsdorf': { lat: 53.9533, lon: 14.1633, name: 'Heringsdorf' },
    'bahnhof heringsdorf': { lat: 53.9533, lon: 14.1633, name: 'Bahnhof Heringsdorf' },
    'ahlbeck': { lat: 53.9444, lon: 14.1933, name: 'Ahlbeck' },
    'seebrücke ahlbeck': { lat: 53.9444, lon: 14.1933, name: 'Seebrücke Ahlbeck' },
    'bansin': { lat: 53.9633, lon: 14.1433, name: 'Bansin' },
    'seebrücke bansin': { lat: 53.9633, lon: 14.1433, name: 'Seebrücke Bansin' },
    'zinnowitz': { lat: 54.0908, lon: 13.9167, name: 'Zinnowitz' },
    'bahnhof zinnowitz': { lat: 54.0908, lon: 13.9167, name: 'Bahnhof Zinnowitz' },
    'ückeritz': { lat: 53.9878, lon: 14.0519, name: 'Ückeritz' },
    'loddin': { lat: 54.0083, lon: 13.9917, name: 'Loddin' },
    'zempin': { lat: 54.0194, lon: 13.9611, name: 'Zempin' },
    'koserow': { lat: 54.0681, lon: 13.9764, name: 'Koserow' },
    'karlshagen': { lat: 54.1078, lon: 13.8333, name: 'Karlshagen' },
    'peenemünde': { lat: 54.1422, lon: 13.7753, name: 'Peenemünde' },
    'trassenheide': { lat: 54.0997, lon: 13.8875, name: 'Trassenheide' },
    'flughafen heringsdorf': { lat: 53.8787, lon: 14.1524, name: 'Flughafen Heringsdorf (HDF)' },
    'swinemünde': { lat: 53.9100, lon: 14.2472, name: 'Swinemünde' },
    'świnoujście': { lat: 53.9100, lon: 14.2472, name: 'Świnoujście' }
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

async function addTelegramLog(emoji, chatId, msg, details = null) {
    try {
        const logRef = db.ref('settings/telegram/botlog');
        const entry = {
            time: Date.now(),
            emoji, chatId: String(chatId), msg,
            ...(details ? { details: JSON.stringify(details).substring(0, 500) } : {})
        };
        await logRef.push(entry);
        // Max 200 Logs behalten - nur gelegentlich aufraeumen (ca. 1 von 10 Aufrufen)
        if (Math.random() < 0.1) {
            trimTelegramLogs(logRef);
        }
    } catch (e) { /* Log-Fehler ignorieren */ }
    console.log(`${emoji} [${chatId}] ${msg}`);
}

function trimTelegramLogs(logRef) {
    logRef.once('value').then(snap => {
        const count = snap.numChildren();
        if (count > 220) {
            const toDelete = count - 200;
            let deleted = 0;
            snap.forEach(child => {
                if (deleted < toDelete) { child.ref.remove(); deleted++; }
            });
        }
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
    await db.ref('settings/telegram/pending/' + chatId).set(data);
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
            let name = '';
            if (addr.road) name = addr.road + (addr.house_number ? ' ' + addr.house_number : '');
            else if (addr.pedestrian) name = addr.pedestrian;
            else if (data.display_name) name = data.display_name.split(',')[0];
            const town = addr.town || addr.city || addr.village || addr.municipality || '';
            const postcode = addr.postcode || '';
            const fullName = name + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
            return { name: fullName, lat: parseFloat(data.lat), lon: parseFloat(data.lon), display_name: data.display_name };
        }
        return null;
    } catch (e) {
        console.warn('Reverse-Geocoding Fehler:', e.message);
        return null;
    }
}

async function searchNominatimForTelegram(query) {
    if (!query) return [];
    const results = [];
    const searchKey = query.toLowerCase().trim();
    const fetchOpts = { headers: { 'User-Agent': 'TaxiHeringsdorf/1.0' } };

    // KNOWN_PLACES durchsuchen
    for (const [key, place] of Object.entries(KNOWN_PLACES)) {
        if (key.includes(searchKey) || (place.name && place.name.toLowerCase().includes(searchKey))) {
            results.push({ name: place.name || key, lat: place.lat, lon: place.lon, source: 'known' });
        }
    }

    // Nominatim API - Usedom-Ergebnisse zuerst
    try {
        const [usedomResp, generalResp] = await Promise.all([
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Usedom')}&limit=5&addressdetails=1&viewbox=13.6,54.2,14.45,53.75&bounded=0`, fetchOpts),
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=de,pl&viewbox=13.6,54.2,14.45,53.75&bounded=1&limit=5&addressdetails=1`, fetchOpts)
        ]);
        const usedomData = await usedomResp.json();
        const generalData = await generalResp.json();
        const seen = new Set(results.map(r => `${r.lat.toFixed(3)}_${r.lon.toFixed(3)}`));

        // Usedom-Ergebnisse zuerst, dann allgemeine
        const allItems = [...usedomData, ...generalData];
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
                let name = item.name || '';
                if (!name && addr.road) name = addr.road + (addr.house_number ? ' ' + addr.house_number : '');
                if (!name) name = item.display_name.split(',')[0];
                const town = addr.town || addr.city || addr.village || addr.municipality || '';
                const postcode = addr.postcode || '';
                const displayName = name + (town ? `, ${postcode ? postcode + ' ' : ''}${town}` : '');
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
                // Keine Ergebnisse → Adresse neu eingeben lassen
                await addTelegramLog('⚠️', chatId, `${fieldLabel} "${addressToResolve}" → keine Ergebnisse`);
                await sendTelegramMessage(chatId,
                    `⚠️ <b>${fieldLabel}: "${addressToResolve}" nicht gefunden.</b>\n\n` +
                    `Bitte geben Sie die vollständige Adresse ein:\n<b>Straße + Hausnummer, PLZ Ort</b>\n<i>z.B. Dünenweg 10, 17424 Heringsdorf</i>`
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
            msg += '\n\n<i>/abbrechen zum Zurücksetzen</i>';
            await setPending(chatId, { partial: booking, originalText, lastQuestion: booking.question || null });
            await sendTelegramMessage(chatId, msg);
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

        // Noch Felder fehlend?
        if (booking.missing && booking.missing.length > 0) {
            let msg = '';
            const noted = [];
            if (booking.datetime) { const d = new Date(parseGermanDatetime(booking.datetime)); noted.push(`📅 ${d.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${d.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit' })} Uhr`); }
            if (booking.pickup) noted.push(`📍 Von: ${booking.pickup}`);
            if (booking.destination) noted.push(`🎯 Nach: ${booking.destination}`);
            if (noted.length > 0) msg += `✅ <b>Bereits notiert:</b>\n${noted.join('\n')}\n\n`;
            if (booking.question) msg += `💬 ${booking.question}`;
            else {
                const firstMissing = booking.missing[0];
                const fallbacks = { datetime: 'Für wann soll ich buchen?', pickup: 'Von wo holen wir Sie ab?', destination: 'Wohin geht die Fahrt?', phone: 'Ihre Handynummer bitte?' };
                msg += `💬 ${fallbacks[firstMissing] || 'Was fehlt noch?'}`;
            }
            msg += '\n\n<i>/abbrechen zum Zurücksetzen</i>';

            if (isAdminFollowUp) {
                booking._adminBooked = partial._adminBooked || true;
                booking._adminChatId = partial._adminChatId || chatId;
                booking._forCustomer = booking._forCustomer || booking.forCustomer || partial._forCustomer;
                booking._customerAddress = partial._customerAddress;
                if (partial._crmCustomerId !== undefined) booking._crmCustomerId = partial._crmCustomerId;
            }
            await setPending(chatId, { partial: booking, originalText, lastQuestion: booking.question || null });
            await sendTelegramMessage(chatId, msg);
            return;
        }

        // Admin-Flags übertragen
        if (isAdminFollowUp) {
            booking._adminBooked = partial._adminBooked || true;
            booking._adminChatId = partial._adminChatId || chatId;
            booking._forCustomer = booking._forCustomer || booking.forCustomer || partial._forCustomer;
            booking._customerAddress = partial._customerAddress;
            if (partial._crmCustomerId !== undefined) booking._crmCustomerId = partial._crmCustomerId;
        }

        // 🆕 Koordinaten aus partial übernehmen (z.B. aus Favoriten)
        if (partial.pickupLat && partial.pickupLon && !booking.pickupLat) {
            booking.pickupLat = partial.pickupLat;
            booking.pickupLon = partial.pickupLon;
        }
        if (partial.destinationLat && partial.destinationLon && !booking.destinationLat) {
            booking.destinationLat = partial.destinationLat;
            booking.destinationLon = partial.destinationLon;
        }

        // Adressen validieren
        const validatedFU = await validateTelegramAddresses(chatId, booking, originalText);
        if (!validatedFU) return;
        Object.assign(booking, validatedFU);
        const routePriceFU = await calculateTelegramRoutePrice(booking);
        await askPassengersOrConfirm(chatId, booking, routePriceFU, originalText);

    } catch (e) {
        console.error('Follow-Up Fehler:', e);
        await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// BESTÄTIGUNG & BUCHUNG
// ═══════════════════════════════════════════════════════════════

async function askPassengersOrConfirm(chatId, booking, routePrice, originalText) {
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
    if (booking && booking.datetime) {
        const dt = new Date(parseGermanDatetime(booking.datetime));
        const timeRow = [];
        for (const offset of [-60, -30, 30, 60]) {
            const alt = new Date(dt.getTime() + offset * 60000);
            const altTime = alt.toLocaleTimeString('de-DE', { ...TZ_BERLIN, hour: '2-digit', minute: '2-digit', hour12: false });
            const [hh, mm] = altTime.split(':');
            const label = offset < 0 ? `◀ ${hh}:${mm}` : `${hh}:${mm} ▶`;
            timeRow.push({ text: label, callback_data: `slot_${chatId}_${hh}_${mm}` });
        }
        keyboard.inline_keyboard.push(timeRow);
    }
    return keyboard;
}

async function showTelegramConfirmation(chatId, booking, routePrice) {
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
            await sendTelegramMessage(chatId, `📋 <b>${knownCustomer.name}</b>, Sie haben keine bevorstehenden Buchungen.\n\nSchreiben Sie jederzeit eine neue Anfrage!`);
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

        await sendTelegramMessage(chatId, msg, buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : undefined);
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
            keyboard.push([{ text: '🗑️ Fahrt löschen', callback_data: `adm_del_${rideId}` }]);
        }
        keyboard.push([{ text: '◀ Zurück zur Liste', callback_data: 'adm_rides_today' }]);

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
        greeting += '🚕 <b>Fahrt buchen</b> – Schreiben Sie einfach wann und wohin\n';
        greeting += '📊 <b>Fahrten ansehen</b> – Ihre gebuchten Fahrten einsehen\n';
        greeting += '✏️ <b>Fahrten bearbeiten</b> – Zeit, Adresse oder Details ändern\n';
        greeting += '🗑️ <b>Fahrten stornieren</b> – Buchungen absagen\n\n';
        greeting += '💡 <i>Wählen Sie eine Option oder schreiben Sie einfach los!</i>';
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
        let msg = '🚕 <b>Neue Fahrt buchen</b>\n\nSchreiben Sie mir einfach Ihre Fahrtwünsche:\n\n• <i>Jetzt vom Bahnhof Heringsdorf nach Ahlbeck</i>\n• <i>Morgen 10 Uhr Hotel Maritim → Flughafen BER</i>\n• <i>Freitag 14:30 Seebrücke Bansin nach Zinnowitz, 3 Personen</i>\n\n<i>Ich analysiere Ihre Nachricht automatisch.</i>';
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
        await sendTelegramMessage(chatId, '⏳ <b>Bitte erst die aktuelle Buchung bestätigen oder ablehnen!</b>\n\n<i>/abbrechen zum Zurücksetzen</i>');
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
                const update = { editedAt: Date.now(), editedBy: 'telegram-customer' };
                update[field] = text;
                const geo = await geocode(text);
                if (geo) { update[field + 'Lat'] = geo.lat; update[field + 'Lon'] = geo.lon; }
                await db.ref(`rides/${rideId}`).update(update);
                const label = field === 'pickup' ? 'Abholort' : 'Zielort';
                await addTelegramLog('✏️', chatId, `Kunde: ${label} geändert auf "${text}"`);
                await sendTelegramMessage(chatId, `✅ <b>${label} geändert!</b>\n\nNeu: <b>${text}</b>\n\n<i>Wir freuen uns auf Sie!</i>`);
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
                const update = { editedAt: Date.now(), editedBy: 'telegram-admin' };
                update[field] = text;
                // Geocode die neue Adresse
                const geo = await geocode(text);
                if (geo) {
                    update[field + 'Lat'] = geo.lat;
                    update[field + 'Lon'] = geo.lon;
                }
                await db.ref(`rides/${rideId}`).update(update);
                const label = field === 'pickup' ? 'Abholort' : 'Zielort';
                await addTelegramLog('✏️', chatId, `Admin: ${label} geändert auf "${text}"`);
                await sendTelegramMessage(chatId, `✅ ${label} geändert auf <b>${text}</b>`);
                await handleAdminRideDetail(chatId, rideId);
            } catch (e) { await sendTelegramMessage(chatId, '⚠️ Fehler: ' + e.message); }
            return;
        }
    }

    // Follow-Up: Unvollständige Buchung ergänzen
    if (pending && pending.partial && !isPendingExpired(pending)) {
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

    // Admin-Modus
    if (isAdminUser) {
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

    // Normale Buchungsanalyse
    sendTelegramMessage(chatId, '🤖 <i>Analysiere Ihre Nachricht...</i>').catch(() => {});
    await analyzeTelegramBooking(chatId, text, userName);
}

// ═══════════════════════════════════════════════════════════════
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
        hilfeMsg += '• „<i>Meine Fahrten</i>" oder „<i>Status</i>"\n';
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
            `✏️ <b>${labels[field]} ändern</b>\n\nAktuell: <b>${current[field]}</b>\n\nBitte geben Sie ${hints[field]} ein:\n\n<i>/abbrechen zum Zurücksetzen</i>`
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
                ...(booking.pickupLat && { pickupLat: booking.pickupLat, pickupLon: booking.pickupLon }),
                ...(booking.destinationLat && { destinationLat: booking.destinationLat, destinationLon: booking.destinationLon }),
                ...(telegramRoutePrice && { estimatedPrice: telegramRoutePrice.price, estimatedDistance: telegramRoutePrice.distance, estimatedDuration: telegramRoutePrice.duration, duration: telegramRoutePrice.duration }),
                paymentMethod: booking.paymentMethod || 'bar'
            };

            const newRef = db.ref('rides').push();
            rideData.id = newRef.key;
            await newRef.set(rideData);

            // Erfolgsmeldung
            const successHeader = booking._adminBooked
                ? `✅ <b>Buchung für ${booking._forCustomer || rideData.customerName} eingetragen!</b>\n\n`
                : '🎉 <b>Termin eingetragen!</b>\n\n';
            await sendTelegramMessage(chatId,
                successHeader +
                `📅 ${dt.toLocaleDateString('de-DE', { ...TZ_BERLIN, weekday: 'long', day: '2-digit', month: '2-digit' })} um ${timeStr} Uhr\n` +
                `📍 ${rideData.pickup} → ${rideData.destination}\n` +
                `👤 ${rideData.customerName}` + (rideData.customerPhone ? ` · 📱 ${rideData.customerPhone}` : '') + '\n' +
                `👥 ${passengers} Person(en)\n` +
                (telegramRoutePrice ? `🗺️ ca. ${telegramRoutePrice.distance} km (~${telegramRoutePrice.duration} Min)\n💰 ca. ${telegramRoutePrice.price} €\n` : '') +
                `📋 Status: ${isVorbestellung ? 'Vorbestellt' : 'Offen'}\n\n✅ Fahrt ist im System!`
            );

            await addTelegramLog('💾', chatId, `Fahrt erstellt: ${rideData.pickup} → ${rideData.destination}`, { rideId: rideData.id });
            await deletePending(chatId);

            // Kunden-Erkennung
            if (!booking._adminBooked && (booking.phone || booking.name)) {
                linkTelegramChatToCustomer(chatId, booking).catch(() => {});
            }

            // Admin-Benachrichtigung bei Kunden-Buchungen
            if (!booking._adminBooked) {
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
                        const adminMsg = `${statusEmoji} <b>${statusText}</b>\n` +
                            `🆔 <b>ID:</b> <code>${rideData.id}</code>\n\n` +
                            `📍 <b>Von:</b> ${rideData.pickup}\n` +
                            `🎯 <b>Nach:</b> ${rideData.destination}\n` +
                            `👤 <b>Name:</b> ${rideData.customerName}\n` +
                            (rideData.customerPhone ? `📱 <b>Tel:</b> ${rideData.customerPhone}\n` : '') +
                            `🕐 <b>Abholung:</b> ${timeLabel}\n` +
                            `👥 <b>Personen:</b> ${passengers}\n` +
                            (telegramRoutePrice ? `💰 <b>Preis:</b> ca. ${telegramRoutePrice.price} €\n` : '') +
                            `⏰ <b>Gesendet:</b> ${sentAt}\n\n` +
                            `📱 <i>Via Telegram-Bot</i>`;
                        for (const adminChatId of adminChats) {
                            sendTelegramMessage(adminChatId, adminMsg).catch(() => {});
                        }
                    }
                } catch (e) {
                    console.error('Admin-Benachrichtigung Fehler:', e.message);
                }
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
                    [{ text: '🎯 Ziel', callback_data: `change_dest_${noBookingId}` }, { text: '🗑️ Verwerfen', callback_data: `discard_${noBookingId}` }]
                ]}
            });
        } else {
            await deletePending(chatId);
            await sendTelegramMessage(chatId, '👍 OK, Buchung verworfen.');
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
            await showTelegramConfirmation(chatId, pending.booking, pending.routePrice);
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
            // "Anderes Ziel" → normaler Buchungsflow
            await deletePending(chatId);
            await sendTelegramMessage(chatId, `🤖 <i>Analysiere Buchung für ${preselectedCustomer.name}...</i>`);
            await analyzeTelegramBooking(chatId, originalText, userName, { isAdmin: true, preselectedCustomer });
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
        const prefilledCoords = {};
        if (fav.destinationLat && fav.destinationLon) {
            prefilledCoords.destinationLat = fav.destinationLat;
            prefilledCoords.destinationLon = fav.destinationLon;
        }
        if (pickup && fav.pickupLat && fav.pickupLon) {
            prefilledCoords.pickupLat = fav.pickupLat;
            prefilledCoords.pickupLon = fav.pickupLon;
        }

        await deletePending(chatId);
        await sendTelegramMessage(chatId, `⭐ <b>${fav.destination}</b>\n🤖 <i>Analysiere Buchung...</i>`);
        await analyzeTelegramBooking(chatId, enrichedText, userName, { isAdmin: true, preselectedCustomer, prefilledCoords });
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
            let favMsg = `✅ <b>${found.name}</b>\n\n⭐ <b>Beliebte Ziele:</b>\n`;
            const buttons = favorites.map((f, i) => {
                favMsg += `${i + 1}. ${f.destination} (${f.count}x)\n`;
                const label = f.destination.length > 28 ? f.destination.slice(0, 26) + '…' : f.destination;
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

    // Admin-Check
    if (await isTelegramAdmin(chatId)) {
        await sendTelegramMessage(chatId, '✅ <b>Admin-Kontakt erkannt.</b>\n\nKeine Kunden-Verknüpfung nötig.', removeKeyboard);
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

            if (update.callback_query) {
                await handleCallback(update.callback_query);
            } else if (update.message) {
                if (update.message.contact) {
                    await handleContact(update.message);
                } else if (update.message.location) {
                    await handleLocation(update.message);
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
