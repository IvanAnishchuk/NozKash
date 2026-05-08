// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/NozkVaultV2.sol";

/**
 * @title NozkVaultV2 Test Suite
 * @notice Tests for BLS12-381 based NozkVaultV2.
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
        // Read indices as raw JSON (uint array)
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

    function _loadPkMint(string memory j) internal pure returns (uint256[8] memory pk) {
        pk[0] = _hexU256(j, ".PK_MINT.x_c0_hi");
        pk[1] = _hexU256(j, ".PK_MINT.x_c0_lo");
        pk[2] = _hexU256(j, ".PK_MINT.x_c1_hi");
        pk[3] = _hexU256(j, ".PK_MINT.x_c1_lo");
        pk[4] = _hexU256(j, ".PK_MINT.y_c0_hi");
        pk[5] = _hexU256(j, ".PK_MINT.y_c0_lo");
        pk[6] = _hexU256(j, ".PK_MINT.y_c1_hi");
        pk[7] = _hexU256(j, ".PK_MINT.y_c1_lo");
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
        // MAP_FP_TO_G1 is at 0x10 in final Pectra spec
        (bool ok, bytes memory ret) = address(0x10).staticcall(fpInput);
        return ok && ret.length == 128;
    }

    function test_bls12PrecompileAvailable() public view {
        // Informational: check if EIP-2537 precompiles are available.
        // Passes either way — the test just records availability.
        _bls12PrecompileAvailable(); // no assertion, just probes
    }

    // -- Deployment test --

    function test_deployWithVectorPkMint() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);

        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);
        assertEq(v.mintAuthority(), mintAuth);
        assertEq(v.DENOMINATION(), 0.001 ether);

        // Verify pkMint stored correctly
        for (uint256 i = 0; i < 8; i++) {
            assertEq(v.pkMint(i), pk[i]);
        }
    }

    // -- Deposit/Announce tests (same logic as V1, different point sizes) --

    function test_deposit() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[4] memory B = _loadG1(j, ".B_BLINDED");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        assertTrue(v.depositPending(depositId));
    }

    function test_deposit_revertsWrongValue() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[4] memory B = _loadG1(j, ".B_BLINDED");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        vm.expectRevert(NozkVaultV2.InvalidValue.selector);
        v.deposit{value: 0.002 ether}(depositId, B);
    }

    function test_announce() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[4] memory B = _loadG1(j, ".B_BLINDED");
        uint256[4] memory S_prime = _loadG1(j, ".S_PRIME");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        vm.prank(mintAuth);
        v.announce(depositId, S_prime);
        assertTrue(v.depositFulfilled(depositId));
    }

    function test_announce_revertsNotMintAuthority() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[4] memory B = _loadG1(j, ".B_BLINDED");
        uint256[4] memory S_prime = _loadG1(j, ".S_PRIME");

        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        vm.prank(address(0x999));
        vm.expectRevert(NozkVaultV2.NotMintAuthority.selector);
        v.announce(depositId, S_prime);
    }

    function test_nullifierId() public {
        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        uint256[8] memory spendPub = _loadG2(j, ".SPEND_BLS.pub_G2");
        bytes32 expectedNId = bytes32(vm.parseUint(string.concat("0x", vm.parseJsonString(j, ".SPEND_BLS.nullifier_id"))));

        bytes32 computedNId = v.nullifierId(spendPub);
        assertEq(computedNId, expectedNId);
    }

    // -- Diagnostic: precompile output comparison --

    function test_mapFpToG1ReturnsData() public view {
        if (!_bls12PrecompileAvailable()) return;
        // Call MAP_FP_TO_G1 with Fp=1 and check we get 128 bytes
        bytes memory fpInput = new bytes(64);
        fpInput[63] = 0x01;
        (bool ok, bytes memory ret) = address(0x10).staticcall(fpInput);
        assertTrue(ok, "MAP_FP_TO_G1 call failed");
        assertEq(ret.length, 128, "Expected 128 byte G1 point");
        // Log the result for comparison with Python
        uint256 x_hi; uint256 x_lo; uint256 y_hi; uint256 y_lo;
        assembly {
            x_hi := mload(add(ret, 0x20))
            x_lo := mload(add(ret, 0x40))
            y_hi := mload(add(ret, 0x60))
            y_lo := mload(add(ret, 0x80))
        }
        // Just assert non-zero
        assertTrue(x_hi != 0 || x_lo != 0, "G1 point x should be non-zero");
    }

    // -- Reveal test (requires EIP-2537 precompiles) --

    function test_revealAndRedeem() public {
        if (!_bls12PrecompileAvailable()) {
            // Skip test — no EIP-2537 precompiles in this Foundry EVM
            return;
        }

        string memory j = vm.readFile(_tokenFile(keypairDirs[0], tokenIndices[0]));
        uint256[8] memory pk = _loadPkMint(j);
        NozkVaultV2 v = new NozkVaultV2(pk, mintAuth);

        // Deposit
        address depositId = vm.parseAddress(vm.parseJsonString(j, ".DEPOSIT_ID"));
        uint256[4] memory B = _loadG1(j, ".B_BLINDED");
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        v.deposit{value: 0.001 ether}(depositId, B);

        // Announce
        uint256[4] memory S_prime = _loadG1(j, ".S_PRIME");
        vm.prank(mintAuth);
        v.announce(depositId, S_prime);

        // Reveal
        uint256[8] memory spendPub = _loadG2(j, ".REVEAL_TX.spend_pub_G2");
        uint256[4] memory S = _loadG1(j, ".REVEAL_TX.S_G1");
        v.reveal(spendPub, S);

        bytes32 nId = v.nullifierId(spendPub);
        assertEq(uint256(v.nullifierState(nId)), uint256(NozkVaultV2.NullifierState.REVEALED));

        // Redeem
        address recipient = vm.parseAddress(vm.parseJsonString(j, ".REDEEM_TX.recipient"));
        uint256 deadline = vm.parseUint(vm.parseJsonString(j, ".REDEEM_TX.deadline"));
        uint256[4] memory sigma = _loadG1(j, ".REDEEM_TX.sigma_G1");

        uint256 balBefore = recipient.balance;
        v.redeem(recipient, sigma, nId, deadline);

        assertEq(uint256(v.nullifierState(nId)), uint256(NozkVaultV2.NullifierState.SPENT));
        assertEq(recipient.balance - balBefore, 0.001 ether);
    }
}
