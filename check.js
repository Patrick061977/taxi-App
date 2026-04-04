/**
 * Taxi-App Live Health Check
 * Aufruf: node check.js
 * Zeigt live Firebase-Status: Fahrzeuge, Fahrten, Telegram, Schichtplan
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Standard-Key (kann in Firebase unter settings/healthCheckKey überschrieben werden)
const DEFAULT_KEY = 'funk-taxi-heringsdorf-2026';

// Optionaler Custom-Key aus .check.key Datei
let KEY = DEFAULT_KEY;
const keyFile = path.join(__dirname, '.check.key');
if (fs.existsSync(keyFile)) {
    KEY = fs.readFileSync(keyFile, 'utf8').trim();
}

const URL = `https://healthcheck-jdesb7r5ua-ew.a.run.app?key=${encodeURIComponent(KEY)}`;

console.log('🔍 Frage Live-Status ab...\n');

https.get(URL, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
        try {
            const s = JSON.parse(data);

            // Header
            console.log('═══════════════════════════════════════════════');
            console.log(`📊 TAXI-APP STATUS  ${s.timestamp?.slice(0,19).replace('T',' ')} UTC`);
            console.log(`🔧 Cloud Functions v${s.version}`);
            console.log('═══════════════════════════════════════════════\n');

            // Fahrzeuge
            console.log(`🚗 FAHRZEUGE: ${s.vehicles?.online}/${s.vehicles?.total} online`);
            for (const [id, v] of Object.entries(s.vehicles?.details || {})) {
                const gps = v.gpsAgeMin !== null ? ` (GPS: ${v.gpsAgeMin}min)` : ' (kein GPS)';
                const status = v.online ? '🟢 ONLINE' : '⚫ offline';
                console.log(`   ${status}  ${v.name}${gps}${v.gpsStale ? ' ⚠️ VERALTET' : ''}`);
            }

            // Fahrten
            console.log(`\n🗂️  FAHRTEN HEUTE:`);
            console.log(`   🆕 Neu/offen:     ${s.rides?.new}`);
            console.log(`   ⏳ Zugeteilt:     ${s.rides?.assigned}`);
            console.log(`   📅 Vorbestellt:   ${s.rides?.vorbestellt}`);
            console.log(`   ✅ Akzeptiert:    ${s.rides?.accepted}`);
            console.log(`   🚀 Laufend:       ${s.rides?.running}`);

            if (s.rides?.details?.new?.length > 0) {
                console.log(`\n   🆕 Offene Fahrten:`);
                s.rides.details.new.forEach(r => console.log(`      • ${r.name} — ${r.pickup}`));
            }

            // Schicht
            console.log(`\n📅 SCHICHT HEUTE: ${s.shiftToday?.vehiclesPlanned} Fahrzeuge geplant`);
            if (s.shiftToday?.vehicleIds?.length > 0) {
                console.log(`   ${s.shiftToday.vehicleIds.join(', ')}`);
            }

            // Telegram
            const tg = s.telegram;
            console.log(`\n📱 TELEGRAM: Webhook ${tg?.webhookActive ? '✅ aktiv' : '❌ INAKTIV'}, ${tg?.pendingConversations} laufende Gespräche`);

            // Buchungssystem
            console.log(`🌐 BUCHUNGSSYSTEM: ${s.bookingSystemOnline !== false ? '✅ Online' : '🔴 OFFLINE'}`);

            // Warnungen
            console.log('\n─────────────────────────────────────────────');
            s.warnings?.forEach(w => console.log(w));
            console.log('═══════════════════════════════════════════════\n');

        } catch (e) {
            console.log('Parse-Fehler:', e.message);
            console.log('Response:', data.substring(0, 500));
        }
    });
}).on('error', e => {
    console.error('HTTP-Fehler:', e.message);
});
