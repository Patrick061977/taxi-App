const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrter Herr Käming,

ich hätte eine kurze Frage zur DATEV-Konfiguration:

Wir nutzen PayPal regelmäßig für Geschäftstransaktionen (Kunden-Zahlungen für Rechnungen, gelegentliche Einkäufe). Aktuell sind die PayPal-Bewegungen in DATEV Unternehmen Online nicht als separates Bank-Konto hinterlegt — sie laufen nur über die Volksbank-Belastung sichtbar.

Ist es möglich, in DATEV Unternehmen Online das PayPal-Konto als zusätzliche Bank anzulegen, sodass auch die PayPal-Transaktionen mit Saldo und Bewegungen dort sichtbar sind und sich mit den Rechnungen abgleichen lassen?

Falls ja: Welche Schritte oder Daten brauchen Sie von mir? PayPal-Login, CSV-Export, API-Token?

Vielen Dank für eine kurze Einschätzung!

Mit freundlichen Grüßen
Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10, 17424 Heringsdorf
Tel.: 038378 22022
Mobil: 0151 27585179
E-Mail: taxiwydra@googlemail.com`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'Kaeming@vko-partner.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'PayPal-Konto in DATEV Unternehmen Online hinzufügen?',
        text: body,
    });
    console.log('MessageId:', info.messageId);
    console.log('Accepted:', info.accepted);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
