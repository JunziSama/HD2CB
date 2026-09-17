'use strict';
const { ipcRenderer } = require('electron');
const { chargeStyle } = require('./state');
const fill = document.getElementById('fill');
const bar = document.getElementById('barContainer');
let state = { visible: false, charging: false, elapsed: 0 };
let receivedAt = 0;
let animation = null;

function render() {
  animation = null;
  bar.style.display = state.visible ? 'block' : 'none';
  const elapsed = state.charging ? state.elapsed + performance.now() - receivedAt : 0;
  const style = chargeStyle(elapsed);
  fill.style.height = style.percent + '%';
  fill.style.backgroundColor = style.color;
  if (state.visible && state.charging && elapsed < 3000) animation = requestAnimationFrame(render);
}
ipcRenderer.on('charge-state', (event, next) => {
  state = next;
  receivedAt = performance.now();
  if (animation !== null) cancelAnimationFrame(animation);
  render();
});
render();
