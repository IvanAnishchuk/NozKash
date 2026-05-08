// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/NozkVaultV2.sol";

/**
 * @title NozkVaultV2 Test Suite
 * @notice Tests for BLS12-381 standard scheme (PK=G1, Sig=G2).
 *         Requires EIP-2537 precompile support (Pectra / Prague EVM).
 */
contract NozkVaultV2Test is Test {
    NozkVaultV2 vault;
    address deployer = address(0xDEAD);
    address mintAuth = address(0xBEEF);

    // -- Test vector data (loaded in setUp) --
    string vectorSuite;
    string[] keypairDirs;
    uint256[] tokenIndices;

    function setUp() public {
        vectorSuite = "../test_vectors";
        string memory manifest = vm.readFile(string.concat(vectorSuite, "/manifest.json"));
        keypairDirs = vm.parseJsonStringArray(manifest, ".keypairs");
        uint256[] memory rawIndices = vm.parseJsonUintArray(manifest, ".indices");
        tokenIndices = rawIndices;
    }

    // -- Helpers --

    function _tokenFile(string memory kpDir, uint256 idx) internal view returns (string memory) {
        return string.concat(vectorSuite, "/", kpDir, "/token_", vm.toString(idx), ".json");
    }

    function _hexU256(string memory j, string memory path) internal pure returns (uint256) {
        return vm.parseUint(vm.parseJsonString(j, path));
    }

    function _loadPkMint(string memory j) internal pure returns (uint256[4] memory pk) {
        pk[0] = _hexU256(j, ".PK_MINT.x_hi");
        pk[1] = _hexU256(j, ".PK_MINT.x_lo");
        pk[2] = _hexU256(j, ".PK_MINT.y_hi");
        pk[3] = _hexU256(j, ".PK_MINT.y_lo");
    }

    function _loadG1(string memory j, string memory prefix) internal pure returns (uint256[4] memory p) {
        p[0] = _hexU256(j, string.concat(prefix, ".x_hi"));
        p[1] = _hexU256(j, string.concat(prefix, ".x_lo"));
        p[2] = _hexU256(j, string.concat(prefix, ".y_hi"));
        p[3] = _hexU256(j, string.concat(prefix, ".y_lo"));
    }

    function _loadG2(string memory j, string memory prefix) internal pure returns (uint256[8] memory p) {
        p[0] = _hexU256(j, string.concat(prefix, ".x_c0_hi"));
        p[1] = _hexU256(j, string.concat(prefix, ".x_c0_lo"));
        p[2] = _hexU256(j, string.concat(prefix, ".x_c1_hi"));
        p[3] = _hexU256(j, string.concat(prefix, ".x_c1_lo"));
        p[4] = _hexU256(j, string.concat(prefix, ".y_c0_hi"));
        p[5] = _hexU256(j, string.concat(prefix, ".y_c0_lo"));
        p[6] = _hexU256(j, string.concat(prefix, ".y_c1_hi"));
        p[7] = _hexU256(j, string.concat(prefix, ".y_c1_lo"));
    }

    // -- Precompile availability check --

    function _bls12PrecompileAvailable() internal view returns (bool) {
        bytes memory fpInput = new bytes(64);
        fpInput[63] = 0x01;
        (bool ok, bytes memory ret) = address(0x10).staticcall(fpInput);
        return ok && ret.length == 128;
    }

    function test_bls12PrecompileAvailable() public view {
        _bls12PrecompileAvailable();
    }

    // -- Deployment test --

    function test_deployWithVectorPkMint() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);

        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);
        assertEq(v.mintAuthority(), mintAuth);
        assertEq(v.DENOMINATION(), 0.001 ether);

        for (uint256 i = 0; i < 4; i++) {
            assertEq(v.pkMint(i), pk[i]);
        }
    }

    // -- Deposit/Announce tests --

    function test_deposit() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        assertTrue(v.depositPending(depositId));
    }

    function test_deposit_revertsWrongValue() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        vm.expectRevert(NozkVaultV2.InvalidValue.selector);
        v.deposit{value: 0.002 ether}(depositId, B);
    }

    function test_announce() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");
        uint256[8] memory S_prime = _loadG2(j, ".S_PRIME");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        vm.prank(mintAuth);
        v.announce(depositId, S_prime);
        assertTrue(v.depositFulfilled(depositId));
    }

    function test_announce_revertsNotMintAuthority() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");
        uint256[8] memory S_prime = _loadG2(j, ".S_PRIME");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        vm.prank(address(0x999));
        vm.expectRevert(NozkVaultV2.NotMintAuthority.selector);
        v.announce(depositId, S_prime);
    }

    function test_nullifierId() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        uint256[4] memory spendPub = _loadG1(j, ".SPEND_BLS.pub_G1");
        bytes32 expectedNId =
            bytes32(vm.parseUint(string.concat("0x", vm.parseJsonString(j, ".SPEND_BLS.nullifier_id"))));

        bytes32 computedNId = v.nullifierId(spendPub);
        assertEq(computedNId, expectedNId);
    }

    // -- Reveal + Redeem test (requires EIP-2537 precompiles) --

    function test_revealAndRedeem() public {
        if (!_bls12PrecompileAvailable()) {
            return;
        }

        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        // Deposit
        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        // Announce
        uint256[8] memory S_prime = _loadG2(j, ".S_PRIME");
        vm.prank(mintAuth);
        v.announce(depositId, S_prime);

        // Reveal
        uint256[4] memory spendPub = _loadG1(j, ".REVEAL_TX.spend_pub_G1");
        uint256[8] memory S = _loadG2(j, ".REVEAL_TX.S_G2");
        v.reveal(spendPub, S);

        bytes32 nId = v.nullifierId(spendPub);
        assertEq(uint256(v.nullifierState(nId)), uint256(NozkVaultV2.NullifierState.REVEALED));
    }

    // -- Refund test --

    function test_refund() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        uint256 balBefore = deployer.balance;
        vm.prank(deployer);
        v.refund(depositId);
        assertEq(deployer.balance - balBefore, 0.001 ether);
        assertFalse(v.depositPending(depositId));
    }

    function test_refund_revertsAfterAnnounce() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[4] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[8] memory B = _loadG2(j, ".B_BLINDED");
        uint256[8] memory S_prime = _loadG2(j, ".S_PRIME");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        vm.prank(mintAuth);
        v.announce(depositId, S_prime);

        vm.prank(deployer);
        vm.expectRevert(NozkVaultV2.NothingToRefund.selector);
        v.refund(depositId);
    }
}
