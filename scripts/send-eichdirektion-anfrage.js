const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrte Damen und Herren,

ich plane die Eichung von 5 Taxametern und möchte fragen, wann in Neubrandenburg die nächsten freien Eichtermine verfügbar sind.

Unternehmen: Funk Taxi Heringsdorf
Anzahl Fahrzeuge: 5

Bitte teilen Sie mir die nächstmöglichen Termine sowie das Anmeldeverfahren mit. Falls es Sammeltermine für mehrere Fahrzeuge gibt, wäre das für uns ideal.

Mit freundlichen Grüßen

Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Tel.: 038378 22022
Mobil: 0151 27585179
E-Mail: taxiwydra@googlemail.com`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'rostock@ed-nord.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Anfrage freie Eichtermine Neubrandenburg — Funk Taxi Heringsdorf',
        text: body,
    });
    console.log('✅ Eichdirektion Nord (rostock@ed-nord.de) — Eichtermine-Anfrage gesendet');
    console.log('   Message-ID:', info.messageId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
