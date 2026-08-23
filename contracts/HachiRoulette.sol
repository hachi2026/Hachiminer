// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HachiRoulette - Ruleta en vivo con rondas
 * @notice Ruleta europea (37 nums) con sistema de rondas
 *
 * FASES POR RONDA:
 *   OPEN (0-60s):       apuestas abiertas
 *   COMMITTED (60-90s): commit hecho, esperando 10 bloques
 *   SETTLED:            resultado conocido, ganadores cobran
 *
 * TIPOS DE APUESTA:
 *   NUMBER (0-36): paga 35x
 *   RED/BLACK:     paga 1x
 *   EVEN/ODD:      paga 1x
 *   LOW (1-18):    paga 1x
 *   HIGH (19-36):  paga 1x
 *
 * Consulta balance/pool al HachiSlot (es donde se almacenan)
 * Tiene su propio pool interno (2.5M HACHI v1 inicial)
 *
 * APUESTA MÍNIMA: monto FIJO en HACHI (no depende de ningún oráculo de
 * USD, que no existe en nuestro ecosistema). Ajustable por el owner.
 *
 * SEGURIDAD DE EMERGENCIA: retiro de fondos con demora de 48hs, mismo
 * patrón que el resto de los contratos de Hachi.
 */

interface IERC20 {
    function transfer(address, uint) external returns (bool);
    function transferFrom(address, address, uint) external returns (bool);
    function balanceOf(address) external view returns (uint);
    function approve(address, uint) external returns (bool);
}

interface IWorldID {
    function verifyProof(
        uint256 root, uint256 groupId, uint256 signalHash,
        uint256 nullifierHash, uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}

interface IHachiSlot {
    function balance(address user) external view returns (uint);
    function rouletteDebitBalance(address user, uint amount) external;
    function rouletteCreditBalance(address user, uint amount) external;
    function rouletteIsValidBalance(address user, uint amount) external view returns (bool);
}

contract HachiRoulette {

    IERC20 public immutable HACHI;
    IWorldID public worldId;
    IHachiSlot public slotContract;  // para consultar balances

    address public owner;

    uint public minBetHachi = 10 * 1e18;  // apuesta mínima fija en HACHI
    uint public pool;
    uint public ownerHachiFromFees;
    uint public totalRouletteSpins;
    uint public totalVolume;

    uint public constant FEE_OWNER = 3;
    uint public constant MAX_BET_PCT = 100;
    uint public constant MIN_POOL_PCT = 2000;
    uint public initialPool;

    uint public constant COMMIT_BLOCKS = 10;
    uint public constant ROUND_BETTING_DURATION = 60;
    uint public constant MAX_BETS_PER_USER = 5;
    uint public constant ROUND_TOTAL_CAP_PCT = 500; // 5%

    enum BetType { NUMBER, RED, BLACK, EVEN, ODD, LOW, HIGH }
    enum RoundPhase { OPEN, COMMITTED, SETTLED }

    struct RouletteBet {
        address user;
        uint amount;
        BetType betType;
        uint8 chosenNumber;
        bool claimed;
    }

    struct RouletteRound {
        uint roundId;
        uint startTime;
        uint endBetsTime;
        uint commitBlock;
        uint commitHash;
        uint8 winningNumber;
        uint totalBets;
        RoundPhase phase;
    }

    uint public currentRoundId;
    mapping(uint => RouletteRound) public rounds;
    mapping(uint => RouletteBet[]) public roundBets;
    mapping(uint => mapping(address => uint)) public roundUserBetCount;

    mapping(uint256 => bool) public usedNullifiers;
    bool public paused;
    uint256 public worldIdGroupId = 1;
    uint256 public worldIdExternalNullifierHash;

    // ─────── EMERGENCIA ───────
    uint public emergencyUnlockTime;

    event RoundStarted(uint indexed roundId, uint startTime, uint endBetsTime);
    event BetPlaced(uint indexed roundId, address indexed user, uint amount, BetType betType, uint8 num, uint betIndex);
    event RoundCommitted(uint indexed roundId, uint commitBlock);
    event RoundRevealed(uint indexed roundId, uint8 winningNumber, uint totalBets, uint betsCount);
    event WinningsClaimed(uint indexed roundId, address indexed user, uint betIndex, uint payout);
    event PoolSeeded(uint amount);
    event MinBetChanged(uint minBetHachi);
    event EmergencyRequested(uint unlockTime);
    event EmergencyCancelled();
    event EmergencyExecuted(address token, uint amount);

    modifier onlyOwner() { require(msg.sender == owner, "NoOwn"); _; }
    modifier notPaused() { require(!paused, "P"); _; }
    modifier nonReentrant() {
        require(_lock == 1, "RE");
        _lock = 2; _;
        _lock = 1;
    }
    uint private _lock = 1;

    constructor(
        address _hachi,
        address _worldId,
        address _slot,
        uint256 _externalNullifierHash
    ) {
        HACHI = IERC20(_hachi);
        worldId = IWorldID(_worldId);
        slotContract = IHachiSlot(_slot);
        owner = msg.sender;
        worldIdExternalNullifierHash = _externalNullifierHash;
    }

    // ADMIN
    function setSlotContract(address _s) external onlyOwner {
        require(_s != address(0), "Inv");
        slotContract = IHachiSlot(_s);
    }
    function setWorldId(address _w) external onlyOwner { worldId = IWorldID(_w); }
    function setPaused(bool _p) external onlyOwner { paused = _p; }

    /// @notice Ajustar la apuesta mínima fija en HACHI (no en USD).
    function setMinBetHachi(uint _v) external onlyOwner {
        require(_v > 0, "InvR");
        minBetHachi = _v;
        emit MinBetChanged(_v);
    }

    function transferOwnership(address _n) external onlyOwner {
        require(_n != address(0), "Inv");
        owner = _n;
    }

    // POOL
    function seedPool(uint amount) external onlyOwner {
        require(amount > 0, "0amt");
        HACHI.transferFrom(msg.sender, address(this), amount);
        pool += amount;
        if (initialPool == 0) initialPool = amount;
        emit PoolSeeded(amount);
    }

    function ownerWithdrawFees() external onlyOwner nonReentrant {
        uint amount = ownerHachiFromFees;
        require(amount > 0, "0amt");
        ownerHachiFromFees = 0;
        HACHI.transfer(owner, amount);
    }

    function minPoolAllowed() public view returns (uint) {
        return (initialPool * MIN_POOL_PCT) / 10000;
    }

    // ─────── VIEWS BÁSICOS ───────
    function maxBet() public view returns (uint) {
        return (pool * MAX_BET_PCT) / 10000;
    }

    // ─────── RONDAS ───────
    function _startRound() internal {
        currentRoundId++;
        uint nowTs = block.timestamp;

        rounds[currentRoundId] = RouletteRound({
            roundId: currentRoundId,
            startTime: nowTs,
            endBetsTime: nowTs + ROUND_BETTING_DURATION,
            commitBlock: 0,
            commitHash: 0,
            winningNumber: 0,
            totalBets: 0,
            phase: RoundPhase.OPEN
        });

        emit RoundStarted(currentRoundId, nowTs, nowTs + ROUND_BETTING_DURATION);
    }

    function startRound() external notPaused {
        if (currentRoundId > 0) {
            require(rounds[currentRoundId].phase == RoundPhase.SETTLED, "Active");
        }
        _startRound();
    }

    function joinRound(
        uint amount,
        BetType betType,
        uint8 chosenNumber,
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external notPaused nonReentrant {
        // Auto-iniciar si no hay ronda
        if (currentRoundId == 0 || rounds[currentRoundId].phase == RoundPhase.SETTLED) {
            _startRound();
        }

        RouletteRound storage round = rounds[currentRoundId];
        require(round.phase == RoundPhase.OPEN, "Closed");
        require(block.timestamp <= round.endBetsTime, "Exp");

        require(amount >= minBetHachi, "Low");
        require(amount <= maxBet(), "High");
        require(pool >= minPoolAllowed(), "PoolLow");

        if (betType == BetType.NUMBER) {
            require(chosenNumber <= 36, "NumOOR");
        }

        require(roundUserBetCount[currentRoundId][msg.sender] < MAX_BETS_PER_USER, "MaxBets");
        uint roundCap = (pool * ROUND_TOTAL_CAP_PCT) / 10000;
        require(round.totalBets + amount <= roundCap, "Full");

        // Debitar balance del Slot contract
        require(slotContract.rouletteIsValidBalance(msg.sender, amount), "NoBal");

        _verifyWorldId(root, nullifierHash, proof);

        slotContract.rouletteDebitBalance(msg.sender, amount);

        uint betIndex = roundBets[currentRoundId].length;
        roundBets[currentRoundId].push(RouletteBet({
            user: msg.sender,
            amount: amount,
            betType: betType,
            chosenNumber: chosenNumber,
            claimed: false
        }));

        roundUserBetCount[currentRoundId][msg.sender]++;
        round.totalBets += amount;

        emit BetPlaced(currentRoundId, msg.sender, amount, betType, chosenNumber, betIndex);
    }

    function startCommit() external notPaused {
        RouletteRound storage round = rounds[currentRoundId];
        require(round.phase == RoundPhase.OPEN, "InvP");
        require(block.timestamp > round.endBetsTime, "Open");

        if (round.totalBets == 0) {
            round.phase = RoundPhase.SETTLED;
            return;
        }

        round.phase = RoundPhase.COMMITTED;
        round.commitBlock = block.number;
        round.commitHash = uint(keccak256(abi.encodePacked(
            currentRoundId,
            round.totalBets,
            roundBets[currentRoundId].length,
            blockhash(block.number - 1),
            block.prevrandao,
            block.timestamp,
            address(this)
        )));

        emit RoundCommitted(currentRoundId, block.number);
    }

    function revealRound() external notPaused {
        RouletteRound storage round = rounds[currentRoundId];
        require(round.phase == RoundPhase.COMMITTED, "InvP");
        require(block.number >= round.commitBlock + COMMIT_BLOCKS, "Wait");
        require(block.number <= round.commitBlock + 256, "Exp");

        uint random = uint(keccak256(abi.encodePacked(
            blockhash(round.commitBlock),
            round.commitHash,
            round.roundId,
            block.prevrandao
        )));

        round.winningNumber = uint8(random % 37);
        round.phase = RoundPhase.SETTLED;
        totalRouletteSpins++;
        totalVolume += round.totalBets;

        emit RoundRevealed(currentRoundId, round.winningNumber, round.totalBets, roundBets[currentRoundId].length);
    }

    function claimWinnings(uint roundId, uint betIndex) external nonReentrant {
        RouletteRound storage round = rounds[roundId];
        require(round.phase == RoundPhase.SETTLED, "NoSet");
        require(betIndex < roundBets[roundId].length, "InvB");

        RouletteBet storage bet = roundBets[roundId][betIndex];
        require(bet.user == msg.sender, "NotYours");
        require(!bet.claimed, "Done");

        bet.claimed = true;

        bool won = _checkWin(bet.betType, bet.chosenNumber, round.winningNumber);

        // Aplicar fees
        uint ownerFee = (bet.amount * FEE_OWNER) / 100;
        uint netBet = bet.amount - ownerFee;
        ownerHachiFromFees += ownerFee;

        if (!won) {
            pool += netBet;
            emit WinningsClaimed(roundId, msg.sender, betIndex, 0);
            return;
        }

        // Calcular payout
        uint multiplier = (bet.betType == BetType.NUMBER) ? 35 : 1;
        uint payout = bet.amount + (netBet * multiplier);

        uint poolPlusBet = pool + netBet;
        if (payout >= poolPlusBet) {
            payout = poolPlusBet;
            pool = 0;
        } else {
            pool = poolPlusBet - payout;
        }

        // Acreditar al balance del usuario en el Slot
        slotContract.rouletteCreditBalance(msg.sender, payout);

        emit WinningsClaimed(roundId, msg.sender, betIndex, payout);
    }

    function _checkWin(BetType betType, uint8 chosen, uint8 winning) internal pure returns (bool) {
        if (betType == BetType.NUMBER) return chosen == winning;
        if (winning == 0) return false;
        if (betType == BetType.RED)   return _isRed(winning);
        if (betType == BetType.BLACK) return !_isRed(winning) && winning != 0;
        if (betType == BetType.EVEN)  return winning % 2 == 0;
        if (betType == BetType.ODD)   return winning % 2 == 1;
        if (betType == BetType.LOW)   return winning >= 1 && winning <= 18;
        if (betType == BetType.HIGH)  return winning >= 19 && winning <= 36;
        return false;
    }

    function _isRed(uint8 number) internal pure returns (bool) {
        if (number == 0 || number > 36) return false;
        // Bitmap rojos: 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36
        uint mask = 0x154AAD52AA;
        return ((mask >> number) & 1) == 1;
    }

    function _verifyWorldId(uint256 root, uint256 nullifierHash, uint256[8] calldata proof) internal {
        require(!usedNullifiers[nullifierHash], "Used");
        worldId.verifyProof(
            root,
            worldIdGroupId,
            uint256(uint160(msg.sender)),
            nullifierHash,
            worldIdExternalNullifierHash,
            proof
        );
        usedNullifiers[nullifierHash] = true;
    }

    // ─────── VIEWS ───────
    function currentRoundInfo() external view returns (
        uint roundId,
        RoundPhase phase,
        uint startTime,
        uint endBetsTime,
        uint timeRemaining,
        uint totalBets,
        uint betsCount,
        uint8 winningNumber
    ) {
        RouletteRound storage round = rounds[currentRoundId];
        roundId = round.roundId;
        phase = round.phase;
        startTime = round.startTime;
        endBetsTime = round.endBetsTime;
        totalBets = round.totalBets;
        betsCount = roundBets[currentRoundId].length;
        winningNumber = round.winningNumber;
        if (round.phase == RoundPhase.OPEN && block.timestamp < round.endBetsTime) {
            timeRemaining = round.endBetsTime - block.timestamp;
        }
    }

    function getRoundBets(uint roundId) external view returns (RouletteBet[] memory) {
        return roundBets[roundId];
    }

    function getUserRoundBets(uint roundId, address user)
        external view returns (uint[] memory indices, RouletteBet[] memory bets)
    {
        uint count = 0;
        RouletteBet[] memory all = roundBets[roundId];
        for (uint i = 0; i < all.length; i++) {
            if (all[i].user == user) count++;
        }
        indices = new uint[](count);
        bets = new RouletteBet[](count);
        uint j = 0;
        for (uint i = 0; i < all.length; i++) {
            if (all[i].user == user) {
                indices[j] = i;
                bets[j] = all[i];
                j++;
            }
        }
    }

    // ─────── EMERGENCIA (demora de 48hs, mismo patrón que el resto de Hachi) ───────
    function requestEmergency() external onlyOwner {
        emergencyUnlockTime = block.timestamp + 48 hours;
        emit EmergencyRequested(emergencyUnlockTime);
    }

    function cancelEmergency() external onlyOwner {
        emergencyUnlockTime = 0;
        emit EmergencyCancelled();
    }

    function emergencyWithdraw(address token, uint amount) external onlyOwner nonReentrant {
        require(emergencyUnlockTime > 0 && block.timestamp >= emergencyUnlockTime, "Timelock no cumplido");
        emergencyUnlockTime = 0;
        IERC20(token).transfer(owner, amount);
        emit EmergencyExecuted(token, amount);
    }

    // ─────── RESCATE (tokens que NO son HACHI, sin timelock) ───────
    function rescueToken(address token, uint amount) external onlyOwner {
        if (token == address(HACHI)) {
            uint locked = pool + ownerHachiFromFees;
            uint free = HACHI.balanceOf(address(this)) - locked;
            require(amount <= free, "Locked");
        }
        IERC20(token).transfer(owner, amount);
    }
}
