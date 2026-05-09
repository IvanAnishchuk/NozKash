/**
 * Dashboard tests: balance card, stats, activity section, filters.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 */

import { test, expect } from '@playwright/test'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69'

test.describe('Dashboard', () => {
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

  test('balance card shows heading and shield badge', async ({ page }) => {
    const card = page.locator('.balance-card')
    await expect(card).toBeVisible()

    // PRIVATE BALANCE heading
    await expect(card.locator('.balance-label')).toHaveText('PRIVATE BALANCE')

    // Shield badge defaults to SHIELDED (privacy on)
    const badge = card.locator('.shield-badge')
    await expect(badge).toBeVisible()
    // Badge text is either SHIELDED or HIDDEN depending on default privacy state
    const badgeText = await badge.textContent()
    expect(badgeText).toMatch(/SHIELDED|HIDDEN/)

    await page.screenshot({ path: 'e2e/screenshots/dashboard-balance-card.png', fullPage: true })
  })

  test('balance card shows AVAILABLE, PENDING, SPENT stats', async ({ page }) => {
    const card = page.locator('.balance-card')

    // All three stat labels must be present
    await expect(card.locator('.stat-block-label.valid')).toContainText('AVAILABLE')
    await expect(card.locator('.stat-block-label.pending-label')).toContainText('PENDING')
    await expect(card.locator('.stat-block-label.spent')).toContainText('SPENT')

    // With no on-chain activity, counts should be 0 (or masked)
    const statNums = card.locator('.stat-block-num')
    const count = await statNums.count()
    expect(count).toBe(3)

    await page.screenshot({ path: 'e2e/screenshots/dashboard-stats.png', fullPage: true })
  })

  test('add deposit button is visible with network label', async ({ page }) => {
    const btn = page.locator('.add-deposit-btn')
    await expect(btn).toBeVisible()
    await expect(btn.locator('.add-deposit-label')).toHaveText('Add deposit')

    // Should show the sub label with network info
    const sub = btn.locator('.add-deposit-sub')
    await expect(sub).toBeVisible()
    const subText = await sub.textContent()
    expect(subText).toContain('Shield ETH')

    // + MINT badge
    await expect(btn.locator('.add-deposit-badge')).toHaveText('+ MINT')
  })

  test('activity section shows empty state', async ({ page }) => {
    const activity = page.locator('.home-activity-block')
    await expect(activity).toBeVisible()

    // Section title
    await expect(activity.locator('.section-title')).toHaveText('Activity')

    // Wait for scanning to complete, then expect empty state
    await expect(page.getByText('No transactions found')).toBeVisible({ timeout: 30_000 })

    await page.screenshot({ path: 'e2e/screenshots/dashboard-empty-activity.png', fullPage: true })
  })

  test('filter dropdown shows all filter options', async ({ page }) => {
    // Wait for activity to load
    await expect(
      page.getByText(/No transactions found|Loading activity/)
    ).toBeVisible({ timeout: 30_000 })

    const filterBtn = page.locator('.home-filter-btn--toolbar')
    await expect(filterBtn).toBeVisible()
    await expect(filterBtn).toHaveAttribute('aria-label', 'Filter by type')

    // Open filter dropdown
    await filterBtn.click()
    await expect(filterBtn).toHaveAttribute('aria-expanded', 'true')

    const filterPop = page.locator('.home-filter-pop')
    await expect(filterPop).toBeVisible()

    // All filter options
    const expectedFilters = ['All', 'Deposits', 'Revealed', 'Redeems', 'Pending', 'Refunds']
    for (const label of expectedFilters) {
      await expect(filterPop.locator('button', { hasText: label })).toBeVisible()
    }

    // "All" should be active by default
    await expect(filterPop.locator('button.active')).toHaveText('All')

    await page.screenshot({ path: 'e2e/screenshots/dashboard-filter-dropdown.png', fullPage: true })

    // Select a filter and verify it closes + updates active
    await filterPop.locator('button', { hasText: 'Deposits' }).click()
    await expect(filterPop).toBeHidden()

    // Re-open to verify the selection persisted
    await filterBtn.click()
    await expect(page.locator('.home-filter-pop button.active')).toHaveText('Deposits')
  })

  test('date range picker is present in toolbar', async ({ page }) => {
    const dateRange = page.locator('.date-range-pill--toolbar')
    await expect(dateRange).toBeVisible()
  })

  test('page renders full dashboard structure', async ({ page }) => {
    // Verify the overall page structure is intact
    await expect(page.locator('.page-inner--home')).toBeVisible()
    await expect(page.locator('.balance-card')).toBeVisible()
    await expect(page.locator('.add-deposit-btn')).toBeVisible()
    await expect(page.locator('.home-activity-block')).toBeVisible()

    // Navbar elements
    await expect(page.locator('.navbar')).toBeVisible()
    await expect(page.locator('.wallet-pill')).toBeVisible()
    await expect(page.locator('.eye-btn')).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/dashboard-full.png', fullPage: true })
  })
})
