#!/usr/bin/env node
// import-invoices-imap.js — Patrick (21.05.2026): generisches Rechnungs-PDF-Importer.
// Durchsucht Gmail-Postfach taxiwydra@googlemail.com nach Rechnungs-Mails verschiedener Sender,
// extrahiert PDF-Anhänge, speichert nach OneDrive/5.Buchführung/Rechnungen/{Ordner}/{Jahr}/.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = 'taxiwydra@googlemail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;
const OUT_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen';
const SINCE = new Date('2025-01-01');

// Config: pro Sender-Domain ein Output-Ordner. Optional subject-Filter.
const SENDERS = [
    // Software-Abos (Geschäft)
    { name: 'Microsoft',  folder: 'Microsoft',  domains: ['microsoft.com', 'microsoftstore.com'] },
    { name: 'GitHub',     folder: 'GitHub',     domains: ['github.com'] },
    { name: 'Anthropic',  folder: 'Anthropic',  domains: ['anthropic.com'] },
    { name: 'OpenAI',     folder: 'OpenAI',     domains: ['openai.com'] },
    { name: 'Google-Pay', folder: 'Google',     domains: ['google.com'], subjectAny: ['Rechnung', 'invoice', 'receipt', 'Bestellbestätigung', 'Bestellung'] },
    { name: 'Apple',      folder: 'Apple',      domains: ['email.apple.com', 'apple.com'], subjectAny: ['Ihre Rechnung', 'Your receipt', 'Quittung', 'Receipt'] },
    { name: 'TeslaFi',    folder: 'TeslaFi',    domains: ['teslafi.com'] },
    // Telekommunikation / Hosting
    { name: 'Telekom',    folder: 'Telekom',    domains: ['telekom.de', 't-online.de', 'telekom-kundenservice.de'] },
    { name: 'STRATO',     folder: 'STRATO',     domains: ['strato.de', 'strato.com'] },
    { name: 'Vodafone',   folder: 'Vodafone',   domains: ['vodafone.de'] },
    // Steuerberatung
    { name: 'VKO',        folder: 'VKO',        domains: ['vko-partner.de'] },
    { name: 'ECOVIS',     folder: 'ECOVIS',     domains: ['ecovis.com'] },
    { name: 'DATEV',      folder: 'DATEV',      domains: ['datev.de'], subjectAny: ['Rechnung', 'invoice'] },
    // Kfz / Werkstatt
    { name: 'Autodoc',    folder: 'Autodoc',    domains: ['autodoc.de'] },
    { name: 'ATU',        folder: 'ATU',        domains: ['atu.de'] },
    // Banken / Karten
    { name: 'PayPal',     folder: 'PayPal',     domains: ['paypal.de', 'paypal.com'], subjectAny: ['Quittung', 'Receipt', 'Bestätigung', 'Rechnung'] },
    { name: 'Stripe',     folder: 'Stripe',     domains: ['stripe.com'], subjectAny: ['receipt', 'Rechnung', 'invoice'] },
    // Marketing / Hosting / weitere
    { name: 'Cloudflare', folder: 'Cloudflare', domains: ['cloudflare.com'] },
    { name: 'AWS',        folder: 'AWS',        domains: ['amazon.com', 'aws.amazon.com'], subjectAny: ['AWS', 'Web Services', 'invoice'] },
    { name: 'Firebase',   folder: 'Firebase',   domains: ['firebase.google.com', 'firebaseapp.com'] },
    { name: 'Heise',      folder: 'Heise',      domains: ['heise.de'] },
];

(async () => {
    const client = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS }, logger: false,
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    console.log('[Import] Connected, scanning ' + SENDERS.length + ' senders since 2025-01-01');

    const masterLog = [];
    for (const cfg of SENDERS) {
        console.log('\n=== ' + cfg.name + ' (' + cfg.domains.join(', ') + ') ===');
        // OR-Suche über mehrere Domains
        const query = cfg.domains.length === 1
            ? { from: cfg.domains[0], since: SINCE }
            : { since: SINCE, or: cfg.domains.map(d => ({ from: d })) };

        let uids;
        try {
            uids = await client.search(query);
        } catch (e) {
            console.warn('  [Search error]:', e.message);
            continue;
        }
        if (!uids || uids.length === 0) {
            console.log('  → keine Treffer');
            continue;
        }
        console.log('  ' + uids.length + ' Mails gefunden');

        let downloaded = 0;
        for (const uid of uids) {
            let msg;
            try {
                msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
            } catch (e) {
                console.warn('  [Fetch UID ' + uid + ']:', e.message);
                continue;
            }
            const dateISO = msg.internalDate?.toISOString();
            const subject = msg.envelope?.subject || '';
            const from = msg.envelope?.from?.[0]?.address || '';

            // Filter: subjectAny
            if (cfg.subjectAny && cfg.subjectAny.length > 0) {
                const lc = subject.toLowerCase();
                if (!cfg.subjectAny.some(s => lc.includes(s.toLowerCase()))) continue;
            }

            const parsed = await simpleParser(msg.source);
            const pdfs = (parsed.attachments || []).filter(a =>
                a.contentType === 'application/pdf' ||
                (a.filename || '').toLowerCase().endsWith('.pdf')
            );
            if (pdfs.length === 0) continue;

            const year = (dateISO || '2025').slice(0, 4);
            const outDir = path.join(OUT_ROOT, cfg.folder, year);
            fs.mkdirSync(outDir, { recursive: true });

            for (const att of pdfs) {
                const dateForFn = (dateISO || '').slice(0, 10);
                const safeName = (att.filename || `${cfg.folder}-${dateForFn}-uid${uid}.pdf`)
                    .replace(/[<>:"/\\|?*]/g, '_')
                    .slice(0, 180);
                const dest = path.join(outDir, safeName);
                // Skip if already exists with same size
                if (fs.existsSync(dest) && fs.statSync(dest).size === att.content.length) {
                    continue;
                }
                fs.writeFileSync(dest, att.content);
                downloaded++;
                masterLog.push({
                    sender: cfg.name, folder: cfg.folder, year,
                    date: dateISO, from, subject, filename: safeName, sizeBytes: att.content.length,
                    path: dest,
                });
                console.log('  [DL] ' + dateForFn + ' | ' + safeName);
            }
        }
        console.log('  → ' + downloaded + ' PDFs neu gespeichert');
    }

    // Master-Log schreiben
    const logFile = path.join(OUT_ROOT, '_import-log.json');
    fs.writeFileSync(logFile, JSON.stringify({
        fetchedAt: new Date().toISOString(),
        totalDownloaded: masterLog.length,
        entries: masterLog,
    }, null, 2));
    console.log('\n[Import] FERTIG: ' + masterLog.length + ' PDFs gesamt → Log: ' + logFile);

    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
