import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Compilation imports authentication routes. This temporary value only exists
// in the build subprocesses; the running server still needs its own secret.
const env = { ...process.env, BETTER_AUTH_SECRET: randomBytes(32).toString('base64') };
const commands = [
  [require.resolve('prisma/build/index.js'), 'generate'],
  [require.resolve('next/dist/bin/next'), 'build', '--webpack'],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error('Build interrompido. Verifique os erros acima.');
    process.exit(result.status || 1);
  }
}
