// Senden der Kurkarten/ÖPNV-Mail an RA Weigel (Kanzlei Anklam) — 24.05.2026
// Patrick (24.05. 18:42 Bridge): "Ja, schick ihm das mal alles."
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrter Herr Rechtsanwalt Weigel,

als Nachtrag zur Übersicht v14/v15 vom 19./20.05.2026 sende ich Ihnen die bisherige Korrespondenz mit Gemeinde Heringsdorf, Landkreis und Eigenbetrieb Kaiserbäder als chronologische Timeline (Teil 1) sowie eine Ansprechpartner-Liste (Teil 2). Anlagen 1–4 enthalten die wichtigsten Originalschreiben im Wortlaut.

Zusätzlich finden Sie in Anlage 5 den aktuellen Stand meiner heutigen Recherche (24.05.2026): die Gemeinde hat am 18.12.2025 eine neue Kurabgabesatzung beschlossen, und es gibt mehrere Widersprüche zwischen ihrer öffentlichen Darstellung und der Argumentation des Justiziars Nagy, die sich juristisch m. E. nutzen lassen.


═══════════════════════════════════════════════════════════
TIMELINE — Kurkarte/ÖPNV-Sache (Stand 24.05.2026)
═══════════════════════════════════════════════════════════

▶ 18.07.2025 — Patrick Wydra → Thomas Heilmann (Kurdirektor)
   Erstanfrage: Wie wird die Mobilitätsstruktur ab 2026 gestaltet?
   Drei Fragen: Kurkarten-Modell, Alternativen, Taxi-Kooperation.

▶ 21.07.2025 — Thomas Heilmann → Patrick Wydra (cc: Dirk Zabel/VVG, Hasselmann/Landkreis)
   Mitteilung des Kreistagsbeschlusses vom 07.07.2025:
   „ÖPNV ab 01.01.2026 durch die VVG. VVG prüft Rufbus-Konzept mit
   Einbindung ortsansässiger Taxiunternehmen. Integration ÖPNV in
   Kurabgabe bleibt auch über 31.12.2025 hinaus bestehen."
   → Volltext unten (Anlage 1)

▶ 21.07.2025 — Patrick Wydra → Heilmann
   Rückmeldung: Wettbewerbsrechtliche Problematik der kostenfreien
   Bus-Variante; konstruktiver Vorschlag eines Rufbus-Modells mit
   Taxi-Einbindung (Kamminke, Zirchow, Dargen, Bahnhof-Anschluss).

▶ 28.08.2025 — Patrick Wydra → Heilmann
   Ergänzende Klarstellung zum Busverkehr.

▶ 31.08.2025 — Patrick Wydra → Heilmann
   Konkrete Anfrage: Wurde bei Einführung des Kurkarten-Systems
   das Taxigewerbe einbezogen? Welche Stellen sind entscheidend?
   → Volltext unten (Anlage 2). Anstoß zur Nagy-Antwort.

▶ 08.09.2025 — Simon Nagy (Justiziar Gemeinde) → Patrick Wydra
   Ausführliche Begründung der ablehnenden Position der Gemeinde,
   gestützt auf:
   • § 11 Abs. 1a Nr. 2 KAG M-V (Kommunalabgabengesetz)
   • Zuständigkeit ÖPNV beim Landkreis Vorpommern-Greifswald
   • OVG-Greifswald-Rechtsprechung: faktisch nur Linienverkehr
     „gerichtsfest" kalkulierbar
   • Wirtschaftlichkeitsrechnung Nagys: ~200.000 €/Jahr Mehrkosten
     bei nur ~0,48 % Nutzer-Anteil der Übernachtungsgäste
   • Wörtlich: „Das haut uns das OVG um die Ohren."
   • Eingeständnis: faktische Wettbewerbsbeeinflussung, gerechtfertigt
     als Daseinsvorsorge/Tourismusförderung
   → Volltext unten (Anlage 3)

▶ 18.12.2025 — Gemeindevertretung Heringsdorf: Beschluss neue KAS 2026
   Veröffentlicht im Kaiserbäder-Boten Januar 2026.
   → siehe Anlage 5

▶ 24.02.2026 — Simon Nagy → Patrick Wydra
   Folge-Schreiben zur Kaiserbäderlinie 290/291 (Terminanfrage).
   → Volltext unten (Anlage 4)

▶ 19./20.05.2026 — Patrick Wydra → Kanzlei Anklam (Sie)
   Übersicht v14 + Nachtrag v15 mit 12 Säulen der rechtlichen Prüfung
   (incl. Säule 11 Doppel-Tarif-Verbot § 39 PBefG und Säule 12
   Triple-Subvention via D-Ticket / Altmark-Kriterium 3).


═══════════════════════════════════════════════════════════
ANSPRECHPARTNER & ZUSTÄNDIGKEITEN
═══════════════════════════════════════════════════════════

GEMEINDE OSTSEEBAD HERINGSDORF
─────────────────────────────────────────────────────────
• Simon Nagy — Justiziar (juristische Position der Gemeinde)
  simon.nagy@ahlbeck.de
  Kurparkstr. 4, 17419 Seebad Ahlbeck
  Tel.: 038378 / 25070

EIGENBETRIEB KAISERBÄDER (Kommunalbetrieb der Gemeinde)
─────────────────────────────────────────────────────────
• Thomas Heilmann — Kurdirektor (Eigenbetrieb)
  t.heilmann@kaiserbaeder-auf-usedom.de
  Waldstr. 1, 17429 Seebad Bansin
  Tel.: 038378 / 24420
  → Zuständig für Vergabe / Aufwand-Kalkulation Kurtaxe

LANDKREIS VORPOMMERN-GREIFSWALD (ÖPNV-Aufgabenträger)
─────────────────────────────────────────────────────────
• Jörg Hasselmann — joerg.hasselmann@kreis-vg.de
• Niklas Steffan — niklas.steffan@kreis-vg.de
• Robert Präfcke — robert.praefcke@kreis-vg.de
• Heike Käsler — heike.kaesler@kreis-vg.de
  → Zuständig für ÖPNV-Vergabe, Kreistagsbeschluss 07.07.2025

ÖPNV-BETREIBER ab 01.01.2026 (Operativ)
─────────────────────────────────────────────────────────
• Dirk Zabel — VVG-Bus
  dirk.zabel@vvg-bus.de
  → Operativer Busbetrieb, Rufbus-Konzept-Prüfung

WIRTSCHAFTSMINISTERIUM MECKLENBURG-VORPOMMERN
─────────────────────────────────────────────────────────
• T. Engel — t.engel@wm.mv-regierung.de
• J. Hammerschmidt — j.hammerschmidt@wm.mv-regierung.de
  → Aufsicht / Personenbeförderungsrecht

INTERESSENVERTRETUNG
─────────────────────────────────────────────────────────
• Landesverband Taxi- und Mietwagengewerbe M-V e.V.
  info@taxilandesverband-mv.de


═══════════════════════════════════════════════════════════
ANLAGE 1 — Heilmann an Wydra, 21.07.2025
═══════════════════════════════════════════════════════════
Von:     Thomas Heilmann <t.heilmann@kaiserbaeder-auf-usedom.de>
An:      Patrick Wydra <taxiwydra@googlemail.com>
Cc:      Dirk Zabel <dirk.zabel@vvg-bus.de>, joerg.hasselmann@kreis-vg.de
Datum:   21.07.2025
Betreff: Re: Anfrage zur Mobilitäts- und Kurkartenregelung im ÖPNV der Gemeinde Heringsdorf ab 2026

> Sehr geehrter Herr Wydra,
>
> gerne nehme ich Bezug auf unser Gespräch vom 3. Juli 2025.
>
> Am 7. Juli 2025 hat der Kreistag Vorpommern-Greifswald mehrheitlich beschlossen, dass der öffentliche Personennahverkehr (ÖPNV) ab dem 1. Januar 2026 durch die VVG betrieben wird.
>
> Bereits im Gespräch am 3. Juli hatte ich Sie darüber informiert, dass die VVG derzeit prüft, inwieweit ortsansässige Taxiunternehmen im Rahmen eines möglichen Rufbus-Konzepts eingebunden werden können.
>
> Ich gehe davon aus, dass die VVG nun – auf Grundlage des Kreistagsbeschlusses – in die konkrete Planungsphase eintritt. Zudem setze ich voraus, dass die Integration des ÖPNV in die Kurabgabe auch über den 31. Dezember 2025 hinaus fortgeführt wird.
>
> Mit freundlichen Grüßen
> Thomas Heilmann
> Kurdirektor
> Eigenbetrieb Kaiserbäder Insel Usedom, Waldstrasse 1, 17429 Seebad Bansin


═══════════════════════════════════════════════════════════
ANLAGE 2 — Wydra an Heilmann, 31.08.2025
═══════════════════════════════════════════════════════════
Von:     Patrick Wydra <taxiwydra@googlemail.com>
An:      Thomas Heilmann <t.heilmann@kaiserbaeder-auf-usedom.de>
Datum:   31.08.2025
Betreff: Einbindung des Taxigewerbes in das Kurkarten-Mobilitätssystem

> Sehr geehrter Herr Heilmann,
>
> im Zusammenhang mit dem Kurkarten-System stellt sich für mich die Frage, ob bei der Konzeption oder Weiterentwicklung auch an eine Einbindung des Taxigewerbes gedacht wurde.
>
> Wir sind ein fester Bestandteil der Mobilität vor Ort – insbesondere dort, wo Bus oder Bahn nicht flexibel genug sind. Eigentlich gehört es doch zusammen: ÖPNV und Taxi ergänzen sich, statt das Taxi zu verdrängen.
>
> Daher würde mich interessieren, ob es bei der Entscheidung zur Einführung des Kurkarten-Systems Überlegungen gab, auch das Taxigewerbe einzubeziehen – oder ob dieser Aspekt damals keine Rolle gespielt hat.
>
> Mit freundlichen Grüßen
> Patrick Wydra


═══════════════════════════════════════════════════════════
ANLAGE 3 — Nagy an Wydra, 08.09.2025 (Schlüsseldokument)
═══════════════════════════════════════════════════════════
Von:     Simon Nagy <simon.nagy@ahlbeck.de>
An:      Patrick Wydra <taxiwydra@googlemail.com>
Datum:   08.09.2025, 13:46 Uhr
Betreff: Einbindung des Taxigewerbes in das Kurkarten-Mobilitätssystem

> Sehr geehrter Herr Wydra,
>
> vielen Dank für Ihre Schreiben im vergangenen Jahr sowie Ihrer Korrespondenz mit unserem Kurdirektor Herrn Thomas Heilmann, zuletzt vom 31.08.2025, die mir vorliegt.
>
> Ich erlaube mir Ihnen mit dieser Mail ein wenig die Hintergründe der Einpreisung des ÖPNV in die Kurtaxe der Gemeinde zu erläutern und weshalb das Taxiunternehmen in diesem keine Berücksichtigung finden.
>
> Die juristische Grundlage für die Kurtaxe stellt folglich ein Aufwiegen gemeindlicher Kosten für den Tourismus dar. Gemäß § 11 Abs. 1a Nr. 2 Kommunalabgabengesetz M-V dürfen Gemeinden, die als Kur- oder Erholungsorte anerkannt sind, zur Deckung ihrer besonderen Kosten u.a. für die, gegebenenfalls auch im Rahmen eines überregionalen Verbundes, den Abgabepflichtigen eingeräumte Möglichkeit der kostenlosen oder ermäßigten Benutzung des öffentlichen Personennahverkehrs und anderer Angebote eine Kurabgabe erheben.
>
> Der ÖPNV wird ausschließlich in Verantwortung des Landkreises betrieben. Die Gemeinde kooperiert darüber hinaus mit einem Anbieter des ÖPNV (aktuell UBB), der eine zusätzliche Verbindung in Heringsdorf schafft. Diese Busse dienen ausschließlich dem Tourismus und können nur so in die Kurkarte einkalkuliert werden.
>
> Rechtlich bedeutet das, sollten man Taxen in die Kurabgabe einbinden, dass zunächst einer Ausschreibung durch die Gemeinde anstünde, die einen zusätzlichen Bedarf beziffert. Hierauf könnten sich auch polnische Taxen etc. bewerben. Anschließend müssten Sie dann eine Kapazität an Taxen zur Verfügung stellen, die einen rein touristischen Fahrdienst anbietet. Das kann faktisch, wie bisher in der Rechtsprechung des OVG ausgeurteilt, nur durch Linienverkehr sichergestellt werden. Dieses sensible Konstrukt ist Gegenstand etlicher Urteile seitens des OVG Greifswald.
>
> Doch selbst angenommen dies alles wäre denkbar und Sie „stockten Ihren Fahrzeugbestand" auf, böten eine solche Alternative — Kosten und Nutzen stünden hier kalkulatorisch außer Verhältnis. So würden sich die zusätzlichen Kosten bereits netto auf fast 200.000 Euro zusätzlich belaufen, die sich in sämtlichen Kurkarten real im zweistelligen Centbetrag niederschlagen würden, obgleich nur circa 0,48 Prozent der jährlichen Übernachtungsgäste Ihr Angebot in Anspruch genommen hätten.
>
> Ich drücke mich umgangssprachlich aus: Das haut uns das OVG um die Ohren.
>
> Der Gemeinde ist bewusst, faktisch den Wettbewerb damit zu beeinflussen. Es geht hierbei aber um die Wahrnehmung einer ureigenen Form der Daseinsvorsorge in M-V, der Tourismusförderung.
>
> Ich bedaure, Ihnen keine erfreulicheren Informationen zu übersenden. Insoweit fällt allerdings die Sicherung einer wettbewerblichen Stellung nicht in die Obliegenheit der Gemeinde.
>
> Für Rückfragen zur Verfügung stehend verbleibe ich mit freundlichen Grüßen
>
> Simon Nagy
> Justiziar
> Gemeinde Ostseebad Heringsdorf
> Kurparkstraße 4, 17419 Seebad Ahlbeck


═══════════════════════════════════════════════════════════
ANLAGE 4 — Nagy an Wydra, 24.02.2026
═══════════════════════════════════════════════════════════
Betreff: AW: Terminanfrage – Gespräch zur Kaiserbäderlinie 290/291
(Folge-Korrespondenz zur konkreten Linien-Diskussion 290/291 nach Inbetriebnahme VVG ab 01.01.2026. Volltext kann auf Anfrage gerne nachgereicht werden.)


═══════════════════════════════════════════════════════════
ANLAGE 5 — Aktueller Recherche-Stand 24.05.2026
═══════════════════════════════════════════════════════════

Eine heutige Recherche fördert mehrere Widersprüche und juristische Ansatzpunkte zutage, die ich Ihrer Prüfung anheimstelle:

A) NEUE KURABGABESATZUNG (KAS) 2026 — Beschluss 18.12.2025
   Quelle: Kaiserbäder-Bote Januar 2026
   https://www.gemeinde-ostseebad-heringsdorf.de/output/download.php?fid=3557.1098.1.PDF

   • Kurtagsätze 2026:
     - Hauptsaison 01.04.–31.10.: 3,70 €
     - Nebensaison 01.01.–31.03.: 2,90 €
     - Nov–Dez:                   3,00 €
     - Jahreskurabgabe:          103,60 €

   • § 1 Abs. 3 lit. d) KAS 2026 (Verwendungszweck):
     „... für die ... den Abgabepflichtigen eingeräumte Möglichkeit der
     kostenlosen oder ermäßigten Benutzung des öffentlichen
     Personennahverkehrs und anderer Angebote …"

   • Wörtlicher Verweis im Kaiserbäder-Boten Januar 2026:
     „In der Kurabgabe enthalten ist nach wie vor auch das Entgelt für
     die kostenfreie Nutzung des öffentlichen Personennahverkehrs,
     insbesondere des Busverkehrs innerhalb der Gemeinde."

B) WIDERSPRUCH zur NAGY-ARGUMENTATION
   Nagy (Anlage 3) bezeichnet die Buslinie 290/291 als
   „zusätzliche Verbindung ... Busse die ausschließlich dem Tourismus
   dienen" — also gerade NICHT als ÖPNV.

   Demgegenüber bezeichnet die Gemeinde in ihrer eigenen Satzung
   und der amtlichen Veröffentlichung im Kaiserbäder-Boten den über
   die Kurabgabe finanzierten Verkehr ausdrücklich als
   „öffentlichen Personennahverkehr".

   Daraus ergibt sich m. E. ein nicht auflösbares Entweder-Oder:
   - Ist 290/291 ÖPNV → § 39 PBefG (Tarifeinheit) muss gelten,
     Deutschland-Ticket muss anerkannt werden.
   - Ist 290/291 KEIN ÖPNV → § 11 Abs. 1a Nr. 2 KAG M-V trägt die
     Einpreisung in die Kurabgabe nicht; die anteilige Erhebung
     wäre unzulässig.

C) § 39 PBefG (Tarifeinheits- und Genehmigungsgebot)
   Wortlaut Abs. 3:
   „Die ... festgestellten Beförderungsentgelte ... sind gleichmäßig
   anzuwenden. Ermäßigungen sind nur zulässig, wenn sie unter
   gleichen Bedingungen jedermann zugute kommen. Alle anderen
   Ermäßigungen ... sind verboten und nichtig."

   Auf der Linie 290/291 gelten faktisch verschiedene Tarife:
   - Tourist ohne Kurkarte: Einzelfahrt 3,00 €
     (Sondertarif „Kaiserbäder-Europa-Linie" gem. UBB-Usedom-Tarif
     ab 01.01.2026, dort Ziff. 3.4.3)
   - Tourist mit Kurkarte: Pauschal-Entgelt aus Kurabgabe (40–60 ct)
   - Einwohner Heringsdorf: kostenfreie Jahreskurkarte (= 0 €)
   - Bis zu 4 nahe Verwandte: ebenfalls 0 € (max. 20 Tage/Jahr)
   - Deutschland-Ticket-Inhaber: D-Ticket gilt nach UBB-Tarifwerk auf
     diesem Sondertarif nicht; vollzahlend.

   Die Ermäßigung „Kurkarteninhaber" kommt nicht „jedermann" zugute,
   sondern nur Personen, die zuvor die Kurabgabe entrichtet haben.
   Sie ist damit nach Wortlaut des § 39 Abs. 3 PBefG anfechtbar.

   Zusätzlich Frage: hat die nach § 39 Abs. 1 PBefG zuständige
   Genehmigungsbehörde (in M-V regelmäßig das LAiV) den Sondertarif
   „Kaiserbäder-Europa-Linie 290/291" überhaupt formell genehmigt?

D) VERGLEICH ZINNOWITZ
   Zinnowitz hat seine Kurtaxe für 2026 von 4,20 € auf 3,70 €
   gesenkt. Begründung der Gemeinde Zinnowitz (Quelle:
   https://www.tageskarte.io/tourismus/detail/kurtaxen-check-2026-preisunterschiede-und-zahlreiche-erhoehungen-in-den-kommunen.html
   und https://www.nordkurier.de/regional/uckermark/doppelt-so-teuer-wie-zuvor-hier-muessen-ostsee-urlauber-jetzt-richtig-blechen-4389726):
   „Die Trennung des Busverkehrs der UBB von den Kurtaxen" sei der
   Grund für die Senkung. Bus-Kosten würden „separat abgerechnet".

   Damit ist auf derselben Insel und im selben Verkehrsverbund
   nachweisbar, dass eine Herausnahme des Bus-Aufwands aus der
   Kurabgabe rechtlich wie technisch möglich ist. Heringsdorf hat
   diesen Weg ausdrücklich NICHT gewählt und im Gegenteil die
   Kurabgabe von 3,30 € auf 3,70 € angehoben.

E) PILOT 2026: SCHIFFFAHRT IN DIE KURKARTE
   Lt. Kaiserbäder-Boten Januar 2026 beabsichtigt Heringsdorf, im
   Zeitraum 01.04.–31.10.2026 ein Hop-on-Hop-off-Schiffsangebot
   Bansin–Heringsdorf–Ahlbeck–Świnoujście in die Kurkarte zu
   integrieren (europaweite Ausschreibung im Januar 2026).
   → Weiterer subventionierter touristischer Verkehrsträger via
     Kurabgabe; das Taxigewerbe bleibt strukturell außen vor.

F) UBB-USEDOM-TARIF ab 01.01.2026
   Quelle: https://www.ubb-online.com/resource/blob/13761844/f69cd8952144d611470f92000bd653b8/260101_Usedom-Tarif-ab-1-Januar-2026-data.pdf
   • Ziff. 3.5.1: „Das Deutschland-Ticket wird im Usedom-Tarif anerkannt"
   • Ziff. 3.4.3: zugleich Sondertarif „Kaiserbäder-Europa-Linie 290/291"
     (DB Regio + VVG-Bus 290/291) mit eigenem Einzelfahrkarten-Tarif
   → Die parallel-Existenz beider Regelungen ist erklärungsbedürftig.

G) MÖGLICHE WEITERE STOSSRICHTUNGEN
   • IFG-Anträge an Landkreis VG (Kosten-Kalkulation Linie 290/291)
     und Gemeinde Heringsdorf (Kalkulation ÖPNV-Anteil Kurabgabe).
   • § 5 KAG M-V (Kostendeckungsprinzip / Verbot der Überdeckung).
   • Art. 7 VO (EG) 1370/2007 Veröffentlichungspflicht öffentlicher
     Dienstleistungsaufträge im ÖPNV.
   • Altmark-Trans-Kriterien (Über-Kompensation bei Bündel
     Regionalisierungsmittel + D-Ticket-Ausgleich + Kurabgabe).

═══════════════════════════════════════════════════════════

Falls Sie zu einem der genannten Punkte Originaldokumente in PDF-Form benötigen (Kaiserbäder-Bote als PDF, Heilmann-Schreiben im Original, UBB-Tarif-PDF, KAS-Beschluss 18.12.2025), lassen Sie es mich bitte wissen.

Mit freundlichen Grüßen

Patrick Wydra
Funk Taxi Heringsdorf
Amselring 10, 17424 Heringsdorf
Tel.: 038378 22022
Mobil: 0151 27585179
E-Mail: taxiwydra@googlemail.com`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'info@kanzleianklam.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Kurkarten/ÖPNV-Sache: Chronologische Übersicht + Recherche-Update 24.05.2026',
        text: body,
    });
    console.log('MessageId:', info.messageId);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
