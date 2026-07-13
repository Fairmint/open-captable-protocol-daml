import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { assertDarArchiveSafe, DAML_INSPECT_TIMEOUT_MS } from './dar-archive-policy';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readStringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return undefined;
}

function packageMetadataMatches(value: Record<string, unknown>, packageName: string, version: string): boolean {
  const name = readStringField(value, ['name', 'packageName', 'package_name']);
  const packageVersion = readStringField(value, ['version', 'packageVersion', 'package_version']);
  return name === packageName && (!packageVersion || packageVersion === version);
}

function findPackageIdInInspectJson(value: unknown, packageName: string, version: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPackageIdInInspectJson(item, packageName, version);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;

  const { packages } = value;
  if (isObject(packages)) {
    const mainPackageId = readStringField(value, ['main_package_id', 'mainPackageId']);
    if (mainPackageId) {
      const mainPackage = packages[mainPackageId];
      if (isObject(mainPackage) && packageMetadataMatches(mainPackage, packageName, version)) return mainPackageId;
    }
    for (const [packageId, metadata] of Object.entries(packages)) {
      if (isObject(metadata) && packageMetadataMatches(metadata, packageName, version)) return packageId;
    }
  }

  const packageId = readStringField(value, ['packageId', 'package_id']);
  if (packageId && packageMetadataMatches(value, packageName, version)) return packageId;

  for (const child of Object.values(value)) {
    const found = findPackageIdInInspectJson(child, packageName, version);
    if (found) return found;
  }
  return null;
}

function resolveDpmExecutable(): string {
  const homeDpm = process.env.HOME ? path.join(process.env.HOME, '.dpm', 'bin', 'dpm') : '';
  return homeDpm && fs.existsSync(homeDpm) ? homeDpm : 'dpm';
}

export function inspectDarPackageId(darPath: string, packageName: string, version: string): string {
  assertDarArchiveSafe(darPath);
  let raw: string;
  try {
    raw = execFileSync(resolveDpmExecutable(), ['damlc', 'inspect-dar', darPath, '--json'], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      maxBuffer: 20 * 1024 * 1024,
      timeout: DAML_INSPECT_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect ${packageName} ${version} DAR package id: ${message}`);
  }
  const packageId = findPackageIdInInspectJson(JSON.parse(raw) as unknown, packageName, version);
  if (!packageId) throw new Error(`Could not find ${packageName} ${version} in ${darPath}`);
  return packageId;
}
