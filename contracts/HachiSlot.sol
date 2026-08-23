// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HachiSlot - Slot machine + Balance Manager
 * @notice Slot machine con commit-reveal en HACHI v1
 *
 * El módulo Roulette consulta este contrato para balances/pool
 * via funciones authorized (rouletteDebit/Credit).
 *
 * INICIAL: Owner deposita 2.5M HACHI v1 al pool (seedPool)
 *
 * MULTIPLICADORES (RTP 90.25%):
 *   32% pierde (0x)
 *   25% recupera 0.75x
 *   20% recupera 1x
 *   12% gana 1.5x
 *   6%  gana 2x
 *   3.5% gana 3x
 *   1.2% gana 5x
 *   0.25% gana 10x
 *   0.05% jackpot 50x
 *
 * FEES (sobre la apuesta):
 *   95% al pool casino
 *   3% al owner
 *   2% se queda en pool (sin staking en esta versión)
 *
 * APUESTAS: montos FIJOS en HACHI (no dependen de ningún oráculo de USD,
 * que no existe en nuestro ecosistema). Ajustables por el owner en
 * cualquier momento vía setBetAmounts.
 *
 * BOLETOS GRATIS: se otorgan desde una wallet "granter" separada del owner
 * (pensada para ser controlada por un proceso automático del backend que
 * escucha compras de licencias WLD), sin necesidad de tocar HachiMinerCore.
 * La cantidad por nivel de licencia (Básica/Estándar/Premium/Elite) es
 * configurable on-chain vía setFreeSpinsPerTier — el backend solo lee este
 * valor y llama a grantFreeSpins, no hace falta tocar el backend para
 * ajustar la cantidad.
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

contract HachiSlot {

    IERC20 public immutable HACHI;
    IWorldID public worldId;

    address public owner;
    address public rouletteModule;
    address public granter; // wallet separada, autorizada SOLO para otorgar boletos gratis

    uint public minBetHachi = 10 * 1e18;         // apuesta mínima normal
    uint public freeSpinBetHachi = 100 * 1e18;   // valor "nominal" de cada tiro gratis
    uint public pool;
    uint public ownerHachiFromFees;
    uint public totalSpins;
    uint public totalVolume;

    uint public constant FEE_OWNER = 3;
    uint public constant MAX_BET_PCT = 100;  // 1%
    uint public constant MIN_POOL_PCT = 2000; // 20%
    uint public initialPool;
    uint public constant COMMIT_BLOCKS = 10;

    /// @notice Boletos gratis por nivel de licencia WLD (índice 0=Básica,
    ///         1=Estándar, 2=Premium, 3=Elite). Arranca en 1 para todos,
    ///         ajustable en cualquier momento por el owner.
    uint[4] public freeSpinsPerTier = [1, 1, 1, 1];

    mapping(address => uint) public balance;
    mapping(address => uint) public freeSpinsAvailable;
    mapping(uint256 => bool) public usedNullifiers;
    bool public paused;

    // Evita otorgar boletos 2 veces por la misma compra de licencia
    mapping(bytes32 => bool) public grantedForPurchase;

    struct Commit {
        uint bet;
        uint blockNumber;
        uint commitHash;
        bool exists;
        bool isFreeSpin;
    }
    mapping(address => Commit) public commits;

    uint256 public worldIdGroupId = 1;
    uint256 public worldIdExternalNullifierHash;

    // ─────── EMERGENCIA ───────
    uint public emergencyUnlockTime;

    event Deposited(address indexed user, uint amount);
    event Withdrew(address indexed user, uint amount);
    event SpinCommitted(address indexed user, uint bet, uint revealBlock);
    event SpinRevealed(address indexed user, uint bet, uint multiplier, uint payout);
    event PoolSeeded(uint amount);
    event PoolProtected(uint poolBalance, uint minRequired);
    event OwnerWithdrew(uint amount);
    event FreeSpinGranted(address indexed user, uint count, bytes32 indexed purchaseRef);
    event FreeSpinUsed(address indexed user, uint remaining);
    event BetAmountsChanged(uint minBetHachi, uint freeSpinBetHachi);
    event FreeSpinsPerTierChanged(uint[4] amounts);
    event EmergencyRequested(uint unlockTime);
    event EmergencyCancelled();
    event EmergencyExecuted(address token, uint amount);

    modifier onlyOwner() { require(msg.sender == owner, "NoOwn"); _; }
    modifier onlyGranter() { require(msg.sender == granter || msg.sender == owner, "NoAuth"); _; }
    modifier notPaused() { require(!paused, "P"); _; }
    modifier nonReentrant() {
        require(_lock == 1, "RE");
        _lock = 2; _;
        _lock = 1;
    }
    uint private _lock = 1;

    constructor(address _hachi, address _worldId, uint256 _externalNullifierHash) {
        HACHI = IERC20(_hachi);
        worldId = IWorldID(_worldId);
        owner = msg.sender;
        granter = msg.sender; // por defecto el owner, se puede cambiar después
        worldIdExternalNullifierHash = _externalNullifierHash;
    }

    // ─────── ADMIN ───────
    function setRouletteModule(address _r) external onlyOwner {
        require(_r != address(0), "Inv");
        rouletteModule = _r;
    }
    function setGranter(address _g) external onlyOwner {
        require(_g != address(0), "Inv");
        granter = _g;
    }
    function setWorldId(address _w) external onlyOwner { worldId = IWorldID(_w); }
    function setPaused(bool _p) external onlyOwner { paused = _p; }

    /// @notice Ajustar los montos fijos de apuesta en HACHI (no en USD, no
    ///         depende de ningún oráculo). Pensado para ajustar a futuro si
    ///         el valor de HACHI cambia mucho.
    function setBetAmounts(uint _minBetHachi, uint _freeSpinBetHachi) external onlyOwner {
        require(_minBetHachi > 0 && _freeSpinBetHachi > 0, "InvAmt");
        minBetHachi = _minBetHachi;
        freeSpinBetHachi = _freeSpinBetHachi;
        emit BetAmountsChanged(_minBetHachi, _freeSpinBetHachi);
    }

    /// @notice Ajustar cuántos boletos gratis otorga cada nivel de licencia
    ///         WLD (Básica/Estándar/Premium/Elite). El backend que otorga los
    ///         boletos lee este valor directamente del contrato — cambiarlo
    ///         acá no requiere ningún cambio del lado del backend.
    function setFreeSpinsPerTier(uint[4] calldata amounts) external onlyOwner {
        freeSpinsPerTier = amounts;
        emit FreeSpinsPerTierChanged(amounts);
    }

    function getFreeSpinsPerTier() external view returns (uint[4] memory) {
        return freeSpinsPerTier;
    }

    function transferOwnership(address _n) external onlyOwner {
        require(_n != address(0), "Inv");
        owner = _n;
    }

    // ─────── BOLETOS GRATIS POR LICENCIA ───────
    /// @notice Otorga boletos gratis a un usuario, identificando la compra que
    ///         los origina (purchaseRef, ej. hash de la tx de compra de licencia)
    ///         para no poder otorgar 2 veces por la misma compra.
    function grantFreeSpins(address user, uint count, bytes32 purchaseRef) external onlyGranter {
        require(user != address(0), "Inv");
        require(count > 0 && count <= 10, "InvCount");
        require(!grantedForPurchase[purchaseRef], "AlreadyGranted");
        grantedForPurchase[purchaseRef] = true;
        freeSpinsAvailable[user] += count;
        emit FreeSpinGranted(user, count, purchaseRef);
    }

    // ─────── POOL ───────
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
        emit OwnerWithdrew(amount);
    }

    function minPoolAllowed() public view returns (uint) {
        return (initialPool * MIN_POOL_PCT) / 10000;
    }

    // ─────── BALANCE ───────
    function deposit(uint amount) external notPaused nonReentrant {
        require(amount > 0, "0amt");
        HACHI.transferFrom(msg.sender, address(this), amount);
        balance[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint amount) external notPaused nonReentrant {
        require(balance[msg.sender] >= amount, "NoBal");
        balance[msg.sender] -= amount;
        HACHI.transfer(msg.sender, amount);
        emit Withdrew(msg.sender, amount);
    }

    // ─────── ROULETTE INTERFACE (autorizadas) ───────
    modifier onlyRoulette() {
        require(msg.sender == rouletteModule, "NoAuth");
        _;
    }

    function rouletteDebitBalance(address user, uint amount) external onlyRoulette {
        require(balance[user] >= amount, "NoBal");
        balance[user] -= amount;
    }
    function rouletteCreditBalance(address user, uint amount) external onlyRoulette {
        balance[user] += amount;
    }
    function rouletteDebitPool(uint amount) external onlyRoulette {
        require(pool >= amount, "PoolLow");
        pool -= amount;
    }
    function rouletteCreditPool(uint amount) external onlyRoulette {
        pool += amount;
    }
    function rouletteCreditOwnerFees(uint amount) external onlyRoulette {
        ownerHachiFromFees += amount;
    }
    function rouletteIncSpins() external onlyRoulette {
        totalSpins++;
    }
    function rouletteAddVolume(uint v) external onlyRoulette {
        totalVolume += v;
    }
    function rouletteIsValidBalance(address user, uint amount) external view returns (bool) {
        return balance[user] >= amount;
    }
    function rouletteUseFreeSpin(address user) external onlyRoulette returns (bool) {
        if (freeSpinsAvailable[user] > 0) {
            freeSpinsAvailable[user]--;
            return true;
        }
        return false;
    }

    // ─────── SLOT MACHINE ───────
    function commitSpin(
        uint bet,
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external notPaused nonReentrant {
        require(balance[msg.sender] >= bet, "NoBal");
        require(bet >= minBetHachi, "Low");
        require(bet <= maxBet(), "High");
        require(!commits[msg.sender].exists, "Wait");
        require(pool >= minPoolAllowed(), "PoolLow");

        _verifyWorldId(root, nullifierHash, proof);

        balance[msg.sender] -= bet;

        uint commitHash = uint(keccak256(abi.encodePacked(
            msg.sender,
            bet,
            blockhash(block.number - 1),
            block.prevrandao,
            block.timestamp,
            totalSpins,
            address(this)
        )));

        uint revealBlock = block.number + COMMIT_BLOCKS;

        commits[msg.sender] = Commit({
            bet: bet,
            blockNumber: revealBlock,
            commitHash: commitHash,
            exists: true,
            isFreeSpin: false
        });

        emit SpinCommitted(msg.sender, bet, revealBlock);
    }

    function commitFreeSpin(
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external notPaused nonReentrant {
        require(freeSpinsAvailable[msg.sender] > 0, "NoFree");
        require(!commits[msg.sender].exists, "Wait");
        require(pool >= minPoolAllowed(), "PoolLow");

        _verifyWorldId(root, nullifierHash, proof);

        freeSpinsAvailable[msg.sender]--;
        uint bet = freeSpinBetHachi;

        uint commitHash = uint(keccak256(abi.encodePacked(
            msg.sender,
            bet,
            blockhash(block.number - 1),
            block.prevrandao,
            block.timestamp,
            totalSpins,
            address(this),
            "free"
        )));

        commits[msg.sender] = Commit({
            bet: bet,
            blockNumber: block.number + COMMIT_BLOCKS,
            commitHash: commitHash,
            exists: true,
            isFreeSpin: true
        });

        emit FreeSpinUsed(msg.sender, freeSpinsAvailable[msg.sender]);
        emit SpinCommitted(msg.sender, bet, block.number + COMMIT_BLOCKS);
    }

    function revealSpin() external notPaused nonReentrant {
        Commit memory c = commits[msg.sender];
        require(c.exists, "NoC");
        require(block.number >= c.blockNumber, "Wait");
        require(block.number <= c.blockNumber + 256, "Exp");

        delete commits[msg.sender];

        uint random = uint(keccak256(abi.encodePacked(
            blockhash(c.blockNumber),
            c.commitHash,
            msg.sender,
            block.prevrandao
        )));

        uint multiplier = _getMultiplier(random);

        uint netBet = c.bet;
        if (!c.isFreeSpin) {
            uint ownerFee = (c.bet * FEE_OWNER) / 100;
            netBet = c.bet - ownerFee;
            ownerHachiFromFees += ownerFee;
        }

        uint payout = 0;
        if (multiplier > 0) {
            // multiplier es x100 (ej: 150 = 1.5x)
            payout = (netBet * multiplier) / 100;
            uint poolPlusBet = pool + netBet;
            if (payout >= poolPlusBet) {
                payout = poolPlusBet;
                pool = 0;
            } else {
                pool = poolPlusBet - payout;
            }
            balance[msg.sender] += payout;
        } else {
            pool += netBet;
        }

        totalSpins++;
        totalVolume += c.bet;

        if (pool < minPoolAllowed()) {
            emit PoolProtected(pool, minPoolAllowed());
        }

        emit SpinRevealed(msg.sender, c.bet, multiplier, payout);
    }

    function cancelExpired() external nonReentrant {
        Commit memory c = commits[msg.sender];
        require(c.exists, "NoC");
        require(block.number > c.blockNumber + 256, "NotExp");
        delete commits[msg.sender];

        if (c.isFreeSpin) {
            freeSpinsAvailable[msg.sender]++;
        } else {
            balance[msg.sender] += c.bet;
        }
    }

    /**
     * @notice Distribución de multiplicadores (RTP 90.25%)
     * @dev    Retorna multiplicador x100 (ej: 100 = 1x, 50 = 0.5x)
     */
    function _getMultiplier(uint random) internal pure returns (uint) {
        uint roll = random % 10000;

        if (roll < 5)        return 5000;  // 50x  (0.05%)
        if (roll < 30)       return 1000;  // 10x  (0.25%)
        if (roll < 150)      return 500;   // 5x   (1.20%)
        if (roll < 500)      return 300;   // 3x   (3.50%)
        if (roll < 1100)     return 200;   // 2x   (6.00%)
        if (roll < 2300)     return 150;   // 1.5x (12.00%)
        if (roll < 4300)     return 100;   // 1x   (20.00%)
        if (roll < 6800)     return 75;    // 0.75x (25.00%)
        return 0;                          // 0x   (32.00% pierde)
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
    function maxBet() public view returns (uint) {
        return (pool * MAX_BET_PCT) / 10000;
    }

    function getStats() external view returns (uint, uint, uint, uint) {
        return (pool, totalSpins, totalVolume, ownerHachiFromFees);
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
