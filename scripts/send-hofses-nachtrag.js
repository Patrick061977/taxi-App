const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

(async () => {
    const info = await transporter.sendMail({
        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'ghofses@web.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Nachtrag zur Reservierung — Korrektur der Abholzeiten + Preis',
        text: `Sehr geehrte Frau Hofses, sehr geehrter Herr Martin,

ergänzend zu unserer Bestätigung vom 22.05. möchten wir Ihnen die endgültigen Details mitteilen:

HINFAHRT — Samstag, 08.08.2026
  Pickup: Flughafen Berlin-Brandenburg (BER), Terminal 1
  Abholzeit: 13:30 Uhr
  (Ihr Flug LH 184 landet 12:55 — wir planen 30 Minuten Puffer
   für Aussteigen + Gepäck-Ausgabe ein)
  Ziel: Hotel Kaiserhof, Heringsdorf

RÜCKFAHRT — Samstag, 15.08.2026
  Pickup: Hotel Kaiserhof, Heringsdorf
  Abholzeit: 11:00 Uhr (auf Ihren Wunsch)
  Ziel: Flughafen Berlin-Brandenburg (BER), Terminal 1

FAHRTPREIS
  Pro Strecke: 500,00 EUR
  Gesamt für beide Transfers: 1.000,00 EUR
  (Bezahlung beim Fahrer, bar oder per Karte)

Bei Rückfragen erreichen Sie uns unter:
  Tel:   038378 / 22022
  Mobil: 0151 / 27585179

Wir freuen uns auf Ihre Anreise!

Mit freundlichen Grüßen
Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf`,
    });
    console.log('✅ MAIL GESENDET. messageId:', info.messageId);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
