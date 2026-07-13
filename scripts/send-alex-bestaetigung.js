const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrte Frau Rockstroh,

vielen Dank für Ihre Anfrage. Wir bestätigen hiermit die folgenden Transfers:

Samstag, 04.07.2026
14:15 Uhr — 5 Personen
Bahnhof Heringsdorf → Seehotel Esplanade & Aurora
Preis: 15,00 €

Samstag, 11.07.2026
14:15 Uhr — 3 Personen (Abreise)
Seehotel Esplanade & Aurora → Bahnhof Heringsdorf
Preis: 10,00 €

14:30 Uhr — 4 Personen (Anreise)
Bahnhof Heringsdorf → Seehotel Esplanade & Aurora
Preis: 10,00 €

Samstag, 18.07.2026
10:30 Uhr — 6 Personen
Seehotel Esplanade & Aurora → Bahnhof Heringsdorf
Preis: 15,00 €

Für eine reibungslose Abwicklung bitten wir Sie um folgende Informationen:
1. Namen der Gäste (für jede Fahrt)
2. Telefonnummer des Busfahrers

Wir bitten den Busfahrer, uns bitte ca. 1 Stunde vor Abfahrt anzurufen sowie im Falle einer Verspätung umgehend Bescheid zu geben.

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
        to: 'rockstroh@alextouristik.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'AW: Transfere Seehotel Esplanade — Auftragsbestätigung',
        text: body,
    });
    console.log('✅ Alex Touristik Bestätigung versendet');
    console.log('Message-ID:', info.messageId);
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
