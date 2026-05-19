// v6.62.811 (19.05.2026): Pixel-Match-PDF via puppeteer + @sparticuz/chromium.
// Vorgaenger v6.62.391/810: pdfkit-MVP — simples Layout, kein DIN-5008.
// Patrick: "Pixel-Identisch waere ich schon ganz gerne." → HTML-Template
// in invoice-html.js spiegelt jsPDF-Layout aus index.html (DIN-5008,
// Falzmarken, Adressfenster, Firmenblock, Positionen-Tabelle, Footer).
//
// Architektur:
//   1. /settings/invoice laden (Firmen-Block, Bankdaten, Steuer-Nr)
//   2. Customer-Daten via ride.customerId
//   3. buildInvoiceHtml(...) -> HTML-String
//   4. puppeteer.launch -> page.setContent -> page.pdf -> Buffer
//
// Resource-Notiz: chromium braucht >=1GiB Memory. onRideUpdated-Trigger
// muss entsprechend hochgezogen werden (v6.62.811: 2GiB).

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { buildInvoiceHtml } = require('./invoice-html');

// 🆕 Belegnummer-Format kompatibel zu web (getNextInvoiceNumber): 20-YY-NNN
async function getNextServerInvoiceNumber(db) {
    const currentYear = new Date().getFullYear();
    const counterRef = db.ref(`invoiceCounter/${currentYear}`);
    const tx = await counterRef.transaction(curr => (curr || 0) + 1);
    const counter = tx.snapshot.val() || 1;
    const shortYear = String(currentYear).slice(-2);
    const padded = String(counter).padStart(3, '0');
    return `20-${shortYear}-${padded}`;
}

// Browser-Instance pro Cloud-Function-Instanz cachen (warm-start spart 3-5s)
let _browserPromise = null;
async function getBrowser() {
    if (_browserPromise) {
        try {
            const b = await _browserPromise;
            if (b && b.connected !== false) return b;
        } catch (_e) { /* fall through, neu launchen */ }
    }
    _browserPromise = puppeteer.launch({
        args: [
            ...chromium.args,
            '--hide-scrollbars',
            '--disable-web-security',
            '--disable-dev-shm-usage',
            '--no-sandbox'
        ],
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        defaultViewport: chromium.defaultViewport
    });
    return _browserPromise;
}

// PDF-Buffer generieren via puppeteer.
// settings (optional) ueberschreibt das aus Firebase geladene /settings/invoice.
async function buildInvoicePdfBuffer(invoiceNumber, ride, customer, settings, invoice) {
    const html = buildInvoiceHtml({ invoiceNumber, ride, customer, settings, invoice });
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        // Druck-Format A4, ohne zusaetzliche Margins (das @page-CSS regelt das)
        const buffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            preferCSSPageSize: true
        });
        return buffer;
    } finally {
        try { await page.close(); } catch (_e) { /* ignore */ }
    }
}

// Settings aus Firebase laden (mit Defaults)
async function loadInvoiceSettings(db) {
    try {
        const snap = await db.ref('settings/invoice').once('value');
        const settings = snap.val();
        if (!settings || !settings.companyName) {
            return {
                companyName: 'Taxiunternehmen Patrick Wydra',
                street: 'Amselring 10',
                city: '17424 Ostseebad Heringsdorf',
                phone: '038378/22022',
                email: 'taxiwydra@googlemail.com',
                bankInfo: 'Kontoinhaber: Patrick Wydra\nVolksbank Vorpommern\nIBAN: DE16 1309 1054 0001 5524 90\nBIC: GENODEF1HST'
            };
        }
        // bankInfo sanity: muss "Kontoinhaber" enthalten
        if (!settings.bankInfo || !settings.bankInfo.includes('Kontoinhaber')) {
            settings.bankInfo = 'Kontoinhaber: Patrick Wydra\nVolksbank Vorpommern\nIBAN: DE16 1309 1054 0001 5524 90\nBIC: GENODEF1HST';
        }
        return settings;
    } catch (_e) {
        return {};
    }
}

// Orchestrierung: Belegnummer holen, Settings laden, PDF bauen, Storage upload, /invoices anlegen, /rides aktualisieren.
// Behaelt Signature von v6.62.391 fuer Rueckwaerts-Kompatibilitaet.
async function processAutoInvoice(rideId, ride, db, admin) {
    if (!rideId || !ride) throw new Error('rideId/ride leer');
    if (ride.invoiceNumber) {
        console.log(`🧾 Auto-Invoice skip — invoiceNumber existiert: ${ride.invoiceNumber}`);
        return { skipped: true, reason: 'already_invoiced' };
    }

    let customer = {};
    if (ride.customerId) {
        try {
            const cs = await db.ref(`customers/${ride.customerId}`).once('value');
            customer = cs.val() || {};
        } catch (_e) { /* ignore */ }
    }

    const invoiceNumber = await getNextServerInvoiceNumber(db);
    console.log(`🧾 Auto-Invoice: erstelle ${invoiceNumber} für ride ${rideId}`);

    const settings = await loadInvoiceSettings(db);
    const pdfBuffer = await buildInvoicePdfBuffer(invoiceNumber, ride, customer, settings);
    const fileName = `rechnung-${invoiceNumber}.pdf`;
    const bucket = admin.storage().bucket();
    const fileRef = bucket.file(`invoices/${fileName}`);
    await fileRef.save(pdfBuffer, { metadata: { contentType: 'application/pdf' }, resumable: false });
    await fileRef.makePublic();
    const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURI(`invoices/${fileName}`)}`;

    const totalGross = parseFloat(ride.actualPrice || ride.price || 0);
    const totalNet = +(totalGross / 1.07).toFixed(2);
    const totalVat = +(totalGross - totalNet).toFixed(2);
    const pm = (ride.paymentMethod || '').toLowerCase();
    const isPaid = (pm === 'cash' || pm === 'bar' || pm === 'stripe' || pm === 'card' || pm === 'izettle');

    const invoiceData = {
        invoiceNumber,
        rideId,
        customerId: ride.customerId || null,
        customerName: ride.customerName || customer.name || '',
        customerAddress: customer.address || '',
        guestName: ride.guestName || '',
        pickup: ride.pickup || '',
        destination: ride.destination || '',
        rideDate: new Date(ride.completedAt || Date.now()).toISOString().slice(0, 10),
        distance: ride.distance || null,
        totalGross,
        totalNet,
        totalVat,
        vatBreakdown: { '7': totalVat },
        netBreakdown: { '7': totalNet },
        paymentMethod: ride.paymentMethod || 'unknown',
        pdfUrl,
        pdfFileName: fileName,
        status: isPaid ? 'bezahlt' : 'offen',
        paidAt: isPaid ? Date.now() : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        autoGenerated: true,
        autoGeneratedVia: 'cloud_function_puppeteer_v6.62.811'
    };

    await db.ref(`invoices/${invoiceNumber}`).set(invoiceData);
    await db.ref(`rides/${rideId}`).update({
        invoiceNumber,
        invoicePdfUrl: pdfUrl,
        invoiceCreatedAt: Date.now(),
        needsInvoice: false
    });

    console.log(`✅ Auto-Invoice fertig: ${invoiceNumber} → ${pdfUrl}`);
    return { invoiceNumber, pdfUrl };
}

module.exports = { processAutoInvoice, getNextServerInvoiceNumber, buildInvoicePdfBuffer, loadInvoiceSettings };
