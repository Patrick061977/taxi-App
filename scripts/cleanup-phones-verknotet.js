#!/usr/bin/env node
/**
 * cleanup-phones-verknotet.js — Patrick 13.07. Bridge #1783924174824
 *
 * Sweep für "verknotete" Kunden-Nummern (mehrere Nummern in EINEM phone-Feld,
 * Slash- oder Whitespace-getrennt). Splittet in Handy + Festnetz.
 *
 * Konvention (Patrick 13.07.):
 *   phone       = primaere Nummer (Handy hat Vorrang, weil SMS/WA/Stripe-Link)
 *   mobilePhone = Handy (Duplikat von phone wenn primary Handy)
 *   phone2      = Festnetz (falls zusaetzlich vorhanden)
 *
 * Modi:
 *   --preview  → nur ausgeben was gemacht wuerde (kein Write)
 *   --apply    → tatsaechlich patchen
 *
 * Nutzung:
 *   node scripts/cleanup-phones-verknotet.js --preview
 *   node scripts/cleanup-phones-verknotet.js --apply
 */
const { execSync } = require('child_process');
const fs = require('fs');

const REST = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
const MODE = process.argv.includes('--apply') ? 'apply' : 'preview';

function token() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

async function getAll() {
    const t = token();
    const url = `${REST}/customers.json?access_token=${t}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET /customers ${res.status}`);
    return await res.json();
}

// Klassifikation: ist String eine Handy-Nummer?
// Deutsche Handys: 015x, 016x, 017x, +4915x/+4916x/+4917x, 0049 15x usw.
function isMobile(num) {
    const digits = num.replace(/\D/g, '');
    // +49 → 49 vorne; local 0 → nix
    let d = digits;
    if (d.startsWith('49')) d = d.slice(2);
    else if (d.startsWith('0049')) d = d.slice(4);
    else if (d.startsWith('0')) d = d.slice(1);
    // Handys: 15x 16x 17x
    return /^1[567]\d/.test(d);
}

// Normalize zu +49...-Format wenn moeglich
function normalize(num) {
    let d = num.replace(/[^\d+]/g, '');
    if (!d) return null;
    if (d.startsWith('+')) return d;
    if (d.startsWith('0049')) return '+' + d.slice(2);
    if (d.startsWith('49')) return '+' + d;
    if (d.startsWith('0')) return '+49' + d.slice(1);
    return d.length >= 6 ? '+49' + d : null;
}

// Split verknoteter String → Array von Einzel-Nummern
function splitVerknotet(raw) {
    if (!raw) return [];
    // Erste Split: bei "/" oder ";" oder "|"
    let parts = raw.split(/[\/;|]/).map(s => s.trim()).filter(Boolean);
    // Zweiter Split: bei "+49" mitten im String (z.B. "038-378-29109 +491515...")
    const out = [];
    for (const p of parts) {
        // Look for pattern where a second +49 appears after some digits
        const subs = p.split(/(?=(?:\+49|00\s?49))/g).map(s => s.trim()).filter(Boolean);
        if (subs.length > 1) {
            for (const s of subs) out.push(s);
        } else {
            // Auch bei doppelten Leerraeumen zwischen Zahlen splitten (Whitespace zwischen 2 Nummern)
            const wsSubs = p.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
            if (wsSubs.length > 1) for (const s of wsSubs) out.push(s); else out.push(p);
        }
    }
    return out;
}

async function patchCustomer(id, patch) {
    const t = token();
    const url = `${REST}/customers/${id}.json?access_token=${t}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error(`PATCH ${id}: ${res.status} ${await res.text()}`);
    return true;
}

(async () => {
    console.log(`🔍 Lade customers... (Modus: ${MODE.toUpperCase()})`);
    const customers = await getAll();
    if (!customers) { console.log('empty'); return; }

    const report = { total: 0, fixed: 0, unclear: [], applied: [] };
    for (const [id, c] of Object.entries(customers)) {
        if (!c || typeof c !== 'object') continue;
        const phone = String(c.phone || '');
        // Nur "verknotete" Faelle
        const hasSlash = /[\/;|]/.test(phone);
        const hasMultiPlus = (phone.match(/\+49/g) || []).length > 1;
        const hasWideWs = /\s{2,}/.test(phone.trim()) && (phone.match(/\d{4,}/g) || []).length > 1;
        if (!hasSlash && !hasMultiPlus && !hasWideWs) continue;

        report.total++;
        const parts = splitVerknotet(phone);
        const normalizedRaw = parts.map(normalize).filter(Boolean);
        // Dedupe: gleiche Nummer nur einmal
        const normalized = [...new Set(normalizedRaw)];
        if (normalized.length < 2) {
            // War alles nur eine einzige (doppelt geschriebene) Nummer
            if (normalized.length === 1) {
                const patch = {
                    phone: normalized[0],
                    mobilePhone: isMobile(normalized[0]) ? normalized[0] : '',
                    phone2: '',
                    phoneCleanupAt: Date.now(),
                    phoneCleanupBy: 'claude-verknotet-sweep-v6.63.692-dedupe'
                };
                console.log(`${MODE === 'apply' ? '✅' : '🔎'} ${c.name || id} [DEDUPE-SAME]: "${phone}" → phone=${normalized[0]}`);
                if (MODE === 'apply') { try { await patchCustomer(id, patch); report.applied.push({ id, name: c.name, patch }); report.fixed++; } catch (e) { report.unclear.push({ id, name: c.name, phone, reason: 'PATCH-Error: ' + e.message }); } } else report.fixed++;
                continue;
            }
            report.unclear.push({ id, name: c.name, phone, reason: 'nur 1 valid nach normalize' });
            continue;
        }

        const mobiles = normalized.filter(isMobile);
        const landlines = normalized.filter(n => !isMobile(n));

        // Regel: primary=Handy wenn vorhanden, sonst Festnetz (aber Handy ist Ziel)
        let newPhone, newMobile, newPhone2;
        if (mobiles.length >= 1) {
            newPhone = mobiles[0];
            newMobile = mobiles[0];
            newPhone2 = landlines[0] || (mobiles[1] || '');
        } else {
            // Nur Festnetz-Nummern verknotet — kein Handy zu erkennen
            newPhone = landlines[0];
            newMobile = '';
            newPhone2 = landlines[1] || '';
        }

        // Sanity: wenn Split komplett fehlerhaft (Nummer <8 Digits), nicht schreiben
        if (!newPhone || newPhone.replace(/\D/g, '').length < 8) {
            report.unclear.push({ id, name: c.name, phone, reason: 'Split-Ergebnis zu kurz: ' + newPhone });
            continue;
        }
        // Dedup: wenn phone2 == phone → phone2 leer
        if (newPhone2 && newPhone2 === newPhone) newPhone2 = '';

        const patch = {
            phone: newPhone,
            mobilePhone: newMobile,
            phone2: newPhone2,
            phoneCleanupAt: Date.now(),
            phoneCleanupBy: 'claude-verknotet-sweep-v6.63.692'
        };

        console.log(`${MODE === 'apply' ? '✅' : '🔎'} ${c.name || id}: "${phone}" → phone=${newPhone} mobile=${newMobile} phone2=${newPhone2}`);
        if (MODE === 'apply') {
            try {
                await patchCustomer(id, patch);
                report.applied.push({ id, name: c.name, patch });
                report.fixed++;
            } catch (e) {
                report.unclear.push({ id, name: c.name, phone, reason: 'PATCH-Error: ' + e.message });
            }
        } else {
            report.fixed++;
        }
    }

    console.log(`\n━━━ REPORT ${MODE.toUpperCase()} ━━━`);
    console.log(`Verknotet gefunden: ${report.total}`);
    console.log(`${MODE === 'apply' ? 'Gefixt:' : 'Wuerde fixen:'} ${report.fixed}`);
    console.log(`Unklar (nicht angefasst): ${report.unclear.length}`);
    if (report.unclear.length > 0) {
        console.log('\nUnklare Faelle:');
        for (const u of report.unclear) console.log(`  ${u.name}: ${u.phone} → ${u.reason}`);
    }

    fs.writeFileSync('.phone-cleanup-report.json', JSON.stringify(report, null, 2));
    console.log('\nReport gespeichert: .phone-cleanup-report.json');
})().catch(e => { console.error(e); process.exit(1); });
