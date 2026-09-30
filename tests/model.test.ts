import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast, dcf } from '../src/lib/model.ts';
import type { Assumptions } from '../src/types/finance.ts';

const financials = [{ year: 2024, revenue: 1000 }];
const assumptions: Assumptions = { growth: 0, margin: 20, tax: 25, da: 5, capex: 3, nwc: 1, wacc: 10, terminal: 2 };

test('buildForecast calculates unlevered free cash flow independently of the UI', () => {
  const forecast = buildForecast(financials, assumptions);
  assert.equal(forecast.length, 5);
  assert.equal(forecast[0].revenue, 1000);
  assert.equal(forecast[0].ebit, 200);
  assert.equal(forecast[0].nopat, 150);
  assert.equal(forecast[0].ufcf, 160);
});

test('dcf produces enterprise, equity and per-share values', () => {
  const result = dcf({ financials, assumptions, balanceSheet: { cash: 50, debt: 100, sharesOutstanding: 100 } });
  assert.equal(result.error, undefined);
  assert.ok((result.ev || 0) > 0);
  assert.equal(result.equity, (result.ev || 0) - 50);
  assert.equal(result.perShare, (result.equity || 0) / 100);
});

test('dcf rejects WACC less than or equal to terminal growth', () => {
  const result = dcf({ financials, assumptions: { ...assumptions, wacc: 2, terminal: 2 }, balanceSheet: { cash: 50, debt: 100, sharesOutstanding: 100 } });
  assert.equal(result.error?.code, 'WACC_NOT_ABOVE_G');
});

test('dcf does not silently treat missing debt as zero', () => {
  const result = dcf({ financials, assumptions, balanceSheet: { cash: 50, debt: null, sharesOutstanding: 100 } });
  assert.equal(result.equity, null);
  assert.equal(result.perShare, null);
  assert.deepEqual(result.missingEquityBridge, ['debt']);
});
