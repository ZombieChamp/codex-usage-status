const fs = require('fs/promises');
const path = require('path');

/**
 * @param {string} file
 * @param {unknown} value
 */
async function writeJson(file, value) {
  const directory = await fs.mkdtemp(`${file}.`);
  try {
    const temporary = path.join(directory, 'value.json');
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { writeJson };
