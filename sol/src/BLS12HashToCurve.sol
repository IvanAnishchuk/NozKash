// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

/**
 * @title BLS12HashToCurve — RFC 9380 hash-to-curve for BLS12-381
 * @notice Implements hash_to_curve for BLS12-381 G2 using EIP-2537 precompiles.
 *
 *         Follows RFC 9380 (Hashing to Elliptic Curves):
 *           1. expand_message_xmd (SHA-256)     — section 5.3.1
 *           2. hash_to_field (mod p reduction)  — section 5.2
 *           3. map_to_curve (MAP_FP2_TO_G2)     — via EIP-2537 precompile
 *           4. G2ADD to combine two mapped points
 *
 *         Functionally equivalent to ethyla/bls12-381-hash-to-curve but with
 *         corrected EIP-2537 precompile addresses per the final Pectra spec.
 *
 *         Key differences from ethyla/bls12-381-hash-to-curve:
 *           ┌──────────────────┬─────────────────┬──────────────────────┐
 *           │ Operation        │ ethyla (pre-spec)│ This (final Pectra)  │
 *           ├──────────────────┼─────────────────┼──────────────────────┤
 *           │ G1ADD            │ 0x0a            │ 0x0b                 │
 *           │ G1MSM            │ (not used)      │ 0x0c                 │
 *           │ G2ADD            │ 0x0d            │ 0x0d  (same)         │
 *           │ PAIRING          │ (not used)      │ 0x0f                 │
 *           │ MAP_FP_TO_G1     │ 0x11            │ 0x10                 │
 *           │ MAP_FP2_TO_G2    │ 0x12            │ 0x11                 │
 *           └──────────────────┴─────────────────┴──────────────────────┘
 *
 *         Additionally, this library:
 *           - Uses a 48-byte modulus in MODEXP (ethyla uses 64-byte zero-padded)
 *           - Returns uint256[8] (ethyla returns bytes32[8] / G2Point struct)
 *           - Provides a DST-parameterized expandMsgXmd for flexibility
 *
 * @dev    EIP-2537 precompile addresses (final Pectra spec, EIP merged 2024):
 *           0x02  SHA-256            0x0b  G1ADD         0x0f  PAIRING
 *           0x05  MODEXP             0x0c  G1MSM         0x10  MAP_FP_TO_G1
 *                                    0x0d  G2ADD         0x11  MAP_FP2_TO_G2
 *                                    0x0e  G2MSM
 */
library BLS12HashToCurve {
    // =========================================================================
    //  Errors
    // =========================================================================

    error PrecompileFailed();

    // =========================================================================
    //  Constants
    // =========================================================================

    /// @dev BLS12-381 field modulus p (381 bits, 48 bytes).
    ///      p = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab
    ///      Same value used by ethyla, py_ecc, blst, and the EIP-2537 spec.
    uint256 internal constant P_HI = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f624;
    uint256 internal constant P_LO = 0x1eabfffeb153ffffb9feffffffffaaab;

    /// @dev EIP-2537 precompile addresses — final Pectra spec.
    ///      These differ from ethyla's pre-spec addresses (see table above).
    address internal constant PRECOMPILE_SHA256 = address(0x02);
    address internal constant PRECOMPILE_MODEXP = address(0x05);
    address internal constant BLS12_G2ADD = address(0x0d); // same as ethyla
    address internal constant BLS12_MAP_FP2_TO_G2 = address(0x11); // ethyla uses 0x12

    // =========================================================================
    //  hash_to_curve (top-level)
    // =========================================================================

    /// @notice Hash an arbitrary message to a BLS12-381 G2 point (RFC 9380).
    /// @param message The message to hash.
    /// @param dst Domain separation tag (at most 255 bytes).
    /// @return 8 uint256 in EIP-2537 G2 encoding.
    function hashToCurveG2(bytes memory message, bytes memory dst) internal view returns (uint256[8] memory) {
        // 1. uniform_bytes = expand_message_xmd(msg, DST, 256)
        bytes memory uniform = expandMsgXmd(message, dst, 256);

        // 2. hash_to_field: 4 x 64-byte chunks → two Fp2 elements
        //    u0 = Fp2(reduce(uniform[0:64]),   reduce(uniform[64:128]))
        //    u1 = Fp2(reduce(uniform[128:192]), reduce(uniform[192:256]))
        uint256[4] memory u0 = hashToFieldFp2(uniform, 0);
        uint256[4] memory u1 = hashToFieldFp2(uniform, 128);

        // 3. Q0 = MAP_FP2_TO_G2(u0), Q1 = MAP_FP2_TO_G2(u1)
        uint256[8] memory Q0 = mapFp2ToG2(u0);
        uint256[8] memory Q1 = mapFp2ToG2(u1);

        // 4. return G2ADD(Q0, Q1)
        return g2Add(Q0, Q1);
    }

    // =========================================================================
    //  expand_message_xmd (RFC 9380 section 5.3.1)
    // =========================================================================

    /// @notice expand_message_xmd with SHA-256, per RFC 9380 section 5.3.1.
    /// @dev Identical algorithm to ethyla's expandMsgXmd. Uses sha256() builtin
    ///      (which calls the SHA-256 precompile at 0x02 under the hood).
    /// @param message Arbitrary-length byte string to hash.
    /// @param dst Domain separation tag (at most 255 bytes).
    /// @param lenInBytes Requested output length (must be a multiple of 32, at most 8160).
    /// @return Pseudo-random bytes of length lenInBytes.
    function expandMsgXmd(bytes memory message, bytes memory dst, uint16 lenInBytes)
        internal
        pure
        returns (bytes memory)
    {
        // 1. ell = ceil(len_in_bytes / b_in_bytes)  where b_in_bytes = 32 for SHA-256
        uint256 ell = (uint256(lenInBytes) + 31) / 32;
        require(ell <= 255, "BLS12HashToCurve: ell > 255");

        // 2. DST_prime = DST || I2OSP(len(DST), 1)
        bytes memory dstPrime = abi.encodePacked(dst, uint8(dst.length));

        // 3. Z_pad = I2OSP(0, 64)  (SHA-256 block size = 64 bytes)
        // 4. l_i_b_str = I2OSP(len_in_bytes, 2)
        // 5. msg_prime = Z_pad || msg || l_i_b_str || I2OSP(0, 1) || DST_prime
        bytes memory msgPrime = abi.encodePacked(new bytes(64), message, lenInBytes, uint8(0), dstPrime);

        // 6. b_0 = H(msg_prime)
        bytes32 b0 = sha256(msgPrime);

        // 7. b_1 = H(b_0 || I2OSP(1, 1) || DST_prime)
        bytes32 bPrev = sha256(abi.encodePacked(b0, uint8(1), dstPrime));

        bytes memory uniform = new bytes(ell * 32);
        assembly {
            mstore(add(uniform, 0x20), bPrev)
        }

        // 8. for i in (2, ..., ell):
        //      b_i = H(strxor(b_0, b_{i-1}) || I2OSP(i, 1) || DST_prime)
        for (uint256 i = 2; i <= ell; i++) {
            bytes32 xored = b0 ^ bPrev;
            bPrev = sha256(abi.encodePacked(xored, uint8(i), dstPrime));
            assembly {
                let offset := mul(sub(i, 1), 32)
                mstore(add(add(uniform, 0x20), offset), bPrev)
            }
        }

        // 9. return substr(uniform_bytes, 0, len_in_bytes)
        assembly {
            mstore(uniform, lenInBytes)
        }
        return uniform;
    }

    // =========================================================================
    //  hash_to_field (RFC 9380 section 5.2)
    // =========================================================================

    /// @notice Convert two consecutive 64-byte chunks from uniform bytes into
    ///         an Fp2 element in EIP-2537 format (4 x uint256 = 128 bytes).
    /// @dev Each 64-byte chunk is reduced mod p via MODEXP precompile.
    ///      ethyla's equivalent: _modfield returns bytes32[2]; ours returns (uint256, uint256).
    function hashToFieldFp2(bytes memory uniform, uint256 start) internal view returns (uint256[4] memory fp2) {
        (fp2[0], fp2[1]) = reduceModP(uniform, start);
        (fp2[2], fp2[3]) = reduceModP(uniform, start + 64);
    }

    /// @notice Reduce a 64-byte big-endian integer mod BLS12-381 field modulus p.
    /// @dev Uses MODEXP precompile (0x05) with base_length=64, exp=1, mod_length=48.
    ///      ethyla uses mod_length=64 (zero-padded p) and returns bytes32[2].
    ///      We use mod_length=48 (exact p) and return (uint256 hi, uint256 lo)
    ///      in EIP-2537 Fp format: hi = top 16 bytes, lo = bottom 32 bytes.
    function reduceModP(bytes memory data, uint256 offset) internal view returns (uint256 hi, uint256 lo) {
        bool ok;
        assembly {
            let ptr := mload(0x40)
            // MODEXP input header (96 bytes)
            mstore(ptr, 64) // base_length
            mstore(add(ptr, 0x20), 1) // exp_length
            mstore(add(ptr, 0x40), 48) // mod_length (ethyla uses 64)

            // Base: 64 bytes from uniform[offset..offset+64]
            let src := add(add(data, 0x20), offset)
            mstore(add(ptr, 0x60), mload(src))
            mstore(add(ptr, 0x80), mload(add(src, 0x20)))

            // Exponent: 1 (1 byte)
            mstore8(add(ptr, 0xa0), 1)

            // Modulus: BLS12-381 field modulus p (48 bytes)
            mstore(add(ptr, 0xa1), P_HI)
            mstore(add(ptr, 0xc1), shl(128, P_LO))

            // Input: 96 + 64 + 1 + 48 = 209 bytes. Output: 48 bytes.
            let out := add(ptr, 0x100)
            ok := staticcall(gas(), 0x05, ptr, 0xd1, out, 48)

            // Parse 48-byte result → EIP-2537 Fp (hi: top 16 bytes, lo: bottom 32 bytes)
            hi := shr(128, mload(out))
            lo := mload(add(out, 16))
        }
        if (!ok) revert PrecompileFailed();
    }

    // =========================================================================
    //  EIP-2537 precompile wrappers
    // =========================================================================

    /// @notice MAP_FP2_TO_G2 precompile (0x11): Fp2 element → G2 point.
    /// @dev Input: 128 bytes (Fp2). Output: 256 bytes (G2).
    ///      Implements Simplified SWU + 3-isogeny + cofactor clearing.
    ///      ethyla uses address 0x12 (pre-spec); we use 0x11 (final Pectra).
    function mapFp2ToG2(uint256[4] memory fp2) internal view returns (uint256[8] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, mload(fp2))
            mstore(add(ptr, 0x20), mload(add(fp2, 0x20)))
            mstore(add(ptr, 0x40), mload(add(fp2, 0x40)))
            mstore(add(ptr, 0x60), mload(add(fp2, 0x60)))
            // ethyla: staticcall(200000, 0x12, ...) — pre-spec address
            // Ours:   staticcall(gas(),  0x11, ...) — final Pectra address
            success := staticcall(gas(), 0x11, ptr, 0x80, result, 0x100)
        }
        if (!success) revert PrecompileFailed();
    }

    /// @notice G2 point addition via precompile 0x0d.
    /// @dev Input: 512 bytes (two G2 points). Output: 256 bytes (one G2 point).
    ///      Same address as ethyla (0x0d).
    function g2Add(uint256[8] memory a, uint256[8] memory b) internal view returns (uint256[8] memory result) {
        bool success;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // Copy a (256 bytes)
            mstore(ptr, mload(a))
            mstore(add(ptr, 0x20), mload(add(a, 0x20)))
            mstore(add(ptr, 0x40), mload(add(a, 0x40)))
            mstore(add(ptr, 0x60), mload(add(a, 0x60)))
            mstore(add(ptr, 0x80), mload(add(a, 0x80)))
            mstore(add(ptr, 0xa0), mload(add(a, 0xa0)))
            mstore(add(ptr, 0xc0), mload(add(a, 0xc0)))
            mstore(add(ptr, 0xe0), mload(add(a, 0xe0)))
            // Copy b (256 bytes)
            mstore(add(ptr, 0x100), mload(b))
            mstore(add(ptr, 0x120), mload(add(b, 0x20)))
            mstore(add(ptr, 0x140), mload(add(b, 0x40)))
            mstore(add(ptr, 0x160), mload(add(b, 0x60)))
            mstore(add(ptr, 0x180), mload(add(b, 0x80)))
            mstore(add(ptr, 0x1a0), mload(add(b, 0xa0)))
            mstore(add(ptr, 0x1c0), mload(add(b, 0xc0)))
            mstore(add(ptr, 0x1e0), mload(add(b, 0xe0)))
            // staticcall(gas, 0x0d, inOffset, 512, outOffset, 256)
            success := staticcall(gas(), 0x0d, ptr, 0x200, result, 0x100)
        }
        if (!success) revert PrecompileFailed();
    }
}
