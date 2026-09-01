import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('grant-access audit actor compatibility', () => {
  it('maps an authenticated admin to the audit_logs user actor value', () => {
    const source = readFileSync('supabase/functions/grant-access-for-order/index.ts', 'utf8');
    expect(source).toContain('actor_type: caller.actorType === "admin" ? "user" : caller.actorType');
    expect(source).not.toContain('actor_type: "admin"');
  });
});
