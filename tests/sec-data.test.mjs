import test from "node:test";
import assert from "node:assert/strict";
import {
  annualSeries,
  instantForTagsAtDate,
  seriesForTags,
  sumNullable,
  sumShareClassesAtDate,
} from "../netlify/functions/sec-data.mjs";

const fact = (items, unit = "USD") => ({ units: { [unit]: items } });

test("annualSeries keeps distinct annual periods and prefers the latest filing for each exact period", () => {
  const series = annualSeries(fact([
    { start: "2022-01-01", end: "2022-12-31", val: 90, form: "10-K", fy: 2022, fp: "FY", filed: "2023-02-01", accn: "a" },
    { start: "2023-01-01", end: "2023-12-31", val: 100, form: "10-K", fy: 2023, fp: "FY", filed: "2024-02-01", accn: "b" },
    { start: "2023-01-01", end: "2023-12-31", val: 101, form: "10-K", fy: 2024, fp: "FY", filed: "2025-02-01", accn: "c" },
    { start: "2024-01-01", end: "2024-12-31", val: 120, form: "10-K", fy: 2024, fp: "FY", filed: "2025-02-01", accn: "d" },
    { start: "2024-01-01", end: "2024-12-31", val: 121, form: "10-K/A", fy: 2024, fp: "FY", filed: "2025-03-01", accn: "e" },
    { start: "2025-01-01", end: "2025-09-30", val: 99, form: "10-Q", fy: 2025, fp: "Q3", filed: "2025-11-01", accn: "f" },
  ]));

  assert.deepEqual(series.map((item) => [item.end, item.val]), [
    ["2022-12-31", 90],
    ["2023-12-31", 101],
    ["2024-12-31", 121],
  ]);
});

test("seriesForTags falls through tags that exist but have no usable annual facts", () => {
  const facts = {
    Primary: fact([{ start: "2024-01-01", end: "2024-03-31", val: 1, form: "10-Q", filed: "2024-05-01" }]),
    Fallback: fact([{ start: "2024-01-01", end: "2024-12-31", val: 2, form: "10-K", filed: "2025-02-01" }]),
  };
  const series = seriesForTags(facts, ["Primary", "Fallback"]);
  assert.equal(series.get("2024-12-31").val, 2);
  assert.equal(series.get("2024-12-31").tag, "Fallback");
});

test("instantForTagsAtDate anchors the balance-sheet fact to the requested date", () => {
  const facts = {
    Cash: fact([
      { end: "2024-12-31", val: 10, form: "10-K", filed: "2025-02-01", accn: "a" },
      { end: "2025-03-31", val: 50, form: "10-Q", filed: "2025-05-01", accn: "b" },
      { end: "2024-12-31", val: 11, form: "10-K/A", filed: "2025-03-01", accn: "c" },
    ]),
  };
  const item = instantForTagsAtDate(facts, ["Cash"], "2024-12-31");
  assert.equal(item.val, 11);
  assert.equal(item.end, "2024-12-31");
});

test("share classes can be summed for one filing date", () => {
  const shares = fact([
    { end: "2024-12-31", val: 60, filed: "2025-02-01", accn: "a" },
    { end: "2024-12-31", val: 40, filed: "2025-02-01", accn: "b" },
    { end: "2024-12-31", val: 95, filed: "2024-02-01", accn: "old" },
  ], "shares");
  assert.equal(sumShareClassesAtDate(shares, "2024-12-31"), 100);
});

test("sumNullable preserves missing debt instead of coercing it to zero", () => {
  assert.equal(sumNullable(null, null), null);
  assert.equal(sumNullable(10, null), 10);
});
