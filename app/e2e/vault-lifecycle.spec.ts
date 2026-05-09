/**
 * Full vault lifecycle E2E: deploy → deposit → announce → reveal → redeem.
 *
 * Verifies that 0.001 ETH actually lands in the recipient's wallet after redeem.
 * Runs the full BLS12-381 blind signature protocol against a real NozkVaultV2
 * contract on local anvil.
 *
 * Requires: anvil running on localhost:8545 (chain ID 31337 = 0x7a69)
 *           forge build artifacts in sol/out/
 */

import { test, expect } from '@playwright/test'
import { type Address, parseEther } from 'viem'
import {
  deployNozkVault,
  depositAndAnnounce,
  depositAndAnnounceMany,
  revealToken,
  revealBatch,
  revealAggregated,
  redeemToken,
  redeemAggregated,
  getBalance,
  getNullifierState,
  getNullifierId,
  DENOMINATION,
  RECIPIENT,
  DEPOSITOR_KEY,
  publicClient,
  getVaultAddress,
} from './fixtures/contract-setup'
import { injectMockWallet, MOCK_ACCOUNT_ADDRESS } from './fixtures/mock-wallet'
import { privateKeyToAccount } from 'viem/accounts'
import { startMintServer, startRelayerServer, type ServiceHandle } from './fixtures/service-manager'

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID_HEX = '0x7a69'

// Must match VITE_NOZK_MASTER_SEED_HEX in .env.test so the app scanner
// recognises tokens deposited by the test.
const ENV_SEED_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const APP_SEED = Uint8Array.from(ENV_SEED_HEX.match(/.{2}/g)!.map(x => parseInt(x, 16)))

// Separate seed for contract-only tests that don't load the UI (faster, no seed conflict)
const TEST_SEED = new TextEncoder().encode('playwright_e2e_lifecycle_test')

// Anvil accounts not used by test infrastructure
const ACCT4 = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address  // account 3
const ACCT5 = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' as Address  // account 5
const ACCT6 = '0x976EA74026E726554dB657fA54763abd0C3a0aa9' as Address  // account 6
const DEPOSITOR_ADDR = privateKeyToAccount(DEPOSITOR_KEY).address

// ─────────────────────────────────────────────────────────────────────────────
//  Core lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Vault lifecycle E2E', () => {
  test.beforeAll(async () => {
    const addr = await deployNozkVault()
    console.log(`NozkVaultV2 deployed at ${addr}`)
  })

  test('full lifecycle: deposit → announce → reveal → redeem sends 0.001 ETH to recipient', async () => {
    const { S } = await depositAndAnnounce(TEST_SEED, 0)
    await revealToken(TEST_SEED, 0, S)

    const balBefore = await getBalance(RECIPIENT)
    const { nullifierId } = await redeemToken(TEST_SEED, 0, RECIPIENT)
    const balAfter = await getBalance(RECIPIENT)

    expect(balAfter - balBefore).toBe(DENOMINATION)
    expect(await getNullifierState(nullifierId)).toBe(2)
  })

  test('redeem to a different recipient also transfers correct amount', async () => {
    const { S } = await depositAndAnnounce(TEST_SEED, 1)
    await revealToken(TEST_SEED, 1, S)

    const balBefore = await getBalance(ACCT5)
    await redeemToken(TEST_SEED, 1, ACCT5)
    const balAfter = await getBalance(ACCT5)

    expect(balAfter - balBefore).toBe(DENOMINATION)
  })

  test('contract denomination matches expected 0.001 ETH', async () => {
    const denom = await publicClient.readContract({
      address: getVaultAddress(),
      abi: (await import('./fixtures/contract-setup')).getAbi(),
      functionName: 'DENOMINATION',
    })
    expect(denom).toBe(DENOMINATION)
  })

  test('app UI shows deposited token in activity feed after deposit + announce', async ({ page }) => {
    // Use APP_SEED so the app recognises these tokens
    const { S } = await depositAndAnnounce(APP_SEED, 0)

    await injectMockWallet(page, {
      rpcUrl: ANVIL_RPC,
      chainIdHex: CHAIN_ID_HEX,
      account: MOCK_ACCOUNT_ADDRESS,
    })
    await page.goto('/')
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })

    // Wait for the scanner to find the deposit + mint fulfilled events
    await expect(page.getByText(/mint fulfilled/i)).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: 'e2e/screenshots/vault-after-deposit.png', fullPage: true })

    // Verify balance reflects the token
    await expect(page.getByText('PENDING')).toBeVisible()
  })

  test('app UI shows revealed token as ready to redeem', async ({ page }) => {
    // Token 0 was deposited + announced in the previous test; now reveal it
    const secrets0 = await depositAndAnnounce(APP_SEED, 1)
    await revealToken(APP_SEED, 1, secrets0.S)

    await injectMockWallet(page, {
      rpcUrl: ANVIL_RPC,
      chainIdHex: CHAIN_ID_HEX,
      account: MOCK_ACCOUNT_ADDRESS,
    })
    await page.goto('/')
    await expect(page.locator('#splash')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('PRIVATE BALANCE')).toBeVisible({ timeout: 5_000 })

    // Wait for scanner to find revealed token
    await expect(page.getByText(/ready to redeem/i)).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: 'e2e/screenshots/vault-after-reveal.png', fullPage: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Multi-token tests: individual reveal + redeem
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Multi-token individual redeem', () => {
  const SEED = new TextEncoder().encode('multi_individual_redeem')

  test.beforeAll(async () => {
    const addr = await deployNozkVault()
    console.log(`NozkVaultV2 (multi-individual) deployed at ${addr}`)
  })

  test('deposit 3 tokens, redeem each to a different address', async () => {
    const recipients: Address[] = [ACCT4, ACCT5, ACCT6]
    const tokens = await depositAndAnnounceMany(SEED, [0, 1, 2])

    // Reveal each individually
    for (const t of tokens) {
      await revealToken(SEED, t.index, t.S)
    }

    // Snapshot balances before redeem
    const balsBefore = await Promise.all(recipients.map(r => getBalance(r)))

    // Redeem each to its own recipient
    for (let i = 0; i < 3; i++) {
      await redeemToken(SEED, tokens[i].index, recipients[i])
    }

    // Verify each recipient got exactly 0.001 ETH
    const balsAfter = await Promise.all(recipients.map(r => getBalance(r)))
    for (let i = 0; i < 3; i++) {
      expect(balsAfter[i] - balsBefore[i]).toBe(DENOMINATION)
    }

    // Verify all nullifiers are SPENT
    for (const t of tokens) {
      const nid = await getNullifierId(SEED, t.index)
      expect(await getNullifierState(nid)).toBe(2)
    }
  })

  test('deposit 5 tokens, redeem all to same recipient — balance increases by 0.005 ETH', async () => {
    const tokens = await depositAndAnnounceMany(SEED, [10, 11, 12, 13, 14])

    for (const t of tokens) {
      await revealToken(SEED, t.index, t.S)
    }

    const balBefore = await getBalance(ACCT4)

    for (const t of tokens) {
      await redeemToken(SEED, t.index, ACCT4)
    }

    const balAfter = await getBalance(ACCT4)
    expect(balAfter - balBefore).toBe(DENOMINATION * 5n)

    // All SPENT
    for (const t of tokens) {
      const nid = await getNullifierId(SEED, t.index)
      expect(await getNullifierState(nid)).toBe(2)
    }
  })

  test('redeem to own (connected) wallet address — balance increases', async () => {
    const { S } = await depositAndAnnounce(SEED, 20)
    await revealToken(SEED, 20, S)

    const balBefore = await getBalance(DEPOSITOR_ADDR)
    const { receipt } = await redeemToken(SEED, 20, DEPOSITOR_ADDR)
    const balAfter = await getBalance(DEPOSITOR_ADDR)

    // Depositor both pays gas and receives ETH, so:
    // balance_delta = +DENOMINATION - gas_cost
    const gasPrice = receipt.effectiveGasPrice ?? 1000000000n
    const gasCost = receipt.gasUsed * gasPrice
    expect(balAfter - balBefore).toBe(DENOMINATION - gasCost)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Batch reveal tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Batch reveal + individual redeem', () => {
  const SEED = new TextEncoder().encode('batch_reveal_test')

  test.beforeAll(async () => {
    const addr = await deployNozkVault()
    console.log(`NozkVaultV2 (batch-reveal) deployed at ${addr}`)
  })

  test('batch reveal 3 tokens, then redeem each individually', async () => {
    const tokens = await depositAndAnnounceMany(SEED, [0, 1, 2])

    // Single revealBatch call verifies all 3 BLS pairings
    await revealBatch(SEED, tokens.map(t => ({ index: t.index, S: t.S })))

    // Verify all are REVEALED (state=1)
    for (const t of tokens) {
      const nid = await getNullifierId(SEED, t.index)
      expect(await getNullifierState(nid)).toBe(1)
    }

    // Redeem individually to different recipients
    const balBefore4 = await getBalance(ACCT4)
    const balBefore5 = await getBalance(ACCT5)
    const balBefore6 = await getBalance(ACCT6)

    await redeemToken(SEED, 0, ACCT4)
    await redeemToken(SEED, 1, ACCT5)
    await redeemToken(SEED, 2, ACCT6)

    expect(await getBalance(ACCT4) - balBefore4).toBe(DENOMINATION)
    expect(await getBalance(ACCT5) - balBefore5).toBe(DENOMINATION)
    expect(await getBalance(ACCT6) - balBefore6).toBe(DENOMINATION)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Aggregated reveal + aggregated redeem tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Aggregated reveal + aggregated redeem', () => {
  const SEED = new TextEncoder().encode('aggregated_test')

  test.beforeAll(async () => {
    const addr = await deployNozkVault()
    console.log(`NozkVaultV2 (aggregated) deployed at ${addr}`)
  })

  test('aggregated reveal 3 tokens — single pairing check', async () => {
    const tokens = await depositAndAnnounceMany(SEED, [0, 1, 2])

    // Single revealAggregated call: one pairing check for 3 tokens
    await revealAggregated(SEED, tokens.map(t => ({ index: t.index, S: t.S })))

    // All REVEALED
    for (const t of tokens) {
      const nid = await getNullifierId(SEED, t.index)
      expect(await getNullifierState(nid)).toBe(1)
    }
  })

  test('aggregated redeem 3 tokens to single recipient — 0.003 ETH total', async () => {
    // Tokens 0-2 were revealed in the previous test
    const balBefore = await getBalance(ACCT4)

    const { nullifierIds } = await redeemAggregated(SEED, [0, 1, 2], ACCT4)

    const balAfter = await getBalance(ACCT4)
    expect(balAfter - balBefore).toBe(DENOMINATION * 3n)

    // All SPENT
    for (const nid of nullifierIds) {
      expect(await getNullifierState(nid)).toBe(2)
    }
  })

  test('aggregated reveal 5 + aggregated redeem to own wallet', async () => {
    const tokens = await depositAndAnnounceMany(SEED, [10, 11, 12, 13, 14])
    await revealAggregated(SEED, tokens.map(t => ({ index: t.index, S: t.S })))

    const balBefore = await getBalance(DEPOSITOR_ADDR)
    const { receipt, nullifierIds } = await redeemAggregated(SEED, [10, 11, 12, 13, 14], DEPOSITOR_ADDR)
    const balAfter = await getBalance(DEPOSITOR_ADDR)

    const gasPrice = receipt.effectiveGasPrice ?? 1000000000n
    const gasCost = receipt.gasUsed * gasPrice
    expect(balAfter - balBefore).toBe(DENOMINATION * 5n - gasCost)

    for (const nid of nullifierIds) {
      expect(await getNullifierState(nid)).toBe(2)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Mixed flow: some to input address, some to connected wallet
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Mixed recipients: input address + connected wallet', () => {
  const SEED = new TextEncoder().encode('mixed_recipients_test')

  test.beforeAll(async () => {
    const addr = await deployNozkVault()
    console.log(`NozkVaultV2 (mixed) deployed at ${addr}`)
  })

  test('4 tokens: 2 redeemed to external, 2 aggregated-redeemed to self', async () => {
    const tokens = await depositAndAnnounceMany(SEED, [0, 1, 2, 3])

    // Batch reveal all 4
    await revealBatch(SEED, tokens.map(t => ({ index: t.index, S: t.S })))

    // -- Redeem tokens 0, 1 individually to external recipients --
    const bal4Before = await getBalance(ACCT4)
    const bal5Before = await getBalance(ACCT5)

    await redeemToken(SEED, 0, ACCT4)
    await redeemToken(SEED, 1, ACCT5)

    expect(await getBalance(ACCT4) - bal4Before).toBe(DENOMINATION)
    expect(await getBalance(ACCT5) - bal5Before).toBe(DENOMINATION)

    // -- Aggregated redeem tokens 2, 3 to own wallet (connected address) --
    const selfBalBefore = await getBalance(DEPOSITOR_ADDR)
    const { receipt } = await redeemAggregated(SEED, [2, 3], DEPOSITOR_ADDR)
    const selfBalAfter = await getBalance(DEPOSITOR_ADDR)

    const gasPrice = receipt.effectiveGasPrice ?? 1000000000n
    const gasCost = receipt.gasUsed * gasPrice
    expect(selfBalAfter - selfBalBefore).toBe(DENOMINATION * 2n - gasCost)

    // All 4 tokens SPENT
    for (let i = 0; i < 4; i++) {
      const nid = await getNullifierId(SEED, i)
      expect(await getNullifierState(nid)).toBe(2)
    }
  })

  test('contract balance decreases by total redeemed', async () => {
    // Deposit 2 more tokens
    const tokens = await depositAndAnnounceMany(SEED, [10, 11])
    const vaultBalBefore = await getBalance(getVaultAddress())

    // Reveal + redeem both
    for (const t of tokens) {
      await revealToken(SEED, t.index, t.S)
    }
    await redeemToken(SEED, 10, ACCT6)
    await redeemToken(SEED, 11, ACCT6)

    const vaultBalAfter = await getBalance(getVaultAddress())
    expect(vaultBalBefore - vaultBalAfter).toBe(DENOMINATION * 2n)
  })
})
