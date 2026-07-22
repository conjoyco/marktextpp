import path from 'path'
import { app, BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

autoUpdater.autoDownload = false
// Collect the release notes of every version between the installed and the
// latest one, so the updater window can show a Typora-style changelog.
autoUpdater.fullChangelog = true

let preferences = null
let updaterWin = null
// The editor window a manual "Check for updates" originated from; used for
// "up-to-date" and error notifications.
let requestWin = null
let runningUpdate = false
// A silent check reports nothing unless an update is actually available,
// so background checks at startup don't spam notifications.
let silentCheck = false
let downloaded = false

const staticPath = () => path.join(app.isPackaged ? process.resourcesPath : process.cwd(), 'static')

/**
 * Normalize electron-updater release notes into [{ version, note }] where
 * `note` is an HTML fragment.
 */
const normalizeReleaseNotes = (releaseNotes, latestVersion) => {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes.map((entry) => ({
      version: entry.version || '',
      note: typeof entry.note === 'string' ? entry.note : ''
    }))
  } else if (typeof releaseNotes === 'string') {
    return [{ version: latestVersion, note: releaseNotes }]
  }
  return []
}

const buildMeta = (info) => ({
  currentVersion: app.getVersion(),
  latestVersion: info.version,
  notes: normalizeReleaseNotes(info.releaseNotes, info.version),
  autoCheckUpdates: preferences ? !!preferences.getItem('autoCheckUpdates') : true,
  downloaded
})

const sendToUpdater = (channel, ...args) => {
  if (updaterWin && !updaterWin.isDestroyed()) {
    updaterWin.webContents.send(channel, ...args)
  }
}

const showUpdaterWindow = (info) => {
  if (updaterWin && !updaterWin.isDestroyed()) {
    sendToUpdater('mt::updater-meta', buildMeta(info))
    updaterWin.focus()
    return
  }

  updaterWin = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 480,
    minHeight: 420,
    title: 'Updater',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  })
  updaterWin.setMenuBarVisibility(false)
  updaterWin.once('ready-to-show', () => {
    if (updaterWin) {
      updaterWin.show()
    }
  })
  updaterWin.on('closed', () => {
    updaterWin = null
  })
  updaterWin.webContents.once('did-finish-load', () => {
    sendToUpdater('mt::updater-meta', buildMeta(info))
  })
  updaterWin.loadFile(path.join(staticPath(), 'updater.html'))
}

// --- autoUpdater events ----------------------------------------------------

autoUpdater.on('error', (error) => {
  runningUpdate = false
  const message = error == null ? 'Error: unknown' : (error.message || error).toString()
  log.error('Updater error:', message)
  sendToUpdater('mt::updater-error', message)
  if (requestWin && !requestWin.isDestroyed() && !silentCheck) {
    requestWin.webContents.send('mt::UPDATE_ERROR', message)
  }
})

autoUpdater.on('update-available', (info) => {
  runningUpdate = false
  downloaded = false

  // A skipped version only suppresses the automatic prompt — checking manually
  // via the menu always shows the updater window.
  const skipped = preferences ? preferences.getItem('skippedUpdateVersion') : ''
  if (silentCheck && skipped && skipped === info.version) {
    return
  }
  silentCheck = false
  showUpdaterWindow(info)
})

autoUpdater.on('update-not-available', () => {
  runningUpdate = false
  if (requestWin && !requestWin.isDestroyed() && !silentCheck) {
    requestWin.webContents.send('mt::UPDATE_NOT_AVAILABLE', 'Current version is up-to-date.')
  }
})

autoUpdater.on('download-progress', (progress) => {
  sendToUpdater('mt::updater-progress', {
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  })
})

autoUpdater.on('update-downloaded', () => {
  downloaded = true
  // Never force-quit: the user confirms the restart from the updater window. If
  // the window was closed meanwhile, electron-updater installs on next quit
  // (autoInstallOnAppQuit is enabled by default).
  sendToUpdater('mt::updater-downloaded')
})

// --- IPC from the updater window -------------------------------------------

ipcMain.on('mt::updater-download', () => {
  try {
    autoUpdater.downloadUpdate()
  } catch (error) {
    sendToUpdater('mt::updater-error', (error.message || error).toString())
  }
})

ipcMain.on('mt::updater-install', () => {
  setImmediate(() => autoUpdater.quitAndInstall())
})

ipcMain.on('mt::updater-skip', (e, version) => {
  if (preferences && version) {
    preferences.setItem('skippedUpdateVersion', version)
  }
  if (updaterWin) {
    updaterWin.close()
  }
})

ipcMain.on('mt::updater-later', () => {
  if (updaterWin) {
    updaterWin.close()
  }
})

ipcMain.on('mt::updater-auto-check', (e, value) => {
  if (preferences) {
    preferences.setItem('autoCheckUpdates', !!value)
  }
})

// --- public API ------------------------------------------------------------

/**
 * @param {Preference} prefs The application preference instance.
 */
export const initUpdater = (prefs) => {
  preferences = prefs

  // Debug helper: open the updater window with fake data without hitting
  // GitHub, e.g. MARKTEXT_DEBUG_UPDATER=1 to style/test the window.
  if (process.env.MARKTEXT_DEBUG_UPDATER) {
    setTimeout(() => {
      showUpdaterWindow({
        version: '9.9.9',
        releaseNotes: [
          {
            version: '9.9.9',
            note: '<h2>What&#39;s Changed</h2><ul><li>Fake release note for debugging.</li><li>Another change entry.</li></ul>'
          },
          {
            version: '9.9.8',
            note: '<h2>What&#39;s Changed</h2><ul><li>Older fake release note.</li></ul>'
          }
        ]
      })
    }, 1500)
  }
}

export const checkUpdates = (browserWindow, { silent = false } = {}) => {
  if (!runningUpdate) {
    runningUpdate = true
    silentCheck = silent
    requestWin = browserWindow
    autoUpdater.checkForUpdates()
  }
}

export const checkUpdatesSilently = (browserWindow) => {
  // Updates can only be applied by packaged builds, and on macOS only by
  // signed ones, so background checks run on Windows and Linux AppImage
  if (!app.isPackaged) {
    return
  }
  if (process.platform !== 'win32' && !process.env.APPIMAGE) {
    return
  }
  checkUpdates(browserWindow, { silent: true })
}
