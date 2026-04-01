// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {NozkVault} from "../src/NozkVault.sol";

/// @dev Exposes internal `verifyBLS` for vector checks.
contract NozkVaultHarness is NozkVault {
    constructor(uint256[4] memory pkMint_, address mintAuthority_) NozkVault(pkMint_, mintAuthority_) {}

    function exposedVerifyBLS(uint256[2] calldata S, uint256[2] calldata Y, uint256[4] calldata pk_)
        external
        view
        returns (bool)
    {
        return verifyBLS(S, Y, pk_);
    }
}

/// @dev Forks **Ethereum Sepolia** in `setUp` (public RPC in `foundry.toml` alias `sepolia-public`;
///      set `FORK_RPC_URL` to override). Reads vectors from repo-root `test_vectors/` (or `NOZK_VECTOR_SUITE`),
///      iterates over all keypair directories listed in `manifest.json`.
///
///      The vault is deployed at the exact `contract_address` from `manifest.json` via `deployCodeTo`,
///      so the EIP-712 DOMAIN_SEPARATOR matches the vectors byte-for-byte — all ECDSA signatures
///      from the vectors are directly verifiable without `vm.sign`.
contract NozkVaultTest is Test {
    using stdJson for string;

    /// @dev Default vault deployed at the vector contract address from the first keypair (used by unit tests).
    NozkVaultHarness internal vault;
    address internal mintAuthority;

    /// @dev Root directory containing `manifest.json` and keypair subdirectories.
    string internal vectorSuite;

    /// @dev Contract address from manifest — vault is deployed here so DOMAIN_SEPARATOR matches vectors.
    address internal vectorContract;

    /// @dev Keypair directory names read from manifest.json.
    string[] internal keypairDirs;
    /// @dev Token indices read from manifest.json.
    uint256[] internal tokenIndices;

    uint256 internal constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    event MintFulfilled(address indexed depositId, uint256[2] S_prime);

    function setUp() public {
        string memory forkUrl = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(forkUrl).length > 0) {
            vm.createSelectFork(forkUrl);
        } else {
            vm.createSelectFork("sepolia-public");
        }

        vectorSuite = vm.envOr("NOZK_VECTOR_SUITE", string("../test_vectors"));
        mintAuthority = makeAddr("mintAuthority");

        // Read manifest to discover contract address, keypair suites, and indices.
        string memory manifest = vm.readFile(string.concat(vectorSuite, "/manifest.json"));
        vectorContract = manifest.readAddress(".contract_address");

        string[] memory kps = manifest.readStringArray(".keypairs");
        for (uint256 i; i < kps.length; i++) {
            keypairDirs.push(kps[i]);
        }
        uint256[] memory idxs = manifest.readUintArray(".indices");
        for (uint256 i; i < idxs.length; i++) {
            tokenIndices.push(idxs[i]);
        }

        // Deploy the default vault at the vector contract address (first keypair, for unit tests).
        string memory j = vm.readFile(_tokenFileIn(keypairDirs[0], 42));
        uint256[4] memory pkMint = _pkMintFromJson(j);
        deployCodeTo(
            "NozkVault.t.sol:NozkVaultHarness",
            abi.encode(pkMint, mintAuthority),
            vectorContract
        );
        vault = NozkVaultHarness(payable(vectorContract));
    }

    function _tokenFileIn(string memory kpDir, uint256 tokenIndex) internal view returns (string memory) {
        return string.concat(vectorSuite, "/", kpDir, "/token_", vm.toString(tokenIndex), ".json");
    }

    /// @dev Convenience: default keypair token file (backwards compat for unit tests).
    function _tokenFile(uint256 tokenIndex) internal view returns (string memory) {
        return _tokenFileIn(keypairDirs[0], tokenIndex);
    }

    /// @dev Left-pad hex (no 0x) to 64 nibbles so uint256 limb parsing matches on-chain precompile inputs.
    function _padHex64(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 skip = 0;
        if (b.length >= 2 && b[0] == 0x30 && (b[1] == 0x78 || b[1] == 0x58)) {
            skip = 2;
        }
        uint256 n = b.length - skip;
        require(n <= 64, "hex field too long");
        bytes memory out = new bytes(64);
        for (uint256 i; i < 64 - n; i++) {
            out[i] = 0x30;
        }
        for (uint256 i; i < n; i++) {
            out[64 - n + i] = b[skip + i];
        }
        return string(out);
    }

    function _hexU256(string memory json, string memory key) internal pure returns (uint256) {
        return vm.parseUint(string.concat("0x", _padHex64(json.readString(key))));
    }

    function _hexBytes(string memory json, string memory key) internal pure returns (bytes memory) {
        return vm.parseBytes(string.concat("0x", json.readString(key)));
    }

    function _pkMintFromJson(string memory j) internal pure returns (uint256[4] memory pkMint) {
        pkMint[0] = _hexU256(j, ".PK_MINT.X_imag");
        pkMint[1] = _hexU256(j, ".PK_MINT.X_real");
        pkMint[2] = _hexU256(j, ".PK_MINT.Y_imag");
        pkMint[3] = _hexU256(j, ".PK_MINT.Y_real");
    }

    function _g1FromJson(string memory j, string memory baseKey) internal pure returns (uint256[2] memory p) {
        p[0] = _hexU256(j, string.concat(baseKey, ".X"));
        p[1] = _hexU256(j, string.concat(baseKey, ".Y"));
    }

    function test_allTestVectors_metadataBlsH2cEcdsaAndRedeem() public {
        for (uint256 k; k < keypairDirs.length; k++) {
            // Deploy a fresh vault at the vector contract address for each keypair's pkMint.
            string memory j0 = vm.readFile(_tokenFileIn(keypairDirs[k], tokenIndices[0]));
            uint256[4] memory pkMint = _pkMintFromJson(j0);
            deployCodeTo(
                "NozkVault.t.sol:NozkVaultHarness",
                abi.encode(pkMint, mintAuthority),
                vectorContract
            );
            NozkVaultHarness kpVault = NozkVaultHarness(payable(vectorContract));

            // Verify crypto for every token index.
            for (uint256 t; t < tokenIndices.length; t++) {
                string memory j = vm.readFile(_tokenFileIn(keypairDirs[k], tokenIndices[t]));
                _assertTokenCryptoFor(kpVault, j);
            }

            // Redeem every token index.
            vm.deal(vectorContract, tokenIndices.length * kpVault.DENOMINATION());
            for (uint256 t; t < tokenIndices.length; t++) {
                string memory j = vm.readFile(_tokenFileIn(keypairDirs[k], tokenIndices[t]));
                _redeemOneFor(kpVault, j);
            }
        }
    }

    function _assertTokenCryptoFor(NozkVaultHarness v_, string memory j) internal view {
        // BLS verification
        uint256[4] memory pkMint = _pkMintFromJson(j);
        uint256[2] memory sUnblinded = _g1FromJson(j, ".S_UNBLINDED");
        uint256[2] memory y = _g1FromJson(j, ".Y_HASH_TO_CURVE");
        assertTrue(v_.exposedVerifyBLS(sUnblinded, y, pkMint));

        // Hash-to-curve parity
        address spend = j.readAddress(".SPEND_KEYPAIR.address");
        uint256[2] memory yOnChain = v_.hashNullifierPoint(spend);
        assertEq(yOnChain[0], y[0]);
        assertEq(yOnChain[1], y[1]);

        // EIP-712 msg_hash determinism: vault's hash must match vector byte-for-byte
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        uint256 deadline = _hexU256(j, ".REDEEM_TX.deadline");
        bytes32 digest = v_.redemptionMessageHash(recipient, deadline);
        bytes32 vectorHash = bytes32(_hexU256(j, ".REDEEM_TX.msg_hash"));
        assertEq(digest, vectorHash, "EIP-712 msg_hash mismatch");

        // ECDSA: ecrecover with vector signature must recover spend address
        bytes memory sig = _hexBytes(j, ".REDEEM_TX.spend_signature");
        (bytes32 r, bytes32 s, uint8 v) = _splitSig(sig);
        address recovered = ecrecover(digest, v, r, s);
        assertEq(recovered, spend, "ECDSA must recover spend_addr");
    }

    function _redeemOneFor(NozkVaultHarness v_, string memory j) internal {
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        address nullifier = j.readAddress(".SPEND_KEYPAIR.address");
        uint256 deadline = _hexU256(j, ".REDEEM_TX.deadline");
        bytes memory sig = _hexBytes(j, ".REDEEM_TX.spend_signature");
        uint256[2] memory sG1 = [j.readUint(".REDEEM_TX.S_x"), j.readUint(".REDEEM_TX.S_y")];

        uint256 balBefore = recipient.balance;
        v_.redeem(recipient, sig, nullifier, deadline, sG1);
        assertEq(recipient.balance - balBefore, v_.DENOMINATION());
        assertTrue(v_.spentNullifiers(nullifier));
    }

    function _splitSig(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "sig len");
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }

    function test_hashNullifierPointOnCurve() public view {
        string memory j = vm.readFile(_tokenFile(42));
        address spend = j.readAddress(".SPEND_KEYPAIR.address");
        uint256[2] memory pt = vault.hashNullifierPoint(spend);
        uint256 x = pt[0];
        uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), 3, P);
        assertEq(mulmod(pt[1], pt[1], P), rhs);
    }

    function test_deposit_twoBlindAddrsLockEth() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        address user = makeAddr("depositor");
        address blind1 = makeAddr("blindAddr1");
        address blind2 = makeAddr("blindAddr2");
        vm.deal(user, 2 ether);

        uint256 den = vault.DENOMINATION();
        uint256 balBefore = address(vault).balance;
        vm.prank(user);
        vault.deposit{value: den}(blind1, b);
        vm.prank(user);
        vault.deposit{value: den}(blind2, b);

        assertEq(address(vault).balance - balBefore, 2 * den);
        assertTrue(vault.depositPending(blind1));
        assertTrue(vault.depositPending(blind2));
        assertFalse(vault.depositFulfilled(blind1));
    }

    function test_deposit_revertsWhenWrongValue() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        vm.deal(address(this), 1 ether);
        vm.expectRevert(NozkVault.InvalidValue.selector);
        vault.deposit{value: 0}(makeAddr("blindX"), b);
    }

    function test_deposit_revertsZeroBlindAddr() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        vm.deal(address(this), 1 ether);
        uint256 den = vault.DENOMINATION();
        vm.expectRevert(NozkVault.InvalidDepositId.selector);
        vault.deposit{value: den}(address(0), b);
    }

    function test_deposit_revertsDuplicateBlindAddr() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        address blind = makeAddr("blindDup");
        address user = makeAddr("depositor");
        vm.deal(user, 2 ether);
        uint256 den = vault.DENOMINATION();
        vm.startPrank(user);
        vault.deposit{value: den}(blind, b);
        vm.expectRevert(NozkVault.DepositIdAlreadyUsed.selector);
        vault.deposit{value: den}(blind, b);
        vm.stopPrank();
    }

    function test_announce_emitsMintFulfilled_afterDeposit() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        uint256[2] memory sPrime = _g1FromJson(j, ".S_PRIME");

        address blindId = j.readAddress(".BLIND_KEYPAIR.address");
        address user = makeAddr("depositor");
        vm.deal(user, 1 ether);
        uint256 den = vault.DENOMINATION();
        vm.prank(user);
        vault.deposit{value: den}(blindId, b);

        vm.prank(mintAuthority);
        vm.expectEmit(true, true, true, true);
        emit MintFulfilled(blindId, sPrime);
        vault.announce(blindId, sPrime);

        assertTrue(vault.depositFulfilled(blindId));
        assertFalse(vault.depositPending(blindId));
        assertEq(vault.depositors(blindId), address(0), "depositor mapping cleared after announce");
    }

    function test_announce_revertsNotMintAuthority() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");

        address blindId = j.readAddress(".BLIND_KEYPAIR.address");
        address user = makeAddr("depositor");
        vm.deal(user, 1 ether);
        uint256 den = vault.DENOMINATION();
        vm.prank(user);
        vault.deposit{value: den}(blindId, b);

        vm.expectRevert(NozkVault.NotMintAuthority.selector);
        vault.announce(blindId, _g1FromJson(j, ".S_PRIME"));
    }

    function test_announce_revertsDepositNotFound() public {
        string memory j = vm.readFile(_tokenFile(42));
        vm.prank(mintAuthority);
        vm.expectRevert(NozkVault.DepositNotFound.selector);
        vault.announce(makeAddr("neverDeposited"), _g1FromJson(j, ".S_PRIME"));
    }

    function test_announce_revertsAlreadyFulfilled() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        uint256[2] memory sPrime = _g1FromJson(j, ".S_PRIME");

        address blindId = j.readAddress(".BLIND_KEYPAIR.address");
        address user = makeAddr("depositor");
        vm.deal(user, 1 ether);
        uint256 den = vault.DENOMINATION();
        vm.prank(user);
        vault.deposit{value: den}(blindId, b);

        vm.startPrank(mintAuthority);
        vault.announce(blindId, sPrime);
        vm.expectRevert(NozkVault.AlreadyFulfilled.selector);
        vault.announce(blindId, sPrime);
        vm.stopPrank();
    }

    function test_redeem_succeedsAgainstVectors() public {
        string memory j = vm.readFile(_tokenFile(42));
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        address nullifier = j.readAddress(".SPEND_KEYPAIR.address");
        uint256 deadline = _hexU256(j, ".REDEEM_TX.deadline");
        bytes memory sig = _hexBytes(j, ".REDEEM_TX.spend_signature");
        uint256[2] memory sG1 = [j.readUint(".REDEEM_TX.S_x"), j.readUint(".REDEEM_TX.S_y")];

        vm.deal(address(vault), vault.DENOMINATION());
        uint256 balBefore = recipient.balance;

        vault.redeem(recipient, sig, nullifier, deadline, sG1);

        assertEq(recipient.balance - balBefore, vault.DENOMINATION());
        assertTrue(vault.spentNullifiers(nullifier));
    }

    function test_redeem_revertsDoubleSpend() public {
        string memory j = vm.readFile(_tokenFile(42));
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        address nullifier = j.readAddress(".SPEND_KEYPAIR.address");
        uint256 deadline = _hexU256(j, ".REDEEM_TX.deadline");
        bytes memory sig = _hexBytes(j, ".REDEEM_TX.spend_signature");
        uint256[2] memory sG1 = [j.readUint(".REDEEM_TX.S_x"), j.readUint(".REDEEM_TX.S_y")];

        vm.deal(address(vault), 2 * vault.DENOMINATION());
        vault.redeem(recipient, sig, nullifier, deadline, sG1);

        vm.expectRevert(NozkVault.AlreadySpent.selector);
        vault.redeem(recipient, sig, nullifier, deadline, sG1);
    }

    function test_redeem_revertsInvalidECDSA() public {
        string memory j = vm.readFile(_tokenFile(42));
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        address spend = j.readAddress(".SPEND_KEYPAIR.address");
        uint256[2] memory sG1 = [j.readUint(".REDEEM_TX.S_x"), j.readUint(".REDEEM_TX.S_y")];
        uint256 deadline = _hexU256(j, ".REDEEM_TX.deadline");
        bytes memory badSig = new bytes(65);
        for (uint256 i; i < 65; i++) {
            badSig[i] = 0xab;
        }

        vm.deal(address(vault), vault.DENOMINATION());
        vm.expectRevert(NozkVault.InvalidECDSA.selector);
        vault.redeem(recipient, badSig, spend, deadline, sG1);
    }

    function test_redeem_revertsInvalidBLS() public {
        string memory j = vm.readFile(_tokenFile(42));
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        address spend = j.readAddress(".SPEND_KEYPAIR.address");
        uint256 deadline = _hexU256(j, ".REDEEM_TX.deadline");
        bytes memory sig = _hexBytes(j, ".REDEEM_TX.spend_signature");
        uint256[2] memory badS = [uint256(1), uint256(2)];

        vm.deal(address(vault), vault.DENOMINATION());
        vm.expectRevert(NozkVault.InvalidBLS.selector);
        vault.redeem(recipient, sig, spend, deadline, badS);
    }

    function test_redeem_revertsExpiredDeadline() public {
        string memory j = vm.readFile(_tokenFile(42));
        address recipient = j.readAddress(".REDEEM_TX.recipient");
        address nullifier = j.readAddress(".SPEND_KEYPAIR.address");
        uint256 spendPriv = _hexU256(j, ".SPEND_KEYPAIR.priv");
        uint256 deadline = block.timestamp - 1; // already expired
        bytes32 digest = vault.redemptionMessageHash(recipient, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(spendPriv, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        uint256[2] memory sG1 = [j.readUint(".REDEEM_TX.S_x"), j.readUint(".REDEEM_TX.S_y")];

        vm.deal(address(vault), vault.DENOMINATION());
        vm.expectRevert(NozkVault.ExpiredSignature.selector);
        vault.redeem(recipient, sig, nullifier, deadline, sG1);
    }

    function test_refund_succeedsForDepositor() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        address blindId = j.readAddress(".BLIND_KEYPAIR.address");
        address user = makeAddr("depositor");
        vm.deal(user, 1 ether);
        uint256 den = vault.DENOMINATION();
        vm.prank(user);
        vault.deposit{value: den}(blindId, b);

        assertEq(vault.depositors(blindId), user);
        assertTrue(vault.depositPending(blindId));

        uint256 balBefore = user.balance;
        vm.prank(user);
        vault.refund(blindId);

        assertEq(user.balance - balBefore, den);
        assertFalse(vault.depositPending(blindId));
        assertEq(vault.depositors(blindId), address(0));
    }

    function test_refund_revertsNotDepositor() public {
        string memory j = vm.readFile(_tokenFile(42));
        uint256[2] memory b = _g1FromJson(j, ".B_BLINDED");
        address blindId = j.readAddress(".BLIND_KEYPAIR.address");
        address user = makeAddr("depositor");
        address other = makeAddr("other");
        vm.deal(user, 1 ether);
        uint256 den = vault.DENOMINATION();
        vm.prank(user);
        vault.deposit{value: den}(blindId, b);

        vm.prank(other);
        vm.expectRevert(NozkVault.NotDepositor.selector);
        vault.refund(blindId);
    }
}
