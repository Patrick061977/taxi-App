const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const CHROME_PROFILE = 'C:\\Users\\Taxi\\AppData\\Local\\Google\\Chrome\\User Data-playwright';

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    channel: 'chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await browser.newPage();
  await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Screenshot vor Create-Click
  await page.screenshot({ path: path.join(__dirname, '../.tmp_yt_before.png'), fullPage: false });
  console.log('📸 Screenshot vor Create-Click gespeichert');

  // Create-Button klicken
  const createBtn = page.locator('ytcp-button#create-icon, button[aria-label="Erstellen"], button[aria-label="Create"]').first();
  await createBtn.click({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Screenshot nach Create-Click (zeigt das Dropdown)
  await page.screenshot({ path: path.join(__dirname, '../.tmp_yt_dropdown.png'), fullPage: false });
  console.log('📸 Screenshot nach Create-Click (Dropdown) gespeichert');

  // Alle sichtbaren menu items ausgeben
  const items = await page.locator('[role="menuitem"], tp-yt-paper-item, ytcp-text-menu paper-item').all();
  console.log(`\n📋 ${items.length} Menu-Items gefunden:`);
  for (const item of items) {
    const text = await item.innerText().catch(() => '');
    const tag = await item.evaluate(el => el.tagName).catch(() => '?');
    const testId = await item.getAttribute('test-id').catch(() => '');
    if (text.trim()) console.log(`  [${tag}] test-id="${testId}" → "${text.trim()}"`);
  }

  await page.waitForTimeout(5000);
  await browser.close();
})();
