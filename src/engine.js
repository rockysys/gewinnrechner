// Расчётное ядро: чистые функции без DOM. Все суммы — евро, все ставки — доли или проценты, как подписано.
const NettoEngine = (() => {
  'use strict';

  // Параметры по годам. Новый год — новая строка; для года без строки берутся последние известные значения.
  const RATES = {
    2026: {
      // §32a EStG, тариф 2026
      gfb: 12348, z1: 17799, a1: 914.51, z2: 69878, a2: 173.10, c2: 1034.87, z3: 277825, k3: 11135.63, k4: 19470.38,
      soli: 20350,                    // §3 Abs. 3 SolZG: Freigrenze для одного человека
      kvMin: 1318.33, kvMax: 5812.50, // GKV для самозанятых: минимальная база и BBG в месяц
      zus: 2.9,                       // средний Zusatzbeitrag (BMG, Bundesanzeiger 10.11.2025)
      pv: 3.6, pvChildless: 0.6,      // Pflege и надбавка бездетным старше 23
      pensCap: 30826                  // §10 Abs. 3 EStG: потолок вычета DRV/Rürup в год
    }
  };
  const LAW = { vat: 0.19, kuFirst: 25000, kuPrev: 25000, kuCur: 100000, gewFrei: 24500, gewMz: 0.035, gew35: 4.0, pausch: 36 };

  function ratesFor(y) {
    const ks = Object.keys(RATES).map(Number).sort((a, b) => a - b);
    let b = ks[0];
    for (const k of ks) if (k <= y) b = k;
    return { R: RATES[b], base: b, exact: b === y };
  }

  function incomeTax(zve, R) {
    const x = Math.floor(Math.max(0, zve));
    if (x <= R.gfb) return 0;
    if (x <= R.z1) { const y = (x - R.gfb) / 1e4; return Math.floor((R.a1 * y + 1400) * y); }
    if (x <= R.z2) { const z = (x - R.z1) / 1e4; return Math.floor((R.a2 * z + 2397) * z + R.c2); }
    if (x <= R.z3) return Math.floor(0.42 * x - R.k3);
    return Math.floor(0.45 * x - R.k4);
  }

  // §4 SolZG: 5,5 %, но не больше 11,9 % от превышения Freigrenze; доли цента отбрасываются
  function soli(base, R) {
    if (base <= R.soli) return 0;
    return Math.floor(Math.min(0.055 * base, 0.119 * (base - R.soli)) * 100 + 1e-7) / 100;
  }

  /*
   * Один календарный год при q продажах (часах или штуках) в месяц.
   * P — параметры формы:
   *   price      цена для клиента: частным — конечная (НДС внутри после перехода), компаниям — без НДС
   *   clients    'b2c' | 'b2b'
   *   mode       'hours' | 'goods'; invoice — средний счёт для часов (размер одной операции для лимита KU)
   *   mat        себестоимость единицы, доля цены, как оплачена (с НДС)
   *   fixed      прочие постоянные расходы в месяц, как оплачены; vatShare — доля расходов с вычитаемым НДС
   *   bizVat / bizNo  отмеченные типичные расходы с НДС / без НДС, в месяц
   *   kv 'gkv'|'pkv', kg, kids, zus, pkv (взнос вместе с Pflege), pkvDed (вычитаемая часть или null = весь взнос)
   *   pens, pensType 'save'|'drv'; priv — личные обязательные платежи в месяц
   *   ku, kind 'frei'|'gew', heb, church 0|8|9
   * ctx: { months, startCal, ku, limit, R }
   */
  function yearCalc(P, q, ctx) {
    const R = ctx.R, p = P.price, vat = LAW.vat, b2c = P.clients === 'b2c';
    const pNet = b2c ? p / (1 + vat) : p;              // выручка с единицы после перехода на НДС
    const vatU = b2c ? p - pNet : p * vat;             // НДС с единицы
    const T = P.mode === 'goods' ? p : Math.max(P.invoice || p, 0.01); // размер одной операции
    const varPaid = P.mat * p;                         // себестоимость единицы, как оплачена
    const fixedPaid = P.fixed + P.bizVat + P.bizNo;
    const fixedVatPaid = P.fixed * P.vatShare + P.bizVat; // часть постоянных расходов с вычитаемым НДС
    const vatPart = vat / (1 + vat);

    let inKU = !!ctx.ku, cum = 0, rev = 0, costPaid = 0, vatOut = 0, vatIn = 0, kuShare = 0, switchCal = null;
    for (let i = 0; i < ctx.months; i++) {
      const rKU = q * p;          // выручка месяца без НДС
      let f = 0;                  // доля выручки месяца, оставшаяся без НДС
      if (inKU) {
        if (rKU <= 0) f = 1;
        else {
          // в лимит помещаются только целые операции; операция, которая его пересекает, уже целиком с НДС
          const room = ctx.limit - cum;
          if (rKU <= room + 1e-9) f = 1;   // оборот месяца целиком укладывается в лимит
          else {
            const fit = room > 0 ? Math.floor(room / T + 1e-9) * T : 0;
            f = Math.max(0, Math.min(1, fit / rKU)); inKU = false; switchCal = ctx.startCal + i;
          }
        }
      }
      const r = q * (f * p + (1 - f) * pNet);
      const withVat = fixedVatPaid + P.vatShare * varPaid * q;
      cum += r; rev += r; kuShare += f;
      costPaid += fixedPaid + varPaid * q;
      vatOut += (1 - f) * q * vatU;
      vatIn += (1 - f) * withVat * vatPart;
    }
    const m = ctx.months;
    const costNet = costPaid - vatIn;
    const G = rev - costNet;   // прибыль бизнеса до налогов и личных страховок

    let kv, kvDed, kvBase = null;
    if (P.kv === 'gkv') {
      kvBase = Math.min(R.kvMax, Math.max(R.kvMin, G / m));
      const kvPart = kvBase * ((P.kg ? 14.6 : 14.0) + P.zus) / 100 * m;
      const pvPart = kvBase * (R.pv + (P.kids ? 0 : R.pvChildless)) / 100 * m;
      kv = kvPart + pvPart;
      kvDed = kvPart * (P.kg ? 0.96 : 1) + pvPart;     // §10 Abs. 1 Nr. 3 EStG: минус 4 % при праве на Krankengeld
    } else {
      kv = P.pkv * m;
      const ded = P.pkvDed == null ? P.pkv : Math.min(P.pkvDed, P.pkv);
      kvDed = ded * m;
    }
    const pens = P.pens * m;
    const pensDed = P.pensType === 'drv' ? Math.min(pens, R.pensCap) : 0;
    const priv = P.priv * m;

    const zve = G - kvDed - pensDed - LAW.pausch;
    const estTarif = incomeTax(zve, R);
    let gew = 0, credit = 0, messbetrag = 0;
    if (P.kind === 'gew' && G > 0) {
      const ge = Math.floor(G / 100) * 100 - LAW.gewFrei;  // §11 GewStG
      if (ge > 0) {
        messbetrag = ge * LAW.gewMz;
        gew = messbetrag * P.heb / 100;
        credit = Math.min(LAW.gew35 * messbetrag, gew, estTarif); // §35 EStG
      }
    }
    const est = estTarif - credit;
    const soliV = soli(est, R);                                 // Soli — после зачёта §35
    const kist = P.church ? estTarif * P.church / 100 : 0;      // §51a Abs. 2 S. 3: без зачёта §35
    const tax = est + soliV + kist;
    const net = G - kv - pens - tax - gew;
    const life = net - priv;
    return {
      q, m, rev, vatOut, clientPaid: rev + vatOut, costPaid, vatIn, costNet, G,
      kv, kvDed, kvBase, pens, pensDed, priv, zve, estTarif, credit, est, soli: soliV, kist, tax, gew, messbetrag,
      net, life, lifeM: life / m, kuAll: !!ctx.ku && kuShare >= m - 1e-9, switchCal
    };
  }

  // Минимальный целый объём продаж, при котором остаток на жизнь не ниже цели
  function solve(P, ctx) {
    const life = q => yearCalc(P, q, ctx).lifeM;
    const qMax = 150000 / P.price;
    const dq = Math.max(20 / P.price, qMax / 8000);
    let prev = 0;
    for (let q = 0; q <= qMax + 1e-9; q += dq) {
      if (life(q) >= P.target) {
        let lo = prev, hi = q;
        for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (life(mid) >= P.target) hi = mid; else lo = mid; }
        let qi = Math.ceil(hi - 1e-9);
        while (life(qi) < P.target && qi <= qMax) qi++;
        if (qi > qMax) break;
        return { status: 'ok', res: yearCalc(P, qi, ctx) };
      }
      prev = q;
    }
    const growing = life(qMax) > life(qMax * 0.9) + 0.01;
    return { status: growing ? 'limit' : 'loss', qMax };
  }

  // Три года подряд: право на Kleinunternehmer зависит от фактического оборота прошлого года
  function plan(P) {
    const pick = ctx => P.calc === 'need' ? solve(P, ctx) : { status: 'ok', res: yearCalc(P, P.qty, ctx) };
    const mk = (y, extra) => { const r = ratesFor(y); return Object.assign({ year: y, R: r.R, rBase: r.base, exact: r.exact }, extra); };
    const out = [];
    let ctx = mk(P.startY, { months: 13 - P.startM, startCal: P.startM, ku: !!P.ku, limit: LAW.kuFirst, first: true });
    let s = pick(ctx);
    out.push(Object.assign({ ctx }, s));
    for (let i = 1; i < 3; i++) {
      const prevRev = s.res ? s.res.rev : Infinity;
      ctx = mk(P.startY + i, { months: 12, startCal: 1, ku: !!P.ku && prevRev <= LAW.kuPrev, limit: LAW.kuCur, prevRev, prevYear: P.startY + i - 1 });
      s = pick(ctx);
      out.push(Object.assign({ ctx }, s));
    }
    return out;
  }

  return { RATES, LAW, ratesFor, incomeTax, soli, yearCalc, solve, plan };
})();
if (typeof globalThis !== 'undefined') globalThis.NettoEngine = NettoEngine;
