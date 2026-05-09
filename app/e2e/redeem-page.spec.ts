/**
 * Redeem page: rendering, empty state, form validation, step buttons, navigation.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 */

import { test, expect } from '@playwright/test'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69'

test.describe('Redeem page', () => {
  test.beforeEach(async ({ page }) => {
    await injectMockWallet(page, {
      rpcUrl: ANVIL_RPC,
      chainIdHex: CHAIN_ID_HEX,
      account: MOCK_ACCOUNT_ADDRESS,
    })
    await page.goto('/redeem')
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
  })

  test('page renders with REDEEM title and network label', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    // Subtitle shows network label and MintFulfilled/NullifierRevealed info
    const sub = page.locator('.modal-sub-label').first()
    await expect(sub).toBeVisible()
    const subText = await sub.textContent()
    expect(subText).toContain('MintFulfilled')

    await page.screenshot({ path: 'e2e/screenshots/redeem-page.png', fullPage: true })
  })

  test('back link navigates to dashboard', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    const backLink = page.locator('.import-back')
    await expect(backLink).toBeVisible()
    await expect(backLink).toContainText('Back')

    await backLink.click()

    // Should navigate back to dashboard
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })
    expect(page.url()).toMatch(/\/$/)
  })

  test('shows empty state when no redeemable tokens', async ({ page }) => {
    // Wait for loading to finish
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    // Should show "No deposits with mint fulfilled" when scanner finishes with no results
    await expect(
      page.getByText(/No deposits with mint fulfilled/)
    ).toBeVisible({ timeout: 30_000 })

    await page.screenshot({ path: 'e2e/screenshots/redeem-no-tokens.png', fullPage: true })
  })

  test('destination section shows address input and wallet accounts', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    // Destination section header
    await expect(page.locator('.type-label').filter({ hasText: /Destination/ })).toBeVisible()

    // Address input with placeholder
    const addrInput = page.locator('.flow-field')
    await expect(addrInput).toBeVisible()

    // Wallet account preset button should show the connected account
    const addrShort = `${MOCK_ACCOUNT_ADDRESS.slice(0, 6)}`
    const presetBtn = page.locator('.preset-btn').first()
    if (await presetBtn.isVisible()) {
      const btnText = await presetBtn.textContent()
      expect(btnText).toContain(addrShort)
    }

    // "Choose another account" button
    await expect(
      page.locator('.btn-secondary').filter({ hasText: /Choose another account/ })
    ).toBeVisible()

    // Manual address label
    await expect(
      page.locator('.type-label').filter({ hasText: /Manual address/ })
    ).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/redeem-destination.png', fullPage: true })
  })

  test('two-step flow section with explanation text', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    // Two-step flow heading
    await expect(
      page.locator('.modal-title').filter({ hasText: /Two-step flow/ })
    ).toBeVisible()

    // Explanation mentions Step 1 and Step 2
    const explanationText = await page.locator('.page-inner').textContent()
    expect(explanationText).toContain('Step 1')
    expect(explanationText).toContain('Step 2')
    expect(explanationText).toContain('blind')
    expect(explanationText).toContain('spend')
  })

  test('step 1 button is disabled when no tokens', async ({ page }) => {
    // Wait for loading to finish
    await expect(
      page.getByText(/No deposits with mint fulfilled|Loading/)
    ).toBeVisible({ timeout: 30_000 })

    const step1Btn = page.locator('.btn-secondary').filter({ hasText: /Step 1/ })
    await expect(step1Btn).toBeVisible()
    await expect(step1Btn).toBeDisabled()
  })

  test('step 2 button disabled when no valid recipient', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    const step2Btn = page.locator('.btn-full').filter({ hasText: /Step 2/ })
    await expect(step2Btn).toBeVisible()

    // Clear the recipient input (may be pre-filled with connected account)
    const addrInput = page.locator('.flow-field')
    await addrInput.fill('invalid-address')

    // Step 2 should be disabled with invalid recipient
    await expect(step2Btn).toBeDisabled()
  })

  test('address input accepts valid Ethereum address', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    const addrInput = page.locator('.flow-field')
    const validAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    await addrInput.fill(validAddr)

    const val = await addrInput.inputValue()
    expect(val).toBe(validAddr)

    // Step 2 button should be enabled with valid address (even if no tokens)
    const step2Btn = page.locator('.btn-full').filter({ hasText: /Step 2/ })
    // Note: button may still be disabled due to loading state, but not due to recipient
    await expect(step2Btn).not.toBeDisabled({ timeout: 30_000 })

    await page.screenshot({ path: 'e2e/screenshots/redeem-valid-address.png', fullPage: true })
  })

  test('preset account button fills address input', async ({ page }) => {
    await expect(page.locator('.modal-title').filter({ hasText: 'REDEEM' })).toBeVisible({ timeout: 5_000 })

    // Clear the address input first
    const addrInput = page.locator('.flow-field')
    await addrInput.fill('')

    // Click the preset button for the connected account
    const presetBtn = page.locator('.preset-btn').first()
    if (await presetBtn.isVisible()) {
      await presetBtn.click()

      // Address input should now contain the connected account
      const val = await addrInput.inputValue()
      expect(val.toLowerCase()).toBe(MOCK_ACCOUNT_ADDRESS.toLowerCase())
    }
  })
})
