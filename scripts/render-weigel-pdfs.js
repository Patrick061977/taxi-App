#!/usr/bin/env node
// render-weigel-pdfs.js — Patrick 05.06.2026 10:41: 'erstmal Weigel fertig'.
// Rendert alle 6 Briefe in briefe/ als PDF via puppeteer-core + marked.

const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Taxi App/taxi-App-github/functions/node_modules/puppeteer-core');
const { marked } = require('C:/Taxi App/taxi-App-github/functions/node_modules/marked');

const BRIEFE_DIR = 'C:/Taxi App/taxi-App-github/briefe';
const OUT_DIR = 'C:/Taxi App/taxi-App-github/briefe/pdf';

const FILES = [
    '2026-06-02_Memo_RA_Weigel_Kaiserbaederlinie_VVG.md',
    '2026-06-04_Memo-V2_RA_Weigel_Kaiserbaederlinie_Schutzklauseln.md',
    '2026-06-04_IFG_LSBV_Pruefung_Taxiverdraengung.md',
    '2026-06-04_IFG_LK_VG_Anhoerung_Taxiverdraengung.md',
    '2026-06-05_Update_RA_Weigel_Kaiserbaederlinie_Botenfunde.md',
    '2026-06-05_Story_Chronologie_Kurkartenbus_Heringsdorf.md',
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel.md',
    '2026-06-05_Faktentafel_Kurkartenbus_Weigel_ERWEITERUNG.md',
    '2026-06-05_Sektion_P_Linienprofil_290_291.md',
    '2026-06-05_Sektion_Q_Eigen_Gestaendnisse_Tourismus.md',
    '2026-06-05_Sektion_Q9_Personen_Zitate.md',
    '2026-06-05_Sektion_R_Vertragstext_Bekanntmachungen.md',
    '2026-06-05_IFG_LSBV_MV_Konzession_290_291.md',
    '2026-06-06_Sektion_S_Konzern_Doppelverdraengung_VVG.md',
    '2026-06-06_Sektion_T_Innerer_Widerspruch_Tourismus_vs_Paragraf_42.md',
    '2026-06-06_Sektion_U_Vergleich_Kurorte_und_Alternativen.md',
    '2026-06-13_Notruf_Tariferhoehung_Bundesvergleich.md',
    '2026-06-13_Faktentafel_V3_PBefG_Tarif_Kurabgabe_Gesetzesverletzungen.md',
];

const CHROME_PATHS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Users/Taxi/AppData/Local/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
    for (const p of CHROME_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const HEADER_CSS = `
<style>
  @page { size: A4; margin: 25mm 22mm 25mm 22mm; }
  body { font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
  h1 { color: #0c4a6e; font-size: 18pt; border-bottom: 2px solid #0c4a6e; padding-bottom: 6px; margin-top: 18px; }
  h2 { color: #0c4a6e; font-size: 14pt; margin-top: 18px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  h3 { color: #1e40af; font-size: 12pt; margin-top: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10pt; }
  table th, table td { border: 1px solid #94a3b8; padding: 5px 8px; text-align: left; vertical-align: top; }
  table th { background: #e0f2fe; font-weight: 600; }
  code { font-family: 'Consolas', 'Courier New', monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  pre { background: #f1f5f9; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 9pt; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 4px solid #0c4a6e; margin: 8px 0; padding: 4px 12px; color: #334155; background: #f1f5f9; font-style: italic; }
  hr { border: none; border-top: 1px solid #cbd5e1; margin: 18px 0; }
  ul, ol { padding-left: 24px; }
  li { margin: 3px 0; }
  strong { color: #0c4a6e; }
  a { color: #0c4a6e; }
  .footer { font-size: 9pt; color: #64748b; text-align: center; margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 8px; }
</style>
`;

function mdToHtml(md, title) {
    const html = marked.parse(md);
    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>${title}</title>${HEADER_CSS}</head>
<body>
${html}
<div class="footer">Mandanteneigene Recherche · Patrick Wydra, Funk Taxi Heringsdorf · ${new Date().toLocaleDateString('de-DE')}</div>
</body></html>`;
}

(async () => {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const chromePath = findChrome();
    if (!chromePath) {
        console.error('Kein Chrome/Edge gefunden in:', CHROME_PATHS);
        process.exit(1);
    }
    console.log('Browser:', chromePath);

    const browser = await puppeteer.launch({
        executablePath: chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: 'new',
    });

    for (const fname of FILES) {
        const src = path.join(BRIEFE_DIR, fname);
        const md = fs.readFileSync(src, 'utf8');
        const title = fname.replace('.md', '');
        const html = mdToHtml(md, title);
        const tmpHtml = path.join(OUT_DIR, fname.replace('.md', '.html'));
        fs.writeFileSync(tmpHtml, html);

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const out = path.join(OUT_DIR, fname.replace('.md', '.pdf'));
        await page.pdf({
            path: out,
            format: 'A4',
            margin: { top: '25mm', bottom: '25mm', left: '22mm', right: '22mm' },
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size:8pt;color:#64748b;width:100%;text-align:right;margin:5mm 22mm 0 0;">Patrick Wydra · Funk Taxi Heringsdorf · Kurkartenbus-Mandat</div>',
            footerTemplate: '<div style="font-size:8pt;color:#64748b;width:100%;text-align:center;margin:0 22mm 5mm 22mm;">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>',
        });
        await page.close();
        console.log('✓', out);
    }

    await browser.close();
    console.log('\n6 PDFs gerendert in:', OUT_DIR);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
