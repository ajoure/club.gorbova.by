/**
 * Parity-check: убеждается, что frontend mirror полностью совпадает с canonical _shared
 * placeholderClassifier.ts. Любая правка одного без зеркального правка другого = провал.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SHARED = join(ROOT, 'supabase/functions/_shared/placeholderClassifier.ts');
const MIRROR = join(ROOT, 'src/lib/documents/placeholderClassifier.ts');

describe('placeholderClassifier parity', () => {
  it('canonical _shared and frontend mirror are byte-identical', () => {
    const a = readFileSync(SHARED, 'utf8');
    const b = readFileSync(MIRROR, 'utf8');
    expect(b).toBe(a);
  });
});
