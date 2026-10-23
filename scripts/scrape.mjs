import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = 'https://www.bible.com/es/verse-of-the-day';

async function fetchHtml() {
  const res = await fetch(PAGE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

function extractMeta(html, attr, value) {
  const r1 = new RegExp(`<meta\\s+${attr}="${value}"\\s+content="([^"]*)"`, 'i');
  const r2 = new RegExp(`<meta\\s+content="([^"]*)"\\s+${attr}="${value}"`, 'i');
  return (html.match(r1) || html.match(r2))?.[1] || '';
}

function extractVerseImages(html) {
  const seen = new Set();
  const results = [];
  for (const m of html.matchAll(/https:\/\/imageproxy\.youversionapi\.com\/(\d+x\d+)\/([^"'\s<>]+)/g)) {
    const url = m[0];
    if (url.includes('app-icons') || url.includes('app-icon')) continue;
    if (!seen.has(url)) { seen.add(url); results.push(url); }
  }
  return results;
}

async function scrape() {
  const html = await fetchHtml();

  const nextData = extractNextData(html);
  const ogImage = extractMeta(html, 'property', 'og:image');
  const desc = extractMeta(html, 'name', 'description');
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch?.[1] || '';
  const imgs = extractVerseImages(html);

  return { nextData, ogImage, desc, title, imgs };
}

function parseVerse({ nextData, ogImage, desc, title, imgs }) {
  // 1. __NEXT_DATA__
  if (nextData) {
    const pp = nextData?.props?.pageProps;
    const votd = pp?.votd || pp?.verseOfTheDay || pp?.verse_of_the_day;
    if (votd) {
      const verse = votd.verse || votd;
      const img = (votd.images || [])[0] || votd.image;
      return {
        text: verse.text || '',
        reference: verse.human_reference || verse.reference || '',
        imageUrl: img?.url || img?.src || imgs[0] || ogImage || null,
      };
    }
  }

  // 2. Images from page + meta text
  // Title format: "Versículo del Día - PROVERBIOS 16:3 - Biblia App"
  const refMatch = title.match(/[-–]\s*([^-–]+?\d+:\d+)\s*[-–]/);
  return {
    text: desc || '',
    reference: refMatch?.[1]?.trim() || '',
    imageUrl: ogImage || imgs[0] || null,
  };
}

function generateHtml({ text, reference, imageUrl }) {
  const escaped = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const content = imageUrl
    ? `<img src="${escaped(imageUrl)}" alt="${escaped(reference)}" class="img" />`
    : `<div class="quote-card">
        <span class="quote-mark">"</span>
        <p class="verse-text">${escaped(text)}</p>
      </div>`;

  const ref = reference ? `<p class="reference">${escaped(reference)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Versículo del Día — ${escaped(reference)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: Georgia, serif;
    }
    .card {
      width: 100%;
      max-width: 460px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .img {
      width: 100%;
      border-radius: 16px;
      box-shadow: 0 20px 48px rgba(0,0,0,0.55);
      display: block;
    }
    .quote-card {
      width: 100%;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 16px;
      padding: 32px;
      text-align: center;
    }
    .quote-mark {
      display: block;
      color: #818cf8;
      font-size: 72px;
      line-height: 0.5;
      margin-bottom: 20px;
    }
    .verse-text {
      color: #f1f5f9;
      font-size: 18px;
      line-height: 1.8;
      font-style: italic;
    }
    .reference {
      color: #a5b4fc;
      font-family: -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    a {
      color: #334155;
      font-family: -apple-system, sans-serif;
      font-size: 11px;
      text-decoration: none;
    }
    a:hover { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    ${content}
    ${ref}
    <a href="https://www.bible.com/es/verse-of-the-day" target="_blank" rel="noopener">
      bible.com — Versículo del Día
    </a>
  </div>
</body>
</html>`;
}

const { nextData, ogImage, desc, title, imgs } = await scrape();
const verse = parseVerse({ nextData, ogImage, desc, title, imgs });

console.log('📖', verse.reference || '(sin referencia)');
console.log('🖼 ', verse.imageUrl ? 'imagen encontrada' : 'usando texto');

if (!verse.imageUrl && !verse.text) {
  console.error('❌ No se pudo obtener el versículo');
  process.exit(1);
}

const html = generateHtml(verse);
const out = path.join(ROOT, 'index.html');
fs.writeFileSync(out, html, 'utf-8');
console.log('✅ index.html generado');
