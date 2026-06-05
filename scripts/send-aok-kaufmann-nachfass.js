const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: 'tiajmwotmnltltkh' },
});

const body = `Sehr geehrte Frau Kaufmann,

ich versuche seit dem 28.05.2026 Frau Evelyn Bettin in der Sache des AOK-Vertragsangebots zur Krankenbeförderung ab 01.04.2026 zu erreichen. Mein Erinnerungsschreiben von heute Morgen hat eine Vertraulichkeits-Auto-Reply ihres Postfachs ausgelöst, weshalb ich mich nun zusätzlich an Sie als bekannten Kontakt aus dem Vertragsbereich der AOK Nordost wende und höflich um Weiterleitung an die zuständige Stelle bitte.

Es geht inhaltlich um zwei offene Fragen zum Vertragsangebot:

1. Ist es möglich, den Vertrag rückwirkend zum 01.04.2026 abzuschließen, oder beginnt der Vertrag bei einer jetzigen Unterzeichnung erst ab Eingang Ihrer Bestätigung?

2. Liegt zwischenzeitlich ein neueres Angebot vor, das ich vor einer Unterzeichnung berücksichtigen sollte? Hintergrund: die Kostenentwicklungen (Mindestlohn, Kraftstoff, Sachkosten) haben sich seit März weiter beschleunigt; das angebotene Kilometerentgelt von 2,10 EUR liegt aus unserer Sicht aktuell schon eher knapp.

Ich wäre für eine kurze Rückmeldung bis Ende dieser Woche dankbar, damit ich mein weiteres Vorgehen planen kann.

Vielen Dank fuer Ihre Muehe.

Mit freundlichen Gruessen

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
        subject: 'AOK-Vertragsangebot Krankenbefoerderung — Weiterleitung wegen Auto-Reply Frau Bettin',
        text: body,
    });
    console.log('Mail an Martina.Kaufmann@nordost.aok.de versendet');
    console.log('Message-ID:', info.messageId);
})().catch(e => { console.error('Fehler:', e.message); process.exit(1); });
