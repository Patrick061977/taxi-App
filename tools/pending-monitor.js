#!/usr/bin/env node
/**
 * LIVE Pending-State Monitor
 * Zeigt den aktuellen Telegram-Buchungsflow in Echtzeit
 *
 * Usage: node tools/pending-monitor.js
 * Aktualisiert alle 3 Sekunden
 */

const { execSync } = require('child_process');

const INSTANCE = 'taxi-heringsdorf-default-rtdb';
const PROJECT = 'taxi-heringsdorf';

function firebaseGet(path) {
  const cmd = `cmd //c "firebase database:get ${path} --instance ${INSTANCE} --project ${PROJECT} --pretty"`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 }));
  } catch(e) {
    return null;
  }
}

function clearScreen() {
  process.stdout.write('\x1B[2J\x1B[0f');
}

function display(pending) {
  clearScreen();
  const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  console.log(`\n🚕 PENDING-STATE MONITOR — ${now}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (!pending || Object.keys(pending).length === 0) {
    console.log('  ✅ Kein aktiver Pending-State. Warte auf neue Buchung...\n');
    return;
  }

  for (const [chatId, p] of Object.entries(pending)) {
    const age = p._createdAt ? Math.round((Date.now() - p._createdAt) / 1000) : '?';

    console.log(`┌── Chat: ${chatId} (${age}s alt)`);
    console.log(`│`);

    // Original Text
    if (p.originalText) console.log(`│  📝 Original: "${p.originalText}"`);

    // Kunde
    if (p.preselectedCustomer) {
      const c = p.preselectedCustomer;
      console.log(`│  👤 Kunde: ${c.name}${c.address ? ' | 🏠 ' + c.address : ''}`);
    }
    if (p.userName) console.log(`│  👤 User: ${p.userName}`);

    // Partial (KI-Ergebnis)
    if (p.partial) {
      const b = p.partial;
      console.log(`│`);
      console.log(`│  🤖 KI-ANALYSE:`);
      console.log(`│  ├─ Intent: ${b.intent || '?'}`);
      if (b.name)        console.log(`│  ├─ Name: ${b.name}`);
      if (b.phone)       console.log(`│  ├─ Telefon: ${b.phone}`);
      if (b.pickup)      console.log(`│  ├─ Abholort: ${b.pickup}${b.pickupLat ? ' ✅📍' : ' ❌keine Koordinaten'}`);
      if (b.destination) console.log(`│  ├─ Zielort: ${b.destination}${b.destinationLat ? ' ✅📍' : ' ❌keine Koordinaten'}`);
      if (b.datetime)    console.log(`│  ├─ Datum/Zeit: ${b.datetime}`);
      if (b.passengers)  console.log(`│  ├─ Personen: ${b.passengers}`);

      // Missing - DAS WICHTIGSTE
      if (b.missing && b.missing.length > 0) {
        console.log(`│  │`);
        console.log(`│  ├─ ❓ FEHLEND: ${b.missing.join(', ')}`);
      } else {
        console.log(`│  │`);
        console.log(`│  ├─ ✅ ALLES KOMPLETT`);
      }

      if (b.question) console.log(`│  ├─ 💬 Frage: "${b.question}"`);
      if (b.summary)  console.log(`│  └─ 📋 ${b.summary}`);
    }

    // Awaiting Flags
    const flags = Object.keys(p).filter(k => k.startsWith('awaiting') || k.startsWith('_awaiting'));
    if (flags.length > 0) {
      console.log(`│`);
      console.log(`│  ⏳ WARTET AUF: ${flags.join(', ')}`);
    }

    // Last Question
    if (p.lastQuestion) {
      console.log(`│  💬 Letzte Frage: "${p.lastQuestion.substring(0, 80)}${p.lastQuestion.length > 80 ? '...' : ''}"`);
    }

    // Favoriten
    if (p.favorites && p.favorites.length > 0) {
      console.log(`│`);
      console.log(`│  ⭐ FAVORITEN (${p.favorites.length}):`);
      p.favorites.forEach((f, i) => {
        console.log(`│  ${i + 1}. ${f.destination.substring(0, 50)} (${f.count}x)`);
      });
    }

    // POI Options (der Müll)
    if (p._poiDestOptions && p._poiDestOptions.length > 0) {
      console.log(`│`);
      console.log(`│  📍 POI-VORSCHLÄGE (${p._poiDestOptions.length}):`);
      p._poiDestOptions.forEach((poi, i) => {
        console.log(`│  ${i + 1}. ${poi.name} — ${poi.address}`);
      });
    }

    // Admin-spezifische Flags
    if (p.partial && p.partial._adminBooked) console.log(`│  🔐 Admin-Buchung`);
    if (p.partial && p.partial._crmCustomerId) console.log(`│  🗂️ CRM-ID: ${p.partial._crmCustomerId}`);
    if (p._adminDatePicker) console.log(`│  📅 Datums-Picker aktiv`);

    console.log(`│`);
    console.log(`└──────────────────────────────────────────────────────\n`);
  }
}

// Main Loop
console.log('🚀 Starte Pending-Monitor... (Strg+C zum Beenden)\n');

async function poll() {
  const data = firebaseGet('/settings/telegram/pending');
  display(data);
}

poll();
setInterval(poll, 3000);
