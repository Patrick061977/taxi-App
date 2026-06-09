// Klarstellung an RA Weigel: D-Ticket gilt auf 290/291 — aber Doppel-Zahlung — 24.05.2026
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrter Herr Rechtsanwalt Weigel,

ich darf eine Klarstellung zu meinen heutigen beiden Schreiben vom 24.05.2026 nachreichen. Bei der Recherche habe ich die Tarif-Lage auf der Linie 290/291 zu eng formuliert. Der tatsächliche Sachverhalt ist juristisch nicht „D-Ticket gilt nicht", sondern noch problematischer:

═══════════════════════════════════════════════════════════
KLARSTELLUNG — Linie 290/291: Doppel-Zahlung statt Ausschluss
═══════════════════════════════════════════════════════════

A) TATSÄCHLICHE TARIF-LAGE (laut praktischer Erfahrung):
   • Das Deutschland-Ticket GILT als Fahrausweis auf der Linie 290/291.
     Die Beförderung ist mit D-Ticket grundsätzlich möglich.
   • ALLERDINGS: Kurkartenpflichtige (Übernachtungsgäste) zahlen
     trotzdem den vollen Kurkartenbetrag — einschließlich der darin
     enthaltenen ÖPNV-/Bus-Pauschale (~40 ct/Tag, KAS § 4 Abs. 5).
   • Es findet KEINE Verrechnung, KEIN Abzug und KEIN Rabatt statt,
     wenn der Gast ein gültiges Deutschland-Ticket bereits besitzt.

B) DARAUS FOLGT EINE DOPPEL-FINANZIERUNG DESSELBEN ÖPNV:
   Ein Übernachtungsgast mit D-Ticket bezahlt für ein- und dieselbe
   Beförderungsleistung (Buslinie 290/291) zweifach:
   - 58,00 € pro Monat für das Deutschland-Ticket (Bundes-/Landestarif)
   - zusätzlich ~ 0,40 € pro Tag als nicht abwählbare Kurabgabe-
     Pauschale für genau diesen Bus

   Die Kurabgabe ist nach KAS § 1 Abs. 4 explizit „unabhängig davon
   zu zahlen, ob und in welchem Umfang die Einrichtungen, Anlagen
   und die Angebote tatsächlich genutzt bzw. in Anspruch genommen
   werden".

C) RECHTLICHE BEWERTUNG (zur Prüfung):
   1. Das Verbot der Doppel-Tarifierung auf derselben Linie
      (Tarifeinheitsgebot § 39 Abs. 3 PBefG) wird auf den Kopf
      gestellt: nicht zwei verschiedene Tarife für verschiedene
      Personenkreise auf derselben Linie, sondern ZWEI Tarife
      kumulativ für DIESELBE Person für DIESELBE Beförderung.
   2. Das Kostendeckungsprinzip des § 6 Abs. 1 KAG M-V verbietet
      eine Über-Deckung der besonderen Kosten der Gemeinde. Sofern
      über die Kurabgabe ein ÖPNV mit-finanziert wird, der dem Gast
      sowieso bereits über D-Ticket-Mittel (Regionalisierungsmittel
      + Bundes-Zuschuss) zur Verfügung steht, wird der gleiche
      Aufwand doppelt finanziert.
   3. Altmark-Trans-Kriterium Nr. 3 (Verbot Über-Kompensation):
      Wenn die VVG den Bus 290/291 sowohl aus Regionalisierungs-
      mitteln, aus dem D-Ticket-Ausgleichsfonds Bund+Land und
      zugleich aus der Kurabgabe der Gemeinde Heringsdorf finanziert
      erhält, läge eine drei-fache Kompensation vor.

D) DIES IST EXAKT SÄULE 11 IHRER ÜBERSICHT V14/V15:
   In meiner Eingabe vom 19./20.05.2026 hatte ich Säule 11 als
   „Doppel-Tarif-Verbot (§39 PBefG)" formuliert, dabei aber noch
   nicht die konkrete Praxis der parallelen Erhebung dokumentiert.
   Mit diesem Nachtrag ist der Beleg geliefert: D-Ticket-Inhaber
   zahlen real doppelt, ohne Möglichkeit zur Verrechnung.

E) MÖGLICHE PRÜFFRAGEN AN GEMEINDE / VVG:
   • Wieso wird einem nachweislichen D-Ticket-Inhaber die in der
     Kurabgabe enthaltene ÖPNV-Pauschale nicht abgezogen?
   • Auf welcher Rechtsgrundlage wird die Doppel-Zahlung für
     dieselbe Beförderungsleistung als zulässig angesehen?
   • Erhält die VVG für die Linie 290/291 sowohl
     Regionalisierungsmittel/D-Ticket-Ausgleich ALS AUCH den
     Kurabgabe-Anteil der Gemeinde Heringsdorf?
     Wenn ja: wie wird eine Über-Kompensation (Altmark-Krit. 3)
     ausgeschlossen?

═══════════════════════════════════════════════════════════

Bitte ergänzen Sie diese Klarstellung in Ihrer Bewertung; sie ersetzt die zu enge Formulierung „D-Ticket nicht gültig" in Anlage 5 Punkt B meines vorigen Schreibens vom heutigen Tag.

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
        subject: 'Klarstellung — Linie 290/291: D-Ticket gilt, ABER Doppel-Erhebung über Kurkarte (kein Abzug)',
        text: body,
    });
    console.log('MessageId:', info.messageId);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
