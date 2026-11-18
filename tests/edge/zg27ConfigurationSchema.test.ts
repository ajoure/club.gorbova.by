import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteBlockSchema } from '../../src/services/sitePages/types';

describe('actual ZG27 configuration block schema', () => {
  it('parses both migrated blocks with the real admin/publication schema after replay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zg27-config-schema-'));
    try {
      const output = join(dir, 'blocks.json');
      execFileSync(process.execPath, ['tests/sql/zg27-configuration.mjs'], {
        env: { ...process.env, ZG27_CONFIG_BLOCK_OUTPUT: output }, encoding: 'utf8',
      });
      const blocks = JSON.parse(readFileSync(output, 'utf8'));
      expect(blocks).toHaveLength(2);
      for (const raw of blocks) {
        const block = siteBlockSchema.parse(raw);
        expect(block.type).toBe('zg27_checkout');
        expect(block.content.page_slug).toBe(block.content.tier === 'first' ? 'zg27pervoe' : 'zg27povtor');
        expect(block.id).toBe(block.content.tier === 'first'
          ? '970a6a71-2727-4c85-a0d9-5c031a520001' : '970a6a71-2727-4c85-a0d9-5c031a520002');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
