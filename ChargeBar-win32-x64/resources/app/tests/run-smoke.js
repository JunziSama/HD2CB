'use strict';
// Builds a separate hard-linked Electron runtime so testing never changes the user's configuration.
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const distribution = path.resolve(__dirname, '../../..');
const root = path.resolve(distribution, '..', '.qa');
const runtime = path.join(root, 'runtime');
const output = path.join(root, 'run-' + Date.now());
fs.mkdirSync(path.join(runtime, 'resources', 'app'), { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'userData'), { recursive: true });
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
childProcess.execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/r:System.Windows.Forms.dll',
  '/r:System.Drawing.dll', '/out:' + path.join(output, 'helldivers2.exe'), path.join(__dirname, 'TestGame.cs')], { windowsHide: true });
fs.readdirSync(distribution).forEach(name => {
  const source = path.join(distribution, name), target = path.join(runtime, name);
  if (fs.statSync(source).isFile() && !fs.existsSync(target)) fs.linkSync(source, target);
});
['locales', 'swiftshader'].forEach(name => {
  const target = path.join(runtime, name);
  if (!fs.existsSync(target)) fs.symlinkSync(path.join(distribution, name), target, 'junction');
});
const archive = path.join(runtime, 'resources', 'electron.asar');
if (!fs.existsSync(archive)) fs.linkSync(path.join(distribution, 'resources', 'electron.asar'), archive);
fs.writeFileSync(path.join(runtime, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'hd2cb-smoke', version: '1.0.0', main: 'main.js' }));
fs.writeFileSync(path.join(runtime, 'resources', 'app', 'main.js'), 'require(' + JSON.stringify(path.join(__dirname, 'smoke.js')) + ');');
const env = Object.assign({}, process.env, { HD2CB_QA_ROOT: output });
if (process.argv.indexOf('--focus-fixture') !== -1) env.HD2CB_INTERACTIVE_FOCUS = '1';
delete env.ELECTRON_RUN_AS_NODE;
function run(phase) {
  return new Promise((resolve, reject) => {
    // This is the interactive app under test, not the background focus helper.
    const child = childProcess.spawn(path.join(runtime, 'ChargeBar.exe'), [], {
      env: Object.assign({}, env, { HD2CB_QA_PHASE: phase }), windowsHide: false, stdio: 'inherit'
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Smoke test timed out: ' + phase)); }, 45000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      const filename = path.join(output, 'result-' + phase + '.json');
      if (!fs.existsSync(filename)) return reject(new Error('No report; Electron exit code: ' + code));
      const result = JSON.parse(fs.readFileSync(filename, 'utf8'));
      result.exitCode = code;
      if (code !== 0 || !result.passed) return reject(new Error(JSON.stringify(result, null, 2)));
      result.checks.forEach(check => console.log('PASS ' + check));
      resolve(result);
    });
  });
}
(async () => {
  const results = [await run('main'), await run('restore')];
  fs.writeFileSync(path.join(output, 'userData', 'settings.json'), '{corrupt');
  results.push(await run('corrupt'));
  // Allow orphan detection/OS teardown to settle, then verify all helper PIDs exited.
  await new Promise(resolve => setTimeout(resolve, 300));
  results.forEach(result => result.helperPids.forEach(pid => {
    let running = false;
    try { process.kill(pid, 0); running = true; } catch (error) {}
    if (running) throw new Error('Helper still running after app quit: ' + pid);
  }));
  console.log('PASS normal shutdown exits cleanly and leaves no focus helper processes');
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ passed: true, results }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; })
  .then(() => console.log('QA artifacts: ' + output));
