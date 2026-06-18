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
    address bob; // taker, SHORT

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

    function test_Constructor_RejectsZeroAddress() public {
        vm.expectRevert(FudArcMarket.ZeroAddress.selector);
        new FudArcMarket(address(0), operator, treasury);
        vm.expectRevert(FudArcMarket.ZeroAddress.selector);
        new FudArcMarket(address(usdc), address(0), treasury);
        vm.expectRevert(FudArcMarket.ZeroAddress.selector);
        new FudArcMarket(address(usdc), operator, address(0));
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
        vm.prank(alice);
        market.claim(id);
        vm.prank(bob);
        market.claim(id);
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
        vm.prank(alice);
        market.claim(id);
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
        vm.prank(alice);
        market.claim(id);
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

    // ─── reverts: openMarket / bet ───────────────────────────────────────────
    function test_OpenMarket_ZeroAmount_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.ZeroAmount.selector);
        market.openMarket(closesAt, FudArcMarket.Side.Long, 0);
    }

    function test_OpenMarket_AlreadyClosed_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.Closed.selector);
        market.openMarket(uint64(block.timestamp), FudArcMarket.Side.Long, 100e6);
    }

    function test_Bet_ZeroAmount_Reverts() public {
        vm.prank(alice);
        uint256 id = market.openMarket(closesAt, FudArcMarket.Side.Long, 100e6);
        vm.prank(bob);
        vm.expectRevert(FudArcMarket.ZeroAmount.selector);
        market.bet(id, FudArcMarket.Side.Short, 0);
    }

    function test_Bet_UnknownMarket_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(FudArcMarket.UnknownMarket.selector);
        market.bet(999, FudArcMarket.Side.Short, 50e6);
    }

    // ─── reverts: resolve ────────────────────────────────────────────────────
    function test_Resolve_UnknownMarket_Reverts() public {
        vm.warp(closesAt + 1);
        vm.prank(operator);
        vm.expectRevert(FudArcMarket.UnknownMarket.selector);
        market.resolve(999, FudArcMarket.Outcome.Long);
    }

    function test_Resolve_BadOutcome_Reverts() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(operator);
        vm.expectRevert(FudArcMarket.BadOutcome.selector);
        market.resolve(id, FudArcMarket.Outcome.Unresolved);
    }

    function test_Resolve_Twice_Reverts() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);
        vm.prank(operator);
        vm.expectRevert(FudArcMarket.AlreadyResolved.selector);
        market.resolve(id, FudArcMarket.Outcome.Short);
    }

    // ─── reverts: claim / claimCreator / claimTreasury ───────────────────────
    function test_Claim_BeforeResolve_Reverts() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NotResolved.selector);
        market.claim(id);
    }

    function test_ClaimCreator_NoWinnings_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NoWinnings.selector);
        market.claimCreator();
    }

    function test_ClaimTreasury_NoWinnings_Reverts() public {
        vm.expectRevert(FudArcMarket.NoWinnings.selector);
        market.claimTreasury();
    }

    // ─── SHORT wins (mirror of the LONG path; opener still earns the cut) ─────
    function test_Resolve_ShortWins_PayoutsAndCreatorCut() public {
        uint256 id = _openLongVsShort(100e6, 100e6); // alice long (opener), bob short
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Short);

        // loser pool = long 100, fee 10, opener cut 2 (to alice), treasury 8.
        assertEq(market.treasuryClaimable(), 8e6);

        // bob (sole short winner) claims 100 + 90 = 190.
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        market.claim(id);
        assertEq(usdc.balanceOf(bob) - b0, 190e6, "short winner payout");

        // alice loses the bet but still earns the OPENER cut (opener regardless of side).
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        market.claimCreator();
        assertEq(usdc.balanceOf(alice) - a0, 2e6, "opener cut even when opener loses");

        // alice has no winnings to claim.
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NoWinnings.selector);
        market.claim(id);
    }

    // ─── admin: setOperator / setTreasury / transferOwnership ────────────────
    function test_SetOperator_OnlyOwner_AndZeroGuard() public {
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NotOwner.selector);
        market.setOperator(alice);
        vm.expectRevert(FudArcMarket.ZeroAddress.selector);
        market.setOperator(address(0)); // owner = this test contract
    }

    function test_SetOperator_NewOperatorCanResolve() public {
        address newOp = makeAddr("newOp");
        market.setOperator(newOp); // owner = test contract
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);
        // old operator can no longer resolve.
        vm.prank(operator);
        vm.expectRevert(FudArcMarket.NotOperator.selector);
        market.resolve(id, FudArcMarket.Outcome.Long);
        // new operator can.
        vm.prank(newOp);
        market.resolve(id, FudArcMarket.Outcome.Long);
        (,, FudArcMarket.Outcome outcome,,,) = market.markets(id);
        assertEq(uint8(outcome), uint8(FudArcMarket.Outcome.Long));
    }

    function test_SetTreasury_OnlyOwner_AndRoutesFee() public {
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NotOwner.selector);
        market.setTreasury(alice);
        vm.expectRevert(FudArcMarket.ZeroAddress.selector);
        market.setTreasury(address(0));

        address newTreasury = makeAddr("newTreasury");
        market.setTreasury(newTreasury);
        uint256 id = _openLongVsShort(100e6, 100e6);
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);
        market.claimTreasury();
        assertEq(usdc.balanceOf(newTreasury), 8e6, "fee routes to the new treasury");
        assertEq(usdc.balanceOf(treasury), 0, "old treasury gets nothing");
    }

    function test_TransferOwnership_OnlyOwner_AndZeroGuard() public {
        vm.prank(alice);
        vm.expectRevert(FudArcMarket.NotOwner.selector);
        market.transferOwnership(alice);
        vm.expectRevert(FudArcMarket.ZeroAddress.selector);
        market.transferOwnership(address(0));

        // hand ownership to alice: she can now set the operator; the old owner can't.
        market.transferOwnership(alice);
        vm.expectRevert(FudArcMarket.NotOwner.selector);
        market.setOperator(bob);
        vm.prank(alice);
        market.setOperator(bob);
        assertEq(market.operator(), bob);
    }

    // ─── payoutOf view edge cases ────────────────────────────────────────────
    function test_PayoutOf_UnresolvedAndClaimed_ReturnZero() public {
        uint256 id = _openLongVsShort(100e6, 100e6);
        assertEq(market.payoutOf(id, alice), 0, "unresolved -> 0");
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);
        assertGt(market.payoutOf(id, alice), 0, "resolved winner > 0");
        vm.prank(alice);
        market.claim(id);
        assertEq(market.payoutOf(id, alice), 0, "claimed -> 0");
    }

    // M-2 (security review): the opener may straddle (bet both sides) + claim winner
    // payout AND creator cut. Verify the contract still conserves funds — no over-pay.
    function test_OpenerStraddle_NoOverpay() public {
        // alice opens LONG 100, also bets SHORT 40; bob bets SHORT 60 → pools long 100 / short 100.
        vm.prank(alice);
        uint256 id = market.openMarket(closesAt, FudArcMarket.Side.Long, 100e6);
        vm.prank(alice);
        market.bet(id, FudArcMarket.Side.Short, 40e6);
        vm.prank(bob);
        market.bet(id, FudArcMarket.Side.Short, 60e6);
        // total in = 200. LONG wins → loserPool 100, fee 10, openerCut 2, distributable 90.
        // alice (sole long winner) = 100 + 90 = 190; creator cut = 2; treasury = 8.
        vm.warp(closesAt + 1);
        vm.prank(operator);
        market.resolve(id, FudArcMarket.Outcome.Long);

        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        vm.prank(alice);
        market.claimCreator();
        // winner payout + creator cut = 192. alice's SHORT 40 stays absorbed in the loser pool.
        assertEq(usdc.balanceOf(alice) - a0, 192e6, "straddle: winner + cut, no overpay");

        market.claimTreasury();
        assertEq(usdc.balanceOf(treasury), 8e6, "treasury fee remainder");
        // conservation: 200 in == 192 (alice) + 8 (treasury); bob (loser) gets 0.
        assertEq(usdc.balanceOf(address(market)), 0, "escrow drained, no overpay");
    }
}
