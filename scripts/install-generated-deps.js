const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const generatedJsDir = path.join(__dirname, '..', 'generated', 'js');

// Find all package.json files in generated/js
const packages = fs.readdirSync(generatedJsDir)
  .filter(dir => {
    const packageJsonPath = path.join(generatedJsDir, dir, 'package.json');
    return fs.existsSync(packageJsonPath);
  })
  .map(dir => path.join(generatedJsDir, dir));

console.log('Found packages:', packages.map(p => path.basename(p)));

// Install dependencies for each package that has dependencies
packages.forEach(packageDir => {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
    console.log(`Installing dependencies for ${path.basename(packageDir)}...`);
    try {
      execSync('npm install --no-package-lock --silent', {
        cwd: packageDir,
        stdio: 'inherit'
      });
      console.log(`✓ Dependencies installed for ${path.basename(packageDir)}`);
    } catch (error) {
      console.error(`✗ Failed to install dependencies for ${path.basename(packageDir)}:`, error.message);
      process.exit(1);
    }
  } else {
    console.log(`Skipping ${path.basename(packageDir)} (no dependencies)`);
  }
});

console.log('All dependencies installed successfully!'); 