'use strict'

// Persistent CLI credential store: ~/.tokenfin/config.json (chmod 600).
// Shape: {
//   key,        ingest key (write) — goes into agent OTLP configs
//   read_key,   read key — used for status/doctor/budget/MCP (falls back to key
//               for 0.3-era single read+write keys)
//   device_id,  stable random id for this machine (per-device server keys)
//   url, appUrl,
//   prompts     false when the user opted out with `setup --no-prompts`
// }

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { writeJsonAtomic } = require('./fsx')

function dir() { return path.join(os.homedir(), '.tokenfin') }
function configPath() { return path.join(dir(), 'config.json') }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return {} }
}

function writeConfig(cfg) {
  writeJsonAtomic(configPath(), cfg, { mode: 0o600 })
}

// Stable per-machine id, created on first use and persisted in config.json.
function ensureDeviceId() {
  const cfg = readConfig()
  if (cfg.device_id && /^[A-Za-z0-9-]{8,64}$/.test(cfg.device_id)) return cfg.device_id
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
  writeConfig({ ...cfg, device_id: id })
  return id
}

const readKeyOf = (cfg) => String(cfg.read_key || cfg.key || '').trim()

module.exports = { dir, configPath, readConfig, writeConfig, ensureDeviceId, readKeyOf }
