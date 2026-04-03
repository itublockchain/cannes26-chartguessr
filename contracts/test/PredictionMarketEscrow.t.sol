// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PredictionMarketEscrow} from "../src/PredictionMarketEscrow.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract PredictionMarketEscrowTest is Test {
    PredictionMarketEscrow public escrow;
    MockUSDC public usdc;

    address owner = address(this);
    address operator = address(this);
    address feeRecipient = address(0xFEE);
    address player1 = address(0xA1);
    address player2 = address(0xA2);
    address creForwarder = address(0xC8E);

    uint256 entryFee = 1_000_000; // 1 USDC
    bytes32 matchId = keccak256("match-1");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new PredictionMarketEscrow(
            address(usdc),
            feeRecipient,
            500,           // 5% fee
            1_000_000,     // min 1 USDC
            100_000_000,   // max 100 USDC
            address(0)     // fallback mode — operator settles
        );

        // Fund players
        usdc.mint(player1, 100_000_000);
        usdc.mint(player2, 100_000_000);

        // Approve escrow
        vm.prank(player1);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(player2);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ─── createMatch ────────────────────────────────────────

    function test_createMatch() public {
        escrow.createMatch(matchId, player1, player2, entryFee);

        PredictionMarketEscrow.Match memory m = escrow.getMatch(matchId);
        assertEq(m.player1, player1);
        assertEq(m.player2, player2);
        assertEq(m.entryFee, entryFee);
        assertEq(uint256(m.state), uint256(PredictionMarketEscrow.MatchState.AWAITING_PLAYERS));
    }

    function test_createMatch_revert_duplicate() public {
        escrow.createMatch(matchId, player1, player2, entryFee);
        vm.expectRevert("Match exists");
        escrow.createMatch(matchId, player1, player2, entryFee);
    }

    function test_createMatch_revert_samePlayers() public {
        vm.expectRevert("Same player");
        escrow.createMatch(matchId, player1, player1, entryFee);
    }

    function test_createMatch_revert_feeTooLow() public {
        vm.expectRevert("Invalid fee");
        escrow.createMatch(matchId, player1, player2, 100); // below min
    }

    // ─── enterMatch ─────────────────────────────────────────

    function test_enterMatch_player1() public {
        escrow.createMatch(matchId, player1, player2, entryFee);

        vm.prank(player1);
        escrow.enterMatch(matchId);

        PredictionMarketEscrow.Match memory m = escrow.getMatch(matchId);
        assertTrue(m.player1Entered);
        assertFalse(m.player2Entered);
        assertEq(uint256(m.state), uint256(PredictionMarketEscrow.MatchState.PARTIAL));
        assertEq(usdc.balanceOf(address(escrow)), entryFee);
    }

    function test_enterMatch_bothPlayers_locks() public {
        escrow.createMatch(matchId, player1, player2, entryFee);

        vm.prank(player1);
        escrow.enterMatch(matchId);
        vm.prank(player2);
        escrow.enterMatch(matchId);

        PredictionMarketEscrow.Match memory m = escrow.getMatch(matchId);
        assertEq(uint256(m.state), uint256(PredictionMarketEscrow.MatchState.LOCKED));
        assertEq(usdc.balanceOf(address(escrow)), entryFee * 2);
    }

    function test_enterMatch_revert_notPlayer() public {
        escrow.createMatch(matchId, player1, player2, entryFee);
        address stranger = address(0xBAD);
        vm.prank(stranger);
        vm.expectRevert("Not a player");
        escrow.enterMatch(matchId);
    }

    function test_enterMatch_revert_alreadyEntered() public {
        escrow.createMatch(matchId, player1, player2, entryFee);
        vm.prank(player1);
        escrow.enterMatch(matchId);
        vm.prank(player1);
        vm.expectRevert("Already entered");
        escrow.enterMatch(matchId);
    }

    // ─── settleMatch (fallback mode — operator settles) ─────

    function test_settleMatch_winner() public {
        _lockMatch();

        uint256 p1Before = usdc.balanceOf(player1);
        escrow.settleMatch(matchId, player1, 85000e18, 86000e18);

        PredictionMarketEscrow.Match memory m = escrow.getMatch(matchId);
        assertEq(uint256(m.state), uint256(PredictionMarketEscrow.MatchState.RESOLVED));
        assertEq(m.winner, player1);

        uint256 pot = entryFee * 2;
        uint256 fee = (pot * 500) / 10_000;
        uint256 payout = pot - fee;
        assertEq(usdc.balanceOf(player1), p1Before + payout);
        assertEq(usdc.balanceOf(feeRecipient), fee);
    }

    function test_settleMatch_draw() public {
        _lockMatch();

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);

        escrow.settleMatch(matchId, address(0), 85000e18, 86000e18);

        PredictionMarketEscrow.Match memory m = escrow.getMatch(matchId);
        assertEq(uint256(m.state), uint256(PredictionMarketEscrow.MatchState.DRAW));
        assertEq(usdc.balanceOf(player1), p1Before + entryFee);
        assertEq(usdc.balanceOf(player2), p2Before + entryFee);
    }

    function test_settleMatch_revert_notLocked() public {
        escrow.createMatch(matchId, player1, player2, entryFee);
        vm.expectRevert("Not locked");
        escrow.settleMatch(matchId, player1, 0, 0);
    }

    // ─── settleMatch (CRE mode) ─────────────────────────────

    function test_settleMatch_creMode() public {
        // Deploy with CRE forwarder
        PredictionMarketEscrow escrowCRE = new PredictionMarketEscrow(
            address(usdc), feeRecipient, 500, 1_000_000, 100_000_000, creForwarder
        );
        vm.prank(player1);
        usdc.approve(address(escrowCRE), type(uint256).max);
        vm.prank(player2);
        usdc.approve(address(escrowCRE), type(uint256).max);

        bytes32 mid = keccak256("cre-match");
        escrowCRE.createMatch(mid, player1, player2, entryFee);
        vm.prank(player1);
        escrowCRE.enterMatch(mid);
        vm.prank(player2);
        escrowCRE.enterMatch(mid);

        // Operator cannot settle in CRE mode
        vm.expectRevert("Not CRE forwarder");
        escrowCRE.settleMatch(mid, player1, 0, 0);

        // CRE forwarder can settle
        vm.prank(creForwarder);
        escrowCRE.settleMatch(mid, player2, 85000e18, 86000e18);

        PredictionMarketEscrow.Match memory m = escrowCRE.getMatch(mid);
        assertEq(m.winner, player2);
    }

    // ─── cancelMatch ────────────────────────────────────────

    function test_cancelMatch_awaitingPlayers() public {
        escrow.createMatch(matchId, player1, player2, entryFee);
        escrow.cancelMatch(matchId);

        PredictionMarketEscrow.Match memory m = escrow.getMatch(matchId);
        assertEq(uint256(m.state), uint256(PredictionMarketEscrow.MatchState.CANCELLED));
    }

    function test_cancelMatch_partial_refunds() public {
        escrow.createMatch(matchId, player1, player2, entryFee);
        vm.prank(player1);
        escrow.enterMatch(matchId);

        uint256 p1Before = usdc.balanceOf(player1);
        escrow.cancelMatch(matchId);
        assertEq(usdc.balanceOf(player1), p1Before + entryFee);
    }

    function test_cancelMatch_locked_refundsBoth() public {
        _lockMatch();

        uint256 p1Before = usdc.balanceOf(player1);
        uint256 p2Before = usdc.balanceOf(player2);
        escrow.cancelMatch(matchId);

        assertEq(usdc.balanceOf(player1), p1Before + entryFee);
        assertEq(usdc.balanceOf(player2), p2Before + entryFee);
    }

    // ─── canPlay ────────────────────────────────────────────

    function test_canPlay() public view {
        assertTrue(escrow.canPlay(player1, entryFee));
    }

    // ─── Helpers ────────────────────────────────────────────

    function _lockMatch() internal {
        escrow.createMatch(matchId, player1, player2, entryFee);
        vm.prank(player1);
        escrow.enterMatch(matchId);
        vm.prank(player2);
        escrow.enterMatch(matchId);
    }
}
