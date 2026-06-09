const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');
const fs = require('fs');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';

const FILES_ORDERED = [
    // Memo + Updates
    '2026-06-02_Memo_RA_Weigel_Kaiserbaederlinie_VVG.pdf',
    '2026-06-04_Memo-V2_RA_Weigel_Kaiserbaederlinie_Schutzklauseln.pdf',
    '2026-06-05_Update_RA_Weigel_Kaiserbaederlinie_Botenfunde.pdf',
    '2026-06-05_Story_Chronologie_Kurkartenbus_Heringsdorf.pdf',
    // Faktentafeln
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel.pdf',
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel_ERWEITERUNG.pdf',
    // Sektionen
    '2026-06-05_Sektion_P_Linienprofil_290_291.pdf',
    '2026-06-05_Sektion_Q_Eigen_Gestaendnisse_Tourismus.pdf',
    '2026-06-05_Sektion_Q9_Personen_Zitate.pdf',
    '2026-06-05_Sektion_R_Vertragstext_Bekanntmachungen.pdf',
    '2026-06-06_Sektion_S_Konzern_Doppelverdraengung_VVG.pdf',
    '2026-06-06_Sektion_T_Innerer_Widerspruch_Tourismus_vs_Paragraf_42.pdf',
    // IFG-Briefe
    '2026-06-04_IFG_LSBV_Pruefung_Taxiverdraengung.pdf',
    '2026-06-04_IFG_LK_VG_Anhoerung_Taxiverdraengung.pdf',
    '2026-06-05_IFG_LSBV_MV_Konzession_290_291.pdf',
];

const attachments = FILES_ORDERED.map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
})).filter(a => fs.existsSync(a.path));

const missingFiles = FILES_ORDERED.filter(f => !fs.existsSync(path.join(pdfDir, f)));
if (missingFiles.length > 0) {
    console.warn('Fehlende Dateien:', missingFiles);
}

const totalSizeMB = (attachments.reduce((s, a) => s + fs.statSync(a.path).size, 0) / 1024 / 1024).toFixed(2);

const body = `Hallo Patrick,

anbei das komplette SAMMELSURIUM der Weigel-Mappe — Stand 06.06.2026.
${attachments.length} PDFs, gesamt ${totalSizeMB} MB.

Sortiert nach Logik (Du kannst beim Weiterleiten an Weigel ggf. genau diese
Reihenfolge nehmen oder nach Bedarf umstellen):

═══════════════════════════════════════════════════════════════
A) AUFTAKT-MEMO + ERWEITERUNGEN
═══════════════════════════════════════════════════════════════

1. Memo V1 (02.06.2026): Grund-Memo Kaiserbaederlinie / VVG
2. Memo V2 (04.06.2026): Schutzklauseln + Vorgehensoptionen
3. Update Botenfunde (05.06.2026): Was im Kaiserbaeder-Boten gefunden wurde
4. Story-Chronologie (05.06.2026): Zeitlinie der gemeindlichen Entscheidungen

═══════════════════════════════════════════════════════════════
B) FAKTENTAFELN
═══════════════════════════════════════════════════════════════

5. Faktentafel Kurkartenbus Weigel (05.06.2026): Strukturierte
   Datenpunkte mit Quellen
6. Faktentafel ERWEITERUNG (05.06.2026): Zusatzfakten nach
   Botenfund-Recherche

═══════════════════════════════════════════════════════════════
C) DETAILSEKTIONEN P bis T (= Rohstoff fuer Schriftsatz)
═══════════════════════════════════════════════════════════════

7. Sektion P: Linienprofil 290/291 — NVP-Tourismusnetz-Status,
   Bedienprofil, IFG-Punkte
8. Sektion Q: Eigen-Gestaendnisse Tourismus (5 Akteursgruppen)
9. Sektion Q9: Personen-Zitate mit Direktbeweisen (Hasselmann,
   Nagy, Sack, Zabel, Petersen, Mirass)
10. Sektion R: Vertragstext & Bekanntmachungen (was systematisch fehlt)
11. Sektion S: Konzern-Doppelverdraengung VVG mbH = Linie + Ilse-Bus AST
12. Sektion T (HERZSTUECK): Innerer Widerspruch Tourismus vs § 42
    PBefG — Doppel-Abzocke der Kurabgabe-Pflichtigen

═══════════════════════════════════════════════════════════════
D) IFG-BRIEFE (zum eigenstaendigen Versand durch Weigel)
═══════════════════════════════════════════════════════════════

13. IFG-Brief LSBV Pruefung Taxi-Verdraengung (04.06.2026)
14. IFG-Brief LK VG Anhoerung Taxi-Verdraengung (04.06.2026)
15. IFG-Brief LSBV M-V Konzession 290/291 (05.06.2026, jetzt erweitert
    um Punkte 9 Tarifgenehmigung + D-Ticket-Status, 10 Ilse-Bus-
    Konzession, 11 Taxi-Gewerbe-Anhoerung)

═══════════════════════════════════════════════════════════════

KERN-ARGUMENTE der Mappe in EINEM Satz:

Die Gemeinde Heringsdorf nimmt fuer die Kaiserbaederlinie 290/291
GLEICHZEITIG die Privilegien zweier sich rechtssystematisch
ausschliessender Regime in Anspruch — Tourismus-Refinanzierung
ueber § 11 KAG M-V UND OePNV-Direktvergabe nach § 42 PBefG +
VO 1370/2007 — und entzieht sich gleichzeitig den Pflichten beider
Regime (Daseinsvorsorge-Charakter, D-Ticket-Akzeptanz, Anhoerung
des Taxi-Gewerbes nach § 14 PBefG). Dies fuehrt zur DOPPEL-ABZOCKE
der ortsfremden Gaeste (Kurabgabe + ggf. D-Ticket fuer dieselbe
Beforderungsleistung) und zur strukturellen Marktverdraengung
des privaten Taxi-Gewerbes. Verfassungsrechtlich ist die Konstruktion
unter Art. 3 GG + § 11 KAG M-V + BVerfGE 110, 274 Tabaksteuer
nicht haltbar.

NAECHSTE SCHRITTE:
- Versand der 3 IFG-Briefe (13, 14, 15) ueber Weigel-Briefkopf an
  LSBV M-V + LK VG (Fristen: 1 Monat nach Antrag gem. § 9 IFG M-V)
- Optional: Anwaltsschreiben an Gemeinde Heringsdorf mit
  Klarstellungsforderung (Sektion T, Konsequenz 4)
- Optional: Beihilfe-Beschwerde EU-Kommission (Sektion T, Konsequenz 3)

Diese Mail enthaelt alles, was Du brauchst, um die naechste Stufe
mit Weigel anzustossen. Bei Rueckfragen schreib einfach.

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: `Weigel-Mappe KOMPLETT (Stand 06.06.2026) — ${attachments.length} PDFs, ${totalSizeMB} MB`,
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    console.log('Anhänge:', attachments.length);
    console.log('Größe:', totalSizeMB, 'MB');
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
