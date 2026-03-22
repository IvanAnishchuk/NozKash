// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GhostVault — Revision D
 * @notice Ingress (deposit), delivery (announce), and egress (redeem) for
 *         fixed-denomination eCash with ECDSA nullifier + BLS pairing on BN254.
 *
 * Key derivation (client-side only — never sent to mint):
 *
 *   base        = keccak256(master_seed ‖ token_index)
 *
 *   spend keypair:
 *     spend_priv = keccak256("spend" ‖ base)   [secp256k1 scalar]
 *     spend_addr = address(spend_priv · G)      [nullifier — revealed only at redeem]
 *
 *   blind keypair:
 *     blind_priv = keccak256("blind" ‖ base)   [secp256k1 scalar → also BN254 scalar r]
 *     blind_addr = address(blind_priv · G)      [depositId — revealed at deposit time]
 *     r          = blind_priv mod BN254_ORDER   [multiplicative blinding factor]
 *
 *   blinded point sent to mint:
 *     B = r · H_G1(spend_addr)
 *
 * Privacy design:
 *   - depositId = blind_addr.  Revealed at deposit but cannot be linked to
 *     spend_addr without the master seed.
 *   - spend_addr never appears on-chain until redeem.
 *   - depositorOf is a private mapping used only for refund authentication.
 *   - announce() is restricted to mintAuthority to prevent scan-DoS.
 *   - S' is emitted in plaintext (safe: useless without r).
 *
 * Off-chain scanning after wallet recovery:
 *   - Deposits:  recompute blind_addr_i from seed; query DepositLocked indexed
 *                by depositId = blind_addr_i directly (O(n) RPC calls, no scan).
 *   - Minted:    fetch MintFulfilled for the matched depositId; unblind locally.
 *   - Redeemed:  call spentNullifiers[spend_addr_i] for each known index.
 *
 * Implementation notes:
 *   - depositId is type address (20 bytes) — matches blind_addr naturally.
 *   - depositCounter removed; no sequential counter needed.
 *   - r = 0 after mod is astronomically unlikely (p ~2^-254) but must be
 *     rejected client-side before calling deposit().
 *   - blind_priv is a secp256k1 scalar reduced mod BN254_ORDER; the small
 *     statistical bias is negligible for this use case but is documented here.
 *   - Front-run griefing on depositId: an observer could register blind_addr
 *     before Alice. Negligible on low-traffic testnet; for mainnet consider
 *     private mempool submission (e.g. Flashbots).
 *
 * Hash-to-G1 (PoC): try-and-increment on **nullifier address only** (20 bytes), matching
 * `ghost_library.hash_to_curve(spend_address_bytes)` — no `blsDomain` prefix.
 *   keccak256(nullifier_20 || be32(counter)) on curve y^2 = x^3 + 3.
 */
contract GhostVault {

    // -- Constants --------------------------------------------------------------

    /// @dev BN254 (alt_bn128) field modulus.
    uint256 internal constant P =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    /// @dev BN254 curve order q.  r = blind_priv mod BN254_ORDER on the client.
    uint256 internal constant BN254_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256 public constant DENOMINATION   = 0.01 ether;
    uint256 public constant MAX_H2C_ITERS  = 65536;
    uint256 public constant REFUND_TIMEOUT = 24 hours;

    // -- State ------------------------------------------------------------------

    /// @dev BLS public key of the Mint on G2 (EIP-197 limb order).
    uint256[4] public pkMint;

    /// @dev Reserved / unused in PoC hash-to-curve (H_G1 uses address only). Kept for ABI compatibility.
    bytes32 public immutable blsDomain;

    /// @dev Address authorised to call announce().  Set to Mint's funded account.
    address public immutable mintAuthority;

    /// @dev Tracks spent nullifiers (spend_addr) to prevent double-spend.
    mapping(address => bool) public spentNullifiers;

    /// @dev depositId (blind_addr) => original depositor.
    ///      Used only for refund authentication.  Never emitted.  Cleared on refund.
    mapping(address => address) internal depositorOf;

    /// @dev depositId (blind_addr) => deposit timestamp.  Used for refund timeout.
    mapping(address => uint256) internal depositedAt;

    /// @dev depositId (blind_addr) => true once MintFulfilled has been emitted.
    ///      Prevents duplicate fulfillments and gates refund eligibility.
    mapping(address => bool) internal announced;

    // -- Events -----------------------------------------------------------------

    /// @dev Emitted when a deposit is locked.
    ///      depositId = blind.address derived from the blind keypair.
    ///      No msg.sender in event.  Clients recover deposits by computing
    ///      blind_addr_i from seed and querying this event by depositId directly.
    event DepositLocked(address indexed depositId, uint256[2] B);

    /// @dev Emitted by the Mint after blind signing.
    ///      S' is safe in plaintext — useless without the blinding factor r.
    event MintFulfilled(address indexed depositId, uint256[2] S_prime);

    /// @dev Emitted when a deposit is refunded after timeout.
    event DepositRefunded(address indexed depositId);

    // -- Errors -----------------------------------------------------------------

    error InvalidValue();
    error InvalidECDSA();
    error AlreadySpent();
    error InvalidBLS();
    error InvalidSignatureLength();
    error EthSendFailed();
    error HashToCurveFailed();
    error NotMintAuthority();
    error DepositNotFound();
    error DepositIdAlreadyUsed();
    error AlreadyFulfilled();
    error RefundTooEarly();
    error NotDepositor();
    error InvalidDepositId();

    // -- Constructor ------------------------------------------------------------

    constructor(
        uint256[4] memory pkMint_,
        bytes32           blsDomain_,
        address           mintAuthority_
    ) {
        pkMint        = pkMint_;
        blsDomain     = blsDomain_;
        mintAuthority = mintAuthority_;
    }

    // -- External: deposit ------------------------------------------------------

    /**
     * @notice Lock 0.01 ETH and register a mint request.
     *
     * @param depositId      blind.address — the Ethereum address derived from the
     *                       blind keypair private key.  Acts as the unique deposit
     *                       identifier.  Revealed on-chain but cannot be linked to
     *                       spend_addr without the master seed.
     * @param blindedPointB  G1 point B = r * H_G1(spend_addr).
     *                       r = blind_priv mod BN254_ORDER.
     *                       The Mint signs this and returns S' via announce().
     *
     * Requirements:
     *   - Exactly 0.01 ETH attached.
     *   - depositId must not be address(0).
     *   - depositId must not already be registered (one deposit per blind keypair).
     *
     * Note on front-run griefing: a mempool observer could submit the same
     * depositId with a garbage B before Alice's tx confirms, causing Alice's tx
     * to revert with DepositIdAlreadyUsed.  Alice retries with a new token_index.
     * On a low-traffic testnet this risk is negligible; for mainnet consider
     * private mempool submission (Flashbots protect).
     */
    function deposit(
        address             depositId,
        uint256[2] calldata blindedPointB
    ) external payable {
        if (msg.value != DENOMINATION)             revert InvalidValue();
        if (depositId == address(0))               revert InvalidDepositId();
        if (depositorOf[depositId] != address(0))  revert DepositIdAlreadyUsed();

        depositorOf[depositId] = msg.sender;
        depositedAt[depositId] = block.timestamp;

        emit DepositLocked(depositId, blindedPointB);
    }

    // -- External: announce -----------------------------------------------------

    /**
     * @notice Called by the Mint to deliver the blind signature S' on-chain.
     *
     * @param depositId  Must match a registered, unfulfilled blind.address.
     * @param S_prime    G1 point S' = sk_mint * B.  Safe in plaintext.
     *
     * Access: restricted to mintAuthority.  Open access would allow cheap DoS —
     * an attacker could spam MintFulfilled events with garbage S' values,
     * forcing clients to perform spurious unblind + pairing checks during scan.
     */
    function announce(
        address             depositId,
        uint256[2] calldata S_prime
    ) external {
        if (msg.sender != mintAuthority)            revert NotMintAuthority();
        if (depositorOf[depositId] == address(0))   revert DepositNotFound();
        if (announced[depositId])                   revert AlreadyFulfilled();

        announced[depositId] = true;
        emit MintFulfilled(depositId, S_prime);
    }

    // -- External: redeem -------------------------------------------------------

    /**
     * @notice Verify and redeem a token.  Transfers 0.01 ETH to recipient.
     *
     * @param recipient           Destination for the ETH.  Publicly visible.
     * @param spendSignature      ECDSA signature over redemptionMessageHash(recipient)
     *                            produced by spend_priv.  Binds the recipient address
     *                            to the proof — prevents MEV front-run substitution.
     * @param unblindedSignatureS G1 point S = r^-1 * S'.  The unblinded BLS token.
     *
     * Verification order (checks, then state change, then external call):
     *   1. Recover nullifier = ecrecover(hash, spendSignature).
     *   2. Require nullifier != address(0).
     *   3. Require !spentNullifiers[nullifier].
     *   4. Set spentNullifiers[nullifier] = true   <- state change before ETH transfer.
     *   5. Compute Y = H_G1(nullifier).
     *   6. Verify BLS pairing: e(S, G2) == e(Y, PK_mint).
     *   7. Transfer ETH to recipient.
     *
     * The deposit-to-redeem link is severed by the blind signature: there is no
     * on-chain path from spend_addr (nullifier) back to blind_addr (depositId)
     * without the master seed.
     */
    function redeem(
        address             recipient,
        bytes      calldata spendSignature,
        uint256[2] calldata unblindedSignatureS
    ) external {
        bytes32 txHash    = redemptionMessageHash(recipient);
        address nullifier = recoverSigner(txHash, spendSignature);
        if (nullifier == address(0)) revert InvalidECDSA();

        if (spentNullifiers[nullifier]) revert AlreadySpent();
        spentNullifiers[nullifier] = true;

        uint256[2] memory y = hashNullifierPoint(nullifier);
        if (!verifyBLS(unblindedSignatureS, y, pkMint)) revert InvalidBLS();

        (bool sent,) = payable(recipient).call{value: DENOMINATION}("");
        if (!sent) revert EthSendFailed();
    }

    // -- External: refund -------------------------------------------------------

    /**
     * @notice Reclaim ETH if the Mint fails to fulfil within REFUND_TIMEOUT.
     *
     * @param depositId  The blind.address used at deposit time.
     *
     * Only the original depositor (msg.sender at deposit time) can call this.
     * The Mint must not have called announce() for this depositId, and at least
     * REFUND_TIMEOUT must have elapsed since the deposit.
     *
     * Storage is cleared before the ETH transfer (reentrancy safety).
     */
    function refund(address depositId) external {
        address depositor = depositorOf[depositId];
        if (depositor == address(0))      revert DepositNotFound();
        if (msg.sender != depositor)      revert NotDepositor();
        if (announced[depositId])         revert AlreadyFulfilled();
        if (block.timestamp < depositedAt[depositId] + REFUND_TIMEOUT)
                                          revert RefundTooEarly();

        delete depositorOf[depositId];
        delete depositedAt[depositId];

        emit DepositRefunded(depositId);

        (bool sent,) = payable(depositor).call{value: DENOMINATION}("");
        if (!sent) revert EthSendFailed();
    }

    // -- Public view helpers ----------------------------------------------------

    /**
     * @notice Returns the message hash Charlie must sign to bind a recipient.
     * @dev    abi.encodePacked matches Python/TS client exactly.
     */
    function redemptionMessageHash(address recipient) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("Pay to: ", recipient));
    }

    /**
     * @notice Map a nullifier address to a BN254 G1 point via hash-to-curve.
     * @dev    PoC: preimage is the 20-byte address only (matches Python `ghost_library`).
     */
    function hashNullifierPoint(address nullifier) public view returns (uint256[2] memory) {
        return hashToCurve(abi.encodePacked(nullifier));
    }

    /**
     * @notice Try-and-increment hash-to-curve on BN254 (y^2 = x^3 + 3).
     * @dev    Matches Python: keccak256(message || be32(counter)) mod P,
     *         Legendre symbol check, then Tonelli-Shanks sqrt via modexp.
     *         Reverts if no valid point found within MAX_H2C_ITERS
     *         (probability ~2^-65536 per call — effectively impossible).
     */
    function hashToCurve(bytes memory message) public view returns (uint256[2] memory) {
        for (uint256 i = 0; i < MAX_H2C_ITERS; i++) {
            uint256 x   = uint256(keccak256(abi.encodePacked(message, uint32(i)))) % P;
            uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), 3, P);
            if (!_legendreIsOne(rhs)) continue;
            uint256 y = _modSqrtFp(rhs);
            if (mulmod(y, y, P) == rhs) return [x, y];
        }
        revert HashToCurveFailed();
    }

    /**
     * @notice Returns true if a deposit exists and has not yet been fulfilled.
     * @dev    Useful for the client to confirm the Mint has not yet responded
     *         before deciding whether to wait or call refund().
     */
    function depositPending(address depositId) external view returns (bool) {
        return depositorOf[depositId] != address(0) && !announced[depositId];
    }

    /**
     * @notice Returns true if a deposit exists and has been fulfilled by the Mint.
     * @dev    Useful for the client to confirm S' is available in MintFulfilled logs
     *         before attempting to unblind and redeem.
     */
    function depositFulfilled(address depositId) external view returns (bool) {
        return announced[depositId];
    }

    // -- Internal: BLS verification ---------------------------------------------

    /**
     * @dev Verify BLS signature using EIP-197 bn256Pairing precompile (0x08).
     *      Checks e(S, G2) == e(Y, PK_mint) by verifying
     *      e(S, G2) * e(-Y, PK_mint) == 1 in a single two-pair precompile call.
     *
     *      Input layout to precompile (384 bytes = 2 pairs x 192 bytes):
     *        pair 0: S (G1 point), G2 generator
     *        pair 1: -Y (G1 point, negated), PK_mint (G2 point)
     *
     *      G2 coordinate limb order per EIP-197: [x.imag, x.real, y.imag, y.real].
     */
    function verifyBLS(
        uint256[2] memory S,
        uint256[2] memory Y,
        uint256[4] memory PK_mint
    ) internal view returns (bool) {
        uint256[2] memory negY = _negateG1(Y);
        uint256[4] memory g2   = _g2Gen();

        uint256[12] memory input = [
            S[0],       S[1],
            g2[0],      g2[1],      g2[2],      g2[3],
            negY[0],    negY[1],
            PK_mint[0], PK_mint[1], PK_mint[2], PK_mint[3]
        ];

        (bool ok, bytes memory ret) = address(0x08).staticcall(abi.encodePacked(input));
        require(ok, "Pairing precompile failed");
        return abi.decode(ret, (uint256)) == 1;
    }

    // -- Internal: ecrecover wrapper --------------------------------------------

    function recoverSigner(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(hash, v, r, s);
    }

    // -- Internal: curve arithmetic ---------------------------------------------

    function _negateG1(uint256[2] memory p) internal pure returns (uint256[2] memory) {
        if (p[0] == 0 && p[1] == 0) return [uint256(0), uint256(0)];
        return [p[0], P - (p[1] % P)];
    }

    /// @dev G2 generator matching py_ecc.bn128.G2 (EIP-197 limb order).
    ///      g[2] must be 0x090689... — the leading zero is load-bearing.
    ///      0x90689... (missing zero) silently produces wrong pairing results.
    function _g2Gen() internal pure returns (uint256[4] memory g) {
        g[0] = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2;
        g[1] = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed;
        g[2] = 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b;
        g[3] = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa;
    }

    function _legendreIsOne(uint256 rhs) internal view returns (bool) {
        if (rhs == 0) return false;
        return _modExp(rhs, (P - 1) / 2) == 1;
    }

    function _modSqrtFp(uint256 rhs) internal view returns (uint256) {
        return _modExp(rhs, (P + 1) / 4);
    }

    function _modExp(uint256 base, uint256 exponent) internal view returns (uint256 r) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr,            0x20)
            mstore(add(ptr, 0x20), 0x20)
            mstore(add(ptr, 0x40), 0x20)
            mstore(add(ptr, 0x60), base)
            mstore(add(ptr, 0x80), exponent)
            mstore(add(ptr, 0xa0), P)
            if iszero(staticcall(gas(), 0x05, ptr, 0xc0, ptr, 0x20)) { revert(0, 0) }
            r := mload(ptr)
        }
    }
}
