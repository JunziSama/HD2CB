'use strict';
const { ipcRenderer } = require('electron');
const { defaults, ACTIONS, WEAPONS, WEAPON_IDS } = require('./state');
const byId = id => document.getElementById(id);
WEAPON_IDS.forEach(weapon => {
  const option = document.createElement('option');
  option.value = weapon; option.textContent = WEAPONS[weapon].name;
  byId('weapon-select').appendChild(option);
});
let dirty = {};
let loaded = false;

function describeWeapon() {
  byId('weapon-description').textContent = WEAPONS[byId('weapon-select').value].description;
}
function fill(config, force) {
  ACTIONS.forEach(action => {
    if (force || !dirty[action]) {
      byId(action + '-enabled').checked = config.hotkeys[action].enabled;
      byId(action + '-key').value = config.hotkeys[action].accelerator;
    }
  });
  if (force || !dirty.selection) byId('weapon-select').value = config.weapon;
  describeWeapon();
}
function message(text, error) {
  byId('message').textContent = text;
  byId('message').style.color = error ? '#ffb4a9' : '#a9dec2';
}
ipcRenderer.on('settings-state', (event, state) => {
  fill(state.config, !loaded);
  loaded = true;
  byId('status').textContent = state.detection;
  byId('errors').textContent = [state.detectorError, state.inputError, state.configWarning]
    .concat(state.shortcutErrors).filter(Boolean).join('\n');
});
ipcRenderer.on('settings-result', (event, result) => {
  if (result.ok) { dirty = {}; ipcRenderer.send('settings-get'); }
  message(result.message, !result.ok);
});
ACTIONS.forEach(action => {
  byId(action + '-enabled').addEventListener('change', () => { dirty[action] = true; });
  const input = byId(action + '-key');
  input.addEventListener('input', () => { dirty[action] = true; });
  input.addEventListener('keydown', event => {
    if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(event.key) !== -1) return;
    // Keep plain typing and standard clipboard commands available for textual entry.
    if ((event.ctrlKey && !event.altKey && !event.shiftKey && /^[acvx]$/i.test(event.key)) ||
        (!event.ctrlKey && !event.altKey && !event.shiftKey && !/^F\d+$/.test(event.key))) return;
    event.preventDefault();
    if (event.metaKey) { message('不支持 Windows 键，请使用 Ctrl / Alt / Shift。', true); return; }
    const aliases = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : (aliases[event.key] || event.key);
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(key);
    input.value = parts.join('+');
    dirty[action] = true;
  });
});
byId('weapon-select').addEventListener('change', () => { dirty.selection = true; describeWeapon(); });
byId('save').addEventListener('click', () => {
  const hotkeys = {};
  ACTIONS.forEach(action => {
    hotkeys[action] = { enabled: byId(action + '-enabled').checked, accelerator: byId(action + '-key').value };
  });
  ipcRenderer.send('settings-save', { weapon: byId('weapon-select').value, hotkeys: hotkeys });
});
byId('defaults').addEventListener('click', () => {
  fill(defaults(), true); dirty = { selection: true, toggle: true, quit: true, weapon: true };
  message('已填入默认武器与热键，请点击“保存设置”应用。', false);
});
byId('cancel').addEventListener('click', () => ipcRenderer.send('settings-close'));
byId('retry').addEventListener('click', () => ipcRenderer.send('settings-retry'));
ipcRenderer.send('settings-get');
