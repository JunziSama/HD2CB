'use strict';
const PRESETS = {
  normal: { warmup: 0.5, heating: 6.708, cooling: 4 },
  cold: { warmup: 0.5, heating: 6.708, cooling: 6 }
};
function heatDefaults() {
  return Object.assign({ preset: 'normal', monitor: { enabled: true, key: 'R' } }, PRESETS.normal);
}
function normalizeMonitorKey(value) {
  if (typeof value !== 'string') throw new Error('换弹监控键无效。');
  const key = value.trim().toUpperCase();
  if (!/^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(key)) throw new Error('换弹监控仅支持单个字母、数字或 F1–F24。');
  return key;
}
function validateHeat(value, hotkeys) {
  if (!value || ['normal', 'cold', 'custom'].indexOf(value.preset) === -1) throw new Error('热量环境预设无效。');
  ['warmup', 'heating', 'cooling'].forEach(key => {
    const n = value[key], min = key === 'warmup' ? 0 : 0.1, max = key === 'warmup' ? 5 : 100;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error('热量参数无效：启动延迟 0–5 秒，升温/冷却 0.1–100 个百分点/秒。');
  });
  if (!value.monitor || typeof value.monitor.enabled !== 'boolean') throw new Error('换弹监控开关无效。');
  const key = normalizeMonitorKey(value.monitor.key);
  if (Object.keys(hotkeys).some(action => hotkeys[action].accelerator === key)) throw new Error('换弹监控键不能与现有快捷键相同。');
  const result = { preset: value.preset, warmup: value.warmup, heating: value.heating, cooling: value.cooling,
    monitor: { enabled: value.monitor.enabled, key: key } };
  if (result.preset !== 'custom' && ['warmup', 'heating', 'cooling'].some(k => result[k] !== PRESETS[result.preset][k])) result.preset = 'custom';
  return result;
}
// Windows iohook rawcode is the virtual-key code; do not register or suppress it.
function monitorKeyFromEvent(event) {
  const code = event.rawcode;
  if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) return String.fromCharCode(code);
  if (code >= 112 && code <= 135) return 'F' + (code - 111);
  return null;
}
function heatStyle(value) {
  return { percent: Math.max(0, Math.min(100, value)), color: value < 26 ? 'green' : value < 51 ? 'yellow' : value < 91 ? 'orange' : 'red' };
}
class HeatState {
  constructor(config) { this.config = config || heatDefaults(); this.value = 0; this.lastAt = null; this.firedAt = null; }
  advance(now) {
    if (this.lastAt === null) { this.lastAt = now; return; }
    const end = Math.max(this.lastAt, now);
    const ready = this.firedAt === null ? Infinity : this.firedAt + this.config.warmup * 1000;
    const coolingMs = Math.max(0, Math.min(end, ready) - this.lastAt);
    this.value = Math.max(0, this.value - coolingMs * this.config.cooling / 1000);
    const heatingMs = Math.max(0, end - Math.max(this.lastAt, ready));
    this.value = Math.min(100, this.value + heatingMs * this.config.heating / 1000);
    this.lastAt = end;
  }
  start(now) { this.advance(now); this.firedAt = now; }
  stop(now) { this.advance(now); this.firedAt = null; }
  configure(config, now) { this.stop(now); this.config = config; }
  reset(now) { this.stop(now); this.value = 0; }
}
module.exports = { PRESETS, heatDefaults, validateHeat, normalizeMonitorKey, monitorKeyFromEvent, heatStyle, HeatState };
