#!/usr/bin/env node
// One-shot Send: Heinze, Dominic — Kostenvoranschlag Hafen Swinemuende → SIXT Usedom 17.06.
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrter Herr Heinze,

vielen Dank für Ihre Anfrage und Ihr Interesse an unserem Taxi-Service.

Gerne übernehmen wir Ihren Transfer am 17.06.2026:

Strecke:       Hafen Swinemünde → SIXT-Station Heringsdorf
Fahrgäste:     1 Person mit Standardgepäck
Fahrzeit:      ca. 25–30 Minuten

Festpreis:     45,00 EUR (Pauschalpreis inkl. allem)

Rechnungsstellung per E-Mail ist selbstverständlich möglich – bitte teilen Sie uns dafür die gewünschte Rechnungsadresse (Johanniter-Unfall-Hilfe / Privat) mit.

Zur verbindlichen Buchung benötigen wir noch:
1. Genaue Abholzeit am Hafen Swinemünde (z. B. 14:00 Uhr)
2. Rechnungsadresse
3. Falls Anschluss an eine Fähre/Hochsee: Schiffname + Ankunftszeit (wir warten kostenfrei bis 15 Min nach planmäßiger Ankunft)

Wir bestätigen die Buchung dann verbindlich per E-Mail.

Mit freundlichen Grüßen
Patrick Wydra

Funk Taxi Heringsdorf
Telefon: 038378 / 22022
E-Mail: taxiwydra@googlemail.com
`;

transporter.sendMail({
    from: '"Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
    to: 'dominic.heinze@johanniter.de',
    subject: 'Angebot Taxitransfer 17.06.2026 – Hafen Swinemünde → SIXT Heringsdorf',
    text: body,
}).then(info => {
    console.log('✅ Heinze-Angebot gesendet:', info.messageId);
}).catch(err => {
    console.error('❌ Send failed:', err.message);
    process.exit(1);
});
