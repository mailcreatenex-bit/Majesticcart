/**
 * Build and run the test suites.
 *
 * The specs are bundled with esbuild rather than run through ts-node because
 * they import type-only from @prisma/client, which cannot be installed here
 * (its engines come from a blocked host). vendor/prisma-stub supplies the
 * runtime shape; in a normal environment with the real client generated, drop
 * the alias and the bundle step and run them with your usual runner.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const INTEGRATION = process.argv.includes('--integration');
const UNIT = ['auth', 'order', 'plan', 'serialization', 'reporting', 'crypto', 'invoice', 'upi', 'plan-parity'];
const suites = INTEGRATION ? ['integration'] : UNIT;

mkdirSync('dist-tests', { recursive: true });

const externals = [
  'node:test', 'node:assert', 'node:crypto', '@nestjs/common', '@nestjs/core',
  '@nestjs/bullmq', '@nestjs/jwt', 'bullmq', 'argon2', 'rxjs', 'zod', 'pg', 'express', 'qrcode',
].flatMap((m) => ['--external:' + m]);

for (const name of suites) {
  execFileSync('npx', [
    'esbuild', `src/__tests__/${name}.spec.ts`, '--bundle', '--format=esm', '--platform=node',
    `--outfile=dist-tests/${name}.spec.mjs`, '--alias:@prisma/client=./vendor/prisma-stub/index.js',
    ...externals, '--log-level=error',
  ], { stdio: 'inherit' });
}

if (INTEGRATION && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for the integration suite.');
  process.exit(1);
}

execFileSync('node', ['--test', ...suites.map((n) => `dist-tests/${n}.spec.mjs`)], { stdio: 'inherit' });
