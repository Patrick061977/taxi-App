const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const VIDEOS = [
  {
    file: path.resolve(__dirname, '../assets/videos/ddr-museum-dargen.mp4'),
    title: 'Zeitreise ohne Fußweg? Geht! 🚕 DDR Museum Dargen auf Usedom | Kein Bock zu Laufen',
    description: `Entdecke das DDR Museum Dargen auf Usedom – ein einzigartiges Ausflugsziel für die ganze Familie!\n\nKein Bock zu laufen? Wir fahren dich hin! 🚕\nFunk Taxi Heringsdorf – dein Taxi-Service auf Usedom.\n\n📞 038378 / 22022\n🌐 keinbockzulaufen.de\n👉 https://keinbockzulaufen.de\n\nHeringsdorf • Ahlbeck • Bansin • und ganz Usedom`,
    tags: ['DDR Museum Dargen', 'Usedom', 'Ausflugsziel', 'Taxi Heringsdorf', 'Kein Bock zu Laufen', 'Funk Taxi', 'Usedom Ausflug'],
  },
  {
    file: path.resolve(__dirname, '../assets/videos/karls-erdbeerhof.mp4'),
    title: 'Erdbeeren pflücken ohne Schwitzen 🍓 Karls Erdbeerhof mit dem Taxi | Kein Bock zu Laufen',
    description: `Karls Erdbeerhof – das Erlebnis-Ausflugsziel für Familien!\n\nKein Bock zu laufen? Wir fahren dich hin! 🚕\nFunk Taxi Heringsdorf – dein Taxi-Service auf Usedom.\n\n📞 038378 / 22022\n🌐 keinbockzulaufen.de\n👉 https://keinbockzulaufen.de\n\nHeringsdorf • Ahlbeck • Bansin • und ganz Usedom`,
    tags: ['Karls Erdbeerhof', 'Usedom', 'Ausflugsziel', 'Taxi Heringsdorf', 'Kein Bock zu Laufen', 'Funk Taxi', 'Familie Ausflug'],
  },
  {
    file: path.resolve(__dirname, '../assets/videos/niemeyer-holstein.mp4'),
    title: 'Runter vom Sofa – aber nur mit Taxi 🚕 Niemeyer Holstein Usedom | Kein Bock zu Laufen',
    description: `Niemeyer Holstein – ein besonderes Ausflugsziel auf und um Usedom!\n\nKein Bock zu laufen? Wir fahren dich hin! 🚕\nFunk Taxi Heringsdorf – dein Taxi-Service auf Usedom.\n\n📞 038378 / 22022\n🌐 keinbockzulaufen.de\n👉 https://keinbockzulaufen.de\n\nHeringsdorf • Ahlbeck • Bansin • und ganz Usedom`,
    tags: ['Niemeyer Holstein', 'Usedom', 'Ausflugsziel', 'Taxi Heringsdorf', 'Kein Bock zu Laufen', 'Funk Taxi'],
  },
  {
    file: path.resolve(__dirname, '../assets/videos/villa-irmgard.mp4'),
    title: 'Kaiserzeit erleben – wir fahren dich hin 🏛️ Villa Irmgard Heringsdorf | Kein Bock zu Laufen',
    description: `Die Villa Irmgard in Heringsdorf – ein historisches Highlight auf Usedom!\n\nKein Bock zu laufen? Wir fahren dich hin! 🚕\nFunk Taxi Heringsdorf – dein Taxi-Service auf Usedom.\n\n📞 038378 / 22022\n🌐 keinbockzulaufen.de\n👉 https://keinbockzulaufen.de\n\nHeringsdorf • Ahlbeck • Bansin • und ganz Usedom`,
    tags: ['Villa Irmgard', 'Heringsdorf', 'Usedom', 'Ausflugsziel', 'Taxi Heringsdorf', 'Kein Bock zu Laufen', 'Funk Taxi'],
  },
  {
    file: path.resolve(__dirname, '../assets/videos/weisse-duene.mp4'),
    title: 'Natur pur – ohne einen Schritt zu viel 🌿 Weiße Düne Usedom | Kein Bock zu Laufen',
    description: `Die Weiße Düne – eines der schönsten Naturschutzgebiete auf Usedom!\n\nKein Bock zu laufen? Wir fahren dich hin! 🚕\nFunk Taxi Heringsdorf – dein Taxi-Service auf Usedom.\n\n📞 038378 / 22022\n🌐 keinbockzulaufen.de\n👉 https://keinbockzulaufen.de\n\nHeringsdorf • Ahlbeck • Bansin • und ganz Usedom`,
    tags: ['Weiße Düne', 'Usedom', 'Natur', 'Ausflugsziel', 'Taxi Heringsdorf', 'Kein Bock zu Laufen', 'Funk Taxi'],
  },
];

// Chrome erlaubt kein Remote-Debugging auf dem Standard-Profil → Kopie verwenden
const CHROME_PROFILE_REAL = 'C:\\Users\\Taxi\\AppData\\Local\\Google\\Chrome\\User Data';
const CHROME_PROFILE = CHROME_PROFILE_REAL + '-playwright';

async function ensureLoggedIn(page) {
  await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 30000 });
  // Falls Google Login-Seite → warten bis Patrick manuell einloggt (max 3 Min)
  const isLogin = page.url().includes('accounts.google.com') || page.url().includes('signin');
  if (isLogin) {
    console.log('\n⚠️  BITTE EINLOGGEN: Google-Login-Fenster ist offen.');
    console.log('   Gib dein Passwort ein — das Script wartet automatisch (max 3 Min)...\n');
    await page.waitForURL('*://studio.youtube.com/**', { timeout: 180000 });
    console.log('✅ Eingeloggt! Upload startet...\n');
    await page.waitForTimeout(2000);
  }
}

async function uploadVideo(page, video) {
  console.log(`\n▶ Uploading: ${video.title}`);

  await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click "Create" button
  const createBtn = page.locator('ytcp-button#create-icon, button[aria-label="Erstellen"], button[aria-label="Create"]').first();
  await createBtn.click({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // Click "Videos hochladen" — test-id="upload" ist stabiler als Text
  const uploadOption = page.locator('tp-yt-paper-item[test-id="upload"], tp-yt-paper-item:has-text("Videos hochladen"), tp-yt-paper-item:has-text("Upload video")').first();
  await uploadOption.click();
  await page.waitForTimeout(2000);

  // Upload file via file input
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(video.file);
  console.log(`  📁 Datei wird hochgeladen...`);

  // Dialog kann hidden sein — state:'attached' reicht, warten bis workflow-step="DETAILS"
  await page.waitForSelector('ytcp-uploads-dialog', { timeout: 60000, state: 'attached' });
  // Warten bis Details-Tab sichtbar (Titel-Feld vorhanden)
  await page.waitForSelector('#title-textarea, ytcp-social-suggestions-textbox[label="Titel"]', { timeout: 60000, state: 'attached' });
  await page.waitForTimeout(2000);

  // Fill title
  const titleField = page.locator('#title-textarea div[contenteditable="true"], ytcp-social-suggestions-textbox[label="Titel"] #textbox').first();
  await titleField.click({ force: true });
  await page.keyboard.press('Control+A');
  await titleField.type(video.title);
  console.log(`  ✏️  Titel gesetzt`);

  await page.waitForTimeout(1000);

  // Fill description
  const descField = page.locator('#description-textarea div[contenteditable="true"], ytcp-social-suggestions-textbox[label="Beschreibung"] #textbox').first();
  await descField.click({ force: true });
  await descField.type(video.description);
  console.log(`  📝 Beschreibung gesetzt`);

  await page.waitForTimeout(1000);

  // "Not made for kids"
  const notForKids = page.locator('tp-yt-paper-radio-button[name="NOT_MADE_FOR_KIDS"]').first();
  if (await notForKids.isVisible()) {
    await notForKids.click();
    console.log(`  👶 "Nicht für Kinder" gesetzt`);
  }

  await page.waitForTimeout(1000);

  // Click "Next" 3 times (Details → Monetization → Visibility)
  for (let i = 0; i < 3; i++) {
    const nextBtn = page.locator('ytcp-button#next-button, button:has-text("Weiter"), button:has-text("Next")').first();
    await nextBtn.click();
    console.log(`  ➡️  Weiter (${i + 1}/3)`);
    await page.waitForTimeout(2000);
  }

  // Set visibility to "Public"
  const publicOption = page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').first();
  if (await publicOption.isVisible()) {
    await publicOption.click();
    console.log(`  🌍 Sichtbarkeit: Öffentlich`);
  }

  await page.waitForTimeout(1000);

  // Wait for done-button to become active: YouTube REMOVES aria-disabled, doesn't set it to "false"
  console.log(`  ⏳ Warte auf Verarbeitung (max 10 Min)...`);
  await page.waitForFunction(() => {
    const btn = document.querySelector('ytcp-button#done-button');
    if (!btn) return false;
    // Active when aria-disabled is gone (not "true") and element is visible
    return btn.getAttribute('aria-disabled') !== 'true' && btn.offsetParent !== null;
  }, null, { timeout: 600000, polling: 2000 });
  console.log(`  ✅ Button aktiv — veröffentliche...`);
  await page.locator('ytcp-button#done-button').first().click({ force: true });
  console.log(`  ✅ Veröffentlicht!`);

  await page.waitForTimeout(5000);
}

(async () => {
  console.log('🚀 YouTube Upload startet...');
  console.log(`📂 Chrome-Profil: ${CHROME_PROFILE}`);

  // Auth-Dateien aus echtem Chrome-Profil in Playwright-Kopie übertragen
  const pwDefault = path.join(CHROME_PROFILE, 'Default');
  fs.mkdirSync(pwDefault, { recursive: true });
  const authFiles = ['Cookies', 'Login Data'];
  for (const f of authFiles) {
    const src = path.join(CHROME_PROFILE_REAL, 'Default', f);
    const dst = path.join(pwDefault, f);
    if (fs.existsSync(src)) { try { fs.copyFileSync(src, dst); } catch (_) {} }
  }
  console.log('📋 Chrome-Profil (Auth) nach Playwright-Kopie übertragen');

  // Chrome schließen falls offen (sonst crasht launchPersistentContext)
  try {
    execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' });
    console.log('🔴 Chrome geschlossen — starte neu...');
    await new Promise(r => setTimeout(r, 2000));
  } catch (_) { /* Chrome war nicht offen — OK */ }

  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    channel: 'chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await browser.newPage();

  // Login sicherstellen vor erstem Upload
  await ensureLoggedIn(page);

  for (const video of VIDEOS) {
    try {
      await uploadVideo(page, video);
      console.log(`✅ Fertig: ${path.basename(video.file)}`);
    } catch (err) {
      console.error(`❌ Fehler bei ${path.basename(video.file)}:`, err.message);
    }
    await page.waitForTimeout(3000);
  }

  console.log('\n🎉 Alle Videos hochgeladen!');
  await browser.close();
})();
