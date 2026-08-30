#!/usr/bin/env node
// Bake the commit into the package, as a RELEASE STEP.
//
// Git is here and will not be there: an installed package has no history, so
// the moment before publish is the only chance to capture the facts.
//
// NOT A `prepack` HOOK, which was the obvious first attempt and does not work:
// npm decides what goes in the tarball BEFORE it runs prepack, so a file created
// there is never packed. Measured — a tarball from a clean tree came out with 19
// files and no build-info.json, and 20 with it when the file already existed.
//
// Gitignored, so a working copy stays a working copy: the version banner reads
// the file when it is there and asks git when it is not, and those two states
// say different things on purpose.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { bakedFrom } from '../src/build-info.js';

const target = new URL('../src/build-info.json', import.meta.url);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

try {
  const commit = git('log', '-1', '--format=%h');
  const info = bakedFrom({ commit });
  writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`);
  process.stderr.write(`build-info: ${info.commit} built ${info.built}\n`);
} catch (e) {
  // A pack from an exported source tree with no git is not a failure — the
  // version banner simply omits the line. Refusing to publish over it would be
  // this script deciding something it has no business deciding.
  process.stderr.write(`build-info: no git here, the version banner will omit it (${e.message})\n`);
}
