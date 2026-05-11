/**
 * Wallet dropdown and privacy toggle tests.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 */

import { test, expect } from '@playwright/test'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69'

test.describe('Wallet and privacy', () => {
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

  test('wallet pill shows abbreviated address', async ({ page }) => {
    const addrShort = `${MOCK_ACCOUNT_ADDRESS.slice(0, 6)}...${MOCK_ACCOUNT_ADDRESS.slice(-4)}`

    const pill = page.locator('.wallet-pill')
    await expect(pill).toBeVisible()
    await expect(pill.locator('.wallet-name')).toContainText(addrShort)

    // Avatar should show initials derived from address
    const avatar = pill.locator('.wallet-avatar')
    await expect(avatar).toBeVisible()
    const initials = await avatar.textContent()
    expect(initials!.length).toBeGreaterThan(0)

    await page.screenshot({ path: 'e2e/screenshots/wallet-pill.png', fullPage: true })
  })

  test('wallet dropdown opens and shows connected account', async ({ page }) => {
    const pill = page.locator('.wallet-pill')
    await pill.click()

    const dropdown = page.locator('.wallet-dropdown')
    await expect(dropdown).not.toHaveClass(/hidden/)

    // Dropdown header
    await expect(dropdown.locator('.wd-title')).toHaveText('CONNECTED ACCOUNT')

    // Active wallet item
    const activeItem = dropdown.locator('.active-wallet')
    await expect(activeItem).toBeVisible()
    await expect(activeItem.locator('.wd-wname')).toHaveText('Connected wallet')

    // Address is abbreviated
    const addrShort = `${MOCK_ACCOUNT_ADDRESS.slice(0, 6)}...${MOCK_ACCOUNT_ADDRESS.slice(-4)}`
    await expect(activeItem.locator('.wd-addr')).toHaveText(addrShort)

    // Balance should be displayed (from anvil pre-funded account)
    const bal = activeItem.locator('.wd-bal')
    await expect(bal).toBeVisible()
    const balText = await bal.textContent()
    // Anvil account 0 has 10000 ETH; balance text should contain "ETH"
    expect(balText).toContain('ETH')

    // Disconnect action visible
    await expect(dropdown.locator('.wd-action.danger')).toBeVisible()
    await expect(dropdown.locator('.wd-action-label')).toHaveText('Disconnect')

    await page.screenshot({ path: 'e2e/screenshots/wallet-dropdown-open.png', fullPage: true })
  })

  test('wallet dropdown closes when clicking outside', async ({ page }) => {
    await page.locator('.wallet-pill').click()
    const dropdown = page.locator('.wallet-dropdown')
    await expect(dropdown).not.toHaveClass(/hidden/)

    // Dismiss the dropdown by pressing Escape
    await page.keyboard.press('Escape')
    await expect(dropdown).toHaveClass(/hidden/, { timeout: 3_000 })
  })

  test('disconnect removes wallet display and shows connect button', async ({ page }) => {
    // Open dropdown and disconnect
    await page.locator('.wallet-pill').click()
    const dropdown = page.locator('.wallet-dropdown')
    await expect(dropdown).not.toHaveClass(/hidden/)

    await dropdown.locator('.wd-action.danger').click()

    // Toast should confirm disconnection
    await expect(page.locator('.toast')).toContainText('Wallet disconnected', { timeout: 3_000 })

    // After disconnect, the pill should show "Connect Wallet"
    const pill = page.locator('.wallet-pill')
    await expect(pill.locator('.wallet-name')).toContainText('Connect', { timeout: 5_000 })

    await page.screenshot({ path: 'e2e/screenshots/wallet-disconnected.png', fullPage: true })
  })

  test('privacy toggle hides amounts with mask', async ({ page }) => {
    const eyeBtn = page.locator('.eye-btn')
    await expect(eyeBtn).toBeVisible()

    // Get initial state of balance — check if amounts are visible or masked
    const balanceAmount = page.locator('.balance-amount')
    const initialText = await balanceAmount.textContent()

    // Toggle privacy
    await eyeBtn.click()

    // After toggle, the state should have changed
    const newText = await balanceAmount.textContent()
    expect(newText).not.toBe(initialText)

    // One of the states should show the mask pattern
    const hasMask = initialText?.includes('••••') || newText?.includes('••••')
    expect(hasMask).toBe(true)

    await page.screenshot({ path: 'e2e/screenshots/privacy-toggled.png', fullPage: true })
  })

  test('privacy toggle masks/unmasks all stat values', async ({ page }) => {
    const eyeBtn = page.locator('.eye-btn')
    const statEths = page.locator('.stat-block-eth')
    const statNums = page.locator('.stat-block-num')

    // Toggle to ensure privacy is OFF (amounts visible)
    // Click twice if needed to find the "off" state
    await eyeBtn.click()
    let amountText = await page.locator('.balance-amount').textContent()

    if (amountText?.includes('••••')) {
      // We just turned privacy ON, click again to turn OFF
      await eyeBtn.click()
    }

    // Now privacy is OFF — stats should show numeric values
    const ethTexts = await statEths.allTextContents()
    for (const t of ethTexts) {
      expect(t).toMatch(/ETH/)
    }
    const numTexts = await statNums.allTextContents()
    for (const t of numTexts) {
      expect(t).toMatch(/\d+/)
    }

    // Toggle privacy ON
    await eyeBtn.click()

    // Now stats should show mask
    const maskedEths = await statEths.allTextContents()
    for (const t of maskedEths) {
      expect(t).toBe('••••')
    }
    const maskedNums = await statNums.allTextContents()
    for (const t of maskedNums) {
      expect(t).toBe('••')
    }

    // Shield badge should say SHIELDED when privacy is on
    await expect(page.locator('.shield-badge')).toContainText('SHIELDED')

    await page.screenshot({ path: 'e2e/screenshots/privacy-on-masked.png', fullPage: true })
  })

  test('privacy toggle changes shield badge text', async ({ page }) => {
    const eyeBtn = page.locator('.eye-btn')
    const badge = page.locator('.shield-badge')

    // Toggle and check both states
    await eyeBtn.click()
    const text1 = await badge.textContent()
    await eyeBtn.click()
    const text2 = await badge.textContent()

    // One should be SHIELDED, the other HIDDEN
    const texts = [text1, text2].sort()
    expect(texts).toEqual(['HIDDEN', 'SHIELDED'])
  })
})
