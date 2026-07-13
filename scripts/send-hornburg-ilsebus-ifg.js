#!/usr/bin/env node
// send-hornburg-ilsebus-ifg.js — 10.07.2026
// Rendert die HTML-Anfrage zu PDF und sendet sie an RA Hornburg (Ergänzung zum Mandat 25.06.).

const fs = require('fs');
const path = require('path');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const puppeteer = require('C:/Taxi App/taxi-App-github/functions/node_modules/puppeteer-core');

const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Users/Taxi/AppData/Local/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

const HTML = 'C:/Taxi App/taxi-App-github/briefe/pdf/2026-07-10_Anschreiben_RA_Hornburg_Ilsebus-IFG.html';
const PDF  = HTML.replace('.html', '.pdf');

const FROM = 'Patrick Wydra <taxiwydra@googlemail.com>';
const TO = 'kontakt@rechtsanwalt-hornburg.de';
const SUBJECT = 'Ergaenzung zum Mandat vom 25.06.2026 - IFG-Anfragen zur Ilse-Bus-Erweiterung Kaiserbaeder ab 01.04.2026';

const BODY = `Sehr geehrter Herr Rechtsanwalt Hornburg,

anknuepfend an mein Erst-Anschreiben vom 25.06.2026 (Linie 290/291 Kaiserbaederlinie) bitte ich, im Rahmen des laufenden Mandats einen weiteren Sachverhalt aufzunehmen, der aus meiner Sicht mit demselben Betreiber (VVG mbH) zusammenhaengt und die wirtschaftliche Beeintraechtigung des oertlichen Taxi-Gewerbes vertieft.

SACHVERHALT ILSE-BUS
Die Verkehrsgesellschaft Vorpommern-Greifswald mbH (VVG, Ukranenstrasse 8, 17358 Torgelow, Geschaeftsfuehrer Dirk Zabel) betreibt seit dem 05.01.2026 einen Rufbus ("Ilse-Bus") in Teilen der Insel Usedom (Lieper Winkel, Usedomer Winkel, Amt Usedom Nord). Zum 01.04.2026 wurde das Bediengebiet auf die Kaiserbaeder ausgeweitet: bedient werden seither die Ortsteile Gothen, Sellin, Alt-Sallenthin, Neu-Sallenthin und Bansin Dorf mit Anschluss an die Mobilitaetsknoten Bansin Bahnhof, Bansin Seepark und Heringsdorf Bahnhof (Pressemitteilung Landkreis Vorpommern-Greifswald vom 01.04.2026).

Betriebszeiten in der Kaiserbaeder-Erweiterung: in der Nebensaison Mo-Fr 08:00-20:00 Uhr, an Wochenenden 08:00-18:00 Uhr; in der Hauptsaison (01.04.-31.10.) taeglich 08:00-20:00 Uhr. Fahrten sind bis 30 Minuten vor Wunschabfahrt telefonisch (03976/240 240), per App oder online (ilse-bus.de) zu buchen. Der Ilse-Bus hat eine Kapazitaet von bis zu acht Fahrgaesten je Fahrt, Tuer-zu-Tuer-Sammelfahrten.

Fuer die Kaiserbaeder-Erweiterung gilt ausdruecklich: "Der ILSE-Bus der Gemeinde Kaiserbaeder kann mit der Kurkarte der Kaiserbaeder sowie dem Deutschlandticket kostenfrei genutzt werden" (Landkreis VG, PM 01.04.2026). Die Refinanzierung erfolgt nach dem am 19.12.2025 zwischen der Gemeinde Ostseebad Heringsdorf und der VVG unterzeichneten Vertrag ueber pauschale Zahlungen "pro Tages-, Uebernachtungs- und Jahreskurkarte" (Nordkurier vom 19.12.2025). Ergaenzend foerdert das Land Mecklenburg-Vorpommern die Rufbusverkehre im Landkreis 2026 mit rund 2 Millionen Euro; der Kreisausschuss hat fuer den Rufbusaufbau bis 2028 insgesamt 3,3 Millionen Euro ueber die VMV mbH zur Verfuegung gestellt.

Fuer den Ursprungs-Ilse-Bus im Amt Peenetal/Loitz ist als Rechtsgrundlage eine Genehmigung nach Paragraph 42 iVm Paragraph 2 Abs. 6 PBefG dokumentiert (Zabel/Klemer/Mehlert, DER NAHVERKEHR 11/2019, S. 40). Auf welcher Genehmigung die Kaiserbaeder-Erweiterung ab 01.04.2026 beruht, ist oeffentlich nicht belegt; ebenso wenig, ob eine Pruefung Paragraph 13 Abs. 2 Nr. 3 PBefG / Paragraph 14 PBefG-Anhoerung erfolgte.

BITTE UM IFG-ANFRAGEN
Bitte im Rahmen des Mandats IFG-Anfragen nach LIFG M-V an das Landesamt fuer Strassenbau und Verkehr M-V (Aussenstelle Stralsund), an den Landkreis Vorpommern-Greifswald sowie an die Gemeinde Ostseebad Heringsdorf zu folgenden 9 Punkten:

1. Rechtsgrundlage Kaiserbaeder-Segment ab 01.04.2026 (Paragraph 42/44/41 Abs. 2 PBefG oder anders); Aktenzeichen, Datum, Geltungsdauer, Genehmigungsinhaberin, Betriebsgebiet, Aenderungsbescheide zu 2017er Ursprungsgenehmigung.
2. Anhoerung des Taxi-Gewerbes Paragraph 14 PBefG - war Funk-Taxi Heringsdorf beteiligt? Protokolle, Beteiligungsverfuegung.
3. Pruefung Paragraph 13 Abs. 2 Nr. 3 PBefG (Konkurrentenschutz, Funktionsfaehigkeit) - durchgefuehrt oder nicht? Bedarfsanalyse. Bezug BVerwG 8 C 33.20 (28.07.2021) und VG Leipzig 15.11.2024.
4. OeDA VO (EG) 1370/2007 - Vorabbekanntmachung Art. 7 Abs. 2, Ausschreibung oder Direktvergabe Art. 5 Abs. 2 oder 4, Beihilfe-Notifizierung Art. 107/108 AEUV.
5. Refinanzierungsvertrag Gemeinde Ostseebad Heringsdorf - VVG vom 19.12.2025 (Volltext oder wesentliche Inhalte).
6. Kurabgabesatzung 2026 der Gemeinde Ostseebad Heringsdorf + Gemeindevertretungs-Beschluss zur Ilse-Bus-Beauftragung.
7. Foerdersummen Ist ab 01.04.2026 (Kaiserbaeder-Segment) + Ansaetze 2026/2027 getrennt nach Land/Kreis/Gemeinde/Kurabgabe.
8. Fahrgaststatistik Kaiserbaeder-Segment ab 01.04.2026 - Anteile Kurkarten-Nutzer und D-Ticket-Nutzer.
9. Subunternehmer und Fahrzeugbestand - VVG-eigene Fahrzeuge oder ortsansaessige Taxi/Mietwagen-Betriebe als Subunternehmer? Ausschreibung, Zuschlag, Vertragslaufzeit.

RECHTLICHER HINTERGRUND
Die Antworten sind fuer die im Erstmandat aufgeworfenen Fragen (Konkurrentenschutz Paragraph 13 Abs. 2 Nr. 3 PBefG, Funktionsfaehigkeit des oertlichen Taxi-Gewerbes, Art. 3 Abs. 1 GG-Gleichheit) unmittelbar erheblich. Falls sich herausstellt, dass der Ilse-Bus im Kaiserbaeder-Segment in erster Linie touristischen Zwecken dient (hoher Kurkarten-Nutzeranteil), waere nach Art. 1 Abs. 2 VO (EG) 1370/2007 die Direktvergabe an ein inhouse-faehiges Verkehrsunternehmen rechtlich fraglich - mit denselben Folgen wie bei Linie 290/291.

Ueber eine kurze Rueckmeldung, ob und in welcher Reihenfolge Sie die IFG-Anfragen einreichen moechten, wuerde ich mich freuen. Ich stelle das Belegmaterial (Recherche-Quellen mit URLs, Pressemitteilungen, Fachartikel) gern als weitere Anlage zur Verfuegung.

Mit freundlichen Gruessen
Patrick Wydra
Funk-Taxi Heringsdorf
Tel. 038378 / 22022
taxiwydra@googlemail.com

Anlage: Anschreiben als PDF (formell mit Signatur-Block).
`;

(async () => {
    // 1) PDF aus HTML rendern
    if (!CHROME) {
        console.error('Kein Chrome/Edge gefunden');
        process.exit(1);
    }
    const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
    const p = await b.newPage();
    await p.goto('file://' + HTML, { waitUntil: 'load' });
    await p.pdf({
        path: PDF,
        format: 'A4',
        printBackground: true,
        margin: { top: '25mm', right: '22mm', bottom: '25mm', left: '22mm' },
    });
    await b.close();
    console.log('PDF: ' + PDF + ' ' + Math.round(fs.statSync(PDF).size / 1024) + ' KB');

    // 2) Email versenden
    if (!process.env.GMAIL_PASS) {
        console.error('GMAIL_PASS Env-Var fehlt');
        process.exit(1);
    }
    const t = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
    });
    try {
        const info = await t.sendMail({
            from: FROM,
            to: TO,
            subject: SUBJECT,
            text: BODY,
            attachments: [
                {
                    filename: '2026-07-10_Anschreiben_RA_Hornburg_Ilsebus-IFG.pdf',
                    path: PDF,
                },
            ],
        });
        console.log('OK - messageId:', info.messageId);
    } catch (e) {
        console.error('FEHLER:', e.message);
        process.exit(1);
    }
})();
