// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
 *           - redeemAggregated: single pairing check for n tokens (same msg, diff keys)
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
            yAgg = _g2Add(yAgg, yi);
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

    /// @notice Aggregated redeem: single pairing check for n tokens to same recipient.
    /// @dev    For AugSchemeMPL, each token has a different aug_msg (because compressed
    ///         PK differs). Aggregate: PK_agg = sum(PK_i), Y_agg = sum(Y_i),
    ///         sigma = sum(sig_i). Verify: e(PK_agg, Y_agg) * e(-G1_gen, sigma) == 1.
    ///         NOTE: This aggregation is only correct when token signatures are produced
    ///         with their individual aug_msg and aggregated additively.
    function redeemAggregated(address recipient, uint256[8] calldata sigma, bytes32[] calldata nIds, uint256 deadline)
        external
    {
        uint256 n = nIds.length;
        if (n == 0) revert EmptyBatch();
        if (block.timestamp > deadline) revert ExpiredSignature();

        bytes32 msgHash = redemptionMessageHash(recipient, deadline);

        // Aggregate PK and Y across all tokens
        uint256[4] memory spendPub0 = spendPubkeys[nIds[0]];
        uint256[4] memory pkAgg = spendPub0;
        uint256[8] memory yAgg = _hashToG2(abi.encodePacked(_compressG1(spendPub0), msgHash));

        for (uint256 i = 1; i < n; i++) {
            uint256[4] memory pk = spendPubkeys[nIds[i]];
            pkAgg = _g1Add(pkAgg, pk);
            uint256[8] memory yi = _hashToG2(abi.encodePacked(_compressG1(pk), msgHash));
            yAgg = _g2Add(yAgg, yi);
        }

        uint256[8] memory sigmaM = _calldataG2ToMemory(sigma);
        if (!_verifyBLS12Pairing(pkAgg, yAgg, sigmaM)) revert InvalidBLS();

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
    //  Internal: RFC 9380 hash-to-G2  (AugSchemeMPL DST)
    // =========================================================================

    /// @dev AugSchemeMPL DST for BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_
    ///      43 bytes (0x2b).
    bytes internal constant H2C_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_";

    /// @dev Hash arbitrary message to BLS12-381 G2 via RFC 9380.
    ///      1. expand_message_xmd(msg, DST, 256) -> 256 bytes uniform
    ///      2. hash_to_field: 4 field elements mod p -> two Fp2 elements
    ///      3. MAP_FP2_TO_G2 for each Fp2 element
    ///      4. G2ADD the two resulting G2 points
    function _hashToG2(bytes memory message) internal view returns (uint256[8] memory) {
        bytes memory uniform = _expandMessageXMD(message);

        // hash_to_field: 4 x 64-byte chunks reduced mod p, grouped into two Fp2
        // u0 = Fp2(reduce(uniform[0:64]), reduce(uniform[64:128]))
        // u1 = Fp2(reduce(uniform[128:192]), reduce(uniform[192:256]))
        uint256[4] memory u0 = _uniformToFp2(uniform, 0);
        uint256[4] memory u1 = _uniformToFp2(uniform, 128);

        // MAP_FP2_TO_G2 for each
        uint256[8] memory Q0 = _mapFp2ToG2(u0);
        uint256[8] memory Q1 = _mapFp2ToG2(u1);

        // G2ADD(Q0, Q1)
        return _g2Add(Q0, Q1);
    }

    /// @dev expand_message_xmd per RFC 9380 section 5.3.1, with len_in_bytes=256.
    ///      Uses SHA-256 precompile at address(0x02).
    function _expandMessageXMD(bytes memory msg_) internal view returns (bytes memory uniform) {
        // DST_prime = DST || I2OSP(len(DST), 1) = DST || 0x2b (43 in hex)
        bytes memory dstPrime = abi.encodePacked(H2C_DST, uint8(43));

        // msg_prime = Z_pad(64) || msg || l_i_b_str(2) || 0x00 || DST_prime
        bytes memory msgPrime = abi.encodePacked(
            new bytes(64), // Z_pad = 64 zero bytes (SHA-256 block size)
            msg_,
            uint16(256), // l_i_b_str = I2OSP(256, 2) = 0x0100
            uint8(0),
            dstPrime
        );

        // b_0 = SHA-256(msg_prime)
        bytes32 b0 = _sha256(msgPrime);

        // b_1 = SHA-256(b_0 || 0x01 || DST_prime)
        bytes32 bPrev = _sha256(abi.encodePacked(b0, uint8(1), dstPrime));

        uniform = new bytes(256);
        assembly {
            mstore(add(uniform, 0x20), bPrev)
        }

        // b_i = SHA-256(strxor(b_0, b_{i-1}) || I2OSP(i,1) || DST_prime)  for i=2..8
        for (uint256 i = 2; i <= 8; i++) {
            bytes32 xored = b0 ^ bPrev;
            bPrev = _sha256(abi.encodePacked(xored, uint8(i), dstPrime));
            assembly {
                // uniform[(i-1)*32 .. i*32-1]
                let offset := mul(sub(i, 1), 32)
                mstore(add(add(uniform, 0x20), offset), bPrev)
            }
        }
    }

    /// @dev SHA-256 via the precompile at address(0x02).
    function _sha256(bytes memory data) internal view returns (bytes32 result) {
        bool ok;
        bytes memory ret;
        (ok, ret) = PRECOMPILE_SHA256.staticcall(data);
        if (!ok || ret.length < 32) revert PrecompileFailed();
        assembly {
            result := mload(add(ret, 0x20))
        }
    }

    /// @dev Convert two consecutive 64-byte chunks from uniform bytes into an Fp2
    ///      element in EIP-2537 format (4 x uint256 = 128 bytes).
    ///      Each 64-byte chunk is reduced mod p via MODEXP, producing a 48-byte
    ///      field element that is zero-padded to 64 bytes (2 x uint256).
    function _uniformToFp2(bytes memory uniform, uint256 start) internal view returns (uint256[4] memory fp2) {
        // First component: uniform[start..start+64] mod p
        (fp2[0], fp2[1]) = _reduceModP(uniform, start);
        // Second component: uniform[start+64..start+128] mod p
        (fp2[2], fp2[3]) = _reduceModP(uniform, start + 64);
    }

    /// @dev Reduce a 64-byte big-endian integer mod BLS12-381 field modulus p
    ///      using the MODEXP precompile (0x05).
    ///      Returns the result as two uint256 in EIP-2537 Fp format:
    ///        hi = zero-padded high 16 bytes (128-bit value in uint256)
    ///        lo = low 32 bytes
    function _reduceModP(bytes memory data, uint256 offset) internal view returns (uint256 hi, uint256 lo) {
        bool ok;
        assembly {
            let ptr := mload(0x40)
            // MODEXP header
            mstore(ptr, 64) // base_length
            mstore(add(ptr, 0x20), 1) // exp_length
            mstore(add(ptr, 0x40), 48) // mod_length

            // Base: copy 64 bytes from data
            let src := add(add(data, 0x20), offset)
            mstore(add(ptr, 0x60), mload(src))
            mstore(add(ptr, 0x80), mload(add(src, 0x20)))

            // Exponent: 1 (1 byte)
            mstore8(add(ptr, 0xa0), 1)

            // Modulus: BLS12-381 field modulus p (48 bytes)
            // p = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab
            // First 32 bytes of p:
            mstore(add(ptr, 0xa1), 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f624)
            // Remaining 16 bytes of p (written as 32 bytes, only first 16 matter):
            mstore(add(ptr, 0xc1), 0x1eabfffeb153ffffb9feffffffffaaab00000000000000000000000000000000)

            // Total input size: 96 (header) + 64 (base) + 1 (exp) + 48 (mod) = 209 = 0xd1
            // Output: 48 bytes
            let out := add(ptr, 0x100)
            ok := staticcall(gas(), 0x05, ptr, 0xd1, out, 48)

            // Parse 48-byte result into EIP-2537 Fp format (64 bytes: 16 zero + 48 data)
            // hi = first 16 bytes of the 48-byte result (as uint256)
            // lo = last 32 bytes of the 48-byte result
            // Load 32 bytes starting at `out`: gets bytes[0..31] of the 48-byte result
            hi := shr(128, mload(out))
            // Load 32 bytes starting at `out+16`: gets bytes[16..47]
            lo := mload(add(out, 16))
        }
        if (!ok) revert PrecompileFailed();
    }

    // =========================================================================
    //  Internal: EIP-2537 precompile wrappers
    // =========================================================================

    /// @dev MAP_FP2_TO_G2 precompile (0x11): input 128 bytes (Fp2), output 256 bytes (G2).
    function _mapFp2ToG2(uint256[4] memory fp2) internal view returns (uint256[8] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, mload(fp2))
            mstore(add(ptr, 0x20), mload(add(fp2, 0x20)))
            mstore(add(ptr, 0x40), mload(add(fp2, 0x40)))
            mstore(add(ptr, 0x60), mload(add(fp2, 0x60)))
            success := staticcall(gas(), 0x11, ptr, 0x80, result, 0x100)
        }
        if (!success) revert PrecompileFailed();
    }

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

    /// @dev BLS12-381 G2 point addition via precompile 0x0d.
    function _g2Add(uint256[8] memory a, uint256[8] memory b) internal view returns (uint256[8] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, mload(a))
            mstore(add(ptr, 0x20), mload(add(a, 0x20)))
            mstore(add(ptr, 0x40), mload(add(a, 0x40)))
            mstore(add(ptr, 0x60), mload(add(a, 0x60)))
            mstore(add(ptr, 0x80), mload(add(a, 0x80)))
            mstore(add(ptr, 0xa0), mload(add(a, 0xa0)))
            mstore(add(ptr, 0xc0), mload(add(a, 0xc0)))
            mstore(add(ptr, 0xe0), mload(add(a, 0xe0)))
            mstore(add(ptr, 0x100), mload(b))
            mstore(add(ptr, 0x120), mload(add(b, 0x20)))
            mstore(add(ptr, 0x140), mload(add(b, 0x40)))
            mstore(add(ptr, 0x160), mload(add(b, 0x60)))
            mstore(add(ptr, 0x180), mload(add(b, 0x80)))
            mstore(add(ptr, 0x1a0), mload(add(b, 0xa0)))
            mstore(add(ptr, 0x1c0), mload(add(b, 0xc0)))
            mstore(add(ptr, 0x1e0), mload(add(b, 0xe0)))
            success := staticcall(gas(), 0x0d, ptr, 0x200, result, 0x100)
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
            //   byte[0] = flags | xHi_byte0  (top byte of x with flags OR'd in)
            //   byte[1..15] = remaining 15 bytes of xHi
            //   byte[16..47] = xLo (32 bytes)
            //
            // xHi is at most 128 bits (16 bytes) in the low bits of the uint256.
            // The top byte of the 16 significant bytes = xHi >> 120
            // Merge flags into top byte: (flags << 120) | (xHi & 0x00ff...ff_15bytes)
            let mask15 := 0x00ffffffffffffffffffffffffffffff
            let top16 := or(shl(120, flags), and(xHi, mask15))

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
