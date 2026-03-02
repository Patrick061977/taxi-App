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

const TARIF = {
    grundgebuehr: 4.00,
    km_1_2: 3.30, km_3_4: 2.80, km_ab_5: 2.20,
    nacht_grundgebuehr: 5.50,
    nacht_km_1_2: 3.30, nacht_km_3_4: 2.80, nacht_km_ab_5: 2.40
};

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

    // Geocoding-Cache aus Firebase
    try {
        const cacheSnap = await db.ref('geocodeCache/' + searchKey.replace(/[.#$/[\]]/g, '_')).once('value');
        if (cacheSnap.val()) return cacheSnap.val();
    } catch (e) { /* Cache-Fehler ignorieren */ }

    try {
        const fetchAndValidate = async (url) => {
            const resp = await fetch(url);
            const data = await resp.json();
            for (const item of data) {
                const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
                return { lat, lon, display_name: item.display_name };
            }
            return null;
        };

        let result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Usedom, Deutschland')}&limit=5&addressdetails=1`);
        if (!result) result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Świnoujście, Polska')}&limit=5&addressdetails=1`);
        if (!result) result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&viewbox=13.5,54.3,14.7,53.5&bounded=1&limit=5&addressdetails=1`);
        if (!result) result = await fetchAndValidate(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Deutschland')}&limit=5&addressdetails=1`);

        if (result) {
            // Cache speichern
            try { await db.ref('geocodeCache/' + searchKey.replace(/[.#$/[\]]/g, '_')).set(result); } catch (e) {}
        }
        return result;
    } catch (e) {
        console.warn('Geocoding Fehler:', e.message);
        return null;
    }
}

async function searchNominatimForTelegram(query) {
    if (!query) return [];
    const results = [];
    const searchKey = query.toLowerCase().trim();

    // KNOWN_PLACES durchsuchen
    for (const [key, place] of Object.entries(KNOWN_PLACES)) {
        if (key.includes(searchKey) || (place.name && place.name.toLowerCase().includes(searchKey))) {
            results.push({ name: place.name || key, lat: place.lat, lon: place.lon, source: 'known' });
        }
    }

    // Nominatim API
    try {
        const [usedomResp, generalResp] = await Promise.all([
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Usedom')}&limit=5&addressdetails=1`),
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=de,pl&viewbox=11.0,54.7,14.5,53.3&bounded=1&limit=5&addressdetails=1`)
        ]);
        const usedomData = await usedomResp.json();
        const generalData = await generalResp.json();
        const seen = new Set(results.map(r => `${r.lat.toFixed(3)}_${r.lon.toFixed(3)}`));

        for (const item of [...usedomData, ...generalData]) {
            const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
            const coordKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
            if (!seen.has(coordKey)) {
                seen.add(coordKey);
                const addr = item.address || {};
                let name = item.name || '';
                if (!name && addr.road) name = addr.road + (addr.house_number ? ' ' + addr.house_number : '');
                if (!name) name = item.display_name.split(',')[0];
                const town = addr.town || addr.city || addr.village || addr.municipality || '';
                results.push({ name: name + (town ? `, ${town}` : ''), lat, lon, source: 'nominatim' });
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

async function calculateTelegramRoutePrice(booking) {
    if (!booking.pickupLat || !booking.destinationLat) return null;
    try {
        const route = await calculateRoute(
            { lat: booking.pickupLat, lon: booking.pickupLon },
            { lat: booking.destinationLat, lon: booking.destinationLon }
        );
        if (!route || !route.distance) return null;
        if (parseFloat(route.distance) > 500) return null;
        const pickupTimestamp = booking.datetime ? new Date(booking.datetime).getTime() : Date.now();
        const pricing = calculatePrice(parseFloat(route.distance), pickupTimestamp);
        return { distance: route.distance, duration: route.duration, price: pricing.total, zuschlagText: pricing.zuschlagText };
    } catch (e) { return null; }
}

async function validateTelegramAddresses(chatId, booking, originalText) {
    await sendTelegramMessage(chatId, '📍 <i>Prüfe Adressen...</i>');
    await addTelegramLog('📍', chatId, `Adress-Check: "${booking.pickup}" → "${booking.destination}"`);

    let pickupResult = booking.pickupLat ? { lat: booking.pickupLat, lon: booking.pickupLon } : null;
    let destResult = booking.destinationLat ? { lat: booking.destinationLat, lon: booking.destinationLon } : null;

    const needPickup = !pickupResult && !!booking.pickup;
    const needDest = !destResult && !!booking.destination;

    if (needPickup || needDest) {
        try {
            const promises = [];
            if (needPickup) promises.push(geocode(booking.pickup));
            if (needDest) promises.push(geocode(booking.destination));
            const results = await Promise.all(promises);
            let idx = 0;
            if (needPickup) pickupResult = results[idx++];
            if (needDest) destResult = results[idx++];
        } catch (e) {
            await addTelegramLog('⚠️', chatId, 'Geocoding Fehler: ' + e.message);
            return booking;
        }
    }

    // Nicht-gefundene Adressen -> Vorschläge
    if (!pickupResult || !destResult) {
        const notFoundField = !pickupResult ? 'pickup' : 'destination';
        const notFoundAddress = !pickupResult ? booking.pickup : booking.destination;
        const fieldLabel = notFoundField === 'pickup' ? '📍 Abholort' : '🎯 Zielort';

        try {
            const suggestions = await searchNominatimForTelegram(notFoundAddress);
            if (suggestions.length > 0) {
                const prefix = notFoundField === 'pickup' ? 'np' : 'nd';
                const keyboard = {
                    inline_keyboard: [
                        ...suggestions.map((s, i) => [{ text: `📍 ${s.name}`, callback_data: `${prefix}_${i}` }]),
                        [{ text: '⏩ Trotzdem weiter (ohne Preis)', callback_data: 'addr_skip' }]
                    ]
                };

                const pendingState = { partial: { ...booking, missing: [] }, originalText };
                pendingState.nominatimResults = suggestions;
                if (pickupResult) { pendingState.partial.pickupLat = pickupResult.lat; pendingState.partial.pickupLon = pickupResult.lon; }
                if (destResult) { pendingState.partial.destinationLat = destResult.lat; pendingState.partial.destinationLon = destResult.lon; }
                pendingState.pendingDestValidation = (!pickupResult && !destResult);
                await setPending(chatId, pendingState);

                await addTelegramLog('🔍', chatId, `${fieldLabel} "${notFoundAddress}" nicht eindeutig → ${suggestions.length} Vorschläge`);
                await sendTelegramMessage(chatId, `🔍 <b>${fieldLabel}: "${notFoundAddress}" nicht eindeutig gefunden.</b>\n\nMeinten Sie einen dieser Orte?`, { reply_markup: keyboard });
                return null;
            }
        } catch (e) { console.warn('Nominatim Disambiguation Fehler:', e); }
    }

    if (pickupResult) { booking.pickupLat = pickupResult.lat; booking.pickupLon = pickupResult.lon; }
    if (destResult) { booking.destinationLat = destResult.lat; booking.destinationLon = destResult.lon; }

    if (pickupResult && destResult) {
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
• NIEMALS 00:00 verwenden!

ADRESSEN:
• Straße + Hausnummer immer vollständig übernehmen
• Bekannte Ziele: "Bahnhof Heringsdorf", "Flughafen Heringsdorf (HDF)", "Seebrücke Heringsdorf"
• Unklare Orte (z.B. nur "Bahnhof", "Kirche", "Hotel") → kurz nachfragen
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
                const d = new Date(booking.datetime);
                noted.push(`📅 ${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`);
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
3. DATUM: ISO YYYY-MM-DDTHH:MM | heute=${new Date().toISOString().slice(0, 10)} | morgen=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)} | nur Uhrzeit → Datum=heute | nur Datum → datetime=null+missing | nie 00:00!
4. HEIMADRESSE: ${followUpHomeAddress ? `"${followUpHomeAddress}" → bei "zu Hause"/"nach Hause" verwenden` : 'unbekannt → frage "Welche Adresse ist Ihr Zuhause?"'}
5. UNKLARE ORTE → kurz nachfragen

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
            if (booking.datetime) { const d = new Date(booking.datetime); noted.push(`📅 ${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`); }
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
    const hasExplicitPassengers = booking._passengersExplicit || (booking.passengers && booking.passengers > 1);
    if (hasExplicitPassengers) return showTelegramConfirmation(chatId, booking, routePrice);

    const bookingId = Date.now().toString(36);
    await setPending(chatId, { booking, bookingId, routePrice, originalText, _awaitingPassengers: true });
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
            ]
        ]}
    });
}

function buildTelegramConfirmMsg(booking, routePrice) {
    let msg = booking._adminBooked
        ? `🕵️ <b>Buchung für ${booking._forCustomer || booking.name}</b>\n\n`
        : '✅ <b>Termin erkannt!</b>\n\n';
    if (booking.datetime) {
        const dt = new Date(booking.datetime);
        msg += `📅 ${dt.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} um ${dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr\n`;
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
    if (routePrice) {
        msg += `\n🗺️ Strecke: ca. ${routePrice.distance} km (~${routePrice.duration} Min)\n`;
        msg += `💰 Geschätzter Preis: ca. ${routePrice.price} €`;
        if (routePrice.zuschlagText.length > 0) msg += ` (${routePrice.zuschlagText.join(', ')})`;
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
    if (booking && booking.datetime) {
        const dt = new Date(booking.datetime);
        const timeRow = [];
        for (const offset of [-60, -30, 30, 60]) {
            const alt = new Date(dt.getTime() + offset * 60000);
            const hh = String(alt.getHours()).padStart(2, '0');
            const mm = String(alt.getMinutes()).padStart(2, '0');
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
    await setPending(chatId, { booking, bookingId });
    const btnSent = await sendTelegramMessage(chatId, confirmMsg, {
        reply_markup: buildBookingConfirmKeyboard(bookingId, chatId, booking)
    });
    if (!btnSent) {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Senden der Bestätigung. Bitte nochmal versuchen.');
    }
}

function getLocalDateString(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function linkTelegramChatToCustomer(chatId, booking) {
    const phone = booking.phone;
    const name = booking.name;
    if (!phone && !name) return;

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
        upcoming.forEach(([, r]) => {
            const dt = new Date(r.pickupTimestamp || 0);
            const timeStr = dt.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            msg += `📅 <b>${timeStr} Uhr</b>\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n📋 ${r.status || 'offen'}\n\n`;
        });
        await sendTelegramMessage(chatId, msg);
    } catch (e) {
        await sendTelegramMessage(chatId, '⚠️ Fehler beim Abrufen der Buchungen.');
    }
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
            const timeStr = dt.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            msg += `📅 <b>${timeStr} Uhr</b>\n📍 ${r.pickup || '?'} → ${r.destination || '?'}\n\n`;
            buttons.push([{ text: `🗑️ ${timeStr}: ${(r.pickup || '?').substring(0, 20)}...`, callback_data: `del_ride_${rideId}` }]);
        });
        buttons.push([{ text: '✖️ Nichts löschen', callback_data: 'del_cancel' }]);
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
            greeting += `📱 ${knownCustomer.phone || 'Telefon gespeichert'}\n\nWas kann ich für Sie tun?`;
        } else {
            greeting += 'Herzlich willkommen! Ich bin Ihr persönlicher Taxi-Assistent.\n\n💡 <i>Tipp: Teilen Sie einmalig Ihre Telefonnummer, damit wir Sie beim nächsten Mal sofort erkennen.</i>';
        }
        const keyboard = { inline_keyboard: [
            [{ text: '🚕 Fahrt buchen', callback_data: 'menu_buchen' }],
            [{ text: '📊 Meine Fahrten', callback_data: 'menu_status' }, { text: 'ℹ️ Hilfe', callback_data: 'menu_hilfe' }],
            knownCustomer ? [{ text: '🔓 Abmelden', callback_data: 'menu_abmelden' }] : [{ text: 'ℹ️ Hilfe & Befehle', callback_data: 'menu_hilfe' }]
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
        let hilfeMsg = '🚕 <b>Funk Taxi Heringsdorf – Taxibot</b>\n\n<b>So buchen Sie:</b>\nSchreiben Sie einfach eine Nachricht, z.B.:\n• <i>Morgen 10 Uhr vom Bahnhof nach Ahlbeck</i>\n\n<b>Befehle:</b>\n/buchen – 🚕 Neue Fahrt\n/status – 📊 Ihre Fahrten\n/abbrechen – ❌ Buchung abbrechen\n/abmelden – 🔓 Abmelden\n/hilfe – ℹ️ Übersicht';
        if (knownCustomer) hilfeMsg += `\n\n<b>Ihr Profil:</b>\n👤 ${knownCustomer.name}\n📱 ${knownCustomer.phone || 'keine Telefonnummer'}`;
        await sendTelegramMessage(chatId, hilfeMsg);
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

    if (textCmd === '/status') {
        const knownCustomer = await getTelegramCustomer(chatId);
        if (knownCustomer) await handleTelegramBookingQuery(chatId, 'meine Fahrten', knownCustomer);
        else await sendTelegramMessage(chatId, '📊 <b>Status</b>\n\nBitte teilen Sie Ihre Telefonnummer!', {
            reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        });
        return;
    }

    if (textCmd.startsWith('/')) {
        await sendTelegramMessage(chatId, `❓ Befehl <b>${text}</b> nicht erkannt.\n\n/buchen – 🚕 Neue Fahrt\n/status – 📊 Meine Fahrten\n/abbrechen – ❌ Abbrechen\n/hilfe – ℹ️ Hilfe`);
        return;
    }

    // === PENDING-BUCHUNGEN PRÜFEN ===
    const pending = await getPending(chatId);

    // Auto-Timeout
    if (pending && isPendingExpired(pending)) {
        await deletePending(chatId);
        await sendTelegramMessage(chatId, '⏰ <b>Ihre vorherige Anfrage ist abgelaufen</b> (nach 30 Minuten).\n\nSchreiben Sie einfach eine neue Anfrage!');
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

    // Unbekannter Nutzer
    if (!knownForGreeting && !isAdminUser) {
        await sendTelegramMessage(chatId,
            '👋 Hallo! Ich bin der <b>Taxibot von Funk Taxi Heringsdorf</b>.\n\n📱 Bitte teilen Sie einmalig Ihre Telefonnummer.\n\nOder schreiben Sie direkt Ihre Anfrage:\n<i>„Morgen 10 Uhr vom Bahnhof Heringsdorf nach Ahlbeck"</i>',
            { reply_markup: { keyboard: [[{ text: '📱 Telefonnummer teilen', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }
        );
    }

    // Buchungsabfrage?
    if (isTelegramBookingQuery(text)) {
        await handleTelegramBookingQuery(chatId, text, knownForGreeting);
        return;
    }

    // Lösch-Intent?
    if (isTelegramDeleteQuery(text)) {
        await handleTelegramDeleteQuery(chatId, knownForGreeting);
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
        await sendTelegramMessage(chatId, '🚕 <b>Funk Taxi Heringsdorf</b>\n\n<b>Befehle:</b>\n/buchen – 🚕 Neue Fahrt\n/status – 📊 Ihre Fahrten\n/abbrechen – ❌ Abbrechen\n/abmelden – 🔓 Abmelden\n/hilfe – ℹ️ Hilfe');
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
            const pickupTimestamp = booking.datetime ? new Date(booking.datetime).getTime() : Date.now();
            const dt = new Date(pickupTimestamp);
            const minutesUntilPickup = (pickupTimestamp - Date.now()) / 60000;
            const isVorbestellung = minutesUntilPickup > 30;
            const passengers = booking.passengers || 1;
            const timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

            // Preis berechnen
            let telegramRoutePrice = null;
            if (booking.pickupLat && booking.destinationLat) {
                try { telegramRoutePrice = await calculateTelegramRoutePrice(booking); } catch (e) {}
            }

            const rideData = {
                pickup: booking.pickup || 'Abholort offen',
                destination: booking.destination || 'Zielort offen',
                pickupTimestamp,
                pickupTime: dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
                pickupDate: dt.toLocaleDateString('de-DE'),
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
                ...(telegramRoutePrice && { estimatedPrice: telegramRoutePrice.price, estimatedDistance: telegramRoutePrice.distance, estimatedDuration: telegramRoutePrice.duration, duration: telegramRoutePrice.duration })
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
                `📅 ${dt.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })} um ${timeStr} Uhr\n` +
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
                        const isToday = dt.toDateString() === now.toDateString();
                        let timeLabel;
                        if (!isVorbestellung) {
                            timeLabel = 'SOFORT';
                        } else if (isToday) {
                            timeLabel = `Heute ${timeStr} Uhr`;
                        } else {
                            timeLabel = `${dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${timeStr} Uhr`;
                        }
                        const sentAt = now.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

    // Buchung ablehnen / ändern
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
        else if (data.startsWith('change_pickup_')) { booking.pickup = null; booking.pickupLat = null; booking.missing = ['pickup']; }
        else { booking.destination = null; booking.destinationLat = null; booking.missing = ['destination']; }
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
        if (!match) return;
        const paxCount = parseInt(match[1]);
        const pending = await getPending(chatId);
        if (!pending || !pending.booking) return;
        pending.booking.passengers = paxCount;
        pending.booking._passengersExplicit = true;
        await showTelegramConfirmation(chatId, pending.booking, pending.routePrice);
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
        const existingDt = new Date(pending.booking.datetime || Date.now());
        existingDt.setHours(parseInt(hh), parseInt(mm), 0, 0);
        pending.booking.datetime = existingDt.toISOString();
        pending._prevalidatedSlot = true;
        pending._prevalidatedAt = Date.now();
        await setPending(chatId, pending);

        const dayLabel = existingDt.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
        await sendTelegramMessage(chatId,
            `🕐 <b>Neue Zeit: ${hh}:${mm} Uhr</b>\n\n📅 ${dayLabel} um ${hh}:${mm} Uhr\n📍 ${pending.booking.pickup} → ${pending.booking.destination}\n👥 ${pending.booking.passengers || 1} Person(en)\n\nSoll ich diese Zeit buchen?`,
            { reply_markup: { inline_keyboard: [[
                { text: '✅ Ja, buchen!', callback_data: `book_yes_${pending.bookingId}` },
                { text: '❌ Abbrechen', callback_data: `book_no_${pending.bookingId}` }
            ]] } }
        );
        return;
    }

    // Fahrt löschen
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
    if (data.startsWith('admin_cust_yes_')) {
        const pending = await getPending(chatId);
        if (!pending || !pending.crmConfirm) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const { found } = pending.crmConfirm;
        await deletePending(chatId);
        await sendTelegramMessage(chatId, `✅ <b>${found.name}</b>\n🤖 <i>Analysiere Buchung...</i>`);
        await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, { isAdmin: true, preselectedCustomer: found });
        return;
    }
    if (data.startsWith('admin_cust_sel_')) {
        const selectMatch = data.match(/^admin_cust_sel_(\d+)_(.+)$/);
        if (!selectMatch) return;
        const pending = await getPending(chatId);
        if (!pending || !pending.crmMultiSelect) { await sendTelegramMessage(chatId, '⚠️ Anfrage nicht mehr gefunden.'); return; }
        const found = pending.crmMultiSelect.matches[parseInt(selectMatch[1])];
        if (!found) { await sendTelegramMessage(chatId, '⚠️ Ungültige Auswahl.'); return; }
        await deletePending(chatId);
        await sendTelegramMessage(chatId, `✅ <b>${found.name}</b>\n🤖 <i>Analysiere Buchung...</i>`);
        await analyzeTelegramBooking(chatId, pending.originalText, pending.userName, { isAdmin: true, preselectedCustomer: found });
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
    if (data === 'addr_skip') {
        const pending = await getPending(chatId);
        if (pending && pending.partial) {
            const booking = pending.partial;
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
    if (phone.startsWith('00')) phone = '+' + phone.slice(2);
    else if (phone && !phone.startsWith('+')) phone = '+49' + phone.replace(/^0/, '');

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

        if (customerId && customerData) {
            await saveTelegramCustomer(chatId, { customerId, name: customerData.name || firstName, phone: customerData.phone || phone, mobile: customerData.mobile || null, address: customerData.address || null, linkedAt: Date.now() });
            await db.ref('customers/' + customerId).update({ telegramChatId: String(chatId) });
            await sendTelegramMessage(chatId, `✅ <b>Willkommen zurück, ${customerData.name}!</b>\n\nIhre Nummer <b>${phone}</b> ist gespeichert.\n\nSchreiben Sie wann und wohin – ich buche sofort!`, removeKeyboard);
        } else {
            await saveTelegramCustomer(chatId, { customerId: null, name: firstName, phone, linkedAt: Date.now() });
            await sendTelegramMessage(chatId, `✅ <b>Danke, ${firstName}!</b>\n\nIhre Nummer <b>${phone}</b> wurde gespeichert.\n\nSchreiben Sie jetzt wann und wohin!`, removeKeyboard);
        }
    } catch (e) {
        await sendTelegramMessage(chatId, '✅ Telefonnummer erhalten! Sie können jetzt buchen.', removeKeyboard);
    }
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

        try {
            const update = req.body;

            if (update.callback_query) {
                await handleCallback(update.callback_query);
            } else if (update.message) {
                if (update.message.contact) {
                    await handleContact(update.message);
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

        try {
            const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: webhookUrl,
                    allowed_updates: ['message', 'callback_query'],
                    drop_pending_updates: false
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
