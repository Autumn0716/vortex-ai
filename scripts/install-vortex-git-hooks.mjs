import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = path.join(repoRoot, '.git/hooks');
const hookPath = path.join(hooksDir, 'pre-push');

const hook = `#!/bin/sh
set +e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi
cd "$REPO_ROOT" || exit 0
if command -v node >/dev/null 2>&1; then
  node scripts/run-code-review-hook.mjs
fi
exit 0
`;

await mkdir(hooksDir, { recursive: true });
await writeFile(hookPath, hook, 'utf8');
await chmod(hookPath, 0o755);
console.log(`Installed Vortex pre-push hook at ${hookPath}`);
