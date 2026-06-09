const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrte Frau Vetter,

vielen Dank für Ihre Anfrage. Wir bestätigen Ihnen hiermit den Auftrag für den 13.06.2026 wie in Ihrem beigefügten PDF beschrieben.

Sollten zu Ablauf, Fahrzeugen oder Eckdaten noch Rückfragen unsererseits aufkommen, melden wir uns gesondert per Mail oder telefonisch.

Mit freundlichen Grüßen

Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Telefon: 038378 22022
Mobil:   0151 27585179
E-Mail:  taxiwydra@googlemail.com`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra - Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'info@vetter-touristik.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'AW: Transfere 13.06.2026 — Auftragsbestätigung',
        text: body,
    });
    console.log('Vetter-Bestätigung versendet');
    console.log('Message-ID:', info.messageId);
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
