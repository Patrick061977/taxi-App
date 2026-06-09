const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-02_Memo_RA_Weigel_Kaiserbaederlinie_VVG.pdf',
    '2026-06-04_Memo-V2_RA_Weigel_Kaiserbaederlinie_Schutzklauseln.pdf',
    '2026-06-04_IFG_LSBV_Pruefung_Taxiverdraengung.pdf',
    '2026-06-04_IFG_LK_VG_Anhoerung_Taxiverdraengung.pdf',
    '2026-06-05_Update_RA_Weigel_Kaiserbaederlinie_Botenfunde.pdf',
    '2026-06-05_Story_Chronologie_Kurkartenbus_Heringsdorf.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei die finalen 6 PDFs der Kurkartenbus-Recherche-Mappe für die Mandatsbesprechung mit RA Weigel.

Stand: 05.06.2026, finaler PDF-Layout (A4, mit Seitennummerierung und Kopfzeile).

Reihenfolge der Anhänge:

1) Memo V1 (02.06.) — Wettbewerbsverzerrung (5 Seiten)
2) Memo V2 (04.06.) — PBefG-Schutzklauseln + Inselvergleich + 14 IFG-Fragen (12 Seiten)
3) IFG-Brief-Entwurf LSBV M-V — Genehmigungsakte (3 Seiten)
4) IFG-Brief-Entwurf LK VG — Anhörung & Verkehrsschau (3 Seiten)
5) Update vom 05.06. — Boten-Aktenfunde EFRE/Beschluss/Tarif/Parkplatz/ILSE (10 Seiten)
6) Story-Chronologie 2016-2026 — komplette Zeitachse + Akteure + Mittelflüsse + Auffälligkeiten + Klage-Linien (12 Seiten)

Insgesamt 45 A4-Seiten als PDF-Paket — bereit zur Weiterleitung an Weigel.

Hinweise zur PDF-Vorbereitung:
- KI-Hinweise wurden aus allen Briefen entfernt
- 'Mandanteneigene Recherche' steht in der Fußzeile jeder Seite
- Layout druckfertig (Margins 25mm oben/unten, 22mm seitlich)

NÄCHSTER SCHRITT (warte auf Dein OK):
Soll ich eine Anschreibe-Mail an RA Weigel als ENTWURF vorbereiten? Adresse müsste ich von Dir bekommen — vermutlich die Kanzlei-Anklam-Adresse. Versendet wird nichts ohne Deine ausdrückliche Freigabe.

Gruß
Claude (für Patrick Wydra, Funk Taxi Heringsdorf)`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra - Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'taxiwydra@googlemail.com',
        subject: 'Kurkartenbus / VVG — Finale PDF-Mappe (45 Seiten) für RA Weigel — Stand 05.06.2026',
        text: body,
        attachments: attachments,
    });
    console.log('PDF-Mappe an taxiwydra@googlemail.com versendet');
    console.log('Message-ID:', info.messageId);
    console.log('Anhaenge:', attachments.length, 'PDFs');
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
