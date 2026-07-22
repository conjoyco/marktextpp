/**
 * E2E tests for Sublime-style external file change handling.
 *
 * Scenarios (see src/renderer/src/store/editor.js LISTEN_FOR_FILE_CHANGE):
 *  1. Clean buffer + external change (plain write)  -> silent in-place reload, no bar.
 *  2. Clean buffer + external change (atomic temp+rename) -> same.
 *  3. Dirty buffer + external change -> non-modal bar "Reload from disk" / "Keep my version",
 *     neither side clobbered until the user picks.
 *  4. Saving from the app must not trigger a reload loop or a change bar.
 *
 * Launches the packaged app (dist/win-unpacked, or MARKTEXT_APP_PATH) with an
 * isolated --user-data-dir. The out/ bundle cannot be launched directly with a
 * bare electron binary because the renderer resolves node modules at runtime
 * relative to the packaged asar (see note in app-launch.spec.js) — build with
 * `npm run build:unpack` first.
 */
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')
const appPath =
  process.env.MARKTEXT_APP_PATH || path.join(projectRoot, 'dist/win-unpacked/marktext.exe')

// The chokidar watcher uses awaitWriteFinish with a 1s stability threshold, so
// every externally triggered event needs > 1s to arrive in the renderer.
const WATCH_DELAY = 6000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const editorText = (window) =>
  window.evaluate(() => {
    const el = document.querySelector('#ag-editor-id')
    return el ? el.textContent : ''
  })

const notificationBar = (window) => window.locator('.editor-notifications')

// Keyboard events synthesized through CDP don't reach Electron's native menu
// accelerators, so trigger Save the way the File menu does: via IPC.
const triggerSave = (electronApp) =>
  electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    win.webContents.send('mt::editor-ask-file-save')
  })

test.describe('External file changes (Sublime-style)', () => {
  test.skip(
    !fs.existsSync(appPath),
    `Packaged app not found at ${appPath} — run npm run build:unpack`
  )

  let electronApp
  let window
  let workDir
  let docPath

  test.beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtpp-e2e-'))
    docPath = path.join(workDir, 'doc.md')
    fs.writeFileSync(docPath, '# Title\n\nInitial content from disk.\n')

    electronApp = await electron.launch({
      executablePath: appPath,
      args: ['--user-data-dir=' + path.join(workDir, 'user-data'), '--disable-gpu', docPath],
      cwd: projectRoot,
      timeout: 30000
    })
    window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect
      .poll(() => editorText(window), { timeout: 15000 })
      .toContain('Initial content from disk.')
  })

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close()
    }
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('window title is branded MarkText++', async () => {
    const title = await window.title()
    expect(title).toContain('MarkText++')
  })

  test('clean buffer + plain external write reloads silently in place', async () => {
    fs.writeFileSync(docPath, '# Title\n\nUpdated externally, plain write.\n')
    await expect
      .poll(() => editorText(window), { timeout: WATCH_DELAY })
      .toContain('Updated externally, plain write.')
    // No notification bar for a clean-buffer reload.
    await expect(notificationBar(window)).toBeHidden()
  })

  test('clean buffer + atomic temp+rename replace reloads silently', async () => {
    const tmp = path.join(workDir, '.doc.md.tmp')
    fs.writeFileSync(tmp, '# Title\n\nUpdated externally, atomic rename.\n')
    fs.renameSync(tmp, docPath)
    await expect
      .poll(() => editorText(window), { timeout: WATCH_DELAY })
      .toContain('Updated externally, atomic rename.')
    await expect(notificationBar(window)).toBeHidden()
  })

  test('dirty buffer + external change shows the conflict bar and clobbers nothing', async () => {
    // Make the buffer dirty by typing into the editor.
    await window.locator('#ag-editor-id p').first().click()
    await window.keyboard.press('End')
    await window.keyboard.type(' LOCAL-EDIT')
    await expect.poll(() => editorText(window)).toContain('LOCAL-EDIT')

    // External change while dirty.
    fs.writeFileSync(docPath, '# Title\n\nExternal change while buffer dirty.\n')

    // The bar must appear with both choices.
    await expect(notificationBar(window)).toBeVisible({ timeout: WATCH_DELAY })
    await expect(window.getByText('Reload from disk')).toBeVisible()
    await expect(window.getByText('Keep my version')).toBeVisible()

    // Neither side clobbered: buffer still has the local edit...
    expect(await editorText(window)).toContain('LOCAL-EDIT')
    // ...and disk still has the external version (no autosave overwrote it).
    await sleep(1500)
    expect(fs.readFileSync(docPath, 'utf-8')).toContain('External change while buffer dirty.')
  })

  test('choosing "Reload from disk" loads the external version and clears the bar', async () => {
    await window.getByText('Reload from disk').click()
    await expect
      .poll(() => editorText(window), { timeout: WATCH_DELAY })
      .toContain('External change while buffer dirty.')
    expect(await editorText(window)).not.toContain('LOCAL-EDIT')
    await expect(notificationBar(window)).toBeHidden()
  })

  test('dirty buffer + "Keep my version" keeps the buffer; next save overwrites disk', async () => {
    await window.locator('#ag-editor-id p').first().click()
    await window.keyboard.press('End')
    await window.keyboard.type(' KEEP-ME')
    await expect.poll(() => editorText(window)).toContain('KEEP-ME')

    fs.writeFileSync(docPath, '# Title\n\nAnother external change.\n')
    await expect(notificationBar(window)).toBeVisible({ timeout: WATCH_DELAY })

    await window.getByText('Keep my version').click()
    await expect(notificationBar(window)).toBeHidden()
    expect(await editorText(window)).toContain('KEEP-ME')

    // The user chose their version: an explicit save now overwrites disk.
    await triggerSave(electronApp)
    await expect
      .poll(() => fs.readFileSync(docPath, 'utf-8'), { timeout: WATCH_DELAY })
      .toContain('KEEP-ME')
  })

  test('saving from the app does not cause a reload loop or a change bar', async () => {
    await window.locator('#ag-editor-id p').first().click()
    await window.keyboard.press('End')
    await window.keyboard.type(' SELF-SAVE')
    await triggerSave(electronApp)

    await expect
      .poll(() => fs.readFileSync(docPath, 'utf-8'), { timeout: WATCH_DELAY })
      .toContain('SELF-SAVE')

    // Give the watcher time to emit the echo of our own save, then verify the
    // buffer was neither reloaded away nor flagged as an external change.
    await sleep(WATCH_DELAY)
    expect(await editorText(window)).toContain('SELF-SAVE')
    await expect(notificationBar(window)).toBeHidden()
  })
})
