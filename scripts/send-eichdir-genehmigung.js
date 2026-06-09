const fs = require('fs');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrte Damen und Herren,

als Nachtrag zu meiner vorherigen Mail anbei die Genehmigungsurkunde unseres Unternehmens.

Mit freundlichen Grüßen
Patrick Wydra

Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Telefon: 038378 22022
Mobil:   0151 27585179
E-Mail:  taxiwydra@googlemail.com
`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'marco.radziwill@ed-nord.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Genehmigungsurkunde — Funk Taxi Heringsdorf',
        text: body,
        attachments: [
            {
                filename: 'Genehmigungsurkunde-Funk-Taxi-Heringsdorf.pdf',
                path: 'C:/Users/Taxi/OneDrive/1.Taxi/Genehmigungsurkunde/29022024_Genehmigungsurkunde_002.pdf',
            },
        ],
    });
    console.log('✅ Genehmigungsurkunde an Eichdirektion gesendet');
    console.log('   Message-ID:', info.messageId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
