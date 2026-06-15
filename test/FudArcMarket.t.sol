// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FudArcMarket} from "../src/FudArcMarket.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract FudArcMarketTest is Test {
    FudArcMarket market;
    MockUSDC usdc;

    address operator;
    address treasury;
    address alice; // opener, LONG
    address bob;   // taker, SHORT

    uint64 closesAt;

    function setUp() public {
        operator = makeAddr("operator");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        usdc = new MockUSDC();
        market = new FudArcMarket(address(usdc), operator, treasury);
        closesAt = uint64(block.timestamp + 1 hours);

        usdc.mint(alice, 1_000e6);
        usdc.mint(bob, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(market), type(uint256).max);
    }

    function _openLongVsShort(uint256 longAmt, uint256 shortAmt) internal returns (uint256 id) {
        vm.prank(alice);
        id = market.openMarket(closesAt, FudArcMarket.Side.Long, longAmt);
        vm.prank(bob);
        market.bet(id, FudArcMarket.Side.Short, shortAmt);
    }

    function test_OpenAndBet_TracksPools() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        (address opener,,, uint256 longPool, uint256 shortPool,) = market.markets(id);
        assertEq(opener, alice);
        assertEq(longPool, 100e6);
        assertEq(shortPool, 100e6);
        assertEq(usdc.balanceOf(address(market)), 200e6);
    }

    function test_Resolve_LongWins_PayoutsAndFee() public {
        // balanced 100 vs 100, LONG wins. Loser pool = 100, fee = 10% = 10.
        // opener cut = 20% of fee = 2 → alice (creator). treasury = 8.
        // distributable = 90. alice (sole long) claims 100 + 90 = 190.
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);

        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);

        assertEq(market.treasuryClaimable(), 8e6, "treasury accrued");

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 190e6, "winner payout");

        // bob (loser) has nothing to claim.
        vm.prank(bob);
        vm.expectRevert(FudArcMarket.NoWinnings.selector);
        market.claim(id);

        // opener creator cut.
        uint256 aliceBeforeCut = usdc.balanceOf(alice);
        vm.prank(alice);
        market.claimCreator();
        assertEq(usdc.balanceOf(alice) - aliceBeforeCut, 2e6, "opener cut");

        // treasury pulls its accrued fee.
        market.claimTreasury();
        assertEq(usdc.balanceOf(treasury), 8e6, "treasury claimed");

        // conservation: 200 in == 190 winner + 8 treasury + 2 opener.
        assertEq(usdc.balanceOf(address(market)), 0, "escrow drained");
    }

    function test_Resolve_Draw_RefundsBothSides() public {
        uint256 id = _openLongVsShort(100e6, 60e6);
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Draw);

        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(alice); market.claim(id);
        vm.prank(bob);   market.claim(id);
        assertEq(usdc.balanceOf(alice) - a0, 100e6, "alice refund");
        assertEq(usdc.balanceOf(bob) - b0, 60e6, "bob refund");
        assertEq(usdc.balanceOf(treasury), 0, "no fee on draw");
    }

    function test_Resolve_OneSided_RefundsEvenIfOutcomePicksThatSide() public {
        // only LONG, no counterparty. Even if operator says Long won, refund.
        vm.prank(alice);
        uint256 id = market.openMarket(closesAt, FudArcMarket.Side.Long, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);

        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice); market.claim(id);
        assertEq(usdc.balanceOf(alice) - a0, 100e6, "one-sided refund");
        assertEq(usdc.balanceOf(treasury), 0, "no fee one-sided");
    }

    function test_Bet_AfterClose_Reverts() public {
        vm.prank(alice);
        uint256 id = market.openMarket(closesAt, FudArcMarket.Side.Long, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(bob);
        vm.expectRevert(FudArcMarket.Closed.selector);
        market.bet(id, FudArcMarket.Side.Short, 50e6);
    }

    function test_Resolve_OnlyOperator() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NotOperator.selector);
        market.resolve(id, FudArcMarket.Outcome.Long);
    }

    function test_Resolve_BeforeClose_Reverts() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.prank(operator);
        vm.expectRevert(FudArcMarket.NotClosed.selector);
        market.resolve(id, FudArcMarket.Outcome.Long);
    }

    function test_DoubleClaim_Reverts() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);
        vm.prank(alice); market.claim(id);
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.AlreadyClaimed.selector);
        market.claim(id);
    }

    function test_Payout_ProRataAcrossMultipleWinners() public {
        // LONG: alice 100, bob 50 (both long) ; SHORT: a third party 150.
        address carol = makeAddr("carol");
        usdc.mint(carol, 1_000e6);
        vm.prank(carol);
        usdc.approve(address(market), type(uint256).max);

        vm.prank(alice);
        uint256 id = market.openMarket(closesAt, FudArcMarket.Side.Long, 100e6);
        vm.prank(bob);
        market.bet(id, FudArcMarket.Side.Long, 50e6);
        vm.prank(carol);
        market.bet(id, FudArcMarket.Side.Short, 150e6);

        // LONG wins. loser pool 150, fee 15, distributable 135. winnerPool 150.
        // alice: 100 + 100/150*135 = 100 + 90 = 190. bob: 50 + 50/150*135 = 95.
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);

        assertEq(market.payoutOf(id, alice), 190e6);
        assertEq(market.payoutOf(id, bob), 95e6);
        assertEq(market.payoutOf(id, carol), 0);
    }
}
