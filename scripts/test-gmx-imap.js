#!/usr/bin/env node
// test-gmx-imap.js — Quick-Test ob GMX-IMAP funktioniert mit den hinterlegten Credentials.
//   Plus: Suche nach 'Motorgeräte Steffen' der letzten 90 Tage.

const { ImapFlow } = require('imapflow');

const cfg = {
    host: 'imap.gmx.net',
    port: 993,
    secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS },
    logger: false,
};

(async () => {
    const client = new ImapFlow(cfg);
    try {
        console.log('[GMX-Test] Verbinde zu', cfg.host, '...');
        await client.connect();
        console.log('[GMX-Test] OK — verbunden');

        await client.mailboxOpen('INBOX');
        console.log('[GMX-Test] INBOX geöffnet');

        // Suche nach Motorgeräte Steffen der letzten 90 Tage
        const since = new Date();
        since.setDate(since.getDate() - 90);
        console.log(`[GMX-Test] Suche 'Motorgeräte Steffen' seit ${since.toISOString().slice(0,10)}...`);

        // ImapFlow search options
        const uids = await client.search({
            or: [
                { from: 'motorgeraete-steffen.de' },
                { subject: 'Steffen' }
            ],
            since
        });
        console.log(`[GMX-Test] Treffer: ${uids.length} UIDs:`, uids);

        if (uids.length > 0) {
            console.log('[GMX-Test] Details:');
            for (const uid of uids) {
                const m = await client.fetchOne(uid, { envelope: true, internalDate: true, bodyStructure: true });
                const att = [];
                const walk = (node) => {
                    if (!node) return;
                    if (node.disposition === 'attachment' || (node.dispositionParameters && node.dispositionParameters.filename)) {
                        att.push(node.dispositionParameters?.filename || node.parameters?.name || '?');
                    }
                    if (node.childNodes) node.childNodes.forEach(walk);
                };
                walk(m.bodyStructure);
                console.log(`  UID ${uid}: ${m.internalDate?.toISOString().slice(0,10)} | ${m.envelope.from?.[0]?.address} | ${m.envelope.subject} | Anhänge: ${att.join(', ') || '-'}`);
            }
        }

        // Zähle Gesamt-Mails der letzten 90 Tage
        const allUids = await client.search({ since });
        console.log(`[GMX-Test] Gesamt Mails letzte 90 Tage: ${allUids.length}`);

        await client.logout();
        console.log('[GMX-Test] Fertig.');
        process.exit(0);
    } catch (e) {
        console.error('[GMX-Test] FEHLER:', e.message);
        try { await client.logout(); } catch {}
        process.exit(1);
    }
})();
