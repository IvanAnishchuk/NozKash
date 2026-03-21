// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {GhostVault} from "../src/GhostVault.sol";

/// @dev Kept in lockstep with `test/vectors.json`. Forks a live network in `setUp` so precompile `0x08` matches production.
contract GhostVaultTest is Test {
    using stdJson for string;

    GhostVault internal vault;

    string internal constant VECTORS_PATH = "test/vectors.json";

    uint256 internal constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    event MintFulfilled(uint256 indexed depositId, uint256[2] blindedSignature);

    function _forkSepolia() internal {
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
        string memory j = vm.readFile(VECTORS_PATH);
        uint256[4] memory pkMint = [
            _hexU256(j, ".PK_MINT.X_imag"),
            _hexU256(j, ".PK_MINT.X_real"),
            _hexU256(j, ".PK_MINT.Y_imag"),
            _hexU256(j, ".PK_MINT.Y_real")
        ];
        bytes32 domain = bytes32(_hexU256(j, ".REDEEM_INTEGRATION.BLS_DOMAIN"));
        vault = new GhostVault(pkMint, domain);
    }

    function _vectorsJson() internal view returns (string memory) {
        return vm.readFile(VECTORS_PATH);
    }

    function _hexU256(string memory json, string memory key) internal pure returns (uint256) {
        return vm.parseUint(string.concat("0x", json.readString(key)));
    }

    function _hexBytes(string memory json, string memory key) internal pure returns (bytes memory) {
        return vm.parseBytes(string.concat("0x", json.readString(key)));
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

    function test_vectorsJson_redeemIntegration_hashAndMsg() public view {
        string memory j = _vectorsJson();
        address recipient = j.readAddress(".REDEEM_INTEGRATION.RECIPIENT");
        assertEq(
            vault.redemptionMessageHash(recipient),
            bytes32(_hexU256(j, ".REDEEM_INTEGRATION.MSG_HASH"))
        );
        address spend = j.readAddress(".REDEEM_INTEGRATION.SPEND_ADDRESS");
        uint256[2] memory y = vault.hashNullifierPoint(spend);
        assertEq(y[0], _hexU256(j, ".REDEEM_INTEGRATION.Y_FROM_H2C.X"));
        assertEq(y[1], _hexU256(j, ".REDEEM_INTEGRATION.Y_FROM_H2C.Y"));
    }

    function test_hashNullifierPointOnCurve() public view {
        string memory j = _vectorsJson();
        address spend = j.readAddress(".REDEEM_INTEGRATION.SPEND_ADDRESS");
        uint256[2] memory y = vault.hashNullifierPoint(spend);
        uint256 x = y[0];
        uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), 3, P);
        assertEq(mulmod(y[1], y[1], P), rhs);
    }

    function test_deposit_acceptsExactDenominationAndLocksEth() public {
        string memory j = _vectorsJson();
        uint256[2] memory b = [_hexU256(j, ".B_BLINDED.X"), _hexU256(j, ".B_BLINDED.Y")];
        address user = address(0xCAFE);
        vm.warp(1_717_000_000);
        vm.deal(user, 1 ether);

        vm.prank(user);
        vault.deposit{value: vault.DENOMINATION()}(b);

        assertEq(address(vault).balance, vault.DENOMINATION());
    }

    function test_deposit_revertsWhenWrongValue() public {
        string memory j = _vectorsJson();
        uint256[2] memory b = [_hexU256(j, ".B_BLINDED.X"), _hexU256(j, ".B_BLINDED.Y")];
        vm.deal(address(this), 1 ether);
        vm.expectRevert(GhostVault.InvalidValue.selector);
        vault.deposit{value: 0}(b);
    }

    function test_announce_emitsMintFulfilled() public {
        string memory j = _vectorsJson();
        uint256[2] memory sPrime = [_hexU256(j, ".S_PRIME.X"), _hexU256(j, ".S_PRIME.Y")];
        uint256 depositId = 0xabc123;

        vm.expectEmit(true, true, true, true);
        emit MintFulfilled(depositId, sPrime);
        vault.announce(depositId, sPrime);
    }

    function test_redeem_succeedsAgainstVectors() public {
        string memory j = _vectorsJson();
        address recipient = j.readAddress(".REDEEM_INTEGRATION.RECIPIENT");
        bytes memory sig = _hexBytes(j, ".REDEEM_INTEGRATION.SPEND_SIGNATURE_HEX");
        uint256[2] memory sG1 = [
            _hexU256(j, ".REDEEM_INTEGRATION.S_UNBLINDED_FOR_H2C.X"),
            _hexU256(j, ".REDEEM_INTEGRATION.S_UNBLINDED_FOR_H2C.Y")
        ];

        vm.deal(address(vault), vault.DENOMINATION());
        uint256 balBefore = recipient.balance;

        vault.redeem(recipient, sig, sG1);

        assertEq(recipient.balance - balBefore, vault.DENOMINATION());
        assertTrue(vault.spentNullifiers(j.readAddress(".REDEEM_INTEGRATION.SPEND_ADDRESS")));
    }

    function test_redeem_revertsDoubleSpend() public {
        string memory j = _vectorsJson();
        address recipient = j.readAddress(".REDEEM_INTEGRATION.RECIPIENT");
        bytes memory sig = _hexBytes(j, ".REDEEM_INTEGRATION.SPEND_SIGNATURE_HEX");
        uint256[2] memory sG1 = [
            _hexU256(j, ".REDEEM_INTEGRATION.S_UNBLINDED_FOR_H2C.X"),
            _hexU256(j, ".REDEEM_INTEGRATION.S_UNBLINDED_FOR_H2C.Y")
        ];

        vm.deal(address(vault), 2 * vault.DENOMINATION());
        vault.redeem(recipient, sig, sG1);

        vm.expectRevert(GhostVault.AlreadySpent.selector);
        vault.redeem(recipient, sig, sG1);
    }

    function test_redeem_revertsInvalidECDSA() public {
        string memory j = _vectorsJson();
        address recipient = j.readAddress(".REDEEM_INTEGRATION.RECIPIENT");
        uint256[2] memory sG1 = [
            _hexU256(j, ".REDEEM_INTEGRATION.S_UNBLINDED_FOR_H2C.X"),
            _hexU256(j, ".REDEEM_INTEGRATION.S_UNBLINDED_FOR_H2C.Y")
        ];
        bytes memory badSig = new bytes(65);
        for (uint256 i; i < 65; i++) {
            badSig[i] = 0xab;
        }

        vm.deal(address(vault), vault.DENOMINATION());
        vm.expectRevert(GhostVault.InvalidECDSA.selector);
        vault.redeem(recipient, badSig, sG1);
    }

    function test_redeem_revertsInvalidBLS() public {
        string memory j = _vectorsJson();
        address recipient = j.readAddress(".REDEEM_INTEGRATION.RECIPIENT");
        bytes memory sig = _hexBytes(j, ".REDEEM_INTEGRATION.SPEND_SIGNATURE_HEX");
        uint256[2] memory badS = [uint256(1), uint256(2)];

        vm.deal(address(vault), vault.DENOMINATION());
        vm.expectRevert(GhostVault.InvalidBLS.selector);
        vault.redeem(recipient, sig, badS);
    }
}
