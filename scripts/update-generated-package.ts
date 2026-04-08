import fs from 'fs';
import path from 'path';
import { writeGeneratedPackageIndex } from './generated-package-index';
import { getPublishableGeneratedPackages } from './packages';
import type { PackageJson } from './types';

// Read the root package.json
const rootPackagePath = path.join(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8')) as PackageJson;
const rootPackageName = rootPackage.name;

if (!rootPackageName) {
  throw new Error(`Root package.json missing package name: ${rootPackagePath}`);
}

const packages = getPublishableGeneratedPackages(rootPackageName);

for (const { dir, publishedPackageName } of packages) {
  const packageJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) continue;
  const generatedPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

  // Update the version and name
  generatedPackage.version = rootPackage.version;
  generatedPackage.name = publishedPackageName;
  // Ensure the package can be published
  delete generatedPackage.private;

  // Ensure publishConfig exists
  generatedPackage.publishConfig ??= { access: 'public' };

  // Normalize peerDependencies: move from non-standard 'peer-dependencies' to 'peerDependencies'
  if (generatedPackage['peer-dependencies']) {
    generatedPackage.peerDependencies = {
      ...(generatedPackage.peerDependencies ?? {}),
      ...generatedPackage['peer-dependencies'],
    };
    delete generatedPackage['peer-dependencies'];
  }

  // If root specifies peerDependencies, prefer those (so the published package matches repo policy)
  if (rootPackage.peerDependencies) {
    generatedPackage.peerDependencies = { ...rootPackage.peerDependencies };
  }

  // Write back the generated package.json
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(generatedPackage, null, 4)}\n`);

  writeGeneratedPackageIndex(dir);

  console.log(`Updated generated package.json: name=${generatedPackage.name}, version=${generatedPackage.version}`);
  console.log(`Created package index files (index.js and index.d.ts) in ${dir}`);
}
