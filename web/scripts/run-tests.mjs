/**
 * Build and run the web test suites.
 *
 * The specs are bundled with esbuild first because they import from `.tsx`
 * component modules and from `next/*`, neither of which node runs directly.
 * React and next are left external — nothing under test touches a component
 * body, only the plain functions exported alongside them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const SUITES = ['pwa', 'seo', 'legal', 'cart', 'session'];

mkdirSync('dist-tests', { recursive: true });

const externals = ['node:test', 'node:assert', 'node:assert/strict', 'react', 'react-dom', 'next']
  .flatMap((m) => ['--external:' + m]);

for (const name of SUITES) {
  execFileSync('npx', [
    'esbuild', `__tests__/${name}.spec.ts`, '--bundle', '--format=esm', '--platform=node',
    `--outfile=dist-tests/${name}.spec.mjs`, ...externals, '--log-level=error',
  ], { stdio: 'inherit' });
}

execFileSync('node', ['--test', ...SUITES.map((n) => `dist-tests/${n}.spec.mjs`)], { stdio: 'inherit' });
