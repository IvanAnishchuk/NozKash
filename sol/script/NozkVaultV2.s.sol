// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {NozkVaultV2} from "../src/NozkVaultV2.sol";

contract NozkVaultV2Script is Script {
    function run() external {
        uint256[4] memory pkMint = [
            vm.envOr("PK_MINT_X_HI", uint256(0)),
            vm.envOr("PK_MINT_X_LO", uint256(0)),
            vm.envOr("PK_MINT_Y_HI", uint256(0)),
            vm.envOr("PK_MINT_Y_LO", uint256(0))
        ];
        address mintAuthority = vm.envOr("MINT_AUTHORITY", address(0));
        require(pkMint[0] != 0 || pkMint[1] != 0, "PK_MINT env vars not set");
        require(mintAuthority != address(0), "MINT_AUTHORITY env var not set");
        vm.startBroadcast();
        new NozkVaultV2(pkMint, mintAuthority);
        vm.stopBroadcast();
    }
}
