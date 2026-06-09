// Nachtrag an RA Weigel: ILSE-Bus-Inkonsistenz — 24.05.2026
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Sehr geehrter Herr Rechtsanwalt Weigel,

als kurzer Nachtrag zu meinem heutigen Schreiben („Kurkarten/ÖPNV-Sache: Chronologische Übersicht + Recherche-Update 24.05.2026") darf ich noch einen weiteren Vergleichspunkt anfügen, der die ÖPNV-Frage zusätzlich zuspitzt:

═══════════════════════════════════════════════════════════
NACHTRAG — ILSE-BUS (VVG-Rufbus) auf Usedom ab 05.01.2026
═══════════════════════════════════════════════════════════

Die VVG betreibt seit dem 05.01.2026 zusätzlich zur Kaiserbäder-Linie 290/291 ein neues Rufbus-System namens „Ilse" (ilse-bus.de). Der Ilse-Bus operiert ohne festen Linienverlauf und Fahrplan, vermittelt Fahrten flexibel auf telefonische Bestellung in einem definierten Bediengebiet — also funktional ähnlich einem Anruf-Sammel-Taxi.

A) OFFIZIELLE TARIF-EINORDNUNG (VVG / ilse-bus.de):
   „Im ILSE-Bus gelten die Fahrpreise nach Ilse-Tarif.
   Dieser Tarif ist angelehnt an den ÖPNV-Tarif."

   → VVG ordnet den Ilse-Bus damit ausdrücklich als ÖPNV ein.

B) KURKARTE UND DEUTSCHLAND-TICKET BEIM ILSE-BUS:
   In der Gemeinde Kaiserbäder gilt für den ILSE-Bus laut VVG-Auskunft:
   • Kaiserbäder-Kurkarte → kostenlose Nutzung
   • Deutschland-Ticket → ebenfalls kostenlose Nutzung

   → Beim Ilse-Bus akzeptiert die Gemeinde beide Tickets parallel.

C) DIREKTER VERGLEICH ZUR LINIE 290/291:

   Merkmal             ILSE-Bus              Linie 290/291
   ─────────────────   ───────────────────   ──────────────────────────
   Betreiber           VVG                   VVG (ab 01.01.2026)
   Bediengebiet        Insel Usedom          Insel Usedom (Kaiserbäder)
   Finanzierung        Kurabgabe-anteilig    Kurabgabe-anteilig
   Selbst-Klassifik.   ÖPNV (lt. VVG)        „kein ÖPNV" (lt. Nagy 8.9.2025)
   Kurkarte            kostenlos             kostenlos
   Deutschland-Ticket  GÜLTIG                NICHT GÜLTIG (UBB-Tarif 3.4.3)
   Tarif               Ilse-Tarif (ÖPNV)     Sondertarif Kaiserbäder-Europa-Linie

   → Bei identischem Betreiber, identischer Finanzierungsquelle, identischem
     Gebiet und identischer Gemeinde-Kurkarte werden zwei Bus-Leistungen
     bewusst tarifrechtlich unterschiedlich behandelt.

D) DARAUS ABLEITBAR:
   1. Die Gemeinde HAT die technische und rechtliche Möglichkeit,
      das Deutschland-Ticket auf einer kurkarten-finanzierten Bus-Leistung
      gleichzeitig anzuerkennen (Ilse-Bus = Beweis).
   2. Sie WÄHLT diese Möglichkeit bei der Linie 290/291 ausdrücklich NICHT.
   3. Die Begründung Herrn Nagys („290/291 ist kein ÖPNV, daher gilt
      D-Ticket nicht") wird durch die parallele Behandlung des Ilse-Busses
      (auch kurkartenfinanziert, aber ÖPNV + D-Ticket gültig) konterkariert.

E) MÖGLICHE PRÜFFRAGEN FÜR EIN ANSCHREIBEN AN VVG / GEMEINDE:
   • Warum gelten beim Ilse-Bus Kurkarte UND D-Ticket parallel, bei
     der Linie 290/291 hingegen nur die Kurkarte?
   • Auf welcher Rechtsgrundlage beruht diese Differenzierung?
   • Hat die Genehmigungsbehörde (LAiV) die unterschiedliche
     Tariflehre der beiden Linien geprüft / genehmigt?
   • Wird der Ilse-Bus aus derselben 40-Cent-Pauschale der Kurabgabe
     mitfinanziert wie die Linie 290/291 — oder gibt es eine
     Kostenseparierung?

═══════════════════════════════════════════════════════════

Quelle dieses Befunds:
• https://ilse-bus.de/
• https://vvg-bus.de/neu-ilse-bus-auf-usedom-ab-05-01-2026/
• Pressemitteilung VVG / moin.de zur Inbetriebnahme 05.01.2026

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
        subject: 'Kurz-Nachtrag — ILSE-Bus (VVG-Rufbus) als ÖPNV anerkannt, D-Ticket gültig; Inkonsistenz zur Linie 290/291',
        text: body,
    });
    console.log('MessageId:', info.messageId);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
