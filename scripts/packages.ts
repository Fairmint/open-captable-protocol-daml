/**
 * Shared package configurations. Single source of truth: daml.yaml files. Versions are read dynamically from each
 * package's daml.yaml.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// =============================================================================
// Package Configurations
// =============================================================================

export interface PackageConfig {
  /** Display name (e.g., 'OpenCapTable-v36') */
  name: string;
  /** DAR file name without extension (usually same as name) */
  darName: string;
  /** Current version (read from daml.yaml) */
  version: string;
  /** Source directory relative to repo root */
  sourceDir: string;
  /** Generated build directory relative to repo root */
  buildDir: string;
  /** Generated JS package metadata, if this package produces a generated package. */
  generated?: GeneratedPackageMetadata;
  /**
   * Keys of this repository's packages that this package data-depends on, in upload order. A participant must hold them
   * before it can vet this package.
   */
  dependencies: string[];
}

export interface GeneratedPackageMetadata {
  /** Whether scripts should create standalone package index files for this generated package. */
  createIndex: boolean;
  /**
   * Published npm package suffix for generated packages.
   *
   * - `null` means publish as the root package name
   * - `string` means append `-${suffix}` to the root package name
   * - `undefined` means this generated package is not published standalone
   */
  publishNameSuffix?: string | null;
}

const ROOT_DIR = path.join(__dirname, '..');

interface DamlPackageMetadata {
  name: string;
  version: string;
}

/** Read package metadata from daml.yaml. This ensures daml.yaml is the single source of truth. */
function readMetadataFromDamlYaml(sourceDir: string): DamlPackageMetadata {
  const yamlPath = path.join(ROOT_DIR, sourceDir, 'daml.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`daml.yaml not found: ${yamlPath}`);
  }
  const content = fs.readFileSync(yamlPath, 'utf8');
  return yaml.parse(content) as DamlPackageMetadata;
}

interface PackageDef {
  sourceDir: string;
  generated?: GeneratedPackageMetadata;
  dependencies?: readonly string[];
}

/**
 * Package definitions - versions are loaded lazily from daml.yaml. Keys are short aliases used in CLI commands.
 *
 * OpenCapTable-v36 data-depends on the reader interfaces (OpenCapTableApi-v01), which are bundled into the npm `lib/`
 * and released with it.
 */
const PACKAGE_DEFS = {
  api: {
    sourceDir: 'OpenCapTableApi-v01',
  },
  ocp: {
    sourceDir: 'OpenCapTable-v36',
    generated: { createIndex: true, publishNameSuffix: null },
    dependencies: ['api'],
  },
} as const satisfies Record<string, PackageDef>;

type PackageDefKey = keyof typeof PACKAGE_DEFS;

/** Build full package config by reading version from daml.yaml. */
function buildPackageConfig(def: PackageDef): PackageConfig {
  const metadata = readMetadataFromDamlYaml(def.sourceDir);
  return {
    name: metadata.name,
    darName: metadata.name,
    version: metadata.version,
    sourceDir: def.sourceDir,
    buildDir: path.join('generated', 'build', metadata.name),
    generated: def.generated ? { ...def.generated } : undefined,
    dependencies: [...(def.dependencies ?? [])],
  };
}

/** All known DAML packages with versions read from daml.yaml. Computed lazily on first access. */
let _packagesCache: Record<PackageDefKey, PackageConfig> | null = null;

function getPackages(): Record<PackageDefKey, PackageConfig> {
  if (!_packagesCache) {
    _packagesCache = {} as Record<PackageDefKey, PackageConfig>;
    for (const [key, def] of Object.entries(PACKAGE_DEFS)) {
      _packagesCache[key as PackageDefKey] = buildPackageConfig(def);
    }
  }
  return _packagesCache;
}

/** All package configs (one entry per CLI alias). */
export function getAllPackages(): PackageConfig[] {
  return Object.values(getPackages());
}

function resolvePackageKey(key: string): PackageDefKey | undefined {
  const lowerKey = key.toLowerCase();
  return (Object.keys(PACKAGE_DEFS) as PackageDefKey[]).find((candidate) => candidate.toLowerCase() === lowerKey);
}

/**
 * Get package config by short key (e.g., 'ocp') or full name (e.g., 'OpenCapTable-v36'). Key lookup is
 * case-insensitive.
 */
export function getPackage(keyOrName: string): PackageConfig | undefined {
  const packages = getPackages();
  const matchingKey = resolvePackageKey(keyOrName);
  if (matchingKey) {
    return packages[matchingKey];
  }
  // Also support lookup by full daml.yaml name or source directory (case-insensitive)
  const lower = keyOrName.toLowerCase();
  return Object.values(packages).find(
    (pkg) => pkg.name.toLowerCase() === lower || pkg.sourceDir.toLowerCase() === lower
  );
}

/**
 * Get package config or throw an error if not found. Use this when a package is required and failure should be an
 * exception (e.g., in scripts that need a package to exist).
 */
export function requirePackageConfig(packageKey: string): PackageConfig {
  const pkg = getPackage(packageKey);
  if (!pkg) {
    throw new Error(`Unknown package key: ${packageKey}`);
  }
  return pkg;
}

/**
 * The packages to upload for `keyOrName`, dependencies first (each once), ending with the package itself. A participant
 * must hold a package's dependencies before it can vet the package.
 */
export function getUploadOrder(keyOrName: string): PackageConfig[] {
  const order: PackageConfig[] = [];
  const visit = (key: string, chain: string[]): void => {
    const pkg = requirePackageConfig(key);
    if (chain.includes(pkg.name)) {
      throw new Error(`Package dependency cycle: ${[...chain, pkg.name].join(' -> ')}`);
    }
    for (const dependency of pkg.dependencies) {
      visit(dependency, [...chain, pkg.name]);
    }
    if (!order.some((existing) => existing.name === pkg.name)) {
      order.push(pkg);
    }
  };
  visit(keyOrName, []);
  return order;
}

export interface GeneratedPackageConfig {
  key: PackageDefKey;
  package: PackageConfig;
  dir: string;
  publishedPackageName?: string;
}

export interface PublishableGeneratedPackageConfig extends GeneratedPackageConfig {
  publishedPackageName: string;
}

function buildPublishedPackageName(rootPackageName: string, suffix?: string | null): string | undefined {
  if (suffix === undefined) {
    return undefined;
  }
  return suffix === null ? rootPackageName : `${rootPackageName}-${suffix}`;
}

/** Resolve the generated JS output directory for a package. */
export function getGeneratedPackageDir(packageKey: string): string {
  const pkg = requirePackageConfig(packageKey);
  return path.join(ROOT_DIR, 'generated', 'js', `${pkg.name}-${pkg.version}`);
}

/** Generated packages that should receive standalone index files. */
export function getGeneratedPackages(rootPackageName?: string): GeneratedPackageConfig[] {
  const packages = getPackages();

  return (Object.keys(PACKAGE_DEFS) as PackageDefKey[])
    .map((key): GeneratedPackageConfig | null => {
      const pkg = packages[key];
      if (!pkg.generated?.createIndex) {
        return null;
      }
      return {
        key,
        package: pkg,
        dir: getGeneratedPackageDir(key),
        publishedPackageName: rootPackageName
          ? buildPublishedPackageName(rootPackageName, pkg.generated.publishNameSuffix)
          : undefined,
      };
    })
    .filter((pkg): pkg is GeneratedPackageConfig => pkg !== null);
}

/** Generated packages that are published as standalone npm packages. */
export function getPublishableGeneratedPackages(rootPackageName: string): PublishableGeneratedPackageConfig[] {
  return getGeneratedPackages(rootPackageName).filter(
    (pkg): pkg is PublishableGeneratedPackageConfig => pkg.publishedPackageName !== undefined
  );
}
