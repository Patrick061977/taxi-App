#!/usr/bin/env node
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }
});

const body = `Sehr geehrte Frau Rockstroh,

vielen Dank für die Gästelisten und die Busfahrer-Kontakte.

Wir bestätigen die geänderten Zeiten und die finale Auftragsübersicht:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Samstag, 04.07.2026
14:15 Uhr — 5 Personen
Bahnhof Heringsdorf → Seehotel Esplanade & Aurora
Gäste: Herr Mönnicke, Frau Mönnicke, Frau Nitsche, Herr Eidner, Frau Eidner
Busfahrer: Herr Fischer — 015774871712
Reiseleiter: Frau Rockstroh — 015121233517
Preis: 15,00 €

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Samstag, 11.07.2026
14:00 Uhr — 3 Personen (Abreise)
Seehotel Esplanade & Aurora → Bahnhof Heringsdorf
Gäste: Herr Mönnicke, Frau Mönnicke, Frau Nitsche

14:15 Uhr — 4 Personen (Anreise)
Bahnhof Heringsdorf → Seehotel Esplanade & Aurora
Gäste: Frau Lauber, Frau Goldhahn, Herr Wappler, Frau Möckel

Busfahrer: Herr Kocot — 017684290887
Reiseleiter: Herr Schönherr — 015753592966
Preis gesamt: 20,00 €

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Samstag, 18.07.2026
10:15 Uhr — 6 Personen (Abreise)
Seehotel Esplanade & Aurora → Bahnhof Heringsdorf
Gäste: Herr Eidner, Frau Eidner, Frau Lauber, Frau Goldhahn, Herr Wappler, Frau Möckel
Busfahrer: Herr Häckel — 01734796226
Reiseleiter: Herr Schönherr — 015753592966
Preis: 15,00 €

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Wir freuen uns auf die Zusammenarbeit und bitten den jeweiligen Busfahrer, uns ca. 1 Stunde vor Ankunft anzurufen sowie bei Verspätungen umgehend Bescheid zu geben.

Mit freundlichen Grüßen

Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Telefon: 038378 22022
Mobil: 0151 27585179
E-Mail: taxiwydra@googlemail.com`;

transporter.sendMail({
    from: '"Patrick Wydra - Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
    to: 'rockstroh@alextouristik.de',
    cc: 'taxiwydra@googlemail.com',
    subject: 'AW: AW: Transfere Seehotel Esplanade — Bestätigung Zeitänderung',
    text: body
}, (err, info) => {
    if (err) { console.error('Fehler:', err.message); process.exit(1); }
    console.log('✅ Bestätigung gesendet:', info.messageId);
});
