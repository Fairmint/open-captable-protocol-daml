#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { requirePackageConfig } from './packages';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_JS_DIR = path.join(ROOT, 'generated', 'js');
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

/**
 * Source daml.yaml uses `../generated/js` (correct from package source dirs). After prepare-build, packages live under
 * `generated/build/<pkg>/`, so rewrite the prepared codegen output to repo-root `generated/js` before invoking `dpm
 * codegen-js`.
 */
function ensurePreparedCodegenOutputDirectory(buildDirRelative: string): void {
  const buildDir = path.join(ROOT, buildDirRelative);
  const damlYamlPath = path.join(buildDir, 'daml.yaml');
  const damlYaml = yaml.parse(fs.readFileSync(damlYamlPath, 'utf8')) as {
    codegen?: { js?: { 'output-directory'?: string } };
  };
  if (!damlYaml.codegen?.js) {
    throw new Error(`${path.relative(ROOT, damlYamlPath)} is missing codegen.js`);
  }

  const relativeOutputDir = path.relative(buildDir, GENERATED_JS_DIR);
  const current = damlYaml.codegen.js['output-directory'];
  if (current && path.resolve(buildDir, current) === GENERATED_JS_DIR) {
    return;
  }

  damlYaml.codegen.js['output-directory'] = relativeOutputDir;
  fs.writeFileSync(damlYamlPath, yaml.stringify(damlYaml));
  console.log(`Set codegen.js.output-directory to ${relativeOutputDir} in ${path.relative(ROOT, damlYamlPath)}`);
}

run('npm', ['run', 'build']);

const packageConfig = requirePackageConfig('ocp');
ensurePreparedCodegenOutputDirectory(packageConfig.buildDir);
run('dpm', ['codegen-js'], path.join(ROOT, packageConfig.buildDir));

runTsx('scripts/bundle-dependencies.ts');
runTsx('scripts/create-package-index.ts');
runTsx('scripts/create-root-index.ts');
runTsx('scripts/fix-splice-refs.ts');
run('npm', ['run', 'build:ts']);
runTsx('scripts/stage-npm-opencaptable-dar.ts');
run('npm', ['run', 'build:npm-runtime-lib']);
