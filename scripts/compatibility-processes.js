const { spawn } = require('node:child_process');
const { writeSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');

function isolatedEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !key.startsWith('VSCODE_') && key !== 'ELECTRON_RUN_AS_NODE'
  ));
}

/**
 * @typedef {{type: 'launch-application', executablePath: string, args: string[], env: NodeJS.ProcessEnv}
 *   | {type: 'close-application'}} ApplicationCommand
 */

/** @param {ApplicationCommand} command */
function applicationCommand(command, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const finish = (error, reply) => {
      clearTimeout(timer);
      process.removeListener('message', received);
      if (error) reject(error);
      else resolve(reply);
    };
    const received = reply => {
      if (reply?.type === command.type) finish(undefined, reply);
    };
    const timer = setTimeout(() => finish(new Error(`${command.type} timed out.`)), timeout);
    process.on('message', received);
    if (!process.send) {
      finish(new Error('Application commands require the compatibility supervisor.'));
      return;
    }
    process.send(command, error => { if (error) finish(error); });
  });
}

function stopProcesses(processes, signal) {
  for (const { child } of processes) {
    if (!child.pid) continue;
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function runWorker(work) {
  try {
    await work();
  } catch (error) {
    writeSync(2, `${error?.stack ?? error}\n`);
    process.exit(1);
  }
}

async function runIsolated(version, {
  probe = false,
  signal,
  workerPath = path.resolve(__dirname, '../integration/vscode.js'),
  onDirectory = () => {},
  timeout = 10 * 60 * 1000
} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-usage-compat-'));
  const processes = [];
  const own = child => {
    const closed = new Promise(resolve => child.once('close', resolve));
    processes.push({ child, closed });
    return child;
  };
  try {
    onDirectory(directory);
    if (signal?.aborted) throw signal.reason;
    const worker = own(spawn(process.execPath, [workerPath, directory, version, String(probe)], {
      env: { ...isolatedEnvironment(), TMPDIR: directory, TMP: directory, TEMP: directory },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      detached: process.platform !== 'win32'
    }));
    await new Promise((resolve, reject) => {
      let application;
      let applicationState;
      let applicationStderr = '';
      let failure;
      let forceStop;
      let finished = false;
      const terminate = reason => {
        if (finished || failure) return;
        failure = reason;
        stopProcesses(processes, 'SIGTERM');
        forceStop = setTimeout(() => stopProcesses(processes, 'SIGKILL'), 5000);
      };
      const reply = message => {
        if (worker.connected) worker.send(message, () => {});
      };
      const requested = command => {
        if (finished || failure) return;
        if (command?.type === 'launch-application' && !application) {
          application = own(spawn(command.executablePath, [...command.args, '--remote-debugging-port=0'], {
            env: { ...command.env, NODE_OPTIONS: undefined },
            stdio: ['ignore', 'ignore', 'pipe'],
            detached: process.platform !== 'win32'
          }));
          applicationState = 'starting';
          application.stderr.setEncoding('utf8');
          application.stderr.on('data', chunk => {
            applicationStderr = (applicationStderr + chunk).slice(-16 * 1024);
          });
          const lines = createInterface({ input: application.stderr });
          lines.on('line', line => {
            const match = /DevTools listening on (ws:\/\/\S+)/.exec(line);
            if (match && applicationState === 'starting') {
              applicationState = 'running';
              reply({ type: command.type, endpoint: match[1] });
            }
          });
          application.once('error', terminate);
          application.once('close', (code, exitSignal) => {
            if (applicationState === 'closing') reply({ type: 'close-application' });
            else terminate(new Error(`VS Code ${version} application stopped with ${exitSignal ?? `exit code ${code}`}.`));
          });
        } else if (command?.type === 'close-application' && application) {
          applicationState = 'closing';
          application.kill('SIGTERM');
        } else {
          terminate(new Error('Unexpected compatibility application command.'));
        }
      };
      worker.on('message', requested);
      const aborted = () => terminate(signal.reason ?? new Error('Compatibility tests cancelled.'));
      const timer = setTimeout(() => terminate(new Error(`VS Code ${version} tests timed out.`)), timeout);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(forceStop);
        signal?.removeEventListener('abort', aborted);
        worker.removeListener('message', requested);
        const reason = failure ?? error;
        if (reason) {
          const stderr = applicationStderr.trim();
          reject(stderr ? new Error(`${reason.message}\nVS Code ${version} application stderr:\n${stderr}`, {
            cause: reason
          }) : reason);
        } else {
          resolve();
        }
      };
      worker.once('error', finish);
      worker.once('close', (code, exitSignal) => finish(code === 0 ? undefined :
        new Error(`VS Code ${version} tests failed with ${exitSignal ?? `exit code ${code}`}.`)
      ));
    });
  } finally {
    stopProcesses(processes, 'SIGKILL');
    await Promise.all(processes.map(({ closed }) => closed));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    console.log(`Removed temporary test files for VS Code ${version}.`);
  }
}

module.exports = { isolatedEnvironment, applicationCommand, runWorker, runIsolated };
