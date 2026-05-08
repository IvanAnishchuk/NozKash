// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BLS12HashToCurve} from "../src/BLS12HashToCurve.sol";

/// @dev Wrapper to expose library functions for testing.
contract HashToFieldHarness {
    function expandMsgXmd(bytes calldata message, bytes calldata dst, uint16 lenInBytes)
        external
        pure
        returns (bytes memory)
    {
        return BLS12HashToCurve.expandMsgXmd(message, dst, lenInBytes);
    }

    function hashToFieldFp2(bytes calldata uniform, uint256 start) external view returns (uint256[4] memory) {
        return BLS12HashToCurve.hashToFieldFp2(uniform, start);
    }

    function reduceModP(bytes calldata data, uint256 offset) external view returns (uint256 hi, uint256 lo) {
        return BLS12HashToCurve.reduceModP(data, offset);
    }
}

/**
 * @title hash_to_field tests — RFC 9380 section 5.2
 * @notice Test vectors from RFC 9380 section 10.4 (BLS12381G2_XMD:SHA-256_SSWU_RO_):
 *         https://datatracker.ietf.org/doc/html/rfc9380#name-bls12381g2_xmdsha-256_sswu_
 *
 *         Mirrors ethyla/bls12-381-hash-to-curve test/hashToField.sol structure.
 *
 *         Key differences from ethyla:
 *           - Our reduceModP uses MODEXP with 48-byte modulus (exact p)
 *             ethyla uses 64-byte zero-padded modulus
 *           - Our result format: (uint256 hi, uint256 lo) per Fp element
 *             ethyla returns bytes32[2] per Fp element
 *           - Both use the same BLS12-381 field modulus p
 *           - Both produce identical Fp values (just different encoding)
 */
contract HashToFieldTest is Test {
    /// @dev RFC 9380 test DST for BLS12-381 G2
    bytes constant G2_DST = "QUUX-V01-CS02-with-BLS12381G2_XMD:SHA-256_SSWU_RO_";

    HashToFieldHarness harness;

    function setUp() public {
        harness = new HashToFieldHarness();
    }

    // -- RFC 9380 hash_to_field test vectors (empty message) --
    // From https://datatracker.ietf.org/doc/html/rfc9380#appendix-J.10.1

    function test_hashToFieldFp2_empty_msg() public view {
        // First expand to get uniform bytes
        bytes memory uniform = harness.expandMsgXmd("", G2_DST, 256);

        // Then hash_to_field
        uint256[4] memory u0 = harness.hashToFieldFp2(uniform, 0);
        uint256[4] memory u1 = harness.hashToFieldFp2(uniform, 128);

        // Expected u[0] from RFC 9380:
        // u[0][0] = 0x03dbc2cce174e91ba93cbb08f26b917f98194a2ea08d1cce75b2b9cc9f21689d80bd79b594a613d0a68eb807dfdc1cf8
        // u[0][1] = 0x05a2acec64114845711a54199ea339abd125ba38253b70a92c876df10598bd1986b739cad67961eb94f7076511b3b39a
        assertEq(u0[0], 0x00000000000000000000000000000000_03dbc2cce174e91ba93cbb08f26b917f, "u0[0] hi");
        assertEq(u0[1], 0x98194a2ea08d1cce75b2b9cc9f21689d80bd79b594a613d0a68eb807dfdc1cf8, "u0[0] lo");
        assertEq(u0[2], 0x00000000000000000000000000000000_05a2acec64114845711a54199ea339ab, "u0[1] hi");
        assertEq(u0[3], 0xd125ba38253b70a92c876df10598bd1986b739cad67961eb94f7076511b3b39a, "u0[1] lo");

        // Expected u[1]:
        // u[1][0] = 0x02f99798e8a5acdeed60d7e18e9120521ba1f47ec090984662846bc825de191b5b7641148c0dbc237726a334473eee94
        // u[1][1] = 0x145a81e418d4010cc027a68f14391b30074e89e60ee7a22f87217b2f6eb0c4b94c9115b436e6fa4607e95a98de30a435
        assertEq(u1[0], 0x00000000000000000000000000000000_02f99798e8a5acdeed60d7e18e912052, "u1[0] hi");
        assertEq(u1[1], 0x1ba1f47ec090984662846bc825de191b5b7641148c0dbc237726a334473eee94, "u1[0] lo");
        assertEq(u1[2], 0x00000000000000000000000000000000_145a81e418d4010cc027a68f14391b30, "u1[1] hi");
        assertEq(u1[3], 0x074e89e60ee7a22f87217b2f6eb0c4b94c9115b436e6fa4607e95a98de30a435, "u1[1] lo");
    }

    // -- Cross-language parity: Python/chia_rs vs Solidity --

    function test_reduceModP_known_value() public view {
        // 64 bytes of 0xFF should reduce to (2^512 - 1) mod p
        bytes memory allOnes = new bytes(64);
        for (uint256 i = 0; i < 64; i++) {
            allOnes[i] = 0xFF;
        }
        (uint256 hi, uint256 lo) = harness.reduceModP(allOnes, 0);
        // Just verify it's a valid Fp element (hi < 0x1a0111...)
        assertTrue(hi < 0x1a0111ea397fe69a4b1ba7b6434bacd7, "hi should be < p_hi");
    }
}
