/** Real UI admission and reload: wrong suffixes corrupt subsequent model requests. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT } from './support.ts'

describe('web message edit and last-turn regeneration', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  const requests: GenerateOptions[] = []
  const shots = join(REPO_ROOT, 'output/playwright/message-restart')

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      replayFixture: join(REPO_ROOT, 'snapshots/web/fresh-round-trip/session.v3.jsonl'),
      replayOverride: join(REPO_ROOT, 'apps/web/tests/fixtures/message-restart.override.json'),
      compareReplaySession: false,
    })
    scaffold.ctx.on('llm/stream', (request, next) => {
      requests.push(request)
      return next()
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await mkdir(shots, { recursive: true })
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('edits an earlier input, retries only the last response, and keeps the branch after reload', async () => {
    const send = async (text: string) => {
      const settled = scaffold.whenTurnSettled()
      await page.locator('[data-composer-input]').first().fill(text)
      await page.locator('[data-composer-input]').first().press('Enter')
      await settled
    }
    await send('original question')
    await send('later question')
    await expect.poll(() => page.getByRole('button', { name: 'Edit message', exact: true }).count()).toBe(2)
    expect(await page.getByRole('button', { name: 'Regenerate', exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: 'Edit message', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Edit message', exact: true }).fill('edited question')
    await page.screenshot({ path: join(shots, 'edit-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 780, height: 900 })
    await page.screenshot({ path: join(shots, 'edit-dark-narrow.png') })
    let settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: 'Save and resend', exact: true }).click()
    const sessionId = await settled
    await expect.poll(() => page.getByRole('button', { name: 'Edit message', exact: true }).count()).toBe(1)
    await expect.poll(() => page.getByText('EDITED_REPLY', { exact: true }).isVisible()).toBe(true)
    expect(JSON.stringify(requests[2]?.messages)).toContain('edited question')
    expect(JSON.stringify(requests[2]?.messages)).not.toMatch(/original question|later question|FIRST_REPLY|LATER_REPLY/)

    settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
    await settled
    await expect.poll(() => page.getByText('fixture request rejected', { exact: true }).isVisible()).toBe(true)
    settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
    await settled
    await expect.poll(() => page.getByText('RECOVERED_REPLY', { exact: true }).isVisible()).toBe(true)
    expect(requests).toHaveLength(5)
    expect(JSON.stringify(requests[4]?.messages)).not.toMatch(/EDITED_REPLY|fixture request rejected/)
    await page.reload()
    await expect.poll(() => page.getByText('RECOVERED_REPLY', { exact: true }).isVisible(), { timeout: 15_000 }).toBe(true)
    expect(await page.getByText('Failed', { exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Edit message', exact: true }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Regenerate', exact: true }).count()).toBe(1)
    expect(scaffold.ctx.agents.get(sessionId)?.session.deriveMessages().filter(message => message.role !== 'system')
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .filter(text => /question|_REPLY/.test(text))).toEqual(['edited question', 'RECOVERED_REPLY'])
    await page.screenshot({ path: join(shots, 'recovered-dark.png') })
  })
})
