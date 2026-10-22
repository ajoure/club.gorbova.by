#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// GitHub's Ubuntu image uses mirror+file indirection. Editing only the
// deb822 URI leaves the higher-priority Azure mirror selected by APT.
const root = resolve(process.argv[2] ?? '/etc/apt');
const files = ['apt-mirrors.txt', 'sources.list', 'sources.list.d/ubuntu.sources']
  .filter(name => existsSync(join(root, name)))
  .map(name => ({ name, text: readFileSync(join(root, name), 'utf8') }));

if (files.length === 0) throw new Error('No supported Ubuntu APT source files found');
if (files.some(file => file.text.includes('mirror+file:/etc/apt/apt-mirrors.txt'))
  && !files.some(file => file.name === 'apt-mirrors.txt')) {
  throw new Error('Ubuntu mirror+file source has no apt-mirrors.txt');
}

let switched = 0;
for (const file of files) {
  const next = file.text.replace(/https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=\/|\s|$)/g, () => {
    switched += 1;
    return 'https://archive.ubuntu.com/ubuntu';
  });
  // Keep priorities, suites, components, Signed-By and all other repositories.
  if (next !== file.text) writeFileSync(join(root, file.name), next);
}
console.log(`Ubuntu APT sources: ${files.length} files inspected; ${switched} Azure URIs switched to the primary HTTPS archive`);
