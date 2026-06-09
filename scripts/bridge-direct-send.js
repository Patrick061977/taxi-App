#!/usr/bin/env node
// 🆕 v6.63.251 (Patrick 09.06.): Direkt-Send-Wrapper an Telegram-API,
// umgeht die Cloud-Function `onClaudeBridgeOutbox` (die wegen parse_mode=HTML
// + Unicode-Trennlinien manchmal Pushes silent verschluckt — sent=True
// + msgId vergeben, aber nicht zugestellt).
//
// Liest Bot-Token aus Firebase via gcloud-Token, sendet OHNE parse_mode
// (Plain-Text). Robuster als Bridge.
//
// Aufruf:
//   node scripts/bridge-direct-send.js "Nachricht"                # an Patrick via Claude-Bot
//   node scripts/bridge-direct-send.js "Text" --chat <id>         # an andere ChatId
//   node scripts/bridge-direct-send.js "Text" --hauptbot          # via Hauptbot
//   node scripts/bridge-direct-send.js --file path/to/msg.txt     # Text aus Datei

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');

const PATRICK_CHAT_ID = 6229490043;
const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: node scripts/bridge-direct-send.js "message" [--chat <id>] [--hauptbot] [--file <path>]');
    process.exit(1);
}

let message = '';
let targetChatId = PATRICK_CHAT_ID;
let useHauptbot = false;
let i = 0;
while (i < args.length) {
    if (args[i] === '--chat' && args[i + 1]) { targetChatId = Number(args[++i]); }
    else if (args[i] === '--hauptbot') { useHauptbot = true; }
    else if (args[i] === '--file' && args[i + 1]) { message = fs.readFileSync(args[++i], 'utf8'); }
    else if (!message) { message = args[i]; }
    i++;
}

if (!message) {
    console.error('No message');
    process.exit(1);
}

function getGcloudToken() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

function fbGet(path) {
    return new Promise((resolve, reject) => {
        const token = getGcloudToken();
        const req = https.request({
            hostname: RTDB_HOST,
            path: '/' + path + '.json?access_token=' + token,
            method: 'GET'
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error('parse: ' + d.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function tgSend(botToken, chatId, text) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ chat_id: chatId, text });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(new Error('tg parse: ' + d.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    try {
        const tokenKey = useHauptbot ? 'settings/telegram/botToken' : 'settings/telegram/claudeBotToken';
        const botToken = await fbGet(tokenKey);
        if (!botToken || typeof botToken !== 'string') {
            console.error(`❌ kein Bot-Token unter ${tokenKey}`);
            process.exit(2);
        }
        // Telegram Limit ist 4096 — wir splitten bei Bedarf
        const MAX = 4000;
        const chunks = [];
        if (message.length <= MAX) {
            chunks.push(message);
        } else {
            for (let i = 0; i < message.length; i += MAX) chunks.push(message.slice(i, i + MAX));
        }
        const msgIds = [];
        for (const chunk of chunks) {
            const result = await tgSend(botToken, targetChatId, chunk);
            if (!result.ok) {
                console.error(`❌ TG send failed: ${result.description}`);
                process.exit(3);
            }
            msgIds.push(result.result.message_id);
        }
        console.log(`✅ ${useHauptbot ? 'Hauptbot' : 'Claude-Bot'} → ${targetChatId} | msgId: ${msgIds.join(',')}`);
    } catch (e) {
        console.error('❌', e.message);
        process.exit(4);
    }
})();
