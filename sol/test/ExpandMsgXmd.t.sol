// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {BLS12HashToCurve} from "../src/BLS12HashToCurve.sol";

/// @dev Wrapper to expose library functions for testing.
contract ExpandMsgXmdHarness {
    function expandMsgXmd(bytes calldata message, bytes calldata dst, uint16 lenInBytes)
        external
        pure
        returns (bytes memory)
    {
        return BLS12HashToCurve.expandMsgXmd(message, dst, lenInBytes);
    }
}

/**
 * @title expand_message_xmd tests — RFC 9380 section 5.3.1
 * @notice Test vectors from RFC 9380 section 10.1:
 *         https://datatracker.ietf.org/doc/html/rfc9380#name-expand_message_xmdsha-256
 *
 *         Mirrors ethyla/bls12-381-hash-to-curve test/expandMsgXmd.sol structure.
 *
 *         Key differences from ethyla:
 *           - Our expandMsgXmd uses sha256() builtin (same as ethyla)
 *           - We accept (bytes memory, bytes memory, uint16) vs ethyla's (bytes calldata, bytes calldata, uint16)
 *           - We return bytes memory; ethyla returns bytes32[]
 *           - Algorithm is identical: RFC 9380 section 5.3.1 with SHA-256
 */
contract ExpandMsgXmdTest is Test {
    /// @dev RFC 9380 test DST
    bytes constant DST = "QUUX-V01-CS02-with-expander-SHA256-128";

    ExpandMsgXmdHarness harness;

    function setUp() public {
        harness = new ExpandMsgXmdHarness();
    }

    // -- 32-byte output tests (RFC 9380 section 10.1, len_in_bytes = 0x20) --

    function test_empty_msg_32bytes() public view {
        bytes memory result = harness.expandMsgXmd("", DST, 0x20);
        assertEq(result, hex"68a985b87eb6b46952128911f2a4412bbc302a9d759667f87f7a21d803f07235");
    }

    function test_abc_32bytes() public view {
        bytes memory result = harness.expandMsgXmd("abc", DST, 0x20);
        assertEq(result, hex"d8ccab23b5985ccea865c6c97b6e5b8350e794e603b4b97902f53a8a0d605615");
    }

    function test_abcdef0123456789_32bytes() public view {
        bytes memory result = harness.expandMsgXmd("abcdef0123456789", DST, 0x20);
        assertEq(result, hex"eff31487c770a893cfb36f912fbfcbff40d5661771ca4b2cb4eafe524333f5c1");
    }

    function test_q128_32bytes() public view {
        bytes memory result = harness.expandMsgXmd(
            "q128_qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
            DST,
            0x20
        );
        assertEq(result, hex"b23a1d2b4d97b2ef7785562a7e8bac7eed54ed6e97e29aa51bfe3f12ddad1ff9");
    }

    function test_a512_32bytes() public view {
        bytes memory result = harness.expandMsgXmd(
            "a512_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            DST,
            0x20
        );
        assertEq(result, hex"4623227bcc01293b8c130bf771da8c298dede7383243dc0993d2d94823958c4c");
    }

    // -- 128-byte output tests (RFC 9380 section 10.1, len_in_bytes = 0x80) --

    function test_empty_msg_128bytes() public view {
        bytes memory result = harness.expandMsgXmd("", DST, 0x80);
        assertEq(
            result,
            hex"af84c27ccfd45d41914fdff5df25293e221afc53d8ad2ac06d5e3e29485dadbee0d121587713a3e0dd4d5e69e93eb7cd4f5df4cd103e188cf60cb02edc3edf18eda8576c412b18ffb658e3dd6ec849469b979d444cf7b26911a08e63cf31f9dcc541708d3491184472c2c29bb749d4286b004ceb5ee6b9a7fa5b646c993f0ced"
        );
    }

    function test_abc_128bytes() public view {
        bytes memory result = harness.expandMsgXmd("abc", DST, 0x80);
        assertEq(
            result,
            hex"abba86a6129e366fc877aab32fc4ffc70120d8996c88aee2fe4b32d6c7b6437a647e6c3163d40b76a73cf6a5674ef1d890f95b664ee0afa5359a5c4e07985635bbecbac65d747d3d2da7ec2b8221b17b0ca9dc8a1ac1c07ea6a1e60583e2cb00058e77b7b72a298425cd1b941ad4ec65e8afc50303a22c0f99b0509b4c895f40"
        );
    }

    // -- 256-byte output (what hashToCurveG2 uses) --

    function test_empty_msg_256bytes() public view {
        bytes memory result = harness.expandMsgXmd("", DST, 256);
        assertEq(result.length, 256);
        // b_1 differs from 128-byte case because len_in_bytes is encoded in msg_prime
        bytes32 b1;
        assembly {
            b1 := mload(add(result, 0x20))
        }
        assertEq(b1, hex"3073e1b902726addc43119420b24e9c28199dd172c78fd797e79c8809be5fc3e");
    }
}
