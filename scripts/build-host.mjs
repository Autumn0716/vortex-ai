import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(rootDir, 'dist-host');

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'server/api-server.ts')],
  outfile: path.join(outputDir, 'api-server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
});

console.log('Built host bridge bundle at dist-host/api-server.mjs');
