// Сборка: src/template.html + engine.js + i18n.json + fonts.css → index.html (одна страница без внешних запросов).
// Запуск из корня репозитория: node src/build.mjs
import fs from 'node:fs';

const src = new URL('.', import.meta.url).pathname;
const root = new URL('..', import.meta.url).pathname;
const read = f => fs.readFileSync(src + f, 'utf8');

const I18N = JSON.parse(read('i18n.json'));
const ru = Object.keys(I18N.ru).sort().join('|');
for (const l of Object.keys(I18N)) {
  if (Object.keys(I18N[l]).sort().join('|') !== ru) {
    const a = Object.keys(I18N.ru), b = Object.keys(I18N[l]);
    throw new Error(`Ключи ${l} не совпадают с ru: нет ${a.filter(x => !b.includes(x))}, лишние ${b.filter(x => !a.includes(x))}`);
  }
}

const out = read('template.html')
  .replace('/*__FONTS__*/', () => read('fonts.css'))
  .replace('/*__ENGINE__*/', () => read('engine.js'))
  .replace('/*__I18N__*/', () => JSON.stringify(I18N, null, 1));

// каждый ключ, который запрашивает страница, должен быть в словаре
const used = new Set([...out.matchAll(/\bt\('([\w.]+)'/g), ...out.matchAll(/data-i18n="([\w.]+)"/g)].map(m => m[1]));
const missing = [...used].filter(k => !(k in I18N.ru) && !k.startsWith('info.'));
if (missing.length) throw new Error('В словаре нет ключей: ' + missing.join(', '));
if (/fonts\.(googleapis|gstatic)\.com/.test(out)) throw new Error('В странице остались ссылки на Google Fonts');

fs.writeFileSync(root + 'index.html', out);
console.log(`index.html собран: ${Object.keys(I18N.ru).length} ключей × ${Object.keys(I18N).length} языков`);
