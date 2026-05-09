/**
 * Smoke test: verify the app loads and renders correctly with the mock wallet.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 *
 * Usage:
 *   cd app && npm run test:e2e
 */

import { test, expect } from '@playwright/test'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69' // 31337

test.describe('App smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await injectMockWallet(page, {
      rpcUrl: ANVIL_RPC,
      chainIdHex: CHAIN_ID_HEX,
      account: MOCK_ACCOUNT_ADDRESS,
    })
  })

  test('app loads and shows the dashboard', async ({ page }) => {
    await page.goto('/')

    // Wait for splash screen to fully disappear (4.8s animation + fade)
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })

    // Now wait for dashboard content
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Add deposit')).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/01-dashboard.png', fullPage: true })
  })

  test('wallet address is visible after connection', async ({ page }) => {
    await page.goto('/')

    // Wait for splash to disappear
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })

    // The navbar wallet button should show the account address
    const addrShort = `${MOCK_ACCOUNT_ADDRESS.slice(0, 6)}...${MOCK_ACCOUNT_ADDRESS.slice(-4)}`
    await expect(page.locator('.wallet-name').first()).toContainText(addrShort, { timeout: 5_000 })

    await page.screenshot({ path: 'e2e/screenshots/02-wallet-connected.png', fullPage: true })
  })

  test('deposit modal opens', async ({ page }) => {
    await page.goto('/')

    // Wait for splash to disappear
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
    const addDepositBtn = page.getByRole('button', { name: /Add deposit/i })
    await expect(addDepositBtn).toBeVisible({ timeout: 5_000 })

    // Click the Add deposit button
    await addDepositBtn.click()

    // Wait for the deposit modal heading (exact match to avoid the button label)
    await expect(page.getByText('ADD DEPOSIT', { exact: true })).toBeVisible({ timeout: 5_000 })

    await page.screenshot({ path: 'e2e/screenshots/03-deposit-modal.png', fullPage: true })
  })

  test('redeem page loads', async ({ page }) => {
    await page.goto('/redeem')

    // Wait for splash to disappear
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })

    await page.screenshot({ path: 'e2e/screenshots/04-redeem-page.png', fullPage: true })

    const bodyText = (await page.textContent('body')) ?? ''
    expect(bodyText.length).toBeGreaterThan(20)
  })
})
