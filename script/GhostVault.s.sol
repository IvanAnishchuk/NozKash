// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {GhostVault} from "../src/GhostVault.sol";

contract GhostVaultScript is Script {
    function setUp() public {}

    function run() public {
        vm.startBroadcast();
        new GhostVault();
        vm.stopBroadcast();
    }
}
