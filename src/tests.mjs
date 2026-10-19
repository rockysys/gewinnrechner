// Проверки расчётного ядра. Запуск из корня: node src/tests.mjs  (или node src/tests.mjs index.html — проверить собранную страницу)
// Ожидаемые значения посчитаны отдельно (формула §32a в Python, ручные расчёты НДС и взносов), а не этим кодом.
import fs from 'node:fs';
import vm from 'node:vm';

const src = process.argv[2] || new URL('./engine.js', import.meta.url).pathname; // или путь к index.html
let code = fs.readFileSync(src, 'utf8');
if (src.endsWith('.html')) code = code.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const sandbox = {};
vm.runInNewContext(code + '\nglobalThis.E = NettoEngine;', sandbox);
const E = sandbox.E;
const R26 = E.RATES[2026];

let pass = 0, fail = 0;
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
function check(name, cond, info = '') {
  if (cond) { pass++; } else { fail++; console.log('FAIL', name, info); }
}

// Базовый сценарий без побочных расходов, чтобы проверять одно правило за раз
const base = over => Object.assign({
  calc: 'have', mode: 'goods', price: 100, qty: 0, target: 2000, mat: 0, clients: 'b2c',
  fixed: 0, bizVat: 0, bizNo: 0, priv: 0, vatShare: 0, invoice: 1000,
  kv: 'pkv', pkv: 0, pkvDed: null, kg: true, kids: false, zus: 2.9,
  pens: 0, pensType: 'save', ku: true, kind: 'frei', heb: 400, church: 0,
  startY: 2026, startM: 1
}, over);
const ctx = over => Object.assign({ year: 2026, R: R26, months: 12, startCal: 1, ku: true, limit: 25000 }, over);

// 1. Тариф §32a EStG 2026
for (const [zve, tax] of [[12348, 0], [12349, 0], [15000, 435], [17799, 1034], [17800, 1035], [40000, 7209], [69878, 18213], [80000, 22464], [300000, 115529]])
  check(`ESt(${zve})`, E.incomeTax(zve, R26) === tax, E.incomeTax(zve, R26));

// 2. Soli: Freigrenze 20 350 €, 11,9 % в зоне смягчения, доли цента отбрасываются
check('Soli на пороге', E.soli(20350, R26) === 0);
check('Soli 20 364 € → 1,66 €', E.soli(20364, R26) === 1.66, E.soli(20364, R26));
check('Soli 30 000 € (зона смягчения)', near(E.soli(30000, R26), 1148.35, 0.001), E.soli(30000, R26));
check('Soli 40 000 € → полные 5,5 %', near(E.soli(40000, R26), 2200, 0.001));

// 3. Неполный первый год: 9 000 € оборота не пересчитываются в 36 000 €
{
  const P = base({ calc: 'have', mode: 'hours', price: 100, qty: 30, startM: 10 });
  const pl = E.plan(P);
  check('Неполный год: оборот 9 000 €', near(pl[0].res.rev, 9000));
  check('Неполный год: во 2-м году KU сохраняется', pl[1].ctx.ku === true);
  check('2-й год: 36 000 € ≤ 100 000 € — весь год без НДС', pl[1].res.kuAll === true);
  check('3-й год: прошлый оборот 36 000 € > 25 000 € — без KU', pl[2].ctx.ku === false);
}

// 4. Ровно на пороге — ещё без НДС; следующая операция целиком с НДС
{
  const P = base({ price: 12500, qty: 1 });
  const r = E.yearCalc(P, 1, ctx({ months: 3, startCal: 10 }));
  check('Порог 25 000 € ровно: 2-я продажа без НДС, переход в декабре', r.switchCal === 12, r.switchCal);
  check('Порог: НДС с 3-й продажи целиком', near(r.vatOut, 1995.80), r.vatOut);
  check('Порог: оборот 35 504,20 €', near(r.rev, 35504.20), r.rev);
}

// 5. Три продажи по 10 000 € при фиксированной цене для частных клиентов
{
  const P = base({ calc: 'have', price: 10000, qty: 1, startM: 10 });
  const pl = E.plan(P);
  const r = pl[0].res;
  check('3 × 10 000 €: НДС только с 3-й продажи и целиком', near(r.vatOut, 1596.64), r.vatOut);
  check('3 × 10 000 €: выручка 28 403,36 €', near(r.rev, 28403.36), r.rev);
  check('3 × 10 000 €: во 2-м году KU нет', pl[1].ctx.ku === false);
}

// 6. Лимит 100 000 € во 2-м году: операция, пересекающая лимит, целиком с НДС
{
  const P = base({ price: 1000, qty: 10 });
  const r = E.yearCalc(P, 10, ctx({ limit: 100000 }));
  check('100 000 € ровно за 10 месяцев — переход в 11-м', r.switchCal === 11, r.switchCal);
  check('НДС за 2 месяца', near(r.vatOut, 20 * (1000 - 1000 / 1.19)), r.vatOut);
}

// 7. Часы: размер операции = средний счёт
{
  const P = base({ mode: 'hours', price: 100, invoice: 3000 });
  const r = E.yearCalc(P, 100, ctx({}));
  check('Часы: переход в марте', r.switchCal === 3, r.switchCal);
  check('Часы: в марте без НДС только один целый счёт', near(r.rev, 104512.61), r.rev);
}

// 8. Пенсия: обычные накопления не уменьшают налог, DRV/Rürup — уменьшают
{
  const P = base({ mode: 'hours', clients: 'b2b', price: 100, ku: false, pens: 500 });
  const save = E.yearCalc(Object.assign({}, P, { pensType: 'save' }), 50, ctx({ ku: false }));
  const drv = E.yearCalc(Object.assign({}, P, { pensType: 'drv' }), 50, ctx({ ku: false }));
  check('Прибыль 60 000 €', near(save.G, 60000));
  check('ETF: налог как без пенсии (zvE 59 964 €)', save.estTarif === 14219, save.estTarif);
  check('DRV: zvE меньше на 6 000 € (53 964 €)', drv.estTarif === 11967, drv.estTarif);
  check('ETF: деньги на пенсию всё равно уходят', near(save.pens, 6000));
}

// 9. Kirchensteuer при Gewerbe: от налога до зачёта §35, Soli — после
{
  const P = base({ mode: 'hours', clients: 'b2b', price: 100, ku: false, kind: 'gew', heb: 400, church: 9 });
  const r = E.yearCalc(P, 50, ctx({ ku: false }));
  check('GewSt: (60 000 − 24 500) × 3,5 % × 400 % = 4 970 €', near(r.gew, 4970), r.gew);
  check('Зачёт §35 = 4 970 €', near(r.credit, 4970), r.credit);
  check('ESt после зачёта 9 249 €', near(r.est, 9249), r.est);
  check('KiSt 9 % от 14 219 € = 1 279,71 €', near(r.kist, 1279.71), r.kist);
  check('Soli 0 (ESt ниже Freigrenze)', r.soli === 0);
}

// 10. Нулевая выручка и убыток
{
  const P = base({ kv: 'gkv', fixed: 200 });
  const r = E.yearCalc(P, 0, ctx({}));
  const vals = Object.values(r).filter(v => typeof v === 'number');
  check('Нулевая выручка: нет NaN/Infinity', vals.every(Number.isFinite));
  check('Нулевая выручка: минимальный взнос GKV 3 432,93 €', near(r.kv, 3432.93), r.kv);
  check('Убыток: налогов нет', r.tax === 0 && r.gew === 0);
  check('Убыток: остаток отрицательный', r.life < 0);
  const g = E.yearCalc(base({ kind: 'gew', fixed: 500 }), 1, ctx({}));
  check('Убыток при Gewerbe: GewSt 0', g.gew === 0 && g.G < 0);
}

// 11. Возмещение НДС: входной НДС больше исходящего
{
  const P = base({ clients: 'b2b', ku: false, fixed: 3000, vatShare: 1 });
  const r = E.yearCalc(P, 1, ctx({ ku: false }));
  check('Входной НДС 478,99 € в месяц', near(r.vatIn, 12 * 478.99, 0.1), r.vatIn);
  check('НДС к уплате отрицательный (возврат)', r.vatOut - r.vatIn < 0);
  check('Расходы после вычета НДС', near(r.costNet, 36000 - r.vatIn));
}

// 12. PKV: вычитается указанная часть, а не фиксированные 80 %
{
  const a = E.yearCalc(base({ pkv: 500, pkvDed: 400 }), 0, ctx({}));
  const b = E.yearCalc(base({ pkv: 500, pkvDed: null }), 0, ctx({}));
  check('PKV: вычет 4 800 € при указанных 400 €/мес', near(a.kvDed, 4800));
  check('PKV: без указания — весь взнос', near(b.kvDed, 6000));
}

// 13. Денежный баланс на случайных сценариях
{
  let bad = 0, seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const P = base({
      mode: rnd() < .5 ? 'hours' : 'goods', price: 5 + rnd() * 2000, mat: rnd() * 0.6, clients: rnd() < .5 ? 'b2c' : 'b2b',
      fixed: rnd() * 3000, bizVat: rnd() * 200, bizNo: rnd() * 50, priv: rnd() * 100, vatShare: rnd(), invoice: 100 + rnd() * 5000,
      kv: rnd() < .5 ? 'gkv' : 'pkv', pkv: 300 + rnd() * 500, kg: rnd() < .5, kids: rnd() < .5,
      pens: rnd() * 800, pensType: rnd() < .5 ? 'save' : 'drv', ku: rnd() < .7, kind: rnd() < .5 ? 'frei' : 'gew',
      church: [0, 8, 9][Math.floor(rnd() * 3)]
    });
    const r = E.yearCalc(P, rnd() * 200, ctx({ ku: P.ku, months: 1 + Math.floor(rnd() * 12), limit: rnd() < .5 ? 25000 : 100000 }));
    const out = r.costNet + r.vatOut + r.kv + r.pens + r.priv + r.tax + r.gew + r.life;
    if (!near(out, r.clientPaid, 1e-6)) bad++;
  }
  check('Баланс: платежи клиентов = расходы + НДС + страховки + налоги + остаток (300 сценариев)', bad === 0, bad);
}

// 14. Подбор объёма согласован с прямым расчётом и минимален
{
  let bad = 0;
  for (const over of [
    { calc: 'need', mode: 'hours', price: 70, target: 2500, kv: 'gkv', fixed: 300, bizVat: 175, bizNo: 15, priv: 24, pens: 200 },
    { calc: 'need', mode: 'goods', price: 60, mat: 0.35, target: 2000, kv: 'gkv', fixed: 500 },
    { calc: 'need', mode: 'hours', price: 120, clients: 'b2b', target: 5000, kv: 'pkv', pkv: 600, kind: 'gew', church: 9 }
  ]) {
    for (const p of E.plan(base(over))) {
      if (p.status !== 'ok') { bad++; continue; }
      const r = p.res;
      if (r.lifeM < over.target - 1e-6) bad++;
      if (r.q > 0 && E.yearCalc(base(over), r.q - 1, p.ctx).lifeM >= over.target) bad++;
    }
  }
  check('Подбор: цель достигнута, на единицу меньше — нет', bad === 0, bad);
}

// 15. Различаем «недостижимо» и «за пределами поиска»
{
  const loss = E.solve(base({ calc: 'need', price: 10, mat: 1.2, target: 1000, kv: 'gkv' }), ctx({}));
  check('Себестоимость больше цены → loss', loss.status === 'loss', loss.status);
  const lim = E.solve(base({ calc: 'need', price: 10, target: 30000, kv: 'gkv', mat: 0.95, clients: 'b2b', ku: false }), ctx({ ku: false }));
  check('Маржа маленькая, но положительная → limit', lim.status === 'limit', lim.status);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
