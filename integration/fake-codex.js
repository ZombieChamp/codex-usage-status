const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

const directory = process.env.CODEX_USAGE_TEST_ROOT;
const executable = process.env.CODEX_USAGE_TEST_EXECUTABLE;
if (!directory || !executable || process.argv[2] !== 'app-server') {
  throw new Error('The fake Codex server requires the disposable test directory, launcher identity, and app-server argument.');
}
const record = event => fs.appendFileSync(path.join(directory, 'requests.jsonl'),
  JSON.stringify({ pid: process.pid, executable, ...event }) + '\n'
);
const snapshotFile = path.join(directory, `${path.basename(executable)}.json`);
const reply = message => process.stdout.write(JSON.stringify(message) + '\n');
let initialised = false;
record({ event: 'start' });
process.on('exit', () => record({ event: 'exit' }));
process.on('SIGTERM', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  record({ method: message.method, params: message.params });
  if (message.method === 'initialize') {
    reply({ id: message.id, result: {} });
  } else if (message.method === 'initialized') {
    initialised = true;
  } else if (message.method === 'account/rateLimits/read' && initialised) {
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    reply(snapshot.error
      ? { id: message.id, error: { code: -1, message: snapshot.error } }
      : { id: message.id, result: snapshot.result }
    );
  } else {
    reply({ id: message.id, error: { code: -1, message: 'Invalid test handshake or request.' } });
  }
});
