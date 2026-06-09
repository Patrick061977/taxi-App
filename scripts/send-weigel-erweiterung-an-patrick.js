const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel.pdf',
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel_ERWEITERUNG.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei die Weigel-Mappe in der konsolidierten Fassung:

1) Faktentafel BASIS (05.06., Sektionen A-H)
2) Faktentafel ERWEITERUNG (05.06., Sektionen I-N + Quellen + IFG-Bedarf)

Die ERWEITERUNG verdichtet die wichtigen Punkte ohne Nebensächlichkeiten — wie Du es gewünscht hast.

TOP-BEFUND (rechtlich am wichtigsten):

Art. 1 Abs. 2 VO (EG) 1370/2007 (EU-ÖPNV-Verordnung) sagt wörtlich:
"ausgenommen Verkehrsdienste, die hauptsächlich (...) zu touristischen Zwecken betrieben werden"

Damit ist die Frage "Touristenbus = kein ÖPNV?" schwarz auf weiß im EU-Recht angelegt. Wenn der Kurkartenbus hauptsächlich zu touristischen Zwecken läuft (Saisonverstärkung, Bedienung Strandpromenade/Seebrücken, Finanzierung >97 % aus Kurabgabe statt Steuermitteln), ist er vom Anwendungsbereich der EU-ÖPNV-Verordnung ausgenommen.

WEITERE KERNFUNDE:

• Geldfluss-Architektur (Sektion J):
  - VVG mbH: ca. 1.770.000 EUR/Jahr aus Kurabgabe
  - Adler-Schiffe: ca.   690.000 EUR/Jahr aus Kurabgabe
  - Gesamt:        ca. 2.460.000 EUR/Jahr
  Beide klar oberhalb De-minimis-Schwelle 300.000 EUR/3 J. (VO 2023/2831).

• KAG-M-V-Zweckbindung (Sektion L):
  OVG M-V 4 K 756/21 vom 28.10.2024 stellt fest: "Bis zum 16.07.2021 waren
  Zuschüsse an Dritte aus Kurabgabe-Mitteln nicht zuschussfähig." Beschluss
  22/0171 aus Januar 2023 fällt zwar nach der Klarstellung, aber die Vertrags-
  anbahnung kann in die problematische Übergangsphase fallen.

• Konzessionsvergabe (Sektion M):
  Landkreis VG kuendigte am 27.11.2024 eine Ausschreibung an. TED-EU-Suche
  fuer Dezember 2024 ergibt keine zuordenbare Bekanntmachung. VVG-Übernahme
  ab 01.01.2026 wirkt wie Direktvergabe an internen Betreiber (Art. 5 Abs. 2
  VO 1370/2007). Vorabbekanntmachung nach Art. 7 Abs. 2 VO 1370/2007 ist
  damit unklar — Akteneinsicht beim LSBV M-V erforderlich.

• Drei zentrale Subsumtionsfragen fuer LSBV (Sektion K.4):
  - K-Frage 1: Wie ordnet die Behoerde "ausschliesslich Kurkarteninhaber-
    finanzierte Mitfahrmoeglichkeit" unter "diskriminierungsfrei fuer die
    Allgemeinheit" (Art. 2 lit. a VO 1370/2007) ein?
  - K-Frage 2: Schliesst die Tourismus-Ausnahme Art. 1 Abs. 2 VO 1370/2007
    die Anwendung der Verordnung auf diesen Bus aus?
  - K-Frage 3: Welche Verkehrsform aus § 46 Abs. 2 PBefG (Taxi/Ausflug/
    Mietwagen/gebuendelter Bedarfsverkehr) waere ersatzweise einschlaegig?

KONSOLIDIERTE IFG-BEDARFE (5 Behoerden):
1) LSBV M-V: Vergabeart, Vorabbekanntmachung, Konzessionsurkunde
2) Hauptamt Heringsdorf: Vertragstexte VVG + Adler; Beschlussakten 22/0171,
   26/1112, 26/1184; Kostenstellen-Trennung Linienbetrieb vs. Tourismus
3) LAIV M-V: Gemeinde-Uebernachtungs-Jahreszahl 2024 + 2025
4) BMWK / WMV M-V: Beihilfe-Notifizierung VVG- und Adler-Pauschale
5) Landkreis-Vergabeamt VG (Pasewalk): TED-Veroeffentlichung Linienbuendel
   Ost Usedom mit Aktenzeichen + Datum

NAECHSTER SCHRITT:
Sag mir, ob die Mappe so an Weigel rausgehen kann (Anschreibe-Mail kann ich
als Entwurf vorbereiten — versendet wird nichts ohne Deine Freigabe).

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'Weigel-Mappe Kurkartenbus — Faktentafel BASIS + ERWEITERUNG (Stand 05.06.2026)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
