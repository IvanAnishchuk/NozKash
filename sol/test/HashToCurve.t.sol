// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BLS12HashToCurve} from "../src/BLS12HashToCurve.sol";
import {NozkVaultV2} from "../src/NozkVaultV2.sol";

/// @dev Wrapper to expose library + vault functions for testing.
contract HashToCurveHarness is NozkVaultV2 {
    constructor() NozkVaultV2([uint256(0), 0, 0, 0], address(1)) {}

    function exposed_hashToG2(bytes calldata message, bytes calldata dst) external view returns (uint256[8] memory) {
        return BLS12HashToCurve.hashToCurveG2(message, dst);
    }

    function exposed_hashToG2_augDST(bytes calldata message) external view returns (uint256[8] memory) {
        return _hashToG2(message);
    }

    function exposed_compressG1(uint256[4] memory p) external pure returns (bytes memory) {
        return _compressG1(p);
    }
}

/**
 * @title hash_to_curve tests — RFC 9380 full pipeline + cross-language parity
 * @notice Tests the complete hash_to_curve_G2 pipeline:
 *         expand_message_xmd → hash_to_field → MAP_FP2_TO_G2 → G2ADD
 *
 *         Mirrors ethyla/bls12-381-hash-to-curve test/hashToCurve.sol structure.
 *
 *         Key differences from ethyla:
 *           - MAP_FP2_TO_G2 precompile at 0x11 (ethyla uses 0x12, pre-spec)
 *           - G2ADD precompile at 0x0d (same as ethyla)
 *           - Returns uint256[8] (ethyla returns G2Point struct with bytes fields)
 *           - Our _compressG1 is for AugSchemeMPL (not in ethyla)
 */
contract HashToCurveTest is Test {
    /// @dev RFC 9380 test DST for BLS12-381 G2 hash-to-curve
    bytes constant G2_DST = "QUUX-V01-CS02-with-BLS12381G2_XMD:SHA-256_SSWU_RO_";

    HashToCurveHarness harness;

    function setUp() public {
        harness = new HashToCurveHarness();
    }

    // -- RFC 9380 hash_to_curve test vectors --
    // From https://datatracker.ietf.org/doc/html/rfc9380#appendix-J.10.1

    function test_hashToCurveG2_empty_msg() public view {
        uint256[8] memory P = harness.exposed_hashToG2("", G2_DST);

        // Expected P.x from RFC 9380 (BLS12381G2_XMD:SHA-256_SSWU_RO_ empty msg):
        //   x_c0 = 0x0141ebfbdca40eb85b87142e130ab689c673cf60f1a3e98d69335266f30d9b8d4ac44c1038e9dcdd5393faf5c41fb78a
        //   x_c1 = 0x05cb8437535e20ecffaef7752baddf98034139c38f603c44f39272229753c28c18b6b03db7be6c5ebb4df70c7c540c27
        assertEq(P[0], 0x000000000000000000000000000000000141ebfbdca40eb85b87142e130ab689, "P.x_c0 hi");
        assertEq(P[1], 0xc673cf60f1a3e98d69335266f30d9b8d4ac44c1038e9dcdd5393faf5c41fb78a, "P.x_c0 lo");
        assertEq(P[2], 0x0000000000000000000000000000000005cb8437535e20ecffaef7752baddf98, "P.x_c1 hi");
        assertEq(P[3], 0x034139c38452458baeefab379ba13dff5bf5dd71b72418717047f5b0f37da03d, "P.x_c1 lo");
    }

    function test_hashToCurveG2_abc() public view {
        uint256[8] memory P = harness.exposed_hashToG2("abc", G2_DST);

        // Expected P.x from RFC 9380:
        //   x_c0 = 0x02c2d18e033b960562aae3cab37a27ce00d80ccd5ba4b7fe0e7a210245129dbec7780ccc7954725f4168aff2787776e6
        assertEq(P[0], 0x0000000000000000000000000000000002c2d18e033b960562aae3cab37a27ce, "P.x_c0 hi");
        assertEq(P[1], 0x00d80ccd5ba4b7fe0e7a210245129dbec7780ccc7954725f4168aff2787776e6, "P.x_c0 lo");
    }

    // -- Cross-language parity: Python/chia_rs hash_to_g2 --

    function test_hashToG2_reveal_message_matches_python() public view {
        // Input: abi.encode(spendPub_G1) from Python test vector (128 bytes)
        // This is the reveal case — hash of the spend public key
        bytes memory revealMsg = abi.encode(
            uint256(0x00000000000000000000000000000000092d1175d20d73a88173bac37af89c7b),
            uint256(0x3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973),
            uint256(0x00000000000000000000000000000000066a676d8b1245010e5e8501679c8443),
            uint256(0xa7f8e6d01e5749a35a61a0bb0a7c15b45bc9a09d18a509635716921dec975289)
        );

        // Uses AugSchemeMPL DST (same as chia_rs g2_from_message)
        uint256[8] memory Y = harness.exposed_hashToG2_augDST(revealMsg);

        // Expected from Python: hash_to_g2(abi_encode_g1(spend_bls_pub))
        assertEq(Y[0], 0x000000000000000000000000000000000188a060d71cad5a4f2c5a40a812abc3, "Y[0]");
    }

    function test_hashToG2_redeem_augMessage_matches_python() public view {
        // Input: compress(spendPub) || msgHash (80 bytes)
        // This is the redeem case — AugSchemeMPL augmented message
        bytes memory augMsg =
            hex"892d1175d20d73a88173bac37af89c7b3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f9730000000000000000000000000000000000000000000000000000000000000000";

        uint256[8] memory Y = harness.exposed_hashToG2_augDST(augMsg);

        // Expected from Python: hash_to_g2(aug_msg)
        assertEq(Y[0], 0x00000000000000000000000000000000107580dbb90c030656fee43b54764906, "Y[0]");
        assertEq(Y[1], 0xe608a26514c18fc0cd65dd813c37dcfdd37b44ea82018af718c78d11230d2040, "Y[1]");
    }

    // -- G1 compression for AugSchemeMPL --

    function test_compressG1_matches_chia_rs() public view {
        uint256[4] memory p = [
            uint256(0x00000000000000000000000000000000092d1175d20d73a88173bac37af89c7b),
            uint256(0x3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973),
            uint256(0x00000000000000000000000000000000066a676d8b1245010e5e8501679c8443),
            uint256(0xa7f8e6d01e5749a35a61a0bb0a7c15b45bc9a09d18a509635716921dec975289)
        ];

        bytes memory compressed = harness.exposed_compressG1(p);
        assertEq(compressed.length, 48, "compressed length");

        // Expected from chia_rs: first byte 0x89 = 0x80 (compressed flag) | 0x09 (x top byte)
        // y < (p-1)/2 so sign bit (0x20) is NOT set
        assertEq(uint8(compressed[0]), 0x89, "first byte (0x80 flag | 0x09 x byte)");
        assertEq(uint8(compressed[1]), 0x2d, "second byte");
        assertEq(uint8(compressed[47]), 0x73, "last byte");
    }
}
