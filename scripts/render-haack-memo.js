#!/usr/bin/env node
const fs = require('fs');
const puppeteer = require('C:/Taxi App/taxi-App-github/functions/node_modules/puppeteer-core');

const CHROME_PATHS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Users/Taxi/AppData/Local/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

(async () => {
    const exe = CHROME_PATHS.find(p => fs.existsSync(p));
    if (!exe) { console.error('Kein Chrome/Edge'); process.exit(1); }
    const browser = await puppeteer.launch({ executablePath: exe, headless: 'new' });
    const page = await browser.newPage();
    const htmlPath = 'C:/Taxi App/taxi-App-github/briefe/pdf/2026-06-25_Memo_RA_Haack_NVP_vs_Realitaet_290_291.html';
    const pdfPath = htmlPath.replace('.html', '.pdf');
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top:'25mm', right:'22mm', bottom:'25mm', left:'22mm' } });
    await browser.close();
    console.log('PDF: ' + pdfPath);
    const sz = fs.statSync(pdfPath).size;
    console.log('Groesse: ' + Math.round(sz/1024) + ' KB');
})();
