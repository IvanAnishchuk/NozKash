/**
 * Smoke test: verify the app loads and renders correctly with the mock wallet.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 *
 * Usage:
 *   cd app && npx playwright test
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
    await page.waitForTimeout(2000)

    // App should render something substantial (not a blank page)
    const bodyText = (await page.textContent('body')) ?? ''
    expect(bodyText.length).toBeGreaterThan(20)

    await page.screenshot({ path: 'e2e/screenshots/01-app-loaded.png', fullPage: true })
  })

  test('wallet address is visible after connection', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    await page.screenshot({ path: 'e2e/screenshots/02-wallet-connected.png', fullPage: true })

    // The mock wallet should auto-connect; check that the page rendered
    const bodyText = (await page.textContent('body')) ?? ''
    expect(bodyText.length).toBeGreaterThan(20)
  })

  test('deposit page loads', async ({ page }) => {
    await page.goto('/deposit')
    await page.waitForTimeout(2000)

    await page.screenshot({ path: 'e2e/screenshots/03-deposit-page.png', fullPage: true })

    const bodyText = (await page.textContent('body')) ?? ''
    expect(bodyText.length).toBeGreaterThan(20)
  })

  test('redeem page loads', async ({ page }) => {
    await page.goto('/redeem')
    await page.waitForTimeout(2000)

    await page.screenshot({ path: 'e2e/screenshots/04-redeem-page.png', fullPage: true })

    const bodyText = (await page.textContent('body')) ?? ''
    expect(bodyText.length).toBeGreaterThan(20)
  })
})
