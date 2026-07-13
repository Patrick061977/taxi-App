const fs = require('fs');
const puppeteer = require('C:/Taxi App/taxi-App-github/functions/node_modules/puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Users/Taxi/AppData/Local/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new'});
  const p=await b.newPage();
  const h='C:/Taxi App/taxi-App-github/briefe/pdf/2026-07-06_Befund-Zusammenfassung_Gramsch.html';
  await p.goto('file://'+h,{waitUntil:'load'});
  await p.pdf({path:h.replace('.html','.pdf'),format:'A4',printBackground:true,margin:{top:'20mm',right:'20mm',bottom:'20mm',left:'20mm'}});
  await b.close();
  console.log('PDF: '+h.replace('.html','.pdf')+' '+Math.round(fs.statSync(h.replace('.html','.pdf')).size/1024)+'KB');
})();
