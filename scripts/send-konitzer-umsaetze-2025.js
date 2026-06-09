const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Hallo Frau Konitzer,

kurze Frage: sind die Kassenumsätze 2025 bei euch schon irgendwo gebucht — oder noch gar nichts?

Möchte nichts doppelt machen wenn ich die Hale-Berichte einlese.

Danke + Grüße
Patrick Wydra
Funk-Taxi Heringsdorf
0151 27585179`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'Konitzer@vko-partner.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Frage — Umsätze 2025 schon gebucht?',
        text: body,
    });
    console.log('MessageId:', info.messageId);
    console.log('Accepted:', info.accepted);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
