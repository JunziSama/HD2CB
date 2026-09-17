'use strict';
const electron = require('electron');
const { app, BrowserWindow, Tray, globalShortcut } = electron;
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const childProcess = require('child_process');
const output = process.env.HD2CB_QA_ROOT;
const phase = process.env.HD2CB_QA_PHASE || 'main';
app.setPath('userData', path.join(output, 'userData'));
const secondary = process.argv.indexOf('--secondary') !== -1;
if (!secondary) {
  ['before-quit', 'will-quit', 'quit'].forEach(name => app.on(name, (event, code) => {
    fs.appendFileSync(path.join(output, 'lifecycle.log'), name + ' ' + code + '\n');
  }));
}
const balloons = [], helpers = [], checks = [];
let menu, nativeTray, failure = null, game;
const diagnosticFile = path.join(output, 'hotkey-stages.log');
function trace(stage) { fs.appendFileSync(diagnosticFile, Date.now() + ' ' + stage + '\n'); }
['register', 'unregisterAll'].forEach(name => {
  const original = globalShortcut[name];
  globalShortcut[name] = function() {
    trace(name + ' begin');
    const args = Array.prototype.slice.call(arguments);
    if (name === 'register') {
      const callback = args[1];
      args[1] = () => { trace('callback ' + args[0] + ' begin'); callback(); trace('callback ' + args[0] + ' end'); };
    }
    const result = original.apply(this, args); trace(name + ' end'); return result;
  };
});
const configIO = require('../src/config');
const originalWrite = configIO.writeConfig;
configIO.writeConfig = function() {
  trace('save begin');
  try { return originalWrite.apply(this, arguments); } finally { trace('save end'); }
};
const originalBalloon = Tray.prototype.displayBalloon;
Tray.prototype.displayBalloon = function(value) { balloons.push(value); return originalBalloon.call(this, value); };
const originalMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function(value) { menu = value; nativeTray = this; trace('tray begin'); const result = originalMenu.call(this, value); trace('tray end'); return result; };
const originalSpawn = childProcess.spawn;
childProcess.spawn = function(executable, args, options) {
  const child = originalSpawn.call(this, executable, args, options);
  if (/FocusMonitor\.exe$/i.test(executable)) helpers.push(child);
  return child;
};
const api = require(process.env.HD2CB_QA_MAIN || '../src/main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, timeout) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > (timeout || 5000)) throw new Error('Timed out: ' + description);
    await delay(50);
  }
}
function pass(text) { checks.push(text); }
function finish(error) {
  if (game) game.kill();
  if (error) failure = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'result-' + phase + '.json'), JSON.stringify({ passed: !failure, checks, failure,
    versions: process.versions, status: api.status(), helperPids: helpers.map(child => child.pid),
    balloons: balloons.map(item => item.content), windows: BrowserWindow.getAllWindows().map(win => ({
      title: win.getTitle(), visible: win.isVisible(), loading: win.webContents.isLoading(), url: win.webContents.getURL()
    })) }, null, 2));
  app.quit();
}
if (!secondary) {
  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);
  app.on('ready', () => {
    (async () => {
      await until(() => api.status().detection === '等待 HD2 聚焦', 'initial foreground sample');
      assert.strictEqual(api.status().inputError, null);
      assert.strictEqual(api.status().detectorError, null);
      if (phase === 'restore') {
        assert.strictEqual(api.status().config.hotkeys.toggle.accelerator, 'Ctrl+Shift+F8');
        assert.strictEqual(api.status().config.hotkeys.quit.enabled, false);
        assert.strictEqual(api.status().config.weapon, 'quasar');
        assert.strictEqual(api.status().config.hotkeys.weapon.accelerator, 'Ctrl+Shift+F9');
        pass('Restart restores saved custom hotkeys and independent enable switches');
        finish(); return;
      }
      if (phase === 'legacy') {
        assert.strictEqual(api.status().config.version, 2);
        assert.strictEqual(api.status().config.weapon, 'epoch');
        assert.strictEqual(api.status().config.hotkeys.toggle.accelerator, 'F3');
        assert.strictEqual(api.status().config.hotkeys.quit.enabled, false);
        assert.strictEqual(api.status().config.hotkeys.weapon.accelerator, 'F5');
        const migrated = JSON.parse(fs.readFileSync(path.join(output, 'userData', 'settings.json'), 'utf8'));
        assert.strictEqual(migrated.version, 2); assert.strictEqual(migrated.hotkeys.weapon.accelerator, 'F5');
        pass('Legacy settings migrate on startup without losing mode or shortcuts; occupied F3/F4 selects F5');
        finish(); return;
      }
      if (phase === 'corrupt') {
        assert(api.status().configWarning);
        assert.strictEqual(api.status().config.hotkeys.toggle.accelerator, 'F1');
        assert.strictEqual(api.status().config.mode, 'right-mouse');
        pass('Corrupt configuration starts safely with defaults and a visible settings warning');
        finish(); return;
      }
      assert.strictEqual(api.status().config.mode, 'right-mouse');
      const overlay = BrowserWindow.getAllWindows()[0];
      assert(!overlay.isVisible());
      assert(!globalShortcut.isRegistered('F1')); assert(!globalShortcut.isRegistered('F2')); assert(!globalShortcut.isRegistered('F3'));
      pass('Actual Electron 4 startup, native iohook and focus helper load successfully; overlay and hotkeys inactive outside HD2');
      assert(balloons.some(item => item.content.indexOf('已启动') !== -1));
      assert(menu.items.some(item => item.label === '显示模式'));
      pass('Native tray menu created and startup balloon requested');

      for (let index = 0; index < 2; index++) {
        const child = childProcess.spawn(process.execPath, ['--secondary'], { windowsHide: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
      }
      await until(() => balloons.filter(item => item.content.indexOf('已在运行') !== -1).length === 2, 'duplicate launch notification');
      assert.strictEqual(helpers.length, 1); assert.strictEqual(BrowserWindow.getAllWindows().length, 1);
      pass('Three launches retain one application instance and one helper; both duplicates notify the original instance');

      if (process.env.HD2CB_INTERACTIVE_FOCUS === '1') {
      // Optional: Windows must allow the interactive fixture to take foreground ownership.
      api.openSettings();
      await until(() => BrowserWindow.getAllWindows().some(win => win !== overlay && win.isVisible()), 'pre-fixture settings');
      const launcher = BrowserWindow.getAllWindows().filter(win => win !== overlay)[0];
      launcher.focus();
      await delay(200);
      game = childProcess.spawn(path.join(output, 'helldivers2.exe'), [], { windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
      game.stdout.on('data', data => fs.appendFileSync(path.join(output, 'fixture.log'), data));
      game.stderr.on('data', data => fs.appendFileSync(path.join(output, 'fixture.log'), data));
      game.stdin.on('error', () => {});
      await until(() => api.status().focused, 'test fixture foreground');
      assert(globalShortcut.isRegistered('F1')); assert(globalShortcut.isRegistered('F2'));
      async function pressWeapon(key) {
        const before = api.status().config.weapon;
        const ids = require('../src/state').WEAPON_IDS;
        const expected = ids[(ids.indexOf(before) + 1) % ids.length];
        game.stdin.write('key:' + key + '\n');
        await until(() => api.status().config.weapon === expected, 'native weapon shortcut ' + key);
      }
      await pressWeapon('{F3}');
      for (let i = 0; i < 8; i++) await pressWeapon('{F3}');
      pass('Real Windows F3 dispatch switches weapon repeatedly and main loop remains responsive');
      const modeBefore = api.status().config.mode;
      game.stdin.write('key:{F1}\n');
      await until(() => api.status().config.mode !== modeBefore, 'native F1');
      menu.items.find(item => item.label === '显示模式').submenu.items[1].click();
      // Save a custom key through the same trusted settings IPC used by the UI.
      const custom = JSON.parse(JSON.stringify(api.status().config));
      custom.hotkeys.weapon.accelerator = 'Ctrl+Shift+F9';
      electron.ipcMain.emit('settings-save', { sender: launcher.webContents }, custom);
      await pressWeapon('^+{F9}');
      custom.hotkeys.weapon.accelerator = 'F3';
      electron.ipcMain.emit('settings-save', { sender: launcher.webContents }, custom);
      pass('Native F1 and custom Ctrl+Shift+F9 work after repeated F3 switches');
      assert(!overlay.isVisible());
      const hook = require('iohook');
      hook.emit('mousedown', { button: 2 }); hook.emit('mousedown', { button: 1 });
      await until(() => overlay.isVisible(), 'right mouse display');
      await delay(120);
      const bar = await overlay.webContents.executeJavaScript('({ display: getComputedStyle(document.getElementById("barContainer")).display, height: document.getElementById("fill").style.height })');
      assert.strictEqual(bar.display, 'block'); assert(parseFloat(bar.height) > 0);
      assert(api.status().focused, 'Overlay must not steal game focus');
      pass('Foreground fixture matches process; real shortcuts register and overlay renders charge without taking focus');
      const minimizeAt = Date.now();
      game.stdin.write('minimize\n');
      await until(() => !api.status().focused, 'minimize hides overlay');
      assert(!overlay.isVisible()); assert(!globalShortcut.isRegistered('F1'));
      pass('Minimizing fixture hides overlay and releases shortcuts in ' + (Date.now() - minimizeAt) + ' ms');
      let opened = false, closed = false;
      menu.once('menu-will-show', () => { opened = true; });
      menu.once('menu-will-close', () => { closed = true; });
      nativeTray.popUpContextMenu();
      await until(() => opened, 'native tray menu opens after shortcuts');
      game.stdin.write('activate\n');
      await until(() => closed, 'native tray menu closes after shortcuts');
      pass('Native tray context menu opens and closes after weapon shortcuts and focus loss');
      game.stdin.write('activate\n');
      await until(() => api.status().focused, 'fixture refocus');
      assert(!overlay.isVisible(), 'Old held buttons must not survive focus loss');
      const modes = menu.items.filter(item => item.label === '显示模式')[0].submenu.items;
      modes[2].click(); assert(overlay.isVisible());
      modes[0].click(); assert(!overlay.isVisible());
      modes[1].click(); assert(!overlay.isVisible());
      hook.emit('mousedown', { button: 2 });
      assert(overlay.isVisible());
      const reset = await overlay.webContents.executeJavaScript('document.getElementById("fill").style.height');
      assert.strictEqual(reset, '0%');
      pass('All tray display modes work and charge/buttons reset after focus loss');
      game.stdin.write('exit\n');
      await until(() => !api.status().focused, 'fixture exit');
      game = null;
      launcher.close();
      }

      api.openSettings();
      await until(() => BrowserWindow.getAllWindows().some(win => win !== overlay && win.isVisible()), 'settings window');
      const settings = BrowserWindow.getAllWindows().filter(win => win !== overlay)[0];
      const ui = await settings.webContents.executeJavaScript('({ status: document.getElementById("status").textContent, key: document.getElementById("toggle-key").value, fits: document.documentElement.scrollHeight <= window.innerHeight })');
      assert.strictEqual(ui.key, 'F1');
      assert.strictEqual(await settings.webContents.executeJavaScript('document.getElementById("weapon-key").value'), 'F3');

      await new Promise(resolve => settings.capturePage(image => {
        fs.writeFileSync(path.join(output, 'settings.png'), image.toPNG()); resolve();
      }));
      assert(ui.fits, 'Settings must fit without vertical clipping');
      pass('Chinese settings window loads without overflow; screenshot captured');
      const save = (weapon, hotkeys) => settings.webContents.executeJavaScript(
        'new Promise(resolve => { const ipc = require("electron").ipcRenderer; ipc.once("settings-result", (event, result) => resolve(result)); ' +
        'const draft = ' + JSON.stringify({ weapon, hotkeys }) + '; const select = document.getElementById("weapon-select"); select.value = draft.weapon; select.dispatchEvent(new Event("change")); ' +
        'Object.keys(draft.hotkeys).forEach(action => { const key = document.getElementById(action + "-key"); key.value = draft.hotkeys[action].accelerator; key.dispatchEvent(new Event("input")); const enabled = document.getElementById(action + "-enabled"); enabled.checked = draft.hotkeys[action].enabled; enabled.dispatchEvent(new Event("change")); }); document.getElementById("save").click(); })');
      let result = await save('quasar', { toggle: { enabled: true, accelerator: 'Ctrl+Shift+F8' }, quit: { enabled: false, accelerator: 'F2' }, weapon: { enabled: true, accelerator: 'Ctrl+Shift+F9' } });
      assert(result.ok, result.message);
      const saved = JSON.parse(fs.readFileSync(path.join(output, 'userData', 'settings.json'), 'utf8'));
      assert.strictEqual(saved.hotkeys.toggle.accelerator, 'Ctrl+Shift+F8'); assert.strictEqual(saved.hotkeys.quit.enabled, false);
      assert.strictEqual(saved.weapon, 'quasar'); assert.strictEqual(saved.hotkeys.weapon.accelerator, 'Ctrl+Shift+F9');
      assert((await settings.webContents.executeJavaScript('document.getElementById("weapon-description").textContent')).indexOf('不会过载自爆') !== -1);
      result = await save('epoch', { toggle: { enabled: true, accelerator: 'F2' }, quit: { enabled: false, accelerator: 'F2' }, weapon: { enabled: true, accelerator: 'F3' } });
      assert(!result.ok); assert.strictEqual(api.status().config.weapon, 'quasar');
      pass('Real renderer IPC saves custom shortcuts and independent switches; duplicate bindings rejected');
      settings.close(); assert.strictEqual(BrowserWindow.getAllWindows().length, 1);
      pass('Closing settings leaves the tray application running');


      // Render actual overlay HTML in a separate test window; this does not claim game-focus coverage.
      const preview = new BrowserWindow({ width: 500, height: 200, frame: false, show: false,
        backgroundColor: '#101820', webPreferences: { nodeIntegration: true, contextIsolation: false } });
      await new Promise(resolve => { preview.webContents.once('did-finish-load', resolve); preview.loadFile(path.join(__dirname, '../src/index.html')); });
      preview.show();
      for (const weapon of ['epoch', 'railgun', 'quasar']) {
        preview.webContents.send('charge-state', { visible: true, charging: false, elapsed: weapon === 'epoch' ? 2600 : 3000,
          weapon: weapon, phase: 'complete', notice: require('../src/state').WEAPONS[weapon].shortName });
        await delay(100);
        const visual = await preview.webContents.executeJavaScript('(() => { const label = document.getElementById("weaponNotice"); const box = label.getBoundingClientRect(); return { fits: box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, text: label.textContent, color: document.getElementById("fill").style.backgroundColor, markers: document.querySelectorAll(".marker").length }; })()');
        assert(visual.fits, 'Weapon notice must not be clipped'); assert.strictEqual(visual.color, weapon === 'quasar' ? 'cyan' : 'red');
        assert.strictEqual(visual.markers, weapon === 'quasar' ? 0 : 3);
        await new Promise(resolve => preview.capturePage(image => { fs.writeFileSync(path.join(output, 'overlay-' + weapon + '.png'), image.toPNG()); resolve(); }));
      }
      preview.close();
      pass('Actual overlay renderer shows per-weapon markers and unclipped weapon names; screenshots captured');

      helpers[0].kill();
      await until(() => !!api.status().detectorError, 'helper error status');
      assert(!overlay.isVisible()); assert(!globalShortcut.isRegistered('F1'));
      api.restartDetection();
      await until(() => !api.status().detectorError && api.status().detection === '等待 HD2 聚焦', 'helper recovery');
      assert.strictEqual(helpers.length, 2);
      pass('Killed helper hides overlay and reports failure; retry recovers');
      finish();
    })().catch(finish);
  });
  app.on('will-quit', () => {
    fs.appendFileSync(path.join(output, 'lifecycle.log'), 'will-quit cleanup reached\n');
  });
}
