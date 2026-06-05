const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: 'tiajmwotmnltltkh' },
});

const pdfDir = 'C:/Taxi App/taxi-App-github/briefe/pdf';
const attachments = [
    '2026-06-05_Sektion_P_Linienprofil_290_291.pdf',
    '2026-06-05_Sektion_Q_Eigen_Gestaendnisse_Tourismus.pdf',
    '2026-06-05_Sektion_Q9_Personen_Zitate.pdf',
].map(name => ({
    filename: name,
    path: path.join(pdfDir, name),
    contentType: 'application/pdf',
}));

const body = `Hallo Patrick,

anbei das vollstaendige Tourismus-Komplex-Paket der Weigel-Mappe:

1) SEKTION P "Linien-Profil 290/291: OEPNV-Daseinsvorsorge oder touristisch motivierter Verkehr?" (Fahrplan + Haltestellen + Tarifstruktur + 17/20 Indizien fuer Touristik)

2) SEKTION Q "Eigen-Gestaendnisse: Tourismusverkehr statt klassischer OEPNV" (5 Akteur-Gruppen mit woertlichen Zitaten: Aufgabentraeger LK VG, Betreiber VVG, Gemeinde Heringsdorf, UTG/UsedomCard, Presse Nordkurier)

3) SEKTION Q9 "Personen-Zitate" (5 belastbare Direktzitate handelnder Personen: Vizelandrat Hasselmann, Landrat Sack, VVG-GF Zabel, Staatssekretaer Mirass, Ex-BM Petersen)

KILLER-LINIE durch alle drei Sektionen:

Aufgabentraeger LK VG (NVP S. 125): "Tourismusnetz... besonders stark ausgepraegte touristische Bedeutung"
Betreiber VVG (PM): "Pauschale Zahlungen je Tages-/Uebernachtungs-/Jahreskurkarte"
Gemeinde Heringsdorf (Beschluss 22/0171): "umlagefinanzierte Einbindung von Bus und Bahn in die Kurkarte"
UTG (UsedomCard): "Kurticket fuer Gaeste der Kaiserbaeder"
Nordkurier 01.08.2018: "Kurgaeste koennen kostenlos Bus auf Usedom fahren"
Vizelandrat Hasselmann: trennt explizit "Achterland-OEPNV" von "See-/Ostseebaeder-Anforderungen"
Landrat Sack: "Kaiserbaeder profitieren" + mv81 fuer "Erreichbarkeit der Insel"
VVG-GF Zabel: "durchgehende Verbindung ohne Umstieg" (Tourismus-Komfort)
Ex-BM Petersen: "Bring-/Abholdienst zu Unterkuenften" (Tourismus-Logistik)
Staatssekretaer Mirass: "Berufspendler und Touristen" als gemeinsame Zielgruppe

KEIN handelnder Akteur bezeichnet die Linie als "klassischen OEPNV-Daseinsvorsorgeverkehr". Sie alle nennen sie KURBUS, TOURISTENBUS, KURKARTENBUS, KAISERBAEDER-LINIE, KURTICKET.

OFFEN (IFG-Bedarf, in den Sektionen aufgelistet):
- Simon Nagy (Justiziar Gemeinde) - kein oeffentliches Zitat indexiert, Patricks Erinnerung "Selbst Nagy sagt Touristenbus" muss ueber Sitzungsprotokolle Hauptamt belegt werden
- Marisken-Originalstatements - nur Sammel-Paraphrasen oeffentlich, Originalprotokolle ueber Allris/Hauptamt anfordern

KLAGEBEGRUENDUNGS-SENTENZ (in Sektion Q.7):

"Der Aufgabentraeger Landkreis Vorpommern-Greifswald hat im Nahverkehrsplan 2017-2027 die Linien 290/291 ausdruecklich als 'Tourismusnetz' und 'touristisch vermarktet' eingestuft. Der Betreiber VVG mbH bezeichnet die Linie als 'Kaiserbaeder-Linie' und finanziert sie ausschliesslich ueber 'pauschale Zahlungen je Kurkarte' der Gemeinde Heringsdorf. (...) Eine Einordnung als klassischer oeffentlicher Personennahverkehr im Sinne des Regionalisierungsgesetzes und des § 42 PBefG erschiene angesichts dieser geschlossenen Selbstauskuenfte nicht haltbar."

Damit ist die "rein touristisch"-These nicht mehr Mandanten-Behauptung, sondern UEBEREINSTIMMENDE SELBST-AUSKUNFT der Behoerden und Betreiber. Schwer fuer LSBV M-V wegzudiskutieren.

Naechster Schritt:
Mit dem dreifachen Sektion P+Q+Q9 hat Weigel eine sehr solide Beleg-Basis fuer:
a) Konkurrentenruege LSBV M-V
b) Anfechtungsklage VVG-Konzession beim VG Greifswald

Bei Bedarf ergaenze ich morgen:
- Anschreibe-Mail-Entwurf an RA Weigel
- IFG-Briefe an Hauptamt Heringsdorf (Marisken-/Nagy-Statements aus Sitzungsprotokollen)
- IFG-Brief an LSBV M-V (Konzessionsbescheid-Grundlage)

Gruss
Claude (fuer Patrick Wydra, Funk Taxi Heringsdorf)`;

transporter.sendMail({
    from: '"Patrick Wydra" <taxiwydra@googlemail.com>',
    to: 'taxiwydra@googlemail.com',
    subject: 'Weigel-Mappe Sektion P + Q + Q9 — Tourismus-Komplex vollstaendig (Stand 05.06.2026)',
    text: body,
    attachments,
}).then(info => {
    console.log('Mail gesendet:', info.messageId);
    process.exit(0);
}).catch(e => {
    console.error('Fehler:', e.message);
    process.exit(1);
});
