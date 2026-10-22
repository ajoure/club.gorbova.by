import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./configure-ubuntu-archive.mjs', import.meta.url));
function fixture(files, check) {
  const root = mkdtempSync(join(tmpdir(), 'ubuntu-apt-routing-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    const run = () => execFileSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    check(name => readFileSync(join(root, name), 'utf8'), run);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('routes the actual runner mirror-list priority 1 to Ubuntu while retaining deb822 indirection and signatures', () => {
  // actions/runner-images ubuntu24/20261021.345 configure-apt-sources.sh.
  const mirrors = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  const source = 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
  fixture({ 'apt-mirrors.txt': mirrors, 'sources.list.d/ubuntu.sources': source }, (read, run) => {
    run();
    assert.equal(read('apt-mirrors.txt'), mirrors.replace('http://azure.archive.ubuntu.com', 'https://archive.ubuntu.com'));
    assert.equal(read('sources.list.d/ubuntu.sources'), source);
    assert.match(run(), /0 Azure URIs switched/);
  });
});

test('also supports direct deb822 and legacy URIs without changing suites, trust keys, security or unrelated hosts', () => {
  const source = 'Types: deb\nURIs: https://azure.archive.ubuntu.com/ubuntu\nSuites: noble-updates\nSigned-By: /keys/ubuntu.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu\nSuites: noble-security\nSigned-By: /keys/ubuntu.gpg\n';
  const legacy = 'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] http://azure.archive.ubuntu.com/ubuntu/ noble main\ndeb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n# http://azure.archive.ubuntu.com.example/ubuntu\n';
  fixture({ 'sources.list.d/ubuntu.sources': source, 'sources.list': legacy }, (read, run) => {
    run();
    assert.equal(read('sources.list.d/ubuntu.sources'), source.replace('https://azure.archive.ubuntu.com', 'https://archive.ubuntu.com'));
    assert.equal(read('sources.list'), legacy.replace('http://azure.archive.ubuntu.com/ubuntu/', 'https://archive.ubuntu.com/ubuntu/'));
  });
});

test('fails before APT when mirror indirection points to a missing list', () => {
  const source = 'URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSigned-By: /keys/ubuntu.gpg\n';
  fixture({ 'sources.list.d/ubuntu.sources': source }, (read, run) => {
    assert.throws(run, /no apt-mirrors.txt/);
    assert.equal(read('sources.list.d/ubuntu.sources'), source);
  });
});

test('fails visibly if a future runner image has none of the supported source files', () => {
  fixture({}, (_read, run) => assert.throws(run, /No supported Ubuntu APT source files/));
});
