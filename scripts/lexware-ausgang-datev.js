#!/usr/bin/env node
// lexware-ausgang-datev.js — Patrick (27.05.2026): Lexware-Ausgangsrechnungen aus GMX
// ziehen, lokal als Backup speichern + an DATEV-AUSGANGS-Belegtransfer schicken.
//
// Quelle: taxiwydra@gmx.de, from: versand@belege.lexware.de
// Backup: OneDrive/5.Buchführung/Ausgangsrechnungen/Lexware/{Jahr}/
// DATEV-Ziel: 8d5776ad-af6b-4ff8-ad13-b0ff2bea30e1@uploadmail.datev.de (Ausgang)
//
// Default: DRY-RUN. Mit --apply: speichern + senden.
// State: .lexware-ausgang-state.json (Duplikat-Schutz uid+filename).

const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const STATE_FILE = path.join(__dirname, '..', '.lexware-ausgang-state.json');
const LOCAL_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Ausgangsrechnungen/Lexware';
const DATEV_AUSGANG = '8d5776ad-af6b-4ff8-ad13-b0ff2bea30e1@uploadmail.datev.de';
const FROM_ADDR = 'versand@belege.lexware.de';
const BACKFILL_DAYS = parseInt(process.env.BACKFILL_DAYS || '7', 10);
const SINCE_OVERRIDE = process.env.SINCE_DATE ? new Date(process.env.SINCE_DATE) : null;

const APPLY = process.argv.includes('--apply');
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { sentKeys: {} };
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sentKeys: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
function sanitize(s) { return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80); }

(async () => {
    LOG(APPLY ? '🚀 APPLY — Lexware-Ausgangsrechnungen werden gespeichert + an DATEV-Ausgang gesendet' : '🔍 DRY-RUN');

    const state = loadState();
    const imap = new ImapFlow({
        host: 'imap.gmx.net', port: 993, secure: true,
        auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS },
        logger: false
    });
    await imap.connect();
    await imap.mailboxOpen('INBOX');

    const since = SINCE_OVERRIDE || new Date(Date.now() - BACKFILL_DAYS * 86400000);
    const uids = await imap.search({ from: FROM_ADDR, since });
    LOG(`${uids.length} Lexware-Mails seit ${since.toISOString().slice(0, 10)}`);

    const transporter = APPLY ? nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }
    }) : null;

    let sent = 0, skippedDup = 0, savedLocal = 0;
    const candidates = [];

    for (const uid of uids) {
        const m = await imap.fetchOne(uid, { source: true, envelope: true });
        if (!m?.source) continue;
        const p = await simpleParser(m.source);
        const pdfs = (p.attachments || []).filter(a => /pdf/i.test(a.contentType || a.filename || ''));
        if (pdfs.length === 0) continue;

        const dateISO = (p.date || new Date()).toISOString().slice(0, 10);
        const year = dateISO.slice(0, 4);
        const localDir = path.join(LOCAL_ROOT, year);

        for (const att of pdfs) {
            const filename = att.filename || `lexware-${uid}.pdf`;
            const localName = `${dateISO}_uid${uid}_${sanitize(filename)}`;
            const localPath = path.join(localDir, localName);
            const key = `lex:${uid}:${filename}`;
            if (state.sentKeys[key]) { skippedDup++; continue; }

            candidates.push({ uid, subject: p.subject || '', filename, size: att.content.length, date: p.date, localPath });

            if (APPLY) {
                try {
                    fs.mkdirSync(localDir, { recursive: true });
                    if (!fs.existsSync(localPath)) { fs.writeFileSync(localPath, att.content); savedLocal++; }

                    const info = await transporter.sendMail({
                        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
                        to: DATEV_AUSGANG,
                        subject: `[Auto-Ausgang] Lexware ${dateISO} — ${(p.subject || '').slice(0, 60)}`,
                        text: `Lexware-Ausgangsrechnung Auto-Forward\nDatum: ${p.date?.toISOString() || '?'}\nBetreff: ${p.subject}\nDatei: ${filename}\nLokal: ${localPath}\n\nGesendet via scripts/lexware-ausgang-datev.js`,
                        attachments: [{ filename, path: localPath, contentType: 'application/pdf' }]
                    });
                    state.sentKeys[key] = { sentAt: Date.now(), messageId: info.messageId, subject: (p.subject || '').slice(0, 200), localPath };
                    sent++;
                    LOG(`✅ [${sent}] uid=${uid} ${filename} → DATEV-Ausgang`);
                    await new Promise(r => setTimeout(r, 1100));
                } catch (e) {
                    LOG(`❌ uid=${uid} ${filename}: ${e.message.slice(0, 80)}`);
                }
            }
        }
    }

    if (APPLY) saveState(state);
    await imap.logout();

    LOG('\n=== ERGEBNIS ===');
    LOG(`Kandidaten: ${candidates.length}`);
    LOG(`Gesendet: ${sent}`);
    LOG(`Lokal gespeichert: ${savedLocal}`);
    LOG(`Schon gesendet (dup): ${skippedDup}`);
    if (!APPLY && candidates.length) {
        LOG('\n--- DRY-RUN: was würde gesendet ---');
        candidates.slice(0, 15).forEach((c, i) => {
            LOG(`  ${i + 1}. uid=${c.uid} ${c.filename.slice(0, 50)} (${Math.round(c.size / 1024)}KB)`);
            LOG(`     "${c.subject.slice(0, 70)}"`);
        });
        if (candidates.length > 15) LOG(`  ... + ${candidates.length - 15} weitere`);
    }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
