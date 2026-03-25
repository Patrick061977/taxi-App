/**
 * SMS Proxy für seven.io
 * Funk Taxi Heringsdorf
 *
 * ANLEITUNG:
 * 1. Gehe zu: https://script.google.com
 * 2. Klicke "Neues Projekt"
 * 3. Lösche den Code und füge DIESEN Code ein
 * 4. Klicke "Bereitstellen" → "Neue Bereitstellung"
 * 5. Typ: "Web-App"
 * 6. Ausführen als: "Ich"
 * 7. Zugriff: "Jeder"
 * 8. Klicke "Bereitstellen"
 * 9. Kopiere die URL und gib sie Patrick/Claude
 *
 * UMSCHALTEN:
 * In Firebase: settings/sms/gateway = "proxy" → nutzt dieses Script
 *              settings/sms/gateway = "queue" → nutzt eigenes Handy (sms-gateway.html)
 */
const SEVEN_API_KEY = 'qqZJ5u9mutCqW1ojrLtZQIlpQ72iigqS67TQh4RQy9bTe6d6PmhXv5aU14NJkSVU';

function doPost(e) {
  try {
    // JSON Input lesen
    const input = JSON.parse(e.postData.contents);

    if (!input.to || !input.text) {
      return ContentService.createTextOutput(JSON.stringify({
        error: 'Missing parameters: to, text'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // SMS an seven.io senden
    const response = UrlFetchApp.fetch('https://gateway.seven.io/api/sms', {
      method: 'POST',
      headers: {
        'X-Api-Key': SEVEN_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify({
        to: input.to,
        text: input.text,
        from: input.from || 'FunkTaxi'
      }),
      muteHttpExceptions: true
    });

    // Antwort zurückgeben
    return ContentService.createTextOutput(response.getContentText())
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Test-Funktion (optional)
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'OK',
    message: 'SMS Proxy für Funk Taxi Heringsdorf',
    usage: 'POST mit {to: "49171xxx", text: "Nachricht", from: "FunkTaxi"}'
  })).setMimeType(ContentService.MimeType.JSON);
}
