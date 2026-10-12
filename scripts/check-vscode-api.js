const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { minimumVersion } = require('./vscode-compatibility');
const manifest = require('../package.json');

function checkTypeVersion(packageJson = manifest, installed = require('@types/vscode/package.json')) {
  const minimum = minimumVersion(packageJson);
  if (packageJson.devDependencies['@types/vscode'] !== minimum || installed.version !== minimum) {
    throw new Error(`Pin @types/vscode to ${minimum}, the minimum declared by engines.vscode, and run npm install.`);
  }
  return minimum;
}

if (require.main === module) {
  try {
    const minimum = checkTypeVersion();
    console.log(`Checking JavaScript against the VS Code ${minimum} API.`);
    const result = spawnSync(process.execPath, [
      require.resolve('typescript/bin/tsc'),
      '--project', path.resolve(__dirname, '../tsconfig.compatibility.json')
    ], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkTypeVersion };
