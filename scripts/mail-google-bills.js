#!/usr/bin/env node
// mail-google-bills.js — Patrick (Bridge 01.06. 19:37): "wo bezahle ich überall
// bei Google?". Sucht in GMX + Gmail nach Google-Rechnungs-/Abbuchungs-Mails
// der letzten 60 Tage und listet alles auf.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');

const SINCE = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

const accounts = [
    { name: 'GMX', host: 'imap.gmx.net', user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS },
    { name: 'Gmail', host: 'imap.gmail.com', user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
];

// Patterns für Google-bezogene Rechnungen / Abbuchungen
const GOOGLE_PATTERNS = [
    'cloudplatform-noreply@google.com',
    'cloudbilling@google.com',
    'noreply-billing@google.com',
    'noreply-payment@google.com',
    'firebase-noreply@google.com',
    'googleplay-noreply@google.com',
    'play.google.com',
    'noreply@google.com',
    'workspace-noreply@google.com',
    'cloud-billing@google.com',
    'business-billing@google.com',
    '@google.com',
];

function findAmount(text) {
    if (!text) return null;
    // Versuche EUR/€-Beträge zu finden
    const m = text.match(/(\d+(?:[.,]\d{2})?)\s?(?:€|EUR)/i);
    if (m) return m[0];
    const m2 = text.match(/(?:€|EUR)\s?(\d+(?:[.,]\d{2})?)/i);
    if (m2) return m2[0];
    const m3 = text.match(/USD\s?(\d+(?:[.,]\d{2})?)/i);
    if (m3) return m3[0];
    const m4 = text.match(/\$\s?(\d+(?:[.,]\d{2})?)/);
    if (m4) return m4[0];
    return null;
}

function classifyGoogleService(envelope, snippet) {
    const from = (envelope.from?.[0]?.address || '').toLowerCase();
    const fromName = (envelope.from?.[0]?.name || '').toLowerCase();
    const subj = (envelope.subject || '').toLowerCase();
    const hay = from + ' ' + fromName + ' ' + subj + ' ' + snippet;

    if (from.includes('googleplay-noreply') || subj.includes('google play')) return 'Play';
    if (from.includes('firebase-noreply') || /firebase/.test(hay)) return 'Firebase';
    if (from.includes('cloudplatform') || /cloud\s?platform|cloud\s?run|cloud\s?functions|bigquery|cloud\s?build/.test(hay)) return 'Cloud Platform';
    if (/google\s?maps|maps\s?api|places\s?api|places\s?sdk|geocoding|directions\s?api/.test(hay)) return 'Maps API';
    if (/google\s?workspace|gmail\s?business|google\s?one|workspace/.test(hay)) return 'Workspace';
    if (/google\s?ads|adwords|ad\s?credit/.test(hay)) return 'Ads';
    if (/youtube\s?premium/.test(hay)) return 'YouTube';
    if (/google\s?storage|cloud\s?storage/.test(hay)) return 'Cloud Storage';
    if (from.includes('@google.com')) return 'Google (unbekannt)';
    return null;
}

async function pullAccount(cfg) {
    const out = { account: cfg.name, hits: [] };
    const client = new ImapFlow({ host: cfg.host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const allUids = new Set();
    // OR-Search aller Google-Pattern
    for (const pattern of GOOGLE_PATTERNS) {
        try {
            const uids = await client.search({ from: pattern, since: SINCE });
            uids.forEach(u => allUids.add(u));
        } catch (_) {}
    }
    LOG(cfg.name, 'Google-Mail-Kandidaten:', allUids.size);
    for (const uid of allUids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true });
            if (!msg) continue;
            const parsed = msg.source ? await simpleParser(msg.source) : null;
            const env = msg.envelope || {};
            const snippet = ((parsed && (parsed.text || parsed.html || '')) || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
            const svc = classifyGoogleService(env, snippet);
            if (!svc) continue;
            const amount = findAmount(env.subject || '') || findAmount(snippet);
            out.hits.push({
                date: env.date ? new Date(env.date).toISOString().slice(0, 10) : '',
                from: env.from?.[0] ? `${env.from[0].address || ''}` : '',
                subject: (env.subject || '').slice(0, 130),
                service: svc,
                amount: amount,
            });
        } catch (_) {}
    }
    await client.logout();
    return out;
}

(async () => {
    const results = [];
    for (const acc of accounts) {
        try {
            const r = await pullAccount(acc);
            results.push(r);
        } catch (e) {
            results.push({ account: acc.name, error: e.message });
        }
    }
    console.log('\n═══════ GOOGLE-ZAHLUNGEN LETZTE 60 TAGE ═══════\n');
    const byService = {};
    for (const r of results) {
        if (!r.hits) { console.log(r.account + ':', r.error); continue; }
        console.log('\n─── ' + r.account + ' (' + r.hits.length + ' Treffer) ───');
        r.hits.sort((a, b) => a.date < b.date ? 1 : -1);
        for (const h of r.hits) {
            console.log(`  [${h.date}] ${h.service.padEnd(15)} ${(h.amount || '').padStart(10)}  ${h.subject.slice(0, 85)}`);
            byService[h.service] = byService[h.service] || [];
            byService[h.service].push(h);
        }
    }
    console.log('\n═══ Summary per Service ═══');
    for (const svc of Object.keys(byService).sort()) {
        const arr = byService[svc];
        console.log(`  ${svc.padEnd(20)} ${arr.length} Mail(s)`);
        const amounts = arr.filter(a => a.amount).map(a => a.amount);
        if (amounts.length) console.log(`    Beträge gesehen: ${amounts.slice(0, 5).join(', ')}${amounts.length > 5 ? ` ... +${amounts.length-5}` : ''}`);
    }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
