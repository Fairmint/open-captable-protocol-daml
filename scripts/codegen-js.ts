#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { requirePackageConfig } from './packages';

const ROOT = path.resolve(__dirname, '..');
const DPM_PATH = [process.env.HOME ? path.join(process.env.HOME, '.dpm', 'bin') : undefined, process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter);
const ENV = { ...process.env, PATH: DPM_PATH };

function run(command: string, args: string[], cwd = ROOT): void {
  const result = spawnSync(command, args, {
    cwd,
    env: ENV,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`${command} ${args.join(' ')} terminated with signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

function runTsx(script: string): void {
  run('tsx', [script]);
}

run('npm', ['run', 'build']);

const packageConfig = requirePackageConfig('ocp');
run('dpm', ['codegen-js'], path.join(ROOT, packageConfig.buildDir));

runTsx('scripts/bundle-dependencies.ts');
runTsx('scripts/create-package-index.ts');
runTsx('scripts/create-root-index.ts');
runTsx('scripts/fix-splice-refs.ts');
run('npm', ['run', 'build:ts']);
runTsx('scripts/stage-npm-opencaptable-dar.ts');
run('npm', ['run', 'build:npm-runtime-lib']);
