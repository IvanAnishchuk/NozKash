/**
 * Recovery page: rendering, form elements, scan, back navigation.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 */

import { test, expect } from '@playwright/test'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69'

test.describe('Recovery page', () => {
  test.beforeAll(async () => {
    await fetch(ANVIL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_reset', params: [] }),
    })
  })

  test.beforeEach(async ({ page }) => {
    await injectMockWallet(page, {
      rpcUrl: ANVIL_RPC,
      chainIdHex: CHAIN_ID_HEX,
      account: MOCK_ACCOUNT_ADDRESS,
    })
    await page.goto('/recovery')
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
  })

  test('page renders with RECOVERY title and network label', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    // Subtitle mentions NozkVault reads via RPC
    const sub = page.locator('.modal-sub-label').first()
    await expect(sub).toBeVisible()
    const subText = await sub.textContent()
    expect(subText).toContain('NozkVault reads via RPC')

    await page.screenshot({ path: 'e2e/screenshots/recovery-page.png', fullPage: true })
  })

  test('back link navigates to dashboard', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    const backLink = page.locator('.import-back')
    await expect(backLink).toBeVisible()
    await expect(backLink).toContainText('Back')

    await backLink.click()

    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })
    expect(page.url()).toMatch(/\/$/)
  })

  test('seed phrase textarea is present with placeholder', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    const textarea = page.locator('.srp-textarea')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveAttribute('placeholder', /BIP39/)
  })

  test('start and end index inputs have default values', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    // Start index label and input
    await expect(page.locator('.type-label').filter({ hasText: 'Start index' })).toBeVisible()
    const startInput = page.locator('input[type="number"]').first()
    await expect(startInput).toHaveValue('0')

    // End index label and input
    await expect(page.locator('.type-label').filter({ hasText: 'End index' })).toBeVisible()
    const endInput = page.locator('input[type="number"]').last()
    await expect(endInput).toHaveValue('99')
  })

  test('index inputs accept custom values', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    const startInput = page.locator('input[type="number"]').first()
    const endInput = page.locator('input[type="number"]').last()

    await startInput.fill('5')
    await endInput.fill('50')

    await expect(startInput).toHaveValue('5')
    await expect(endInput).toHaveValue('50')
  })

  test('Scan Blockchain button is present and clickable', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    const scanBtn = page.locator('.btn-full').filter({ hasText: 'Scan Blockchain' })
    await expect(scanBtn).toBeVisible()
    await expect(scanBtn).toBeEnabled()

    await page.screenshot({ path: 'e2e/screenshots/recovery-ready-to-scan.png', fullPage: true })
  })

  test('scan shows no results for fresh anvil chain', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    const scanBtn = page.locator('.btn-full').filter({ hasText: 'Scan Blockchain' })
    await scanBtn.click()

    // Button should show scanning state
    await expect(
      page.locator('.btn-full').filter({ hasText: /Scanning/ })
    ).toBeVisible({ timeout: 3_000 })

    // Wait for scan to complete — should show no activity found
    await expect(
      page.getByText(/No NozkVault activity/)
    ).toBeVisible({ timeout: 30_000 })

    await page.screenshot({ path: 'e2e/screenshots/recovery-no-results.png', fullPage: true })
  })

  test('explanatory note about env seed is visible', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    // The note about current scan using environment seed
    await expect(
      page.locator('.modal-sub-label').filter({ hasText: /environment seed/ })
    ).toBeVisible()
  })

  test('full page layout is correct', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'RECOVERY' })).toBeVisible({ timeout: 5_000 })

    // Page structure: back link, title, subtitle, textarea, index inputs, note, scan button
    await expect(page.locator('.import-back')).toBeVisible()
    await expect(page.locator('.srp-textarea')).toBeVisible()
    await expect(page.locator('input[type="number"]')).toHaveCount(2)
    await expect(page.locator('.btn-full')).toBeVisible()

    // Navbar should still be visible
    await expect(page.locator('.navbar')).toBeVisible()
    await expect(page.locator('.wallet-pill')).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/recovery-full-layout.png', fullPage: true })
  })
})
