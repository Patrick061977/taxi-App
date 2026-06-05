const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: 'tiajmwotmnltltkh' },
});

const body = `Sehr geehrte Frau Kaufmann,

ich melde mich, weil Frau Evelyn Bettin, mit der ich seit Ende März wegen des neuen AOK-Vertragsangebots zur Krankenbeförderung im Austausch stehe, laut Auto-Reply bis zum 08.06.2026 nicht erreichbar ist und auf Sie als Vertretung verweist. Damit Sie einen kurzen Überblick haben, fasse ich den Sachstand zusammen.

Hintergrund:
Am 27.03.2026 hat mir Frau Bettin (Evelyn.Bettin@nordost.aok.de, in Kopie Frau Leu) das neue Vertragsangebot der AOK Nordost zur Krankenbeförderung mit Wirkung ab 01.04.2026 zugesandt — Anschreiben mit Tarifblatt und Preisvereinbarung gehfähig, 2,10 €/km bis 03/2028. Wir betreiben das Funk Taxi Heringsdorf in Heringsdorf/Usedom.

Ich habe darauf am 28.05.2026 per E-Mail an Frau Bettin geantwortet und um Klärung zweier Punkte gebeten, bevor ich den Vertrag unterzeichne. Da ich keine Rückmeldung erhalten habe, habe ich heute Vormittag (05.06.2026) noch eine Erinnerung an Frau Bettin geschickt — daraufhin lief der Out-of-Office-Hinweis ein, der auf Sie verweist.

Meine beiden offenen Fragen — wörtlich aus meiner Mail vom 28.05.2026:

1. Ist es möglich, den Vertrag rückwirkend zum 01.04.2026 abzuschließen, oder ist die Frist zum 02.04.2026 bindend gewesen und der Vertrag startet jetzt ab Eingang Ihrer Bestätigung?

2. Gibt es zwischenzeitlich ein neueres oder verbessertes Angebot, das ich berücksichtigen sollte, bevor ich unterzeichne? Hintergrund: die allgemeinen Kostenentwicklungen (Mindestlohn, Sprit, Sachkosten) haben sich seit März weiter beschleunigt — gerade die Kilometerentgelte von 2,10 EUR liegen aus unserer Sicht aktuell schon eher knapp.

Falls Frau Bettins Postfach zur Bearbeitung weitergeleitet wird, hilft Ihnen folgender Such-Hinweis: Betreff "Re: Neues Vertragsangebot ab 01.04.2026 — Rückfrage zu Konditionen", abgesendet am 28.05.2026 von taxiwydra@googlemail.com an Evelyn.Bettin@nordost.aok.de.

Ich wäre Ihnen für eine kurze Rückmeldung — gern auch nur als Eingangsbestätigung oder Zwischenstand — bis Ende dieser Woche dankbar, damit ich mein weiteres Vorgehen planen kann.

Vielen Dank fuer Ihre Mühe und freundliche Grüße

Patrick Wydra

Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Telefon: 038378 22022
Mobil:   0151 27585179
E-Mail:  taxiwydra@googlemail.com`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra - Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'Martina.Kaufmann@nordost.aok.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'AOK-Vertragsangebot Krankenbeförderung ab 01.04.2026 — Vertretungsanfrage für Frau Bettin (Sachstand und 2 offene Fragen)',
        text: body,
    });
    console.log('Kontext-Mail an Martina.Kaufmann@nordost.aok.de versendet');
    console.log('Message-ID:', info.messageId);
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
