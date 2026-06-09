const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const USER = 'taxiwydra@googlemail.com';
const PASS = process.env.GMAIL_PASS;
(async () => {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ from: 'nagy', subject: 'Kurkarten' });
    console.log('Found:', uids);
    for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true });
        const parsed = await simpleParser(msg.source);
        console.log('===');
        console.log('From:', parsed.from && parsed.from.text);
        console.log('Date:', parsed.date);
        console.log('Subject:', parsed.subject);
        console.log('--- FULL BODY ---');
        console.log(parsed.text);
        fs.writeFileSync('C:/temp/nagy-full.txt', parsed.text || '');
    }
    await client.logout();
})();
