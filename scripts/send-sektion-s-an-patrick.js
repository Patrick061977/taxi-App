const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-06_Sektion_S_Konzern_Doppelverdraengung_VVG.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei Sektion S der Weigel-Mappe: "Konzern-Doppelverdraengung VVG mbH:
Kaiserbaederlinie + Ilse-Bus AST".

KERN-ERKENNTNISSE:

1. ENTDECKUNG: VVG mbH betreibt BEIDE Verkehre — Linie 290/291 UND Ilse-Bus.
   Quelle: Faktentafel F1 vom 05.06. (Betreiber: VVG mbH Torgelow + MVVG mbH
   Demmin). Doppelte Subvention + doppelte Tarifprivilegierung durch denselben
   Konzern.

2. MARKTSEGMENT-VERLAGERUNG: Tabelle der Marktnischen die fuer Taxis uebrig
   bleiben (Krankenfahrten, Grossgruppen, Spaetabend, Spontan < 30 Min). Ohne
   diese ist Taxi-Konzession wirtschaftlich nicht tragfaehig.

3. ART. 3 GG UNGLEICHBEHANDLUNG: Vergleichstabelle Bedarfsverkehr §44 (Ilse-Bus)
   vs Taxi §47 (Du). Service-Profil deckungsgleich, aber asymmetrische Privilegien
   (D-Ticket + Kurkarte + Direktvergabe nur fuer §44). Sachlicher Differenzierungs-
   grund fehlt — BVerfGE 9, 338 (Hebammen) als Vergleichsfall.

4. TOURISMUS-TARNUNG (DEIN KERNARGUMENT): OePNV-Privilegien sind verfassungs-
   rechtlich fuer DASEINSVORSORGE (Schule, Beruf, Behoerden, Gesundheit) gedacht
   — NICHT fuer Tourismus. Linie 290/291 + Ilse-Bus sind nach NVP-Eintrag und
   eigenem Gestaendnis (Sektion P+Q+Q9) touristisch dominant. Das verletzt:
   - Art. 1 Abs. 2 VO 1370/2007 (Direktvergabe-Ausnahme touristisch)
   - § 13 II Nr 3 PBefG (Konkurrentenschutz unterlaufen)
   - § 11 KAG M-V (Kurabgabe-Zweckbindung)
   - Art. 107 AEUV (Beihilfe-Notifizierung)

→ Die Tourismus-Tarnung verkettet alle vier Rechtsebenen — das ist das
zentrale Argument fuer Weigel.

6 NEUE IFG-PUNKTE S-IFG 1 bis S-IFG 6 fuer:
- LSBV M-V (Konzessionsgrundlage Ilse-Bus + Taxi-Gewerbe-Anhoerung)
- LK VG + Gemeinden (Beihilfe-Notifizierung, Doppelfoerderung-Volumen)
- VVG mbH (Fahrgaststatistik Ilse-Bus nach Tarifgruppe)

ANWALTSSTRATEGIE 4 PUNKTE:
1. IFG-Brief LSBV erweitern um Ilse-Bus-Konzessionsgrundlage + § 14 PBefG
   Anhoerung Taxi-Gewerbe
2. Anwaltsschreiben LK VG + Gemeinden zur Beihilfe-rechtlichen Pruefung
3. Hilfsweise Konkurrenten-Klage § 13 II Nr 3 PBefG gegen BEIDE
   Konzessionen
4. Kartellrechtliche Beschwerde Inhouse-Konstruktion (EuGH Undis Servizi)

Weigel kann den Inhalt mit eigenem Briefkopf uebernehmen oder als Ergaenzung
zu Memo + Sektionen P/Q/Q9/R in die Mappe einarbeiten.

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'Sektion S Weigel-Mappe: Konzern-Doppelverdraengung VVG + Ilse-Bus AST (06.06.2026)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
