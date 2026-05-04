#!/usr/bin/env node
// v6.62.233: Headless-Test der Lohn-Logik für Kargoll April 2026.
// Spiegelt die Funktionen aus schichtplan.html (calcZuschlagsStunden,
// patternShiftForDate, classifyDay, buildPlanEntryFromPattern) — wenn
// die Zahlen hier passen, klappt's auch in der App.

const FEIERTAGE_2026 = {
    '2026-01-01': 'Neujahr',
    '2026-04-03': 'Karfreitag',
    '2026-04-06': 'Ostermontag',
    '2026-05-01': 'Tag der Arbeit',
    '2026-05-14': 'Christi Himmelfahrt',
    '2026-05-25': 'Pfingstmontag',
    '2026-10-03': 'Tag der dt. Einheit',
    '2026-12-25': '1. Weihnachtstag',
    '2026-12-26': '2. Weihnachtstag'
};
const ZUSCHLAG_SONNTAG = 0.50;
const ZUSCHLAG_NACHT_25 = 0.25;
const ZUSCHLAG_NACHT_40 = 0.40;
const ZUSCHLAG_FEIERTAG = 1.50;
const SV_RATE = 0.20;
const LST_RATE = 0.06;

// Default-Pattern Kargoll aus schichtplan.html v6.62.233
const PATTERN_KARGOLL = {
    enabled: true,
    days: [3, 4, 5, 6, 0],   // Do, Fr, Sa, So, Mo
    mode: 'alternate',
    anchorDate: '2026-02-05',
    dayShift: {
        start: '09:00', end: '14:00',
        pauseStart: '14:00', pauseEnd: '14:30',
        preStandbyStart: '07:30', preStandbyEnd: '09:00',
        postStandbyStart: '14:30', postStandbyEnd: '17:30'
    },
    nightShift: {
        start: '21:00', end: '03:00',
        pauseStart: '21:00', pauseEnd: '21:30'
    }
};

const RATE_SHIFT = 13.90;
const RATE_STANDBY = 2.50;

// ── Helper (1:1 aus schichtplan.html) ─────────────────────────────
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
    if (mins < 0) mins += 24 * 60;
    return mins / 60;
}
function calcZuschlagsStunden(date, sStart, sEnd, pStart, pEnd) {
    const out = { sonntag: 0, nacht25: 0, nacht40: 0, feiertag: 0 };
    if (!sStart || !sEnd) return out;
    const ss = timeToMin(sStart);
    let se = timeToMin(sEnd);
    if (se <= ss) se += 1440;
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
    out.sonntag = Math.round(out.sonntag * 100) / 100;
    out.nacht25 = Math.round(out.nacht25 * 100) / 100;
    out.nacht40 = Math.round(out.nacht40 * 100) / 100;
    out.feiertag = Math.round(out.feiertag * 100) / 100;
    return out;
}
function patternShiftForDate(p, d) {
    const dayIdx = (d.getDay() + 6) % 7;
    if (!p.days.includes(dayIdx)) return null;
    if (p.mode === 'fixed-day') return { type: 'day', shift: p.dayShift };
    if (p.mode === 'fixed-night') return { type: 'night', shift: p.nightShift };
    const [ay, am, ad] = p.anchorDate.split('-').map(Number);
    const anchorUTC = Date.UTC(ay, am - 1, ad);
    const targetUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const dd = Math.floor((targetUTC - anchorUTC) / 86400000);
    const block = Math.floor(dd / 7);
    return (block % 2 === 0)
        ? { type: 'day', shift: p.dayShift }
        : { type: 'night', shift: p.nightShift };
}
function buildPlanEntry(tas) {
    const sh = tas.shift;
    const fullVor = calcHours(sh.start, sh.end);
    const pauseH = (sh.pauseStart && sh.pauseEnd) ? calcHours(sh.pauseStart, sh.pauseEnd) : 0;
    const fullBez = Math.max(0, fullVor - pauseH);
    const preH = (sh.preStandbyStart && sh.preStandbyEnd) ? calcHours(sh.preStandbyStart, sh.preStandbyEnd) : 0;
    const postH = (sh.postStandbyStart && sh.postStandbyEnd) ? calcHours(sh.postStandbyStart, sh.postStandbyEnd) : 0;
    return {
        type: tas.type,
        start: sh.start, end: sh.end,
        hours: fullBez, hoursAttendance: fullVor,
        pauseHours: pauseH, pauseStart: sh.pauseStart, pauseEnd: sh.pauseEnd,
        preStandbyHours: preH, postStandbyHours: postH,
        standbyHoursTotal: preH + postH
    };
}

// ── Hauptlauf: April 2026 ────────────────────────────────────────
function runMonth(year, month, label) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const dayShortNames = ['So','Mo','Di','Mi','Do','Fr','Sa'];
    const lines = [];
    let tVor = 0, tPause = 0, tBez = 0, tStandby = 0;
    let tSo = 0, tN25 = 0, tN40 = 0, tFt = 0;
    let dayCount = 0, tagCount = 0, nachtCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const tas = patternShiftForDate(PATTERN_KARGOLL, date);
        const dayLbl = String(d).padStart(2, '0') + '.' + String(month).padStart(2, '0') + '.';
        const tag = dayShortNames[date.getDay()];
        const ftName = FEIERTAGE_2026[date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')];
        if (!tas) { lines.push(`${dayLbl} ${tag}    —`); continue; }
        const plan = buildPlanEntry(tas);
        const z = calcZuschlagsStunden(date, plan.start, plan.end, plan.pauseStart, plan.pauseEnd);
        dayCount++;
        if (tas.type === 'day') tagCount++; else nachtCount++;
        tVor += plan.hoursAttendance;
        tPause += plan.pauseHours;
        tBez += plan.hours;
        tStandby += plan.standbyHoursTotal;
        tSo += z.sonntag; tN25 += z.nacht25; tN40 += z.nacht40; tFt += z.feiertag;
        const ftFlag = ftName ? ` 🎉${ftName}` : '';
        const zStr = [
            z.sonntag > 0 ? `So ${z.sonntag}h` : '',
            z.nacht25 > 0 ? `N25 ${z.nacht25}h` : '',
            z.nacht40 > 0 ? `N40 ${z.nacht40}h` : '',
            z.feiertag > 0 ? `Ft ${z.feiertag}h` : ''
        ].filter(Boolean).join(' · ');
        lines.push(`${dayLbl} ${tag}    ${tas.type === 'day' ? '☀️ TAG ' : '🌙 NACHT'}  Voll=${plan.hours}h  Ruf=${plan.standbyHoursTotal}h  ${zStr}${ftFlag}`);
    }

    const bruttoVoll = +(tBez * RATE_SHIFT).toFixed(2);
    const bruttoStandby = +(tStandby * RATE_STANDBY).toFixed(2);
    const stpflBrutto = +(bruttoVoll + bruttoStandby).toFixed(2);
    const zuschlSo = +(tSo * RATE_SHIFT * ZUSCHLAG_SONNTAG).toFixed(2);
    const zuschlN25 = +(tN25 * RATE_SHIFT * ZUSCHLAG_NACHT_25).toFixed(2);
    const zuschlN40 = +(tN40 * RATE_SHIFT * ZUSCHLAG_NACHT_40).toFixed(2);
    const zuschlFt = +(tFt * RATE_SHIFT * ZUSCHLAG_FEIERTAG).toFixed(2);
    const zuschlSumme = +(zuschlSo + zuschlN25 + zuschlN40 + zuschlFt).toFixed(2);
    const sv = +(stpflBrutto * SV_RATE).toFixed(2);
    const lst = +(stpflBrutto * LST_RATE).toFixed(2);
    const netto = +(stpflBrutto - sv - lst + zuschlSumme).toFixed(2);

    console.log(`\n═════════════════════════════════════════════════════`);
    console.log(`  KARGOLL ${label}`);
    console.log(`═════════════════════════════════════════════════════`);
    console.log(lines.join('\n'));
    console.log(`\n─── Summen (${dayCount} Arbeitstage: ${tagCount}× TAG + ${nachtCount}× NACHT) ───`);
    console.log(`Voll vor Pause:   ${tVor.toFixed(2)}h`);
    console.log(`Pause:            -${tPause.toFixed(2)}h`);
    console.log(`Voll bezahlt:     ${tBez.toFixed(2)}h`);
    console.log(`Rufbereitschaft:  ${tStandby.toFixed(2)}h`);
    console.log(`Sonntag-h:        ${tSo.toFixed(2)}h → Zuschlag ${zuschlSo}€`);
    console.log(`Nacht 25%:        ${tN25.toFixed(2)}h → Zuschlag ${zuschlN25}€`);
    console.log(`Nacht 40%:        ${tN40.toFixed(2)}h → Zuschlag ${zuschlN40}€`);
    console.log(`Feiertag-h:       ${tFt.toFixed(2)}h → Zuschlag ${zuschlFt}€`);
    console.log(`\n─── Lohn ───`);
    console.log(`Brutto Voll:      ${bruttoVoll.toFixed(2)}€  (${tBez.toFixed(2)}h × ${RATE_SHIFT})`);
    console.log(`Brutto Rufber.:   ${bruttoStandby.toFixed(2)}€  (${tStandby.toFixed(2)}h × ${RATE_STANDBY})`);
    console.log(`────────────────────────────`);
    console.log(`Stpfl. Brutto:    ${stpflBrutto.toFixed(2)}€`);
    console.log(`+ Steuerfr. Zuschläge: ${zuschlSumme.toFixed(2)}€`);
    console.log(`- SV (20%):       -${sv.toFixed(2)}€`);
    console.log(`- LSt (6%):       -${lst.toFixed(2)}€`);
    console.log(`════════════════════════════`);
    console.log(`≈ NETTO:          ${netto.toFixed(2)}€`);
    return { dayCount, tagCount, nachtCount, tBez, tStandby, tSo, tN25, tN40, tFt, stpflBrutto, zuschlSumme, netto };
}

const apr = runMonth(2026, 4, 'April 2026');
const feb = runMonth(2026, 2, 'Februar 2026 (Vergleich gegen ECOVIS-Original)');

console.log(`\n═════════════════════════════════════════════════════`);
console.log(`  VERGLEICH FEBRUAR vs ECOVIS-ORIGINAL`);
console.log(`═════════════════════════════════════════════════════`);
console.log(`Original-XLSX (Kopie von Vorschlag_Lohn_Kargoll_02.2026.xlsx):`);
console.log(`  G32 (geleist. Std.): 104   ← OHNE Pause-Abzug`);
console.log(`  I32 (Rufber. ges.):  30`);
console.log(`  J33 (So 50% €):      156,38`);
console.log(`  K33 (Nacht 25% €):   83,40`);
console.log(`  L33 (Nacht 40% €):   111,20`);
console.log(`  G33 (Brutto-Voll):   1445,60`);
console.log(`  I33 (Brutto-Ruf.):   75,00`);
console.log(`\nMarkdown-Spec (Stundenzettel_Prompt_2026.md):`);
console.log(`  Voll bezahlt:        89h  ← MIT Pause-Abzug`);
console.log(`  Rufber.:             30h`);
console.log(`\nMein Generator (v6.62.233 mit Pattern-Defaults):`);
console.log(`  Voll bezahlt:        ${feb.tBez.toFixed(2)}h`);
console.log(`  Rufber.:             ${feb.tStandby.toFixed(2)}h`);
console.log(`  So 50% €:            ${(feb.tSo * RATE_SHIFT * ZUSCHLAG_SONNTAG).toFixed(2)}`);
console.log(`  Nacht 25% €:         ${(feb.tN25 * RATE_SHIFT * ZUSCHLAG_NACHT_25).toFixed(2)}`);
console.log(`  Nacht 40% €:         ${(feb.tN40 * RATE_SHIFT * ZUSCHLAG_NACHT_40).toFixed(2)}`);
