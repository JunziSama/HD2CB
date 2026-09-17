const path = require('path');
const iohook = require(path.join(__dirname, '../node_modules/iohook'));

iohook.on('mousedown', event => {
  console.log('Mouse down:', event);
});

iohook.start();
