/* StudyForge Electron 主进程：窗口 + Python sidecar 生命周期 + 单实例锁。
 * 职责刻意保持极薄（03 架构 §二）。 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEV = !!process.env.STUDYFORGE_DEV;
const DEV_URL = 'http://127.0.0.1:8765';

let mainWindow = null;
let sidecar = null;
let serverPort = 0;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function sidecarBinary() {
  // 打包布局: resources/<platform 二进制>；dev 布局: 直接跑 uvicorn 不由壳管理
  const res = process.resourcesPath || path.join(__dirname, 'resources');
  const names = { darwin: 'studyforge-server/studyforge-server', win32: 'studyforge-server/studyforge-server.exe' };
  const bin = path.join(res, names[process.platform] || 'studyforge-server/studyforge-server');
  if (!fs.existsSync(bin)) throw new Error(`sidecar 不存在: ${bin}`);
  return bin;
}

async function startSidecar() {
  serverPort = await freePort();
  const bin = sidecarBinary();
  const dataDir = path.join(app.getPath('userData'), 'data');
  const distDir = path.join(process.resourcesPath || path.join(__dirname, 'resources'), 'web-dist');
  sidecar = spawn(bin, ['--port', String(serverPort)], {
    env: {
      ...process.env,
      STUDYFORGE_DATA_DIR: dataDir,
      STUDYFORGE_DIST: distDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sidecar.stdout.on('data', (d) => process.stdout.write(`[sidecar] ${d}`));
  sidecar.stderr.on('data', (d) => process.stderr.write(`[sidecar] ${d}`));
  sidecar.on('exit', (code) => {
    sidecar = null;
    if (!app.isQuitting && mainWindow) {
      mainWindow.webContents.send('backend-died', code);
    }
  });
}

function waitHealthy(port, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function ping() {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('后端启动超时'));
        else setTimeout(ping, 400);
      });
    })();
  });
}

const LOADING_HTML = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>StudyForge</title><style>
  body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:linear-gradient(160deg,#06342a,#0a4636);color:#fff;font-family:-apple-system,"PingFang SC",sans-serif}
  .logo{width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#34d399,#047857);
        display:flex;align-items:center;justify-content:center;font-size:34px;margin-bottom:22px;
        box-shadow:0 8px 30px rgba(16,185,129,.4);animation:pop .5s ease both}
  .name{font-size:22px;font-weight:800;letter-spacing:1px}
  .name span{color:#34d399}
  .tip{margin-top:10px;font-size:13px;color:#9fd4bc;animation:pulse 1.4s infinite}
  .bar{width:180px;height:5px;border-radius:99px;background:rgba(255,255,255,.15);margin-top:26px;overflow:hidden}
  .bar>i{display:block;height:100%;width:40%;border-radius:99px;background:#34d399;animation:slide 1.2s ease-in-out infinite}
  @keyframes pop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
</style></head><body>
  <div class="logo">📗</div>
  <div class="name">Study<span>Forge</span></div>
  <div class="tip">正在启动本地学习引擎…（首次启动约需数十秒）</div>
  <div class="bar"><i></i></div>
</body></html>`);

async function createWindow(targetUrl) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#06342a',
    title: 'StudyForge',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const base = targetUrl || (DEV ? DEV_URL : `http://127.0.0.1:${serverPort}`);
  await mainWindow.loadURL(base);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await createWindow(LOADING_HTML);           // 先显示品牌启动页
      if (!DEV) {
        await startSidecar();
        await waitHealthy(serverPort, 120000);    // 后端就绪（上限 120s）
        await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
      }
    } catch (e) {
      console.error(e);
      const { dialog } = require('electron');
      dialog.showErrorBox('StudyForge 启动失败', String(e));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (sidecar) sidecar.kill();
  });
}
