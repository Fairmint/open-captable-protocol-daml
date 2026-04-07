import fs from 'fs';
import { writeGeneratedPackageIndex } from './generated-package-index';
import { getGeneratedPackages } from './packages';

for (const { dir: generatedDir } of getGeneratedPackages()) {
  if (!fs.existsSync(generatedDir)) continue;
  writeGeneratedPackageIndex(generatedDir);
  console.log(`Created package index files (index.js and index.d.ts) in ${generatedDir}`);
}
