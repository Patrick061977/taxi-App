const fs = require('fs');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = fs.readFileSync('C:/Taxi App/taxi-App-github/.kruse-mail-draft.txt', 'utf8');

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'info@autokruse.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Auto-Abholung heute Nachmittag — bitte um Rückmeldung',
        text: body,
    });
    console.log('✅ Autohaus Kruse (info@autokruse.de) — Abholungs-Mail gesendet');
    console.log('   Message-ID:', info.messageId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
