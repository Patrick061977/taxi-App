// v6.62.811: DIN-5008 HTML-Invoice-Template für puppeteer-PDF.
// Patrick (19.05. 06:28): "mach mal, weil ich finde es ein bisschen kompliziert
// da noch im Webbrowser rumzufummeln." — Pixel-Match-Anspruch von jsPDF-Layout.
//
// Mirror der index.html-Funktionen addDIN5008Layout/addDIN5008Footer/Positionen.
// A4 = 210x297mm. Alle Koordinaten als mm, weil das Web-Layout 1:1 in PDF wandert.

function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
    const v = parseFloat(n) || 0;
    return v.toFixed(2).replace('.', ',');
}

function fmtDateDE(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getFullYear()}`;
}

function fmtTimeDE(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

function paymentLabel(method) {
    const m = (method || '').toLowerCase();
    const map = {
        bar: 'Betrag in Bar erhalten — Vielen Dank!',
        cash: 'Betrag in Bar erhalten — Vielen Dank!',
        ec: 'Zahlung per EC-Karte',
        credit: 'Zahlung per Kreditkarte',
        karte: 'Zahlung per Karte',
        card: 'Zahlung per Karte',
        izettle: 'Bezahlt per Karte (Zettle).',
        paypal: 'Zahlung per PayPal',
        stripe: 'Bezahlt per Stripe (online).',
        vorkasse: 'Zahlbar sofort und ohne Abzug per Vorkasse',
        rechnung: 'Zahlbar innerhalb von 14 Tagen ohne Abzug',
        invoice_email: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
        invoice_auftraggeber: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
        transportschein: 'Transportschein',
        uberweisung: 'Zahlbar per Überweisung innerhalb von 14 Tagen'
    };
    return map[m] || 'Vielen Dank für Ihre Fahrt.';
}

function isPaidStatus(ride, invoice) {
    if (!ride && !invoice) return false;
    const a = ride || {};
    const b = invoice || {};
    return a.paymentStatus === 'bezahlt'
        || a.stripePaymentStatus === 'paid'
        || b.status === 'bezahlt'
        || b.stripePaymentStatus === 'paid';
}

// Hauptfunktion: baut komplettes HTML-Dokument für puppeteer.pdf()
function buildInvoiceHtml({ invoiceNumber, ride, customer, settings, invoice }) {
    const s = settings || {};
    const r = ride || {};
    const c = customer || {};
    const inv = invoice || {};

    const companyName = s.companyName || 'Taxiunternehmen Patrick Wydra';
    const street = s.street || 'Amselring 10';
    const city = s.city || '17424 Ostseebad Heringsdorf';
    const phone = s.phone || 'Festnetz: 038378/22022';
    const email = s.email || 'taxiwydra@googlemail.com';
    const taxNumber = s.taxNumber || '';
    const vatId = s.vatId || '';
    const bankInfo = s.bankInfo || 'Kontoinhaber: Patrick Wydra\nVolksbank Vorpommern\nIBAN: DE16 1309 1054 0001 5524 90\nBIC: GENODEF1HST';

    const senderLine = `${companyName}, ${street}, ${city}`;

    // Empfänger-Block
    const recipientName = c.name || r.customerName || 'Kunde';
    const recipientAddr = c.billingAddress || c.address || r.customerAddress || '';
    const recipientLines = recipientAddr
        ? recipientAddr.split(/[,\n]/).map(l => l.trim()).filter(Boolean)
        : [];
    const nameInAddr = recipientLines.length > 0
        && recipientName.length >= 4
        && recipientLines[0].toLowerCase().includes(recipientName.toLowerCase().substring(0, 4));

    // Meta-Daten rechts oben
    const invoiceDate = inv.createdAt || inv.issuedAt || Date.now();
    const kundennummer = c.kundennummer || c.lieferantennummer || '';

    // Fahrtdetails
    const fahrtTs = r.completedAt || r.acceptedAt || r.pickupTimestamp || Date.now();
    const fahrtDatum = fmtDateDE(fahrtTs);
    const fahrtZeit = fmtTimeDE(fahrtTs);
    const guestName = (r.guestName || '').trim();
    const pickup = r.pickup || '';
    const destination = r.destination || '';
    const distance = r.distance ? parseFloat(r.distance) : 0;

    // Positionen
    const positions = Array.isArray(inv.positions) && inv.positions.length > 0
        ? inv.positions
        : [{
            description: `Taxifahrt: ${pickup || ''}${pickup && destination ? ' → ' : ''}${destination || ''}`.trim() || 'Taxifahrt',
            quantity: 1,
            unit: 'Fahrt',
            amount: parseFloat(r.actualPrice || r.price || inv.totalGross || 0) || 0,
            vatRate: 7
        }];

    let posRows = '';
    let totalGross = 0;
    const vatBreakdown = {};
    const netBreakdown = {};
    positions.forEach((pos, idx) => {
        const quantity = parseFloat(pos.quantity) || 1;
        const unit = pos.unit || 'Stück';
        const discount = parseFloat(pos.discount) || 0;
        const singlePrice = parseFloat(pos.amount) || 0;
        const lineTotal = singlePrice * quantity * (1 - discount / 100);
        const posVat = parseFloat(pos.vatRate) || 0;
        const netLine = lineTotal / (1 + posVat / 100);
        const vatLine = lineTotal - netLine;
        totalGross += lineTotal;
        if (!vatBreakdown[posVat]) { vatBreakdown[posVat] = 0; netBreakdown[posVat] = 0; }
        vatBreakdown[posVat] += vatLine;
        netBreakdown[posVat] += netLine;

        const zebra = idx % 2 === 0 ? ' class="zebra"' : '';
        const noteRow = pos.note
            ? `<tr${zebra}><td colspan="6" class="pos-note">${esc(pos.note)}</td></tr>`
            : '';
        const discountRow = discount > 0
            ? `<tr${zebra}><td colspan="6" class="pos-discount">Rabatt: ${discount.toFixed(2).replace('.', ',')} %</td></tr>`
            : '';

        posRows += `
            <tr${zebra}>
                <td class="pos-nr">${idx + 1}</td>
                <td class="pos-desc">${esc(pos.description || 'Position')}</td>
                <td class="pos-qty">${quantity % 1 === 0 ? quantity : quantity.toFixed(2).replace('.', ',')} ${esc(unit)}</td>
                <td class="pos-price">${fmtMoney(singlePrice)}</td>
                <td class="pos-vat">${posVat.toFixed(0)},00</td>
                <td class="pos-total">${fmtMoney(lineTotal)}</td>
            </tr>${noteRow}${discountRow}`;
    });

    const totalNet = Object.values(netBreakdown).reduce((s, n) => s + n, 0);
    const totalVat = Object.values(vatBreakdown).reduce((s, n) => s + n, 0);

    // USt-Hinweis
    const vatRatesUsed = Object.keys(vatBreakdown).filter(k => parseFloat(k) > 0);
    let vatHint = '';
    if (vatRatesUsed.length > 0) {
        if (vatRatesUsed.length === 1) {
            const r1 = vatRatesUsed[0];
            vatHint = `* Im Gesamtbetrag von ${fmtMoney(totalGross)} € (Netto: ${fmtMoney(totalNet)} €) sind USt ${parseFloat(r1).toFixed(0)} % (${fmtMoney(vatBreakdown[r1])} €) enthalten.`;
        } else {
            vatHint = `* Im Gesamtbetrag von ${fmtMoney(totalGross)} € sind enthalten: `
                + vatRatesUsed.map(rt => `USt ${parseFloat(rt).toFixed(0)} % (${fmtMoney(vatBreakdown[rt])} €)`).join(', ') + '.';
        }
    }

    const paymentTermsText = paymentLabel(r.paymentMethod);
    const closingNote = inv.closingNote || s.footer || 'Vielen Dank für die gute Zusammenarbeit.';

    // Empfänger-Block-HTML
    let recipientHtml = '';
    if (recipientName && !nameInAddr) {
        recipientHtml += `<div class="rcpt-name">${esc(recipientName)}</div>`;
    }
    if (guestName) {
        recipientHtml += `<div class="rcpt-line">z.Hd. ${esc(guestName)}</div>`;
    }
    if (recipientLines.length > 0) {
        recipientLines.forEach((line, idx) => {
            const cls = idx === 0 && nameInAddr ? 'rcpt-name' : 'rcpt-line';
            recipientHtml += `<div class="${cls}">${esc(line)}</div>`;
        });
    }

    // BEZAHLT-Stempel
    const paid = isPaidStatus(r, inv);
    const paidAt = paid ? (r.stripePaidAt || r.paidAt || inv.stripePaidAt || inv.paidAt || Date.now()) : null;
    const paidLabel = paid
        ? (r.paymentMethod === 'stripe' ? 'Online bezahlt'
            : r.paymentMethod === 'bar' ? 'Bar bezahlt'
            : (r.paymentMethod === 'karte' || r.paymentMethod === 'ec' || r.paymentMethod === 'credit') ? 'Karte bezahlt'
            : 'Bezahlt')
        : '';
    const stempelHtml = paid
        ? `<div class="bezahlt-stempel">BEZAHLT</div>
           <div class="bezahlt-note">✓ ${esc(paidLabel)} am ${fmtDateDE(paidAt)}</div>`
        : '';

    // Fahrtdetails-Box (nur wenn Route/Daten vorhanden)
    const showRouteBox = pickup || destination || guestName || fahrtDatum;
    const fahrtBox = showRouteBox ? `
        <div class="fahrt-box">
            <div class="fahrt-title">Fahrtdetails:</div>
            ${guestName ? `<div>Fahrgast: ${esc(guestName)}</div>` : ''}
            ${fahrtDatum ? `<div>Datum: ${esc(fahrtDatum)}${fahrtZeit ? '  |  Uhrzeit: ' + esc(fahrtZeit) + ' Uhr' : ''}</div>` : ''}
            ${pickup ? `<div>Von: ${esc(pickup)}</div>` : ''}
            ${destination ? `<div>Nach: ${esc(destination)}</div>` : ''}
            ${distance > 0 ? `<div>Strecke: ${distance.toFixed(2).replace('.', ',')} km</div>` : ''}
        </div>` : '';

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Helvetica', 'Arial', sans-serif; color: #000; font-size: 9pt; }
.page { width: 210mm; height: 297mm; position: relative; padding: 0; }

/* Falzmarken am linken Rand */
.falzmarke { position: absolute; left: 5mm; width: 5mm; height: 0.3mm; background: #b4b4b4; }
.falz-1 { top: 105mm; }
.falz-2 { top: 148.5mm; }
.falz-3 { top: 210mm; }

/* Firmenblock rechts oben */
.firmenblock { position: absolute; left: 120mm; top: 10mm; width: 80mm; font-size: 9pt; }
.firmenblock .name { font-weight: bold; }
.firmenblock div { margin-bottom: 0.5mm; }

/* Absender-Kurzzeile */
.absender { position: absolute; left: 20mm; top: 45mm; font-size: 7pt; color: #787878;
    border-bottom: 0.3mm solid #969696; padding-bottom: 0.3mm; white-space: nowrap; }

/* Empfänger-Adressfenster */
.empfaenger { position: absolute; left: 20mm; top: 49mm; width: 85mm; font-size: 10pt; }
.empfaenger .rcpt-name { font-weight: bold; margin-bottom: 1mm; }
.empfaenger .rcpt-line { margin-bottom: 0.5mm; }

/* Rechnung-Titel + Meta */
.rechnung-titel { position: absolute; right: 20mm; top: 47mm; font-size: 18pt; font-weight: bold; }
.meta-table { position: absolute; left: 140mm; top: 56mm; width: 50mm; font-size: 9pt; }
.meta-table .row { display: flex; justify-content: space-between; margin-bottom: 1mm; }
.meta-table .row .val { font-weight: normal; text-align: right; }

/* Inhaltsbereich */
.content { position: absolute; left: 20mm; top: 88mm; right: 20mm; }
.intro { font-size: 9pt; margin-bottom: 4mm; }

/* Fahrtdetails-Box */
.fahrt-box { background: #f5faff; border: 0.3mm solid #c8dcf0; padding: 2mm 3mm; margin-bottom: 4mm; font-size: 9pt; }
.fahrt-box .fahrt-title { font-weight: bold; color: #1e40af; margin-bottom: 1mm; }
.fahrt-box div { margin-bottom: 0.5mm; line-height: 1.3; }

/* Positionen-Tabelle */
table.pos { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 2mm; }
table.pos thead th { background: #f0f0f0; border-top: 0.3mm solid #969696; border-bottom: 0.3mm solid #969696;
    padding: 1.5mm 1mm; font-weight: bold; text-align: left; }
table.pos thead th.r { text-align: right; }
table.pos thead th.c { text-align: center; }
table.pos td { padding: 1.5mm 1mm; vertical-align: top; }
table.pos tr.zebra td { background: #f8f8f8; }
.pos-nr { width: 8mm; text-align: center; }
.pos-desc { }
.pos-qty { width: 25mm; text-align: right; }
.pos-price { width: 22mm; text-align: right; }
.pos-vat { width: 18mm; text-align: right; }
.pos-total { width: 25mm; text-align: right; }
.pos-note { font-size: 8pt; color: #646464; padding-left: 10mm !important; }
.pos-discount { font-size: 7pt; color: #969696; padding-left: 10mm !important; }

/* Gesamtbetrag-Bar */
.total-bar { background: #3c3c3c; color: #fff; padding: 2mm 3mm; margin-top: 0;
    display: flex; justify-content: space-between; font-weight: bold; font-size: 11pt; }

/* USt-Hinweis + Zahlung */
.vat-hint { font-size: 8pt; margin-top: 4mm; }
.payment-terms { font-weight: bold; font-size: 9pt; margin-top: 6mm; }
.closing { font-size: 9pt; margin-top: 2mm; }

/* DIN-5008 Footer */
.footer { position: absolute; left: 20mm; right: 20mm; top: 269mm; border-top: 0.3mm solid #b4b4b4;
    padding-top: 1mm; font-size: 7pt; color: #646464; display: flex; justify-content: space-between; }
.footer .col { width: 33%; line-height: 1.4; }
.footer .col.mid { width: 33%; }
.footer .col.right { width: 33%; text-align: left; }

/* BEZAHLT-Stempel diagonal */
.bezahlt-stempel { position: absolute; left: 50%; top: 140mm; transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 54pt; font-weight: bold; color: rgba(16,185,129,0.15);
    border: 2mm solid rgba(16,185,129,0.25); padding: 2mm 8mm; pointer-events: none;
    letter-spacing: 4mm; }
.bezahlt-note { position: absolute; right: 20mm; top: 263mm; color: #10b981; font-size: 8pt; font-weight: bold; text-align: right; }
</style>
</head>
<body>
<div class="page">
    <div class="falzmarke falz-1"></div>
    <div class="falzmarke falz-2"></div>
    <div class="falzmarke falz-3"></div>

    <div class="firmenblock">
        <div class="name">${esc(companyName)}</div>
        <div>${esc(street)}</div>
        <div>${esc(city)}</div>
        <div>Tel.: ${esc(phone)}</div>
        ${email ? `<div>${esc(email)}</div>` : ''}
    </div>

    <div class="absender">${esc(senderLine)}</div>

    <div class="empfaenger">${recipientHtml}</div>

    <div class="rechnung-titel">Rechnung</div>

    <div class="meta-table">
        <div class="row"><span>Rechnungsnr.:</span><span class="val">${esc(invoiceNumber)}</span></div>
        ${kundennummer ? `<div class="row"><span>Kundennr.:</span><span class="val">${esc(kundennummer)}</span></div>` : ''}
        <div class="row"><span>Datum:</span><span class="val">${esc(fmtDateDE(invoiceDate))}</span></div>
        ${fahrtDatum && fahrtDatum !== fmtDateDE(invoiceDate) ? `<div class="row"><span>Lieferdatum:</span><span class="val">${esc(fahrtDatum)}</span></div>` : ''}
    </div>

    <div class="content">
        <div class="intro">Unsere Lieferungen/Leistungen stellen wir Ihnen wie folgt in Rechnung.</div>

        ${fahrtBox}

        <table class="pos">
            <thead>
                <tr>
                    <th class="c" style="width:8mm">Pos.</th>
                    <th>Bezeichnung</th>
                    <th class="r" style="width:25mm">Menge</th>
                    <th class="r" style="width:22mm">Einzelpreis</th>
                    <th class="r" style="width:18mm">USt %</th>
                    <th class="r" style="width:25mm">Gesamt</th>
                </tr>
            </thead>
            <tbody>
                ${posRows}
            </tbody>
        </table>

        <div class="total-bar">
            <span>Gesamtbetrag*</span>
            <span>${fmtMoney(totalGross)} €</span>
        </div>

        ${vatHint ? `<div class="vat-hint">${esc(vatHint)}</div>` : ''}

        <div class="payment-terms">${esc(paymentTermsText)}</div>
        <div class="closing">${esc(closingNote)}</div>
    </div>

    ${stempelHtml}

    <div class="footer">
        <div class="col">
            <div>${esc(companyName)}</div>
            <div>${esc(street)}</div>
            <div>${esc(city)}</div>
            <div>Tel.: ${esc(phone)}</div>
        </div>
        <div class="col mid">
            ${bankInfo.split('\n').map(l => `<div>${esc(l)}</div>`).join('')}
        </div>
        <div class="col right">
            ${taxNumber ? `<div>Steuernummer: ${esc(taxNumber)}</div>` : ''}
            ${vatId ? `<div>${esc(vatId)}</div>` : ''}
            ${email ? `<div>${esc(email)}</div>` : ''}
            <div>SKR03: 8400 (Personenbef. 7%)</div>
        </div>
    </div>
</div>
</body>
</html>`;
}

module.exports = { buildInvoiceHtml };
