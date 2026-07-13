#!/usr/bin/env node
// send-hornburg-erstanfrage.js — Patrick 25.06.2026 15:56 "Ok send"
// Sendet das Anschreiben + 2 Anlagen (Memo + Faktentafel) an RA Hornburg in Wolgast.

const fs = require('fs');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const FROM = 'Patrick Wydra <taxiwydra@googlemail.com>';
const TO = 'kontakt@rechtsanwalt-hornburg.de';
const SUBJECT = 'Anfrage zur Mandatsuebernahme — Schutz Taxi-Gewerbe Heringsdorf gegen Bus-Linienverkehr 290/291';

const BODY = `Sehr geehrter Herr Rechtsanwalt Hornburg,

als Inhaber des Funk-Taxi Heringsdorf bitte ich Sie um Uebernahme eines verwaltungs- und personenbefoerderungsrechtlichen Mandats.

Vorab erlaube ich mir, den Sachverhalt in der gebotenen Kuerze zu schildern; die ausfuehrliche Belegtafel mit allen Zitaten, Fahrplan-Auszuegen und Rechtsprechungs-Nachweisen liegt als Anlage 1 bei.

SACHVERHALT IN KUERZE
Die Linie 290/291 der ehemaligen Usedomer Baederbahn GmbH (UBB), seit dem 19.12.2025 betrieben durch die Verkehrsgesellschaft Vorpommern-Greifswald mbH (VVG, Tochter der landeseigenen VMV-Verkehrsgesellschaft Mecklenburg-Vorpommern mbH), bedient die Strecke Bansin Bf - Heringsdorf - Ahlbeck Grenze (- Swinemuende) mit 52 Haltestellen pro Rundfahrt im 10-20-Min-Takt der Saison. Inhaber einer Kurkarte fahren auf der Strecke kostenlos; die Linie wird ueber eine jaehrliche Pauschalzahlung der Gemeinde Heringsdorf an die VVG aus der Kurabgabe finanziert.

KERNPUNKTE
- Der Nahverkehrsplan 2017-2027 des Landkreises Vorpommern-Greifswald sieht die Linie als "Tourismusnetz" mit Pflicht zur eigenwirtschaftlichen Finanzierung vor (NVP Z. 4664, Z. 5001-5002).
- Der NVP nennt das Taxi-Gewerbe ausdruecklich als zu schuetzendes Verkehrsangebot (Z. 4825).
- Unter Bezugnahme auf das OePNVG M-V definiert der NVP Taxen als Teil des OePNV (Z. 1435).
- In acht von acht systematisch geprueften Vorgaben weicht die Praxis Linie 290/291 von den eigenen Plansoll-Vorgaben ab.
- Wir vermuten, dass eine Pruefung nach § 13 PBefG der Auswirkungen auf das Taxi-Gewerbe weder bei der Erstgenehmigung 2017 noch beim Betreiberwechsel 2025 durchgefuehrt wurde.
- Unser Gewerbe traegt nach §§ 21, 22 PBefG Bereitschafts- und Befoerderungspflicht, behoerdlich festgesetzte Tarife (§ 51 PBefG) und das volle wirtschaftliche Risiko — waehrend der Bus subventioniert wird, ohne diese Pflichten zu tragen.

RECHTSPRECHUNG
- BVerwG, Urt. v. 28.07.2021, 8 C 33.20: Funktionsfaehigkeit des oertlichen Taxengewerbes darf durch konkurrierende Verkehrsangebote nicht gefaehrdet werden.
- VG Leipzig, Urt. v. 15.11.2024: Funktionsfaehigkeit des Taxi-Gewerbes als "in besonderer Weise wichtiges und schutzwuerdiges Gemeinschaftsgut".
- BVerfG: Taxen als unverzichtbarer Bestandteil der oeffentlichen Daseinsvorsorge.

BITTE UM EINSCHAETZUNG
Ich moechte Sie bitten zu pruefen, ob Ihre Kanzlei dieses Verfahren uebernehmen wuerde. Insbesondere interessiert mich Ihre Einschaetzung zu folgenden moeglichen Verfahrenswegen:

1. Informationsfreiheitsantraege an Landkreis Vorpommern-Greifswald (Bedarfsanalyse / § 13 PBefG-Pruefung beim Vertragswechsel 19.12.2025) und an das Landesamt fuer Strassenbau und Verkehr Mecklenburg-Vorpommern (Konzessions-Grundlage und Betreiberwechsel UBB -> VVG).
2. Beschwerde / Widerspruch wegen unterlassener § 13 PBefG-Pruefung.
3. ggf. Antrag auf Wiederaufgreifen der Konzessionsentscheidung nach § 19 PBefG.
4. ggf. Verpflichtungsklage vor dem Verwaltungsgericht Greifswald.

Ueber eine kurze telefonische Ruecksprache und einen Erst-Termin zur Mandatsklaerung wuerde ich mich freuen. Falls Ihre Kanzlei den Schwerpunkt nicht abdeckt, waere ich fuer einen Hinweis auf eine geeignete Empfehlung dankbar.

Mit freundlichen Gruessen
Patrick Wydra
Funk-Taxi Heringsdorf
Tel. 038378 / 22022
taxiwydra@googlemail.com

Anlagen:
1. Memo vom 25.06.2026: "NVP 2017-2027 vs. Realitaet Linie 290/291" (umfassende Belegtafel)
2. Faktentafel vom 05.06.2026: "Kurkartenbus / VVG / Kaiserbaederlinie" (Akteure, Vertragslage, Chronologie)
`;

const ATTACHMENTS = [
    {
        filename: '2026-06-25_Memo_RA_Hornburg_NVP_vs_Realitaet_290_291.pdf',
        path: 'C:/Taxi App/taxi-App-github/briefe/pdf/2026-06-25_Memo_RA_Hornburg_NVP_vs_Realitaet_290_291.pdf',
    },
    {
        filename: '2026-06-05_Faktentafel_Kurkartenbus.pdf',
        path: 'C:/Taxi App/taxi-App-github/briefe/pdf/2026-06-05_Faktentafel_Kurkartenbus_Weigel.pdf',
    },
];

(async () => {
    if (!process.env.GMAIL_PASS) {
        console.error('GMAIL_PASS Env-Var fehlt');
        process.exit(1);
    }
    const t = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
    });
    try {
        const info = await t.sendMail({
            from: FROM, to: TO, subject: SUBJECT, text: BODY, attachments: ATTACHMENTS,
        });
        console.log('OK -', info.messageId);
    } catch (e) {
        console.error('FEHLER:', e.message);
        process.exit(1);
    }
})();
