const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-06_Sektion_T_Innerer_Widerspruch_Tourismus_vs_Paragraf_42.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei Sektion T der Weigel-Mappe: 'Innerer Widerspruch Tourismus vs § 42 PBefG /
Doppel-Abzocke der Kurabgabe-Pflichtigen'.

DAS IST DAS JURISTISCHE HERZSTUECK Deiner Argumentation. Du hast den
inneren Widerspruch identifiziert:

Die Gemeinde Heringsdorf nimmt GLEICHZEITIG zwei sich ausschliessende
Rechtsregime in Anspruch:

A) TOURISMUS (Selbstaussage Nagy 'ausschliesslich dem Tourismus')
   → erlaubt Kurabgabe-Refinanzierung nach § 11 KAG M-V
   → erlaubt NICHT Direktvergabe nach VO 1370/2007 (Art. 1 Abs. 2)

B) § 42 PBefG OePNV-Daseinsvorsorge (formal-rechtliche Konzession)
   → erlaubt Direktvergabe nach VO 1370/2007
   → erlaubt NICHT Sondertarife ohne Deutschland-Ticket-Akzeptanz
   → muss Kreis-OePNV-Mittel statt Kurabgabe nutzen

ROSINEN-PICKEN BEIDER REGIME = juristisch unzulaessig.

Mit drei rechtsdogmatischen Saeulen:

1) Widerspruechliches Verhalten (venire contra factum proprium) =
   Rechtsmissbrauch der Wahl der Rechtsform

2) Verletzung § 11 KAG M-V Zweckbindung — BVerwGE 95, 188 verbietet
   Quersubventionierung der OePNV-Aufgabe via Kurabgabe

3) Art. 3 GG Diskriminierung des D-Ticket-Touristen + Privater
   Wettbewerber (Du als Funk-Taxi)

WICHTIG: 'Sie wollen ihr System beibehalten, weil sich sonst das System
nicht rechnet' — das ist die ZUTREFFENDE oekonomische Analyse:
LK VG wuerde regulaer aus Kreisumlage zahlen muessen. Gemeinde schiebt
die Daseinsvorsorge-Last auf die ortsfremden Gaeste = VERFASSUNGSRECHTLICH
UNZULAESSIGE STEUERSTAATS-UMGEHUNG (BVerfGE 110, 274 Tabaksteuer).

ANWALTSSTRATEGIE 5 PUNKTE:
1. Verfassungsbeschwerde § 4 Abs. 5 Kurabgabesatzung (Zweckbindung)
2. Konkurrenten-Klage § 13 II Nr 3 PBefG mit Rechtsmissbrauchs-Argument
3. Beihilfe-Beschwerde EU-Kommission Art. 108 III AEUV
4. Anwaltsschreiben Gemeinde mit Klarstellungsforderung + Klageandrohung
5. Gleichbehandlungs-Antrag Kurkarte-Akzeptanz Funk-Taxi

VERKETTUNG MIT BISHERIGEN SEKTIONEN:
- Sektion P (Linienprofil) + Q+Q9 (Tourismus-Gestaendnisse) liefern Beweis
- Sektion R (Vertragstext) zeigt Konstruktions-Maengel
- Sektion S (Konzern-Doppelverdraengung VVG+Ilse-Bus) gibt Marktstruktur
- SEKTION T fuegt das integrierende Argument hinzu: alle vorgenannten
  Verletzungen entstehen aus einer EINZIGEN WURZEL — dem inneren
  Widerspruch zwischen Tourismus-Zweck und § 42-PBefG-Beanspruchung

Weigel kann Sektion T als Synthese-Kapitel an den Anfang der Mappe stellen.

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'Sektion T Weigel-Mappe: Innerer Widerspruch Tourismus vs § 42 — Doppel-Abzocke (06.06.2026)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
