// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

import {BLS12HashToCurve} from "./BLS12HashToCurve.sol";

/**
 * @title NozkVaultV2 — BLS12-381 standard scheme (PK=G1, Sig=G2) with aggregation
 * @notice Privacy-preserving eCash using BLS blind signatures on BLS12-381.
 *
 *         Token lifecycle: deposit -> announce -> reveal -> redeem
 *
 *         Cryptographic scheme (standard BLS, AugSchemeMPL):
 *           - Mint keys:  BLS12-381, PK in G1 (4 x uint256)
 *           - Spend keys: BLS12-381, PK in G1 (4 x uint256)
 *           - Signatures: G2 points (8 x uint256)
 *           - Blinded tokens: G2 points (8 x uint256)
 *           - Hash-to-G2: RFC 9380 via SHA-256 + MAP_FP2_TO_G2 precompile (0x11)
 *           - Redeem auth: BLS spend signature (AugSchemeMPL) replaces ECDSA
 *
 *         Aggregation:
 *           - revealAggregated: single pairing check for n tokens (same mint key)
 *           - redeemAggregated: (n+1)-pairing check for n tokens (diff keys, AugSchemeMPL)
 *
 *         EIP-2537 precompiles used:
 *           - 0x02: SHA-256
 *           - 0x05: MODEXP
 *           - 0x0b: BLS12_G1ADD
 *           - 0x0c: BLS12_G1MSM (scalar mul via k=1 MSM)
 *           - 0x0d: BLS12_G2ADD
 *           - 0x0f: BLS12_PAIRING
 *           - 0x11: BLS12_MAP_FP2_TO_G2
 */
contract NozkVaultV2 {
    // -------------------------------------------------------------------------
    //  Constants
    // -------------------------------------------------------------------------

    uint256 public constant DENOMINATION = 0.001 ether;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant NOZKREDEEM_TYPEHASH = keccak256("NozkRedeem(address recipient,uint256 deadline)");

    bytes32 internal constant NAME_HASH = keccak256(bytes("NozkVault"));
    bytes32 internal constant VERSION_HASH = keccak256(bytes("1"));

    // EIP-2537 precompile addresses
    address internal constant PRECOMPILE_SHA256 = address(0x02);
    address internal constant PRECOMPILE_MODEXP = address(0x05);
    address internal constant BLS12_G1ADD = address(0x0b);
    address internal constant BLS12_G1MSM = address(0x0c);
    address internal constant BLS12_G2ADD = address(0x0d);
    address internal constant BLS12_PAIRING = address(0x0f);
    address internal constant BLS12_MAP_FP2_TO_G2 = address(0x11);

    // Half of the BLS12-381 field modulus: (p - 1) / 2, split into two uint256
    // Used for G1 compression y-sign determination.
    uint256 internal constant HALF_P_HI = 0x000000000000000000000000000000000d0088f51cbff34d258dd3db21a5d66b;
    uint256 internal constant HALF_P_LO = 0xb23ba5c279c2895fb398697d6bcd2a0257ea38cd5b4eb90b54770febadafffe5;

    // -------------------------------------------------------------------------
    //  Types
    // -------------------------------------------------------------------------

    /// @dev Nullifier lifecycle: UNREVEALED (default) -> REVEALED -> SPENT.
    enum NullifierState {
        UNREVEALED,
        REVEALED,
        SPENT
    }

    // -------------------------------------------------------------------------
    //  State
    // -------------------------------------------------------------------------

    /// @dev BLS12-381 public key of the Mint on G1 (EIP-2537 encoding, 4 x uint256).
    uint256[4] public pkMint;

    /// @dev Address authorised to call announce().
    address public immutable mintAuthority;

    /// @dev Nullifier lifecycle state. Key = keccak256(abi.encode(spendPub_G1)).
    mapping(bytes32 => NullifierState) public nullifierState;

    /// @dev Amount recorded when the nullifier was revealed.
    mapping(bytes32 => uint256) public revealedAmount;

    /// @dev Stored spend BLS public key (G1), written at reveal, read at redeem.
    mapping(bytes32 => uint256[4]) internal spendPubkeys;

    /// @dev depositId => deposit registered and not yet fulfilled.
    mapping(address => bool) internal awaitingFulfillment;

    /// @dev depositId => true once MintFulfilled emitted.
    mapping(address => bool) internal announced;

    /// @dev depositId => depositor EOA (for refund).
    mapping(address => address) public depositors;

    /// @dev EIP-712 domain separator.
    bytes32 public immutable DOMAIN_SEPARATOR;

    // -------------------------------------------------------------------------
    //  Events
    // -------------------------------------------------------------------------

    event DepositLocked(address indexed depositId, uint256[8] B);
    event MintFulfilled(address indexed depositId, uint256[8] S_prime);
    event NullifierRevealed(bytes32 indexed nullifierId, uint256 amount);
    event Redeemed(bytes32 indexed nullifierId, address indexed recipient, uint256 amount);
    event Refunded(address indexed depositId, address indexed to);

    // -------------------------------------------------------------------------
    //  Errors
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    //  Constructor
    // -------------------------------------------------------------------------

    constructor(uint256[4] memory pkMint_, address mintAuthority_) {
        pkMint = pkMint_;
        mintAuthority = mintAuthority_;
        DOMAIN_SEPARATOR =
            keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    // -------------------------------------------------------------------------
    //  External: deposit
    // -------------------------------------------------------------------------

    function deposit(address depositId, uint256[8] calldata blindedPointB) external payable {
        if (msg.value != DENOMINATION) revert InvalidValue();
        if (depositId == address(0)) revert InvalidDepositId();
        if (awaitingFulfillment[depositId] || announced[depositId]) revert DepositIdAlreadyUsed();

        awaitingFulfillment[depositId] = true;
        depositors[depositId] = msg.sender;

        emit DepositLocked(depositId, blindedPointB);
    }

    // -------------------------------------------------------------------------
    //  External: announce
    // -------------------------------------------------------------------------

    function announce(address depositId, uint256[8] calldata S_prime) external {
        if (msg.sender != mintAuthority) revert NotMintAuthority();
        if (announced[depositId]) revert AlreadyFulfilled();
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

    // -------------------------------------------------------------------------
    //  External: reveal
    // -------------------------------------------------------------------------

    /// @notice Reveal a single token: verify mint BLS signature and register nullifier.
    /// @param spendPub G1 spend public key (4 x uint256).
    /// @param S        G2 unblinded mint signature (8 x uint256).
    function reveal(uint256[4] calldata spendPub, uint256[8] calldata S) external {
        _reveal(spendPub, S);
    }

    /// @notice Batch reveal with individual pairing checks per token.
    function revealBatch(uint256[4][] calldata spendPubs, uint256[8][] calldata signatures) external {
        if (spendPubs.length != signatures.length) revert BatchLengthMismatch();
        for (uint256 i; i < spendPubs.length; i++) {
            _reveal(spendPubs[i], signatures[i]);
        }
    }

    /// @notice Aggregated reveal: single pairing check for n tokens (same mint key).
    /// @dev    sigma = S_1 + S_2 + ... + S_n (client-side G2 addition).
    ///         Verifies: e(pkMint, Y_agg) * e(-G1_gen, sigma) == 1
    ///         where Y_agg = H_G2(pub_1) + H_G2(pub_2) + ...
    function revealAggregated(uint256[4][] calldata spendPubs, uint256[8] calldata sigma) external {
        uint256 n = spendPubs.length;
        if (n == 0) revert EmptyBatch();

        // Accumulate Y_agg = sum of H_G2(abi.encode(spendPub_i))
        uint256[8] memory yAgg = _hashToG2(abi.encode(spendPubs[0]));
        for (uint256 i = 1; i < n; i++) {
            uint256[8] memory yi = _hashToG2(abi.encode(spendPubs[i]));
            yAgg = BLS12HashToCurve.g2Add(yAgg, yi);
        }

        // Copy sigma from calldata to memory
        uint256[8] memory sigmaM = _calldataG2ToMemory(sigma);

        // Single pairing check: e(pkMint, yAgg) * e(-G1_gen, sigma) == 1
        if (!_verifyBLS12Pairing(pkMint, yAgg, sigmaM)) revert InvalidBLS();

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

    function _reveal(uint256[4] calldata spendPub, uint256[8] calldata S) internal {
        bytes32 nId = keccak256(abi.encode(spendPub));
        if (nullifierState[nId] != NullifierState.UNREVEALED) revert AlreadyRevealed();

        // Hash input for reveal is abi.encode(spendPub) (128 bytes, the ABI-encoded G1 point)
        uint256[8] memory y = _hashToG2(abi.encode(spendPub));
        uint256[8] memory sM = _calldataG2ToMemory(S);

        // Verify: e(pkMint, y) * e(-G1_gen, S) == 1
        if (!_verifyBLS12Pairing(pkMint, y, sM)) revert InvalidBLS();

        spendPubkeys[nId] = spendPub;
        nullifierState[nId] = NullifierState.REVEALED;
        revealedAmount[nId] = DENOMINATION;

        emit NullifierRevealed(nId, DENOMINATION);
    }

    // -------------------------------------------------------------------------
    //  External: redeem
    // -------------------------------------------------------------------------

    /// @notice Redeem a single token via BLS spend signature (AugSchemeMPL).
    /// @param recipient Address to receive ETH.
    /// @param spendSig  G2 BLS signature (8 x uint256).
    /// @param nId       bytes32 nullifier ID = keccak256(abi.encode(spendPub_G1)).
    /// @param deadline  Unix timestamp after which signature expires.
    function redeem(address recipient, uint256[8] calldata spendSig, bytes32 nId, uint256 deadline) external {
        if (block.timestamp > deadline) revert ExpiredSignature();

        if (nullifierState[nId] != NullifierState.REVEALED) {
            if (nullifierState[nId] == NullifierState.SPENT) revert AlreadySpent();
            revert NotRevealed();
        }

        // Load stored spend pubkey (G1)
        uint256[4] memory spendPub = spendPubkeys[nId];

        // AugSchemeMPL verification:
        //   aug_msg = compress(spendPub) || abi.encodePacked(msgHash)
        //   Y = hashToG2(aug_msg)
        //   verify: e(spendPub, Y) * e(-G1_gen, spendSig) == 1
        bytes32 msgHash = redemptionMessageHash(recipient, deadline);
        bytes memory compressedPk = _compressG1(spendPub);
        bytes memory augMsg = abi.encodePacked(compressedPk, msgHash);
        uint256[8] memory y = _hashToG2(augMsg);

        uint256[8] memory sigM = _calldataG2ToMemory(spendSig);

        if (!_verifyBLS12Pairing(spendPub, y, sigM)) revert InvalidBLS();

        nullifierState[nId] = NullifierState.SPENT;
        uint256 amount = revealedAmount[nId];

        (bool sent,) = payable(recipient).call{value: amount}("");
        if (!sent) revert EthSendFailed();
        emit Redeemed(nId, recipient, amount);
    }

    /// @notice Aggregated redeem: multi-pairing check for n tokens to same recipient.
    /// @dev    For AugSchemeMPL, each token has a different aug_msg (because compressed
    ///         PK differs per signer). Correct verification uses an (n+1)-pairing:
    ///           e(PK_0, Y_0) * e(PK_1, Y_1) * ... * e(-G1_gen, sigma) == 1
    ///         where Y_i = H_G2(compress(PK_i) || msgHash) and sigma = sum(sig_i).
    function redeemAggregated(address recipient, uint256[8] calldata sigma, bytes32[] calldata nIds, uint256 deadline)
        external
    {
        uint256 n = nIds.length;
        if (n == 0) revert EmptyBatch();
        if (block.timestamp > deadline) revert ExpiredSignature();

        bytes32 msgHash = redemptionMessageHash(recipient, deadline);

        // Build (n+1)-pairing input: n pairs of (PK_i, Y_i) + 1 pair of (-G1_gen, sigma)
        // Each pair: G1 (128 bytes) + G2 (256 bytes) = 384 bytes
        uint256 totalPairs = n + 1;
        bytes memory pairingInput = new bytes(totalPairs * 384);

        for (uint256 i; i < n; i++) {
            uint256[4] memory pk = spendPubkeys[nIds[i]];
            uint256[8] memory yi = _hashToG2(abi.encodePacked(_compressG1(pk), msgHash));
            uint256 offset = i * 384;

            assembly ("memory-safe") {
                let dst := add(add(pairingInput, 0x20), offset)
                // G1 point PK_i (128 bytes)
                mstore(dst, mload(pk))
                mstore(add(dst, 0x20), mload(add(pk, 0x20)))
                mstore(add(dst, 0x40), mload(add(pk, 0x40)))
                mstore(add(dst, 0x60), mload(add(pk, 0x60)))
                // G2 point Y_i (256 bytes)
                mstore(add(dst, 0x80), mload(yi))
                mstore(add(dst, 0xa0), mload(add(yi, 0x20)))
                mstore(add(dst, 0xc0), mload(add(yi, 0x40)))
                mstore(add(dst, 0xe0), mload(add(yi, 0x60)))
                mstore(add(dst, 0x100), mload(add(yi, 0x80)))
                mstore(add(dst, 0x120), mload(add(yi, 0xa0)))
                mstore(add(dst, 0x140), mload(add(yi, 0xc0)))
                mstore(add(dst, 0x160), mload(add(yi, 0xe0)))
            }
        }

        // Final pair: (-G1_gen, sigma)
        uint256[4] memory negGen = _negateG1Gen();
        uint256[8] memory sigmaM = _calldataG2ToMemory(sigma);
        uint256 lastOffset = n * 384;

        assembly ("memory-safe") {
            let dst := add(add(pairingInput, 0x20), lastOffset)
            // -G1_gen (128 bytes)
            mstore(dst, mload(negGen))
            mstore(add(dst, 0x20), mload(add(negGen, 0x20)))
            mstore(add(dst, 0x40), mload(add(negGen, 0x40)))
            mstore(add(dst, 0x60), mload(add(negGen, 0x60)))
            // sigma (256 bytes)
            mstore(add(dst, 0x80), mload(sigmaM))
            mstore(add(dst, 0xa0), mload(add(sigmaM, 0x20)))
            mstore(add(dst, 0xc0), mload(add(sigmaM, 0x40)))
            mstore(add(dst, 0xe0), mload(add(sigmaM, 0x60)))
            mstore(add(dst, 0x100), mload(add(sigmaM, 0x80)))
            mstore(add(dst, 0x120), mload(add(sigmaM, 0xa0)))
            mstore(add(dst, 0x140), mload(add(sigmaM, 0xc0)))
            mstore(add(dst, 0x160), mload(add(sigmaM, 0xe0)))
        }

        // Call pairing precompile with (n+1) pairs
        bool success;
        bool pairingResult;
        assembly ("memory-safe") {
            let ptr := add(pairingInput, 0x20)
            let len := mul(totalPairs, 384)
            // Allocate 32 bytes for the result after the input
            let resultPtr := add(ptr, len)
            success := staticcall(gas(), 0x0f, ptr, len, resultPtr, 0x20)
            pairingResult := eq(mload(resultPtr), 1)
        }
        if (!success) revert PrecompileFailed();
        if (!pairingResult) revert InvalidBLS();

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

    // -------------------------------------------------------------------------
    //  Public view helpers
    // -------------------------------------------------------------------------

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

    /// @notice Compute nullifier ID from a G1 spend public key.
    function nullifierId(uint256[4] calldata spendPub) external pure returns (bytes32) {
        return keccak256(abi.encode(spendPub));
    }

    // =========================================================================
    //  Internal: RFC 9380 hash-to-G2 (delegates to BLS12HashToCurve library)
    // =========================================================================

    /// @dev AugSchemeMPL DST for BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_
    bytes internal constant H2C_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_";

    /// @dev Hash arbitrary message to BLS12-381 G2 via RFC 9380.
    function _hashToG2(bytes memory message) internal view returns (uint256[8] memory) {
        return BLS12HashToCurve.hashToCurveG2(message, H2C_DST);
    }

    // =========================================================================
    //  Internal: EIP-2537 precompile wrappers (G1ADD, pairing, negation)
    // =========================================================================

    /// @dev BLS12-381 G1 point addition via precompile 0x0b.
    function _g1Add(uint256[4] memory a, uint256[4] memory b) internal view returns (uint256[4] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, mload(a))
            mstore(add(ptr, 0x20), mload(add(a, 0x20)))
            mstore(add(ptr, 0x40), mload(add(a, 0x40)))
            mstore(add(ptr, 0x60), mload(add(a, 0x60)))
            mstore(add(ptr, 0x80), mload(b))
            mstore(add(ptr, 0xa0), mload(add(b, 0x20)))
            mstore(add(ptr, 0xc0), mload(add(b, 0x40)))
            mstore(add(ptr, 0xe0), mload(add(b, 0x60)))
            success := staticcall(gas(), 0x0b, ptr, 0x100, result, 0x80)
        }
        if (!success) revert PrecompileFailed();
    }

    /// @dev Verify BLS12-381 pairing: e(PK, Y) * e(-G1_gen, S) == 1.
    ///      PK is G1 (128 bytes), Y and S are G2 (256 bytes each).
    ///      Layout for BLS12_PAIRING (0x0f):
    ///        Pair 1: PK_G1 (128) + Y_G2 (256) = 384 bytes
    ///        Pair 2: neg_G1_gen (128) + S_G2 (256) = 384 bytes
    ///        Total: 768 bytes
    function _verifyBLS12Pairing(uint256[4] memory PK, uint256[8] memory Y, uint256[8] memory S)
        internal
        view
        returns (bool)
    {
        uint256[4] memory negGen = _negateG1Gen();
        bool success;
        bool pairingResult;

        assembly ("memory-safe") {
            let ptr := mload(0x40)

            // -- Pair 1: PK (G1, 128 bytes) --
            mstore(ptr, mload(PK))
            mstore(add(ptr, 0x20), mload(add(PK, 0x20)))
            mstore(add(ptr, 0x40), mload(add(PK, 0x40)))
            mstore(add(ptr, 0x60), mload(add(PK, 0x60)))

            // -- Pair 1: Y (G2, 256 bytes) --
            mstore(add(ptr, 0x80), mload(Y))
            mstore(add(ptr, 0xa0), mload(add(Y, 0x20)))
            mstore(add(ptr, 0xc0), mload(add(Y, 0x40)))
            mstore(add(ptr, 0xe0), mload(add(Y, 0x60)))
            mstore(add(ptr, 0x100), mload(add(Y, 0x80)))
            mstore(add(ptr, 0x120), mload(add(Y, 0xa0)))
            mstore(add(ptr, 0x140), mload(add(Y, 0xc0)))
            mstore(add(ptr, 0x160), mload(add(Y, 0xe0)))

            // -- Pair 2: -G1_gen (128 bytes) --
            mstore(add(ptr, 0x180), mload(negGen))
            mstore(add(ptr, 0x1a0), mload(add(negGen, 0x20)))
            mstore(add(ptr, 0x1c0), mload(add(negGen, 0x40)))
            mstore(add(ptr, 0x1e0), mload(add(negGen, 0x60)))

            // -- Pair 2: S (G2, 256 bytes) --
            mstore(add(ptr, 0x200), mload(S))
            mstore(add(ptr, 0x220), mload(add(S, 0x20)))
            mstore(add(ptr, 0x240), mload(add(S, 0x40)))
            mstore(add(ptr, 0x260), mload(add(S, 0x60)))
            mstore(add(ptr, 0x280), mload(add(S, 0x80)))
            mstore(add(ptr, 0x2a0), mload(add(S, 0xa0)))
            mstore(add(ptr, 0x2c0), mload(add(S, 0xc0)))
            mstore(add(ptr, 0x2e0), mload(add(S, 0xe0)))

            // Call pairing precompile (0x0f), 768 bytes in, 32 bytes out
            success := staticcall(gas(), 0x0f, ptr, 0x300, ptr, 0x20)
            pairingResult := eq(mload(ptr), 1)
        }
        if (!success) revert PrecompileFailed();
        return pairingResult;
    }

    /// @dev Compute -G1_generator using G1MSM(G1_gen, order-1).
    function _negateG1Gen() internal view returns (uint256[4] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // G1 generator in EIP-2537 format (128 bytes):
            // x = 0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb
            mstore(ptr, 0x0000000000000000000000000000000017f1d3a73197d7942695638c4fa9ac0f)
            mstore(add(ptr, 0x20), 0xc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb)
            // y = 0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1
            mstore(add(ptr, 0x40), 0x0000000000000000000000000000000008b3f481e3aaa0f1a09e30ed741d8ae4)
            mstore(add(ptr, 0x60), 0xfcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1)
            // Scalar: order - 1
            mstore(add(ptr, 0x80), 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000)
            // G1MSM with k=1: 160 bytes in, 128 bytes out
            success := staticcall(gas(), 0x0c, ptr, 0xa0, result, 0x80)
        }
        if (!success) revert PrecompileFailed();
    }

    /// @dev Negate an arbitrary BLS12-381 G1 point using G1MSM(point, order-1).
    function _negateG1(uint256[4] memory p) internal view returns (uint256[4] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, mload(p))
            mstore(add(ptr, 0x20), mload(add(p, 0x20)))
            mstore(add(ptr, 0x40), mload(add(p, 0x40)))
            mstore(add(ptr, 0x60), mload(add(p, 0x60)))
            mstore(add(ptr, 0x80), 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000)
            success := staticcall(gas(), 0x0c, ptr, 0xa0, result, 0x80)
        }
        if (!success) revert PrecompileFailed();
    }

    // =========================================================================
    //  Internal: G1 compression (for AugSchemeMPL message augmentation)
    // =========================================================================

    /// @dev Compress a G1 point to 48 bytes (BLS compressed format).
    ///      - Take x coordinate (48 bytes from the 64-byte padded EIP-2537 form)
    ///      - Set compression flag (0x80) and sign flag (0x20 if y > (p-1)/2)
    ///
    ///      EIP-2537 G1 layout: [x_hi(32), x_lo(32), y_hi(32), y_lo(32)]
    ///      where x_hi/y_hi have 16 leading zero bytes followed by 16 data bytes.
    ///      x = x_hi[16:32] || x_lo[0:32] = 48 bytes total.
    function _compressG1(uint256[4] memory p) internal pure returns (bytes memory compressed) {
        uint256 xHi = p[0]; // high 16 bytes of x (in low 128 bits of uint256)
        uint256 xLo = p[1]; // low 32 bytes of x
        uint256 yHi = p[2]; // high 16 bytes of y
        uint256 yLo = p[3]; // low 32 bytes of y

        // Determine if y > (p-1)/2
        bool yGreater = (yHi > HALF_P_HI) || (yHi == HALF_P_HI && yLo > HALF_P_LO);

        // Flags: 0x80 (compressed) | 0x20 (sign bit if y > half_p)
        uint256 flags = 0x80;
        if (yGreater) {
            flags |= 0x20;
        }

        compressed = new bytes(48);
        assembly {
            // Build 48-byte compressed point:
            //   byte[0] = flags | xHi_top_byte
            //   byte[1..15] = remaining 15 bytes of xHi
            //   byte[16..47] = xLo (32 bytes)
            //
            // xHi is at most 128 bits (16 bytes). Its top byte is at most 0x19
            // (since x < p, and p starts with 0x1a...), so flag bits (7,6,5)
            // never collide with x data — simple OR is safe.
            let top16 := or(shl(120, flags), xHi)

            // First 32 bytes of output = [top16 (16 bytes)][xLo high 16 bytes]
            let word0 := or(shl(128, top16), shr(128, xLo))
            mstore(add(compressed, 0x20), word0)

            // Remaining 16 bytes = xLo low 16 bytes, left-aligned in a 32-byte word
            mstore(add(compressed, 0x40), shl(128, xLo))
        }
    }

    // =========================================================================
    //  Internal: helpers
    // =========================================================================

    /// @dev Copy a G2 point from calldata to memory.
    function _calldataG2ToMemory(uint256[8] calldata src) internal pure returns (uint256[8] memory dst) {
        dst[0] = src[0];
        dst[1] = src[1];
        dst[2] = src[2];
        dst[3] = src[3];
        dst[4] = src[4];
        dst[5] = src[5];
        dst[6] = src[6];
        dst[7] = src[7];
    }
}
