import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { COMMANDS } from '../../commands'
import { isOsx } from '../../config'

const { autoUpdater } = electronUpdater

let runningUpdate = false
// A silent check reports nothing unless an update is actually available,
// so background checks at startup don't spam notifications.
let silentCheck = false
let win = null

autoUpdater.autoDownload = false

autoUpdater.on('error', (error) => {
  runningUpdate = false
  if (win && !silentCheck) {
    win.webContents.send(
      'mt::UPDATE_ERROR',
      error === null ? 'Error: unknown' : (error.message || error).toString()
    )
  }
})

autoUpdater.on('update-available', () => {
  silentCheck = false
  if (win) {
    win.webContents.send(
      'mt::UPDATE_AVAILABLE',
      'Found an update, do you want download and install now?'
    )
  }
  runningUpdate = false
})

autoUpdater.on('update-not-available', () => {
  if (win && !silentCheck) {
    win.webContents.send('mt::UPDATE_NOT_AVAILABLE', 'Current version is up-to-date.')
  }
  runningUpdate = false
})

autoUpdater.on('update-downloaded', () => {
  // TODO: We should ask the user, so that the user can save all documents and
  // not just force close the application.

  if (win) {
    win.webContents.send(
      'mt::UPDATE_DOWNLOADED',
      'Update downloaded, application will be quit for update...'
    )
  }
  setImmediate(() => autoUpdater.quitAndInstall())
})

ipcMain.on('mt::NEED_UPDATE', (e, { needUpdate }) => {
  if (needUpdate) {
    autoUpdater.downloadUpdate()
  } else {
    runningUpdate = false
  }
})

ipcMain.on('mt::check-for-update', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  checkUpdates(win)
})

// --------------------------------------------------------

export const userSetting = () => {
  ipcMain.emit('app-create-settings-window')
}

export const checkUpdates = (browserWindow, { silent = false } = {}) => {
  if (!runningUpdate) {
    runningUpdate = true
    silentCheck = silent
    win = browserWindow
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

export const osxHide = () => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hide:')
  }
}

export const osxHideAll = () => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hideOtherApplications:')
  }
}

export const osxShowAll = () => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('unhideAllApplications:')
  }
}

// --- Commands -------------------------------------------------------------

export const loadMarktextCommands = (commandManager) => {
  commandManager.add(COMMANDS.MT_HIDE, osxHide)
  commandManager.add(COMMANDS.MT_HIDE_OTHERS, osxHideAll)
}
