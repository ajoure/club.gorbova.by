import {execFileSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';

describe('ZG27 bank native migration contracts',()=>{
  it('uses the real slot guard/index, keeps six offers and rolls back unsafe baselines',()=>{
    const output=execFileSync(process.execPath,['tests/sql/zg27-bank-configuration.mjs'],{encoding:'utf8',env:process.env,timeout:20_000});
    expect(output).toContain('ZG27 bank native SQL 5 PASS');
  },25_000);
});
