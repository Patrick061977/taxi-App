#!/usr/bin/env node
// v6.62.234: Headless-Test der Lohn-Logik für ALLE 3 Mitarbeiter,
// pro Monat. Aufruf: `node scripts/test-alle-mitarbeiter.js 2026 3`
// Defaults: aktueller Monat.

const FEIERTAGE_2026 = {
    '2026-01-01': 'Neujahr', '2026-04-03': 'Karfreitag', '2026-04-06': 'Ostermontag',
    '2026-05-01': 'Tag der Arbeit', '2026-05-14': 'Christi Himmelfahrt',
    '2026-05-25': 'Pfingstmontag', '2026-10-03': 'Tag der dt. Einheit',
    '2026-12-25': '1. Weihnachtstag', '2026-12-26': '2. Weihnachtstag'
};
const ZUSCHLAG_SONNTAG = 0.50, ZUSCHLAG_NACHT_25 = 0.25, ZUSCHLAG_NACHT_40 = 0.40, ZUSCHLAG_FEIERTAG = 1.50;
const SV_RATE = 0.20, LST_RATE = 0.06;
const RATE_SHIFT = 13.90, RATE_STANDBY = 2.50;

const PATTERNS = {
    Kargoll: {
        days: [3, 4, 5, 6, 0], mode: 'alternate', anchorDate: '2026-02-05',
        dayShift: { start: '09:00', end: '14:00', pauseStart: '14:00', pauseEnd: '14:30',
                    preStandbyStart: '07:30', preStandbyEnd: '09:00',
                    postStandbyStart: '14:30', postStandbyEnd: '17:30' },
        nightShift: { start: '21:00', end: '03:00', pauseStart: '21:00', pauseEnd: '21:30' }
    },
    Kulpa: {
        days: [1, 2, 3, 4, 5], mode: 'alternate', anchorDate: '2026-02-12',
        dayShift: { start: '09:00', end: '14:00', pauseStart: '14:00', pauseEnd: '14:30',
                    postStandbyStart: '14:30', postStandbyEnd: '17:00' },
        nightShift: { start: '21:00', end: '04:30', pauseStart: '21:00', pauseEnd: '21:30',
                      preStandbyStart: '20:00', preStandbyEnd: '21:00' }
    },
    Dombrowski: {
        days: [3, 4, 5], mode: 'fixed-day', anchorDate: '2026-02-05',
        dayShift: { start: '20:00', end: '22:00',
                    preStandbyStart: '19:00', preStandbyEnd: '20:00',
                    postStandbyStart: '22:00', postStandbyEnd: '23:00' },
        nightShift: { start: '21:00', end: '03:00' }
    }
};

function isHolidayDE(d) {
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return !!FEIERTAGE_2026[k];
}
function timeToMin(hhmm) { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function calcHours(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 1440;
    return mins / 60;
}
function calcZuschlagsStunden(date, sStart, sEnd, pStart, pEnd) {
    const out = { sonntag: 0, nacht25: 0, nacht40: 0, feiertag: 0 };
    if (!sStart || !sEnd) return out;
    const ss = timeToMin(sStart);
    let se = timeToMin(sEnd); if (se <= ss) se += 1440;
    let ps = pStart != null ? timeToMin(pStart) : null;
    let pe = pEnd != null ? timeToMin(pEnd) : null;
    if (ps != null && pe != null && pe <= ps) pe += 1440;
    const baseDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    for (let m = ss; m < se; m++) {
        if (ps != null && pe != null && m >= ps && m < pe) continue;
        const dayOff = Math.floor(m / 1440);
        const minOfDay = m % 1440;
        const dt = new Date(baseDay.getTime() + dayOff * 86400000);
        const dow = dt.getDay();
        const isSo = dow === 0;
        const isFt = isHolidayDE(dt);
        const isN25 = (minOfDay >= 1200 && minOfDay < 1440);
        const isN40 = (minOfDay >= 0 && minOfDay < 360);
        if (isFt) out.feiertag += 1 / 60;
        else if (isSo) out.sonntag += 1 / 60;
        if (isN25) out.nacht25 += 1 / 60;
        if (isN40) out.nacht40 += 1 / 60;
    }
    return {
        sonntag: Math.round(out.sonntag * 100) / 100,
        nacht25: Math.round(out.nacht25 * 100) / 100,
        nacht40: Math.round(out.nacht40 * 100) / 100,
        feiertag: Math.round(out.feiertag * 100) / 100
    };
}
function patternShiftForDate(p, d) {
    const dayIdx = (d.getDay() + 6) % 7;
    if (!p.days.includes(dayIdx)) return null;
    if (p.mode === 'fixed-day') return { type: 'day', shift: p.dayShift };
    if (p.mode === 'fixed-night') return { type: 'night', shift: p.nightShift };
    const [ay, am, ad] = p.anchorDate.split('-').map(Number);
    const anchorUTC = Date.UTC(ay, am - 1, ad);
    const targetUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const block = Math.floor(Math.floor((targetUTC - anchorUTC) / 86400000) / 7);
    return (block % 2 === 0)
        ? { type: 'day', shift: p.dayShift }
        : { type: 'night', shift: p.nightShift };
}

function runMonthForStaff(name, pattern, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    let tVor = 0, tPause = 0, tBez = 0, tPre = 0, tPost = 0;
    let tSo = 0, tN25 = 0, tN40 = 0, tFt = 0;
    let dc = 0, tagC = 0, nachtC = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const tas = patternShiftForDate(pattern, date);
        if (!tas) continue;
        const sh = tas.shift;
        const fullVor = calcHours(sh.start, sh.end);
        const pauseH = (sh.pauseStart && sh.pauseEnd) ? calcHours(sh.pauseStart, sh.pauseEnd) : 0;
        const fullBez = Math.max(0, fullVor - pauseH);
        const preH = (sh.preStandbyStart && sh.preStandbyEnd) ? calcHours(sh.preStandbyStart, sh.preStandbyEnd) : 0;
        const postH = (sh.postStandbyStart && sh.postStandbyEnd) ? calcHours(sh.postStandbyStart, sh.postStandbyEnd) : 0;
        const z = calcZuschlagsStunden(date, sh.start, sh.end, sh.pauseStart, sh.pauseEnd);
        dc++; if (tas.type === 'day') tagC++; else nachtC++;
        tVor += fullVor; tPause += pauseH; tBez += fullBez;
        tPre += preH; tPost += postH;
        tSo += z.sonntag; tN25 += z.nacht25; tN40 += z.nacht40; tFt += z.feiertag;
    }
    const standby = tPre + tPost;
    const bruttoVoll = +(tBez * RATE_SHIFT).toFixed(2);
    const bruttoStandby = +(standby * RATE_STANDBY).toFixed(2);
    const stpfl = +(bruttoVoll + bruttoStandby).toFixed(2);
    const zSo = +(tSo * RATE_SHIFT * ZUSCHLAG_SONNTAG).toFixed(2);
    const zN25 = +(tN25 * RATE_SHIFT * ZUSCHLAG_NACHT_25).toFixed(2);
    const zN40 = +(tN40 * RATE_SHIFT * ZUSCHLAG_NACHT_40).toFixed(2);
    const zFt = +(tFt * RATE_SHIFT * ZUSCHLAG_FEIERTAG).toFixed(2);
    const zSumme = +(zSo + zN25 + zN40 + zFt).toFixed(2);
    const sv = +(stpfl * SV_RATE).toFixed(2);
    const lst = +(stpfl * LST_RATE).toFixed(2);
    const netto = +(stpfl - sv - lst + zSumme).toFixed(2);
    return { name, dc, tagC, nachtC, tVor, tPause, tBez, standby, tSo, tN25, tN40, tFt,
             bruttoVoll, bruttoStandby, stpfl, zSo, zN25, zN40, zFt, zSumme, sv, lst, netto };
}

const args = process.argv.slice(2);
const year = parseInt(args[0]) || new Date().getFullYear();
const month = parseInt(args[1]) || (new Date().getMonth() + 1);
const monthName = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'][month - 1];

console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
console.log(`║  LOHN-VORSCHAU ${monthName} ${year} · Funk Taxi Heringsdorf            ║`);
console.log(`╚══════════════════════════════════════════════════════════════════╝`);

const results = [];
for (const name of ['Kargoll', 'Kulpa', 'Dombrowski']) {
    const r = runMonthForStaff(name, PATTERNS[name], year, month);
    results.push(r);
    console.log(`\n┌─ ${r.name} (${r.dc} Tage: ${r.tagC}× TAG + ${r.nachtC}× NACHT) ─`);
    console.log(`│ Voll vor Pause: ${r.tVor.toFixed(2)}h  − Pause ${r.tPause.toFixed(2)}h  = Bezahlt ${r.tBez.toFixed(2)}h`);
    console.log(`│ Rufbereitschaft: ${r.standby.toFixed(2)}h`);
    if (r.tSo) console.log(`│ Sonntag-h: ${r.tSo.toFixed(2)}h → ${r.zSo}€`);
    if (r.tN25) console.log(`│ Nacht 25%: ${r.tN25.toFixed(2)}h → ${r.zN25}€`);
    if (r.tN40) console.log(`│ Nacht 40%: ${r.tN40.toFixed(2)}h → ${r.zN40}€`);
    if (r.tFt) console.log(`│ Feiertag-h: ${r.tFt.toFixed(2)}h → ${r.zFt}€`);
    console.log(`│ Brutto Voll:    ${r.bruttoVoll.toFixed(2)}€  +  Brutto Rufber.: ${r.bruttoStandby.toFixed(2)}€`);
    console.log(`│ Stpfl. Brutto:  ${r.stpfl.toFixed(2)}€`);
    console.log(`│ Steuerfr. Zuschläge: ${r.zSumme}€`);
    console.log(`│ − SV (20%): -${r.sv}€   − LSt (6%): -${r.lst}€`);
    console.log(`└─ ≈ NETTO: ${r.netto}€`);
}

const grand = (k) => results.reduce((s, r) => s + (r[k] || 0), 0);
console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
console.log(`║  GESAMT-LOHNKOSTEN ${monthName} ${year}                                ║`);
console.log(`╠══════════════════════════════════════════════════════════════════╣`);
console.log(`║  Stpfl. Brutto:        ${grand('stpfl').toFixed(2).padStart(10)} €              ║`);
console.log(`║  Steuerfr. Zuschläge:  ${grand('zSumme').toFixed(2).padStart(10)} €              ║`);
console.log(`║  Netto (an Mitarbeiter):${grand('netto').toFixed(2).padStart(10)} €              ║`);
console.log(`║  SV-Abzug (Patrick):   ${grand('sv').toFixed(2).padStart(10)} €              ║`);
console.log(`║  LSt-Abzug:            ${grand('lst').toFixed(2).padStart(10)} €              ║`);
console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
