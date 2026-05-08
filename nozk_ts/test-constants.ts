/**
 * Shared constants for integration and e2e tests.
 *
 * All private keys here are **well-known deterministic test keys** from Foundry's
 * default anvil mnemonic. They are NOT real secrets — every developer using anvil
 * has the same keys. They are published in Foundry's documentation:
 * https://book.getfoundry.sh/reference/anvil/
 *
 * Mnemonic: test test test test test test test test test test test junk
 */

import type { Address } from 'viem';

// ==============================================================================
// Network
// ==============================================================================

export const ANVIL_RPC = 'http://127.0.0.1:8545' as const;
export const CHAIN_ID = 31337;

// ==============================================================================
// Anvil default accounts
// Derived from: test test test test test test test test test test test junk
// ==============================================================================

/** Account 0 — deployer + mint authority */
export const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const; // gitleaks:allow

/** Account 1 — depositor / user wallet */
export const DEPOSITOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const; // gitleaks:allow

/** Account 3 — ETH recipient for redeem tests */
export const RECIPIENT = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address;

/** Account 0 address (derived from DEPLOYER_KEY) */
export const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

// ==============================================================================
// Test mint keypair (BLS12-381)
// ==============================================================================

export const MINT_SK = 42n;
