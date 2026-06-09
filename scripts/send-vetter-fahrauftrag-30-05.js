const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrte Frau Vetter,

mir liegt für den heutigen Tag, 30.05.2026, kein Fahrauftrag Ihrerseits vor. Für die Tagesabrechnung benötige ich die Auftragsbestätigung mit Pickup-Zeiten, Hotels und Gästen.

Ich bitte um umgehende Nachreichung der Auftragsdaten.

Mit freundlichen Grüßen

Patrick Wydra
Funk-Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Tel.: 038378 / 22022
Mobil: 0151 27585179
E-Mail: taxiwydra@googlemail.com`;

(async () => {
    try {
        const info = await transporter.sendMail({
            from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
            to: 'info@vetter-touristik.de',
            subject: 'Fahrauftrag 30.05.2026 — Bitte um Nachreichung',
            text: body,
        });
        console.log('✅ Mail gesendet, ID:', info.messageId);
    } catch (err) {
        console.error('❌ Mail-Fehler:', err.message);
        process.exit(1);
    }
})();
