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
        subject: 'AW: Reservierung Transfer vom Flughafen Berlin(BER) nach Heringsdorf, Hotel Kaiserhof',
        text: `Sehr geehrte Frau Hofses, sehr geehrter Herr Martin,

vielen Dank für Ihre Reservierung — wir bestätigen Ihnen hiermit beide Transfers gerne:

HINFAHRT:
  Samstag, 08.08.2026
  Pickup: Flughafen Berlin-Brandenburg (BER), Terminal 1
  Ankunft Ihres Fluges LH 184: 12:55 Uhr
  Ziel: Hotel Kaiserhof, Ostseebad Heringsdorf

RÜCKFAHRT:
  Samstag, 15.08.2026
  Pickup: Hotel Kaiserhof, Heringsdorf (Abholzeit ca. 13:30 Uhr)
  Ziel: Flughafen Berlin-Brandenburg (BER)
  Flug Abflug: 17:45 Uhr

Unser Fahrer wird sich rechtzeitig vor der Hinfahrt bei Ihnen melden.

Bei Rückfragen erreichen Sie uns jederzeit:
  Tel: 038378 / 22022
  Mobil: 0151 / 27585179

Wir wünschen Ihnen schon jetzt eine angenehme Anreise!

Mit freundlichen Grüßen
Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf`,
    });
    console.log('✅ MAIL GESENDET. messageId:', info.messageId);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
