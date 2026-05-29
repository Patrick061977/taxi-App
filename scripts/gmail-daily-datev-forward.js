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
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const STATE_FILE = path.join(__dirname, '..', '.gmail-datev-state.json');
const ONEDRIVE_GMX_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/_Gmail-Eingang';
const DATEV_ADDR = 'e41e7435-8c6b-4078-a3d4-fd7a04a0c891@uploadmail.datev.de';
const SUBJ_REGEX = /rechnung|invoice|beleg|quittung|abrechnung|fakturen?/i;
const SUBJ_NEGATIVE = /taxiabrechnung|tagesumsatz|arbeitszeit|wichtiger hinweis|service-erlaubnis|auto-gmx|datev|forward|uploadmail/i;
// Skip: alle DATEV-Bestätigungen + Forwards aus dem eigenen Postfach + bekannte Skip-Lieferanten
const SKIP_DOMAINS = new Set([
    'paypal.de', 'interactivebrokers.com', 'adobe.com',
    'belege.lexware.de', 'lexware.de',
    'uploadmail.datev.de',                  // DATEV-Bestätigungen ignorieren
    'googlemail.com', 'gmail.com',          // eigene Auto-GMX-Forwards ignorieren
    'taxiwydra@gmx.de'
]);
const BACKFILL_DAYS = parseInt(process.env.BACKFILL_DAYS || '7', 10);
const SINCE_OVERRIDE = process.env.SINCE_DATE ? new Date(process.env.SINCE_DATE) : null;

function sanitize(s) { return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80); }

const APPLY = process.argv.includes('--apply');
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { sentKeys: {} };
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sentKeys: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

(async () => {
    LOG(APPLY ? '🚀 APPLY — Mails werden an DATEV gesendet' : '🔍 DRY-RUN — zeigt nur, sendet nicht');

    const state = loadState();
    const imap = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: 'taxiwydra@googlemail.com', pass: 'tiajmwotmnltltkh' },
        logger: false
    });
    await imap.connect();
    await imap.mailboxOpen('INBOX');
    LOG('Gmail INBOX geöffnet');

    const since = SINCE_OVERRIDE || new Date(Date.now() - BACKFILL_DAYS * 86400000);
    const uids = await imap.search({ since });
    LOG(`${uids.length} Mails seit ${since.toISOString().slice(0, 10)}`);

    const transporter = APPLY ? nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: 'taxiwydra@googlemail.com', pass: 'tiajmwotmnltltkh' }
    }) : null;

    let sent = 0, skippedDup = 0, skippedNoMatch = 0, skippedSkipDomain = 0, skippedNoPdf = 0;
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
        const yearMonth = dateISO.slice(0, 7);
        const targetDir = path.join(ONEDRIVE_GMX_ROOT, yearMonth);

        for (const att of pdfs) {
            const filename = att.filename || `gmx-${uid}.pdf`;
            const localName = `${dateISO}_uid${uid}_${sanitize(filename)}`;
            const localPath = path.join(targetDir, localName);
            const key = `gmail:${uid}:${filename}`;
            if (state.sentKeys[key]) { skippedDup++; continue; }

            candidates.push({ uid, fromAddr, subject, filename, localPath, size: att.content.length, date: p.date });

            if (APPLY) {
                try {
                    fs.mkdirSync(targetDir, { recursive: true });
                    if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, att.content);

                    const info = await transporter.sendMail({
                        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
                        to: DATEV_ADDR,
                        subject: `[Auto-Gmail] ${fromAddr} — ${subject.slice(0, 60)}`,
                        text: `Auto-Forward aus taxiwydra@googlemail.com\n\nVon: ${fromAddr}\nBetreff: ${subject}\nDatum: ${p.date?.toISOString() || '?'}\nAnhang: ${filename} (${Math.round(att.content.length / 1024)} KB)\nLokal: ${localPath}\n\nGesendet via scripts/gmail-daily-datev-forward.js`,
                        attachments: [{ filename, path: localPath, contentType: 'application/pdf' }]
                    });
                    state.sentKeys[key] = { sentAt: Date.now(), messageId: info.messageId, from: fromAddr, subject: subject.slice(0, 200), localPath };
                    sent++;
                    LOG(`✅ [${sent}] ${fromAddr} → ${localPath} → DATEV`);
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
        candidates.slice(0, 20).forEach((c, i) => {
            LOG(`  ${i + 1}. uid=${c.uid} ${c.fromAddr.padEnd(40)} ${c.filename.slice(0, 30)} (${Math.round(c.size / 1024)}KB)`);
            LOG(`     "${c.subject.slice(0, 80)}"`);
        });
        if (candidates.length > 20) LOG(`  ... + ${candidates.length - 20} weitere`);
    }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
