// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FudArcMarket} from "../src/FudArcMarket.sol";

/// @notice Deploy FudArcMarket to Arc testnet.
///         Run: forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        // Arc testnet ERC-20 USDC (6 decimals).
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address operator = vm.envOr("OPERATOR_ADDRESS", vm.addr(pk));
        address treasury = vm.envOr("TREASURY_ADDRESS", vm.addr(pk));

        vm.startBroadcast(pk);
        FudArcMarket m = new FudArcMarket(usdc, operator, treasury);
        vm.stopBroadcast();

        console.log("FudArcMarket deployed at:", address(m));
        console.log("  usdc:    ", usdc);
        console.log("  operator:", operator);
        console.log("  treasury:", treasury);
    }
}
