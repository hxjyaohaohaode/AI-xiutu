import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const paths = ['packages', 'apps'].flatMap((root) =>
  existsSync(root)
    ? readdirSync(root)
        .map((p) => `${root}/${p}/tsconfig.json`)
        .filter(existsSync)
    : [],
);
if (existsSync('scripts/tsconfig.json')) paths.push('scripts/tsconfig.json');
if (!paths.length) throw new Error('No TypeScript projects configured.');
for (const path of paths) {
  console.log(`Typecheck ${path}`);
  const result = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-p', path, '--noEmit'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
