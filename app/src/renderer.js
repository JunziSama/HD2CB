'use strict';
const { ipcRenderer } = require('electron');
const { WEAPONS, chargeStyle } = require('./state');
const { heatStyle } = require('./heat');
const heatLabel = document.getElementById('heatLabel');
const fill = document.getElementById('fill');
const bar = document.getElementById('barContainer');
const notice = document.getElementById('weaponNotice');
const markers = document.getElementById('markers');
let state = { visible: false, charging: false, elapsed: 0, weapon: 'epoch', notice: null };
let receivedAt = 0;
let animation = null;
let renderedWeapon = null;

function render() {
  animation = null;
  const profile = WEAPONS[state.weapon];
  if (renderedWeapon !== state.weapon) {
    markers.textContent = '';
    profile.markers.forEach(item => {
      const marker = document.createElement('div');
      marker.className = 'marker';
      marker.style.bottom = (item.at / profile.duration * 100) + '%';
      marker.title = item.label;
      markers.appendChild(marker);
    });
    renderedWeapon = state.weapon;
  }
  bar.style.display = state.visible ? 'block' : 'none';
  notice.textContent = state.notice || '';
  notice.style.display = state.visible && state.notice ? 'block' : 'none';
  const elapsed = state.elapsed + (state.charging ? performance.now() - receivedAt : 0);
  const isHeat = state.weapon === 'double-edge';
  heatLabel.style.display = state.visible && isHeat && state.showHeatText !== false ? 'block' : 'none';
  heatLabel.textContent = isHeat ? '估算热量 ' + Math.round(state.heat || 0) + '%' : '';
  const style = isHeat ? heatStyle(state.heat || 0) : chargeStyle(elapsed, state.weapon);
  fill.style.height = style.percent + '%';
  fill.style.backgroundColor = style.color;
  if (state.visible && state.charging && elapsed < profile.duration) animation = requestAnimationFrame(render);
}
ipcRenderer.on('charge-state', (event, next) => {
  state = next;
  receivedAt = performance.now();
  if (animation !== null) cancelAnimationFrame(animation);
  render();
});
render();
