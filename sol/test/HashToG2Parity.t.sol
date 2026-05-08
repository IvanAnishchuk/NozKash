// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/NozkVaultV2.sol";

/// @dev Harness to expose internal functions for parity testing.
contract NozkVaultV2Harness is NozkVaultV2 {
    constructor() NozkVaultV2([uint256(0), 0, 0, 0], address(1)) {}

    function exposed_hashToG2(bytes memory message) external view returns (uint256[8] memory) {
        return _hashToG2(message);
    }

    function exposed_expandMessageXMD(bytes memory msg_) external view returns (bytes memory) {
        return _expandMessageXMD(msg_);
    }

    function exposed_compressG1(uint256[4] memory p) external pure returns (bytes memory) {
        return _compressG1(p);
    }

    /// @dev General-purpose expand_message_xmd for RFC 9380 test vectors.
    function exposed_expandMessageXMD_withDST(
        bytes memory msg_,
        bytes memory dst,
        uint16 lenInBytes
    ) external view returns (bytes memory uniform) {
        bytes memory dstPrime = abi.encodePacked(dst, uint8(dst.length));
        bytes memory msgPrime = abi.encodePacked(new bytes(64), msg_, lenInBytes, uint8(0), dstPrime);

        bytes32 b0 = _sha256(msgPrime);
        bytes32 bPrev = _sha256(abi.encodePacked(b0, uint8(1), dstPrime));

        uint256 ell = (uint256(lenInBytes) + 31) / 32;
        uniform = new bytes(ell * 32);
        assembly {
            mstore(add(uniform, 0x20), bPrev)
        }
        for (uint256 i = 2; i <= ell; i++) {
            bytes32 xored = b0 ^ bPrev;
            bPrev = _sha256(abi.encodePacked(xored, uint8(i), dstPrime));
            assembly {
                let offset := mul(sub(i, 1), 32)
                mstore(add(add(uniform, 0x20), offset), bPrev)
            }
        }
        // Truncate to requested length
        assembly {
            mstore(uniform, lenInBytes)
        }
    }
}

contract HashToG2ParityTest is Test {
    NozkVaultV2Harness harness;

    function setUp() public {
        harness = new NozkVaultV2Harness();
    }

    /// @dev Compare expand_message_xmd output for 128-byte input (reveal case).
    function test_expandXMD_128byte_input() public view {
        // The reveal message: abi.encode(spendPub_G1) = 128 bytes
        // Using the spend pub from test vector token_0 of keypair f11c21d8
        bytes memory msg128 = abi.encode(
            uint256(0x00000000000000000000000000000000092d1175d20d73a88173bac37af89c7b),
            uint256(0x3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973),
            uint256(0x00000000000000000000000000000000066a676d8b1245010e5e8501679c8443),
            uint256(0xa7f8e6d01e5749a35a61a0bb0a7c15b45bc9a09d18a509635716921dec975289)
        );

        bytes memory uniform = harness.exposed_expandMessageXMD(msg128);
        assertEq(uniform.length, 256, "uniform length");

        // Expected b_1 from Python (first 32 bytes of uniform)
        bytes32 expected_b1 = 0x841ae8d265b45b71c085a3f91bf42041f806b084c6676474cdf2a3f1633ec6ea;
        bytes32 actual_b1;
        assembly {
            actual_b1 := mload(add(uniform, 0x20))
        }
        assertEq(actual_b1, expected_b1, "b_1 mismatch for 128-byte input");
    }

    /// @dev Compare expand_message_xmd output for 80-byte input (redeem case).
    function test_expandXMD_80byte_input() public view {
        // The augmented message: compress(spendPub) || msgHash = 48 + 32 = 80 bytes
        // compressed pk: 892d1175d20d73a88173bac37af89c7b3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973
        // msgHash: 0x0000...0000 (32 zero bytes)
        bytes memory msg80 = hex"892d1175d20d73a88173bac37af89c7b3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f9730000000000000000000000000000000000000000000000000000000000000000";

        bytes memory uniform = harness.exposed_expandMessageXMD(msg80);
        assertEq(uniform.length, 256, "uniform length");

        // Expected b_1 from Python
        bytes32 expected_b1 = 0x114cbf37cd67432c9642385014f0607c404266983bfca1251eeeef69dab87a78;
        bytes32 actual_b1;
        assembly {
            actual_b1 := mload(add(uniform, 0x20))
        }
        assertEq(actual_b1, expected_b1, "b_1 mismatch for 80-byte input");
    }

    /// @dev Compare full hashToG2 output for 128-byte reveal message.
    function test_hashToG2_revealMessage() public view {
        bytes memory msg128 = abi.encode(
            uint256(0x00000000000000000000000000000000092d1175d20d73a88173bac37af89c7b),
            uint256(0x3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973),
            uint256(0x00000000000000000000000000000000066a676d8b1245010e5e8501679c8443),
            uint256(0xa7f8e6d01e5749a35a61a0bb0a7c15b45bc9a09d18a509635716921dec975289)
        );

        uint256[8] memory Y = harness.exposed_hashToG2(msg128);

        // Expected from Python: hash_to_g2(abi_encode_g1(spend_bls_pub))
        // for token 0 of seed e2e_test_seed_anvil
        assertEq(Y[0], 0x000000000000000000000000000000000188a060d71cad5a4f2c5a40a812abc3, "Y[0]");
    }

    /// @dev Compare G1 compression with chia_rs output.
    function test_compressG1() public view {
        uint256[4] memory p = [
            uint256(0x00000000000000000000000000000000092d1175d20d73a88173bac37af89c7b),
            uint256(0x3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973),
            uint256(0x00000000000000000000000000000000066a676d8b1245010e5e8501679c8443),
            uint256(0xa7f8e6d01e5749a35a61a0bb0a7c15b45bc9a09d18a509635716921dec975289)
        ];

        bytes memory compressed = harness.exposed_compressG1(p);
        assertEq(compressed.length, 48, "compressed length");

        // Expected from chia_rs: 892d1175d20d73a8...
        assertEq(uint8(compressed[0]), 0x89, "first byte should be 0x89 (0x80 flag | 0x09)");
        assertEq(uint8(compressed[1]), 0x2d, "second byte");
    }

    // -- RFC 9380 official test vectors for expand_message_xmd --
    // https://datatracker.ietf.org/doc/html/rfc9380#name-expand_message_xmdsha-256
    // DST: "QUUX-V01-CS02-with-expander-SHA256-128"

    function test_expandXMD_rfc9380_empty_msg_32bytes() public view {
        bytes memory uniform = harness.exposed_expandMessageXMD_withDST(
            "", "QUUX-V01-CS02-with-expander-SHA256-128", 32
        );
        assertEq(uniform.length, 32);
        bytes32 expected = 0x68a985b87eb6b46952128911f2a4412bbc302a9d759667f87f7a21d803f07235;
        bytes32 actual;
        assembly { actual := mload(add(uniform, 0x20)) }
        assertEq(actual, expected, "RFC 9380 expand_xmd empty/32");
    }

    function test_expandXMD_rfc9380_abc_32bytes() public view {
        bytes memory uniform = harness.exposed_expandMessageXMD_withDST(
            "abc", "QUUX-V01-CS02-with-expander-SHA256-128", 32
        );
        bytes32 expected = 0xd8ccab23b5985ccea865c6c97b6e5b8350e794e603b4b97902f53a8a0d605615;
        bytes32 actual;
        assembly { actual := mload(add(uniform, 0x20)) }
        assertEq(actual, expected, "RFC 9380 expand_xmd abc/32");
    }

    function test_expandXMD_rfc9380_abc_128bytes() public view {
        bytes memory uniform = harness.exposed_expandMessageXMD_withDST(
            "abc", "QUUX-V01-CS02-with-expander-SHA256-128", 128
        );
        assertEq(uniform.length, 128);
        // First 32 bytes
        bytes32 expected_b1 = 0xabba86a6129e366fc877aab32fc4ffc70120d8996c88aee2fe4b32d6c7b6437a;
        bytes32 actual_b1;
        assembly { actual_b1 := mload(add(uniform, 0x20)) }
        assertEq(actual_b1, expected_b1, "RFC 9380 expand_xmd abc/128 b_1");
    }

    // -- Cross-language parity tests --

    /// @dev Full hashToG2 for 80-byte augmented message (redeem case).
    function test_hashToG2_augMessage() public view {
        bytes memory msg80 = hex"892d1175d20d73a88173bac37af89c7b3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f9730000000000000000000000000000000000000000000000000000000000000000";

        uint256[8] memory Y = harness.exposed_hashToG2(msg80);

        // Expected from Python: hash_to_g2(aug_msg) where aug_msg = pk_compressed || 32_zero_bytes
        assertEq(Y[0], 0x00000000000000000000000000000000107580dbb90c030656fee43b54764906, "Y[0]");
        assertEq(Y[1], 0xe608a26514c18fc0cd65dd813c37dcfdd37b44ea82018af718c78d11230d2040, "Y[1]");
    }
}
