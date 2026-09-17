'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const EventEmitter = require('events');
const state = require('../src/state');
const configIO = require('../src/config');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hd2cb-unit-'));

test('defaults and accelerator normalization', () => {
  assert.strictEqual(state.defaults().mode, 'right-mouse');
  assert.strictEqual(state.normalizeAccelerator('shift+control+f12'), 'Ctrl+Shift+F12');
  assert.strictEqual(state.normalizeAccelerator('alt+left'), 'Alt+Left');
  ['A', 'Ctrl+', 'Win+F1', 'Ctrl+Ctrl+A', 'F25', '', null].forEach(key =>
    assert.throws(() => state.normalizeAccelerator(key)));
});
test('reject duplicate hotkeys, invalid modes and invalid switch types', () => {
  const config = state.defaults(); config.hotkeys.quit.accelerator = 'f1';
  assert.throws(() => state.validateConfig(config));
  assert.throws(() => state.validateConfig(Object.assign(state.defaults(), { mode: 'bad' })));
  config.hotkeys.quit.accelerator = 'F2'; config.hotkeys.quit.enabled = 'yes';
  assert.throws(() => state.validateConfig(config));
});
test('process takes priority; exact title only falls back when process unavailable', () => {
  const sample = { hasWindow: true, minimized: false, error: null, processName: 'HELLDIVERS2.EXE', title: '' };
  assert(state.isHD2(sample));
  sample.processName = 'notepad.exe'; sample.title = 'HELLDIVERS™ 2';
  assert(!state.isHD2(sample));
  sample.processName = null; assert(state.isHD2(sample));
  sample.title += ' - browser'; assert(!state.isHD2(sample));
  sample.processName = 'helldivers2.exe'; sample.minimized = true; assert(!state.isHD2(sample));
  sample.minimized = false; sample.error = 'failed'; assert(!state.isHD2(sample));
});
test('all three display modes remain gated by focus', () => {
  state.MODES.forEach(mode => {
    const model = new state.ChargeState(mode);
    model.mouse(2, true, 100); assert(!model.snapshot(100).visible);
    model.setFocus(true); model.mouse(2, true, 100);
    assert.strictEqual(model.snapshot(100).visible, mode !== 'hidden');
    model.mouse(2, false, 200);
    assert.strictEqual(model.snapshot(200).visible, mode === 'always');
    model.setFocus(false); assert(!model.snapshot(300).visible);
  });
});
test('focus loss resets held buttons and charge; heartbeat does not restart charge', () => {
  const model = new state.ChargeState('right-mouse');
  model.setFocus(true); model.mouse(2, true, 100); model.mouse(1, true, 100);
  model.setFocus(true, 2200); assert.strictEqual(model.snapshot(2200).elapsed, 2100);
  model.setFocus(false, 2300); model.mouse(1, true, 2300); model.setFocus(true, 2400);
  assert.strictEqual(model.snapshot(2400).visible, false);
  assert.strictEqual(model.snapshot(2400).elapsed, 0);
  model.mouse(2, true, 2500); assert(!model.snapshot(2600).charging);
  model.mouse(1, true, 2700); assert.strictEqual(model.snapshot(2800).elapsed, 100);
  model.mouse(1, false, 2900); assert.strictEqual(model.snapshot(3000).elapsed, 0);
});
test('weapon colors, caps and markers match researched thresholds', () => {
  [[999, 'gray'], [1000, 'green'], [2499, 'green'], [2500, 'yellow'], [2599, 'yellow'], [2600, 'red'], [3250, 'red']]
    .forEach(pair => assert.strictEqual(state.chargeStyle(pair[0], 'epoch').color, pair[1]));
  assert.strictEqual(state.chargeStyle(3250, 'epoch').percent, 100);
  assert.strictEqual(state.chargeStyle(9000, 'epoch').percent, 100);
  [[449, 'gray'], [450, 'green'], [1999, 'green'], [2000, 'yellow'], [2499, 'yellow'], [2500, 'red'], [2999, 'red']]
    .forEach(pair => assert.strictEqual(state.chargeStyle(pair[0], 'railgun').color, pair[1]));
  assert.strictEqual(state.chargeStyle(3000, 'railgun').color, 'red');
  assert.strictEqual(state.chargeStyle(3000, 'railgun').percent, 100);
  assert.deepStrictEqual(state.WEAPONS.epoch.markers.map(item => item.at), [1000, 2500, 2600]);
  assert.deepStrictEqual(state.WEAPONS.railgun.markers.map(item => item.at), [450, 2000, 2500]);
});
test('legacy migration preserves settings and chooses an unused weapon shortcut', () => {
  const old = { version: 1, mode: 'always', hotkeys: { toggle: { enabled: false, accelerator: 'f3' }, quit: { enabled: true, accelerator: 'F4' } } };
  const migrated = state.validateConfig(old);
  assert.strictEqual(migrated.version, 2); assert.strictEqual(migrated.weapon, 'epoch');
  assert.strictEqual(migrated.mode, 'always'); assert.strictEqual(migrated.hotkeys.toggle.enabled, false);
  assert.strictEqual(migrated.hotkeys.weapon.accelerator, 'F5');
  assert.strictEqual(old.version, 1);
  const filename = path.join(temp, 'legacy.json'); fs.writeFileSync(filename, JSON.stringify(old));
  assert(configIO.readConfig(filename).migrated); assert.strictEqual(configIO.readConfig(filename).warning, null);
  const duplicate = state.defaults(); duplicate.hotkeys.weapon.accelerator = 'F2';
  assert.throws(() => state.validateConfig(duplicate));
  assert.throws(() => state.validateConfig(Object.assign(state.defaults(), { weapon: 'unknown' })));
});
test('railgun holds red for 500 ms, ignores release after full charge, and waits through focus changes', () => {
  const model = new state.ChargeState('always', 'railgun'); model.setFocus(true, 0);
  model.mouse(1, true, 100);
  assert.strictEqual(model.snapshot(3099).phase, 'charging');
  assert.strictEqual(model.snapshot(3100).phase, 'complete');
  model.mouse(1, false, 3200); assert.strictEqual(model.snapshot(3200).elapsed, 3100);
  assert(model.snapshot(3599).visible); assert(!model.snapshot(3600).visible);
  model.setFocus(false, 3700); model.setFocus(true, 3800); assert(!model.snapshot(3800).visible);
  model.mouse(1, true, 3900); assert(model.snapshot(3900).visible);
  assert.strictEqual(model.snapshot(3900).elapsed, 0);
});
test('railgun early release cancels, held left cannot restart, fresh click can restart during red hold', () => {
  const model = new state.ChargeState('always', 'railgun'); model.setFocus(true, 0);
  model.mouse(1, true, 0); model.mouse(1, false, 2999);
  assert.strictEqual(model.snapshot(3000).phase, 'idle');
  model.mouse(1, true, 4000); assert(!model.snapshot(7500).visible);
  model.mouse(1, true, 7600); assert(!model.snapshot(7600).visible);
  model.mouse(1, false, 7700); model.mouse(1, true, 7800);
  model.mouse(1, false, 10900); model.mouse(1, true, 11000);
  assert.strictEqual(model.snapshot(11300).phase, 'charging');
  assert.strictEqual(model.snapshot(11300).elapsed, 300);
});
test('railgun hide takes precedence over every display mode, including right mouse held', () => {
  state.MODES.forEach(mode => {
    const model = new state.ChargeState(mode, 'railgun'); model.setFocus(true, 0);
    model.mouse(2, true, 0); model.mouse(1, true, 0);
    assert.strictEqual(model.snapshot(3000).visible, mode !== 'hidden');
    assert(!model.snapshot(3500).visible);
    model.setMode('always'); assert(!model.snapshot(3600).visible);
    model.mouse(1, false, 3700); model.mouse(1, true, 3800); assert(model.snapshot(3800).visible);
  });
});
test('weapon change cancels old charge, requires fresh press and preserves aiming visibility', () => {
  const model = new state.ChargeState('right-mouse', 'epoch'); model.setFocus(true, 0);
  model.mouse(2, true, 0); model.mouse(1, true, 0); model.setWeapon('railgun');
  assert(model.snapshot(100).visible); assert.strictEqual(model.snapshot(100).elapsed, 0);
  model.mouse(1, true, 200); assert.strictEqual(model.snapshot(200).phase, 'idle');
  model.mouse(1, false, 300); model.mouse(1, true, 400);
  assert.strictEqual(model.snapshot(500).elapsed, 100);
});
test('weapon notice waits for a visible bar, lasts 2 seconds and does not replay after hiding', () => {
  const model = new state.ChargeState('right-mouse', 'epoch'); model.setWeapon('railgun');
  assert.strictEqual(model.snapshot(100).notice, null);
  model.setFocus(false, 200); model.setFocus(true, 1000);
  assert.strictEqual(model.snapshot(1000).notice, null);
  model.mouse(2, true, 2000);
  assert.strictEqual(model.snapshot(2000).notice, '磁轨炮');
  assert.strictEqual(model.snapshot(3999).notice, '磁轨炮');
  assert.strictEqual(model.snapshot(4000).notice, null);
  model.setWeapon('epoch'); assert.strictEqual(model.snapshot(4100).notice, '纪元');
  model.mouse(2, false, 4200); assert.strictEqual(model.snapshot(4200).notice, null);
  model.mouse(2, true, 4300); assert.strictEqual(model.snapshot(4300).notice, null);
  model.setMode('hidden'); model.setWeapon('railgun'); model.setWeapon('epoch');
  assert.strictEqual(model.snapshot(4400).notice, null);
  model.setMode('always'); assert.strictEqual(model.snapshot(4500).notice, '纪元');
  model.setFocus(false, 4600); model.setFocus(true, 4700);
  assert.strictEqual(model.snapshot(4700).notice, null);
});
test('config round trip, corruption fallback and write failure', () => {
  const filename = path.join(temp, 'settings.json');
  assert.strictEqual(configIO.readConfig(filename).warning, null);
  const config = state.defaults(); config.mode = 'always'; config.hotkeys.quit.enabled = false;
  configIO.writeConfig(filename, config);
  assert.deepStrictEqual(configIO.readConfig(filename).config, config);
  fs.writeFileSync(filename, '{broken');
  assert(configIO.readConfig(filename).warning);
  assert.deepStrictEqual(configIO.readConfig(filename).config, state.defaults());
  assert.throws(() => configIO.writeConfig(path.join(filename, 'child.json'), config));
});

function harness(lock) {
  const app = new EventEmitter(); app.disableHardwareAcceleration = () => {};
  app.requestSingleInstanceLock = () => lock !== false;
  const userData = fs.mkdtempSync(path.join(temp, 'app-'));
  app.getPath = () => userData;
  app.quit = () => { app.quits = (app.quits || 0) + 1; app.emit('before-quit'); };
  const windows = [], trays = [], monitors = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.webContents = new EventEmitter();
      this.webContents.send = (channel, data) => { this.last = { channel, data }; }; windows.push(this); }
    setIgnoreMouseEvents(value) { this.passthrough = value; }
    setMenu() {} loadFile() {} isDestroyed() { return false; } isVisible() { return this.visible; }
    showInactive() { this.visible = true; } hide() { this.visible = false; } show() { this.visible = true; }
    focus() {} isMinimized() { return false; } close() { this.emit('closed'); }
  }
  class Tray extends EventEmitter {
    constructor() { super(); trays.push(this); this.balloons = []; }
    displayBalloon(value) { this.balloons.push(value); } setContextMenu(value) { this.menu = value; }
    setToolTip(value) { this.tip = value; } popUpContextMenu() {} destroy() { this.destroyed = true; }
  }
  class Monitor extends EventEmitter {
    constructor() { super(); monitors.push(this); } start() { this.started = true; } stop() { this.stopped = true; }
  }
  const ipcMain = new EventEmitter(), hook = new EventEmitter(), bindings = new Map();
  hook.start = () => {}; hook.stop = () => { hook.stopped = true; };
  const shortcuts = { blocked: '', unregisterAll: () => bindings.clear(),
    register: (key, callback) => { if (key === shortcuts.blocked) return false; bindings.set(key, callback); return true; } };
  const electron = { app, BrowserWindow: Window, Tray, Menu: { buildFromTemplate: items => items },
    globalShortcut: shortcuts, ipcMain };
  let clock = 1000, timerId = 0;
  const timers = new Map(), timerHistory = [];
  function schedule(callback, duration) {
    const id = ++timerId;
    timers.set(id, { at: clock + duration, callback: callback });
    timerHistory.push(callback); return id;
  }
  function advance(milliseconds) {
    const target = clock + milliseconds;
    while (true) {
      const next = Array.from(timers.entries()).filter(item => item[1].at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); clock = next[1].at; next[1].callback();
    }
    clock = target;
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === 'iohook' ? hook : name === './focus-monitor' ? Monitor :
      name[0] === '.' ? require(path.join(__dirname, '../src', name)) : require(name),
    module, __dirname: path.join(__dirname, '../src'), Date: { now: () => clock },
    setTimeout: schedule, clearTimeout: id => timers.delete(id)
  });
  app.emit('ready');
  if (windows[0]) windows[0].webContents.emit('did-finish-load');
  return { app, windows, trays, monitors, ipcMain, hook, bindings, shortcuts, api: module.exports, userData, advance, timers, timerHistory };
}
test('secondary launch creates no tray, helper, hook or windows', () => {
  const h = harness(false);
  assert.strictEqual(h.app.quits, 1); assert.strictEqual(h.windows.length, 0);
  assert.strictEqual(h.trays.length, 0); assert.strictEqual(h.monitors.length, 0);
});
test('startup notification, repeated launch, focus gating and shutdown cleanup', () => {
  const h = harness();
  assert(h.trays[0].balloons[0].content.indexOf('已启动') !== -1);
  h.app.emit('second-instance'); h.app.emit('second-instance');
  assert.strictEqual(h.trays.length, 1); assert.strictEqual(h.trays[0].balloons.length, 3);
  const win = h.windows[0]; assert(!win.visible); assert.strictEqual(win.options.focusable, false); assert(win.passthrough);
  const focus = { hasWindow: true, minimized: false, error: null, title: '', processName: 'helldivers2.exe' };
  h.monitors[0].emit('state', focus); assert.strictEqual(h.bindings.size, 3);
  h.hook.emit('mousedown', { button: 2 }); assert(win.visible);
  h.hook.emit('mousedown', { button: 1 }); assert(win.last.data.charging);
  h.monitors[0].emit('state', Object.assign({}, focus, { processName: 'notepad.exe' }));
  assert(!win.visible); assert.strictEqual(h.bindings.size, 0);
  h.monitors[0].emit('state', focus); assert(!win.visible);
  h.app.quit(); assert(h.monitors[0].stopped); assert(h.hook.stopped); assert(h.trays[0].destroyed);
});
test('tray mode, independent switches, conflict survives focus loss and helper failure hides', () => {
  const h = harness();
  const focus = { hasWindow: true, minimized: false, error: null, title: '', processName: 'helldivers2.exe' };
  h.shortcuts.blocked = 'F1'; h.monitors[0].emit('state', focus);
  assert.strictEqual(h.api.status().shortcutErrors.length, 1);
  h.monitors[0].emit('state', Object.assign({}, focus, { processName: 'other.exe' }));
  assert.strictEqual(h.api.status().shortcutErrors.length, 1);
  h.shortcuts.blocked = ''; h.monitors[0].emit('state', focus);
  h.trays[0].menu[1].submenu[2].click(); assert(h.windows[0].visible);
  h.trays[0].menu.find(item => item.label && item.label.indexOf('启用切换模式') === 0).click(); assert(!h.bindings.has('F1')); assert(h.bindings.has('F2'));
  h.monitors[0].emit('failure', 'timeout'); assert(!h.windows[0].visible); assert.strictEqual(h.bindings.size, 0);
  assert.strictEqual(h.api.status().detectorError, 'timeout');
  h.api.restartDetection(); assert.strictEqual(h.api.status().detectorError, null);
  h.app.quit();
});
test('settings IPC validates sender and duplicate keys; saves custom hotkeys', () => {
  const h = harness(); h.api.openSettings();
  const settings = h.windows[1];
  const draft = state.defaults(); draft.hotkeys.toggle.accelerator = 'Ctrl+Shift+F8'; draft.hotkeys.quit.enabled = false;
  h.ipcMain.emit('settings-save', { sender: h.windows[0].webContents }, draft);
  assert.strictEqual(h.api.status().config.hotkeys.toggle.accelerator, 'F1');
  h.ipcMain.emit('settings-save', { sender: settings.webContents }, draft);
  assert.strictEqual(h.api.status().config.hotkeys.toggle.accelerator, 'Ctrl+Shift+F8');
  assert.strictEqual(configIO.readConfig(path.join(h.userData, 'settings.json')).config.hotkeys.quit.enabled, false);
  draft.hotkeys.quit.accelerator = 'ctrl+shift+f8';
  h.ipcMain.emit('settings-save', { sender: settings.webContents }, draft);
  assert.strictEqual(settings.last.data.ok, false);
  h.app.quit();
});

test('main-process deadlines hide railgun without mouse events and cancel stale callbacks', () => {
  const h = harness();
  const focus = { hasWindow: true, minimized: false, error: null, title: '', processName: 'helldivers2.exe' };
  h.monitors[0].emit('state', focus);
  h.trays[0].menu.find(item => item.label === '显示模式').submenu[2].click();
  h.bindings.get('F3')(); assert.strictEqual(h.api.status().config.weapon, 'railgun');
  h.hook.emit('mousedown', { button: 1 }); h.advance(2999);
  assert(h.windows[0].visible); h.advance(1);
  assert.strictEqual(h.windows[0].last.data.phase, 'complete');
  const oldCallback = h.timerHistory[h.timerHistory.length - 1];
  h.hook.emit('mouseup', { button: 1 }); h.advance(100);
  h.hook.emit('mousedown', { button: 1 }); oldCallback(); h.advance(400);
  assert(h.windows[0].visible); assert.strictEqual(h.windows[0].last.data.phase, 'charging');
  h.advance(2600); assert.strictEqual(h.windows[0].last.data.phase, 'complete');
  h.advance(500); assert(!h.windows[0].visible);
  h.monitors[0].emit('state', Object.assign({}, focus, { processName: 'other.exe' }));
  h.monitors[0].emit('state', focus); assert(!h.windows[0].visible);
  h.hook.emit('mouseup', { button: 1 }); h.hook.emit('mousedown', { button: 1 }); assert(h.windows[0].visible);
  const callbackBeforeSwitch = h.timerHistory[h.timerHistory.length - 1];
  h.bindings.get('F3')(); callbackBeforeSwitch(); assert.strictEqual(h.windows[0].last.data.weapon, 'epoch');
  h.advance(2000); assert.strictEqual(h.windows[0].last.data.notice, null);
  h.app.quit(); assert.strictEqual(h.timers.size, 0);
});
test('third shortcut can be disabled and saving failure preserves selected weapon', () => {
  const h = harness();
  const focus = { hasWindow: true, minimized: false, error: null, title: '', processName: 'helldivers2.exe' };
  h.monitors[0].emit('state', focus);
  h.trays[0].menu.find(item => item.label && item.label.indexOf('启用切换武器') === 0).click();
  assert(!h.bindings.has('F3')); assert(h.bindings.has('F1')); assert(h.bindings.has('F2'));
  h.api.openSettings();
  const draft = state.defaults(); draft.weapon = 'railgun'; draft.hotkeys.weapon.accelerator = 'Ctrl+F9';
  h.ipcMain.emit('settings-save', { sender: h.windows[1].webContents }, draft);
  assert.strictEqual(h.api.status().config.weapon, 'railgun'); assert(h.bindings.has('Ctrl+F9'));
  // A real file occupying the temp path forces an atomic-write failure without modifying production dependencies.
  fs.mkdirSync(path.join(h.userData, 'settings.json.tmp'));
  draft.weapon = 'epoch';
  h.ipcMain.emit('settings-save', { sender: h.windows[1].webContents }, draft);
  assert.strictEqual(h.windows[1].last.data.ok, false);
  assert.strictEqual(h.api.status().config.weapon, 'railgun');
  h.app.quit();
});
test('all weapons share the full-charge 500 ms hold and wait-for-next-click lifecycle', () => {
  state.WEAPON_IDS.forEach(weapon => {
    const duration = state.WEAPONS[weapon].duration;
    const model = new state.ChargeState('always', weapon); model.setFocus(true, 0);
    model.mouse(1, true, 0); assert.strictEqual(model.snapshot(duration - 1).phase, 'charging');
    assert.strictEqual(model.snapshot(duration).phase, 'complete');
    model.mouse(1, false, duration + 100); assert(model.snapshot(duration + 499).visible);
    assert(!model.snapshot(duration + 500).visible);
    model.setFocus(false, duration + 600); model.setFocus(true, duration + 700);
    assert(!model.snapshot(duration + 700).visible);
    model.mouse(1, true, duration + 800); assert(model.snapshot(duration + 800).visible);
  });
});
console.log('\n' + count + ' tests passed.');
