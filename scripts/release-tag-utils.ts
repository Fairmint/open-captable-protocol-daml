import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { getPackage, getPackageKeys, type PackageConfig, type PackageKey } from './packages';

const ROOT_DIR = path.join(__dirname, '..');

export interface ReleaseTagParts {
  tag: string;
  packageName: string;
  version: string;
}

export interface PackageMajor {
  baseName: string;
  major: number;
}

export interface ResolvedReleasePackage {
  key: PackageKey;
  package: PackageConfig;
}

export interface DamlYamlReleaseInfo {
  name?: string;
  version?: string;
}

interface ParsedReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseReleaseTagName(tag: string): ReleaseTagParts {
  const trimmed = tag.trim();
  const match = /^(?<packageName>.+)-v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(trimmed);
  if (!match?.groups) {
    throw new Error(
      `Invalid release tag "${tag}". Expected <package-name>-v<major>.<minor>.<patch>, for example OpenCapTable-v35-v0.0.2.`
    );
  }

  return {
    tag: trimmed,
    packageName: match.groups.packageName,
    version: match.groups.version,
  };
}

export function parsePackageMajor(packageName: string): PackageMajor | null {
  const match = /^(?<baseName>.+)-v(?<major>\d+)$/.exec(packageName);
  if (!match?.groups) {
    return null;
  }
  return {
    baseName: match.groups.baseName,
    major: Number(match.groups.major),
  };
}

export function resolveReleasePackage(packageName: string): ResolvedReleasePackage {
  const keys = getPackageKeys();
  for (const key of keys) {
    const pkg = getPackage(key);
    if (pkg?.name === packageName) {
      return { key, package: pkg };
    }
  }

  const configured = keys.map((key) => getPackage(key)?.name).filter((name): name is string => name !== undefined);
  throw new Error(
    `Package "${packageName}" is not configured for release automation. Configured packages: ${configured.join(', ')}.`
  );
}

export function readDamlYamlInfo(sourceDir: string): DamlYamlReleaseInfo {
  const damlYamlPath = path.join(ROOT_DIR, sourceDir, 'daml.yaml');
  if (!fs.existsSync(damlYamlPath)) {
    throw new Error(`daml.yaml not found for release package: ${damlYamlPath}`);
  }
  const parsed = yaml.parse(fs.readFileSync(damlYamlPath, 'utf8')) as DamlYamlReleaseInfo;
  return parsed;
}

export function getPreviousPackageTags(baseName: string, currentTag: string): ReleaseTagParts[] {
  let tags: string[] = [];
  try {
    tags = execFileSync('git', ['tag', '--list', '--', `${baseName}-v*-v*`], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    })
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0 && tag !== currentTag);
  } catch {
    return [];
  }

  return tags.flatMap((tag) => {
    try {
      return [parseReleaseTagName(tag)];
    } catch {
      return [];
    }
  });
}

function parseReleaseVersion(version: string): ParsedReleaseVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version);
  if (!match) {
    return { major: 0, minor: 0, patch: 0, prerelease: null };
  }

  const prereleaseIndex = version.indexOf('-');

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: prereleaseIndex === -1 ? null : version.slice(prereleaseIndex + 1),
  };
}

export function getLatestPreviousPackageTag(previousTags: ReleaseTagParts[]): ReleaseTagParts | null {
  return (
    previousTags
      .map((tag) => ({
        tag,
        packageMajor: parsePackageMajor(tag.packageName),
        version: parseReleaseVersion(tag.version),
      }))
      .filter((entry): entry is { tag: ReleaseTagParts; packageMajor: PackageMajor; version: ParsedReleaseVersion } =>
        Boolean(entry.packageMajor)
      )
      .sort((a, b) => {
        if (a.packageMajor.major !== b.packageMajor.major) {
          return b.packageMajor.major - a.packageMajor.major;
        }
        if (a.version.major !== b.version.major) {
          return b.version.major - a.version.major;
        }
        if (a.version.minor !== b.version.minor) {
          return b.version.minor - a.version.minor;
        }
        if (a.version.patch !== b.version.patch) {
          return b.version.patch - a.version.patch;
        }
        if (a.version.prerelease === b.version.prerelease) {
          return 0;
        }
        if (a.version.prerelease === null) {
          return -1;
        }
        if (b.version.prerelease === null) {
          return 1;
        }
        return b.version.prerelease.localeCompare(a.version.prerelease);
      })[0]?.tag ?? null
  );
}
