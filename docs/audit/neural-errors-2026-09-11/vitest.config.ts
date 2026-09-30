import base from '../../../vitest.config';

export default { ...base, test: { ...base.test,
  include: ['docs/audit/neural-errors-2026-09-11/repro.test.ts'],
} };
