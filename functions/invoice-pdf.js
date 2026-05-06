// v6.62.391: Server-side PDF-Rechnung mit pdfkit.
// Patrick (06.05. 20:39): "Cloud Function macht's serverseitig, kein offener
// Browser-Tab noetig". Native-App setzt rides/{id}/needsInvoice=true beim
// Bezahl-Abschluss → onRideUpdated triggert diese Funktion → PDF nach
// Storage → invoice in /invoices → invoice.pdfUrl. Vielen-Dank-SMS holt
// sich den Link aus invoices/<n>/pdfUrl.

const PDFDocument = require('pdfkit');

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

// PDF-Buffer generieren (pdfkit, A4)
function buildInvoicePdfBuffer(invoiceNumber, ride, customer) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const buffers = [];
            doc.on('data', b => buffers.push(b));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            const totalGross = parseFloat(ride.actualPrice || ride.price || 0);
            const totalNet = +(totalGross / 1.07).toFixed(2);
            const totalVat = +(totalGross - totalNet).toFixed(2);
            const ts = ride.completedAt || ride.acceptedAt || Date.now();
            const fahrtDatum = new Date(ts).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
            const fahrtZeit = new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
            const rechnungsDatum = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });

            // Header rechts: RECHNUNG + Nummer + Datum
            doc.fontSize(22).font('Helvetica-Bold').text('RECHNUNG', 50, 50, { align: 'right' });
            doc.fontSize(10).font('Helvetica');
            doc.text(`Rechnungsnummer: ${invoiceNumber}`, { align: 'right' });
            doc.text(`Rechnungsdatum: ${rechnungsDatum}`, { align: 'right' });
            doc.moveDown(2);

            // Absender (oben links — Briefkopf)
            doc.fontSize(11).font('Helvetica-Bold').text('Funk Taxi Patrick Wydra', 50, 50);
            doc.fontSize(9).font('Helvetica');
            doc.text('Strandstrasse 25');
            doc.text('17424 Heringsdorf');
            doc.text('Tel: 038378 22022');
            doc.text('taxiwydra@googlemail.com');

            // Empfaenger
            doc.moveDown(4);
            doc.fontSize(10).font('Helvetica-Bold').text('Rechnungsempfaenger:');
            doc.font('Helvetica');
            doc.text(customer.name || ride.customerName || 'Kunde');
            if (customer.address) doc.text(customer.address);
            doc.moveDown();

            // Leistungs-Sektion
            doc.fontSize(11).font('Helvetica-Bold').text('Leistung:');
            doc.fontSize(10).font('Helvetica');
            doc.text(`Datum der Fahrt: ${fahrtDatum}, ${fahrtZeit} Uhr`);
            if (ride.pickup) doc.text(`Abholort: ${ride.pickup}`);
            if (ride.destination) doc.text(`Zielort: ${ride.destination}`);
            if (ride.distance) doc.text(`Strecke: ${ride.distance} km`);
            doc.moveDown(2);

            // Preis-Block (rechts, gross)
            doc.fontSize(13).font('Helvetica-Bold');
            doc.text('Gesamtbetrag:', 350, doc.y, { continued: true });
            doc.text(` ${totalGross.toFixed(2).replace('.', ',')} EUR`, { align: 'right' });
            doc.moveDown(0.5);

            // MwSt-Aufschluesselung (Pflichtangabe USt 7% Personenbefoerderung)
            doc.fontSize(8).font('Helvetica');
            const vatHint = `* Im Gesamtbetrag von ${totalGross.toFixed(2).replace('.', ',')} EUR (Netto: ${totalNet.toFixed(2).replace('.', ',')} EUR) sind 7 % USt enthalten (${totalVat.toFixed(2).replace('.', ',')} EUR).`;
            doc.text(vatHint, 50, doc.y, { width: 495 });
            doc.moveDown(2);

            // Zahlungs-Vermerk
            doc.fontSize(10).font('Helvetica-Bold');
            const pm = (ride.paymentMethod || '').toLowerCase();
            if (pm === 'cash' || pm === 'bar') {
                doc.text('Betrag in Bar erhalten — Vielen Dank!');
            } else if (pm === 'stripe' || pm === 'card' || pm === 'kreditkarte') {
                doc.text('Bezahlt per Stripe (online).');
            } else if (pm === 'izettle') {
                doc.text('Bezahlt per Karte (Zettle).');
            } else if (pm === 'invoice_email' || pm === 'invoice_auftraggeber') {
                doc.text('Zahlbar innerhalb von 14 Tagen ohne Abzug.');
            } else {
                doc.text('Vielen Dank fuer Ihre Fahrt.');
            }

            doc.moveDown();
            doc.font('Helvetica');
            doc.text('Mit freundlichen Gruessen');
            doc.text('Patrick Wydra');

            // Footer (3 Zeilen unten am Seitenende)
            doc.fontSize(7).font('Helvetica').fillColor('#666');
            const footerY = 780;
            doc.text('Funk Taxi Patrick Wydra | Strandstrasse 25 | 17424 Heringsdorf', 50, footerY, { align: 'center', width: 495 });
            doc.text('Tel: 038378 22022 | taxiwydra@googlemail.com | funk-taxi-heringsdorf.de', 50, footerY + 10, { align: 'center', width: 495 });
            doc.text('Kleinunternehmer gem. § 19 UStG — soweit zutreffend. Personenbefoerderung mit USt 7%.', 50, footerY + 20, { align: 'center', width: 495 });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// Orchestrierung: Belegnummer holen, PDF bauen, Storage upload, /invoices anlegen, /rides aktualisieren
async function processAutoInvoice(rideId, ride, db, admin) {
    if (!rideId || !ride) throw new Error('rideId/ride leer');
    if (ride.invoiceNumber) {
        console.log(`🧾 Auto-Invoice skip — invoiceNumber existiert: ${ride.invoiceNumber}`);
        return { skipped: true, reason: 'already_invoiced' };
    }

    // Customer-Daten laden
    let customer = {};
    if (ride.customerId) {
        try {
            const cs = await db.ref(`customers/${ride.customerId}`).once('value');
            customer = cs.val() || {};
        } catch (_e) {}
    }

    const invoiceNumber = await getNextServerInvoiceNumber(db);
    console.log(`🧾 Auto-Invoice: erstelle ${invoiceNumber} für ride ${rideId}`);

    const pdfBuffer = await buildInvoicePdfBuffer(invoiceNumber, ride, customer);
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
        autoGeneratedVia: 'cloud_function_pdfkit_v6.62.391'
    };

    await db.ref(`invoices/${invoiceNumber}`).set(invoiceData);
    await db.ref(`rides/${rideId}`).update({
        invoiceNumber,
        invoicePdfUrl: pdfUrl,
        invoiceCreatedAt: Date.now(),
        needsInvoice: false  // Hook abschalten — verhindert erneuten Trigger
    });

    console.log(`✅ Auto-Invoice fertig: ${invoiceNumber} → ${pdfUrl}`);
    return { invoiceNumber, pdfUrl };
}

module.exports = { processAutoInvoice, getNextServerInvoiceNumber, buildInvoicePdfBuffer };
