#!/usr/bin/env node
// scan-unknown-invoice-senders.js — Patrick (21.05. 20:04):
// Generischer Postfach-Scan nach Rechnungs-Mails 2025+2026 von Sendern die NICHT
// in der bekannten Liste sind. Output: CSV mit Funden zum Reviewen.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/_unbekannte-sender';
fs.mkdirSync(OUT_DIR, { recursive: true });
const CSV_FILE = path.join(OUT_DIR, '_unknown-senders-scan.csv');
const SINCE = new Date('2025-01-01');

// Schon-gescannte Sender — KEIN scan dafür (haben wir schon)
const KNOWN_SENDERS = [
    'microsoft.com', 'microsoftstore.com',
    'github.com',
    'anthropic.com',
    'openai.com',
    'apple.com', 'email.apple.com',
    'teslafi.com',
    'telekom.de', 't-online.de', 'telekom-kundenservice.de',
    'strato.de', 'strato.com',
    'vodafone.de',
    'vko-partner.de',
    'ecovis.com',
    'datev.de', 'uploadmail.datev.de',
    'autodoc.de',
    'atu.de',
    'paypal.de', 'paypal.com',
    'stripe.com',
    'cloudflare.com',
    'amazon.com', 'aws.amazon.com',
    'firebase.google.com', 'firebaseapp.com',
    'heise.de', 'heisezs.mail.onmicrosoft.com',
    'adobe.com',
    'google.com', 'googleplay-noreply', 'googleone-noreply', 'payments-noreply',
    'guido.wendlandt@arcor.de',
    'taxiwydra@', // eigene Mails
    'gurufocus.com', 'barchart.com', 'substack.com', 'earningswhispers.com',
    'noreply@audible.de',
    'amazon.de', // Bestellbestätigungen — separat behandeln
];

function isKnownSender(addr) {
    const lc = (addr || '').toLowerCase();
    return KNOWN_SENDERS.some(k => lc.includes(k));
}

function isInvoiceLike(subject, hasPdf) {
    const s = (subject || '').toLowerCase();
    return s.includes('rechnung') || s.includes('invoice') || s.includes('quittung')
        || s.includes('beleg') || s.includes('zahlung') || s.includes('lastschrift')
        || s.includes('bestätig') || s.includes('mahnung') || s.includes('abrechnung')
        || s.includes('zahlungsbestätigung') || s.includes('faktura')
        || (hasPdf && (s.includes('bestellung') || s.includes('order')));
}

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const allUids = await client.search({ since: SINCE });
    console.log(`[Scan] ${allUids.length} Mails seit 2025-01-01 zum Durchsuchen`);

    const rows = [];
    rows.push(['Datum','Sender','Sender-Domain','Subject','PDFAnzahl','PDFNamen','BetragErkannt'].join(';'));
    const senderStats = {};  // sender → { count, hasPdfCount, pdfFiles[] }
    let processed = 0, matched = 0;

    for (const uid of allUids) {
        processed++;
        if (processed % 500 === 0) console.log(`  ... ${processed}/${allUids.length} processed, ${matched} unknown invoice-like found`);
        let msg;
        try {
            msg = await client.fetchOne(uid, { envelope: true, internalDate: true, bodyStructure: true });
        } catch { continue; }
        const subject = msg.envelope?.subject || '';
        const from = msg.envelope?.from?.[0]?.address || '';
        if (!from) continue;
        if (isKnownSender(from)) continue;

        // Hat PDF-Anhang?
        let hasPdf = false;
        const pdfNames = [];
        const walk = (node) => {
            if (!node) return;
            const fn = node.dispositionParameters?.filename || node.parameters?.name || '';
            const mt = (node.type || '') + '/' + (node.subtype || '');
            if (mt.includes('pdf') || fn.toLowerCase().endsWith('.pdf')) {
                hasPdf = true;
                if (fn) pdfNames.push(fn);
            }
            if (node.childNodes) node.childNodes.forEach(walk);
        };
        walk(msg.bodyStructure);

        const invoiceLike = isInvoiceLike(subject, hasPdf);
        if (!hasPdf && !invoiceLike) continue;  // nur Rechnungs-Verdacht
        matched++;

        const dateISO = msg.internalDate?.toISOString().slice(0, 10) || '';
        const domain = from.split('@')[1] || '';
        // Track
        if (!senderStats[from]) senderStats[from] = { count: 0, hasPdfCount: 0, subjects: new Set() };
        senderStats[from].count++;
        if (hasPdf) senderStats[from].hasPdfCount++;
        senderStats[from].subjects.add(subject.slice(0, 80));

        rows.push([dateISO, from, domain, subject.slice(0, 100), pdfNames.length, pdfNames.join(' | '), '']
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }

    fs.writeFileSync(CSV_FILE, '﻿' + rows.join('\r\n'));
    console.log(`\n[Scan] FERTIG — ${processed} Mails durchsucht, ${matched} verdächtige (unbekannte Sender)`);
    console.log(`[Scan] CSV: ${CSV_FILE}`);

    // Top-Sender-Übersicht
    const topSenders = Object.entries(senderStats)
        .sort((a,b) => b[1].count - a[1].count)
        .slice(0, 40);
    console.log('\n=== TOP-40 UNBEKANNTE RECHNUNGS-VERDACHTS-SENDER ===');
    for (const [s, info] of topSenders) {
        console.log(`  ${info.count.toString().padStart(3)} (${info.hasPdfCount} mit PDF): ${s}`);
    }

    // Speichern auch als JSON
    const statsFile = path.join(OUT_DIR, '_sender-stats.json');
    fs.writeFileSync(statsFile, JSON.stringify(
        Object.fromEntries(Object.entries(senderStats).map(([k, v]) => [k, {count: v.count, hasPdfCount: v.hasPdfCount, subjects: [...v.subjects]}]))
        , null, 2
    ));
    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
