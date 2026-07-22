import { defineStore } from 'pinia'
import notice from '../services/notification'

export const useAutoUpdatesStore = defineStore('autoUpdates', {
  state: () => ({}),
  actions: {
    LISTEN_FOR_UPDATE() {
      window.electron.ipcRenderer.on('mt::UPDATE_ERROR', (_, message) => {
        notice.notify({
          title: 'Update',
          type: 'error',
          time: 10000,
          message
        })
      })
      window.electron.ipcRenderer.on('mt::UPDATE_NOT_AVAILABLE', (_, message) => {
        notice.notify({
          title: 'Update not Available',
          type: 'primary',
          message
        })
      })
      // An available update now opens the dedicated updater window from the main
      // process (src/main/updater); no editor-side prompt anymore.
    }
  }
})
