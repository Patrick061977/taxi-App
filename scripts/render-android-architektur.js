const fs = require('fs');
const puppeteer = require('C:/Taxi App/taxi-App-github/functions/node_modules/puppeteer-core');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Users/Taxi/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find(p => fs.existsSync(p));

const HTML = 'C:/Taxi App/taxi-App-github/briefe/pdf/android-app-architektur.html';
const PDF  = HTML.replace('.html', '.pdf');

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await b.newPage();
  await p.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await p.pdf({ path: PDF, format: 'A4', printBackground: true, margin: { top: '12mm', right: '14mm', bottom: '12mm', left: '14mm' } });
  await b.close();
  const kb = Math.round(fs.statSync(PDF).size / 1024);
  console.log('PDF erstellt:', PDF, kb + 'KB');
})().catch(e => { console.error(e); process.exit(1); });
