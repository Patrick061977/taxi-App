const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');

const client = new ImapFlow({
    host: 'imap.gmx.net', port: 993, secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS },
    logger: false
});

(async () => {
    await client.connect();

    // Alle Mailboxen durchsuchen
    const boxes = await client.list();
    for (const box of boxes) {
        try {
            const status = await client.mailboxOpen(box.path);
            if (status.exists === 0) continue;

            const msgs = await client.search({ from: 'rockstroh@alextouristik.de' });
            if (msgs.length === 0) continue;

            console.log(`\n📂 Ordner: ${box.path} — ${msgs.length} Email(s) von Rockstroh`);
            // Neueste
            const uid = msgs[msgs.length - 1];
            for await (const msg of client.fetch([uid], { envelope: true, bodyParts: ['TEXT'] })) {
                console.log('VON:', msg.envelope.from[0].address);
                console.log('BETREFF:', msg.envelope.subject);
                console.log('DATUM:', msg.envelope.date);
                const text = msg.bodyParts?.get('text');
                if (text) {
                    const decoded = Buffer.from(text).toString('utf8')
                        .replace(/=E4/g,'ä').replace(/=F6/g,'ö').replace(/=FC/g,'ü')
                        .replace(/=C4/g,'Ä').replace(/=D6/g,'Ö').replace(/=DC/g,'Ü')
                        .replace(/=DF/g,'ß').replace(/=20/g,' ').replace(/=\r?\n/g,'');
                    console.log('\nINHALT:\n', decoded.slice(0, 1500));
                }
            }
        } catch(e) { /* skip inaccessible boxes */ }
    }
    await client.logout();
})().catch(e => console.error('Fehler:', e.message));
