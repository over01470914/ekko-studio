import { test, expect, _electron as electron } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { personalAgentMessages } from '../../packages/client/src/modules/studio-extensions/personal-agent/messages'
const m = personalAgentMessages.en
const base = '/api/studio/personal-agent'
// Explicit opt-in: real packaged macOS GUI + native OpenPanel. No mock file service or synthetic UI reply.
test('packaged native gateway: honest central state, actual folder approval and target-bound file loop', async () => {
  test.skip(process.platform !== 'darwin' || process.env.PA02_NATIVE_E2E !== '1', 'Requires opt-in native macOS artifact/AX approval; not a browser substitute')
  const evidence = resolve('dist/personal-lab/evidence'); const folder = join(evidence, 'selected-folder')
  mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'same.txt'), 'PA02 controlled native fixture')
  const executablePath = resolve('dist/personal-lab/package/mac-arm64/Ekko Personal Lab.app/Contents/MacOS/Ekko Personal Lab')
  const app = await electron.launch({ executablePath, env: { HOME: process.env.HOME!, PATH: process.env.PATH!, TMPDIR: process.env.TMPDIR!, LANG: 'en_US.UTF-8' }, timeout: 30000 })
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => { localStorage.setItem('personal_locale', 'en'); localStorage.removeItem('studio_entry_mode') }); await page.reload()
    await page.setViewportSize({ width: 1440, height: 1000 }); await expect(page.locator('.mode-chooser')).toBeVisible()
    await page.screenshot({ path: join(evidence, 'native-chooser-1440x1000.png') })
    await page.locator('.mode-chooser').getByRole('button', { name: m.personal, exact: true }).click()
    await expect(page.getByText(m.notConnected, { exact: true })).toBeVisible(); await expect(page.getByText(m.empty, { exact: true })).toBeVisible()
    await page.screenshot({ path: join(evidence, 'native-unconfigured-1440x1000.png') })
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, 'native-unconfigured-390x844.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    // Guide only the initial directory. The real OS dialog still decides the selected folder and requires AXPress approval.
    await app.evaluate(({ dialog }, folder) => { const original = dialog.showOpenDialog.bind(dialog); dialog.showOpenDialog = ((window: any, options: any) => original(window, { ...options, defaultPath: folder })) as typeof dialog.showOpenDialog }, folder)
    await page.getByRole('button', { name: m.chooseFolder, exact: true }).click()
    const modal = page.locator('.personal-modal'); await modal.getByLabel(m.workspace, { exact: true }).fill('PA02 controlled fixture')
    await modal.getByRole('checkbox', { name: 'write', exact: true }).check(); await modal.getByRole('checkbox', { name: 'delete', exact: true }).check()
    const dialogOpened = app.waitForEvent('window', { timeout: 2000 }).catch(() => null)
    await modal.getByRole('button', { name: m.chooseFolder, exact: true }).click(); await dialogOpened
    // Uses AX actions in the named Lab process only. No keystrokes/focus transfer, credentials, or system permission dialog.
    const nativePid = await app.evaluate(() => process.pid)
    const axScript = `tell application "System Events"
set owners to every process whose unix id is ${nativePid}
set owners to owners & (every process whose bundle identifier is "com.apple.appkit.xpc.openAndSavePanelService")
repeat with owner in owners
repeat with nativeWindow in windows of owner
if name of nativeWindow is "Ekko Personal Lab" then
try
set panel to sheet 1 of nativeWindow
on error
set panel to nativeWindow
end try
try
set confirmButton to value of attribute "AXDefaultButton" of panel
perform action "AXPress" of confirmButton
return "real Lab OpenPanel approved"
end try
end if
end repeat
end repeat
error "Lab native chooser is not exposed through AX"
end tell`
    execFileSync('/usr/bin/osascript', ['-e', axScript], { timeout: 15000 })
    await expect(modal).not.toBeVisible({ timeout: 20000 })
    await page.locator('.n-base-selection').click(); await page.locator('.n-base-select-option').filter({ hasText: 'PA02 controlled fixture' }).click()
    await page.getByLabel(m.search, { exact: true }).fill('same'); await page.getByRole('button', { name: m.search, exact: true }).click()
    await page.getByRole('button', { name: 'same.txt', exact: true }).click(); await expect(page.getByLabel(m.content, { exact: true })).toHaveValue('PA02 controlled native fixture')
    await page.getByLabel(m.path, { exact: true }).fill('created.txt'); await page.getByLabel(m.content, { exact: true }).fill('native receiving-side readback')
    await page.getByRole('button', { name: m.create, exact: true }).click()
    await expect.poll(() => existsSync(join(folder, 'created.txt'))).toBe(true)
    expect(readFileSync(join(folder, 'created.txt'), 'utf8')).toBe('native receiving-side readback')
    await page.getByLabel(m.content, { exact: true }).fill('verified replacement')
    await page.getByRole('button', { name: m.overwrite, exact: true }).click()
    await expect.poll(() => readFileSync(join(folder, 'created.txt'), 'utf8')).toBe('verified replacement')
    await page.getByRole('button', { name: m.remove, exact: true }).click()
    await expect(modal).toContainText('created.txt'); await expect(modal).toContainText('SHA-256')
    await page.screenshot({ path: join(evidence, 'native-delete-confirmation-1440x1000.png') })
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, 'native-delete-confirmation-390x844.png') })
    await modal.getByRole('button', { name: m.confirm, exact: true }).click()
    await expect.poll(() => existsSync(join(folder, 'created.txt'))).toBe(false)
    await page.getByRole('button', { name: m.restore, exact: true }).click()
    await expect.poll(() => existsSync(join(folder, 'created.txt'))).toBe(true)
    expect(readFileSync(join(folder, 'created.txt'), 'utf8')).toBe('verified replacement')
    await page.screenshot({ path: join(evidence, 'native-restored-390x844.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: join(evidence, 'native-restored-1440x1000.png') })
    const state = await page.evaluate(async base => (await fetch(base + '/state')).json(), base)
    expect(JSON.stringify(state)).not.toContain(folder); expect(state.workspaces).toHaveLength(1)
    await page.getByRole('button', { name: m.revoke, exact: true }).click(); await expect(page.getByRole('button', { name: m.create, exact: true })).toBeDisabled()
    await page.locator('.page-header').getByRole('button', { name: m.workbench, exact: true }).click(); await expect(page.locator('.files-card')).toHaveCount(0)
    await page.reload(); await expect(page.locator('.conversation')).toBeVisible(); await expect(page.locator('.mode-chooser')).toHaveCount(0)
    const identity = await app.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion(), userData: app.getPath('userData'), packaged: app.isPackaged }))
    writeFileSync(join(evidence, 'native-verification.json'), JSON.stringify({ mode: 'real packaged native Electron, same-machine macOS arm64', identity, realDialog: 'Native OpenPanel with guided defaultPath, AXDefaultButton approval; not mocked', actions: ['search', 'read', 'create', 'hash-bound overwrite', 'hash-bound confirmation/delete', 'restore', 'revoke', 'mode switch/reload'], target: state.workspaces[0], readback: readFileSync(join(folder, 'created.txt'), 'utf8'), noHorizontalOverflow: true, localAgent: false, localBridge: false, liveCentral: 'unverified; no authorization to operate live sessions', signing: 'unsigned/non-notarized' }, null, 2))
  } finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close() }
})
