#!/usr/bin/env node
// send-hornburg-rueckfrage.js — Patrick 08.07.2026 "ja schick raus"
// Antwort an RA Hornburg: 2 Kernfragen + Terminwunsch

const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const GMAIL_PASS = 'yjevusbtaxemdzvf';

const BODY = `Sehr geehrter Herr Rechtsanwalt Hornburg,

vielen Dank für Ihre Rückmeldung. Wir würden die IFG-Anfragen gerne in die Wege leiten und bitten Sie vorab um Ihre Einschätzung zu zwei Kernfragen:

1. Was ist das für ein Bus?
Die Linie 290/291 wird als Tourismusnetz geführt und aus der Kurabgabe finanziert. Wir möchten verstehen, auf welcher Rechtsgrundlage dieser Bus betrieben wird — und ob das so zulässig ist.

2. Hält sich der Bus an die Vorgaben des Nahverkehrsplans?
Der Nahverkehrsplan 2017–2027 schreibt für diese Linie Eigenwirtschaftlichkeit und den Schutz des Taxi-Gewerbes vor. Beides scheint in der Praxis nicht umgesetzt zu sein. Wenn das so ist: Wurde das behördlich genehmigt — und wenn ja, auf welcher Grundlage?

Wäre es möglich, diese Punkte in einem kurzen Telefonat oder Termin mit Ihnen zu besprechen?

Mit freundlichen Grüßen
Patrick Wydra
Funk Taxi Heringsdorf
Tel. 038378 / 22022
taxiwydra@googlemail.com`;

(async () => {
    const t = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: 'taxiwydra@googlemail.com', pass: GMAIL_PASS },
    });
    const info = await t.sendMail({
        from: 'Patrick Wydra <taxiwydra@googlemail.com>',
        to: 'kontakt@rechtsanwalt-hornburg.de',
        subject: 'AW: Anfrage zur Mandatsübernahme — Rückfrage + Terminwunsch',
        text: BODY,
    });
    console.log('✅ Gesendet:', info.messageId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
