'use strict';
const fs = require('fs');
const path = require('path');
const { defaults, validateConfig } = require('./state');

function readConfig(filename) {
  try {
    const stored = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return { config: validateConfig(stored), warning: null, migrated: stored.version < 3 };
  } catch (error) {
    return { config: defaults(), warning: error.code === 'ENOENT' ? null : '配置无法读取或已损坏，本次已使用默认设置。' };
  }
}

function writeConfig(filename, value) {
  const config = validateConfig(value);
  const temp = filename + '.tmp';
  // Node 10.11 (Electron 4) predates fs.mkdir's recursive option.
  function ensureDirectory(directory) {
    if (fs.existsSync(directory)) return;
    ensureDirectory(path.dirname(directory));
    try { fs.mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  ensureDirectory(path.dirname(filename));
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(temp, filename);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return config;
}

module.exports = { readConfig, writeConfig };
