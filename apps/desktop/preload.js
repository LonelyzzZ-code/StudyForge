const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('studyforge', {
  platform: process.platform,
  desktop: true,
});
