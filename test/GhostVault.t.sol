// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {GhostVault} from "../src/GhostVault.sol";

/// @dev Kept in lockstep with `test/vectors.json` and the pytest module that loads it (`test_mint_pk_vector`, …).
///      Forks **Sepolia** in `setUp` so precompile `0x08` and chain behavior match a live testnet (`forge test` needs RPC access).
contract GhostVaultTest is Test {
    using stdJson for string;

    GhostVault internal vault;

    string internal constant VECTORS_PATH = "test/vectors.json";

    /// @notice Pin the fork for reproducible CI; `0` = latest Sepolia head at fork time.
    function _forkSepolia() internal {
        // Public fallback; set `SEPOLIA_RPC_URL` for a private endpoint (recommended for CI).
        // Change url to https://ethereum-sepolia-rpc.publicnode.com to test against ETH Sepolia
        string memory url = vm.envOr("SEPOLIA_RPC_URL", string("https://api.avax-test.network/ext/bc/C/rpc"));
        uint256 blockNo = vm.envOr("SEPOLIA_FORK_BLOCK", uint256(0));
        if (blockNo == 0) {
            vm.createSelectFork(url);
        } else {
            vm.createSelectFork(url, blockNo);
        }
    }

    function setUp() public {
        _forkSepolia();
        vault = new GhostVault();
    }

    function _vectorsJson() internal view returns (string memory) {
        return vm.readFile(VECTORS_PATH);
    }

    function _hexU256(string memory json, string memory key) internal pure returns (uint256) {
        return vm.parseUint(string.concat("0x", json.readString(key)));
    }

    /// @dev Mirrors `test_derive_token_secrets_vector` + JSON `SPEND_ADDRESS` / `TOKEN_INDEX` / `BLINDING_R`.
    function test_vectorsJson_tokenMetadata() public view {
        string memory j = _vectorsJson();
        assertEq(j.readAddress(".SPEND_ADDRESS"), 0x9355Eb29dA61d3A94343bf76E6458b6032C8C2e6);
        assertEq(j.readUint(".TOKEN_INDEX"), 42);
        assertEq(
            j.readUint(".BLINDING_R"),
            9975352312114225588461889601612248069121371598217675252585165987882766246602
        );
        assertEq(
            j.readString(".MASTER_SEED"),
            "2b8c5855536fdf6354d78377fc1810b8c850cea4fdecd12478f31dd0f04e6671"
        );
        assertEq(
            j.readUint(".MINT_BLS_PRIVKEY_INT"),
            17087468199840458255777380070714339658210908587906447159169398321837385710467
        );
    }

    /// @dev Mirrors `test_blind_token_vector` (Y, B) and `test_mint_blind_sign_vector` / `test_unblind_signature_vector` intermediates.
    function test_vectorsJson_g1Points() public view {
        string memory j = _vectorsJson();
        assertEq(_hexU256(j, ".Y_HASH_TO_CURVE.X"), 0x1c6bb1f2196db102951c52ac7a37fc669bee684e589b759704cbb2669bcf3b8b);
        assertEq(_hexU256(j, ".Y_HASH_TO_CURVE.Y"), 0x2cec5ea37b7af3714b49bab8e5e481fce4566e0103b0d018fca50480daff2341);
        assertEq(_hexU256(j, ".B_BLINDED.X"), 0x2199699490514eba0a2b2d86646b9f5301d0ad7b12315169b880cb4b10be8257);
        assertEq(_hexU256(j, ".B_BLINDED.Y"), 0xd52d3a55b22f9e020e437e40f54ce93a6bc42b67706b1220022b23bd16abb11);
        assertEq(_hexU256(j, ".S_PRIME.X"), 0x29d627ce6e5061ed7f2a25ee5d110facceddf1c774b44e361d5a670f4f92eab5);
        assertEq(_hexU256(j, ".S_PRIME.Y"), 0x63f2b652f68c359e79c57ffc1ae330955dc8c84d7e19c4c48aef9349b6c2cc4);
        assertEq(_hexU256(j, ".S_UNBLINDED.X"), 0x937017581b5a126f39c4fd65a21331b25af3e39dd8c22fb938f3f9d092e7f3b);
        assertEq(_hexU256(j, ".S_UNBLINDED.Y"), 0x1173c27673d294a2f4a7d4c79f36873a60f7c285af31b62d9c2f2daa090f2718);
    }

    /// @dev Same pairing check as Python `pairing(G2, S) == pairing(PK_mint, Y)` against `GhostVault.verifyBLS`.
    function test_vectorsJson_verifyBLS() public view {
        string memory j = _vectorsJson();
        uint256[2] memory sG1 = [_hexU256(j, ".S_UNBLINDED.X"), _hexU256(j, ".S_UNBLINDED.Y")];
        uint256[2] memory yG1 = [_hexU256(j, ".Y_HASH_TO_CURVE.X"), _hexU256(j, ".Y_HASH_TO_CURVE.Y")];
        uint256[4] memory pkMint = [
            _hexU256(j, ".PK_MINT.X_imag"),
            _hexU256(j, ".PK_MINT.X_real"),
            _hexU256(j, ".PK_MINT.Y_imag"),
            _hexU256(j, ".PK_MINT.Y_real")
        ];
        assertTrue(vault.verifyBLS(sG1, yG1, pkMint));
    }

    /// @dev `keccak256(utf8(PAYLOAD_UTF8))` + `sign_msg_hash` (eth_keys) on the spend key from this fixture; ties ECDSA to `SPEND_ADDRESS` and BLS to the same token.
    function test_vectorsJson_verifyRedemption() public view {
        string memory j = _vectorsJson();
        bytes32 msgHash = keccak256(bytes(j.readString(".REDEMPTION.PAYLOAD_UTF8")));
        assertEq(msgHash, bytes32(_hexU256(j, ".REDEMPTION.MSG_HASH")));

        uint256[2] memory sG1 = [_hexU256(j, ".S_UNBLINDED.X"), _hexU256(j, ".S_UNBLINDED.Y")];
        uint256[2] memory yG1 = [_hexU256(j, ".Y_HASH_TO_CURVE.X"), _hexU256(j, ".Y_HASH_TO_CURVE.Y")];
        uint256[4] memory pkMint = [
            _hexU256(j, ".PK_MINT.X_imag"),
            _hexU256(j, ".PK_MINT.X_real"),
            _hexU256(j, ".PK_MINT.Y_imag"),
            _hexU256(j, ".PK_MINT.Y_real")
        ];

        assertTrue(
            vault.verifyRedemption(
                j.readAddress(".SPEND_ADDRESS"),
                msgHash,
                uint8(j.readUint(".REDEMPTION.V")),
                bytes32(_hexU256(j, ".REDEMPTION.R")),
                bytes32(_hexU256(j, ".REDEMPTION.S")),
                sG1,
                yG1,
                pkMint
            )
        );
    }
}
