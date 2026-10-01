/*
 * slim.js — trims a full analysis down to what the screens need, so it can be
 * passed from the background worker to the page quickly.
 */
(function (RP) {
  'use strict';
  const E = RP.engine;

  E.slim = function (a) {
    const S = a.schedule;
    return {
      plan: a.plan,
      summary: a.summary,
      rows: a.det.rows,
      mc: a.mc ? {
        successRate: a.mc.successRate, runs: a.mc.runs, bands: a.mc.bands,
        failYears: a.mc.failYears, medianPenalties: a.mc.medianPenalties,
        medianBalanceAtRetirement: a.mc.medianBalanceAtRetirement,
      } : null,
      sepp: a.sepp,
      schedule: {
        y0: S.y0, yEnd: S.yEnd, years: S.years, retireYear: S.retireYear, lastFullTimeYear: S.lastFullTimeYear,
        unlock: S.unlock, ssDetail: S.ssDetail, events: S.events, deathPid: S.deathPid,
        mortgagePayoffYear: S.mortgagePayoffYear, hhSize: S.hhSize, daycare: S.daycare,
        emp: {
          p1: { lossMonth: S.emp.p1.lossMonth, reMonth: S.emp.p1.reMonth, finalSep: S.emp.p1.finalSep, retireYear: S.emp.p1.retireYear },
          p2: { lossMonth: S.emp.p2.lossMonth, reMonth: S.emp.p2.reMonth, finalSep: S.emp.p2.finalSep, retireYear: S.emp.p2.retireYear },
        },
      },
    };
  };
})(globalThis.RP = globalThis.RP || {});
