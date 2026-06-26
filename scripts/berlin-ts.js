#!/usr/bin/env node
/**
 * berlin-ts.js — DST-sicherer Berlin-Timestamp-Rechner
 *
 * Verwendung:
 *   node scripts/berlin-ts.js 2026-06-27 09:00
 *   node scripts/berlin-ts.js 2026-12-15 14:30
 *
 * Gibt aus: Timestamp (ms) + Verifikation in Berlin-Zeit
 * Immer korrekt für CEST (Sommer UTC+2) UND CET (Winter UTC+1).
 *
 * Exportiert auch berlinToTs() für andere Scripts.
 */

/**
 * Konvertiert Datum+Uhrzeit in Berlin-Lokalzeit zu UTC-Timestamp (ms).
 * DST-aware: funktioniert in Sommer (CEST UTC+2) UND Winter (CET UTC+1).
 *
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} timeStr - "HH:MM"
 * @returns {number} UTC-Timestamp in Millisekunden
 */
function berlinToTs(dateStr, timeStr) {
    // Noon-Probe: Berlin-Offset um 12:00 UTC bestimmen (vermeidet DST-Grenze)
    const probe = new Date(dateStr + 'T12:00:00Z');
    const berlinNoonHour = parseInt(
        probe.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false })
    );
    const offsetMs = (berlinNoonHour - 12) * 3600000; // CEST: 7200000, CET: 3600000
    // UTC-Timestamp = Berlin-Zeit als pseudo-UTC minus Offset
    const ts = new Date(dateStr + 'T' + timeStr + ':00Z').getTime() - offsetMs;
    return ts;
}

// Verifikation: rückrechnen und zeigen
function verify(ts) {
    return new Date(ts).toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin',
        weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// CLI-Modus
if (require.main === module) {
    const [,, dateArg, timeArg] = process.argv;
    if (!dateArg || !timeArg) {
        console.error('Verwendung: node scripts/berlin-ts.js YYYY-MM-DD HH:MM');
        process.exit(1);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
        console.error('Datum muss Format YYYY-MM-DD haben, z.B. 2026-06-27');
        process.exit(1);
    }
    if (!/^\d{2}:\d{2}$/.test(timeArg)) {
        console.error('Uhrzeit muss Format HH:MM haben, z.B. 09:00');
        process.exit(1);
    }
    const ts = berlinToTs(dateArg, timeArg);
    const probe = new Date(dateArg + 'T12:00:00Z');
    const berlinNoonHour = parseInt(
        probe.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false })
    );
    const offset = berlinNoonHour - 12;
    console.log('');
    console.log('Timestamp (ms): ' + ts);
    console.log('Berlin-Zeit:    ' + verify(ts));
    console.log('UTC-Zeit:       ' + new Date(ts).toISOString());
    console.log('Offset:         UTC+' + offset + ' (' + (offset === 2 ? 'CEST Sommer' : 'CET Winter') + ')');
    console.log('');
}

module.exports = { berlinToTs, verify };
