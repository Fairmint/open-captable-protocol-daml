/** Read a package's ID from its DAR with `dpm damlc inspect-dar`. */

import { execFileSync } from 'child_process';
import * as path from 'path';

const ROOT_DIR = path.join(__dirname, '..');

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readStringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function packageMetadataMatches(value: Record<string, unknown>, packageName: string, version: string): boolean {
  const name = readStringField(value, ['name', 'packageName', 'package_name']);
  const packageVersion = readStringField(value, ['version', 'packageVersion', 'package_version']);
  return name === packageName && (!packageVersion || packageVersion === version);
}

function findPackageIdInPackageMap(
  value: Record<string, unknown>,
  packageName: string,
  version: string
): string | null {
  const { packages } = value;
  if (!isObject(packages)) {
    return null;
  }

  const mainPackageId = readStringField(value, ['main_package_id', 'mainPackageId']);
  if (mainPackageId) {
    const mainPackage = packages[mainPackageId];
    if (isObject(mainPackage) && packageMetadataMatches(mainPackage, packageName, version)) {
      return mainPackageId;
    }
  }

  for (const [packageId, metadata] of Object.entries(packages)) {
    if (isObject(metadata) && packageMetadataMatches(metadata, packageName, version)) {
      return packageId;
    }
  }

  return null;
}

function findPackageIdInInspectJson(value: unknown, packageName: string, version: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPackageIdInInspectJson(item, packageName, version);
      if (found) return found;
    }
    return null;
  }

  if (!isObject(value)) {
    return null;
  }

  const packageMapMatch = findPackageIdInPackageMap(value, packageName, version);
  if (packageMapMatch) {
    return packageMapMatch;
  }

  const packageId = readStringField(value, ['packageId', 'package_id']);
  if (packageId && packageMetadataMatches(value, packageName, version)) {
    return packageId;
  }

  for (const child of Object.values(value)) {
    const found = findPackageIdInInspectJson(child, packageName, version);
    if (found) return found;
  }
  return null;
}

export function inspectDarPackageId(darPath: string, packageName: string, version: string): string {
  let raw: string;
  try {
    raw = execFileSync('dpm', ['damlc', 'inspect-dar', darPath, '--json'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to inspect DAR package id with dpm: ${message}`);
  }

  const parsed = JSON.parse(raw) as unknown;
  const packageId = findPackageIdInInspectJson(parsed, packageName, version);
  if (!packageId) {
    throw new Error(`Could not find package id for ${packageName} ${version} in ${darPath}`);
  }
  return packageId;
}
