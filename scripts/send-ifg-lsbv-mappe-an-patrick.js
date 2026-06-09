const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-05_IFG_LSBV_MV_Konzession_290_291.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei der fertige IFG-Brief an LSBV M-V (1 Seite, 8 Pruefungspunkte).

KILLER-FRAGE ist Punkt 2: Auf welcher Rechtsgrundlage (§ 42 / § 43 / § 44 / § 48 / § 50 PBefG) wurde die Konzession an VVG mbH erteilt?

Egal welche Antwort kommt, wir haben einen Klagepunkt:
- § 42 (Linienverkehr): Widerspruch zum NVP-Tourismusnetz-Status (siehe Sektion P) und zur Nagy-Selbstauskunft "ausschliesslich dem Tourismus"
- § 48 (Ausflugsfahrten): Anhoerung Taxi-Gewerbe nach § 14 PBefG zwingend - Du wurdest nicht angehoert -> Verfahrensfehler
- Andere: vermutlich gar nicht zulaessig fuer einen Linienverkehr

Plus 7 weitere Pruefungspunkte (Veroeffentlichungspflichten Art. 7 VO 1370/2007, Beihilfe-Notifizierung Art. 107 AEUV, Pruefvermerk § 13 II Nr 3 PBefG, Auflagenkatalog § 13 IV PBefG, etc.).

Weigel kann den Brief direkt mit seinem Briefkopf verschicken.

Adresse LSBV M-V: Aussenstelle Stralsund - Personen- und Gueterbefoerderung (genaue Anschrift muss Weigel einsetzen, ich habe Platzhalter gelassen).

Frist: 1 Monat nach Antrag gem. § 9 IFG M-V.

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'IFG-Brief-Entwurf an LSBV M-V (Stand 05.06.2026)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
