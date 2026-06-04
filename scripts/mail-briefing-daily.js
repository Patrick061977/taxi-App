#!/usr/bin/env node
// mail-briefing-daily.js — täglicher Mail-Briefing-Cron 08:00 Berlin via
// GitHub Actions. Patrick (04.06. 12:35 BRIEFING-OK): "wieso gab es keine
// E-Mails... müsste theoretisch immer jeden Morgen um 9 Uhr oder um 8 Uhr
// von den E-Mails der vergangenen Tage des vergangenen Tags abgehandelt
// werden." Output → Telegram via Claude-Bot direkt an Patrick.
//
// ENV vars (GitHub Actions Secrets):
//   GMX_PASS, GMAIL_PASS, TG_BOT_TOKEN, TG_CHAT_ID
// Fallbacks für lokales Testen aus mail-briefing-7days.js.

const path = require('path');
const NODE_MODULES = path.join(__dirname, '..', 'functions', 'node_modules');
const { ImapFlow } = require(path.join(NODE_MODULES, 'imapflow'));
const { simpleParser } = require(path.join(NODE_MODULES, 'mailparser'));
const https = require('https');

const SINCE = new Date(Date.now() - 24 * 60 * 60 * 1000);
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

// 🔐 Secrets müssen als ENV gesetzt sein (GitHub Actions secrets oder lokal export).
//   Patrick 04.06. 13:00: GitGuardian-Warning wegen hardcoded Bot-Token im Commit
//   davor — Token rotiert via @BotFather, neuer Token nur als GitHub-Secret.
const accounts = [
    { name: 'GMX', host: 'imap.gmx.net', port: 993, user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS },
    { name: 'Gmail', host: 'imap.gmail.com', port: 993, user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
];

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID   = process.env.TG_CHAT_ID || '6229490043';

if (!TG_BOT_TOKEN) {
    console.error('❌ TG_BOT_TOKEN nicht gesetzt — Secret in GitHub eintragen oder lokal export TG_BOT_TOKEN=...');
    process.exit(2);
}
if (!accounts[0].pass || !accounts[1].pass) {
    console.error('❌ GMX_PASS / GMAIL_PASS nicht gesetzt');
    process.exit(2);
}

function classify(envelope, snippetLower) {
    const from = (envelope.from?.[0]?.address || '').toLowerCase();
    const subject = (envelope.subject || '').toLowerCase();
    const hay = from + ' ' + subject + ' ' + snippetLower;
    if (/newsletter|unsubscribe|werbung|sale|-\s?\d{1,2}\s?%|rabatt|gutschein|gewinnspiel|aktion|flash[- ]?sale|black\s?friday|cyber\s?monday|gurufocus|earnings ?whispers|screener email|ipo moves|live today|guest speaker|first look|temu|taschenpost|live-webinar|kostenlos|gratis|verpasst|spar|wechseln zu|jetzt sichern|herzlich willkommen|herzlichen glückwunsch|⚡|🔥|🎁|💰/.test(hay))
        return { cat: 'werbung', prio: 'mute', emoji: '🗑️' };
    if (/ikano|barclays|hanseatic|consorsbank|trade ?republic|comdirect|finanzen100|edeka|kohlverlag|netflix.*beleg|amazon\.de.*starte|amazon\.de.*entdecke|amazon\.de.*neu|booking\.com.*entdecken|expedia.*angebot|börsenrobos|chartcheck|broker.?test/.test(from + ' ' + subject))
        return { cat: 'werbung', prio: 'mute', emoji: '🗑️' };
    if (/no-?reply|do[-_]?not[-_]?reply|@github\.com|notifications?@/.test(from))
        return { cat: 'system', prio: 'low', emoji: '⚙️' };
    if (/finanzamt|steuer|ecovis|ihk|gewerbe|krankenkasse|aok|behörde|gesetzlich|datev|justiz|gericht|polizei|zoll/.test(hay))
        return { cat: 'behoerde', prio: 'HIGH', emoji: '🏛️' };
    if (/anwalt|rechtsanwalt|kanzlei|weigel/.test(hay))
        return { cat: 'anwalt', prio: 'HIGH', emoji: '⚖️' };
    if (/sparkasse|commerzbank|volksbank|paypal|stripe|zettle|kontoauszug|sepa|interactive ?brokers|adobe|amazon\sbusiness|google[-_ ]?play|microsoft 365|apple/.test(hay))
        return { cat: 'finanz', prio: 'normal', emoji: '💳' };
    if (/buchung|reservierung|fahrt|taxi|rechnung|invoice|auftrag|kunde|hotel|gast|abholung|transfer|flugha|krankenfah/.test(hay))
        return { cat: 'geschaeft', prio: 'normal', emoji: '🚕' };
    if (/praxis|arzt|doktor|rezept|blutwerte|gramsch|weihs|moskwa|patientenportal|krankschreib/.test(hay))
        return { cat: 'gesundheit', prio: 'HIGH', emoji: '💊' };
    if (/vetter|reise|tour|veranstaltung|ausflug|festival/.test(hay))
        return { cat: 'business', prio: 'normal', emoji: '🏨' };
    return { cat: 'sonstige', prio: 'normal', emoji: '📩' };
}

async function pullAccount(cfg) {
    const out = { account: cfg.name, user: cfg.user, total: 0, items: [], moved: { werbung: 0, system: 0 } };
    const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ since: SINCE });
    LOG(cfg.name, 'UIDs:', uids.length);
    out.total = uids.length;
    // 🆕 Plus-1 (Patrick 04.06. 12:51 "briefing plus 1+2+3"): Werbung in Trash,
    //   System in Archiv-Label "Briefing-System" — Posteingang sauberer.
    //   Gmail: Trash = '[Gmail]/Trash', All-Mail = '[Gmail]/All Mail'.
    //   GMX: Trash = 'Trash' (manchmal 'INBOX.Trash').
    //   Wir versuchen mehrere Folder-Namen mit Fallback.
    const TRASH_CANDIDATES = ['[Gmail]/Trash', 'Trash', 'INBOX.Trash', 'Papierkorb'];
    let trashFolder = null;
    for (const f of TRASH_CANDIDATES) {
        try {
            const info = await client.mailboxOpen(f);
            if (info) { trashFolder = f; break; }
        } catch (_e) { /* try next */ }
    }
    if (trashFolder) {
        await client.mailboxOpen('INBOX');
        LOG(cfg.name, 'Trash-Folder:', trashFolder);
    } else {
        LOG(cfg.name, '⚠️ Kein Trash-Folder gefunden — Auto-Move deaktiviert');
    }
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true });
            if (!msg) continue;
            const parsed = msg.source ? await simpleParser(msg.source) : null;
            const env = msg.envelope || {};
            const snippet = ((parsed && (parsed.text || parsed.html || '')) || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300).toLowerCase();
            const cls = classify(env, snippet);
            out.items.push({
                uid,
                date: env.date ? new Date(env.date).toISOString().slice(0, 16).replace('T', ' ') : '',
                from: env.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address || ''}>`.trim() : '',
                subject: env.subject || '',
                cat: cls.cat,
                prio: cls.prio,
                emoji: cls.emoji,
                hasAttachments: !!(parsed && parsed.attachments && parsed.attachments.length),
            });
            // 🆕 Plus-1: Werbung sofort in Trash, System wird als Seen markiert.
            //   ENV MOVE_WERBUNG=true muss explizit gesetzt sein, sonst nur Klassifikation
            //   ohne Aktion (Safe-Mode für ersten Test).
            const MOVE_ON = String(process.env.MOVE_WERBUNG || 'false').toLowerCase() === 'true';
            if (MOVE_ON && cls.cat === 'werbung' && trashFolder) {
                try {
                    await client.messageMove(uid, trashFolder, { uid: true });
                    out.moved.werbung++;
                } catch (_mvErr) { /* nicht-kritisch */ }
            }
            if (MOVE_ON && cls.cat === 'system') {
                try {
                    await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
                    out.moved.system++;
                } catch (_flErr) { /* nicht-kritisch */ }
            }
        } catch (e) { LOG('parse-err', cfg.name, uid, e.message); }
    }
    await client.logout();
    return out;
}

function buildTelegramText(allAccounts) {
    const lines = [];
    lines.push('📭 <b>Mail-Briefing — letzte 24 Stunden</b>');
    lines.push('');
    const order = ['behoerde', 'anwalt', 'gesundheit', 'business', 'geschaeft', 'finanz', 'sonstige', 'system', 'werbung'];
    const catLabels = {
        behoerde: '🏛️ Behörden',
        anwalt:   '⚖️ Anwalt',
        gesundheit:'💊 Gesundheit',
        business: '🏨 Business (Hotels/Touristik)',
        geschaeft:'🚕 Geschäft (Buchungen/Rechnungen)',
        finanz:   '💳 Finanzen',
        sonstige: '📩 Sonstige',
        system:   '⚙️ System (auto)',
        werbung:  '🗑️ Werbung'
    };
    let totalAll = 0;
    for (const acc of allAccounts) {
        if (acc.error) {
            lines.push(`❌ <b>${acc.account}</b>: ${acc.error}`);
            continue;
        }
        totalAll += acc.items.length;
        lines.push(`📬 <b>${acc.account}</b> (${acc.user}) — ${acc.items.length} Mail${acc.items.length === 1 ? '' : 's'}`);
        const buckets = {};
        for (const it of acc.items) {
            buckets[it.cat] = buckets[it.cat] || [];
            buckets[it.cat].push(it);
        }
        for (const cat of order) {
            const list = (buckets[cat] || []).sort((a, b) => (a.date < b.date ? 1 : -1));
            if (!list.length) continue;
            // Werbung + System nur als Count
            if (cat === 'werbung' || cat === 'system') {
                lines.push(`  ${catLabels[cat]}: ${list.length}`);
                continue;
            }
            lines.push(`  <b>${catLabels[cat]} (${list.length})</b>`);
            const esc = (s) => String(s||'').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            for (const it of list.slice(0, 8)) {
                const fromShort = (it.from || '').replace(/<[^>]+>/g, '').trim().substring(0, 36) || it.from.substring(0, 36);
                const subj = (it.subject || '').substring(0, 50);
                const att = it.hasAttachments ? ' 📎' : '';
                lines.push(`    • ${esc(fromShort)}: ${esc(subj)}${att}`);
            }
            if (list.length > 8) lines.push(`    … (+${list.length - 8} weitere)`);
        }
        lines.push('');
    }
    lines.push(`📊 Total: ${totalAll} Mail${totalAll === 1 ? '' : 's'} der letzten 24h`);
    // 🆕 Plus-1: Auto-Sort-Stats
    let totalTrashed = 0, totalMarked = 0;
    for (const acc of allAccounts) {
        if (acc.moved) { totalTrashed += acc.moved.werbung || 0; totalMarked += acc.moved.system || 0; }
    }
    if (totalTrashed > 0 || totalMarked > 0) {
        lines.push(`🗑️ Vorsortiert: ${totalTrashed} Werbung → Trash · ${totalMarked} System → gelesen`);
    }
    lines.push(`<i>Generiert ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</i>`);
    return lines.join('\n');
}

function sendTelegram(text) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) resolve(JSON.parse(data));
                else reject(new Error(`Telegram ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    const all = [];
    for (const acc of accounts) {
        try {
            const r = await pullAccount(acc);
            all.push(r);
        } catch (e) {
            LOG('account-err', acc.name, e.message);
            all.push({ account: acc.name, error: e.message, items: [] });
        }
    }
    const text = buildTelegramText(all);
    console.log('\n=== Telegram-Briefing ===\n');
    console.log(text);
    console.log('\n=========================\n');
    try {
        // Telegram-Limit: 4096 Zeichen, ggf. splitten
        if (text.length <= 4000) {
            await sendTelegram(text);
            LOG('✅ Telegram gesendet');
        } else {
            const chunks = [];
            let cur = '';
            for (const line of text.split('\n')) {
                if ((cur + '\n' + line).length > 3800) {
                    chunks.push(cur);
                    cur = line;
                } else {
                    cur = cur ? cur + '\n' + line : line;
                }
            }
            if (cur) chunks.push(cur);
            for (const ch of chunks) {
                await sendTelegram(ch);
                await new Promise(r => setTimeout(r, 500));
            }
            LOG(`✅ Telegram in ${chunks.length} Teilen gesendet`);
        }
    } catch (e) {
        console.error('❌ Telegram-Send Fehler:', e.message);
        process.exit(2);
    }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
