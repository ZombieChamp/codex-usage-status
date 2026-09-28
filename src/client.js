const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { homedir } = require('node:os');

class CodexClient {
  constructor(executable, {
    args = ['app-server'],
    timeout = 15000,
    onUpdate = () => {}
  } = {}) {
    this.pending = new Map();
    this.nextId = 0;
    this.timeout = timeout;
    this.closed = false;
    this.proc = spawn(executable, args, {
      cwd: homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.lines = createInterface({ input: this.proc.stdout });
    this.lines.on('line', line => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.method) {
        if (message.id !== undefined) {
          this.send({
            id: message.id,
            error: { code: -32601, message: 'Unsupported method' }
          });
        } else if (message.method === 'account/rateLimits/updated') {
          onUpdate(message.params);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'Codex request failed'));
      } else {
        pending.resolve(message.result);
      }
    });
    this.proc.stderr.resume();
    this.proc.on('error', error => this.fail(error));
    this.proc.stdin.on('error', error => this.fail(error));
    this.proc.on('exit', () => this.fail(new Error('Codex app server stopped')));
  }

  send(message) {
    if (!this.closed) this.proc.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('Codex app server is unavailable'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex usage request timed out'));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: {
        name: 'codex_usage_status',
        title: 'Codex Usage Status',
        version: '0.1.0'
      }
    });
    this.send({ method: 'initialized', params: {} });
  }

  fail(error) {
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  dispose() {
    this.fail(new Error('Codex connection closed'));
    this.lines.close();
    this.proc.stdin.destroy();
    this.proc.kill();
    const timer = setTimeout(() => {
      if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
    }, 2000);
    timer.unref();
  }
}

module.exports = { CodexClient };
