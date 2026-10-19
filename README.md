# Gewinnrechner

**DE:** Vereinfachter Rechner für Gründerinnen und Gründer in Deutschland: Wie viele Stunden oder Produkte müssen Sie verkaufen, damit nach Kosten, Kranken- und Pflegeversicherung, Altersvorsorge und Steuern genug zum Leben bleibt — oder was bei einem bestimmten Absatz übrig bleibt. Mit Kleinunternehmerregelung (§19 UStG) und Wechsel zur Umsatzsteuer.

**EN:** A simplified calculator for people starting a business in Germany: how much you need to sell to cover costs, health insurance, pension and taxes — or what is left at a given sales volume.

> Vereinfachte Schätzung, keine Steuer- oder Rechtsberatung. Alle Angaben ohne Gewähr.

---

## Что это

Одна статическая страница (`index.html`) без сервера и внешних запросов. Языки: немецкий (по умолчанию), русский, английский, турецкий, арабский.

Два режима:
- **Сколько продавать** — задаёте, сколько нужно на личные расходы, и видите нужный объём продаж по годам;
- **Какой будет доход** — задаёте объём продаж и видите, что останется.

Учитывается:
- подоходный налог по §32a EStG;
- Soli;
- церковный налог 8 или 9 %;
- Gewerbesteuer с зачётом по §35 EStG;
- GKV или PKV и Pflege;
- пенсия (обычные накопления или DRV/Rürup);
- Kleinunternehmer: лимиты 25 000 / 100 000 €, право на льготу по фактическому обороту прошлого года, НДС на всю операцию, которая пересекает лимит.

Все упрощения перечислены на самой странице в блоке «So rechnen wir».

## Структура

| Файл | Что внутри |
|---|---|
| `index.html` | готовая страница (собирается из `src/`, руками не править) |
| `fonts/` | шрифты Golos Text, Unbounded, JetBrains Mono, IBM Plex Sans Arabic (SIL OFL 1.1, лицензии рядом) |
| `src/engine.js` | расчётное ядро — чистые функции без DOM; параметры по годам в `RATES` |
| `src/template.html` | разметка, стили и интерфейс |
| `src/i18n.json` | тексты на 5 языках |
| `src/fonts.css` | `@font-face` для локальных шрифтов |
| `src/build.mjs` | сборка `index.html` |
| `src/tests.mjs` | проверки расчётного ядра |

## Как менять

Нужен только Node.js 18+, зависимостей нет.

```bash
node src/build.mjs          # собрать index.html
node src/tests.mjs          # проверить ядро
node src/tests.mjs index.html   # проверить ядро внутри собранной страницы
```

**Новый налоговый год:** добавьте строку в `RATES` в `src/engine.js` (тариф §32a, Freigrenze Soli, BBG и минимальная база GKV, средний Zusatzbeitrag, Pflege, потолок вычета DRV/Rürup), пересоберите и запустите тесты. Пока строки для года нет, страница использует последние известные значения и пишет, что это прогноз.

**Тексты:** правьте `src/i18n.json`. Сборка проверяет, что у всех языков одинаковый набор ключей.

## Данные посетителей

Страница не использует cookies, аналитику и внешние сервисы. Настройки сохраняются в `localStorage` браузера, только если посетитель сам отметил «Meine Einstellungen speichern». Если снять галочку, сохранённые данные удаляются. Хостинг — GitHub Pages; GitHub по своей документации записывает IP-адреса посетителей.
