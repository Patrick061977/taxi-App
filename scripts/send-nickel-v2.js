#!/usr/bin/env node
// send-nickel-v2.js — Antwort an Werbeagentur Nickel (Frau Dolata) wegen Layout-Vorschau.
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Hallo Frau Dolata,

vielen Dank für das Angebot — von der Entscheidung her bin ich grundsätzlich dabei. Bevor wir konkret in Auftrag gehen, würde ich aber vorab gerne sehen, wie die Beklebung am Fahrzeug aussehen wird (Korrekturabzug / Mock-up).

Falls Sie die Satzarbeiten dafür gerne als Vorkasse stellen möchten, ist das für mich vollkommen in Ordnung — bitte gerne eine Vorkasserechnung über die 165 € netto Satzarbeiten zuschicken, dann überweise ich umgehend und Sie können den Entwurf erstellen.

Mit freundlichen Grüßen
Patrick Wydra
Funk-Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Tel.: 038378/22022 · Mobil: 0151 27585179`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'dolata@werbeagentur-nickel.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'AW: Taxi Wydra / Preise Fahrzeugbeklebungen',
        text: body,
        inReplyTo: '<dummy>',
    });
    console.log('Message-ID:', info.messageId);
    console.log('Accepted:', info.accepted);
    console.log('Response:', info.response);
})().catch(e => { console.error('FEHLER:', e); process.exit(1); });
