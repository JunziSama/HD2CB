'use strict';

const MODES = ['hidden', 'right-mouse', 'always'];
const LABELS = ['隐藏', '按住右键显示', '游戏内常显'];
const ACTIONS = ['toggle', 'quit', 'weapon'];
const WEAPON_IDS = ['epoch', 'railgun', 'quasar', 'arc-thrower', 'purifier', 'loyalist'];
const WEAPONS = {
  'arc-thrower': { name: 'ARC-3 电弧发射器', shortName: '电弧发射器', duration: 1000, completion: 'release', markers: [],
    description: '约 1 秒蓄满 · 青色保持到松手，松手清零' },
  purifier: { name: 'PLAS-101 净化者', shortName: '净化者', duration: 1000, completion: 'release', markers: [],
    description: '1 秒满蓄力 · 青色保持到松手，松手清零' },
  loyalist: { name: 'PLAS-15 忠诚者', shortName: '忠诚者', duration: 750, completion: 'release', markers: [],
    description: '暂按 0.75 秒满蓄力（待游戏内校准）· 青色保持到松手' },
  quasar: { name: 'LAS-99 类星体加农炮', shortName: '类星体加农炮', duration: 3000, completion: 'timed', markers: [],
    description: '3 秒蓄力后自动发射，不会过载自爆 · 满格青色保持 0.5 秒后隐藏' },
  epoch: { name: 'PLAS-45 纪元', shortName: '纪元', duration: 3250, completion: 'timed',
    markers: [{ at: 1000, label: '1.0 秒：可发射' }, { at: 2500, label: '2.5 秒：高穿甲' }, { at: 2600, label: '2.6 秒：满伤害' }],
    description: '1.0 秒可发射 · 2.5 秒高穿甲 · 2.6 秒满伤害 · 3.25 秒炸膛上限' },
  railgun: { name: 'RS-422 磁轨炮（不安全模式）', shortName: '磁轨炮', duration: 3000, completion: 'timed',
    markers: [{ at: 450, label: '0.45 秒：可发射' }, { at: 2000, label: '2.0 秒：高蓄力提醒' }, { at: 2500, label: '2.5 秒：危险区提醒' }],
    description: '不安全模式：0.45 秒可发射 · 2 秒黄 / 2.5 秒红色提醒 · 3 秒过载上限'  }
};

function defaults() {
  return { version: 2, mode: 'right-mouse', weapon: 'epoch', hotkeys: {
    toggle: { enabled: true, accelerator: 'F1' },
    quit: { enabled: true, accelerator: 'F2' },
    weapon: { enabled: true, accelerator: 'F3' }
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
  if (!value || [1, 2].indexOf(value.version) === -1 || MODES.indexOf(value.mode) === -1 || !value.hotkeys) {
    throw new Error('配置格式或显示模式无效。');
  }
  const legacy = value.version === 1;
  const weapon = legacy ? 'epoch' : value.weapon;
  if (WEAPON_IDS.indexOf(weapon) === -1) throw new Error('武器选择无效。');
  const result = { version: 2, mode: value.mode, weapon: weapon, hotkeys: {} };
  const used = [];
  (legacy ? ['toggle', 'quit'] : ACTIONS).forEach(action => {
    const item = value.hotkeys[action];
    if (!item || typeof item.enabled !== 'boolean') throw new Error('热键开关无效。');
    const accelerator = normalizeAccelerator(item.accelerator);
    if (used.indexOf(accelerator) !== -1) throw new Error('三项操作不能使用相同的快捷键。');
    used.push(accelerator);
    result.hotkeys[action] = { enabled: item.enabled, accelerator: accelerator };
  });
  if (legacy) {
    let key = 3;
    while (used.indexOf('F' + key) !== -1) key++;
    result.hotkeys.weapon = { enabled: true, accelerator: 'F' + key };
  }
  return result;
}

function isHD2(state) {
  if (!state || state.error || !state.hasWindow || state.minimized) return false;
  if (state.processName) return state.processName.toLowerCase() === 'helldivers2.exe';
  return state.title === 'HELLDIVERS™ 2';
}

class ChargeState {
  constructor(mode, weapon) {
    this.mode = mode;
    this.weapon = weapon || 'epoch';
    this.focused = false;
    this.left = false;
    this.right = false;
    this.requireRelease = false;
    this.startedAt = null;
    this.phase = 'idle';
    this.noticePending = false;
    this.noticeUntil = null;
  }
  advance(now) {
    if (this.startedAt === null) return;
    const elapsed = now - this.startedAt;
    const duration = WEAPONS[this.weapon].duration;
    if (this.phase === 'charging' && elapsed >= duration) this.phase = 'complete';
    if (WEAPONS[this.weapon].completion === 'timed' && this.phase === 'complete' && elapsed >= duration + 500) this.phase = 'waiting';
  }
  setFocus(focused, now) {
    this.advance(now === undefined ? Date.now() : now);
    if (!focused) {
      this.phase = WEAPONS[this.weapon].completion === 'timed' && (this.phase === 'complete' || this.phase === 'waiting') ? 'waiting' : 'idle';
      this.left = false;
      this.right = false;
      this.requireRelease = false;
      this.startedAt = null;
      // A notice not yet shown survives opening settings; an already visible one ends.
      this.noticeUntil = null;
    }
    this.focused = focused;
  }
  setMode(mode) {
    if (MODES.indexOf(mode) === -1) throw new Error('无效显示模式');
    this.mode = mode;
  }
  setWeapon(weapon) {
    if (WEAPON_IDS.indexOf(weapon) === -1) throw new Error('武器选择无效。');
    if (weapon === this.weapon) return;
    this.weapon = weapon;
    this.requireRelease = this.requireRelease || this.left;
    this.left = false;
    this.startedAt = null;
    this.phase = 'idle';
    this.noticeUntil = null;
    this.noticePending = true;
  }
  mouse(button, down, now) {
    if (!this.focused) return;
    this.advance(now);
    if (button === 1) {
      if (!down) {
        this.left = false;
        this.requireRelease = false;
        if (this.phase === 'charging' || WEAPONS[this.weapon].completion === 'release') { this.phase = 'idle'; this.startedAt = null; }
      } else if (!this.left && !this.requireRelease) {
        this.left = true;
        this.startedAt = now;
        this.phase = 'charging';
      }
    }
    if (button === 2) this.right = down;
  }
  snapshot(now) {
    this.advance(now);
    const visible = this.focused && this.phase !== 'waiting' &&
      (this.mode === 'always' || (this.mode === 'right-mouse' && this.right));
    if (this.noticeUntil !== null && (!visible || now >= this.noticeUntil)) this.noticeUntil = null;
    if (this.noticePending && visible) {
      this.noticePending = false;
      this.noticeUntil = now + 2000;
    }
    const running = this.phase === 'charging' || this.phase === 'complete';
    return { visible: visible, charging: visible && this.phase === 'charging',
      elapsed: visible && running ? Math.min(WEAPONS[this.weapon].duration, Math.max(0, now - this.startedAt)) : 0,
      weapon: this.weapon, phase: this.phase,
      notice: visible && this.noticeUntil !== null ? WEAPONS[this.weapon].shortName : null };
  }
  nextDeadline() {
    const deadlines = [];
    if (this.focused && this.startedAt !== null) {
      if (this.phase === 'charging') deadlines.push(this.startedAt + WEAPONS[this.weapon].duration);
      if (this.phase === 'complete' && WEAPONS[this.weapon].completion === 'timed') deadlines.push(this.startedAt + WEAPONS[this.weapon].duration + 500);
    }
    if (this.noticeUntil !== null) deadlines.push(this.noticeUntil);
    return deadlines.length ? Math.min.apply(Math, deadlines) : null;
  }
}

function chargeStyle(elapsed, weapon) {
  const profile = WEAPONS[weapon || 'epoch'];
  return { percent: Math.max(0, Math.min(elapsed / profile.duration, 1)) * 100,
    color: (weapon === 'quasar' || profile.completion === 'release') ? (elapsed < profile.duration ? 'green' : 'cyan') : weapon === 'railgun' ? (elapsed < 450 ? 'gray' : elapsed < 2000 ? 'green' : elapsed < 2500 ? 'yellow' : 'red') :
      elapsed < 1000 ? 'gray' : elapsed < 2500 ? 'green' : elapsed < 2600 ? 'yellow' : 'red' };
}

module.exports = { MODES, LABELS, ACTIONS, WEAPON_IDS, WEAPONS, defaults, normalizeAccelerator, validateConfig, isHD2, ChargeState, chargeStyle };
