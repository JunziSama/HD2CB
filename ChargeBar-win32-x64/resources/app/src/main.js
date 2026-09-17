'use strict';
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { MODES, LABELS, ACTIONS, WEAPON_IDS, WEAPONS, validateConfig, isHD2, ChargeState } = require('./state');
const { readConfig, writeConfig } = require('./config');
const FocusMonitor = require('./focus-monitor');

app.disableHardwareAcceleration();

let overlay, settingsWindow, tray, monitor, hook, config, configFile, charge;
let overlayReady = false;
let quitting = false;
let detection = '正在检测 HD2…';
let detectorError = null;
let inputError = null;
let configWarning = null;
let shortcutErrors = [];
let pendingSecondLaunch = false;
let notifiedShortcutError = '';
let transitionTimer = null;
let transitionRevision = 0;

function notify(message) {
  if (!tray || quitting) return;
  tray.displayBalloon({ title: 'HD2CB', content: message, iconType: 'info' });
}

function status() {
  return { config: config, focused: charge ? charge.focused : false, detection: detection,
    detectorError: detectorError, inputError: inputError, configWarning: configWarning,
    shortcutErrors: shortcutErrors.slice() };
}

function sendSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings-state', status());
}

function clearTransitionTimer() {
  transitionRevision++;
  if (transitionTimer !== null) clearTimeout(transitionTimer);
  transitionTimer = null;
}

function publishOverlay() {
  clearTransitionTimer();
  if (quitting) return;
  const now = Date.now();
  const state = charge.snapshot(now);
  const deadline = charge.nextDeadline();
  if (deadline !== null) {
    const revision = transitionRevision;
    transitionTimer = setTimeout(() => {
      if (revision === transitionRevision && !quitting) publishOverlay();
    }, Math.max(0, deadline - now));
  }
  if (!overlay || overlay.isDestroyed() || !overlayReady) return;
  overlay.webContents.send('charge-state', state);
  if (state.visible) {
    if (!overlay.isVisible()) overlay.showInactive();
  } else if (overlay.isVisible()) overlay.hide();
}

function refreshTray() {
  if (!tray || quitting) return;
  const modeLabel = LABELS[MODES.indexOf(config.mode)];
  const menu = [
    { label: detection, enabled: false },
    { label: '显示模式', submenu: MODES.map((mode, index) => ({
      label: LABELS[index], type: 'radio', checked: config.mode === mode,
      click: () => changeMode(mode)
    })) },
    { label: '当前武器', submenu: WEAPON_IDS.map(weapon => ({
      label: WEAPONS[weapon].name, type: 'radio', checked: config.weapon === weapon,
      click: () => changeWeapon(weapon)
    })) },
    { type: 'separator' },
    { label: '启用切换模式热键（' + config.hotkeys.toggle.accelerator + '）',
      type: 'checkbox', checked: config.hotkeys.toggle.enabled, click: () => toggleHotkey('toggle') },
    { label: '启用退出热键（' + config.hotkeys.quit.accelerator + '）',
      type: 'checkbox', checked: config.hotkeys.quit.enabled, click: () => toggleHotkey('quit') },
    { label: '启用切换武器热键（' + config.hotkeys.weapon.accelerator + '）',
      type: 'checkbox', checked: config.hotkeys.weapon.enabled, click: () => toggleHotkey('weapon') },
    { label: '热键仅在 HD2 前台时生效', enabled: false },
    { label: '武器与热键设置…', click: openSettings }
  ];
  if (shortcutErrors.length) menu.push({ label: '热键冲突：打开设置查看', click: openSettings });
  if (inputError) menu.push({ label: '鼠标监听异常：打开设置查看', click: openSettings });
  if (configWarning) menu.push({ label: '配置提示：打开设置查看', click: openSettings });
  menu.push({ label: '重新检测', click: restartDetection }, { type: 'separator' }, { label: '退出 HD2CB', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(menu));
  tray.setToolTip('HD2CB · ' + WEAPONS[config.weapon].shortName + ' · ' + modeLabel + '\n' + detection);
  sendSettings();
}

function syncShortcuts() {
  globalShortcut.unregisterAll();
  // Keep the last conflict visible when opening settings (which itself takes focus).
  if (!charge.focused) return;
  shortcutErrors = [];
  if (charge.focused) {
    ACTIONS.forEach(action => {
      const item = config.hotkeys[action];
      if (!item.enabled) return;
      let registered = false;
      try {
        registered = globalShortcut.register(item.accelerator, () => {
          if (!charge.focused) return;
          if (action === 'quit') app.quit();
          else if (action === 'weapon') changeWeapon(WEAPON_IDS[(WEAPON_IDS.indexOf(config.weapon) + 1) % WEAPON_IDS.length]);
          else changeMode(MODES[(MODES.indexOf(config.mode) + 1) % MODES.length]);
        });
      } catch (error) { /* Report unsupported/reserved accelerators like conflicts. */ }
      if (!registered) shortcutErrors.push(item.accelerator + ' 无法注册，可能已被其他程序占用。请更换快捷键。');
    });
  }
  const signature = shortcutErrors.join('\n');
  if (signature && signature !== notifiedShortcutError) {
    notify(signature);
    notifiedShortcutError = signature;
  }
}

function applyConfig(candidate) {
  const next = validateConfig(candidate);
  try { writeConfig(configFile, next); }
  catch (error) { throw new Error('设置保存失败，原设置未改变：' + error.message); }
  config = next;
  configWarning = null;
  shortcutErrors = [];
  charge.setMode(config.mode);
  charge.setWeapon(config.weapon);
  notifiedShortcutError = '';
  syncShortcuts();
  publishOverlay();
  refreshTray();
}

function changeMode(mode) {
  const next = JSON.parse(JSON.stringify(config));
  next.mode = mode;
  try { applyConfig(next); }
  catch (error) { notify(error.message); refreshTray(); }
}

function changeWeapon(weapon) {
  const next = JSON.parse(JSON.stringify(config));
  next.weapon = weapon;
  try { applyConfig(next); }
  catch (error) { notify(error.message); refreshTray(); }
}

function toggleHotkey(action) {
  const next = JSON.parse(JSON.stringify(config));
  next.hotkeys[action].enabled = !next.hotkeys[action].enabled;
  try { applyConfig(next); }
  catch (error) { notify(error.message); refreshTray(); }
}

function updateFocus(focused) {
  const changed = charge.focused !== focused;
  charge.setFocus(focused, Date.now());
  if (changed) syncShortcuts();
  publishOverlay();
}

function detectionFailed(message) {
  detectorError = message;
  detection = '检测异常，进度条已隐藏';
  updateFocus(false);
  refreshTray();
  notify(message);
}

function restartDetection() {
  if (!monitor) return;
  detectorError = null;
  detection = '正在检测 HD2…';
  updateFocus(false);
  refreshTray();
  monitor.start();
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({ width: 660, height: 740, resizable: false, show: false,
    title: 'HD2CB · 武器与热键设置', autoHideMenuBar: true, backgroundColor: '#101820',
    icon: path.join(__dirname, 'tray.png'),
    webPreferences: { nodeIntegration: true, contextIsolation: false, defaultEncoding: 'UTF-8' }
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.webContents.once('did-finish-load', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.show();
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function setupIPC() {
  function trusted(event) {
    return settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents;
  }
  ipcMain.on('settings-get', event => {
    if (trusted(event)) event.sender.send('settings-state', status());
  });
  ipcMain.on('settings-save', (event, draft) => {
    if (!trusted(event)) return;
    try {
      if (!draft || typeof draft !== 'object') throw new Error('设置格式无效。');
      // The tray owns display mode; settings edit only the submitted fields.
      applyConfig({ version: 2, mode: config.mode, weapon: draft.weapon, hotkeys: draft.hotkeys });
      event.sender.send('settings-result', { ok: true, message: '设置已保存。热键将在 HD2 前台时生效。' });
    } catch (error) { event.sender.send('settings-result', { ok: false, message: error.message }); }
  });
  ipcMain.on('settings-close', event => { if (trusted(event)) settingsWindow.close(); });
  ipcMain.on('settings-retry', event => { if (trusted(event)) restartDetection(); });
}

function initialize() {
  configFile = path.join(app.getPath('userData'), 'settings.json');
  const loaded = readConfig(configFile);
  config = loaded.config;
  configWarning = loaded.warning;
  if (loaded.migrated) {
    try { writeConfig(configFile, config); }
    catch (error) { configWarning = '旧配置已迁移，但保存失败：' + error.message; }
  }
  charge = new ChargeState(config.mode, config.weapon);
  tray = new Tray(path.join(__dirname, 'tray.png'));
  tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', openSettings);
  tray.on('balloon-click', openSettings);
  setupIPC();
  overlay = new BrowserWindow({ width: 500, height: 200, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false, focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setMenu(null);
  overlay.loadFile(path.join(__dirname, 'index.html'));
  overlay.webContents.on('did-finish-load', () => { overlayReady = true; publishOverlay(); });
  overlay.webContents.on('crashed', () => { app.quit(); });
  overlay.on('closed', () => { overlay = null; if (!quitting) app.quit(); });

  try {
    hook = require('iohook');
    hook.on('mousedown', event => { charge.mouse(event.button, true, Date.now()); publishOverlay(); });
    hook.on('mouseup', event => { charge.mouse(event.button, false, Date.now()); publishOverlay(); });
    hook.start();
  } catch (error) { inputError = '鼠标监听无法启动，请重新启动程序：' + error.message; }

  monitor = new FocusMonitor(path.join(__dirname, '..', 'native', 'FocusMonitor.exe'));
  monitor.on('state', state => {
    const focused = isHD2(state);
    const nextDetection = focused ? 'HD2 已聚焦' : '等待 HD2 聚焦';
    const changed = detection !== nextDetection;
    detection = nextDetection;
    updateFocus(focused && !inputError);
    if (changed) refreshTray();
  });
  monitor.on('failure', detectionFailed);
  restartDetection();
  notify(pendingSecondLaunch ? 'HD2CB 已在运行，请通过托盘操作。' :
    'HD2CB 已启动：' + LABELS[MODES.indexOf(config.mode)] + '。仅在 HD2 前台显示；点击托盘图标调整设置。');
  if (configWarning || inputError) setTimeout(() => notify(configWarning || inputError), 1500);
}

// Electron 4 uses the ready event; app.whenReady() is not available in this runtime.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (tray) notify('HD2CB 已在运行，请通过托盘操作。');
    else pendingSecondLaunch = true;
  });
  app.on('ready', initialize);
  app.on('window-all-closed', () => { /* Tray owns the application lifetime. */ });
  app.on('before-quit', () => {
    quitting = true;
    clearTransitionTimer();
    if (monitor) monitor.stop();
    globalShortcut.unregisterAll();
    // iohook 0.9.2's Windows unload races its hook thread and crashes this build.
    // Stop JS dispatch here; Windows releases native hooks when the app process exits.
    if (hook) { hook.stop(); hook.removeAllListeners(); }
    if (tray) { tray.destroy(); tray = null; }
  });
}

// Local tests can inspect the real app without adding a network/debug endpoint.
module.exports = { status, openSettings, restartDetection };
