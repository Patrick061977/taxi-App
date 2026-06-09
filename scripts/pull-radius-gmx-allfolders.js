// Radius-Pull über ALLE GMX-Ordner
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = { host: 'imap.gmx.net', port: 993, secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS }, logger: false };
const OUT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Radius/2025';
fs.mkdirSync(OUT, { recursive: true });
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    const list = await client.list();
    const allFolders = list.map(b => b.path);
    LOG('Folders:', allFolders.join(', '));

    let total = 0;
    for (const folder of allFolders) {
        if (/spam|trash|drafts|sent/i.test(folder)) continue; // skip spam/trash/drafts/sent
        try {
            await client.mailboxOpen(folder);
            const uids = await client.search({ since: new Date('2025-01-01'), before: new Date('2026-02-01'), from: 'radius' });
            const uids2 = await client.search({ since: new Date('2025-01-01'), before: new Date('2026-02-01'), subject: 'Radius' });
            const combined = new Set([...uids, ...uids2]);
            if (combined.size === 0) continue;
            LOG(folder + ': ' + combined.size + ' Radius-Mails');
            for (const uid of combined) {
                const msg = await client.fetchOne(uid, { source: true });
                if (!msg || !msg.source) continue;
                const parsed = await simpleParser(msg.source);
                const from = ((parsed.from && parsed.from.text) || '').toLowerCase();
                if (!/radius/i.test(from + (parsed.subject || ''))) continue;
                const date = parsed.date ? parsed.date.toISOString().slice(0, 10) : 'unk';
                const atts = (parsed.attachments || []).filter(a => /pdf/i.test(a.contentType || a.filename || ''));
                for (const att of atts) {
                    const safeFn = att.filename ? att.filename.replace(/[<>:"/\\|?*]/g, '_') : `radius_${date}_${uid}.pdf`;
                    const fn = `${date}_${safeFn}`;
                    const dest = path.join(OUT, fn);
                    if (fs.existsSync(dest)) { continue; }
                    fs.writeFileSync(dest, att.content);
                    total++;
                    LOG('✅', folder, '→', fn);
                }
            }
        } catch (e) { LOG('Folder err', folder, ':', e.message.slice(0,50)); }
    }
    await client.logout();
    LOG('TOTAL PDFs neu:', total);
    LOG('Files in OneDrive Radius/2025/:', fs.readdirSync(OUT).filter(f => f.endsWith('.pdf')).length);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
