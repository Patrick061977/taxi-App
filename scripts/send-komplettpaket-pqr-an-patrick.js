const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: 'tiajmwotmnltltkh' },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel.pdf',
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel_ERWEITERUNG.pdf',
    '2026-06-05_Sektion_P_Linienprofil_290_291.pdf',
    '2026-06-05_Sektion_Q_Eigen_Gestaendnisse_Tourismus.pdf',
    '2026-06-05_Sektion_Q9_Personen_Zitate.pdf',
    '2026-06-05_Sektion_R_Vertragstext_Bekanntmachungen.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei das KOMPLETTE 6-Sektionen-Paket der Kurkartenbus-Mappe fuer RA Tom-Marek Weigel — Stand 05.06.2026 abends.

PDF-Reihenfolge:

1) FAKTENTAFEL BASIS (Sektionen A-H, 38 Fakten)
2) ERWEITERUNG (Sektionen I-N: Vertragsgefuege / Geldfluss / OEPNV-Definition / KAG-Querfinanzierung / Konzessionsvergabe / Chronologie)
3) SEKTION P (Linien-Profil 290/291: 17/20 Indizien fuer touristisch motivierten Verkehr)
4) SEKTION Q (Eigen-Gestaendnisse 5 Akteur-Gruppen: NVP, VVG, Gemeinde, UTG, Presse)
5) SEKTION Q9 (Personen-Zitate Hasselmann/Sack/Zabel/Petersen/Mirass + NEU Q9.A Nagy-Mail 08.09.2025)
6) SEKTION R (Vertragstext-Bekanntmachungs-Defizit + Vergleich mit Landkreis Vorpommern-Ruegen)

═══════════════════════════════════════════
DREI BESONDERS WICHTIGE BEFUNDE der heutigen Recherche:
═══════════════════════════════════════════

A) NAGY-MAIL 08.09.2025 (in Sektion Q9.A neu eingebaut):

Der Justiziar der Gemeinde Heringsdorf raeumt SCHRIFTLICH ein:

>> "Diese Busse dienen ausschliesslich dem Tourismus und koennen nur so in die Kurkarte einkalkuliert werden."

>> "Sie dient dem umweltfreundlichen und moeglichst auch effizienten Transport des Massentourismus zu Sehenswuerdigkeiten und somit zu einer Verbesserung der Aufenthaltsqualitaet."

>> "Der OEPNV wird ausschliesslich in Verantwortung des Landkreises betrieben. Die Gemeinde kooperiert darueber hinaus mit einem Anbieter des OEPNV (aktuell UBB), der eine ZUSAETZLICHE Verbindung in Heringsdorf schafft."

Dies ist eine schriftliche und datierte Selbstauskunft des Justiziars an Dich. Vor Gericht GOLDSTANDARD.

B) KILLER-VERGLEICH LK VORPOMMERN-RUEGEN vs LK VORPOMMERN-GREIFSWALD (Sektion R):

LK VORPOMMERN-RUEGEN hat es VORBILDLICH gemacht:
- Vorabbekanntmachung Art. 7 Abs. 2 VO 1370/2007 oeffentlich auf lk-vr.de
- § 8a Abs. 8 PBefG Bundesanzeiger-Veroeffentlichung
- Kreistagsbeschluss zur Direktvergabe 17.03.2025 oeffentlich
- Klassifikation explizit § 42 PBefG dokumentiert

LK VORPOMMERN-GREIFSWALD (Dein Landkreis) hat NICHTS davon:
- KEINE TED-Vorabbekanntmachung fuer VVG/Linie 290/291 indexiert
- KEINE Bundesanzeiger-Veroeffentlichung
- KEIN oeffentlicher Kreistagsbeschluss
- KEIN Vertragstext Heringsdorf-VVG oeffentlich
- KEIN Konzessionsbescheid LSBV M-V oeffentlich

Vergleich Nachbarkreis = Beweis dass Pflichtveroeffentlichungen MOEGLICH und ueblich sind.

C) NVP-TOURISMUSNETZ-EINORDNUNG (in BASIS + ERWEITERUNG + P + Q vielfach belegt):

Der Aufgabentraeger LK VG ordnet die Linie 290/291 in seinem eigenen NVP 2017-2027 S. 125 Tabelle 32 ausdruecklich der Netzkategorie "Tourismusnetz" zu. Auf S. 74: "touristisch vermarktet". Auf S. 129: "saisonal bedarfsgerecht zu verdichten".

═══════════════════════════════════════════
DAMIT HAT WEIGEL EINE WASSERDICHTE GRUNDLAGE:
═══════════════════════════════════════════

- Formal (Verfahrensfehler durch fehlende Veroeffentlichungen) -- Sektion R
- Materiell (NVP-Tourismusnetz-Status widerspricht § 42-Konzession) -- Sektion P
- Bewiesen (Selbst-Gestaendnisse der Akteure) -- Sektion Q + Q9 + Q9.A Nagy

Plus die Beihilfefrage (~2,46 Mio EUR/Jahr ohne EU-Notifizierung) -- Sektion J in ERWEITERUNG.

Klageweg: Anfechtungsklage VVG-Konzessionsbescheid beim VG Greifswald, gestuetzt auf
- § 13 Abs. 2 Nr. 3 PBefG Konkurrentenschutz
- § 14 Abs. 1 Nr. 3 PBefG Anhoerungsmangel
- Art. 7 Abs. 2 VO 1370/2007 Vorabbekanntmachungs-Pflicht
- Art. 1 Abs. 2 VO 1370/2007 Tourismus-Ausnahme

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'Weigel-Mappe KOMPLETT 6 Sektionen — BASIS + ERW + P + Q + Q9 + R (Stand 05.06.2026 abends)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
