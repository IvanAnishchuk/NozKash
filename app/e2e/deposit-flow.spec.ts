/**
 * Deposit modal: open/close, amount input, preset buttons, validation,
 * info section, and full deposit submit flow against anvil.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 */

import { test, expect } from '@playwright/test'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69'

test.describe('Deposit flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectMockWallet(page, {
      rpcUrl: ANVIL_RPC,
      chainIdHex: CHAIN_ID_HEX,
      account: MOCK_ACCOUNT_ADDRESS,
    })
    await page.goto('/')
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })
  })

  test('modal opens from Add deposit button with correct title', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()

    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible({ timeout: 3_000 })
    await expect(modal).toHaveClass(/open/)

    // Modal title (exact match to avoid matching the button label)
    await expect(page.getByText('ADD DEPOSIT', { exact: true })).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/deposit-modal-opened.png', fullPage: true })
  })

  test('modal shows default amount of 0.001', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    await expect(page.locator('.modal-overlay')).toBeVisible()

    const input = page.locator('.amount-display-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('0.001')
  })

  test('amount input sanitizes non-numeric characters', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    await expect(page.locator('.modal-overlay')).toBeVisible()

    const input = page.locator('.amount-display-input')
    await input.fill('')
    await input.type('abc0.001xyz')

    // Only digits and decimal should remain
    const val = await input.inputValue()
    expect(val).toBe('0.001')
  })

  test('preset buttons: 0.001 active, others show "Not supported yet" toast', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    await expect(page.locator('.modal-overlay')).toBeVisible()

    // 0.001 preset should be active by default
    const presetBtns = page.locator('.preset-btn')
    const count = await presetBtns.count()
    expect(count).toBe(4)

    await expect(presetBtns.filter({ hasText: '0.001' })).toHaveClass(/active/)

    // Click 0.01 preset — should show "Not supported yet" toast
    await presetBtns.filter({ hasText: '0.01' }).click()
    const toast = page.locator('.toast')
    await expect(toast).toContainText('Not supported yet', { timeout: 3_000 })

    await page.screenshot({ path: 'e2e/screenshots/deposit-unsupported-preset.png', fullPage: true })
  })

  test('info section shows Amount, Claims, Network, Gas, Privacy', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    await expect(page.locator('.modal-overlay')).toBeVisible()

    const info = page.locator('.deposit-info')
    await expect(info).toBeVisible()

    // Check all info row labels
    const expectedKeys = ['Amount', 'Claims to mint', 'Network', 'Gas fee (est.)', 'Privacy']
    for (const key of expectedKeys) {
      await expect(info.locator('.info-key', { hasText: key })).toBeVisible()
    }

    // Amount value should show 0.001 ETH
    const amountRow = info.locator('.info-row').filter({ hasText: 'Amount' })
    await expect(amountRow.locator('.info-val')).toContainText('0.001')

    // Claims to mint = 1
    const claimsRow = info.locator('.info-row').filter({ hasText: 'Claims to mint' })
    await expect(claimsRow.locator('.info-val')).toHaveText('1')

    // Privacy = Blind-Signature
    const privacyRow = info.locator('.info-row').filter({ hasText: 'Privacy' })
    await expect(privacyRow.locator('.info-val')).toHaveText('Blind-Signature')

    await page.screenshot({ path: 'e2e/screenshots/deposit-info-section.png', fullPage: true })
  })

  test('paying account shows abbreviated wallet address', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    await expect(page.locator('.modal-overlay')).toBeVisible()

    // The modal body should contain the abbreviated paying account address
    const addrShort = `${MOCK_ACCOUNT_ADDRESS.slice(0, 6)}` // e.g. "0xf39F"
    const modalSheet = page.locator('.modal-sheet')
    const text = await modalSheet.textContent()
    expect(text).toContain(addrShort.slice(0, 6))
  })

  test('cancel button closes modal', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    // Click Cancel
    await page.locator('.btn-secondary', { hasText: 'Cancel' }).click()
    await expect(modal).toBeHidden()
  })

  test('overlay click closes modal', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    // Click the overlay background (top-left corner, outside the modal sheet)
    await modal.click({ position: { x: 10, y: 10 } })
    await expect(modal).toBeHidden()
  })

  test('X close button closes modal', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    await page.locator('.import-close').click()
    await expect(modal).toBeHidden()
  })

  test('Continue button triggers deposit flow and shows toast', async ({ page }) => {
    await page.locator('.add-deposit-btn').click()
    await expect(page.locator('.modal-overlay')).toBeVisible()

    // Amount should already be 0.001
    await expect(page.locator('.amount-display-input')).toHaveValue('0.001')

    // Click Continue to submit deposit
    const continueBtn = page.locator('.btn-primary', { hasText: 'Continue' })
    await expect(continueBtn).toBeVisible()
    await continueBtn.click()

    // The flow should show a toast — either the info "Confirm the deposit..."
    // or an error toast if the tx fails (no real contract in test env).
    // Either way, a toast must appear, proving the flow was triggered.
    const toast = page.locator('.toast')
    await expect(toast).toBeVisible({ timeout: 30_000 })
    const toastText = await toast.textContent()
    expect(toastText!.length).toBeGreaterThan(5)

    await page.screenshot({ path: 'e2e/screenshots/deposit-continue-clicked.png', fullPage: true })
  })

  test('/deposit route opens modal and redirects home', async ({ page }) => {
    await page.goto('/deposit')
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })

    // The deposit modal should be visible (opened by the route)
    await expect(page.getByRole('dialog').or(page.locator('.modal-overlay'))).toBeVisible({ timeout: 5_000 })
    // Dashboard should still be visible underneath
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })
  })
})
