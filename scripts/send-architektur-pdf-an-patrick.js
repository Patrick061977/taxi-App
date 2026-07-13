const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const path = require('path');
const fs = require('fs');
// .env manuell lesen (kein dotenv-Modul verfügbar in scripts)
const envPath = 'C:/Taxi App/taxi-App-github/.env';
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [k, ...v] = line.trim().split('=');
        if (k && v.length) process.env[k.trim()] = v.join('=').trim();
    });
}

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

const pdfPath = 'C:/Taxi App/taxi-App-github/briefe/pdf/android-app-architektur.pdf';

(async () => {
    const info = await transporter.sendMail({
        from: '"Funk Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: 'taxiwydra@googlemail.com',
        subject: 'Android App — Architektur & Funktionsbeschreibung (PDF)',
        text: `Hallo Patrick,

anbei die Funktionsbeschreibung der Android-Fahrer-App als PDF.

Enthält:
- Alle 17 Activities mit Funktionsbeschreibung
- 4 Foreground-Services
- 2 BroadcastReceiver
- 6 Capacitor-Plugins (AppUpdate, Notification, StatusBar, Splash, Camera, FCM)
- 7 externe Systeme (Firebase, Telegram, Cloud Functions, SMTP, Strato, GitHub)
- Datenfluss-Tabelle
- Build & Deploy Ablauf

Stand: 29.06.2026, v6.63.547

Gruß
Claude`,
        attachments: [{
            filename: 'Android-App-Architektur-2026-06-29.pdf',
            path: pdfPath,
            contentType: 'application/pdf',
        }],
    });
    console.log('✅ PDF versendet an taxiwydra@googlemail.com');
    console.log('Message-ID:', info.messageId);
})().catch(e => { console.error('❌ Fehler:', e.message); process.exit(1); });
