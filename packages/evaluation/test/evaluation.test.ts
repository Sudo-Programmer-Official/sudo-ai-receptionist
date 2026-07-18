import { describe, expect, it } from 'vitest';
import { runEvaluation } from '../src/index.js';

describe('evaluation', () => {
  it('returns scenario results', async () => {
    const results = await runEvaluation();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.scenario).toBeDefined();
  });
});

