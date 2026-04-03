// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";

contract PredictionMarketEscrow {
    // ─── Enums ───────────────────────────────────────────────
    enum MatchState {
        EMPTY,            // 0
        AWAITING_PLAYERS, // 1
        PARTIAL,          // 2
        LOCKED,           // 3
        RESOLVED,         // 4
        CANCELLED,        // 5
        DRAW              // 6
    }

    // ─── Structs ─────────────────────────────────────────────
    struct Match {
        address player1;
        address player2;
        uint256 entryFee;
        bool player1Entered;
        bool player2Entered;
        MatchState state;
        address winner;
        int256 startPrice;   // Data Streams BTC/USD (18 decimals)
        int256 endPrice;
        uint256 createdAt;
        uint256 lockedAt;
        uint256 resolvedAt;
    }

    // ─── Events ──────────────────────────────────────────────
    event MatchCreated(
        bytes32 indexed matchId,
        address indexed player1,
        address indexed player2,
        uint256 entryFee
    );
    event PlayerEntered(bytes32 indexed matchId, address indexed player);
    event MatchLocked(bytes32 indexed matchId, uint256 timestamp);
    event MatchResolved(
        bytes32 indexed matchId,
        address indexed winner,
        uint256 payout,
        uint256 fee,
        int256 startPrice,
        int256 endPrice
    );
    event MatchDraw(bytes32 indexed matchId);
    event MatchCancelled(bytes32 indexed matchId);

    // ─── State ───────────────────────────────────────────────
    IERC20 public immutable usdc;
    address public owner;
    address public operator;
    address public feeRecipient;
    address public creForwarder;   // address(0) = fallback mode (operator settles)

    uint256 public platformFeeBps; // 500 = 5%
    uint256 public minEntryFee;
    uint256 public maxEntryFee;

    mapping(bytes32 => Match) public matches;

    // ─── Modifiers ───────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    modifier onlySettler() {
        if (creForwarder != address(0)) {
            require(msg.sender == creForwarder, "Not CRE forwarder");
        } else {
            require(msg.sender == operator, "Not operator (fallback)");
        }
        _;
    }

    // ─── Constructor ─────────────────────────────────────────
    constructor(
        address _usdc,
        address _feeRecipient,
        uint256 _platformFeeBps,
        uint256 _minEntryFee,
        uint256 _maxEntryFee,
        address _creForwarder
    ) {
        require(_usdc != address(0), "Invalid USDC");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_platformFeeBps <= 1000, "Fee too high"); // max 10%

        usdc = IERC20(_usdc);
        owner = msg.sender;
        operator = msg.sender;
        feeRecipient = _feeRecipient;
        platformFeeBps = _platformFeeBps;
        minEntryFee = _minEntryFee;
        maxEntryFee = _maxEntryFee;
        creForwarder = _creForwarder;
    }

    // ─── Core Functions ──────────────────────────────────────

    function createMatch(
        bytes32 matchId,
        address player1,
        address player2,
        uint256 entryFee
    ) external onlyOperator {
        require(matches[matchId].state == MatchState.EMPTY, "Match exists");
        require(player1 != address(0) && player2 != address(0), "Zero address");
        require(player1 != player2, "Same player");
        require(entryFee >= minEntryFee && entryFee <= maxEntryFee, "Invalid fee");

        matches[matchId] = Match({
            player1: player1,
            player2: player2,
            entryFee: entryFee,
            player1Entered: false,
            player2Entered: false,
            state: MatchState.AWAITING_PLAYERS,
            winner: address(0),
            startPrice: 0,
            endPrice: 0,
            createdAt: block.timestamp,
            lockedAt: 0,
            resolvedAt: 0
        });

        emit MatchCreated(matchId, player1, player2, entryFee);
    }

    function enterMatch(bytes32 matchId) external {
        Match storage m = matches[matchId];
        require(
            m.state == MatchState.AWAITING_PLAYERS || m.state == MatchState.PARTIAL,
            "Invalid state"
        );

        bool isPlayer1 = msg.sender == m.player1;
        bool isPlayer2 = msg.sender == m.player2;
        require(isPlayer1 || isPlayer2, "Not a player");

        if (isPlayer1) {
            require(!m.player1Entered, "Already entered");
            m.player1Entered = true;
        } else {
            require(!m.player2Entered, "Already entered");
            m.player2Entered = true;
        }

        require(usdc.transferFrom(msg.sender, address(this), m.entryFee), "Transfer failed");

        emit PlayerEntered(matchId, msg.sender);

        if (m.player1Entered && m.player2Entered) {
            m.state = MatchState.LOCKED;
            m.lockedAt = block.timestamp;
            emit MatchLocked(matchId, block.timestamp);
        } else {
            m.state = MatchState.PARTIAL;
        }
    }

    function settleMatch(
        bytes32 matchId,
        address winner,
        int256 startPrice,
        int256 endPrice
    ) external onlySettler {
        Match storage m = matches[matchId];
        require(m.state == MatchState.LOCKED, "Not locked");
        require(
            winner == m.player1 || winner == m.player2 || winner == address(0),
            "Invalid winner"
        );

        m.startPrice = startPrice;
        m.endPrice = endPrice;
        m.resolvedAt = block.timestamp;

        uint256 pot = m.entryFee * 2;

        if (winner == address(0)) {
            // Draw — refund both
            m.state = MatchState.DRAW;
            require(usdc.transfer(m.player1, m.entryFee), "Refund p1 failed");
            require(usdc.transfer(m.player2, m.entryFee), "Refund p2 failed");
            emit MatchDraw(matchId);
        } else {
            // Winner takes pot minus fee
            m.state = MatchState.RESOLVED;
            m.winner = winner;

            uint256 fee = (pot * platformFeeBps) / 10_000;
            uint256 payout = pot - fee;

            require(usdc.transfer(winner, payout), "Payout failed");
            if (fee > 0) {
                require(usdc.transfer(feeRecipient, fee), "Fee transfer failed");
            }

            emit MatchResolved(matchId, winner, payout, fee, startPrice, endPrice);
        }
    }

    function cancelMatch(bytes32 matchId) external onlyOperator {
        Match storage m = matches[matchId];
        require(
            m.state == MatchState.AWAITING_PLAYERS ||
            m.state == MatchState.PARTIAL ||
            m.state == MatchState.LOCKED,
            "Cannot cancel"
        );

        MatchState prevState = m.state;
        m.state = MatchState.CANCELLED;

        if (prevState == MatchState.PARTIAL) {
            if (m.player1Entered) {
                require(usdc.transfer(m.player1, m.entryFee), "Refund p1 failed");
            }
            if (m.player2Entered) {
                require(usdc.transfer(m.player2, m.entryFee), "Refund p2 failed");
            }
        } else if (prevState == MatchState.LOCKED) {
            require(usdc.transfer(m.player1, m.entryFee), "Refund p1 failed");
            require(usdc.transfer(m.player2, m.entryFee), "Refund p2 failed");
        }

        emit MatchCancelled(matchId);
    }

    // ─── View Functions ──────────────────────────────────────

    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    function canPlay(address player, uint256 entryFee) external view returns (bool) {
        return usdc.balanceOf(player) >= entryFee
            && usdc.allowance(player, address(this)) >= entryFee;
    }

    // ─── Admin Functions ─────────────────────────────────────

    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Zero address");
        operator = _operator;
    }

    function setCREForwarder(address _creForwarder) external onlyOwner {
        creForwarder = _creForwarder;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Zero address");
        feeRecipient = _feeRecipient;
    }

    function setPlatformFeeBps(uint256 _platformFeeBps) external onlyOwner {
        require(_platformFeeBps <= 1000, "Fee too high");
        platformFeeBps = _platformFeeBps;
    }
}
