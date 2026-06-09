// Multi-Vendor GMX-Pull: Munch Energie, STRATO, Amazon
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = { host: 'imap.gmx.net', port: 993, secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS }, logger: false };
const ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen';
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

const VENDORS = [
    { name: 'MunchEnergie', folder: 'MunchEnergie/2025', match: /munch|münch/i, searches: [{ from: 'munch' }, { from: 'münch' }, { subject: 'Munch' }, { body: 'Munch Energie' }] },
    { name: 'STRATO', folder: 'STRATO/2025', match: /strato/i, searches: [{ from: 'strato' }, { subject: 'Strato' }] },
    { name: 'Amazon', folder: 'Amazon/2025', match: /amazon|primevideo/i, searches: [{ from: 'amazon' }, { subject: 'Amazon Rechnung' }, { subject: 'Bestellung' }, { subject: 'invoice' }] },
];

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    const list = await client.list();
    const folders = list.map(b => b.path).filter(p => !/spam|trash|drafts|sent|gelöscht|gesendet|entwürfe|junk/i.test(p));
    LOG('Searching in', folders.length, 'folders');

    const counts = {};
    for (const v of VENDORS) {
        const out = path.join(ROOT, v.folder);
        fs.mkdirSync(out, { recursive: true });
        counts[v.name] = 0;
        const seen = new Set();
        for (const folder of folders) {
            try {
                await client.mailboxOpen(folder);
                const allUids = new Set();
                for (const q of v.searches) {
                    try {
                        const uids = await client.search({ since: new Date('2025-01-01'), before: new Date('2026-02-01'), ...q });
                        uids.forEach(u => allUids.add(u));
                    } catch (e) { /* skip */ }
                }
                if (allUids.size === 0) continue;
                for (const uid of allUids) {
                    const key = folder + ':' + uid;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const msg = await client.fetchOne(uid, { source: true });
                    if (!msg || !msg.source) continue;
                    const parsed = await simpleParser(msg.source);
                    const from = ((parsed.from && parsed.from.text) || '').toLowerCase();
                    if (!v.match.test(from + (parsed.subject || ''))) continue;
                    const date = parsed.date ? parsed.date.toISOString().slice(0, 10) : 'unk';
                    if (!/^2025/.test(date)) continue; // only 2025
                    const atts = (parsed.attachments || []).filter(a => /pdf/i.test(a.contentType || a.filename || ''));
                    for (const att of atts) {
                        const safeFn = att.filename ? att.filename.replace(/[<>:"/\\|?*]/g, '_') : `${v.name}_${date}_${uid}.pdf`;
                        const fn = `${date}_${safeFn}`;
                        const dest = path.join(out, fn);
                        if (fs.existsSync(dest)) continue;
                        fs.writeFileSync(dest, att.content);
                        counts[v.name]++;
                        LOG('✅', v.name, '/', folder, '→', fn);
                    }
                }
            } catch (e) { /* skip folder errors */ }
        }
    }
    await client.logout();
    LOG('\n=== ERGEBNIS ===');
    for (const v of VENDORS) {
        const out = path.join(ROOT, v.folder);
        const total = fs.existsSync(out) ? fs.readdirSync(out).filter(f => f.endsWith('.pdf')).length : 0;
        LOG(`${v.name}: ${counts[v.name]} neu, ${total} total in OneDrive`);
    }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
