// 📧 GMAIL → CLAUDE-BRIDGE INBOX
// Google Apps Script: holt alle Gmail-Mails mit Label "ClaudeBridge"
// und schreibt sie nach Firebase /emailInbox/{ts}.
// Claude-Bridge-Polling sieht den neuen Eintrag und benachrichtigt Claude.
//
// Version: 1.0 - 07.05.2026
//
// ═══════════════════════════════════════════════════════════════
// SETUP (einmalig in Patrick's Gmail / Google Apps Script):
// ═══════════════════════════════════════════════════════════════
// 1. https://script.google.com/ → Neues Projekt → Code hier reinkopieren
// 2. Project-Name: "Funk Taxi · Gmail-Bridge"
// 3. Berechtigung beim ersten Run: Gmail + UrlFetchApp erlauben
// 4. Trigger einrichten: ⏰ Alle 5 Minuten → syncGmailToBridge
// 5. In Gmail: Label "ClaudeBridge" anlegen (Einstellungen → Labels → Neu)
// 6. Filter erstellen: Mails von ECOVIS/wichtig automatisch labeln,
//    ODER: Patrick markiert relevante Mails manuell mit "ClaudeBridge"
//
// USAGE: Patrick markiert Mails mit Label "ClaudeBridge" → innerhalb 5 Min
// landen sie in Firebase und Claude bekommt eine Benachrichtigung.
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  FIREBASE_URL: 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app',
  LABEL_NAME: 'ClaudeBridge',
  PROCESSED_LABEL: 'ClaudeBridge-Done', // Nach Verarbeitung umlabeln
  MAX_BODY_CHARS: 50000,                 // Pro Mail max 50k Zeichen Body
  MAX_ATTACHMENT_BYTES: 7 * 1024 * 1024  // Max 7 MB pro Anhang (Firebase-Friendly)
};

// ═══════════════════════════════════════════════════════════════
// MAIN: alle Mails mit Label "ClaudeBridge" holen + nach Firebase
// ═══════════════════════════════════════════════════════════════
function syncGmailToBridge() {
  const startTime = Date.now();
  console.log('📧 Gmail → Bridge Sync gestartet:', new Date().toLocaleString('de-DE'));

  // Label-Objekte
  let inboxLabel = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME);
  if (!inboxLabel) {
    console.log('⚠️ Label "' + CONFIG.LABEL_NAME + '" existiert nicht — lege es an.');
    inboxLabel = GmailApp.createLabel(CONFIG.LABEL_NAME);
  }
  let doneLabel = GmailApp.getUserLabelByName(CONFIG.PROCESSED_LABEL);
  if (!doneLabel) {
    doneLabel = GmailApp.createLabel(CONFIG.PROCESSED_LABEL);
  }

  // Threads mit Label holen
  const threads = inboxLabel.getThreads(0, 20);
  console.log('📬 Gefunden: ' + threads.length + ' Thread(s) mit Label "' + CONFIG.LABEL_NAME + '"');

  if (threads.length === 0) {
    console.log('✅ Keine neuen Mails — fertig.');
    return;
  }

  let processed = 0, skipped = 0, errors = 0;

  for (const thread of threads) {
    try {
      const messages = thread.getMessages();
      for (const msg of messages) {
        const ts = msg.getDate().getTime();
        const id = msg.getId();
        const from = msg.getFrom();
        const to = msg.getTo();
        const subject = msg.getSubject();
        let body = msg.getPlainBody() || '';
        if (body.length > CONFIG.MAX_BODY_CHARS) {
          body = body.substring(0, CONFIG.MAX_BODY_CHARS) + '\n\n[…abgeschnitten, Original ' + body.length + ' Zeichen…]';
        }

        // Anhänge sammeln (nur Metadaten + kleine als base64)
        const attachments = [];
        const rawAttachments = msg.getAttachments();
        for (const att of rawAttachments) {
          const size = att.getSize();
          const meta = {
            filename: att.getName(),
            contentType: att.getContentType(),
            sizeBytes: size,
            tooBig: size > CONFIG.MAX_ATTACHMENT_BYTES
          };
          if (!meta.tooBig) {
            try {
              meta.base64 = Utilities.base64Encode(att.getBytes());
            } catch (e) {
              meta.base64Error = String(e);
            }
          }
          attachments.push(meta);
        }

        // Firebase-Eintrag
        const entry = {
          gmailId: id,
          gmailThreadId: thread.getId(),
          ts: ts,
          receivedAt: new Date(ts).toISOString(),
          from: from,
          to: to,
          subject: subject,
          body: body,
          bodyChars: body.length,
          attachments: attachments,
          attachmentCount: attachments.length,
          source: 'gmail-apps-script-v1.0',
          processedAt: Date.now()
        };

        // PUT nach /emailInbox/{ts}_{kurzId}
        const path = 'emailInbox/' + ts + '_' + id.substring(0, 12);
        const url = CONFIG.FIREBASE_URL + '/' + path + '.json';
        const resp = UrlFetchApp.fetch(url, {
          method: 'put',
          contentType: 'application/json',
          payload: JSON.stringify(entry),
          muteHttpExceptions: true
        });
        const code = resp.getResponseCode();
        if (code >= 200 && code < 300) {
          console.log('✅ ' + subject.substring(0, 50) + ' → ' + path);
          processed++;
        } else {
          console.log('❌ Firebase-Fehler ' + code + ': ' + resp.getContentText().substring(0, 200));
          errors++;
        }
      }

      // Thread-Label umsetzen
      thread.removeLabel(inboxLabel);
      thread.addLabel(doneLabel);
    } catch (e) {
      console.log('❌ Thread-Fehler: ' + String(e));
      errors++;
    }
  }

  const dur = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('🏁 Fertig: ' + processed + ' verarbeitet, ' + skipped + ' übersprungen, ' + errors + ' Fehler — ' + dur + 's');
}

// Manuell aus Editor: Test-Run
function _testRun() {
  syncGmailToBridge();
}
