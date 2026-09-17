'use strict';

const MODES = ['hidden', 'right-mouse', 'always'];
const LABELS = ['隐藏', '按住右键显示', '游戏内常显'];

function defaults() {
  return { version: 1, mode: 'right-mouse', hotkeys: {
    toggle: { enabled: true, accelerator: 'F1' },
    quit: { enabled: true, accelerator: 'F2' }
  } };
}

function normalizeAccelerator(value) {
  if (typeof value !== 'string' || value.length > 80) throw new Error('请输入有效的快捷键。');
  const parts = value.trim().split('+').map(part => part.trim().toUpperCase());
  const key = parts.pop();
  const modifiers = [];
  parts.forEach(part => {
    const normalized = part === 'CONTROL' ? 'CTRL' : part;
    if (['CTRL', 'ALT', 'SHIFT'].indexOf(normalized) === -1 || modifiers.indexOf(normalized) !== -1) {
      throw new Error('修饰键只支持 Ctrl、Alt、Shift，且不可重复。');
    }
    modifiers.push(normalized);
  });
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  const namedKeys = { SPACE: 'Space', ENTER: 'Enter', TAB: 'Tab', ESCAPE: 'Escape',
    BACKSPACE: 'Backspace', DELETE: 'Delete', INSERT: 'Insert', HOME: 'Home', END: 'End',
    PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right' };
  if (!functionKey && (!modifiers.length || (!/^[A-Z0-9]$/.test(key) && !namedKeys[key]))) {
    throw new Error('请使用 F1–F24，或 Ctrl/Alt/Shift 加字母、数字、方向键等常用按键。');
  }
  const ordered = ['CTRL', 'ALT', 'SHIFT'].filter(part => modifiers.indexOf(part) !== -1)
    .map(part => ({ CTRL: 'Ctrl', ALT: 'Alt', SHIFT: 'Shift' }[part]));
  ordered.push(namedKeys[key] || key);
  return ordered.join('+');
}

function validateConfig(value) {
  if (!value || value.version !== 1 || MODES.indexOf(value.mode) === -1 || !value.hotkeys) {
    throw new Error('配置格式或显示模式无效。');
  }
  const result = { version: 1, mode: value.mode, hotkeys: {} };
  ['toggle', 'quit'].forEach(action => {
    const item = value.hotkeys[action];
    if (!item || typeof item.enabled !== 'boolean') throw new Error('热键开关无效。');
    result.hotkeys[action] = { enabled: item.enabled, accelerator: normalizeAccelerator(item.accelerator) };
  });
  if (result.hotkeys.toggle.accelerator === result.hotkeys.quit.accelerator) {
    throw new Error('切换模式和退出程序不能使用相同的快捷键。');
  }
  return result;
}

function isHD2(state) {
  if (!state || state.error || !state.hasWindow || state.minimized) return false;
  if (state.processName) return state.processName.toLowerCase() === 'helldivers2.exe';
  return state.title === 'HELLDIVERS™ 2';
}

class ChargeState {
  constructor(mode) {
    this.mode = mode;
    this.focused = false;
    this.reset();
  }
  reset() { this.left = false; this.right = false; this.startedAt = 0; }
  setFocus(focused) {
    if (this.focused !== focused || !focused) this.reset();
    this.focused = focused;
  }
  setMode(mode) {
    if (MODES.indexOf(mode) === -1) throw new Error('无效显示模式');
    this.mode = mode;
  }
  mouse(button, down, now) {
    if (!this.focused) return;
    if (button === 1) {
      if (down && !this.left) this.startedAt = now;
      this.left = down;
    }
    if (button === 2) this.right = down;
  }
  snapshot(now) {
    const visible = this.focused && (this.mode === 'always' || (this.mode === 'right-mouse' && this.right));
    return { visible: visible, charging: visible && this.left,
      elapsed: visible && this.left ? Math.max(0, now - this.startedAt) : 0 };
  }
}

function chargeStyle(elapsed) {
  return { percent: Math.max(0, Math.min(elapsed / 3000, 1)) * 100,
    color: elapsed < 2000 ? 'green' : elapsed < 2500 ? 'yellow' : 'red' };
}

module.exports = { MODES, LABELS, defaults, normalizeAccelerator, validateConfig, isHD2, ChargeState, chargeStyle };
