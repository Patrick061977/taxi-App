const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrte Damen und Herren,

ich habe heute eine Beitragsrechnung vom 20.05.2026 über 54,00 € für die Mitgliedschaft 341509033, ausgestellt an Frau Anja Kargoll, Amselring 10, 17424 Heringsdorf, erhalten.

Wir hatten ursprünglich angenommen, alle privaten ADAC-Mitgliedschaften gekündigt zu haben:
• Patrick Wydra (Mitglieds-Nr. 295261870) wurde am 06.07.2025 gekündigt (Bestätigung vom 11.07.2025, Vorgang 32239144)
• Wir verfügen weiterhin über die gewerbliche Mitgliedschaft Funk Taxi Heringsdorf (Mitglieds-Nr. 489774380) – diese soll bestehen bleiben.

Frage zur Mitgliedschaft 341509033 (Anja Kargoll):
Wir haben keine Erinnerung daran, für Frau Kargoll eine separate Mitgliedschaft abgeschlossen oder bestätigt zu haben.

• Auf welcher Grundlage wurde die Mitgliedschaft 341509033 angelegt?
• Wann und über welchen Kanal (online / Brief / telefonisch) ist sie zustande gekommen?
• Gab es jemals Beitragszahlungen darauf? Falls ja: aus welchem Konto?

Bitte senden Sie uns die Anmeldungsunterlagen bzw. Zustimmungsdokumente zu.

Bis zur Klärung bitten wir, die oben genannte Forderung über 54,00 € NICHT einzuziehen bzw. die Fälligkeit (01.07.2026) auszusetzen.

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
        to: 'mitgliederservice@adac.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Anfrage zu Mitgliedschaft 341509033 (Anja Kargoll) — Klärung des Vertragsursprungs',
        text: body,
    });
    console.log('MessageId:', info.messageId);
    console.log('Accepted:', info.accepted);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
