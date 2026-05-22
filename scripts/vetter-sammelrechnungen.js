#!/usr/bin/env node
// vetter-sammelrechnungen.js — Erstellt 9 Sammelrechnungen pro Monat
// für alle Vetter-Bulk-Rides (status=completed, createdBy=auftrag-import-pdf-bulk)
//
// Mode default: DRY-RUN
// --apply: schreibt tatsächlich in /invoices

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const INSTANCE = 'taxi-heringsdorf-default-rtdb';

// Tarif-Konstanten (gleich wie functions/index.js)
const TARIF = { gg: 4.0, k12: 3.30, k34: 2.80, k5: 2.20, ng_gg: 5.50, ng_k5: 2.40 };
const FEIERTAGE = ['01-01','05-01','10-03','10-31','12-24','12-25','12-26','12-31'];
function isFeiertag(d) {
    const md = String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    return FEIERTAGE.includes(md);
}
function calc(km, persons, waypoints, ts) {
    const dt = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const hour = dt.getHours(), day = dt.getDay();
    const night = (hour >= 22 || hour < 6) || (day === 0) || isFeiertag(dt);
    const gg = night ? TARIF.ng_gg : TARIF.gg;
    const k5 = night ? TARIF.ng_k5 : TARIF.k5;
    let kp = 0;
    if (km <= 2) kp = km*TARIF.k12;
    else if (km <= 4) kp = 2*TARIF.k12 + (km-2)*TARIF.k34;
    else kp = 2*TARIF.k12 + 2*TARIF.k34 + (km-4)*k5;
    let taxi = gg + kp;
    taxi = Math.round(taxi*10)/10;  // 10-Cent-Rounding
    const grossraum = persons >= 5 ? 10 : 0;
    const wartezeitMin = waypoints * 3;
    const wartezeitEur = Math.round(wartezeitMin * 0.67 * 100)/100;
    return { taxi, grossraum, wartezeitMin, wartezeitEur, total: taxi + grossraum + wartezeitEur };
}

function brt2net(brutto, vatRate=7) {
    // Brutto = Netto * (1 + vatRate/100) → Netto = Brutto / (1.07)
    const net = brutto / (1 + vatRate/100);
    return Math.round(net * 100) / 100;
}

const VETTER_CUSTOMER = {
    customerId: 'customer_1776579773525',
    customerName: 'Vetter Touristik',
    customerAddress: 'Hinsdorfer Weg 1, 06780 Zörbig',
    address: 'Hinsdorfer Weg 1, 06780 Zörbig',
    kundennummer: 'LF000009'
};

(async () => {
    // Hole Vetter-Bulk-Rides
    console.log('[Vetter-Sammel] Hole Rides ...');
    const tmpRides = path.join(os.tmpdir(), `rides-${Date.now()}.json`);
    execSync(`firebase database:get --instance ${INSTANCE} /rides > "${tmpRides}"`, {
        env: { ...process.env, MSYS_NO_PATHCONV: '1' }, shell: true, stdio: ['inherit','pipe','inherit']
    });
    const allRides = JSON.parse(fs.readFileSync(tmpRides,'utf8'));
    fs.unlinkSync(tmpRides);
    const vbulk = Object.entries(allRides)
        .filter(([k,v]) => v && typeof v === 'object' && v.createdBy === 'auftrag-import-pdf-bulk')
        .map(([k,v]) => ({ id: k, ...v }));
    console.log(`[Vetter-Sammel] ${vbulk.length} Vetter-Bulk-Rides gefunden`);

    // Group by month
    const byMonth = {};
    for (const r of vbulk) {
        const dt = new Date(r.pickupTimestamp);
        const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
        (byMonth[ym] = byMonth[ym] || []).push(r);
    }

    const today = new Date();
    const todayDateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const allInvoices = {};
    let invoiceCounter = 197;  // fortlaufend ab 20-26-197 (höchste war 196)
    let grandTotal = 0;

    for (const ym of Object.keys(byMonth).sort()) {
        const trips = byMonth[ym].sort((a,b) => a.pickupTimestamp - b.pickupTimestamp);
        const [year, month] = ym.split('-');
        const invoiceNumber = `20-26-${String(invoiceCounter).padStart(3,'0')}`;

        // Build positions[] — pro Trip 1 Position
        const positions = [];
        let posId = 1;
        let totalBrutto = 0;
        for (const t of trips) {
            const km = parseFloat(t.distance) || 0;
            const persons = parseInt(t.passengers) || 1;
            const waypoints = (t.waypoints || []).length;
            const c = calc(km, persons, waypoints, t.pickupTimestamp);
            const dt = new Date(t.pickupTimestamp);
            const dateStr = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
            const fromShort = (t.pickup || '').split(',')[0].trim().slice(0, 40);
            const toShort = (t.destination || '').split(',')[0].trim().slice(0, 40);
            const guestShort = (t.guestName || '').slice(0, 50);
            let desc = `Transfer ${dateStr} — ${fromShort} → ${toShort} (${persons}P, ${km.toFixed(1)}km`;
            if (waypoints > 0) desc += `, ${waypoints} Stopp(s)`;
            desc += `)`;
            if (guestShort) desc += ` · ${guestShort}`;
            positions.push({
                id: posId++,
                description: desc.slice(0, 200),
                quantity: 1,
                unit: 'Fahrt',
                amount: parseFloat(c.total.toFixed(2)),
                discount: 0,
                vatRate: 7,
                note: '',
                _rideId: t.id  // intern für Verknüpfung
            });
            totalBrutto += c.total;
        }

        const totalBruttoRounded = Math.round(totalBrutto * 100) / 100;
        const totalNet = brt2net(totalBruttoRounded);
        const totalVat = parseFloat((totalBruttoRounded - totalNet).toFixed(2));

        // Leistungszeitraum: 1.-letzter Tag des Monats
        const monthEnd = new Date(parseInt(year), parseInt(month), 0);
        const lastDay = String(monthEnd.getDate()).padStart(2,'0');
        const rideDate = `${year}-${month}-${lastDay}`;
        const deliveryFromStr = `${year}-${month}-01`;
        const deliveryToStr   = `${year}-${month}-${lastDay}`;

        const invoice = {
            ...VETTER_CUSTOMER,
            invoiceNumber,
            createdAt: Date.now() + invoiceCounter,
            createdBy: 'vetter-sammelrechnung-bulk',
            status: 'entwurf',
            paymentMethod: 'überweisung',
            paymentTerms: 'Zahlbar innerhalb 14 Tagen nach Rechnungserhalt',
            closingNote: 'Vielen Dank für die gute Zusammenarbeit.',
            displayOptions: {
                showAddress: true,
                showCustomer: true,
                showDateTime: true,
                showDistance: false,
                showGuest: false,
                showRoute: false,
                showVat: true
            },
            rideDate,
            rideTime: '',
            rideId: '',
            deliveryDate: '',
            deliveryFrom: deliveryFromStr,
            deliveryTo: deliveryToStr,
            positions,
            totalGross: totalBruttoRounded,
            totalNet: totalNet,
            totalVat: totalVat,
            netPrice: totalNet,
            vatAmount: totalVat,
            netBreakdown: { '7': totalNet },
            vatBreakdown: { '7': totalVat },
            pickup: trips[0]?.pickup || '',
            pickupName: '',
            destination: trips[trips.length-1]?.destination || '',
            distance: trips.reduce((s,t) => s + (parseFloat(t.distance) || 0), 0),
            guestName: '',
            waypoints: [],
            waypointNames: [],
            emailSent: false,
            pdfFileName: '',
            pdfUrl: '',
            updatedAt: Date.now() + invoiceCounter,
            _isSammelrechnung: true,
            _tripCount: trips.length,
            _rideIds: trips.map(t => t.id)
        };

        allInvoices[invoiceNumber] = invoice;
        grandTotal += totalBruttoRounded;
        invoiceCounter += 1;

        console.log(`\n[${invoiceNumber}] ${ym} - ${trips.length} Trips, ${totalBruttoRounded.toFixed(2)} EUR brutto`);
        positions.slice(0, 3).forEach(p => console.log(`  ${p.description.slice(0, 80)} = ${p.amount} EUR`));
        if (positions.length > 3) console.log(`  ... + ${positions.length - 3} weitere`);
    }

    console.log(`\n[GESAMT] ${Object.keys(allInvoices).length} Rechnungen, ${grandTotal.toFixed(2)} EUR brutto`);

    if (!APPLY) {
        console.log('\n🔍 DRY-RUN — schreibe nichts. JSON gespeichert:');
        const outFile = 'C:/Users/Taxi/OneDrive/5.Buchführung/Vetter-Touristik-Auftraege/_sammelrechnungen-dry.json';
        fs.writeFileSync(outFile, JSON.stringify(allInvoices, null, 2));
        console.log('  ' + outFile);
    } else {
        console.log('\n🚀 APPLY — schreibe Rechnungen in /invoices ...');
        const tmpFile = path.join(os.tmpdir(), `vetter-invoices-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, JSON.stringify(allInvoices));
        execSync(
            `firebase database:update --instance ${INSTANCE} -f "/invoices" "${tmpFile}"`,
            { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'inherit', shell: true }
        );
        try { fs.unlinkSync(tmpFile); } catch {}

        // v6.62.866 (Patrick 22.05. 16:10): invoiceCounter hochziehen damit Frontend
        // nicht die gleichen Nummern erneut vergibt → Hartmudt-Jahn-Kollision verhindert.
        // Counter-Schema: /invoiceCounter/{YEAR_PREFIX} = höchste vergebene Nummer.
        const maxNum = Math.max(...Object.keys(allInvoices)
            .map(n => parseInt((n.match(/(\d+)$/) || ['',0])[1]))
            .filter(n => !isNaN(n) && n > 0));
        if (maxNum > 0) {
            const counterFile = path.join(os.tmpdir(), `vetter-counter-${Date.now()}.json`);
            fs.writeFileSync(counterFile, JSON.stringify({ '2026': maxNum }));
            console.log(`🔧 Setze /invoiceCounter/2026 auf ${maxNum} (verhindert Kollisionen mit Frontend-Vergabe)`);
            execSync(
                `firebase database:update --instance ${INSTANCE} -f "/invoiceCounter" "${counterFile}"`,
                { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'inherit', shell: true }
            );
            try { fs.unlinkSync(counterFile); } catch {}
        }
        console.log('✅ Alle Rechnungen angelegt als status=entwurf');
    }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
