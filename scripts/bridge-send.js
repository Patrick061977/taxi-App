#!/usr/bin/env node
// 🤖 v6.62.x: Claude-Bridge Outbox-Sender (Gegenstück zu bridge-poll.js)
// Schreibt eine Nachricht nach /claudeBridge/outbox/{ts} — der
// onClaudeBridgeOutbox-Trigger in functions/index.js sendet sie als
// Telegram-Bot-Message an die targetChatId (default: Patrick).
//
// Hintergrund: foreground-Bash hat einen Socket-Hangup-Bug bei
// `firebase database:update -f` mit Stream. Dieses Skript läuft als
// Node-Subprocess mit `shell: true` und umgeht den Bug zuverlässig.
//
// Aufruf:
//   node scripts/bridge-send.js "Nachricht-Text"                     # an Patrick (default)
//   node scripts/bridge-send.js "Text" --chat 1234567                # an andere ChatId
//   node scripts/bridge-send.js "Text" --hauptbot                    # via Hauptbot statt Claude-Bot

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTANCE = 'taxi-heringsdorf-default-rtdb';
const PATRICK_CHAT_ID = 6229490043;

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: node scripts/bridge-send.js "message" [--chat <id>] [--hauptbot]');
    process.exit(1);
}

const message = args[0];
let targetChatId = PATRICK_CHAT_ID;
let via = 'claude';
for (let i = 1; i < args.length; i++) {
    if (args[i] === '--chat' && args[i + 1]) { targetChatId = Number(args[++i]); }
    else if (args[i] === '--hauptbot') { via = 'main'; }
}

const ts = Date.now();
const payload = { message, targetChatId, via, ts };
const tmpFile = path.join(os.tmpdir(), `bridge-out-${ts}-${process.pid}.json`);

try {
    fs.writeFileSync(tmpFile, JSON.stringify(payload));
    execSync(
        `firebase database:update --instance ${INSTANCE} -f "/claudeBridge/outbox/${ts}" "${tmpFile}"`,
        { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'inherit', shell: true }
    );
    console.log(`✅ Bridge-OUT ts=${ts} an ${targetChatId} (${via})`);
} catch (e) {
    console.error(`❌ Bridge-OUT failed: ${e.message}`);
    process.exit(2);
} finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
}
