// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 interface. USDC on Arc is a standard 6-decimal ERC20 at
///         0x3600000000000000000000000000000000000000. The 18-decimal *native*
///         USDC (used for gas) never touches this contract — all escrow math is
///         in 6-decimal ERC20 integer units, so the contract is decimal-agnostic.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title  FudArcMarket
/// @notice Minimal two-sided P2P conviction-market escrow for FUD on Arc.
///         An opener creates a market on one side; anyone backs LONG or SHORT
///         with USDC until it closes. An operator (later: a GenLayer-resolved
///         backend relay) reports the winning side. Winners reclaim their stake
///         plus a pro-rata share of the losing pool, net of a protocol fee. The
///         opener earns a creator cut of that fee — the on-chain version of
///         FUD's opener fee, and the hook for "creators monetize their calls".
/// @dev    Deliberately minimal: single operator, no signatures/lazy-match yet.
///         Step 1 of the Arc port — proves approvals, escrow, settlement, payout.
contract FudArcMarket {
    enum Side {
        Long, // 0, 1
        Short
    }
    enum Outcome {
        Unresolved, // 0, 1, 2, 3
        Long,
        Short,
        Draw
    }

    struct Market {
        address opener;
        uint64 closesAt;
        Outcome outcome;
        uint256 longPool;
        uint256 shortPool;
        uint256 fee; // protocol fee skimmed from the losing pool at resolve time
    }

    IERC20 public immutable usdc;
    address public owner;
    address public operator; // resolver (backend / GenLayer relay)
    address public treasury;

    uint16 public constant FEE_BPS = 1000; // 10% of the losing pool (FUD V5.4)
    uint16 public constant OPENER_CUT_BPS = 2000; // opener earns 20% of the fee
    uint16 public constant BPS = 10000;

    uint256 public nextMarketId = 1;
    mapping(uint256 => Market) public markets;
    // marketId => user => side(0|1) => staked amount
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public stakeOf;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => uint256) public creatorClaimable; // opener cut, pull-based
    uint256 public treasuryClaimable; // protocol fee remainder, pull-based

    event MarketOpened(uint256 indexed id, address indexed opener, Side side, uint256 amount, uint64 closesAt);
    event BetPlaced(uint256 indexed id, address indexed user, Side side, uint256 amount);
    event MarketResolved(uint256 indexed id, Outcome outcome, uint256 fee);
    event Claimed(uint256 indexed id, address indexed user, uint256 payout);
    event CreatorClaimed(address indexed opener, uint256 amount);
    event TreasuryClaimed(uint256 amount);

    error NotOperator();
    error NotOwner();
    error UnknownMarket();
    error Closed();
    error NotClosed();
    error AlreadyResolved();
    error NotResolved();
    error ZeroAmount();
    error AlreadyClaimed();
    error NoWinnings();
    error BadOutcome();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdc, address _operator, address _treasury) {
        if (_usdc == address(0) || _operator == address(0) || _treasury == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        owner = msg.sender;
        operator = _operator;
        treasury = _treasury;
    }

    /// @notice Open a market and take the first position on `side`.
    function openMarket(uint64 closesAt, Side side, uint256 amount) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (closesAt <= block.timestamp) revert Closed();
        id = nextMarketId++;
        Market storage m = markets[id];
        m.opener = msg.sender;
        m.closesAt = closesAt;
        _pull(msg.sender, amount);
        _record(id, m, msg.sender, side, amount);
        emit MarketOpened(id, msg.sender, side, amount, closesAt);
    }

    /// @notice Back LONG or SHORT on an open market.
    /// @dev    Anyone — including the opener — may back either side, and the same
    ///         address may stake on BOTH sides. Accepted by design: the opener is
    ///         just another bettor. The contract conserves funds in every case
    ///         (see `_payout` / accounting), so straddling can never over-pay; it
    ///         only splits the staker's own exposure across sides. (Sec review M-2.)
    function bet(uint256 id, Side side, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Market storage m = markets[id];
        if (m.opener == address(0)) revert UnknownMarket();
        if (block.timestamp >= m.closesAt) revert Closed();
        _pull(msg.sender, amount);
        _record(id, m, msg.sender, side, amount);
        emit BetPlaced(id, msg.sender, side, amount);
    }

    /// @notice Operator reports the outcome after close. Draw or one-sided
    ///         markets take no fee — everyone refunds their own stake on claim.
    function resolve(uint256 id, Outcome outcome) external onlyOperator {
        Market storage m = markets[id];
        if (m.opener == address(0)) revert UnknownMarket();
        if (outcome == Outcome.Unresolved) revert BadOutcome();
        if (block.timestamp < m.closesAt) revert NotClosed();
        if (m.outcome != Outcome.Unresolved) revert AlreadyResolved();

        if (outcome != Outcome.Draw && m.longPool > 0 && m.shortPool > 0) {
            uint256 loserPool = outcome == Outcome.Long ? m.shortPool : m.longPool;
            uint256 fee = (loserPool * FEE_BPS) / BPS;
            m.fee = fee;
            uint256 openerCut = (fee * OPENER_CUT_BPS) / BPS;
            creatorClaimable[m.opener] += openerCut;
            // Pull pattern: accrue the treasury cut instead of pushing here, so a
            // misconfigured/reverting treasury can never brick resolve (HIGH fix).
            treasuryClaimable += fee - openerCut;
        }
        m.outcome = outcome;
        emit MarketResolved(id, outcome, m.fee);
    }

    /// @notice Winner withdraws stake + pro-rata share of the net losing pool.
    function claim(uint256 id) external {
        Market storage m = markets[id];
        if (m.outcome == Outcome.Unresolved) revert NotResolved();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        claimed[id][msg.sender] = true; // effects before interaction (CEI)

        uint256 payout = _payout(id, m, msg.sender);
        if (payout == 0) revert NoWinnings();
        _push(msg.sender, payout);
        emit Claimed(id, msg.sender, payout);
    }

    /// @notice Opener withdraws accrued creator cut across all their markets.
    function claimCreator() external {
        uint256 amt = creatorClaimable[msg.sender];
        if (amt == 0) revert NoWinnings();
        creatorClaimable[msg.sender] = 0;
        _push(msg.sender, amt);
        emit CreatorClaimed(msg.sender, amt);
    }

    /// @notice Push accrued protocol fees to the treasury (permissionless trigger).
    function claimTreasury() external {
        uint256 amt = treasuryClaimable;
        if (amt == 0) revert NoWinnings();
        treasuryClaimable = 0;
        _push(treasury, amt);
        emit TreasuryClaimed(amt);
    }

    // ─── views ─────────────────────────────────────────────────────────────
    function payoutOf(uint256 id, address user) external view returns (uint256) {
        Market storage m = markets[id];
        if (m.outcome == Outcome.Unresolved || claimed[id][user]) return 0;
        return _payout(id, m, user);
    }

    // ─── internal ────────────────────────────────────────────────────────────
    function _record(uint256 id, Market storage m, address user, Side side, uint256 amount) internal {
        if (side == Side.Long) m.longPool += amount;
        else m.shortPool += amount;
        stakeOf[id][user][uint8(side)] += amount;
    }

    function _payout(uint256 id, Market storage m, address user) internal view returns (uint256) {
        // Draw OR one-sided (no counterparty) → full refund of both sides. The two states
        // intentionally share this branch (both fully refund, no fee); a future fee-on-draw
        // change would have to split them. (Sec review L-3.)
        if (m.outcome == Outcome.Draw || m.longPool == 0 || m.shortPool == 0) {
            return stakeOf[id][user][0] + stakeOf[id][user][1];
        }
        uint8 winSide = m.outcome == Outcome.Long ? 0 : 1;
        // Only the winning-side stake pays out. A straddling bettor's losing-side stake is
        // intentionally NOT refunded here — it lives in `loserPool`/`distributable` and funds the
        // winners. After claim() sets `claimed`, payoutOf returns 0 (expected, not a bug). (Sec L-1.)
        uint256 stake = stakeOf[id][user][winSide];
        if (stake == 0) return 0;
        uint256 winnerPool = winSide == 0 ? m.longPool : m.shortPool;
        uint256 loserPool = winSide == 0 ? m.shortPool : m.longPool;
        uint256 distributable = loserPool - m.fee;
        // Pro-rata via integer division: floor(stake * distributable / winnerPool). With
        // MULTIPLE winners on the same side the floors can leave up to (winners - 1) units of
        // USDC dust (~$0.000001 each) in the contract — an accepted, negligible property of
        // integer pro-rata, by design (no sweep to keep the contract minimal). Single-winner
        // markets (incl. the operator-both-sides demo) distribute the pool exactly: no dust.
        return stake + (stake * distributable) / winnerPool;
    }

    function _pull(address from, uint256 amount) internal {
        if (!usdc.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }

    // ─── admin ─────────────────────────────────────────────────────────────
    function setOperator(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        operator = a;
    }

    function setTreasury(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        treasury = a;
    }

    function transferOwnership(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        owner = a;
    }
}
