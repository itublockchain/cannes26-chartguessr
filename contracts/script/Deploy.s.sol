// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PredictionMarketEscrow} from "../src/PredictionMarketEscrow.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("OPERATOR_PRIVATE_KEY");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address usdc = 0x3600000000000000000000000000000000000000;

        vm.startBroadcast(deployerKey);

        new PredictionMarketEscrow(
            usdc,
            feeRecipient,
            500,           // 5%
            1_000_000,     // 1 USDC fixed
            1_000_000,     // 1 USDC fixed
            address(0)     // fallback mode — set CRE forwarder later
        );

        vm.stopBroadcast();
    }
}
