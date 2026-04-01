# Coding Conventions for NozKash

This document defines code style, patterns, and conventions specific to the NozKash codebase.

## Repository-Wide Conventions

### Source of Truth Hierarchy

1. **Cryptography:** `nozk_py/nozk_library.py` is the canonical implementation
2. **Contract ABI:** `abi/NozkVault.json` is the single source
3. **Test vectors:** `test_vectors/manifest.json` defines the authoritative test set
4. **Environment template:** `example.env` is the reference for required variables

### File Organization

- **Crypto primitives:** `nozk_py/nozk_library.py` and `nozk_ts/nozk-library.ts` only
- **Low-level BN254:** `nozk_ts/bn254-crypto.ts` (TypeScript-specific curve operations)
- **Contract logic:** `sol/src/NozkVault.sol` (single file, self-contained)
- **Frontend crypto wrappers:** `app/src/crypto/*.ts` (thin adapters, no implementations)
- **Wallet state:** `.nozk_wallet.json` in Python/TypeScript working directories

### Cross-Language Parity Rules

**CRITICAL:** Python and TypeScript crypto must produce byte-identical results.

#### Mandatory parity checks:
1. Before committing crypto changes, run test vectors in both languages
2. If Python crypto changes, TypeScript MUST be updated in the same commit
3. Test vector generation must pass: `cd nozk_py && uv run generate_vectors.py`
4. Parity tests must pass in both: `uv run pytest test_vectors.py -v` and `npx vitest run`

#### Parity implementation patterns:
- **Hash-to-curve:** Try-and-increment with `keccak256(msg || counter_be32)` (big-endian)
- **Key derivation:** `keccak256(seed || index_be32 || domain_tag)`
- **Point encoding:** Uncompressed format (x, y) as 32-byte big-endian integers
- **G2 point storage:** EIP-197 limb order `[X_imag, X_real, Y_imag, Y_real]`
- **ECDSA message format:** `keccak256("Pay to RAW: " || recipient_address)`

## Python Conventions (`nozk_py/`)

### Code Style

- **Formatter:** Ruff with 120-char line length, double quotes
- **Type hints:** Mandatory on all public functions (enforced by `ty` typechecker)
- **Imports:** Sorted by ruff (stdlib, third-party, local)
- **Docstrings:** Required for crypto functions, explain parameters and return values

### Python-Specific Patterns

```python
# Type hints for elliptic curve points
G1Point = tuple[int, int]  # (x, y) on BN254 G1
G2Point = tuple[tuple[int, int], tuple[int, int]]  # ((x_im, x_re), (y_im, y_re))

# Byte conversion (always big-endian)
def int_to_bytes32(n: int) -> bytes:
    return n.to_bytes(32, byteorder="big")

# Hash-to-curve pattern
def hash_to_g1(message: bytes) -> G1Point:
    counter = 0
    while counter < 1000:
        candidate = keccak256(message + counter.to_bytes(4, "big"))
        if point := try_decode_g1(candidate):
            return point
        counter += 1
    raise ValueError("Hash-to-curve failed")

# Error handling in CLI
import typer
try:
    result = perform_operation()
except Exception as e:
    typer.echo(f"Error: {e}", err=True)
    raise typer.Exit(code=1)
```

### Testing Patterns

```python
# Test naming: test_<function_name>_<scenario>
def test_blind_sign_roundtrip():
    """Test that blinding and unblinding preserve signature."""
    pass

# Fixtures for shared setup
import pytest

@pytest.fixture
def mint_keypair():
    sk, pk = generate_mint_keypair()
    return sk, pk

# Use test vectors for cross-language tests
def test_against_vectors():
    # Python tests auto-discover vectors by scanning test_vectors/ directory
    vectors_dir = Path(__file__).parent.parent / "test_vectors"
    for keypair_dir in vectors_dir.iterdir():
        if keypair_dir.is_dir():
            # Load and verify vectors
            pass
```

### Crypto Function Documentation

```python
def blind_token(spend_addr: str, blinding_factor: int) -> G1Point:
    """
    Blind a token for deposit.
    
    Args:
        spend_addr: Ethereum address (0x-prefixed hex string)
        blinding_factor: Random scalar in Fr (BN254 scalar field)
    
    Returns:
        Blinded G1 point B = r · H_G1(spend_addr)
    
    Raises:
        ValueError: If spend_addr is invalid or hash-to-curve fails
    """
    pass
```

## TypeScript Conventions (`nozk_ts/`, `app/`)

### Code Style

- **Formatter:** Biome with default settings
- **Type safety:** Strict TypeScript with `noEmit` checks
- **Imports:** Use explicit `.ts` extensions for local imports
- **Naming:** camelCase for functions/variables, PascalCase for types

### TypeScript-Specific Patterns

```typescript
// Type definitions for points
type G1Point = { x: bigint; y: bigint };
type G2Point = {
  x: { re: bigint; im: bigint };
  y: { re: bigint; im: bigint };
};

// Byte conversion (always big-endian)
function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  return hexToBytes(hex);
}

// Hash-to-curve pattern (match Python exactly)
function hashToG1(message: Uint8Array): G1Point {
  for (let counter = 0; counter < 1000; counter++) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false); // big-endian
    const candidate = keccak256(concat([message, counterBytes]));
    const point = tryDecodeG1(candidate);
    if (point) return point;
  }
  throw new Error('Hash-to-curve failed');
}

// Error handling in CLI
try {
  const result = await performOperation();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
```

### React Patterns (`app/`)

```typescript
// Context for wallet state
export const WalletContext = createContext<WalletState | null>(null);

// Never persist master seed
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within WalletProvider');
  return context;
}

// Import crypto via alias (never copy implementations)
import { deriveTokenSecrets, blindToken } from '@nozk/nozk-library';

// Component organization
app/src/
  components/     # Reusable UI components
  crypto/         # Thin wrappers over @nozk/ (no implementations)
  hooks/          # React hooks
  lib/            # Utilities (event scanner, etc.)
  pages/          # Route components
```

### Testing Patterns

```typescript
// Test naming: describe + it pattern
describe('blindToken', () => {
  it('produces same result as Python', () => {
    // Load test vector and compare
  });
});

// Use test vectors
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';

describe('cross-language parity', () => {
  // TypeScript tests auto-discover vectors by scanning test_vectors/ directory
  const vectorDirs = readdirSync('test_vectors', { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const keypairDir of vectorDirs) {
    it(`verifies ${keypairDir}`, async () => {
      // Load vectors and verify
    });
  }
});
```

## Solidity Conventions (`sol/`)

### Code Style

- **Formatter:** `forge fmt` (Foundry default)
- **Solidity version:** `^0.8.19` (consistent across all contracts)
- **Imports:** Relative paths, organized by source (library vs contract)
- **Naming:** PascalCase for contracts, camelCase for functions, UPPER_CASE for constants

### Solidity-Specific Patterns

```solidity
// G1/G2 point representation (matches EVM precompile format)
struct G1Point {
    uint256 x;
    uint256 y;
}

struct G2Point {
    uint256 x_imag;
    uint256 x_real;
    uint256 y_imag;
    uint256 y_real;
}

// Precompile usage
function callEcPairing(
    uint256[2] memory a1,
    uint256[4] memory a2,
    uint256[2] memory b1,
    uint256[4] memory b2
) private view returns (bool) {
    uint256[12] memory input;
    // Pack points...
    (bool success, bytes memory output) = address(0x08).staticcall(
        abi.encodePacked(input)
    );
    require(success, "Pairing check failed");
    return abi.decode(output, (bool));
}

// Error handling
error InvalidSignature();
error AlreadySpent();
error InsufficientDeposit();

// Use custom errors instead of revert strings
if (spentNullifiers[nullifier]) revert AlreadySpent();
```

### Testing Patterns

```solidity
// Test contract naming: <Contract>Test
contract NozkVaultTest is Test {
    NozkVault public vault;
    
    function setUp() public {
        // Fork Sepolia for realistic precompiles
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));
        vault = new NozkVault(...);
    }
    
    // Test naming: test_<function>_<scenario>
    function test_deposit_success() public {
        // Arrange
        address depositId = address(0x123);
        uint256[2] memory B = [uint256(1), uint256(2)];
        
        // Act
        vault.deposit{value: 0.01 ether}(depositId, B);
        
        // Assert
        assertEq(vault.deposits(depositId).x, B[0]);
    }
    
    // Test reverts
    function testFail_deposit_insufficientValue() public {
        vault.deposit{value: 0.001 ether}(address(0x123), [uint256(1), uint256(2)]);
    }
}
```

### Gas Optimization

- Prefer `uint256` over smaller types (no packing benefits in most cases)
- Use `calldata` for read-only array parameters
- Mark functions `external` if not called internally
- Use custom errors instead of string reverts
- Avoid loops where possible (fixed-size operations only)

## Environment Variables

### Naming Convention

- **Public addresses:** `<NAME>_ADDRESS` (e.g., `WALLET_ADDRESS`)
- **Private keys:** `<NAME>_KEY` or `<NAME>_PRIVATE_KEY`
- **BLS keys:** `MINT_BLS_PRIVKEY`, `MINT_BLS_PUBKEY`
- **RPC endpoints:** `RPC_HTTP_URL`, `RPC_WS_URL`
- **Frontend:** Prefix with `VITE_` for Vite exposure

### Environment Files

- **Repository root:** `example.env` (template, committed)
- **Component roots:** `.env` (actual secrets, gitignored)
- **Frontend:** `app/.env` (gitignored) and `app/.env.example` (template)

## Testing Conventions

### Test Organization

```
nozk_py/
  nozk_library_test.py      # Unit tests for crypto primitives
  test_vectors.py           # Cross-language parity tests
  nozk_tip_test.py          # End-to-end integration test
  mock_test.py              # Offline mock test

nozk_ts/
  unit.test.ts              # Unit tests (basic sanity)
  test-vectors.test.ts      # Cross-language parity tests
  test.ts                   # End-to-end integration test

sol/test/
  NozkVault.t.sol           # Contract tests (Foundry)
```

### Test Vector Format

```json
{
  "description": "Test case for key derivation",
  "inputs": {
    "master_seed": "0x...",
    "index": 0
  },
  "expected": {
    "spend_priv": "0x...",
    "spend_addr": "0x...",
    "blind_priv": "0x..."
  }
}
```

### Running Tests Before Commit

```bash
# Python
cd nozk_py && uv run ruff check . && uv run pytest -v

# TypeScript
cd nozk_ts && npx biome check . && npx tsc --noEmit && npx vitest run

# Solidity
cd sol && forge fmt && forge test

# Frontend
cd app && npm run lint && npm run build
```

## Git Conventions

### Commit Messages

- Format: `<component>: <description>`
- Components: `py`, `ts`, `sol`, `app`, `docs`, `ci`, `test`
- Examples:
  - `py: add derive_token_secrets function`
  - `sol: optimize ecPairing gas cost`
  - `test: add cross-language vector for blinding`
  - `app: implement deposit flow UI`

### Branch Strategy

- `main` — stable, all CI passing
- Feature branches: `<username>/<feature-name>`
- No direct commits to `main` (use PRs)

### Files to Never Commit

- `.env` (secrets)
- `.nozk_wallet.json` (wallet state)
- `node_modules/`, `.venv/`, `__pycache__/`
- Private keys, mnemonics, seeds
- `out/`, `cache/`, `broadcast/` (Foundry artifacts)

## Documentation Conventions

### Code Comments

- **Minimal comments:** Code should be self-documenting
- **Comment when:** Complex crypto math, non-obvious optimizations, security considerations
- **Don't comment:** Obvious operations, type signatures (use type hints instead)

### README Updates

- Update component READMEs when adding features
- Keep command examples working (test them)
- Document any new environment variables

### AI Assistant Files

- **CLAUDE.md** — Claude-specific guidance
- **.github/copilot-instructions.md** — GitHub Copilot guidance
- **AGENTS.md** — Codex/Jules/OpenCode guidance (this file)
- **CONVENTIONS.md** — Code style and patterns (this file)

Keep all four files in sync when architecture changes.

## Security Practices

### Key Management

- Generate keys with: `cd nozk_py && uv run generate_keys.py`
- Derive BLS from ETH key: `uv run derive_bls.py 0x<privkey>`
- Never log or print private keys
- Use environment variables, never hardcode

### Cryptographic Hygiene

- Always use cryptographically secure random for blinding factors
- Verify all inputs before cryptographic operations
- Use constant-time operations where available
- Test against malformed inputs (fuzzing recommended)

### Smart Contract Security

- Check nullifier double-spend before state changes
- Validate all ecrecover results (check != address(0))
- Ensure pairing checks pass before ETH transfers
- Reentrancy: not a concern (no callbacks, single ETH transfer at end)

## Performance Guidelines

### Gas Targets

- `deposit()`: 50k gas (target, locks 0.001 ETH)
- `announce()`: 55k gas (target)
- `redeem()`: 120k gas (target, transfers 0.001 ETH)
- `refund()`: ~30k gas (only if mint never fulfilled)

Run `forge snapshot` after contract changes and verify no regressions.

### Off-Chain Performance

- Event scanning: batch `eth_getLogs` in ~2048 block chunks
- Rate limiting: respect RPC limits (use retry with exponential backoff)
- Crypto operations: pre-compute when possible (e.g., mint pubkey in G2)

## Common Patterns

### Deriving Token Secrets

```python
# Python
master_seed = bytes.fromhex(os.environ["MASTER_SEED"].removeprefix("0x"))
spend_priv, blind_priv, deposit_id = derive_token_secrets(master_seed, index=0)
spend_addr = private_key_to_address(spend_priv)
```

```typescript
// TypeScript
const masterSeed = hexToBytes(process.env.MASTER_SEED!.slice(2));
const { spendPriv, blindPriv, depositId } = deriveTokenSecrets(masterSeed, 0);
const spendAddr = privateKeyToAddress(spendPriv);
```

### Loading Contract ABI

```python
# Python
abi_path = Path(__file__).parent.parent / "abi" / "nozk_vault_abi.json"
with open(abi_path) as f:
    abi = json.load(f)
```

```typescript
// TypeScript
import abi from '../../abi/nozk_vault_abi.json';
```

### Error Handling in CLI

- Exit with code 1 on errors
- Print errors to stderr
- Use colored output for UX (Python: `typer.style`, TypeScript: check terminal support)

## Troubleshooting Patterns

### Crypto Mismatch Debugging

1. Compare test vectors: are inputs identical?
2. Check endianness: all multi-byte values are big-endian
3. Verify keccak256: inputs must be byte-for-byte identical
4. Check point encoding: uncompressed (x, y) format
5. Verify field arithmetic: operations in Fr vs Fq vs Fq2

### Contract Revert Debugging

1. Use `forge test -vvvv` for full traces
2. Check custom error selectors: `cast sig "ErrorName()"`
3. Verify precompile success: all calls to 0x06/0x07/0x08 must succeed
4. Check msg.value: deposit requires exactly 0.01 ETH

### RPC Issues

- Use public nodes for testing, private/Alchemy/Infura for production
- Implement retry logic with exponential backoff
- Handle rate limits gracefully (429 responses)
- Fork Sepolia in tests to avoid RPC dependency
