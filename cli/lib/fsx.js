'use strict'

// Small filesystem helpers shared by every config writer.
//
// writeFileAtomic: write to a sibling temp file, fsync, then rename over the
// target. A crash or Ctrl-C mid-write can never leave a truncated
// settings.json / config.toml behind (rename is atomic on the same volume;
// on Windows Node's rename uses MoveFileEx(REPLACE_EXISTING)). The existing
// file's permission bits are preserved unless an explicit mode is given.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function writeFileAtomic(file, data, opts = {}) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  let mode = opts.mode
  if (mode === undefined) {
    try { mode = fs.statSync(file).mode & 0o777 } catch { mode = undefined }
  }
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex'))
  let fd
  try {
    fd = fs.openSync(tmp, 'w', mode === undefined ? 0o666 : mode)
    fs.writeSync(fd, data)
    try { fs.fsyncSync(fd) } catch { /* not supported on every FS */ }
    fs.closeSync(fd); fd = undefined
    if (mode !== undefined) { try { fs.chmodSync(tmp, mode) } catch { /* Windows */ } }
    fs.renameSync(tmp, file)
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch {} }
    try { fs.unlinkSync(tmp) } catch {}
    throw e
  }
}

function writeJsonAtomic(file, obj, opts) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n', opts)
}

// Parse a JSON file. Missing → {}. Invalid → throws a user-facing error
// (never silently overwrite a file the user hand-edited into a broken state).
function readJsonStrict(file) {
  if (!fs.existsSync(file)) return {}
  const text = fs.readFileSync(file, 'utf8')
  if (!text.trim()) return {}
  try { return JSON.parse(text) }
  catch { throw new Error(file + ' exists but is not valid JSON — fix it, then re-run.') }
}

function backup(file) {
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak-tokenfin') } catch { /* best effort */ } }
}

module.exports = { writeFileAtomic, writeJsonAtomic, readJsonStrict, backup }
