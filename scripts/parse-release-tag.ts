#!/usr/bin/env node
/**
 * Parse and validate package-scoped release tags.
 *
 * Usage: tsx scripts/parse-release-tag.ts OpenCapTable-v35-v0.0.1
 */

import {
  getLatestPreviousPackageTag,
  getPreviousPackageTags,
  parsePackageMajor,
  parseReleaseTagName,
  readDamlYamlInfo,
  resolveReleasePackage,
} from './release-tag-utils';

function getReleaseTagArg(): string {
  const arg = process.argv.slice(2).find((value) => !value.startsWith('-')) ?? process.env.GITHUB_REF_NAME;
  if (!arg) {
    throw new Error('Missing release tag. Pass a tag argument or set GITHUB_REF_NAME.');
  }
  return arg;
}

function main(): void {
  const tag = parseReleaseTagName(getReleaseTagArg());
  const resolvedPackage = resolveReleasePackage(tag.packageName);
  const damlYaml = readDamlYamlInfo(resolvedPackage.package.sourceDir);

  if (damlYaml.name !== resolvedPackage.package.name) {
    throw new Error(
      `Tag package "${tag.packageName}" resolves to ${resolvedPackage.package.sourceDir}/daml.yaml, but daml.yaml name is "${damlYaml.name}".`
    );
  }
  if (damlYaml.version !== tag.version) {
    throw new Error(
      `Tag version "${tag.version}" does not match ${resolvedPackage.package.sourceDir}/daml.yaml version "${damlYaml.version}".`
    );
  }

  const packageMajor = parsePackageMajor(tag.packageName);
  const previousTags = packageMajor ? getPreviousPackageTags(packageMajor.baseName, tag.tag) : [];
  const previousPackageTag = getLatestPreviousPackageTag(previousTags);
  const previousPackageMajor = previousPackageTag ? parsePackageMajor(previousPackageTag.packageName) : null;
  const isMajorUpgrade =
    packageMajor !== null && previousPackageMajor !== null && packageMajor.major > previousPackageMajor.major;

  process.stdout.write(
    `${JSON.stringify(
      {
        tag: tag.tag,
        package: resolvedPackage.package.name,
        package_key: resolvedPackage.key,
        source_dir: resolvedPackage.package.sourceDir,
        version: tag.version,
        is_major_upgrade: isMajorUpgrade,
        previous_package_tag: previousPackageTag?.tag ?? null,
        needs_factory: isMajorUpgrade,
        factory_script: 'npx tsx scripts/create-ocp-factory.ts --network <devnet|mainnet>',
      },
      null,
      2
    )}\n`
  );
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ ${message}`);
  process.exit(1);
}
