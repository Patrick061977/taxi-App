const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-05_Sektion_P_Linienprofil_290_291.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei die SEKTION P "Linien-Profil 290/291: OEPNV-Daseinsvorsorge oder touristisch motivierter Verkehr?"

KILLER-BEFUND der Sektion:

Der Nahverkehrsplan Landkreis Vorpommern-Greifswald 2017-2027 (Aufgabentraeger LK VG) ordnet die Linien 290/291 in Tabelle 32 auf Seite 125 ausdruecklich der Netzkategorie "Tourismusnetz" zu - mit eigenem Wortlaut:

>> "Die Netzkategorie 'Tourismusnetz' zielt auf verdichtete oder zu verdichtende Verbindungen mit einer besonders stark ausgepraegten touristischen Bedeutung..."

Und auf S. 74: "Die Regionalbusverkehre werden dabei in moderner Form touristisch vermarktet, so dass die Erschliessung bisher nicht stark beruecksichtigter Kundengruppen bei gleichzeitiger Intensivierung der Zusammenarbeit mit Akteuren der Tourismuswirtschaft in den Fokus gerueckt ist."

→ Die zustaendige Behoerde selbst raeumt ein: TOURISMUSNETZ, nicht regulaeres OEPNV-Hauptnetz.

Weitere Befunde Sektion P:

- Fahrplan: Erste Fahrt 08:00 Uhr (kein 06:00-Pendlerlauf), letzte Fahrt 19:20 Uhr ausserhalb Sommerferien, 22:00 Uhr in Sommerferien
- Spitzentakt 10:00-17:00 Uhr (= Strandzeit, NICHT Pendlerzeit)
- Sa/So-Vollangebot identisch Mo-Fr (untypisch fuer Berufsverkehr-OEPNV)
- 23 Haltestellen: davon 5 mit touristischen Namen (Strandpromenaden, Seebruecke, Ostseetherme, Naturerlebniswelt)
- Linienverlauf folgt Strandpromenaden-Achse, NICHT Pendler-/Schulachse
- Keine Schulanbindung (Inselschule wird durch andere Linien bedient)

Plus: UsedomCard offiziell als "Kurticket fuer Gaeste der Kaiserbaeder" definiert.

INDIZIENTABELLE (Sektion P.5): 17 von 20 untersuchten Indikatoren sprechen fuer touristisch motivierten Verkehr, nur 3 fuer OEPNV-Daseinsvorsorge.

3 SUBSUMTIONSFRAGEN fuer LSBV M-V formuliert (P-Frage 1-3).
6 IFG-Punkte (P-IFG 1-6) markiert.

Diese Sektion bildet zusammen mit BASIS + ERWEITERUNG das vollstaendige Recherche-Paket fuer RA Weigel.

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'Weigel-Mappe Sektion P — Linien-Profil 290/291 Tourismusnetz-Beleg (Stand 05.06.2026)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
