// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GhostVault} from "../src/GhostVault.sol";

/// @dev Vectors from `ghost_tip_test.py` (MASTER_SEED / MINT_BLS_PRIVKEY_INT in .env on the Python side).
contract GhostVaultTest is Test {
    GhostVault internal vault;

    address internal constant SPEND =
        0x9355Eb29dA61d3A94343bf76E6458b6032C8C2e6;

    // PK_mint G2: Python `print_g2` uses coeffs[0]=X_real, coeffs[1]=X_imag; precompile 0x08 wants [imag, real, imag, real].
    uint256 internal constant PK_X_IMAG =
        0x20151b545373b39ec147c998167e72c2284ee11e3b82e5f539c7361b9aaa7c13;
    uint256 internal constant PK_X_REAL =
        0x28fa1d49a2f593daf05e352c3035655acd4f36791611acb059fd0693a9182996;
    uint256 internal constant PK_Y_IMAG =
        0x1eb565ef231d53a5fb13481bece8b71ef7fbdba14f277bb40459b69d180b517;
    uint256 internal constant PK_Y_REAL =
        0xcb8535c4e3eb14c98e64c98c7d2381ba1d6da0f1850dd2685eda5a40e48615d;

    uint256 internal constant Y_X =
        0x1c6bb1f2196db102951c52ac7a37fc669bee684e589b759704cbb2669bcf3b8b;
    uint256 internal constant Y_Y =
        0x2cec5ea37b7af3714b49bab8e5e481fce4566e0103b0d018fca50480daff2341;

    uint256 internal constant S_X =
        0x937017581b5a126f39c4fd65a21331b25af3e39dd8c22fb938f3f9d092e7f3b;
    uint256 internal constant S_Y =
        0x1173c27673d294a2f4a7d4c79f36873a60f7c285af31b62d9c2f2daa090f2718;

    bytes32 internal constant R_ECDSA =
        0x503ecc985d24d99831584ce93ec5f5d7bc736cdb9206c2b557a6da7954f24455;
    bytes32 internal constant S_ECDSA =
        0x6fed309fa6b4b149a87ffd21642dfd949aac004fc40be24a02ce949980c36b4c;

    /// @dev `msg_hash = keccak256("Pay to: {destination}".encode())` then `sign_msg_hash` (eth_keys; no EIP-191).
    function _redemptionMsgHash() internal pure returns (bytes32) {
        return keccak256(bytes("Pay to: 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"));
    }

    function setUp() public {
        vault = new GhostVault();
    }

    function test_redemptionMsgHash_matchesPython() public pure {
        assertEq(
            _redemptionMsgHash(),
            0x9bdf38bf81e68f396be18ec82cd3f879e4ab09c5f488839a647283a416a9ce86
        );
    }

    function test_ecdsaRecoversSpendAddress() public pure {
        // eth_keys recovery bit 1 -> ecrecover v = 27 + 1
        address recovered = ecrecover(_redemptionMsgHash(), 28, R_ECDSA, S_ECDSA);
        assertEq(recovered, SPEND);
    }

    function test_verifyBLS_pythonVector() public view {
        uint256[2] memory sG1 = [S_X, S_Y];
        uint256[2] memory yG1 = [Y_X, Y_Y];
        uint256[4] memory pkMint = [PK_X_IMAG, PK_X_REAL, PK_Y_IMAG, PK_Y_REAL];
        assertTrue(vault.verifyBLS(sG1, yG1, pkMint));
    }

    function test_verifyRedemption_fullLifecycle_pythonVector() public view {
        uint256[2] memory sG1 = [S_X, S_Y];
        uint256[2] memory yG1 = [Y_X, Y_Y];
        uint256[4] memory pkMint = [PK_X_IMAG, PK_X_REAL, PK_Y_IMAG, PK_Y_REAL];

        assertTrue(
            vault.verifyRedemption(
                SPEND,
                _redemptionMsgHash(),
                28,
                R_ECDSA,
                S_ECDSA,
                sG1,
                yG1,
                pkMint
            )
        );
    }
}
