'use strict';
const EventEmitter = require('events');
const childProcess = require('child_process');
const readline = require('readline');

class FocusMonitor extends EventEmitter {
  constructor(executable) {
    super();
    this.executable = executable;
    this.child = null;
    this.timer = null;
    this.lines = null;
  }
  start() {
    this.stop();
    const child = childProcess.spawn(this.executable, [String(process.pid)], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
    });
    this.child = child;
    let lastMessage = Date.now();
    const fail = message => {
      if (this.child !== child) return;
      this.stop();
      this.emit('failure', message);
    };
    child.on('error', error => fail('检测助手无法启动：' + error.message));
    child.on('exit', () => fail('检测助手已退出，请点击“重新检测”。'));
    child.stdin.on('error', () => {});
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on('line', line => {
      if (this.child !== child) return;
      try {
        const state = JSON.parse(line);
        if (state.type !== 'state' || typeof state.hasWindow !== 'boolean' ||
            typeof state.minimized !== 'boolean' || typeof state.title !== 'string' ||
            (state.processName !== null && typeof state.processName !== 'string') ||
            (state.error !== null && typeof state.error !== 'string')) throw new Error('数据格式无效');
        if (state.error) return fail('窗口检测失败：' + state.error);
        lastMessage = Date.now();
        this.emit('state', state);
      } catch (error) { fail('检测助手返回了无效数据：' + error.message); }
    });
    this.timer = setInterval(() => {
      if (Date.now() - lastMessage > 2000) fail('检测助手响应超时，请点击“重新检测”。');
    }, 100);
  }
  stop() {
    const child = this.child;
    this.child = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.lines) this.lines.close();
    this.lines = null;
    if (child) { child.stdin.destroy(); child.kill(); }
  }
}
module.exports = FocusMonitor;
