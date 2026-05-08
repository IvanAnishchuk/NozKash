// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title NozkVaultV2 — BLS12-381 with signature aggregation
 * @notice Privacy-preserving eCash using BLS blind signatures on BLS12-381.
 *
 *         Token lifecycle: deposit → announce → reveal → redeem
 *
 *         Cryptographic changes from V1 (BN254):
 *           - Mint keys:  BLS12-381, PK in G2 (8 × uint256)
 *           - Spend keys: BLS12-381, PK in G2 — the full G2 pubkey IS the nullifier
 *           - Signatures: G1 points (4 × uint256)
 *           - Hash-to-curve: MAP_FP_TO_G1 precompile (0x12) replaces try-and-increment
 *           - ECDSA ecrecover removed — replaced by BLS spend signature pairing check
 *
 *         Aggregation:
 *           - revealAggregated: single pairing check for n tokens (same mint key)
 *           - redeemAggregated: single pairing check for n tokens (same message, diff keys)
 *
 *         EIP-2537 precompiles used:
 *           - 0x0b: BLS12_G1ADD
 *           - 0x0e: BLS12_G2ADD
 *           - 0x11: BLS12_PAIRING_CHECK
 *           - 0x12: BLS12_MAP_FP_TO_G1
 */
contract NozkVaultV2 {

    // -- Constants --------------------------------------------------------------

    uint256 public constant DENOMINATION = 0.001 ether;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant NOZKREDEEM_TYPEHASH = keccak256(
        "NozkRedeem(address recipient,uint256 deadline)"
    );

    bytes32 internal constant NAME_HASH    = keccak256(bytes("NozkVault"));
    bytes32 internal constant VERSION_HASH = keccak256(bytes("1"));

    // EIP-2537 precompile addresses
    address internal constant BLS12_G1ADD     = address(0x0b);
    address internal constant BLS12_G2ADD     = address(0x0e);
    address internal constant BLS12_PAIRING   = address(0x11);
    address internal constant BLS12_MAP_FP_G1 = address(0x12);

    // -- Types ------------------------------------------------------------------

    /// @dev Nullifier lifecycle: UNREVEALED (default) → REVEALED → SPENT.
    enum NullifierState { UNREVEALED, REVEALED, SPENT }

    // -- State ------------------------------------------------------------------

    /// @dev BLS12-381 public key of the Mint on G2 (EIP-2537 encoding, 8 × uint256).
    uint256[8] public pkMint;

    /// @dev Address authorised to call announce().
    address public immutable mintAuthority;

    /// @dev Nullifier lifecycle state. Key = keccak256(abi.encode(spendPub_G2)).
    mapping(bytes32 => NullifierState) public nullifierState;

    /// @dev Amount recorded when the nullifier was revealed.
    mapping(bytes32 => uint256) public revealedAmount;

    /// @dev Stored spend BLS public key (G2), written at reveal, read at redeem.
    mapping(bytes32 => uint256[8]) internal spendPubkeys;

    /// @dev depositId => deposit registered and not yet fulfilled.
    mapping(address => bool) internal awaitingFulfillment;

    /// @dev depositId => true once MintFulfilled emitted.
    mapping(address => bool) internal announced;

    /// @dev depositId => depositor EOA (for refund).
    mapping(address => address) public depositors;

    /// @dev EIP-712 domain separator.
    bytes32 public immutable DOMAIN_SEPARATOR;

    // -- Events -----------------------------------------------------------------

    event DepositLocked(address indexed depositId, uint256[4] B);
    event MintFulfilled(address indexed depositId, uint256[4] S_prime);
    event NullifierRevealed(bytes32 indexed nullifierId, uint256 amount);
    event Redeemed(bytes32 indexed nullifierId, address indexed recipient, uint256 amount);
    event Refunded(address indexed depositId, address indexed to);

    // -- Errors -----------------------------------------------------------------

    error InvalidValue();
    error InvalidBLS();
    error AlreadySpent();
    error EthSendFailed();
    error NotMintAuthority();
    error DepositNotFound();
    error DepositIdAlreadyUsed();
    error AlreadyFulfilled();
    error AlreadyRevealed();
    error NotRevealed();
    error InvalidDepositId();
    error NotDepositor();
    error NothingToRefund();
    error ExpiredSignature();
    error BatchLengthMismatch();
    error PrecompileFailed();
    error EmptyBatch();

    // -- Constructor ------------------------------------------------------------

    constructor(uint256[8] memory pkMint_, address mintAuthority_) {
        pkMint        = pkMint_;
        mintAuthority = mintAuthority_;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            NAME_HASH,
            VERSION_HASH,
            block.chainid,
            address(this)
        ));
    }

    // -- External: deposit ------------------------------------------------------

    function deposit(
        address             depositId,
        uint256[4] calldata blindedPointB
    ) external payable {
        if (msg.value != DENOMINATION) revert InvalidValue();
        if (depositId == address(0))   revert InvalidDepositId();
        if (awaitingFulfillment[depositId] || announced[depositId]) revert DepositIdAlreadyUsed();

        awaitingFulfillment[depositId] = true;
        depositors[depositId] = msg.sender;

        emit DepositLocked(depositId, blindedPointB);
    }

    // -- External: announce -----------------------------------------------------

    function announce(
        address             depositId,
        uint256[4] calldata S_prime
    ) external {
        if (msg.sender != mintAuthority)     revert NotMintAuthority();
        if (announced[depositId])            revert AlreadyFulfilled();
        if (!awaitingFulfillment[depositId]) revert DepositNotFound();

        announced[depositId] = true;
        awaitingFulfillment[depositId] = false;
        delete depositors[depositId];
        emit MintFulfilled(depositId, S_prime);
    }

    function refund(address depositId) external {
        if (depositId == address(0)) revert InvalidDepositId();
        if (!awaitingFulfillment[depositId]) revert NothingToRefund();
        if (msg.sender != depositors[depositId]) revert NotDepositor();

        awaitingFulfillment[depositId] = false;
        delete depositors[depositId];

        (bool sent,) = payable(msg.sender).call{value: DENOMINATION}("");
        if (!sent) revert EthSendFailed();

        emit Refunded(depositId, msg.sender);
    }

    // -- External: reveal -------------------------------------------------------

    /// @notice Reveal a single token: verify mint BLS signature and register nullifier.
    /// @param spendPub  G2 spend public key (the nullifier identity).
    /// @param S         G1 unblinded mint signature.
    function reveal(
        uint256[8] calldata spendPub,
        uint256[4] calldata S
    ) external {
        _reveal(spendPub, S);
    }

    /// @notice Batch reveal with individual pairing checks per token.
    function revealBatch(
        uint256[8][] calldata spendPubs,
        uint256[4][] calldata signatures
    ) external {
        if (spendPubs.length != signatures.length) revert BatchLengthMismatch();
        for (uint256 i; i < spendPubs.length; i++) {
            _reveal(spendPubs[i], signatures[i]);
        }
    }

    /// @notice Aggregated reveal: single pairing check for n tokens (same mint key).
    /// @dev    sigma = S_1 + S_2 + ... + S_n (client-side G1 addition).
    ///         Verifies: e(sigma, G2_gen) == e(H(pub_1) + H(pub_2) + ..., pkMint).
    function revealAggregated(
        uint256[8][] calldata spendPubs,
        uint256[4]   calldata sigma
    ) external {
        uint256 n = spendPubs.length;
        if (n == 0) revert EmptyBatch();

        // Accumulate Y_agg = sum of H_G1(spendPub_i)
        uint256[4] memory yAgg = _hashSpendPubToG1(spendPubs[0]);
        for (uint256 i = 1; i < n; i++) {
            uint256[4] memory yi = _hashSpendPubToG1(spendPubs[i]);
            yAgg = _g1Add(yAgg, yi);
        }

        // Single pairing check
        if (!_verifyBLS12Pairing(sigma, yAgg, pkMint)) revert InvalidBLS();

        // Mark all as REVEALED
        for (uint256 i; i < n; i++) {
            bytes32 nId = keccak256(abi.encode(spendPubs[i]));
            if (nullifierState[nId] != NullifierState.UNREVEALED) revert AlreadyRevealed();
            spendPubkeys[nId] = spendPubs[i];
            nullifierState[nId] = NullifierState.REVEALED;
            revealedAmount[nId] = DENOMINATION;
            emit NullifierRevealed(nId, DENOMINATION);
        }
    }

    function _reveal(
        uint256[8] calldata spendPub,
        uint256[4] calldata S
    ) internal {
        bytes32 nId = keccak256(abi.encode(spendPub));
        if (nullifierState[nId] != NullifierState.UNREVEALED) revert AlreadyRevealed();

        uint256[4] memory y = _hashSpendPubToG1(spendPub);
        if (!_verifyBLS12Pairing(S, y, pkMint)) revert InvalidBLS();

        spendPubkeys[nId] = spendPub;
        nullifierState[nId] = NullifierState.REVEALED;
        revealedAmount[nId] = DENOMINATION;

        emit NullifierRevealed(nId, DENOMINATION);
    }

    // -- External: redeem -------------------------------------------------------

    /// @notice Redeem a single token via BLS spend signature.
    /// @param recipient Address to receive ETH.
    /// @param spendSig  G1 BLS signature: sk_spend * H_G1(msgHash).
    /// @param nId       bytes32 nullifier ID = keccak256(abi.encode(spendPub)).
    /// @param deadline  Unix timestamp after which signature expires.
    function redeem(
        address          recipient,
        uint256[4] calldata spendSig,
        bytes32          nId,
        uint256          deadline
    ) external {
        if (block.timestamp > deadline) revert ExpiredSignature();

        if (nullifierState[nId] != NullifierState.REVEALED) {
            if (nullifierState[nId] == NullifierState.SPENT) revert AlreadySpent();
            revert NotRevealed();
        }

        // Load stored spend pubkey
        uint256[8] memory spendPub = spendPubkeys[nId];

        // BLS verify: e(spendSig, G2_gen) == e(H_G1(msgHash), spendPub)
        bytes32 msgHash = redemptionMessageHash(recipient, deadline);
        uint256[4] memory msgPoint = _hashToG1(abi.encodePacked(msgHash));
        if (!_verifyBLS12Pairing(spendSig, msgPoint, spendPub)) revert InvalidBLS();

        nullifierState[nId] = NullifierState.SPENT;
        uint256 amount = revealedAmount[nId];

        (bool sent,) = payable(recipient).call{value: amount}("");
        if (!sent) revert EthSendFailed();
        emit Redeemed(nId, recipient, amount);
    }

    /// @notice Aggregated redeem: single pairing check for n tokens to same recipient.
    /// @dev    sigma = sig_1 + sig_2 + ... (client-side G1 addition).
    ///         PK_agg = spendPub_1 + spendPub_2 + ... (on-chain G2 addition).
    ///         Verifies: e(sigma, G2_gen) == e(H_G1(msgHash), PK_agg).
    function redeemAggregated(
        address            recipient,
        uint256[4] calldata sigma,
        bytes32[] calldata nIds,
        uint256            deadline
    ) external {
        uint256 n = nIds.length;
        if (n == 0) revert EmptyBatch();
        if (block.timestamp > deadline) revert ExpiredSignature();

        // Aggregate spend pubkeys from storage
        uint256[8] memory pkAgg = spendPubkeys[nIds[0]];
        for (uint256 i = 1; i < n; i++) {
            uint256[8] memory pk = spendPubkeys[nIds[i]];
            pkAgg = _g2Add(pkAgg, pk);
        }

        // Single pairing check
        bytes32 msgHash = redemptionMessageHash(recipient, deadline);
        uint256[4] memory msgPoint = _hashToG1(abi.encodePacked(msgHash));
        if (!_verifyBLS12Pairing(sigma, msgPoint, pkAgg)) revert InvalidBLS();

        // Mark all SPENT and transfer
        uint256 totalAmount = 0;
        for (uint256 i; i < n; i++) {
            if (nullifierState[nIds[i]] != NullifierState.REVEALED) {
                if (nullifierState[nIds[i]] == NullifierState.SPENT) revert AlreadySpent();
                revert NotRevealed();
            }
            nullifierState[nIds[i]] = NullifierState.SPENT;
            totalAmount += revealedAmount[nIds[i]];
            emit Redeemed(nIds[i], recipient, revealedAmount[nIds[i]]);
        }

        (bool sent,) = payable(recipient).call{value: totalAmount}("");
        if (!sent) revert EthSendFailed();
    }

    // -- Public view helpers ----------------------------------------------------

    function redemptionMessageHash(address recipient, uint256 deadline) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(NOZKREDEEM_TYPEHASH, recipient, deadline));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function depositPending(address depositId) external view returns (bool) {
        return awaitingFulfillment[depositId];
    }

    function depositFulfilled(address depositId) external view returns (bool) {
        return announced[depositId];
    }

    /// @notice Compute nullifier ID from a G2 spend public key.
    function nullifierId(uint256[8] calldata spendPub) external pure returns (bytes32) {
        return keccak256(abi.encode(spendPub));
    }

    // -- Internal: EIP-2537 precompile wrappers ---------------------------------

    /// @dev Hash arbitrary message to BLS12-381 G1 via MAP_FP_TO_G1 (0x12).
    ///      keccak256(message) → zero-padded to 64 bytes → precompile.
    function _hashToG1(bytes memory message) internal view returns (uint256[4] memory result) {
        bytes32 h = keccak256(message);
        // Place keccak output right-justified in 64-byte buffer
        // (32 zero bytes || 32 bytes of hash)
        bytes memory fpInput = new bytes(64);
        assembly {
            mstore(add(fpInput, 0x40), h)
        }
        (bool ok, bytes memory ret) = BLS12_MAP_FP_G1.staticcall(fpInput);
        if (!ok) revert PrecompileFailed();
        // ret is 128 bytes (G1 point)
        assembly {
            mstore(result, mload(add(ret, 0x20)))
            mstore(add(result, 0x20), mload(add(ret, 0x40)))
            mstore(add(result, 0x40), mload(add(ret, 0x60)))
            mstore(add(result, 0x60), mload(add(ret, 0x80)))
        }
    }

    /// @dev Hash a G2 spend public key to G1: H_G1(abi.encode(spendPub)).
    function _hashSpendPubToG1(uint256[8] calldata spendPub) internal view returns (uint256[4] memory) {
        return _hashToG1(abi.encode(spendPub));
    }

    /// @dev BLS12-381 G1 point addition via precompile 0x0b.
    function _g1Add(
        uint256[4] memory a,
        uint256[4] memory b
    ) internal view returns (uint256[4] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // Copy a (128 bytes)
            mstore(ptr,             mload(a))
            mstore(add(ptr, 0x20),  mload(add(a, 0x20)))
            mstore(add(ptr, 0x40),  mload(add(a, 0x40)))
            mstore(add(ptr, 0x60),  mload(add(a, 0x60)))
            // Copy b (128 bytes)
            mstore(add(ptr, 0x80),  mload(b))
            mstore(add(ptr, 0xa0),  mload(add(b, 0x20)))
            mstore(add(ptr, 0xc0),  mload(add(b, 0x40)))
            mstore(add(ptr, 0xe0),  mload(add(b, 0x60)))
            // staticcall(gas, 0x0b, inOffset, 256, outOffset, 128)
            success := staticcall(gas(), 0x0b, ptr, 0x100, result, 0x80)
        }
        if (!success) revert PrecompileFailed();
    }

    /// @dev BLS12-381 G2 point addition via precompile 0x0e.
    function _g2Add(
        uint256[8] memory a,
        uint256[8] memory b
    ) internal view returns (uint256[8] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // Copy a (256 bytes)
            mstore(ptr,              mload(a))
            mstore(add(ptr, 0x20),   mload(add(a, 0x20)))
            mstore(add(ptr, 0x40),   mload(add(a, 0x40)))
            mstore(add(ptr, 0x60),   mload(add(a, 0x60)))
            mstore(add(ptr, 0x80),   mload(add(a, 0x80)))
            mstore(add(ptr, 0xa0),   mload(add(a, 0xa0)))
            mstore(add(ptr, 0xc0),   mload(add(a, 0xc0)))
            mstore(add(ptr, 0xe0),   mload(add(a, 0xe0)))
            // Copy b (256 bytes)
            mstore(add(ptr, 0x100),  mload(b))
            mstore(add(ptr, 0x120),  mload(add(b, 0x20)))
            mstore(add(ptr, 0x140),  mload(add(b, 0x40)))
            mstore(add(ptr, 0x160),  mload(add(b, 0x60)))
            mstore(add(ptr, 0x180),  mload(add(b, 0x80)))
            mstore(add(ptr, 0x1a0),  mload(add(b, 0xa0)))
            mstore(add(ptr, 0x1c0),  mload(add(b, 0xc0)))
            mstore(add(ptr, 0x1e0),  mload(add(b, 0xe0)))
            // staticcall(gas, 0x0e, inOffset, 512, outOffset, 256)
            success := staticcall(gas(), 0x0e, ptr, 0x200, result, 0x100)
        }
        if (!success) revert PrecompileFailed();
    }

    /// @dev Verify BLS12-381 pairing: e(S, G2_gen) == e(Y, PK).
    ///      Equivalently: e(S, G2_gen) * e(-Y, PK) == 1.
    ///      Uses assembly to write the 768-byte precompile input without stack overflow.
    function _verifyBLS12Pairing(
        uint256[4] memory S,
        uint256[4] memory Y,
        uint256[8] memory PK
    ) internal view returns (bool) {
        uint256[4] memory negY = _negateG1(Y);
        bool success;
        bool result;

        assembly ("memory-safe") {
            let ptr := mload(0x40)

            // Pair 1: S (G1, 128 bytes)
            mstore(ptr,               mload(S))
            mstore(add(ptr, 0x20),    mload(add(S, 0x20)))
            mstore(add(ptr, 0x40),    mload(add(S, 0x40)))
            mstore(add(ptr, 0x60),    mload(add(S, 0x60)))

            // Pair 1: G2_gen (256 bytes) — hardcoded
            // x_c0
            mstore(add(ptr, 0x80),  0x00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051)
            mstore(add(ptr, 0xa0),  0xc6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8)
            // x_c1
            mstore(add(ptr, 0xc0),  0x0000000000000000000000000000000013e02b6052719f607dacd3a088274f65)
            mstore(add(ptr, 0xe0),  0x596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e)
            // y_c0
            mstore(add(ptr, 0x100), 0x000000000000000000000000000000000ce5d527727d6e118cc9cdc6da2e351a)
            mstore(add(ptr, 0x120), 0xadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801)
            // y_c1
            mstore(add(ptr, 0x140), 0x000000000000000000000000000000000606c4a02ea734cc32acd2b02bc28b99)
            mstore(add(ptr, 0x160), 0xcb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be)

            // Pair 2: -Y (G1, 128 bytes)
            mstore(add(ptr, 0x180), mload(negY))
            mstore(add(ptr, 0x1a0), mload(add(negY, 0x20)))
            mstore(add(ptr, 0x1c0), mload(add(negY, 0x40)))
            mstore(add(ptr, 0x1e0), mload(add(negY, 0x60)))

            // Pair 2: PK (G2, 256 bytes)
            mstore(add(ptr, 0x200), mload(PK))
            mstore(add(ptr, 0x220), mload(add(PK, 0x20)))
            mstore(add(ptr, 0x240), mload(add(PK, 0x40)))
            mstore(add(ptr, 0x260), mload(add(PK, 0x60)))
            mstore(add(ptr, 0x280), mload(add(PK, 0x80)))
            mstore(add(ptr, 0x2a0), mload(add(PK, 0xa0)))
            mstore(add(ptr, 0x2c0), mload(add(PK, 0xc0)))
            mstore(add(ptr, 0x2e0), mload(add(PK, 0xe0)))

            // Call pairing precompile (0x11), input = 768 bytes, output = 32 bytes
            success := staticcall(gas(), 0x11, ptr, 0x300, ptr, 0x20)
            result := mload(ptr)
        }
        if (!success) revert PrecompileFailed();
        return result;
    }

    /// @dev Negate a BLS12-381 G1 point: neg(x, y) = (x, -y mod p).
    ///      BLS12-381 field modulus p is 381 bits (> 256 bits), so we use
    ///      G1MUL(point, order-1) to negate. This costs ~12k gas but avoids
    ///      multi-word field arithmetic.
    function _negateG1(uint256[4] memory p) internal view returns (uint256[4] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // G1 point (128 bytes)
            mstore(ptr,             mload(p))
            mstore(add(ptr, 0x20),  mload(add(p, 0x20)))
            mstore(add(ptr, 0x40),  mload(add(p, 0x40)))
            mstore(add(ptr, 0x60),  mload(add(p, 0x60)))
            // Scalar: order - 1 (32 bytes)
            mstore(add(ptr, 0x80),  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000)
            // G1MUL precompile at 0x0c: input = 160 bytes, output = 128 bytes
            success := staticcall(gas(), 0x0c, ptr, 0xa0, result, 0x80)
        }
        if (!success) revert PrecompileFailed();
    }

}
