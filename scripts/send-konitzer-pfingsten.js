const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

(async () => {
    const info = await transporter.sendMail({
        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'Konitzer@vko-partner.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'AW: AW: Frage — Umsätze 2025 schon gebucht?',
        inReplyTo: '<19e4e558d12561b0>',
        text: `Hallo Frau Konitzer,

vielen Dank für die schnelle Rückmeldung — gut zu wissen!

Auch Ihnen schöne Pfingsten!

Mit freundlichen Grüßen
Patrick Wydra
Funk-Taxi Heringsdorf
0151 27585179`,
    });
    console.log('OK', info.messageId);
})().catch(e => { console.error(e); process.exit(1); });
