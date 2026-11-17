import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogUnit } from '@kavach/shared';
import { describe, expect, it } from 'vitest';
import { ExpectedDocumentSchema, expectedToExtraction } from '../extractors/expected-format';
import { percent, scoreDocument, summarise } from './score';

const DOCS = path.resolve(__dirname, '../../../../test-docs');
const key = (name: string) =>
  ExpectedDocumentSchema.parse(
    JSON.parse(readFileSync(path.join(DOCS, `${name}.expected.json`), 'utf8')),
  );

const units: CatalogUnit[] = [
  {
    id: 'BAG',
    code: 'BAG',
    name: 'Bags',
    symbol: 'bag',
    aliases: ['BAGS', 'BGS'],
    decimalPlaces: 0,
  },
  { id: 'NOS', code: 'NOS', name: 'Numbers', symbol: 'nos', aliases: ['NO'], decimalPlaces: 0 },
  {
    id: 'MT',
    code: 'MT',
    name: 'Metric Tonnes',
    symbol: 'MT',
    aliases: ['TON', 'TONS'],
    decimalPlaces: 3,
  },
];

describe('accuracy scoring (PRD §29.2)', () => {
  it('a perfect reading scores 100% on every field, with nothing invented', () => {
    const expected = key('inv-001');
    const score = scoreDocument(expected, expectedToExtraction(expected), units);
    expect(score.mistakes).toEqual([]);
    expect(score.invented).toEqual([]);
    for (const t of Object.values(score.metrics)) expect(t.correct).toBe(t.total);
    expect(score.metrics.quantity.total).toBe(2);
  });

  it('measures each kind of field separately', () => {
    const expected = key('inv-001');
    const actual = expectedToExtraction(expected);
    actual.lines[0]!.quantity.value = '5000'; // a misread digit
    actual.lines[1]!.unit.value = 'bgs'; // same unit, another spelling
    actual.header.invoiceNo.value = 'skc 26-27 1045'; // same number, other punctuation
    const score = scoreDocument(expected, actual, units);
    expect(score.metrics.quantity).toEqual({ correct: 1, total: 2 });
    expect(score.metrics.unit).toEqual({ correct: 2, total: 2 });
    expect(score.metrics.invoiceNumber).toEqual({ correct: 1, total: 1 });
    expect(score.metrics.description).toEqual({ correct: 2, total: 2 });
    expect(score.mistakes).toHaveLength(1);
  });

  it('does not count spelling of a unit as a mistake, but does count a different size', () => {
    const expected = key('inv-006');
    const actual = expectedToExtraction(expected);
    const sized = actual.lines.findIndex((l) => l.size.value !== null);
    const original = actual.lines[sized]!.size.value!;
    actual.lines[sized]!.size.value = original.replace(/\s*(mm|inch)$/i, '');
    expect(scoreDocument(expected, actual, units).mistakes).toEqual([]);
    actual.lines[sized]!.size.value = `9${original}`;
    expect(scoreDocument(expected, actual, units).mistakes).toHaveLength(1);
    // The fictional suppliers are marked "(Sample)" on the test documents only.
    actual.lines[sized]!.size.value = original;
    actual.header.supplierName.value = actual.header.supplierName.value!.replace(' (Sample)', '');
    expect(scoreDocument(expected, actual, units).mistakes).toEqual([]);
  });

  it('reports an invented pack size or grade (PRD §12.4)', () => {
    const cement = key('ch-011');
    const guessed = expectedToExtraction(cement);
    guessed.lines[0]!.packSize = { value: '50 KG', confidence: 0.9, legible: true };
    const score = scoreDocument(cement, guessed, units);
    expect(score.invented).toEqual([{ line: 1, field: 'packSize', value: '50 KG' }]);
    expect(score.metrics.specification.correct).toBe(score.metrics.specification.total - 1);

    // "Fe550D (not written)" in the key means the truth is null.
    const steel = key('ch-010');
    expect(scoreDocument(steel, expectedToExtraction(steel), units).invented).toEqual([]);
  });

  it('counts a lost line against every line metric and checks uncertainty flags', () => {
    const expected = key('ch-009');
    const actual = expectedToExtraction(expected);
    const perfect = scoreDocument(expected, actual, units);
    expect(perfect.uncertaintyFlagged.total).toBeGreaterThan(0);
    expect(perfect.uncertaintyFlagged.correct).toBe(perfect.uncertaintyFlagged.total);

    // The overwritten quantity read with full confidence: right value, but not flagged.
    const confident = expectedToExtraction(expected);
    confident.lines[0]!.quantity = { value: '8000', confidence: 0.99, legible: true };
    const s = scoreDocument(expected, confident, units);
    expect(s.metrics.quantity.correct).toBe(s.metrics.quantity.total);
    expect(s.uncertaintyFlagged.correct).toBe(s.uncertaintyFlagged.total - 1);

    actual.lines.pop();
    const lost = scoreDocument(expected, actual, units);
    expect(lost.metrics.description).toEqual({ correct: 1, total: 2 });
    expect(lost.mistakes.some((m) => m.includes('missing'))).toBe(true);
  });

  it('judges an unreadable document on the quality check alone', () => {
    const bad = key('bad-012');
    const stopped = scoreDocument(bad, expectedToExtraction(bad), units);
    expect(stopped.qualityCorrect).toBe(true);
    expect(stopped.metrics.quantity.total).toBe(0);
    const total = summarise([
      stopped,
      scoreDocument(key('inv-001'), expectedToExtraction(key('inv-001')), units),
    ]);
    expect(total.quality).toEqual({ correct: 2, total: 2 });
    expect(percent(total.metrics.supplier)).toBe('100.0% (1/1)');
    expect(percent({ correct: 0, total: 0 })).toBe('n/a');
  });
});
