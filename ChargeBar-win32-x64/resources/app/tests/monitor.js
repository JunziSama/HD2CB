'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const childProcess = require('child_process');
const EventEmitter = require('events');
const { PassThrough } = require('stream');
const FocusMonitor = require('../src/focus-monitor');
const executable = path.resolve(__dirname, '../native/FocusMonitor.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return false; } };

async function nativeChecks() {
  const monitor = new FocusMonitor(executable);
  const samples = [];
  let failure = null;
  monitor.on('state', sample => samples.push(sample));
  monitor.on('failure', value => { failure = value; });
  monitor.start();
  const pid = monitor.child.pid;
  await delay(1400);
  assert.strictEqual(failure, null); assert(samples.length >= 2, 'initial state and heartbeat');
  monitor.stop(); await delay(200); assert(!alive(pid));
  console.log('PASS native foreground metadata, heartbeat and stop cleanup');

  const launcher = childProcess.spawn(process.execPath, ['-e',
    'const c=require("child_process").spawn(process.argv[1],[String(process.pid)],{windowsHide:true,stdio:["pipe","ignore","ignore"]});console.log(c.pid);setInterval(()=>{},1000);', executable
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const orphanPid = await new Promise(resolve => launcher.stdout.once('data', data => resolve(Number(data.toString().trim()))));
  assert(alive(orphanPid));
  launcher.kill();
  await delay(600); assert(!alive(orphanPid), 'helper must exit when its parent crashes');
  console.log('PASS helper exits after abrupt parent termination');

  const missing = new FocusMonitor(executable + '.missing');
  const error = new Promise(resolve => missing.once('failure', resolve));
  missing.start(); assert((await error).indexOf('无法启动') !== -1);
  console.log('PASS missing helper reports failure without throwing');
}

function mockedChecks() {
  let now = 0, tick, child;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/focus-monitor.js'), 'utf8'), {
    require: name => name === 'child_process' ? { spawn: () => {
      child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough();
      child.kill = () => { child.killed = true; }; return child;
    } } : require(name), module, process, Date: { now: () => now },
    setInterval: fn => { tick = fn; return 1; }, clearInterval: () => {}
  });
  const monitor = new module.exports('fake.exe');
  const failures = [];
  monitor.on('failure', message => failures.push(message));
  monitor.start(); now = 2001; tick();
  assert(child.killed); assert(failures[0].indexOf('超时') !== -1);
  monitor.start(); child.stdout.write('{bad}\n');
  assert(child.killed); assert(failures[1].indexOf('无效数据') !== -1);
  monitor.start();
  child.stdout.write(JSON.stringify({ type: 'state', hasWindow: false, minimized: false, processName: null, title: '', error: 'access failed' }) + '\n');
  assert(child.killed); assert(failures[2].indexOf('access failed') !== -1);
  console.log('PASS timeout, malformed data and explicit errors stop monitoring');
}
nativeChecks().then(mockedChecks).catch(error => { console.error(error); process.exitCode = 1; });
