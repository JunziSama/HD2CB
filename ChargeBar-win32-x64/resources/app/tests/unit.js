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
  model.setFocus(true); assert.strictEqual(model.snapshot(2200).elapsed, 2100);
  model.setFocus(false); model.mouse(1, true, 2300); model.setFocus(true);
  assert.deepStrictEqual(model.snapshot(2400), { visible: false, charging: false, elapsed: 0 });
  model.mouse(2, true, 2500); assert(!model.snapshot(2600).charging);
  model.mouse(1, true, 2700); assert.strictEqual(model.snapshot(2800).elapsed, 100);
  model.mouse(1, false, 2900); assert.strictEqual(model.snapshot(3000).elapsed, 0);
});
test('charge thresholds remain 2, 2.5 and 3 seconds', () => {
  assert.strictEqual(state.chargeStyle(1999).color, 'green');
  assert.strictEqual(state.chargeStyle(2000).color, 'yellow');
  assert.strictEqual(state.chargeStyle(2500).color, 'red');
  assert.strictEqual(state.chargeStyle(3000).percent, 100);
  assert.strictEqual(state.chargeStyle(9000).percent, 100);
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
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === 'iohook' ? hook : name === './focus-monitor' ? Monitor :
      name[0] === '.' ? require(path.join(__dirname, '../src', name)) : require(name),
    module, __dirname: path.join(__dirname, '../src'), setTimeout: () => {}
  });
  app.emit('ready');
  if (windows[0]) windows[0].webContents.emit('did-finish-load');
  return { app, windows, trays, monitors, ipcMain, hook, bindings, shortcuts, api: module.exports, userData };
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
  h.monitors[0].emit('state', focus); assert.strictEqual(h.bindings.size, 2);
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
  h.trays[0].menu[3].click(); assert(!h.bindings.has('F1')); assert(h.bindings.has('F2'));
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
console.log('\n' + count + ' tests passed.');
