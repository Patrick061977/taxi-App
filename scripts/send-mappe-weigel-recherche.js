const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const fs = require('fs');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const briefe = [
    '2026-06-02_Memo_RA_Weigel_Kaiserbaederlinie_VVG.md',
    '2026-06-04_Memo-V2_RA_Weigel_Kaiserbaederlinie_Schutzklauseln.md',
    '2026-06-04_IFG_LSBV_Pruefung_Taxiverdraengung.md',
    '2026-06-04_IFG_LK_VG_Anhoerung_Taxiverdraengung.md',
    '2026-06-05_Update_RA_Weigel_Kaiserbaederlinie_Botenfunde.md',
    '2026-06-05_Story_Chronologie_Kurkartenbus_Heringsdorf.md',
];

const attachments = briefe.map(name => ({
    filename: name,
    path: path.join('C:/Taxi App/taxi-App-github/briefe', name),
    contentType: 'text/markdown; charset=utf-8',
}));

const body = `Hallo Patrick,

anbei wie besprochen die komplette Recherche-Mappe zum Thema Kurkartenbus / Kaiserbäderlinie / VVG. Stand 05.06.2026, vor der Mandatsbesprechung mit RA Weigel.

WICHTIG vorab: ALLE behördlichen Schritte (IFG-Anfragen, Aufsichtsbeschwerde, Klage etc.) laufen über Weigel — nichts wird ohne seine Freigabe direkt versendet. Die IFG-Briefe sind als Entwürfe vorbereitet, damit Du mit Weigel besprechen kannst, ob Mandant oder Kanzlei zeichnet.

6 Anhänge:

1) Memo-V1 (02.06.) — wirtschaftliche Wettbewerbsverzerrung, erste Argumentationsskizze (~5 Seiten)
2) Memo-V2 (04.06.) — PBefG-Schutzklauseln + Inselvergleich Sylt/Föhr/Rügen + 14 IFG-Fragen (~8 Seiten)
3) IFG-Brief-Entwurf LSBV M-V — Genehmigungsakte Kaiserbäderlinie (~3 Seiten)
4) IFG-Brief-Entwurf LK VG — Anhörung & Verkehrsschau (~3 Seiten)
5) Update vom 05.06. — Boten-Aktenfunde: EFRE-Förderung, Beschluss 22/0171 (9/5/3 knapp!), Tarif 0,50/0,60 €/Tag amtlich, Parkplatz Grenze 26/1112, ILSE-Bus, Vorabbekanntmachung 20.12.2024 TED, Adler-Schiffe 0,30 € (~6 Seiten)
6) Story-Chronologie 2016-2026 — komplette Zeitachse mit Akteuren (Petersen/Marisken/UTG/UBB/VVG), Mittelflüsse, 7 "linke Dinger" (knappe Mehrheit, fehlende Markterhebung, UBB-Knebelung 2026/27, EFRE-Auflagen unbekannt, Parkplatz unter Marktwert, UTG-Verflechtung, fehlende §50-Auflagen), 5 mögliche Klage-Linien (~9 Seiten)

GESAMT ca. 34 A4-Seiten / 988 Zeilen Markdown.


MEINE EMPFEHLUNG für die Weigel-Besprechung
============================================

Genug Munition zum Loslegen: ja. Das Material reicht für eine erste fundierte Mandatsbesprechung.

Schwerpunkte für Weigel sollten aus meiner Sicht sein:

- Hauptstoßrichtung § 14 PBefG (Anhörungspflicht nicht erfüllt) und § 50 Abs. 3 PBefG (Schutzklausel ILSE-Bus). Beide Punkte erfordern keine Schadensbeweisführung — sie greifen rein über die Verfahrensakten.
- Beihilfe-Schiene Art. 107/108 AEUV als Druckmittel parallel. Die quantifizierbare Mittelumlenkung ~2 Mio EUR/Jahr (amtlich in der Satzung verankert!) ist klar oberhalb der De-minimis-Grenze.
- Phase 1 IFG-Anfragen (4 Adressaten: LSBV, LK VG, Gemeinde Heringsdorf, Landesförderinstitut M-V).
- TED-Originaleintrag vom 20.12.2024 sollte die Kanzlei abrufen — auf den Fristtag kommt es an.

Wenn Du grünes Licht gibst, fasse ich Memo V1 + V2 + Update zu einer Anschreibe-Mail an Weigel zusammen (Story + IFG-Briefe als zusätzliche Anhänge) und schicke Dir den Entwurf erst zur Freigabe.

Gruß
Claude (für Patrick Wydra, Funk Taxi Heringsdorf)

---
Repo-Pfade aller Dokumente:
- briefe/2026-06-02_Memo_RA_Weigel_Kaiserbaederlinie_VVG.md
- briefe/2026-06-04_Memo-V2_RA_Weigel_Kaiserbaederlinie_Schutzklauseln.md
- briefe/2026-06-04_IFG_LSBV_Pruefung_Taxiverdraengung.md
- briefe/2026-06-04_IFG_LK_VG_Anhoerung_Taxiverdraengung.md
- briefe/2026-06-05_Update_RA_Weigel_Kaiserbaederlinie_Botenfunde.md
- briefe/2026-06-05_Story_Chronologie_Kurkartenbus_Heringsdorf.md
`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra - Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'taxiwydra@googlemail.com',
        subject: 'Kurkartenbus / VVG - Komplette Recherche-Mappe (Stand 05.06.2026) - vor RA-Weigel-Besprechung',
        text: body,
        attachments: attachments,
    });
    console.log('Recherche-Mappe an taxiwydra@googlemail.com versendet');
    console.log('Message-ID:', info.messageId);
    console.log('Anhaenge:', briefe.length);
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
