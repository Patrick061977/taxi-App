const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const body = `Hallo Herr Radziwill,

anbei die beiden Unterlagen für die Fahrzeuge:

  1) Genehmigungsurkunde (war bereits in meiner vorherigen Mail enthalten)
  2) Amtliche Berichtigungen und Ergänzungen zur Genehmigungsurkunde

Damit haben Sie alles auf dem aktuellen Stand.

Mit freundlichen Grüßen
Patrick Wydra

Funk Taxi Heringsdorf
Amselring 10
17424 Ostseebad Heringsdorf
Telefon: 038378 22022
Mobil:   0151 27585179
E-Mail:  taxiwydra@googlemail.com
`;

(async () => {
    const info = await transporter.sendMail({
        from: '"Patrick Wydra — Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'marco.radziwill@ed-nord.de',
        cc: 'taxiwydra@googlemail.com',
        subject: 'Genehmigungsurkunde + Berichtigungen Fahrzeuge — Funk Taxi Heringsdorf',
        text: body,
        attachments: [
            {
                filename: 'Genehmigungsurkunde-Funk-Taxi-Heringsdorf.pdf',
                path: 'C:/Users/Taxi/OneDrive/1.Taxi/Genehmigungsurkunde/29022024_Genehmigungsurkunde_002.pdf',
            },
            {
                filename: 'Amtliche-Berichtigungen-und-Ergaenzungen.pdf',
                path: 'C:/Users/Taxi/OneDrive/1.Taxi/Genehmigungsurkunde/20032025_.Amtliche Berichtigungen und Ergänzungen.pdf',
            },
        ],
    });
    console.log('✅ Beide PDFs an Marco Radziwill gesendet');
    console.log('   Message-ID:', info.messageId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
