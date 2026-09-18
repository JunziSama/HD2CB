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
function finish(error, alreadyQuitting) {
  if (game) game.kill();
  if (error) failure = error.stack || String(error);
  fs.writeFileSync(path.join(output, 'result-' + phase + '.json'), JSON.stringify({ passed: !failure, checks, failure,
    versions: process.versions, status: api.status(), helperPids: helpers.map(child => child.pid),
    balloons: balloons.map(item => item.content), windows: BrowserWindow.getAllWindows().map(win => ({
      title: win.getTitle(), visible: win.isVisible(), loading: win.webContents.isLoading(), url: win.webContents.getURL()
    })) }, null, 2));
  if (!alreadyQuitting) app.quit();
}
if (!secondary) {
  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);
  app.on('ready', () => {
    (async () => {
      await until(() => api.status().detection === '等待 HD2 聚焦', 'initial foreground sample');
      assert.strictEqual(api.status().inputError, null);
      assert.strictEqual(api.status().detectorError, null);
      if (phase === 'native-quit') {
        api.openSettings();await delay(200);
        game=childProcess.spawn(path.join(output,'helldivers2.exe'),[],{windowsHide:false,stdio:['pipe','pipe','pipe']});
        game.stdout.on('data',data=>fs.appendFileSync(path.join(output,'fixture-quit.log'),data));game.stdin.on('error',()=>{});
        await until(()=>api.status().focused,'quit fixture foreground');assert(globalShortcut.isRegistered('F3'));
        app.once('before-quit',()=>{pass('Real Windows F3 invokes application quit; external runner verifies clean exit and helper cleanup');finish(null,true);});
        game.stdin.write('key:{F3}\n');return;
      }
      if (phase === 'restore') {
        assert.strictEqual(api.status().config.hotkeys.toggle.accelerator, 'Ctrl+Shift+F8');
        assert.strictEqual(api.status().config.hotkeys.quit.enabled, false);
        assert.strictEqual(api.status().config.weapon, 'double-edge');
        assert.strictEqual(api.status().config.hotkeys.weapon.accelerator, 'Ctrl+Shift+F9');
        assert.strictEqual(api.status().config.heat.preset, 'cold'); assert.strictEqual(api.status().config.heat.cooling, 6); assert.strictEqual(api.status().config.heat.monitor.key, 'T');
        pass('Restart restores saved custom hotkeys and heat preset/monitor key');
        finish(); return;
      }
      if (phase === 'legacy') {
        assert.strictEqual(api.status().config.version, 4);
        assert.strictEqual(api.status().config.weapon, 'epoch');
        assert.strictEqual(api.status().config.hotkeys.toggle.accelerator, 'F3');
        assert.strictEqual(api.status().config.hotkeys.quit.enabled, false);
        assert.strictEqual(api.status().config.hotkeys.weapon.accelerator, 'F5');
        const migrated = JSON.parse(fs.readFileSync(path.join(output, 'userData', 'settings.json'), 'utf8'));
        assert.strictEqual(migrated.version, 4); assert.strictEqual(migrated.hotkeys.weapon.accelerator, 'F5');
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
      assert(!globalShortcut.isRegistered('F1')); assert(!globalShortcut.isRegistered('F3')); assert(!globalShortcut.isRegistered('F2'));
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
      assert(globalShortcut.isRegistered('F1')); assert(globalShortcut.isRegistered('F3'));
      async function pressWeapon(key) {
        const before = api.status().config.weapon;
        const ids = require('../src/state').WEAPON_IDS;
        const expected = ids[(ids.indexOf(before) + 1) % ids.length];
        game.stdin.write('key:' + key + '\n');
        await until(() => api.status().config.weapon === expected, 'native weapon shortcut ' + key);
      }
      await pressWeapon('{F2}');
      for (let i = 0; i < 8; i++) await pressWeapon('{F2}');
      pass('Real Windows F2 dispatch switches weapon repeatedly and main loop remains responsive');
      const modeBefore = api.status().config.mode;
      game.stdin.write('key:{F1}\n');
      await until(() => api.status().config.mode !== modeBefore, 'native F1');
      menu.items.find(item => item.label === '显示模式').submenu.items[1].click();
      // Save a custom key through the same trusted settings IPC used by the UI.
      const custom = JSON.parse(JSON.stringify(api.status().config));
      custom.hotkeys.weapon.accelerator = 'Ctrl+Shift+F9';
      electron.ipcMain.emit('settings-save', { sender: launcher.webContents }, custom);
      await pressWeapon('^+{F9}');
      custom.hotkeys.weapon.accelerator = 'F2';
      electron.ipcMain.emit('settings-save', { sender: launcher.webContents }, custom);
      pass('Native F1 and custom Ctrl+Shift+F9 work after repeated F2 switches');
      assert(!overlay.isVisible());
      const hook = require(process.env.HD2CB_QA_MAIN ? path.resolve(path.dirname(process.env.HD2CB_QA_MAIN), '../node_modules/iohook') : 'iohook');
      menu.items.find(item => item.label === '当前武器').submenu.items[6].click();
      hook.emit('mousedown', { button: 2 }); hook.emit('mousedown', { button: 1 });
      await delay(900);
      const readHeat = () => overlay.webContents.executeJavaScript('document.getElementById("heatLabel").textContent');
      assert(!/^估算热量 0%$/.test(await readHeat()));
      assert(!globalShortcut.isRegistered('R'));
      game.stdin.write('key:r\n');
      await delay(150);
      assert.strictEqual(await readHeat(), '估算热量 0%');
      assert(fs.readFileSync(path.join(output, 'fixture.log'), 'utf8').indexOf('received-key:R') !== -1, 'R must reach the test game');
      await delay(700); assert.strictEqual(await readHeat(), '估算热量 0%');
      hook.emit('mouseup', { button: 1 }); hook.emit('mousedown', { button: 1 }); await delay(900);
      assert.notStrictEqual(await readHeat(), '估算热量 0%');
      hook.emit('mouseup', { button: 1 });
      menu.items.find(item => item.label === '当前武器').submenu.items[0].click();
      hook.emit('mouseup', { button: 2 });
      pass('Native R resets estimated heat without consuming the key; held left cannot resume until released');
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
      const ui = await settings.webContents.executeJavaScript('({ status: document.getElementById("status").textContent, key: document.getElementById("toggle-key").value, fits: document.documentElement.scrollWidth <= window.innerWidth && getComputedStyle(document.body).overflowY === "auto" })');
      assert.strictEqual(ui.key, 'F1');
      assert.strictEqual(await settings.webContents.executeJavaScript('document.getElementById("weapon-key").value'), 'F2');

      assert.strictEqual(await settings.webContents.executeJavaScript('document.getElementById("weapon-select").options.length'), 7);
      await delay(150);
      await new Promise(resolve => settings.capturePage(image => {
        fs.writeFileSync(path.join(output, 'settings.png'), image.toPNG()); resolve();
      }));
      assert(ui.fits, 'Settings must fit without vertical clipping');
      pass('Chinese settings window scrolls without horizontal overflow; screenshot captured');
      const save = (weapon, hotkeys) => settings.webContents.executeJavaScript(
        'new Promise(resolve => { const ipc = require("electron").ipcRenderer; ipc.once("settings-result", (event, result) => resolve(result)); ' +
        'const draft = ' + JSON.stringify({ weapon, hotkeys }) + '; const select = document.getElementById("weapon-select"); select.value = draft.weapon; select.dispatchEvent(new Event("change")); ' +
        'Object.keys(draft.hotkeys).forEach(action => { const key = document.getElementById(action + "-key"); key.value = draft.hotkeys[action].accelerator; key.dispatchEvent(new Event("input")); const enabled = document.getElementById(action + "-enabled"); enabled.checked = draft.hotkeys[action].enabled; enabled.dispatchEvent(new Event("change")); }); document.getElementById("save").click(); })');
      let result = await save('double-edge', { toggle: { enabled: true, accelerator: 'Ctrl+Shift+F8' }, quit: { enabled: false, accelerator: 'F3' }, weapon: { enabled: true, accelerator: 'Ctrl+Shift+F9' } });
      assert(result.ok, result.message);
      const saved = JSON.parse(fs.readFileSync(path.join(output, 'userData', 'settings.json'), 'utf8'));
      assert.strictEqual(saved.hotkeys.toggle.accelerator, 'Ctrl+Shift+F8'); assert.strictEqual(saved.hotkeys.quit.enabled, false);
      assert.strictEqual(saved.weapon, 'double-edge'); assert.strictEqual(saved.hotkeys.weapon.accelerator, 'Ctrl+Shift+F9');
      assert((await settings.webContents.executeJavaScript('document.getElementById("weapon-description").textContent')).indexOf('累计估算热量') !== -1);
      result = await save('epoch', { toggle: { enabled: true, accelerator: 'F3' }, quit: { enabled: false, accelerator: 'F3' }, weapon: { enabled: true, accelerator: 'F2' } });
      assert(!result.ok); assert.strictEqual(api.status().config.weapon, 'double-edge');
      pass('Real renderer IPC saves custom shortcuts and independent switches; duplicate bindings rejected');
      result = await save('double-edge', api.status().config.hotkeys); assert(result.ok);
      const heatLayout = await settings.webContents.executeJavaScript('(() => { const select = document.getElementById("weapon-select"); select.value="double-edge"; select.dispatchEvent(new Event("change")); const preset = document.getElementById("heat-preset"); preset.value="cold"; preset.dispatchEvent(new Event("change")); return {cooling: document.getElementById("heat-cooling").value, scroll: document.body.scrollHeight > window.innerHeight}; })()');
      assert.strictEqual(heatLayout.cooling, '6'); assert(heatLayout.scroll);
      await settings.webContents.executeJavaScript('document.getElementById("heat-record").click(); document.dispatchEvent(new KeyboardEvent("keydown", {key:"T",bubbles:true})); document.getElementById("heat-panel").scrollIntoView();');
      assert.strictEqual(await settings.webContents.executeJavaScript('document.getElementById("heat-monitor-key").value'), 'T');
      result = await settings.webContents.executeJavaScript('new Promise(resolve => { require("electron").ipcRenderer.once("settings-result", (event,result) => resolve(result)); document.getElementById("save").click(); })');
      assert(result.ok); assert.strictEqual(api.status().config.heat.preset, 'cold');
      assert.strictEqual(api.status().config.heat.monitor.key, 'T');
      await delay(150);
      await new Promise(resolve => settings.capturePage(image => { fs.writeFileSync(path.join(output, 'settings-heat.png'), image.toPNG()); resolve(); }));
      pass('Heat settings scroll, cold preset and monitor key recording save correctly');
      settings.close(); assert.strictEqual(BrowserWindow.getAllWindows().length, 1);
      pass('Closing settings leaves the tray application running');


      api.openSettings();
      await delay(100);
      const modeWindow=BrowserWindow.getAllWindows().filter(win=>win!==overlay)[0];
      await modeWindow.webContents.executeJavaScript('document.getElementById("mode-select").value="hidden"; document.getElementById("mode-select").dispatchEvent(new Event("change"));');
      menu.items.find(x=>x.label==='显示模式').submenu.items[2].click();
      assert.strictEqual(await modeWindow.webContents.executeJavaScript('document.getElementById("mode-select").value'),'hidden');
      await modeWindow.webContents.executeJavaScript('document.getElementById("save").click()');await delay(100);assert.strictEqual(api.status().config.mode,'hidden');
      menu.items.find(x=>x.label==='显示模式').submenu.items[1].click();await delay(100);
      assert.strictEqual(await modeWindow.webContents.executeJavaScript('document.getElementById("mode-select").value'),'right-mouse');
      const lastCard=await modeWindow.webContents.executeJavaScript('Array.from(document.querySelectorAll(".card")).pop().contains(document.getElementById("quit-key"))');assert(lastCard);
      await modeWindow.webContents.executeJavaScript('document.getElementById("mode-select").value="always";document.getElementById("mode-select").dispatchEvent(new Event("change"));document.getElementById("cancel").click()');assert.strictEqual(api.status().config.mode,'right-mouse');
      pass('Settings mode draft survives tray updates, saves explicitly and cancels without applying; quit card is last');

      // Render actual overlay HTML in a separate test window; this does not claim game-focus coverage.
      const preview = new BrowserWindow({ width: 500, height: 200, frame: false, show: false,
        backgroundColor: '#101820', webPreferences: { nodeIntegration: true, contextIsolation: false } });
      await new Promise(resolve => { preview.webContents.once('did-finish-load', resolve); preview.loadFile(path.join(__dirname, '../src/index.html')); });
      preview.show();
      for (const weapon of require('../src/state').WEAPON_IDS) {
        preview.webContents.send('charge-state', { visible: true, charging: false, elapsed: weapon === 'epoch' ? 2600 : 3000,
          weapon: weapon, phase: 'complete', heat: 95, notice: require('../src/state').WEAPONS[weapon].shortName });
        await delay(100);
        const visual = await preview.webContents.executeJavaScript('(() => { const label = document.getElementById("weaponNotice"); const box = label.getBoundingClientRect(); return { fits: box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, text: label.textContent, color: document.getElementById("fill").style.backgroundColor, markers: document.querySelectorAll(".marker").length }; })()');
        assert(visual.fits, 'Weapon notice must not be clipped'); assert.strictEqual(visual.color, ['epoch', 'railgun', 'double-edge'].indexOf(weapon) === -1 ? 'cyan' : 'red');
        assert.strictEqual(visual.markers, require('../src/state').WEAPONS[weapon].markers.length);
        await new Promise(resolve => preview.capturePage(image => { fs.writeFileSync(path.join(output, 'overlay-' + weapon + '.png'), image.toPNG()); resolve(); }));
      }
      for(const heat of [0,100]) {
        preview.webContents.send('charge-state',{visible:true,weapon:'double-edge',heat:heat,showHeatText:true,notice:'双刃镰刀'});await delay(50);
        assert(await preview.webContents.executeJavaScript('(()=>{const h=document.getElementById("heatLabel").getBoundingClientRect(), b=document.getElementById("barContainer").getBoundingClientRect(), n=document.getElementById("weaponNotice").getBoundingClientRect();return Math.abs(h.bottom-b.bottom)<2 && h.right<=innerWidth && h.top>=n.bottom;})()'));
      }
      preview.webContents.send('charge-state',{visible:true,weapon:'double-edge',heat:100,showHeatText:false});await delay(50);
      assert.strictEqual(await preview.webContents.executeJavaScript('document.getElementById("heatLabel").style.display'),'none');
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
