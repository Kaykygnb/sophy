'use strict';
const os = require('node:os');
const path = require('node:path');
const { AreaFiles } = require('./files');
const { WorldManager } = require('./worlds');

function appDataPath(home = os.homedir(), platform = process.platform) {
  const base =
    platform === 'win32'
      ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'notas1');
}

function protectedLocations({ userData, appPath, home }) {
  return [
    userData,
    appPath,
    path.join(home, '.config'),
    path.join(home, '.local'),
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.codex'),
  ].filter(Boolean);
}

function createWorkspaceCore({
  userData = appDataPath(),
  home = os.homedir(),
  appPath = path.resolve(__dirname, '..'),
} = {}) {
  const protectedPaths = protectedLocations({ userData, appPath, home });
  const worlds = new WorldManager(path.join(userData, 'worlds.json'), { home, protectedPaths });
  return {
    worlds,
    current: () => worlds.current(),
    files: (workspaceId) => new AreaFiles(worlds.current(), workspaceId),
  };
}

module.exports = { appDataPath, createWorkspaceCore, protectedLocations };
