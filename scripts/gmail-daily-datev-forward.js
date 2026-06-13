#!/usr/bin/env node
// gmail-daily-datev-forward.js — Patrick (29.05.2026 13:26 "Go Mail forward"):
// Gmail-Rechnungen (taxiwydra@googlemail.com) einmal täglich an DATEV-Belegtransfer
// weiterleiten. Spiegelt gmx-daily-datev-forward.js für das Gmail-Postfach.
//
// Beide Postfächer (GMX + Gmail) haben getrennte state-Files damit Duplikat-Schutz
// pro Quelle wirkt.
//
// Default: DRY-RUN. Mit --apply: tatsächlich an DATEV mailen.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');
const { pickDatevTarget } = require('./lib/datev-routing');

const STATE_FILE = path.join(__dirname, '..', '.gmail-datev-state.json');
const ONEDRIVE_GMX_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/_Gmail-Eingang';
// v6.63.315 (Patrick 13.06.2026): 5-Postfach-Routing — siehe scripts/lib/datev-routing.js
// v6.63.253 (Patrick 09.06.): Bons/Kassenbelege analog zum GMX-Pendant.
const SUBJ_REGEX = /rechnung|invoice|beleg|quittung|abrechnung|fakturen?|ebon|kassenbon|kaufbeleg|bonbeleg/i;
const SUBJ_NEGATIVE = /taxiabrechnung|tagesumsatz|arbeitszeit|wichtiger hinweis|service-erlaubnis|auto-gmx|datev|forward|uploadmail/i;
// Skip: alle DATEV-Bestätigungen + Forwards aus dem eigenen Postfach + bekannte Skip-Lieferanten
const SKIP_DOMAINS = new Set([
    'paypal.de', 'interactivebrokers.com', 'adobe.com',
    'belege.lexware.de', 'lexware.de',
    'uploadmail.datev.de',                  // DATEV-Bestätigungen ignorieren
    'googlemail.com', 'gmail.com',          // eigene Auto-GMX-Forwards ignorieren
    'taxiwydra@gmx.de'
]);
// Patrick 05.06.2026 09:28 — Default: nur Mails vom Vortag (Berlin)
// weiterleiten, sonst doppelter Versand. Override per BACKFILL_DAYS/SINCE_DATE.
const BACKFILL_DAYS = parseInt(process.env.BACKFILL_DAYS || '2', 10);
const SINCE_OVERRIDE = process.env.SINCE_DATE ? new Date(process.env.SINCE_DATE) : null;
const ONLY_YESTERDAY = !process.env.BACKFILL_DAYS && !process.env.SINCE_DATE;

function yesterdayBerlinISO() {
    const now = new Date();
    const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    berlin.setDate(berlin.getDate() - 1);
    return berlin.toISOString().slice(0, 10);
}
const YESTERDAY_ISO = yesterdayBerlinISO();

function pdfHash(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

function sanitize(s) { return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80); }

const APPLY = process.argv.includes('--apply');
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { sentKeys: {}, sentHashes: {}, sentFromFile: {} };
    try {
        const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        s.sentKeys = s.sentKeys || {};
        s.sentHashes = s.sentHashes || {};
        s.sentFromFile = s.sentFromFile || {};
        return s;
    } catch { return { sentKeys: {}, sentHashes: {}, sentFromFile: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

(async () => {
    LOG(APPLY ? '🚀 APPLY — Mails werden an DATEV gesendet' : '🔍 DRY-RUN — zeigt nur, sendet nicht');

    const state = loadState();
    const imap = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
        logger: false
    });
    await imap.connect();
    await imap.mailboxOpen('INBOX');
    LOG('Gmail INBOX geöffnet');

    const since = SINCE_OVERRIDE || new Date(Date.now() - BACKFILL_DAYS * 86400000);
    const uids = await imap.search({ since });
    LOG(`${uids.length} Mails seit ${since.toISOString().slice(0, 10)} ${ONLY_YESTERDAY ? `(Filter aktiv: nur Mail-Date == ${YESTERDAY_ISO} Berlin)` : '(Backfill-Mode)'}`);

    const transporter = APPLY ? nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }
    }) : null;

    let sent = 0, skippedDup = 0, skippedNoMatch = 0, skippedSkipDomain = 0, skippedNoPdf = 0, skippedNotYesterday = 0, skippedHashDup = 0, skippedFromFileDup = 0;
    const candidates = [];

    for (const uid of uids) {
        const m = await imap.fetchOne(uid, { source: true, envelope: true });
        if (!m?.source) continue;
        const p = await simpleParser(m.source);
        const fromAddr = (p.from?.value?.[0]?.address || '').toLowerCase();
        const fromDomain = fromAddr.split('@')[1] || '';
        const subject = p.subject || '';

        if (SKIP_DOMAINS.has(fromDomain)) { skippedSkipDomain++; continue; }
        if (!SUBJ_REGEX.test(subject)) { skippedNoMatch++; continue; }
        if (SUBJ_NEGATIVE.test(subject)) { skippedNoMatch++; continue; }
        const pdfs = (p.attachments || []).filter(a => /pdf/i.test(a.contentType || a.filename || ''));
        if (pdfs.length === 0) { skippedNoPdf++; continue; }

        const dateISO = (p.date || new Date()).toISOString().slice(0, 10);
        // Patrick 05.06.2026 09:28 — Default: nur gestern
        if (ONLY_YESTERDAY && dateISO !== YESTERDAY_ISO) { skippedNotYesterday++; continue; }
        const yearMonth = dateISO.slice(0, 7);
        const targetDir = path.join(ONEDRIVE_GMX_ROOT, yearMonth);

        for (const att of pdfs) {
            const filename = att.filename || `gmx-${uid}.pdf`;
            const localName = `${dateISO}_uid${uid}_${sanitize(filename)}`;
            const localPath = path.join(targetDir, localName);
            const key = `gmail:${uid}:${filename}`;
            const fromFileKey = `${fromAddr}:${filename}`;
            const hash = pdfHash(att.content);

            // Triple-Check Dedupe
            if (state.sentKeys[key]) { skippedDup++; continue; }
            if (state.sentHashes[hash]) { skippedHashDup++; LOG(`⚠️  Hash-Dup ${fromAddr} ${filename} (war: ${state.sentHashes[hash].key || '?'})`); continue; }
            if (state.sentFromFile[fromFileKey]) { skippedFromFileDup++; LOG(`⚠️  From+File-Dup ${fromAddr} ${filename}`); continue; }

            // v6.63.315: Routing pro Beleg (5 Postfaecher)
            const bodyText = (p.text || p.html || '').slice(0, 5000);
            const target = pickDatevTarget({ fromAddr, fromDomain, subject, body: bodyText });

            candidates.push({ uid, fromAddr, subject, filename, localPath, size: att.content.length, date: p.date, key, fromFileKey, hash, target });

            if (APPLY) {
                try {
                    fs.mkdirSync(targetDir, { recursive: true });
                    if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, att.content);

                    const info = await transporter.sendMail({
                        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
                        to: target.email,
                        subject: `[Auto-Gmail/${target.key}] ${fromAddr} — ${subject.slice(0, 60)}`,
                        text: `Auto-Forward aus taxiwydra@googlemail.com\n\nRouting: ${target.label} (${target.reason})\nVon: ${fromAddr}\nBetreff: ${subject}\nDatum: ${p.date?.toISOString() || '?'}\nAnhang: ${filename} (${Math.round(att.content.length / 1024)} KB)\nLokal: ${localPath}\n\nGesendet via scripts/gmail-daily-datev-forward.js`,
                        attachments: [{ filename, path: localPath, contentType: 'application/pdf' }]
                    });
                    const meta = { sentAt: Date.now(), messageId: info.messageId, from: fromAddr, subject: subject.slice(0, 200), localPath, key, datevTarget: target.key };
                    state.sentKeys[key] = meta;
                    state.sentHashes[hash] = meta;
                    state.sentFromFile[fromFileKey] = meta;
                    sent++;
                    LOG(`✅ [${sent}] ${fromAddr} → ${target.label} (${target.reason})`);
                    await new Promise(r => setTimeout(r, 1100)); // SMTP rate limit
                } catch (e) {
                    LOG(`❌ ${fromAddr} ${filename}: ${e.message.slice(0, 80)}`);
                }
            }
        }
    }

    if (APPLY) saveState(state);
    await imap.logout();

    LOG('\n=== ERGEBNIS ===');
    LOG(`Kandidaten gefunden: ${candidates.length}`);
    LOG(`Gesendet: ${sent}`);
    LOG(`Schon gesendet (dup): ${skippedDup}`);
    LOG(`Subject kein Match: ${skippedNoMatch}`);
    LOG(`Skip-Domain: ${skippedSkipDomain}`);
    LOG(`Keine PDFs: ${skippedNoPdf}`);
    if (!APPLY && candidates.length) {
        LOG('\n--- WAS WIRD GESENDET (DRY-RUN) ---');
        candidates.slice(0, 30).forEach((c, i) => {
            LOG(`  ${i + 1}. ${c.target.label.padEnd(14)} uid=${c.uid} ${c.fromAddr.padEnd(35)} ${c.filename.slice(0, 30)} (${Math.round(c.size / 1024)}KB)`);
            LOG(`     "${c.subject.slice(0, 80)}"`);
        });
        if (candidates.length > 30) LOG(`  ... + ${candidates.length - 30} weitere`);
        const byTarget = candidates.reduce((acc, c) => { acc[c.target.label] = (acc[c.target.label] || 0) + 1; return acc; }, {});
        LOG('\n--- ROUTING-SUMMARY ---');
        for (const [label, count] of Object.entries(byTarget)) LOG(`  ${label}: ${count}`);
    }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
