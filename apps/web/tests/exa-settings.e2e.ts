/** Exa settings over the shipped Loader, credential store, and HTTP transport. */
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import type {} from '@deepseek-ai/dsh-web'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

describe('web e2e: integrated Exa settings', () => {
  let server: Server | undefined
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let endpoint: string
  const requests: { path: string; authorization: string | undefined; body: object }[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        requests.push({ path: request.url ?? '', authorization: request.headers.authorization, body: JSON.parse(body) as object })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ results: [{ url: 'https://example.test/article', title: 'Exa result', highlights: ['Original source excerpt'] }] }))
      })
    })
    const listening = once(server, 'listening')
    server.listen(0, '127.0.0.1')
    await listening
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Exa fixture has no TCP address')
    endpoint = `http://127.0.0.1:${address.port}`
    scaffold = await launchWebScaffold({
      exaSearch: { baseURL: endpoint, apiKeyEnv: 'DSH_EXA_GUI_KEY' },
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  })

  afterAll(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally {
        if (server !== undefined) {
          server.closeAllConnections()
          await new Promise<void>((resolve, reject) => server!.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
          }))
        }
      }
    }
  })

  it('saves and rotates an Exa key in the UI, keeps it secret, and immediately searches through Exa', async () => {
    const app = scaffold!
    await expect(app.ctx.web.search({ query: 'not configured' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(requests).toEqual([])
    await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '插件', exact: true }).click()
    const panel = page.locator('[data-plugin-panel]')
    await panel.getByRole('button', { name: '查看 EXA 网页搜索', exact: true }).click()
    const key = panel.getByLabel('API Key', { exact: true })
    await expect.poll(() => key.isEnabled()).toBe(true)
    expect(await key.inputValue()).toBe('')
    const save = panel.getByRole('button', { name: '保存', exact: true })
    for (const value of ['exa-gui-first', 'exa-gui-rotated']) {
      await key.fill(value)
      await save.click()
      await expect.poll(() => save.isDisabled()).toBe(true)
      await panel.getByText('已配置密钥。', { exact: true }).waitFor()
      expect(await key.inputValue()).toBe('')
      await expect(app.ctx.web.search({ query: 'integration search', maxResults: 3 })).resolves.toMatchObject({
        sources: [{ url: 'https://example.test/article', snippet: 'Original source excerpt' }],
      })
    }
    expect(requests).toEqual(['exa-gui-first', 'exa-gui-rotated'].map(value => ({
      path: '/search', authorization: `Bearer ${value}`,
      body: { query: 'integration search', type: 'auto', numResults: 3, contents: { highlights: { highlightsPerUrl: 1 } } },
    })))
    const count = panel.getByLabel('默认结果数量', { exact: true })
    await count.fill('7')
    await save.click()
    await expect.poll(() => save.isDisabled()).toBe(true)
    const document = await readFile(join(app.harnessHome, 'profiles/scaffold/cordis.patch.yml'), 'utf8')
    expect(document).toContain('numResults: 7')
    expect(document).not.toContain('exa-gui-')
    const aria = (await captureStableAria(page, '[data-plugin-panel]', app.workspaceCwd)).replaceAll(endpoint, '{{exaEndpoint}}')
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/exa-settings/configured.expected.md', import.meta.url)), aria, webSnapshotMode())
  })
})
