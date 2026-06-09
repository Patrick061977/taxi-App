// ADAC-Mails fuer Patrick — beide Postfaecher (GMX + Gmail)
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');

const ACCOUNTS = [
    { name: 'GMX', cfg: { host: 'imap.gmx.net', port: 993, secure: true, auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS }, logger: false } },
    { name: 'Gmail', cfg: { host: 'imap.gmail.com', port: 993, secure: true, auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false } },
];

const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const allHits = [];
    for (const acc of ACCOUNTS) {
        try {
            const client = new ImapFlow(acc.cfg);
            await client.connect();
            const folders = (await client.list()).map(b => b.path).filter(p => !/spam|trash|drafts|gelöscht|junk/i.test(p));
            for (const folder of folders) {
                try {
                    await client.mailboxOpen(folder);
                    const uids = new Set();
                    for (const q of [{ from: 'adac' }, { subject: 'ADAC' }, { body: 'ADAC' }, { body: '341509033' }]) {
                        try {
                            const u = await client.search({ since: new Date('2023-01-01'), ...q });
                            u.forEach(x => uids.add(x));
                        } catch (_) {}
                    }
                    if (uids.size === 0) continue;
                    LOG(acc.name + '/' + folder + ': ' + uids.size + ' ADAC-Mails');
                    for (const uid of uids) {
                        const msg = await client.fetchOne(uid, { source: true });
                        if (!msg || !msg.source) continue;
                        const parsed = await simpleParser(msg.source);
                        const from = ((parsed.from && parsed.from.text) || '').toLowerCase();
                        const subject = (parsed.subject || '').toLowerCase();
                        if (!/adac|341509033/i.test(from + subject + (parsed.text || ''))) continue;
                        allHits.push({
                            account: acc.name, folder, uid,
                            date: parsed.date,
                            from: parsed.from && parsed.from.text,
                            to: parsed.to && parsed.to.text,
                            subject: parsed.subject,
                            textPreview: (parsed.text || '').slice(0, 600)
                        });
                    }
                } catch (e) { /* skip folder */ }
            }
            await client.logout();
        } catch (e) { LOG('ACC err', acc.name, e.message); }
    }
    allHits.sort((a, b) => new Date(a.date) - new Date(b.date));
    LOG('TOTAL ADAC hits:', allHits.length);
    fs.writeFileSync('C:/temp/adac-mails.json', JSON.stringify(allHits, null, 2));
    for (const h of allHits) {
        const d = h.date ? new Date(h.date).toLocaleDateString('de-DE') : '?';
        console.log('---');
        console.log(d + ' | ' + (h.account || '?') + '/' + (h.folder || '?'));
        console.log('From:', h.from);
        console.log('Subject:', h.subject);
        console.log((h.textPreview || '').replace(/\s+/g, ' ').slice(0, 300));
    }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
