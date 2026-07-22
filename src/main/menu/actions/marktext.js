import { BrowserWindow, Menu, ipcMain } from 'electron'
import { COMMANDS } from '../../commands'
import { isOsx } from '../../config'
import { checkUpdates, checkUpdatesSilently } from '../../updater'

// The update flow lives in src/main/updater (Typora-style updater window);
// re-export the entry points menus and the app bootstrap rely on.
export { checkUpdates, checkUpdatesSilently }

ipcMain.on('mt::check-for-update', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  checkUpdates(win)
})

// --------------------------------------------------------

export const userSetting = () => {
  ipcMain.emit('app-create-settings-window')
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
