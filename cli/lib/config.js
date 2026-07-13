'use strict'

// Persistent CLI credential store: ~/.tokenfin/config.json (chmod 600).
// Shape: { key, url, appUrl }.

const fs = require('fs')
const os = require('os')
const path = require('path')

function dir() { return path.join(os.homedir(), '.tokenfin') }
function configPath() { return path.join(dir(), 'config.json') }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return {} }
}

function writeConfig(cfg) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n')
  try { fs.chmodSync(configPath(), 0o600) } catch { /* no-op on Windows */ }
}

module.exports = { dir, configPath, readConfig, writeConfig }
