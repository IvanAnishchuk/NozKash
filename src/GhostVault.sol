// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GhostVault
 * @notice Ingress (deposit), delivery (announce), and egress (redeem) for fixed-denomination eCash with
 *         ECDSA nullifier + BLS pairing on BN128. Hash-to-G1 matches Python try-and-increment:
 *         `keccak256(message_bytes || be32(counter))` on curve `y^2 = x^3 + 3`.
 */
contract GhostVault {
    // BN254 field modulus (alt_bn128 G1)
    uint256 internal constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    uint256 public constant DENOMINATION = 0.01 ether;
    uint256 public constant MAX_H2C_ITERATIONS = 65536;

    mapping(address => bool) public spentNullifiers;
    uint256[4] public pkMint;
    bytes32 public immutable blsDomain;

    event DepositLocked(uint256 indexed depositId, uint256[2] B);
    event MintFulfilled(uint256 indexed depositId, uint256[2] blindedSignature);

    error InvalidValue();
    error InvalidECDSA();
    error AlreadySpent();
    error InvalidBLS();
    error InvalidSignatureLength();
    error EthSendFailed();
    error HashToCurveFailed();

    constructor(uint256[4] memory pkMint_, bytes32 blsDomain_) {
        pkMint = pkMint_;
        blsDomain = blsDomain_;
    }

    /// @dev G2 generator matching `py_ecc.bn128.G2` (8.x), limbs ordered for EIP-197 `bn256Pairing`.
    function _g2Gen() internal pure returns (uint256[4] memory g) {
        g[0] = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2;
        g[1] = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed;
        g[2] = 0x90689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b;
        g[3] = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa;
    }

    function negateG1(uint256[2] memory p) internal pure returns (uint256[2] memory) {
        if (p[0] == 0 && p[1] == 0) return [uint256(0), uint256(0)];
        return [p[0], P - (p[1] % P)];
    }

    function verifyBLS(uint256[2] memory S, uint256[2] memory Y, uint256[4] memory PK_mint) public view returns (bool) {
        uint256[2] memory negY = negateG1(Y);
        uint256[4] memory g2 = _g2Gen();

        uint256[12] memory input = [
            S[0], S[1],
            g2[0], g2[1], g2[2], g2[3],
            negY[0], negY[1],
            PK_mint[0], PK_mint[1], PK_mint[2], PK_mint[3]
        ];

        (bool success, bytes memory returnData) = address(0x08).staticcall(abi.encodePacked(input));
        require(success, "Precompile 0x08 call failed");

        uint256 result = abi.decode(returnData, (uint256));
        return result == 1;
    }

    function verifyRedemption(
        address expectedSpendAddress,
        bytes32 msgHash,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[2] calldata unblindedS,
        uint256[2] calldata mappedY,
        uint256[4] calldata pkMint_
    ) external view returns (bool) {
        address recovered = ecrecover(msgHash, v, r, s);
        require(recovered == expectedSpendAddress, "ECDSA verification failed");
        require(verifyBLS(unblindedS, mappedY, pkMint_), "BLS Pairing failed");
        return true;
    }

    function redemptionMessageHash(address recipient) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("Pay to: ", recipient));
    }

    function hashNullifierPoint(address nullifier) public view returns (uint256[2] memory) {
        return hashToCurve(abi.encodePacked(blsDomain, nullifier));
    }

    function hashToCurve(bytes memory message) public view returns (uint256[2] memory) {
        for (uint256 i = 0; i < MAX_H2C_ITERATIONS; i++) {
            uint256 x = uint256(keccak256(abi.encodePacked(message, uint32(i))));
            x %= P;
            uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), 3, P);
            if (!_legendreIsOne(rhs)) continue;
            uint256 y = _modSqrtFp(rhs);
            if (mulmod(y, y, P) == rhs) {
                return [x, y];
            }
        }
        revert HashToCurveFailed();
    }

    function _legendreIsOne(uint256 rhs) internal view returns (bool) {
        if (rhs == 0) return false;
        return _modExp(rhs, (P - 1) / 2) == 1;
    }

    function _modSqrtFp(uint256 rhs) internal view returns (uint256) {
        return _modExp(rhs, (P + 1) / 4);
    }

    function _modExp(uint256 base, uint256 exponent) internal view returns (uint256 r) {
        assembly {
            let p := mload(0x40)
            mstore(p, 0x20)
            mstore(add(p, 0x20), 0x20)
            mstore(add(p, 0x40), 0x20)
            mstore(add(p, 0x60), base)
            mstore(add(p, 0x80), exponent)
            mstore(add(p, 0xa0), P)
            if iszero(staticcall(gas(), 0x05, p, 0xc0, p, 0x20)) { revert(0, 0) }
            r := mload(p)
        }
    }

    function deposit(uint256[2] calldata blindedPointB) external payable {
        if (msg.value != DENOMINATION) revert InvalidValue();
        uint256 depositId = uint256(keccak256(abi.encodePacked(msg.sender, block.timestamp, blindedPointB)));
        emit DepositLocked(depositId, blindedPointB);
    }

    function announce(uint256 depositId, uint256[2] calldata blindedSignature) external {
        emit MintFulfilled(depositId, blindedSignature);
    }

    function redeem(address recipient, bytes calldata spendSignature, uint256[2] calldata unblindedSignatureS)
        external
    {
        bytes32 txHash = redemptionMessageHash(recipient);
        address nullifier = recoverSigner(txHash, spendSignature);
        if (nullifier == address(0)) revert InvalidECDSA();

        if (spentNullifiers[nullifier]) revert AlreadySpent();
        spentNullifiers[nullifier] = true;

        uint256[2] memory y = hashNullifierPoint(nullifier);
        if (!verifyBLS(unblindedSignatureS, y, pkMint)) revert InvalidBLS();

        (bool sent,) = payable(recipient).call{value: DENOMINATION}("");
        if (!sent) revert EthSendFailed();
    }

    function recoverSigner(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(hash, v, r, s);
    }
}
