const semver = require('semver');
const manifest = require('../package.json');
const { isolatedEnvironment, runWorker, runIsolated } = require('./compatibility-processes');

function minimumVersion(packageJson = manifest) {
  const minimum = semver.minVersion(packageJson.engines.vscode);
  if (!minimum || minimum.major < 1 || minimum.prerelease.length) {
    throw new Error('engines.vscode must declare a stable minimum VS Code version.');
  }
  return minimum.version;
}

function parseArguments(args, packageJson = manifest) {
  let versions = [minimumVersion(packageJson), 'stable'];
  let probe = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--version') {
      let version = args[++index];
      if (version === 'minimum') {
        version = minimumVersion(packageJson);
      } else if (version !== 'stable') {
        const release = semver.parse(version);
        if (!release || release.prerelease.length) {
          throw new Error('--version requires minimum, stable, or an exact stable VS Code release.');
        }
        version = release.version;
      }
      versions = [version];
    } else if (args[index] === '--probe') {
      probe = true;
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  for (const version of versions) {
    if (version !== 'stable' && !semver.satisfies(version, packageJson.engines.vscode) && !probe) {
      throw new Error(`VS Code ${version} is outside engines.vscode. Use --probe to change only the temporary manifest.`);
    }
  }
  return { versions, probe };
}

async function main(args) {
  const { versions, probe } = parseArguments(args);
  if (process.platform === 'win32') {
    throw new Error('The disposable VS Code tests currently run on Linux and macOS. Use CI or WSL on Windows.');
  }
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    throw new Error('A display is required. On headless Linux, run xvfb-run -a npm run test:compat, or use CI.');
  }
  const controller = new AbortController();
  const interrupted = () => controller.abort(new Error('Compatibility tests cancelled.'));
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    for (const version of versions) {
      console.log(`Testing the packaged extension on VS Code ${version}${probe ? ' with a temporary engine override' : ''}.`);
      await runIsolated(version, { probe, signal: controller.signal });
    }
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { minimumVersion, parseArguments, isolatedEnvironment, runWorker, runIsolated };
