#!/usr/bin/env node
// export-ausgangsrechnungen.js — Patrick (21.05.2026): zieht alle Ausgangsrechnungen aus
// Gmail [Gmail]/Gesendet (Mails wo Patrick eine Rechnung als PDF an Kunden geschickt hat),
// speichert PDFs in OneDrive/5.Buchführung/Rechnungsausgang/{Jahr}/, baut CSV-Übersicht.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = 'taxiwydra@googlemail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;
const OUT_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungsausgang';
const CSV_FILE = path.join(OUT_ROOT, '_ausgangsrechnungen.csv');
const SINCE = new Date('2025-01-01');

(async () => {
    const client = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS }, logger: false,
    });
    await client.connect();
    // Gmail-Sent: '[Gmail]/Gesendet' für DE-Locale, alternativ '[Gmail]/Sent Mail'
    // ImapFlow versteht auch 'X-GM-LABELS' — sicherheitshalber via list
    const list = await client.list();
    const sentBox = list.find(b => b.specialUse === '\\Sent')?.path || '[Gmail]/Gesendet';
    console.log('[Sent] Box:', sentBox);
    await client.mailboxOpen(sentBox);

    // Suche: alle Mails seit 2025 die "Rechnung" oder "20-25-" oder "20-26-" im Subject haben
    // Plus die schon ans DATEV-Upload gegangen sind (= bereits gepushte Ausgangsrechnungen)
    const uidsBySubject = await client.search({
        since: SINCE,
        or: [
            { subject: 'Rechnung' },
            { subject: '20-25-' },
            { subject: '20-26-' },
            { subject: 'Funk-Taxi' },
        ],
    });
    console.log('[Search] ' + uidsBySubject.length + ' Treffer mit Rechnungs-Subject');

    // Dedupe
    const uids = [...new Set(uidsBySubject)];

    const rows = [];
    rows.push(['Datum', 'RechnungsNr', 'Empfaenger-Email', 'Empfaenger-Name', 'Subject', 'PDFAnzahl', 'PDFDatei', 'BetragVorbestellt', 'Year'].join(';'));
    let downloaded = 0, skippedNoPdf = 0, skippedAuto = 0;

    for (let i = 0; i < uids.length; i++) {
        const uid = uids[i];
        let msg;
        try {
            msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        } catch (e) {
            console.warn('[Skip UID ' + uid + '] fetch:', e.message);
            continue;
        }
        const dateISO = msg.internalDate?.toISOString();
        const subject = msg.envelope?.subject || '';
        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const toAddrs = (msg.envelope?.to || []).map(t => t.address).filter(Boolean);

        // SKIP: Mails die nicht VON Patrick gesendet wurden
        if (!fromAddr || !fromAddr.toLowerCase().includes('taxiwydra')) {
            continue;
        }
        // SKIP: Auto-Forward-Mails ans DATEV-Upload (wir wollen die ORIGINAL-Mail an Kunden)
        if (toAddrs.some(a => a.includes('uploadmail.datev.de'))) {
            skippedAuto++;
            continue;
        }

        // Rechnungs-Nr aus Subject extrahieren (20-25-XXX oder 20-26-XXX)
        let reNr = '';
        const m = subject.match(/(20-2[5-6]-\d{3,5})/);
        if (m) reNr = m[1];

        const parsed = await simpleParser(msg.source);
        const pdfs = (parsed.attachments || []).filter(a =>
            a.contentType === 'application/pdf' ||
            (a.filename || '').toLowerCase().endsWith('.pdf')
        );

        // Empfänger-Name aus mailparser-Hilfen
        const toFullList = parsed.to?.value || [];
        const toName = toFullList[0]?.name || '';
        const toEmail = toFullList[0]?.address || toAddrs[0] || '';

        if (pdfs.length === 0) {
            skippedNoPdf++;
            // Trotzdem in CSV als 'Mail ohne PDF' eintragen (kann interessant sein)
            rows.push(['', reNr, toEmail, toName, subject, 0, '', '', dateISO?.slice(0,4) || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
            continue;
        }

        // SPEICHERN
        const year = (dateISO || '2025').slice(0, 4);
        const outDir = path.join(OUT_ROOT, year);
        fs.mkdirSync(outDir, { recursive: true });
        const pdfFilenames = [];
        for (const att of pdfs) {
            const dateForFn = (dateISO || '').slice(0, 10);
            const safeName = (att.filename || `ausgang-${dateForFn}-${reNr || 'uid' + uid}.pdf`)
                .replace(/[<>:"/\\|?*]/g, '_')
                .slice(0, 180);
            const dest = path.join(outDir, safeName);
            // Skip if same size already exists
            if (fs.existsSync(dest) && fs.statSync(dest).size === att.content.length) {
                pdfFilenames.push(safeName);
                continue;
            }
            fs.writeFileSync(dest, att.content);
            pdfFilenames.push(safeName);
            downloaded++;
        }
        rows.push([
            dateISO?.slice(0,10) || '',
            reNr,
            toEmail,
            toName,
            subject,
            pdfs.length,
            pdfFilenames.join(' | '),
            '',
            year,
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
        if ((i + 1) % 50 === 0) console.log(`  ... ${i+1}/${uids.length} processed, ${downloaded} PDFs runtergeladen`);
    }

    fs.writeFileSync(CSV_FILE, '﻿' + rows.join('\r\n'));
    console.log('\n[DONE] PDFs gespeichert: ' + downloaded);
    console.log('[DONE] Skipped (Mail ohne PDF): ' + skippedNoPdf);
    console.log('[DONE] Skipped (Auto-Forward DATEV): ' + skippedAuto);
    console.log('[DONE] CSV: ' + CSV_FILE);
    console.log('[DONE] CSV-Zeilen: ' + (rows.length - 1));

    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
