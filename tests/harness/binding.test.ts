import { assertStamp, fingerprint, parseLlmResults } from '../../.harness/tools/binding';

const valid = {
  sprint: 2,
  iteration: 1,
  results: [{ id: 'COR-04', result: 'PASS', evidence: ['tests/a.test.ts:10 asserts the stored status'] }],
};

describe('parseLlmResults', () => {
  it('accepts the documented shape and returns the stamp and results', () => {
    expect(parseLlmResults(valid)).toEqual({ sprint: 2, iteration: 1, results: valid.results });
  });

  it('accepts sprint 0 and iteration 0 (a trial outside a run) and empty evidence arrays', () => {
    expect(parseLlmResults({ sprint: 0, iteration: 0, results: [{ id: 'X', result: 'FAIL', evidence: [] }] }).results).toHaveLength(1);
  });

  it.each([
    ['null', null, /must be an object/],
    ['an array (the old format)', [{ id: 'A', result: 'PASS', evidence: ['x'] }], /must be an object/],
    ['a string', 'PASS', /must be an object/],
    ['no sprint', { iteration: 1, results: [] }, /integer "sprint" and "iteration"/],
    ['a fractional iteration', { sprint: 1, iteration: 1.5, results: [] }, /integer "sprint" and "iteration"/],
    ['a negative sprint', { sprint: -1, iteration: 1, results: [] }, /integer "sprint" and "iteration"/],
    ['a string sprint', { sprint: '1', iteration: 1, results: [] }, /integer "sprint" and "iteration"/],
    ['results that is not an array', { sprint: 1, iteration: 1, results: {} }, /"results" array/],
    ['an entry that is not an object', { sprint: 1, iteration: 1, results: ['PASS'] }, /results\[0\] needs a non-empty string "id"/],
    ['an entry without an id', { sprint: 1, iteration: 1, results: [{ result: 'PASS', evidence: ['x'] }] }, /results\[0\] needs a non-empty string "id"/],
    ['a blank id', { sprint: 1, iteration: 1, results: [{ id: '  ', result: 'PASS', evidence: ['x'] }] }, /non-empty string "id"/],
    ['a result outside PASS/FAIL/UNSURE', { sprint: 1, iteration: 1, results: [{ id: 'A', result: 'MAYBE', evidence: ['x'] }] }, /A: "result" must be exactly PASS, FAIL or UNSURE \(got "MAYBE"\)/],
    ['a lower-case result', { sprint: 1, iteration: 1, results: [{ id: 'A', result: 'pass', evidence: ['x'] }] }, /must be exactly PASS, FAIL or UNSURE/],
    ['a missing result', { sprint: 1, iteration: 1, results: [{ id: 'A', evidence: ['x'] }] }, /must be exactly PASS, FAIL or UNSURE/],
    ['evidence given as a string', { sprint: 1, iteration: 1, results: [{ id: 'A', result: 'PASS', evidence: 'src/x.ts:1' }] }, /A: "evidence" must be an array of strings/],
    ['evidence containing a non-string', { sprint: 1, iteration: 1, results: [{ id: 'A', result: 'PASS', evidence: ['ok', 3] }] }, /"evidence" must be an array of strings/],
    ['missing evidence', { sprint: 1, iteration: 1, results: [{ id: 'A', result: 'PASS' }] }, /"evidence" must be an array of strings/],
  ])('rejects %s with a clear message', (_label, raw, message) => {
    expect(() => {
      parseLlmResults(raw);
    }).toThrow(message);
  });
});

describe('assertStamp: stale or replayed result files are refused', () => {
  it('passes when the sprint and iteration match', () => {
    expect(() => {
      assertStamp('verdict.json', { sprint: 2, iteration: 3 }, { sprint: 2, iteration: 3 });
    }).not.toThrow();
  });

  it.each([
    ['an earlier iteration', { sprint: 2, iteration: 1 }],
    ['a later iteration', { sprint: 2, iteration: 3 }],
    ['an earlier sprint', { sprint: 1, iteration: 2 }],
    ['a later sprint', { sprint: 3, iteration: 2 }],
    ['a file with no stamp at all (0/0)', { sprint: 0, iteration: 0 }],
  ])('refuses %s, naming the file and both stamps', (_label, actual) => {
    expect(() => {
      assertStamp('verdict.json', actual, { sprint: 2, iteration: 2 });
    }).toThrow(new RegExp(`verdict\\.json is for sprint ${actual.sprint}, iteration ${actual.iteration} but the run is on sprint 2, iteration 2.*stale`));
  });
});

describe('fingerprint: detects any change to the working tree', () => {
  const first = { path: 'src/a.ts', content: 'one' };
  const second = { path: 'tests/b.test.ts', content: 'two' };
  const files = [first, second];

  it('is stable and independent of the order of the entries', () => {
    expect(fingerprint(files)).toBe(fingerprint([...files].reverse()));
    expect(fingerprint(files)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['an edited file', [{ path: 'src/a.ts', content: 'ONE' }, second]],
    ['a renamed file', [{ path: 'src/a2.ts', content: 'one' }, second]],
    ['an extra file', [...files, { path: 'src/c.ts', content: '' }]],
    ['a removed file', [first]],
    ['a deleted file', [{ path: 'src/a.ts', content: null }, second]],
  ])('changes with %s', (_label, changed) => {
    expect(fingerprint(changed)).not.toBe(fingerprint(files));
  });

  it('distinguishes an empty file from a deleted one, and path from content', () => {
    expect(fingerprint([{ path: 'a', content: '' }])).not.toBe(fingerprint([{ path: 'a', content: null }]));
    expect(fingerprint([{ path: 'a', content: 'b' }])).not.toBe(fingerprint([{ path: 'ab', content: '' }]));
  });

  it('has a fixed value for no files', () => {
    expect(fingerprint([])).toBe(fingerprint([]));
  });
});
