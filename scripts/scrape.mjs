import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  });

  // Interceptar respuestas JSON que contengan datos del versículo
  let captured = null;
  page.on('response', async (response) => {
    if (captured) return;
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('json') || response.url().includes('/_next/')) return;
    try {
      const text = await response.text();
      if (!text.includes('"text"') && !text.includes('"verse"')) return;
      const data = JSON.parse(text);
      const str = JSON.stringify(data);
      if (str.includes('human_reference') || str.includes('votd') || str.includes('verse_of_the_day')) {
        captured = data;
      }
    } catch {}
  });

  await page.goto('https://www.bible.com/es/verse-of-the-day', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Esperar a que React renderice el contenido (imagen o texto del versículo)
  await page.waitForFunction(
    () => document.querySelectorAll('img').length > 3,
    { timeout: 15000 }
  ).catch(() => {});
  await page.waitForTimeout(2000);

  // Extraer datos del DOM como fallback
  const dom = await page.evaluate(() => {
    // Imágenes de la tarjeta del versículo
    const imgs = [
      ...Array.from(document.querySelectorAll('img')).map(i => i.src),
      ...Array.from(document.querySelectorAll('img[srcset]')).flatMap(i =>
        i.srcset.split(',').map(s => s.trim().split(' ')[0])
      ),
    ].filter(s => s.includes('imageproxy.youversionapi.com'));

    // __NEXT_DATA__
    let nextData = null;
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (el?.textContent) nextData = JSON.parse(el.textContent);
    } catch {}

    return {
      imgs: [...new Set(imgs)],
      nextData,
      ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
      desc: document.querySelector('meta[name="description"]')?.content || '',
      title: document.title,
    };
  });

  await browser.close();
  return { captured, dom };
}

function parseVerse({ captured, dom }) {
  // 1. Datos interceptados de la API interna
  if (captured) {
    const find = (obj, ...keys) => {
      if (!obj || typeof obj !== 'object') return null;
      for (const k of keys) if (obj[k] && typeof obj[k] === 'string') return obj[k];
      for (const v of Object.values(obj)) { const r = find(v, ...keys); if (r) return r; }
      return null;
    };
    const text = find(captured, 'text', 'verse_text', 'content');
    const reference = find(captured, 'human_reference', 'reference');
    const imageUrl = find(captured, 'url', 'image_url', 'src');
    if (text || imageUrl) return { text: text || '', reference: reference || '', imageUrl };
  }

  // 2. __NEXT_DATA__
  if (dom.nextData) {
    const pp = dom.nextData?.props?.pageProps;
    const votd = pp?.votd || pp?.verseOfTheDay || pp?.verse_of_the_day;
    if (votd) {
      const verse = votd.verse || votd;
      const img = (votd.images || [])[0] || votd.image;
      return {
        text: verse.text || '',
        reference: verse.human_reference || verse.reference || '',
        imageUrl: img?.url || img?.src || null,
      };
    }
  }

  // 3. DOM: imagen + título/descripción
  const titleMatch = dom.title.match(/([A-ZÁÉÍÓÚ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚ]?[a-záéíóúüñ]+)?\s+\d+:\d+)/);
  return {
    text: dom.desc || '',
    reference: titleMatch?.[1] || '',
    imageUrl: dom.imgs[0] || dom.ogImage || null,
  };
}

function generateHtml({ text, reference, imageUrl }) {
  const escaped = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const content = imageUrl
    ? `<img src="${escaped(imageUrl)}" alt="${escaped(reference)}" class="img" />`
    : `<div class="quote-card">
        <span class="quote-mark">“</span>
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

const { captured, dom } = await scrape();
const verse = parseVerse({ captured, dom });

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
