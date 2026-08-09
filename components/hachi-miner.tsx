'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { getIsUserVerified } from '@worldcoin/minikit-js/address-book'
import { createPublicClient, encodeFunctionData, http, parseAbi } from 'viem'
import { useUserOperationReceipt } from '@worldcoin/minikit-react'
import { ethers } from 'ethers'

const worldChain = {
  id: 480,
  name: 'World Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } },
} as const

const C = {
  oracle:   '0x0e18Ff0A2b9981D2FF50658aD4960d17c9b7C22b',
  poolWLD:  '0x9F8ccE86271319f36AA25d8390cfC18741719f19',
  lock:     '0xF743772A09f92850deAFcBDfe6610cFfCe326003',
  ranking:  '0xfA503d183cc747cBA75D1a5ba419150f5529eB27',
  core:     '0xE1892183A27389c6a4CACc091F62F9412B7EA6b9',
  hachi:    '0xbE0313f279580FDD1aA1b1b6888407E6504fF19E',
  wld:      '0x2cfc85d8e48f8eab294be644d9e25c3030863003',
  sushi:    '0xab09a728e53d3d6bc438be95eed46da0bbe7fb38',
  // Permit2 canónico de Uniswap (misma dirección en todas las redes EVM, incl. World Chain)
  permit2:  '0x000000000022D473030F116dDEE9F6B43aC78BA3',
}

const WEEKLY_BONUS_ADDR = '0x67ECFC02B852FDd9D55D0cBF8866cE6ff74126dF'
const WEEKLY_BONUS_ABI = [
  'function getDailyRate(address) view returns (uint256)',
  'function previewClaim(address) view returns (uint256)',
  'function claimBonus()',
  'function lastActionTime(address) view returns (uint256)',
  'function cycleDuration() view returns (uint256)',
]

function isVotingOpen(): boolean {
  const now = new Date()
  const gmt4 = new Date(now.getTime() - 4 * 3600 * 1000)
  const day = gmt4.getUTCDay() // 0=Dom,1=Lun,...,4=Jue,5=Vie,6=Sab
  const hour = gmt4.getUTCHours()
  if (day === 4 && hour >= 20) return true // jueves desde las 20:00
  if (day === 5 || day === 6) return true // viernes y sábado, todo el día
  if (day === 0 && hour < 20) return true // domingo hasta las 19:59
  return false
}

function secondsUntilNextVoting(): number {
  const now = new Date()
  const gmt4Now = new Date(now.getTime() - 4 * 3600 * 1000)
  const day = gmt4Now.getUTCDay()
  let daysUntilThursday = (4 - day + 7) % 7
  const target = new Date(Date.UTC(
    gmt4Now.getUTCFullYear(), gmt4Now.getUTCMonth(), gmt4Now.getUTCDate() + daysUntilThursday,
    20, 0, 0
  ))
  let diff = (target.getTime() - gmt4Now.getTime()) / 1000
  if (diff <= 0) diff += 7 * 86400
  return Math.floor(diff)
}

const DRACHMA_MINER_ADDR_OLD = '0x19d23871C64F29e22F31AcC094A255e5B1aAD577'
const DRACHMA_MINER_ADDR_NEW = '0xF34a0C6F3C55Bb3b8E489E0c66779331FFc72eA4'
const DRACHMA_MINER_ABI = [
  'function getUserTier(address) view returns (uint8)',
  'function costInHachi(uint8) view returns (uint256)',
  'function tierDrachmaAmounts(uint256) view returns (uint256)',
  'function mineDrachma(uint8,uint256) returns (uint256)',
  'function claimDrachma(uint256)',
  'function activeMineId(address) view returns (uint256)',
  'function mines(uint256) view returns (address,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)',
  'function pendingDrachma(uint256) view returns (uint256)',
  'function drachmaPool() view returns (uint256)',
  'function drachmaCommitted() view returns (uint256)',
  'function mineDuration() view returns (uint256)',
]

const VIP_HOLDERS_ADDR = '0x75eD38D459c30656128dF6c9825edfB1A50623af'
const VIP_HOLDERS_ABI = [
  'function getVipLevel(address) view returns (uint8)',
  'function pendingHachi(address) view returns (uint256)',
  'function previewExchange(address) view returns (uint256,uint256,uint256)',
  'function exchange(uint8,uint256) returns (uint8,uint256)',
  'function tierMinAmount(uint256) view returns (uint256)',
  'function tierBonusBps(uint256) view returns (uint256)',
  'function drachmaPool() view returns (uint256)',
  'function sushiPool() view returns (uint256)',
]

const WLD_MINER_ADDR_OLD = '0x35C82EC1C5414b228eF39b65fAC545409fc92d75'
const WLD_MINER_ADDR_NEW = '0x2C191913eBdA9b2bb61E3d00Ca5d35b6991F4B9A'
const WLD_MINER_ABI = [
  'function getUserTier(address) view returns (uint8)',
  'function maxInvestableWld(address) view returns (uint256)',
  'function previewMine(uint256,uint8) view returns (uint256,uint256)',
  'function mineWld(uint256,uint8,uint256,uint256) returns (uint256)',
  'function claimRewards(uint256)',
  'function activeMineId(address) view returns (uint256)',
  'function mines(uint256) view returns (address,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)',
  'function pendingRewards(uint256) view returns (uint256,uint256)',
  'function hachiPool() view returns (uint256)',
  'function drachmaPool() view returns (uint256)',
  'function hachiCommitted() view returns (uint256)',
  'function drachmaCommitted() view returns (uint256)',
  'function variants(uint256) view returns (uint256 duration, uint256 returnBps)',
]

const SHOW_TOP_NAV = false // poner en true para volver a mostrar la barra de pestañas de arriba
const RPC = 'https://worldchain-mainnet.g.alchemy.com/public'
const HACHI_BUY_URL = 'https://world.org/mini-app?app_id=app_e5ba7c3061400e361f98ce44d8b1b9c4&path=/token/0xbe0313f279580fdd1aa1b1b6888407e6504ff19e'
const WORLDCHAIN_ID = 480
const MAX_HACHI = 20000
const APP_ID = 'app_faaadf7d4dc1285275a436a8cac18e69'
// Incognito Action de World ID configurada en el Developer Portal.
// DEBE coincidir con el externalNullifierHash con el que se desplegó el contrato.
const ACTION = 'verify-human'

const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']
// Permit2 (AllowanceTransfer): approve da permiso a un "spender" (nuestro contrato) para mover el token vía Permit2
const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]
const ORACLE = ['function getRates() view returns (uint256,uint256,uint256,bool,bool,uint256)', 'function previewWldLicense(uint256) view returns (uint256,uint256,uint256,uint256,uint256)']
const POOLWLD = ['function getPoolStatus() view returns (uint256,uint256,uint256,uint256,uint256)']
const CORE = [
  'function humanVerified(address) view returns (bool)',
  'function getUserWLDLics(address) view returns (uint256[])',
  'function getUserSushiLics(address) view returns (uint256[])',
  'function wldLics(uint256) view returns (address,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool)',
  'function pendingWLDHachi(uint256) view returns (uint256)',
  'function monthlyWLDRemaining(address) view returns (uint256,uint256)',
  'function getWLDAvailability() view returns (uint256,uint256)',
  'function getSushiAvailability() view returns (uint256,uint256,uint256,uint256,uint8,uint256,uint256)',
  'function hachiDailyPool() view returns (uint256)',
  'function lastDailySettle(address) view returns (uint256)',
  'function dailyAccrued(address) view returns (uint256)',
  'function pendingDaily(address) view returns (uint256)',
  'function totalDailyClaims() view returns (uint256)',
  'function currentDailyRate() view returns (uint256)',
  'function getSalesStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'function getPoolStatus() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  'function buyLicenseWLD(uint8)',
  'function buyLicenseSushi(uint8)',
  'function claimWLDHachi(uint256)',
  'function withdrawDailyHachi()',
  'function verifyHuman(uint256,uint256,uint256[8])',
  'function startAccrual()',
  'function getHighestActiveWLDType(address) view returns (uint8)',
  'function specialSushiAvailable(address) view returns (bool)',
  'function dailyRate() view returns (uint256)',
  'function dailySushiPurchases(address,uint256,uint8) view returns (uint256)',
  'function lastSpecialSushi(address) view returns (uint256)',
]
const LOCK = [
  'function getPosition(address) view returns (uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,bool)',
  'function getUserBatches(address) view returns (uint256[],uint256[],bool[])',
  'function canMine(address) view returns (bool)',
  'function deposit(uint256)', 'function claimAPY()', 'function unstake(uint256)',
  'function totalLocked() view returns (uint256)',
  'function totalUsers() view returns (uint256)',
]
const RANKING = [
  'function getUserStats(address) view returns (uint256,uint256,uint256,uint256,uint8,uint256)',
  'function getCurrentRanking() view returns (address[],uint256[],uint256[],uint8[])',
  'function getPeriodNumber() view returns (uint256)',
  'function timeUntilNextExecution() view returns (uint256)',
  'function lastExecutedAt() view returns (uint256)',
  'function claimPrize()',
  'event PrizePaid(address indexed user, uint256 amount, uint256 rank)',
]
type Tab = 'home'|'lics'|'lock'|'pools'|'wldminer'|'voting'|'drachmaminer'|'bocado'|'mineria'|'centrohachi'
type Lang = 'es'|'en'|'pt'

const TR = {
  es: { connect:'Conectar', verified:'World ID ✓', not_verified:'Sin verificar', daily_claim:'Cobrar 10 HACHI', nav_home:'🏠 Inicio', nav_lics:'📜 Licencias', nav_lock:'🔒 Lock', nav_rank:'🏆 Ranking', nav_pools:'🌊 Pools', err_connect:'Conecta tu wallet', err_verify:'Verifica tu World ID', err_price:'Ventas pausadas', approving:'Aprobando...', no_lics:'Sin licencias activas', connect_prompt:'Conecta tu wallet para comenzar', access_title:'Acceso restringido', access_desc:'Para licencias SUSHI necesitas 5,000 HACHI lockeados o una licencia WLD activa', day1:'Día 1 — recibís de vuelta', day2:'Día 2 — tu ganancia (24h)' },
  en: { connect:'Connect', verified:'World ID ✓', not_verified:'Not verified', daily_claim:'Claim 10 HACHI', nav_home:'🏠 Home', nav_lics:'📜 Licenses', nav_lock:'🔒 Lock', nav_rank:'🏆 Ranking', nav_pools:'🌊 Pools', err_connect:'Connect your wallet', err_verify:'Verify your World ID', err_price:'Sales paused', approving:'Approving...', no_lics:'No active licenses', connect_prompt:'Connect your wallet to start', access_title:'Restricted access', access_desc:'For SUSHI licenses you need 5,000 HACHI locked or an active WLD license', day1:'Day 1 — get back investment', day2:'Day 2 — your profit (24h)' },
  pt: { connect:'Conectar', verified:'World ID ✓', not_verified:'Não verificado', daily_claim:'Cobrar 10 HACHI', nav_home:'🏠 Início', nav_lics:'📜 Licenças', nav_lock:'🔒 Lock', nav_rank:'🏆 Ranking', nav_pools:'🌊 Pools', err_connect:'Conecte sua carteira', err_verify:'Verifique seu World ID', err_price:'Vendas pausadas', approving:'Aprovando...', no_lics:'Sem licenças ativas', connect_prompt:'Conecte sua carteira para começar', access_title:'Acesso restrito', access_desc:'Para licenças SUSHI você precisa de 5.000 HACHI bloqueados ou uma licença WLD ativa', day1:'Dia 1 — recupere investimento', day2:'Dia 2 — seu lucro (24h)' },
}

const LOGIN = {
  es: {
    tagline: 'Minería de HACHI verificada con World ID en World Chain',
    whatTitle: '¿Qué es HachiMiner?',
    whatDesc: 'HachiMiner es una mini app de World que te permite minar tokens HACHI y operar con licencias WLD y Bocado directamente en World Chain. Compra licencias, bloquea tokens para ganar APY, participa en el ranking y deja que Hachi ahorre HACHI por vos en su alcancía.',
    features: [
      { icon:'📜', title:'Licencias', desc:'Compra tu licencia WLD y obtén beneficios adicionales en Bocados según tu nivel — a mayor nivel, mayor acceso.' },
      { icon:'🔒', title:'Lock & APY', desc:'Bloquea HACHI y gana rendimiento sobre tu posición.' },
      { icon:'🏆', title:'Ranking', desc:'Compite por premios según tu actividad.' },
      { icon:'🐱', title:'Reúne y cobra tus HACHI', desc:'Hachi acumula HACHI por vos automáticamente. Retirá cuando quieras; hay un cooldown de 24h entre retiros.' },
    ],
    stepsTitle: 'Cómo empezar',
    steps: [
      'Conecta tu wallet de World App con un solo toque.',
      'Verifica tu identidad con World ID para desbloquear todo.',
      'Compra licencias o bloquea HACHI y empieza a minar.',
    ],
    cta: 'Conectar wallet',
    ctaWA: 'Iniciar sesión con World App',
    disclaimer: 'Al continuar conectas tu wallet a HachiMiner en World Chain. No custodiamos tus fondos.',
  },
  en: {
    tagline: 'World ID-verified HACHI mining on World Chain',
    whatTitle: 'What is HachiMiner?',
    whatDesc: 'HachiMiner is a World mini app that lets you mine HACHI tokens and trade WLD and Bocado licenses directly on World Chain. Buy licenses, lock tokens to earn APY, climb the ranking, and let Hachi save HACHI for you in his piggy bank.',
    features: [
      { icon:'📜', title:'Licenses', desc:'Buy your WLD license and get extra Bocado benefits based on your tier — higher tier, greater access.' },
      { icon:'🔒', title:'Lock & APY', desc:'Lock HACHI and earn yield on your position.' },
      { icon:'🏆', title:'Ranking', desc:'Compete for prizes based on your activity.' },
      { icon:'🐱', title:'Collect your HACHI', desc:'Hachi accumulates HACHI for you automatically. Withdraw whenever you want; there\'s a 24h cooldown between withdrawals.' },
    ],
    stepsTitle: 'How to start',
    steps: [
      'Connect your World App wallet with a single tap.',
      'Verify your identity with World ID to unlock everything.',
      'Buy licenses or lock HACHI and start mining.',
    ],
    cta: 'Connect wallet',
    ctaWA: 'Sign in with World App',
    disclaimer: 'By continuing you connect your wallet to HachiMiner on World Chain. We never custody your funds.',
  },
  pt: {
    tagline: 'Mineração de HACHI verificada com World ID na World Chain',
    whatTitle: 'O que é o HachiMiner?',
    whatDesc: 'O HachiMiner é um mini app da World que permite minerar tokens HACHI e operar com licenças WLD e Bocado diretamente na World Chain. Compre licenças, bloqueie tokens para ganhar APY, suba no ranking e deixe o Hachi guardar HACHI por você no cofrinho dele.',
    features: [
      { icon:'📜', title:'Licenças', desc:'Compre sua licença WLD e obtenha benefícios extras em Bocados conforme seu nível — quanto maior o nível, maior o acesso.' },
      { icon:'🔒', title:'Lock & APY', desc:'Bloqueie HACHI e ganhe rendimento na sua posição.' },
      { icon:'🏆', title:'Ranking', desc:'Concorra a prêmios conforme sua atividade.' },
      { icon:'🐱', title:'Reúna e resgate seus HACHI', desc:'O Hachi acumula HACHI por você automaticamente. Saque quando quiser; há um cooldown de 24h entre saques.' },
    ],
    stepsTitle: 'Como começar',
    steps: [
      'Conecte sua carteira World App com um toque.',
      'Verifique sua identidade com World ID para desbloquear tudo.',
      'Compre licenças ou bloqueie HACHI e comece a minerar.',
    ],
    cta: 'Conectar carteira',
    ctaWA: 'Entrar com World App',
    disclaimer: 'Ao continuar você conecta sua carteira ao HachiMiner na World Chain. Não custodiamos seus fundos.',
  },
}

const fmt = (n: number) => { if ((!n && n!==0)||isNaN(n)) return '—'; if (n>=1e6) return (n/1e6).toFixed(2)+'M'; if (n>=1e3) return (n/1e3).toFixed(1)+'K'; return Math.round(n).toLocaleString() }
const fmtA = (a: string) => a ? a.slice(0,6)+'...'+a.slice(-4) : '—'
const fe = (v: bigint) => Number(ethers.formatEther(v))
const pe = (v: string|number) => ethers.parseEther(String(v))
const fmtSecs = (s: number) => { if (!s || s <= 0) return '—'; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m` }
// nonce alfanumérico de al menos 8 caracteres (requisito de MiniKit v2)
const genNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('')

export default function HachiMiner() {
  const [tab, setTab] = useState<Tab>('home')
  const [licTab, setLicTab] = useState<'wld'|'sushi'>('wld')
  const [lang, setLang] = useState<Lang>('es')
  const [toast, setToast] = useState<{msg:string;color:string}|null>(null)
  const [addr, setAddr] = useState('')
  const [username, setUsername] = useState('')
  const [usernameCache, setUsernameCache] = useState<Record<string,string>>({})
  const [connected, setConnected] = useState(false)
  const [verified, setVerified] = useState(false)
  const [inWA, setInWA] = useState(false)
  const [hachiB, setHachiB] = useState('0')
  const [wldB, setWldB] = useState('0')
  const [sushiB, setSushiB] = useState('0')
  const [wldHachi, setWldHachi] = useState(10000)
  const [hachiSushi, setHachiSushi] = useState(1.5)
  const [oracleSt, setOracleSt] = useState('—')
  const [poolFree, setPoolFree] = useState('—')
  const [licsAvail, setLicsAvail] = useState('—')
  const [licsAvailNum, setLicsAvailNum] = useState(0)
  const [priceAlert, setPriceAlert] = useState(false)
  const [piggy, setPiggy] = useState({accrued:0,accrual:100,canWithdraw:false})
  const [selWLD, setSelWLD] = useState(0)
  const [wldPrev, setWldPrev] = useState({base:'—',total:'—',daily:'—',monthly:'—'})
  const [wldLics, setWldLics] = useState<any[]>([])
  const [wldLicsLoaded, setWldLicsLoaded] = useState(false)
  const [selSUSHI, setSelSUSHI] = useState(0)
  const [sushiPrev, setSushiPrev] = useState({base:'—',d1:'—',d2:'—',total:'—',dailyLeft:'—'})
  const [sushiAccess, setSushiAccess] = useState(false)
  const [accrualStarted, setAccrualStarted] = useState(true)
  const [lastSettle, setLastSettle] = useState(0)
  const [debugMode] = useState(() => typeof window !== 'undefined' && window.location.search.includes('debug=1'))
  const [wldTierActive, setWldTierActive] = useState<number>(255)
  const [wldTierLoaded, setWldTierLoaded] = useState(false)
  const [specialAvail, setSpecialAvail] = useState(false)
  const [lastSpecialTs, setLastSpecialTs] = useState(0)
  const [basicBoughtToday, setBasicBoughtToday] = useState(0)
  const [hachiRaw, setHachiRaw] = useState(0)
  const [weeklyBonus, setWeeklyBonus] = useState({dailyRate:0, pending:0, everClaimed:false, secondsUntilNext:0})
  const [drachmaMiner, setDrachmaMiner] = useState({tier:255, amounts:[0,0,0,0], costs:[0,0,0,0], activeMineId:0, active:false, drachmaTotal:0, drachmaClaimed:0, pending:0, endTime:0, poolFree:0, durationDays:15, loaded:false, contractAddr:'0xF34a0C6F3C55Bb3b8E489E0c66779331FFc72eA4', isNewContract:true})
  const [selDrachmaTier, setSelDrachmaTier] = useState(0)
  const [showInfoDrachma, setShowInfoDrachma] = useState(false)
  const [wldMiner, setWldMiner] = useState({tier:255, cap:0, activeMineId:0, active:false, variant:0, hachiTotal:0, hachiClaimed:0, drachmaTotal:0, drachmaClaimed:0, pendingHachi:0, pendingDrachma:0, endTime:0, poolFreeHachi:0, poolFreeDrachma:0, loaded:false, contractAddr:'0x2C191913eBdA9b2bb61E3d00Ca5d35b6991F4B9A', isNewContract:true})
  const [wldMinerVariants, setWldMinerVariants] = useState([{days:30,pct:30},{days:15,pct:12},{days:7,pct:5}])
  const [selWldAmount, setSelWldAmount] = useState('')
  const [selWldVariant, setSelWldVariant] = useState(0)
  const [wldMinerPreview, setWldMinerPreview] = useState({hachi:0, drachma:0})
  const [showInfoWldMiner, setShowInfoWldMiner] = useState(false)
  const [miningWld, setMiningWld] = useState(false)
  const [claimingWldMiner, setClaimingWldMiner] = useState(false)
  const [claimingWeekly, setClaimingWeekly] = useState(false)
  const [showInfoWeekly, setShowInfoWeekly] = useState(false)
  const [giftOpened, setGiftOpened] = useState(false)
  const [wldRaw, setWldRaw]     = useState(0)
  const [sushiLics] = useState<any[]>([])
  const [lockData, setLockData] = useState({total:'0',tier:'Sin tier',apy:'0%',pending:'0',unstake:'0',unstakeRaw:BigInt(0),nextClaimIn:'—',nextDepositIn:'—',nextDepositSecs:0})
  const [vipData, setVipData] = useState({level:255, pendingHachi:0, drachmaOut:0, sushiOut:0, drachmaPoolFree:0, sushiPoolFree:0, loaded:false})
  const [vipPreferredToken, setVipPreferredToken] = useState(0)
  const [showInfoVip, setShowInfoVip] = useState(false)
  const [drachmaMinerHistory, setDrachmaMinerHistory] = useState<{contrato:string, id:number, hachiPaid:number, drachmaTotal:number, done:boolean}[]>([])
  const [showDrachmaHistory, setShowDrachmaHistory] = useState(false)
  const [wldMinerHistory, setWldMinerHistory] = useState<{contrato:string, id:number, wldPaid:number, hachiTotal:number, drachmaTotal:number, done:boolean}[]>([])
  const [showWldHistory, setShowWldHistory] = useState(false)
  const [exchangingVip, setExchangingVip] = useState(false)
  const [showDeposits, setShowDeposits] = useState(false)
  const [showInfoTiers, setShowInfoTiers] = useState(false)
  const [showInfoLics, setShowInfoLics] = useState(false)
  const [showBuyWLD, setShowBuyWLD] = useState(false)
  const [lockBatches, setLockBatches] = useState<any[]>([])
  const [platformStats, setPlatformStats] = useState({totalLocked:'—',totalUsers:'—'})
  const [depositAmt, setDepositAmt] = useState('')
  const [rankStats, setRankStats] = useState({points:'0',totalHist:'0',pos:'—',reward:'0',earned:'0',nextDist:'—'})
  const [rankList, setRankList] = useState<any[]>([])
  const [lastWinners, setLastWinners] = useState<{addr:string,amount:number,rank:number}[]>([])
  const [poolsData, setPoolsData] = useState<any>({})
  const [logs, setLogs] = useState<string[]>([])
  const [showVerify, setShowVerify] = useState(false)

  const viemClient = useMemo(() => createPublicClient({
    chain: worldChain as any,
    transport: http(RPC),
  }), [])

  const { poll: pollUserOp } = useUserOperationReceipt({ client: viemClient })

  const log = (m: string) => setLogs(p => [...p.slice(-6), m])
  const t = (k: keyof typeof TR.es) => TR[lang][k] || TR.es[k]
  const loginCopy = LOGIN[lang] || LOGIN.es
  const rpc = () => new ethers.JsonRpcProvider(RPC)
  const toast_ = (msg: string, color='#a78bfa') => { setToast({msg,color}); setTimeout(()=>setToast(null),4000) }

  // 1) Inicializar MiniKit (OBLIGATORIO en v2 antes de cualquier comando)
  // 2) Si estamos dentro de World App, conectar automáticamente
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const init = async () => {
      try {
        MiniKit.install(APP_ID)
      } catch (e: any) {
        log('install err: ' + (e?.message||'').slice(0,40))
      }
      // isInstalled() = true solo dentro de World App.
      // Reintentamos porque puede dar false en el primer render
      // antes de que install() termine de inicializar.
      let installed = MiniKit.isInstalled()
      for (let i = 0; i < 5 && !installed; i++) {
        await new Promise(r => setTimeout(r, 300))
        installed = MiniKit.isInstalled()
      }
      log('isInstalled: ' + installed)
      setInWA(installed)
    }
    init()
    return () => { if (timer) clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (wldHachi <= 0) return
    const px = [1,3,5,10][selWLD]
    const base = px * wldHachi
    const mult = selWLD === 3 ? 1.35 : 1.30
    const total = Math.round(base * mult)
    const perDay = Math.round(total / 90)
    setWldPrev(p => ({...p, base:fmt(base)+' HACHI', total:fmt(total)+' HACHI', daily:'~'+fmt(perDay)+' HACHI/día'}))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selWLD, wldHachi])

  useEffect(() => {
    if (hachiSushi <= 0) return
    const sushiBase = [500,2000,5000,10000][selSUSHI] * hachiSushi
    const total     = sushiBase * 1.25
    setSushiPrev(p => ({...p, base:Math.round(sushiBase).toLocaleString()+' SUSHI', total:Math.round(total).toLocaleString()+' SUSHI'}))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSUSHI, hachiSushi])


  const nameFor = (a: string): string => {
    if (!a) return '—'
    if (addr && a.toLowerCase() === addr.toLowerCase() && username) return username
    const cached = usernameCache[a.toLowerCase()]
    return cached || fmtA(a)
  }

  const resolveUsernames = useCallback(async (addresses: string[]) => {
    if (!MiniKit.isInstalled()) return
    const pending = Array.from(new Set(
      addresses.filter(a => a && !usernameCache[a.toLowerCase()]).map(a => a.toLowerCase())
    ))
    if (pending.length === 0) return
    const results = await Promise.allSettled(pending.map(a => MiniKit.getUserByAddress(a)))
    setUsernameCache(prev => {
      const next = {...prev}
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.username) next[pending[i]] = r.value.username
      })
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameCache])

  // Devuelve la dirección conectada o '' si falla
  const connectMiniKit = async (): Promise<string> => {
    try {
      if (!MiniKit.isInstalled()) {
        log('walletAuth: no estás en World App')
        return ''
      }
      log('intentando walletAuth...')
      const walletAuthResult = await MiniKit.walletAuth({
        nonce: genNonce(),
        statement: 'HachiMiner',
        expirationTime: new Date(Date.now() + 7*24*60*60*1000),
        notBefore: new Date(Date.now() - 60*1000),
      })
      log('walletAuth executedWith: ' + walletAuthResult.executedWith)
      // v2: la dirección viene en walletAuthResult.data.address
      const walletAddr = walletAuthResult.data.address || MiniKit.user?.walletAddress || ''
      if (walletAddr) {
        log('addr: ' + walletAddr.slice(0,10))
        setAddr(walletAddr)
        setUsername(MiniKit.user?.username || '')
        resolveUsernames([walletAddr])
        setConnected(true)
        setInWA(true)
        // NO marcamos verified aquí. El estado real de verificación World ID
        // se lee on-chain en checkVerif (humanVerified). Si lo forzamos a true
        // sin que verifyHuman se haya ejecutado, las compras revierten on-chain
        // ("transacción inválida"/pantalla en blanco) y el usuario pierde gas.
        toast_('Conectado: ' + fmtA(walletAddr), '#3fb950')
        await loadAll(walletAddr)
        return walletAddr
      }
      log('walletAuth sin address')
      return ''
    } catch(e: any) {
      log('walletAuth err: ' + (e?.message||'').slice(0,50))
      return ''
    }
  }

  const connectWallet = useCallback(async () => {
    // Dentro de World App → usar MiniKit
    if (MiniKit.isInstalled()) {
      const a = await connectMiniKit()
      if (a) return
      toast_('No se pudo conectar con World App', '#f85149')
      return
    }
    // Fuera de World App → fallback MetaMask / navegador
    const eth = (window as any).ethereum
    if (!eth) { toast_('Abre esta app dentro de World App', '#f85149'); return }
    try {
      await eth.request({method:'eth_requestAccounts'})
      const chainId = await eth.request({method:'eth_chainId'})
      if (chainId !== '0x1E0') {
        try { await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1E0'}]}) }
        catch { await eth.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1E0',chainName:'World Chain',rpcUrls:[RPC],nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},blockExplorerUrls:['https://worldscan.org']}]}) }
      }
      const provider = new ethers.BrowserProvider(eth)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      setAddr(address); setConnected(true)
      toast_('Conectado: ' + fmtA(address), '#3fb950')
      await loadAll(address)
      setInterval(() => loadAll(address), 30000)
    } catch(e: any) { toast_('Error: ' + (e.message||'').slice(0,50), '#f85149') }
  }, [lang])

  const loadAll = async (address: string) => {
    const p = rpc()
    await Promise.allSettled([loadBal(address,p), loadOracle(address,p), checkVerif(address,p), checkDaily(address,p), loadPools(p), loadLock(p), loadWeeklyBonus(address,p)])
  }

  const loadBal = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const [h,w,s] = await Promise.all([
        new ethers.Contract(C.hachi,ERC20,p).balanceOf(a),
        new ethers.Contract(C.wld,ERC20,p).balanceOf(a),
        new ethers.Contract(C.sushi,ERC20,p).balanceOf(a),
      ])
      const hN=fe(h), wN=fe(w)
      setHachiB(fmt(hN)); setWldB(fmt(wN)); setSushiB(fmt(fe(s)))
      setHachiRaw(hN); setWldRaw(wN)
    } catch(e) {}
  }

  const loadOracle = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const r = await new ethers.Contract(C.oracle,ORACLE,p).getRates()
      const wh=fe(r[0]),hs=fe(r[1])
      setWldHachi(wh); setHachiSushi(hs); setOracleSt(r[3]?'Manual':'DEX en vivo ✓'); setPriceAlert(wh>MAX_HACHI)
      const ws = await new ethers.Contract(C.poolWLD,POOLWLD,p).getPoolStatus()
      const hf=fe(ws[1]), costPerLic=wh*1.30, lb=costPerLic>0?Math.floor(hf/costPerLic):0
      setPoolFree(fmt(hf)+' HACHI'); setLicsAvail(lb>0?lb+' lics. básicas':'0 (sin fondos)'); setLicsAvailNum(lb)
    } catch(e) {}
  }

  const checkVerif = async (a: string, _p: ethers.JsonRpcProvider) => {
    try {
      const v = await getIsUserVerified(a)
      setVerified(!!v)
    } catch(e) {}
  }

  const checkDaily = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const core = new ethers.Contract(C.core, CORE, p)
      const [pending, rate, settle] = await Promise.all([
        core.pendingDaily(a), core.currentDailyRate(), core.lastDailySettle(a)
      ])
      const pendingN = Number(fe(pending)), rateN = Number(fe(rate)), settleN = Number(settle)
      setLastSettle(settleN)
      setAccrualStarted(settleN > 0)
      const cooldownOk = settleN === 0 || Math.floor(Date.now()/1000) >= settleN + 86400
      setPiggy({accrued:pendingN, accrual:rateN, canWithdraw:pendingN>0 && cooldownOk})
    } catch(e) {}
    let tierNum = 255, canMineOk = false
    try {
      const core = new ethers.Contract(C.core, CORE, p)
      const today = BigInt(Math.floor(Date.now() / 86400000))
      const [sa, tier, specAvail, bought, lastSpec] = await Promise.all([
        core.getSushiAvailability(),
        core.getHighestActiveWLDType(a),
        core.specialSushiAvailable(a),
        core.dailySushiPurchases(a, today, 0),
        core.lastSpecialSushi(a),
      ])
      tierNum = Number(tier)
      setWldTierActive(tierNum)
      setSpecialAvail(Boolean(specAvail))
      setBasicBoughtToday(Number(bought))
      setLastSpecialTs(Number(lastSpec))
      setWldTierLoaded(true)
    } catch(e: any) { log('checkDaily core err: '+(e?.message||'').slice(0,80)) }
    try {
      const ok = await new ethers.Contract(C.lock, LOCK, p).canMine(a)
      canMineOk = Boolean(ok)
    } catch(e: any) { log('canMine err: '+(e?.message||'').slice(0,80)) }
    setSushiAccess(tierNum !== 255 || canMineOk)
  }

  // Interpreta el finalPayload de MiniKit.commandsAsync.* (v1.11) y lanza un error legible.
  const handleMiniKitResult = (finalPayload: any) => {
    const status = finalPayload?.status
    log('full payload: ' + JSON.stringify(finalPayload))
    log('res status: '+status)
    if (!finalPayload || status === 'error') {
      const code = finalPayload?.error_code || 'error'
      const detail = finalPayload?.details ? ' '+JSON.stringify(finalPayload.details) : ''
      throw new Error(code+detail)
    }
    return finalPayload
  }

  // Envío de transacciones — codificamos calldata con encodeFunctionData de viem y enviamos
  // { address, data } para evitar que MiniKit inspeccione el nombre de la función.
  // Tras recibir el transaction_id de MiniKit, hacemos polling hasta confirmar el minado on-chain.
  const sendTx = async (contractAddr: string, abi: string[], fnName: string, args: any[]) => {
    log('tx: '+fnName+' inWA:'+inWA)
    if (MiniKit.isInstalled()) {
      const data = encodeFunctionData({ abi: parseAbi(abi), functionName: fnName as any, args })
      const txResult = await MiniKit.sendTransaction({
        transactions: [{ to: contractAddr, data }],
        chainId: WORLDCHAIN_ID,
      })
      log('polling receipt: '+txResult.data.userOpHash?.slice(0,12))
      await pollUserOp(txResult.data.userOpHash)
      return txResult.data
    } else {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet')
      const provider = new ethers.BrowserProvider(eth)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(contractAddr, abi, signer)
      const tx = await contract[fnName](...args)
      return tx.wait()
    }
  }

  // Envía varias llamadas en UNA sola transacción (batch atómico de World App). Necesario para
  // approve + acción juntos; si se envían por separado muestra pantalla en blanco.
  // Soporta calls con calldata precodificada { to, data } (Permit2 approve) y calls con
  // ABI declarativo { to, abi, fnName, args } (funciones de nuestros contratos).
  // Incluye polling on-chain tras recibir el transaction_id de MiniKit.
  const sendTxMulti = async (calls: ({ to: string; data: `0x${string}` } | { to: string; abi: string[]; fnName: string; args: any[] })[]) => {
    if (MiniKit.isInstalled()) {
      const txs = calls.map((c) => {
        if ('data' in c) return { to: c.to, data: c.data }
        const data = encodeFunctionData({ abi: parseAbi(c.abi), functionName: c.fnName as any, args: c.args })
        return { to: c.to, data }
      })
      const txResult = await MiniKit.sendTransaction({
        transactions: txs,
        chainId: WORLDCHAIN_ID,
      })
      log('polling receipt: '+txResult.data.userOpHash?.slice(0,12))
      await pollUserOp(txResult.data.userOpHash)
      return txResult.data
    } else {
      // MetaMask no soporta batch: enviamos secuencialmente
      for (const c of calls) {
        if ('data' in c) {
          const eth = (window as any).ethereum
          if (!eth) throw new Error('No wallet')
          const provider = new ethers.BrowserProvider(eth)
          const signer = await provider.getSigner()
          const tx = await signer.sendTransaction({ to: c.to, data: c.data })
          await tx.wait()
        } else {
          await sendTx(c.to, c.abi, c.fnName, c.args)
        }
      }
    }
  }

  // Construye los calls de aprobacion Permit2 para un pago (patron AllowanceTransfer ON-CHAIN).
  // IMPORTANTE — contexto World App:
  //  - El error MiniKit `invalid_contract` significa "el contrato no esta permitido en el
  //    Developer Portal". Solo estan whitelisteados nuestros 5 contratos + Permit2, NO los tokens.
  //  - Por eso NO podemos (ni necesitamos) hacer ERC20.approve(PERMIT2): llamaria al contrato
  //    del token (no whitelisteado) y la tx entera falla con invalid_contract.
  //  - Las smart wallets de World App YA tienen el token pre-aprobado a Permit2 automaticamente,
  //    asi que el unico paso necesario es PERMIT2.approve(token, spender, amount, expiration),
  //    que autoriza a NUESTRO contrato a jalar via Permit2.transferFrom. (Esta es la version que
  //    permitio comprar la primera licencia con exito.)
  //  - La expiracion debe ser FUTURA (uint48) pero CORTA: World App rechaza deadlines lejanos
  //    con el error `permit_deadline_too_long`. Usamos 30 minutos, suficiente para firmar y
  //    ejecutar la tx en el mismo flujo.
  const MAX_UINT160 = (BigInt(1) << BigInt(160)) - BigInt(1)
  const PERMIT2_APPROVE_ABI = [{ name: 'approve', type: 'function' as const, inputs: [{name:'token',type:'address'},{name:'spender',type:'address'},{name:'amount',type:'uint160'},{name:'expiration',type:'uint48'}], outputs: [], stateMutability: 'nonpayable' as const }]
  const buildPermit2Approvals = (token: string, spender: string, amount: bigint) => {
    const amt160 = amount > MAX_UINT160 ? MAX_UINT160 : amount
    const data = encodeFunctionData({ abi: PERMIT2_APPROVE_ABI, functionName: 'approve', args: [token as `0x${string}`, spender as `0x${string}`, amt160, 0] })
    return [
      { to: C.permit2, data },
    ]
  }


  const execTx = async (label: string, contractAddr: string, abi: string[], fnName: string, args: any[]) => {
    try {
      log('→ '+fnName); toast_(label+'...', '#d29922')
      await sendTx(contractAddr, abi, fnName, args)
      log('✓ '+fnName); toast_('✓ '+label, '#3fb950')
      await loadAll(addr); return true
    } catch(e: any) {
      const err = e.reason||e.message||'error'
      log('✗ '+err.slice(0,60)); toast_('Error: '+err.slice(0,80), '#f85149'); return false
    }
  }

  const buyWLD = async () => {
    if (!connected) { toast_(t('err_connect'),'#f85149'); return }
    if (wldHachi>MAX_HACHI) { toast_(t('err_price'),'#f85149'); return }
    const wldNeeded = [1,3,5,10][selWLD]
    if (wldRaw < wldNeeded) { toast_(`Sin saldo WLD suficiente (necesitás ${wldNeeded} WLD)`,'#f85149'); return }
    try {
      toast_('Comprando licencia WLD...', '#d29922')
      const amt = [pe(1),pe(3),pe(5),pe(10)][selWLD]
      await sendTxMulti([
        ...buildPermit2Approvals(C.wld, C.core, amt),
        { to: C.core, abi: CORE, fnName: 'buyLicenseWLD', args: [selWLD] },
      ])
      toast_('✓ Licencia WLD comprada', '#3fb950')
      await loadAll(addr)
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }

  const buySUSHI = async () => {
    if (!connected) { toast_(t('err_connect'),'#f85149'); return }
    const hachiNeeded = [500,2000,5000,10000][selSUSHI]
    if (hachiRaw < hachiNeeded) { toast_(`Sin saldo HACHI. Comprá HACHI: ${HACHI_BUY_URL}`,'#f85149'); return }
    try {
      toast_('Comprando Bocado...', '#d29922')
      const amt = [pe(500),pe(2000),pe(5000),pe(10000)][selSUSHI]
      await sendTxMulti([
        ...buildPermit2Approvals(C.hachi, C.core, amt),
        { to: C.core, abi: CORE, fnName: 'buyLicenseSushi', args: [selSUSHI] },
      ])
      toast_('✓ Bocado comprado', '#3fb950')
      await loadAll(addr)
    } catch(e: any) {
      const msg = (e.reason||e.message||'').toLowerCase()
      if (msg.includes('pool a insufficient')) toast_('⏳ Sin fondos en el pool ahora mismo — probá más tarde', '#f85149')
      else toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149')
    }
  }

  const withdrawDaily = async () => {
    if (piggy.accrued <= 0) { toast_('No hay HACHI acumulado para retirar','#f85149'); return }
    try {
      toast_('Retirando acumulador...', '#d29922')
      await sendTx(C.core, CORE, 'withdrawDailyHachi', [])
      toast_('✓ HACHI retirado a tu wallet', '#3fb950')
      await loadAll(addr)
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }
  const startAccrualFn = async () => {
    try {
      toast_('Activando acumulador...', '#d29922')
      await sendTx(C.core, CORE, 'startAccrual', [])
      toast_('✓ Acumulador activado', '#3fb950')
      setAccrualStarted(true)
      await loadAll(addr)
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }
  const claimWLD = (id: bigint) => execTx('Cobrando HACHI', C.core, CORE, 'claimWLDHachi', [id])

  const claimAllWLD = async () => {
    if (wldLics.length === 0) return
    try {
      toast_('Cobrando todas las licencias...', '#d29922')
      const calls = wldLics.map(({id}) => ({ to: C.core, abi: CORE, fnName: 'claimWLDHachi', args: [id] }))
      await sendTxMulti(calls)
      toast_('✓ Todo cobrado', '#3fb950')
      await loadAll(addr)
    } catch(e: any) {
      toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149')
    }
  }
  const doDeposit = async () => {
    if (!depositAmt||Number(depositAmt)<=0) { toast_('Ingresa un monto válido','#f85149'); return }
    try {
      toast_('Depositando HACHI...', '#d29922')
      await sendTxMulti([
        ...buildPermit2Approvals(C.hachi, C.lock, pe(depositAmt)),
        { to: C.lock, abi: LOCK, fnName: 'deposit', args: [pe(depositAmt)] },
      ])
      toast_('✓ Depositando HACHI', '#3fb950')
      setDepositAmt('')
      await loadAll(addr)
    } catch(e: any) {
      const err = e.reason||e.message||'error'
      toast_('Error: '+err.slice(0,80), '#f85149')
    }
  }
  const claimAPY = () => execTx('Cobrando APY', C.lock, LOCK, 'claimAPY', [])
  const doUnstake = async () => {
    if (lockData.unstakeRaw <= BigInt(0)) { toast_('No tenés HACHI disponible para retirar todavía','#f85149'); return }
    await execTx('Retirando HACHI del lock', C.lock, LOCK, 'unstake', [lockData.unstakeRaw])
  }
  const claimPrize = () => execTx('Cobrando premio', C.ranking, RANKING, 'claimPrize', [])

  const loadTab = async (v: Tab) => {
    setTab(v); if (!connected) return
    const p = rpc()
    if (v==='lics') loadWLDLics(p)
    if (v==='lock') { loadLock(p); loadVipHolders(addr, p) }
    if (v==='pools') loadPools(p)
    if (v==='wldminer') { loadWldMiner(addr, p); loadWldMinerHistory(addr, p) }
    if (v==='drachmaminer') { loadDrachmaMiner(addr, p); loadDrachmaMinerHistory(addr, p) }
    if (v==='centrohachi') { loadWLDLics(p); loadWldMiner(addr, p); loadLock(p); loadVipHolders(addr, p); loadWeeklyBonus(addr, p) }
  }

  const loadWLDLics = async (p: ethers.JsonRpcProvider) => {
    try {
      const core = new ethers.Contract(C.core,CORE,p)
      const px = [1,3,5,10][selWLD]
      let base=px*wldHachi, total=Math.round(base*1.3), perDay=Math.round(total/90)
      try { const prev=await new ethers.Contract(C.oracle,ORACLE,p).previewWldLicense(pe(px)); base=fe(prev[0]); total=fe(prev[1]); perDay=fe(prev[2]) } catch(e) {}
      const monthly = await core.monthlyWLDRemaining(addr).catch(() => [BigInt(5),BigInt(0)])
      setWldPrev({base:fmt(base)+' HACHI', total:fmt(total)+' HACHI', daily:'~'+fmt(perDay)+' HACHI/día', monthly:Number(monthly[1])+'/5 usadas · quedan '+Number(monthly[0])})
      const ids = await core.getUserWLDLics(addr)
      const lics = await Promise.all(ids.map(async(id:bigint) => ({id, l:await core.wldLics(id), pend:await core.pendingWLDHachi(id)})))
      setWldLics(lics.filter((x:any) => x.l[10]||x.l[11]))
      setWldLicsLoaded(true)
    } catch(e) {}
  }

  const loadLock = async (p: ethers.JsonRpcProvider) => {
    try {
      const lock = new ethers.Contract(C.lock,LOCK,p)
      const pos = await lock.getPosition(addr)
      const depSecs=Number(pos[5])
    setLockData({total:fmt(fe(pos[0]))+' HACHI', tier:['Sin tier','Akira','Zen','Koban','Tayko','Hachi'][pos[3]], apy:pos[4].toString()+'% APY', pending:fe(pos[2]).toFixed(4)+' HACHI', unstake:fmt(fe(pos[1]))+' HACHI', unstakeRaw:pos[1], nextDepositIn:fmtSecs(depSecs), nextDepositSecs:depSecs, nextClaimIn:fmtSecs(Number(pos[6]))})
      const b = await lock.getUserBatches(addr)
      setLockBatches(b[0].map((a:bigint,i:number) => ({amount:fe(a), unlocks:new Date(Number(b[1][i])*1000), ready:b[2][i]})).filter((x:any) => x.amount>0))
    } catch(e) {}
    try {
      const lock = new ethers.Contract(C.lock,LOCK,p)
      const [tl, tu] = await Promise.all([lock.totalLocked(), lock.totalUsers()])
      setPlatformStats({totalLocked:fmt(fe(tl))+' HACHI', totalUsers:tu.toString()})
    } catch(e) {}
  }

  const loadWeeklyBonus = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const wb = new ethers.Contract(WEEKLY_BONUS_ADDR, WEEKLY_BONUS_ABI, p)
      const [dailyRate, pending, lastAction, duration] = await Promise.all([
        wb.getDailyRate(a), wb.previewClaim(a), wb.lastActionTime(a), wb.cycleDuration(),
      ])
      const nowSecs = Math.floor(Date.now()/1000)
      const secondsUntilNext = Math.max(0, Number(lastAction) + Number(duration) - nowSecs)
      setWeeklyBonus({dailyRate: fe(dailyRate), pending: fe(pending), everClaimed: Number(lastAction) > 0, secondsUntilNext})
    } catch(e) {}
  }

  const withRetry = async <T,>(fn: () => Promise<T>, retries = 3, delayMs = 700): Promise<T> => {
    let lastErr: any
    for (let i = 0; i < retries; i++) {
      try { return await fn() }
      catch (e) { lastErr = e; if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1))) }
    }
    throw lastErr
  }

  const loadDrachmaMinerHistory = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const dmOld = new ethers.Contract(DRACHMA_MINER_ADDR_OLD, DRACHMA_MINER_ABI, p)
      const dmNew = new ethers.Contract(DRACHMA_MINER_ADDR_NEW, DRACHMA_MINER_ABI, p)
      const [oldId, newId] = await Promise.all([dmOld.activeMineId(a), dmNew.activeMineId(a)])
      const history: {contrato:string, id:number, hachiPaid:number, drachmaTotal:number, done:boolean}[] = []
      if (Number(oldId) > 0) {
        const m = await dmOld.mines(oldId)
        const hachiPaid = fe(m[2])
        const drachmaTotal = fe(m[3]), drachmaClaimed = fe(m[4])
        const done = (drachmaTotal - drachmaClaimed) <= 0.01
        history.push({contrato:'Anterior', id:Number(oldId), hachiPaid, drachmaTotal, done})
      }
      if (Number(newId) > 0) {
        const m = await dmNew.mines(newId)
        const hachiPaid = fe(m[2])
        const drachmaTotal = fe(m[3]), drachmaClaimed = fe(m[4])
        const done = (drachmaTotal - drachmaClaimed) <= 0.01
        history.push({contrato:'Actual', id:Number(newId), hachiPaid, drachmaTotal, done})
      }
      setDrachmaMinerHistory(history)
    } catch(e) {}
  }

  const loadDrachmaMiner = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      await withRetry(async () => {
        const dmOld = new ethers.Contract(DRACHMA_MINER_ADDR_OLD, DRACHMA_MINER_ABI, p)

        const oldActiveId = await dmOld.activeMineId(a)
        let useOld = false
        let oldMineInfo: any = null
        if (Number(oldActiveId) > 0) {
          const [m, pending] = await Promise.all([dmOld.mines(oldActiveId), dmOld.pendingDrachma(oldActiveId)])
          const activeFlag = m[9]
          const drachmaTotal = fe(m[3]), drachmaClaimed = fe(m[4])
          const restante = drachmaTotal - drachmaClaimed
          const nowSecs = Math.floor(Date.now()/1000)
          const endTimeOld = Number(m[7])
          if (activeFlag && (nowSecs < endTimeOld || restante > 0.01)) {
            useOld = true
            oldMineInfo = {active: activeFlag, drachmaTotal, drachmaClaimed, pending: fe(pending), endTime: endTimeOld}
          }
        }

        // Si NUNCA minó en el viejo (activeMineId=0), chequear si el viejo tiene pool suficiente.
        // Si ya minó ahí alguna vez (aunque solo le quede polvo), el contrato viejo lo va a
        // rechazar para siempre por su propio chequeo interno de "1 mina activa" — así que
        // en ese caso SIEMPRE usamos el nuevo, sin importar el pool del viejo.
        if (!useOld && Number(oldActiveId) === 0) {
          const [oldPool, oldCommitted]: [bigint, bigint] = await Promise.all([dmOld.drachmaPool(), dmOld.drachmaCommitted()])
          useOld = fe(oldPool - oldCommitted) > 500
        }

        const dmAddr = useOld ? DRACHMA_MINER_ADDR_OLD : DRACHMA_MINER_ADDR_NEW
        const dm = useOld ? dmOld : new ethers.Contract(DRACHMA_MINER_ADDR_NEW, DRACHMA_MINER_ABI, p)

        const [tier, activeId, durationSecs] = await Promise.all([dm.getUserTier(a), dm.activeMineId(a), dm.mineDuration()])
        const amounts = await Promise.all([0,1,2,3].map(i => dm.tierDrachmaAmounts(i)))
        const costs = await Promise.all([0,1,2,3].map(i => dm.costInHachi(i).catch(() => BigInt(0))))

        let mineInfo = oldMineInfo || {active:false, drachmaTotal:0, drachmaClaimed:0, pending:0, endTime:0}
        if (!oldMineInfo && Number(activeId) > 0) {
          const [m, pending] = await Promise.all([dm.mines(activeId), dm.pendingDrachma(activeId)])
          mineInfo = {active: m[9], drachmaTotal: fe(m[3]), drachmaClaimed: fe(m[4]), pending: fe(pending), endTime: Number(m[7])}
        }

        const [dPool, dCommitted]: [bigint, bigint] = await Promise.all([dm.drachmaPool(), dm.drachmaCommitted()])
        setDrachmaMiner({
          tier: Number(tier),
          amounts: amounts.map(fe),
          costs: costs.map(fe),
          activeMineId: useOld ? Number(oldActiveId) : Number(activeId),
          poolFree: fe(dPool - dCommitted),
          durationDays: Math.round(Number(durationSecs) / 86400),
          loaded: true,
          contractAddr: dmAddr,
          isNewContract: !useOld,
          ...mineInfo,
        })
      })
    } catch(e) {}
  }

  const mineDrachmaAction = async () => {
    if (!connected) { toast_('Conectá tu wallet primero', '#f85149'); return }
    try {
      toast_('Minando Drachma...', '#d29922')
      const costWithSlippage = drachmaMiner.costs[selDrachmaTier] * 1.02
      const costWei = pe(costWithSlippage)
      await sendTxMulti([
        ...buildPermit2Approvals(C.hachi, drachmaMiner.contractAddr, costWei),
        { to: drachmaMiner.contractAddr, abi: DRACHMA_MINER_ABI, fnName: 'mineDrachma', args: [selDrachmaTier, costWei] },
      ])
      toast_(`✓ Drachma en generación (${drachmaMiner.durationDays} días)`, '#3fb950')
      loadDrachmaMiner(addr, rpc())
    } catch(e: any) {
      toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149')
    }
  }

  const claimDrachmaMineAction = async () => {
    try {
      toast_('Reclamando Drachma...', '#d29922')
      await sendTx(drachmaMiner.contractAddr, DRACHMA_MINER_ABI, 'claimDrachma', [drachmaMiner.activeMineId])
      toast_('✓ Drachma reclamado', '#3fb950')
      loadDrachmaMiner(addr, rpc())
      loadBal(addr, rpc())
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }

  const loadVipHolders = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      await withRetry(async () => {
        const vh = new ethers.Contract(VIP_HOLDERS_ADDR, VIP_HOLDERS_ABI, p)
        const [level, preview, dPool, sPool] = await Promise.all([
          vh.getVipLevel(a), vh.previewExchange(a), vh.drachmaPool(), vh.sushiPool(),
        ])
        setVipData({
          level: Number(level),
          pendingHachi: fe(preview[0]),
          drachmaOut: fe(preview[1]),
          sushiOut: fe(preview[2]),
          drachmaPoolFree: fe(dPool),
          sushiPoolFree: fe(sPool),
          loaded: true,
        })
      })
    } catch(e) {}
  }

  const exchangeVipAction = async () => {
    if (!connected) { toast_('Conectá tu wallet primero', '#f85149'); return }
    setExchangingVip(true)
    try {
      toast_('Cambiando...', '#d29922')
      const vh = new ethers.Contract(VIP_HOLDERS_ADDR, VIP_HOLDERS_ABI, rpc())
      const [hachiAmount, drachmaOut, sushiOut] = await vh.previewExchange(addr)
      const expectedOut = vipPreferredToken === 0 ? drachmaOut : sushiOut
      const minOut = (expectedOut * BigInt(95)) / BigInt(100)
      const hachiWithBuffer = (hachiAmount * BigInt(102)) / BigInt(100)
      await sendTxMulti([
        ...buildPermit2Approvals(C.hachi, VIP_HOLDERS_ADDR, hachiWithBuffer),
        { to: VIP_HOLDERS_ADDR, abi: VIP_HOLDERS_ABI, fnName: 'exchange', args: [vipPreferredToken, minOut] },
      ])
      toast_('✓ Cambio realizado', '#3fb950')
      loadVipHolders(addr, rpc())
      loadBal(addr, rpc())
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
    finally { setExchangingVip(false) }
  }

  const loadWldMinerHistory = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const wmOld = new ethers.Contract(WLD_MINER_ADDR_OLD, WLD_MINER_ABI, p)
      const wmNew = new ethers.Contract(WLD_MINER_ADDR_NEW, WLD_MINER_ABI, p)
      const [oldId, newId] = await Promise.all([wmOld.activeMineId(a), wmNew.activeMineId(a)])
      const history: {contrato:string, id:number, wldPaid:number, hachiTotal:number, drachmaTotal:number, done:boolean}[] = []
      if (Number(oldId) > 0) {
        const m = await wmOld.mines(oldId)
        const wldPaid = fe(m[2])
        const hachiTotal = fe(m[3]), hachiClaimed = fe(m[4])
        const drachmaTotal = fe(m[5]), drachmaClaimed = fe(m[6])
        const done = (hachiTotal - hachiClaimed <= 0.01) && (drachmaTotal - drachmaClaimed <= 0.01)
        history.push({contrato:'Anterior', id:Number(oldId), wldPaid, hachiTotal, drachmaTotal, done})
      }
      if (Number(newId) > 0) {
        const m = await wmNew.mines(newId)
        const wldPaid = fe(m[2])
        const hachiTotal = fe(m[3]), hachiClaimed = fe(m[4])
        const drachmaTotal = fe(m[5]), drachmaClaimed = fe(m[6])
        const done = (hachiTotal - hachiClaimed <= 0.01) && (drachmaTotal - drachmaClaimed <= 0.01)
        history.push({contrato:'Actual', id:Number(newId), wldPaid, hachiTotal, drachmaTotal, done})
      }
      setWldMinerHistory(history)
    } catch(e) {}
  }

  const loadWldMiner = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      await withRetry(async () => {
        const wmOld = new ethers.Contract(WLD_MINER_ADDR_OLD, WLD_MINER_ABI, p)

        const oldActiveId = await wmOld.activeMineId(a)
        let useOld = false
        let oldMineInfo: any = null
        if (Number(oldActiveId) > 0) {
          const [m, pending] = await Promise.all([wmOld.mines(oldActiveId), wmOld.pendingRewards(oldActiveId)])
          const activeFlag = m[10]
          const hachiTotal = fe(m[3]), hachiClaimed = fe(m[4])
          const drachmaTotal = fe(m[5]), drachmaClaimed = fe(m[6])
          const restanteHachi = hachiTotal - hachiClaimed
          const restanteDrachma = drachmaTotal - drachmaClaimed
          const nowSecs = Math.floor(Date.now()/1000)
          const endTimeOld = Number(m[8])
          if (activeFlag && (nowSecs < endTimeOld || restanteHachi > 0.01 || restanteDrachma > 0.01)) {
            useOld = true
            oldMineInfo = {
              active: activeFlag, variant: Number(m[1]),
              hachiTotal, hachiClaimed, drachmaTotal, drachmaClaimed,
              pendingHachi: fe(pending[0]), pendingDrachma: fe(pending[1]),
              endTime: endTimeOld,
            }
          }
        }

        // Si NUNCA minó en el viejo (activeMineId=0), chequear si el viejo tiene pool suficiente.
        // Si ya minó ahí alguna vez (aunque solo le quede polvo), el contrato viejo lo va a
        // rechazar para siempre por su propio chequeo interno de "1 mina activa" — así que
        // en ese caso SIEMPRE usamos el nuevo, sin importar el pool del viejo.
        if (!useOld && Number(oldActiveId) === 0) {
          const [oldHPool, oldHCommitted, oldDPool, oldDCommitted]: [bigint, bigint, bigint, bigint] = await Promise.all([
            wmOld.hachiPool(), wmOld.hachiCommitted(), wmOld.drachmaPool(), wmOld.drachmaCommitted(),
          ])
          useOld = fe(oldHPool - oldHCommitted) > 1000 && fe(oldDPool - oldDCommitted) > 10
        }

        const wmAddr = useOld ? WLD_MINER_ADDR_OLD : WLD_MINER_ADDR_NEW
        const wm = useOld ? wmOld : new ethers.Contract(WLD_MINER_ADDR_NEW, WLD_MINER_ABI, p)

        const variantsData = await Promise.all([0,1,2].map(i => wm.variants(i)))
        setWldMinerVariants(variantsData.map((v: any) => ({ days: Math.round(Number(v[0])/86400), pct: Number(v[1])/100 })))
        const [tier, cap, activeId, hPool, hCommitted, dPool, dCommitted] = await Promise.all([
          wm.getUserTier(a), wm.maxInvestableWld(a), wm.activeMineId(a),
          wm.hachiPool(), wm.hachiCommitted(), wm.drachmaPool(), wm.drachmaCommitted(),
        ])
        let mineInfo = oldMineInfo || {active:false, variant:0, hachiTotal:0, hachiClaimed:0, drachmaTotal:0, drachmaClaimed:0, pendingHachi:0, pendingDrachma:0, endTime:0}
        if (!oldMineInfo && Number(activeId) > 0) {
          const [m, pending] = await Promise.all([wm.mines(activeId), wm.pendingRewards(activeId)])
          mineInfo = {
            active: m[10], variant: Number(m[1]),
            hachiTotal: fe(m[3]), hachiClaimed: fe(m[4]),
            drachmaTotal: fe(m[5]), drachmaClaimed: fe(m[6]),
            pendingHachi: fe(pending[0]), pendingDrachma: fe(pending[1]),
            endTime: Number(m[8]),
          }
        }
        const hFree: bigint = (hPool as bigint) - (hCommitted as bigint)
        const dFree: bigint = (dPool as bigint) - (dCommitted as bigint)
        setWldMiner({
          tier: Number(tier), cap: fe(cap), activeMineId: useOld ? Number(oldActiveId) : Number(activeId),
          poolFreeHachi: fe(hFree), poolFreeDrachma: fe(dFree),
          loaded: true,
          contractAddr: wmAddr,
          isNewContract: !useOld,
          ...mineInfo,
        })
      })
    } catch(e) {}
  }

  const previewWldMine = async (variantOverride?: number) => {
    const wldAmount = parseFloat(selWldAmount)
    const variant = variantOverride !== undefined ? variantOverride : selWldVariant
    if (!wldAmount || wldAmount <= 0) { setWldMinerPreview({hachi:0, drachma:0}); return }
    try {
      const wm = new ethers.Contract(wldMiner.contractAddr, WLD_MINER_ABI, rpc())
      const [hachiTotal, drachmaTotal] = await wm.previewMine(pe(wldAmount), variant)
      setWldMinerPreview({hachi: fe(hachiTotal), drachma: fe(drachmaTotal)})
    } catch(e) { setWldMinerPreview({hachi:0, drachma:0}) }
  }

  const mineWldAction = async () => {
    if (!connected) { toast_('Conectá tu wallet primero', '#f85149'); return }
    const wldAmount = parseFloat(selWldAmount)
    if (!wldAmount || wldAmount <= 0) { toast_('Ingresá un monto válido', '#f85149'); return }
    setMiningWld(true)
    try {
      toast_('Minando...', '#d29922')
      const wm = new ethers.Contract(wldMiner.contractAddr, WLD_MINER_ABI, rpc())
      const wldWei = pe(wldAmount)
      const [hachiTotal, drachmaTotal] = await wm.previewMine(wldWei, selWldVariant)
      const minHachi = (hachiTotal * BigInt(98)) / BigInt(100)
      const minDrachma = (drachmaTotal * BigInt(98)) / BigInt(100)
      await sendTxMulti([
        ...buildPermit2Approvals(C.wld, wldMiner.contractAddr, wldWei),
        { to: wldMiner.contractAddr, abi: WLD_MINER_ABI, fnName: 'mineWld', args: [wldWei, selWldVariant, minHachi, minDrachma] },
      ])
      toast_('✓ Minería iniciada', '#3fb950')
      setSelWldAmount('')
      loadWldMiner(addr, rpc())
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
    finally { setMiningWld(false) }
  }

  const claimWldMinerAction = async () => {
    setClaimingWldMiner(true)
    try {
      toast_('Reclamando...', '#d29922')
      await sendTx(wldMiner.contractAddr, WLD_MINER_ABI, 'claimRewards', [wldMiner.activeMineId])
      toast_('✓ Reclamado', '#3fb950')
      loadWldMiner(addr, rpc())
      loadBal(addr, rpc())
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
    finally { setClaimingWldMiner(false) }
  }

  const claimWeeklyBonus = async () => {
    setClaimingWeekly(true)
    try {
      toast_('Reclamando bono semanal...', '#d29922')
      await sendTx(WEEKLY_BONUS_ADDR, WEEKLY_BONUS_ABI, 'claimBonus', [])
      toast_('✓ Bono semanal reclamado', '#3fb950')
      loadWeeklyBonus(addr, rpc())
      loadBal(addr, rpc())
    } catch(e: any) {
      toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149')
    } finally {
      setClaimingWeekly(false)
    }
  }

  const loadRanking = async (p: ethers.JsonRpcProvider) => {
    const r = new ethers.Contract(C.ranking, RANKING, p)
    let myPts = 0, totalHist = '0', reward = '—', earned = '—', pos = '—', nextDist = '—', lastExecTs = 0
    try {
      const s = await r.getUserStats(addr)
      myPts     = Number(s[0])
      totalHist = fmt(Number(s[1])) + ' pts'
      reward    = fmt(fe(s[2])) + ' HACHI'
      earned    = fmt(fe(s[3])) + ' HACHI'
    } catch(e: any) { log('ranking getUserStats err: '+(e?.message||'').slice(0,60)) }
    try {
      const rk = await r.getCurrentRanking()
      const list = rk[0].map((a:string,i:number) => ({a,pts:Number(rk[1][i])})).filter((e:any) => e.pts>0).sort((a:any,b:any) => b.pts-a.pts)
      const idx = list.findIndex((e:any) => e.a.toLowerCase()===addr.toLowerCase())
      pos = idx>=0 ? '#'+(idx+1) : '—'
      setRankList(list)
      resolveUsernames(list.map((e:any) => e.a))
    } catch(e: any) { log('ranking getCurrentRanking err: '+(e?.message||'').slice(0,60)) }
    try {
      const [nextT, lastExec] = await Promise.all([r.timeUntilNextExecution(), r.lastExecutedAt()])
      lastExecTs = Number(lastExec)
      const secs = Number(nextT), d=Math.floor(secs/86400), h=Math.floor((secs%86400)/3600)
      const nextDate = secs>0 ? new Date(Date.now()+secs*1000).toLocaleString('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : ''
      if (secs > 0)              nextDist = `${d}d ${h}h (${nextDate})`
      else if (lastExecTs === 0) nextDist = 'Primer reparto disponible'
      else                       nextDist = 'Disponible'
    } catch(e: any) { log('ranking timeUntilNext err: '+(e?.message||'').slice(0,60)) }
    try {
      if (lastExecTs > 0) {
        const currentBlock = await p.getBlockNumber()
        const blocksAgo = Math.ceil((Date.now()/1000 - lastExecTs) / 2)
        const est = currentBlock - blocksAgo
        const fromBlock = Math.max(0, est - 40)
        const toBlock   = est + 40
        log(`lastWinners range: from=${fromBlock} to=${toBlock} est=${est} blocksAgo=${blocksAgo}`)
        const logs = await r.queryFilter('PrizePaid', fromBlock, toBlock)
        log(`lastWinners raw logs: ${logs.length}`)
        const winners = (logs as any[])
          .map(l => ({addr: l.args[0], amount: Number(l.args[1])/1e18, rank: Number(l.args[2])}))
          .filter(w => w.rank <= 10)
          .sort((a,b) => a.rank - b.rank)
        log(`lastWinners after filter: ${winners.length}`)
        setLastWinners(winners)
        resolveUsernames(winners.map(w => w.addr))
      } else {
        log('lastWinners: lastExecTs=0, skipping')
      }
    } catch(e: any) {
      log('lastWinners err: '+(e?.message||'').slice(0,80))
      try { log('lastWinners err detail: '+JSON.stringify(e).slice(0,120)) } catch {}
    }
    setRankStats({points:fmt(myPts), totalHist, pos, reward, earned, nextDist})
  }

  const loadPools = async (p: ethers.JsonRpcProvider) => {
  try {
  const ws = await new ethers.Contract(C.poolWLD,POOLWLD,p).getPoolStatus()
  const core = new ethers.Contract(C.core,CORE,p)
  // Pool A (ciclos SUSHI). Pool C / perpetuo fue ELIMINADO del contrato (pago unico inmediato),
  // por eso ya no lo mostramos. getPoolStatus aun devuelve poolC=0 por compatibilidad, lo ignoramos.
  let poolA='—',poolAC='—',poolAF='—',sushiAvail='—',poolAFreeNum=0
  try {
    const ps=await core.getPoolStatus()
    poolA=fmt(fe(ps[0]))+' SUSHI'; poolAC=fmt(fe(ps[1]))+' SUSHI'; poolAF=fmt(fe(ps[2]))+' SUSHI'
    poolAFreeNum=fe(ps[2])
    const sa=await core.getSushiAvailability()
    sushiAvail=sa[1].toString()
  } catch(e:any) { log('poolStatus err: '+(e.message||'').slice(0,40)) }
  const st = await core.getSalesStats()
  // Compute licsAvail locally — do not use the React state variable, which may be stale
  // when loadPools and loadOracle run in parallel (loadAll) or when loadPools runs alone (loadTab).
  let localLicsAvail = '—'
  try {
    const r = await new ethers.Contract(C.oracle,ORACLE,p).getRates()
    const hf=fe(ws[1]), wh=fe(r[0]), costPerLic=wh*1.30
    const n = costPerLic>0 ? Math.floor(hf/costPerLic) : 0
    localLicsAvail = n > 0 ? n + ' lics. básicas' : '0 (sin fondos)'
  } catch(e) {}
  setPoolsData({wldTotal:fmt(fe(ws[0]))+' HACHI', wldComm:fmt(fe(ws[2]))+' HACHI', wldFree:fmt(fe(ws[1]))+' HACHI', wldPaid:fmt(fe(ws[3]))+' HACHI', poolA, poolAC, poolAF, poolAFreeNum, sushiAvail, wldSales:fmt(fe(st[0]))+' WLD', wldLics:st[2].toString(), sushiLics:st[3].toString(), burned:fmt(fe(st[4]))+' HACHI', licsAvail:localLicsAvail})
  } catch(e:any) { log('loadPools err: '+(e.message||'error').slice(0,50)) }
  }

  const wldNames = ['🌱 Básica','⚡ Estándar','💎 Premium','🚀 Elite']
  const wldPrices = ['1 WLD','3 WLD','5 WLD','10 WLD']
  const sushiNames = ['🌱 Bocado','⚡ Bocado Doble','💎 Bocado Grande','🚀 Bocado Real']
  const sushiPrices = ['500 HACHI','2,000 HACHI','5,000 HACHI','10,000 HACHI']

  // PANTALLA DE INICIO DE SESIÓN — se muestra mientras no haya wallet conectada
  if (!connected) {
    return (
      <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#2a1f63 0%,#1d1a52 55%,#2b2c78 100%)',color:'#e6edf3',fontFamily:'Georgia,serif',display:'flex',flexDirection:'column',position:'relative',overflow:'hidden'}}>
        <style>{`
          @keyframes orbitRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes orbitCounterRotate { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        `}</style>
        {toast&&<div style={{position:'fixed',top:16,right:16,zIndex:999,padding:'10px 16px',borderRadius:8,background:'#161b22',border:`1px solid ${toast.color}`,color:toast.color,fontSize:13,maxWidth:320}}>{toast.msg}</div>}

        {/* selector de idioma arriba a la derecha */}
        <div style={{display:'flex',justifyContent:'flex-end',gap:4,padding:16}}>
          {(['es','en','pt'] as Lang[]).map(l=><button key={l} onClick={()=>setLang(l)} style={{background:'none',border:`1px solid ${lang===l?'#a78bfa':'#30363d'}`,borderRadius:4,padding:'2px 8px',fontSize:11,cursor:'pointer',color:lang===l?'#e6edf3':'#8b949e'}}>{l.toUpperCase()}</button>)}
        </div>

        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'8px 20px 40px',maxWidth:480,margin:'0 auto',width:'100%',position:'relative',zIndex:1}}>

          {/* HERO */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:8}}>
            <div style={{fontSize:38,filter:'drop-shadow(0 0 16px rgba(251,191,36,.6))'}}>⛏</div>
            <h1 style={{fontSize:34,fontWeight:700,color:'#fbbf24',textShadow:'0 0 18px rgba(251,191,36,.5)',margin:0,textAlign:'center'}}>HachiMiner</h1>
          </div>
          <p style={{fontSize:15,color:'#c4b5fd',fontStyle:'italic',textAlign:'center',margin:'0 0 20px',lineHeight:1.5,maxWidth:360}}>{loginCopy.tagline}</p>

          {/* CTA */}
          <button onClick={connectWallet} style={{...btnP,marginBottom:20,fontSize:15,padding:'14px 16px',width:'100%'}}>
            {inWA ? loginCopy.ctaWA : loginCopy.cta}
          </button>

          {/* FEATURES — gato al centro, funciones alrededor en círculo */}
          <div style={{position:'relative',width:300,height:300,margin:'0 auto 16px',maxWidth:'90vw'}}>
            <img src="/hachi-cat-savings.png" alt="" style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:110,height:110,borderRadius:20,objectFit:'cover',boxShadow:'0 0 30px rgba(232,121,249,.6)',border:'2px solid #e879f9',zIndex:1}} />
            <div style={{position:'absolute',inset:0,animation:'orbitRotate 40s linear infinite'}}>
              {loginCopy.features.map((f,i)=>{
                const n = loginCopy.features.length
                const angle = (i / n) * 2 * Math.PI - Math.PI / 2
                const radius = 125
                const x = 150 + radius * Math.cos(angle)
                const y = 150 + radius * Math.sin(angle)
                return <div key={i} style={{position:'absolute',left:x,top:y,transform:'translate(-50%,-50%)',textAlign:'center',width:84}}>
                  <div style={{animation:'orbitCounterRotate 40s linear infinite'}}>
                    {(f as any).iconImg ? <img src={(f as any).iconImg} alt="" width={26} height={26} style={{borderRadius:13,objectFit:'cover',marginBottom:2,filter:'drop-shadow(0 0 6px rgba(124,58,237,.5))'}} /> : <div style={{fontSize:26,marginBottom:2,filter:'drop-shadow(0 0 6px rgba(124,58,237,.5))'}}>{f.icon}</div>}
                    <div style={{fontSize:10,fontWeight:700,color:'#e6edf3',lineHeight:1.2}}>{f.title}</div>
                  </div>
                </div>
              })}
            </div>
          </div>

          <div style={{display:'flex',flexWrap:'wrap',gap:8,width:'100%',marginBottom:16}}>
            <a href="https://whatsapp.com/channel/0029Vb7aycxDjiOasgPK2k1h" target="_blank" rel="noopener noreferrer" style={{flex:1,minWidth:90,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'11px 8px',borderRadius:10,background:'linear-gradient(135deg,#25D366,#128C7E)',color:'#fff',fontSize:12,fontWeight:700,textDecoration:'none',boxShadow:'0 2px 10px rgba(37,211,102,.35)'}}><img src="https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg" alt="" width={16} height={16} style={{filter:'brightness(0) invert(1)'}} />Canal Oficial</a>
            <a href="https://t.me/+mg3Tt_4pZJs4NTAx" target="_blank" rel="noopener noreferrer" style={{flex:1,minWidth:90,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 8px',borderRadius:8,border:'1px solid #229ED9',color:'#229ED9',fontSize:12,fontWeight:600,textDecoration:'none'}}><img src="https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/telegram.svg" alt="" width={16} height={16} style={{filter:'invert(52%) sepia(89%) saturate(1996%) hue-rotate(166deg) brightness(97%) contrast(96%)'}} />Telegram</a>
          </div>

          {/* PASOS */}
          <div style={{...card,width:'100%'}}>
            <div style={cTitle}>{loginCopy.stepsTitle}</div>
            {loginCopy.steps.map((s,i)=>(
              <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'6px 0'}}>
                <div style={{flexShrink:0,width:22,height:22,borderRadius:'50%',background:'#7c3aed',color:'#fff',fontSize:12,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 10px rgba(124,58,237,.5)'}}>{i+1}</div>
                <div style={{fontSize:13,color:'#c9d1d9',lineHeight:1.5}}>{s}</div>
              </div>
            ))}
          </div>
          <p style={{fontSize:11,color:'#8b949e',textAlign:'center',marginTop:12,lineHeight:1.5}}>{loginCopy.disclaimer}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#2a1f63 0%,#1d1a52 55%,#2b2c78 100%)',color:'#e6edf3',fontFamily:'Georgia,serif'}}>
      <style>{`
        @keyframes quickAccessPulse {
          0%,100% { box-shadow: 0 0 6px rgba(167,139,250,.3); }
          50% { box-shadow: 0 0 14px rgba(167,139,250,.6); }
        }
      `}</style>
      {toast&&<div style={{position:'fixed',top:16,right:16,zIndex:999,padding:'10px 16px',borderRadius:8,background:'#161b22',border:`1px solid ${toast.color}`,color:toast.color,fontSize:13,maxWidth:320}}>{toast.msg}</div>}

      {/* POPUP VERIFICACION WORLD ID */}
      {showVerify&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#1e0840',border:'1px solid #5b21b6',borderRadius:16,padding:32,maxWidth:360,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>🌍</div>
            <div style={{fontWeight:700,fontSize:18,marginBottom:8}}>Verificar World ID</div>
            <div style={{fontSize:13,color:'#9b96c4',marginBottom:24}}>Tu verificación World ID se detecta automáticamente si tu wallet fue verificada con Orb en World App. No necesitás hacer nada aquí.</div>
            <button onClick={()=>setShowVerify(false)} style={btnGh}>Cerrar</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{background:'#211a55',borderBottom:'1px solid #4c3a8f',padding:'8px 14px',position:'sticky',top:0,zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:connected?8:0}}>
          <div style={{fontSize:18,fontWeight:700,color:'#e879f9',textShadow:'0 0 12px rgba(232,121,249,.5)',whiteSpace:'nowrap'}}>⛏ HachiMiner</div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{display:'flex',gap:4}}>
              {(['es','en','pt'] as Lang[]).map(l=><button key={l} onClick={()=>setLang(l)} style={{background:'none',border:`1px solid ${lang===l?'#a78bfa':'#3a3470'}`,borderRadius:4,padding:'2px 6px',fontSize:11,cursor:'pointer',color:lang===l?'#e6edf3':'#9b96c4'}}>{l.toUpperCase()}</button>)}
            </div>
            <button onClick={connectWallet} style={{background:'#7c3aed',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',fontSize:13,fontWeight:600,cursor:'pointer',boxShadow:'0 0 14px rgba(124,58,237,.5)',whiteSpace:'nowrap'}}>{connected?nameFor(addr):t('connect')}</button>
          </div>
        </div>
        {connected&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div style={{display:'flex',gap:16}}>{[['HACHI',hachiB],['WLD',wldB],['SUSHI',sushiB]].map(([l,v])=><div key={l} style={{display:'flex',flexDirection:'column'}}><div style={{fontSize:9,color:'#9b96c4',textTransform:'uppercase',letterSpacing:.5}}>{l}</div><div style={{fontFamily:'monospace',fontSize:13,fontWeight:600}}>{v}</div></div>)}</div>
          <div onClick={()=>!verified&&setShowVerify(true)} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#9b96c4',cursor:'pointer',whiteSpace:'nowrap'}}><div style={{width:7,height:7,borderRadius:'50%',background:verified?'#3fb950':'#6b6494'}}></div><span>{verified?t('verified'):t('not_verified')}</span></div>
        </div>}
      </div>

      {/* NAV */}
      {SHOW_TOP_NAV&&<div style={{background:'#12022a',borderBottom:'1px solid #3b0764',display:'flex',overflowX:'auto',gap:2,padding:'0 12px'}}>
        {(['home','lics','lock','pools','wldminer','voting'] as Tab[]).map((v,i)=>{
          const labels=[t('nav_home'),t('nav_lics'),t('nav_lock'),t('nav_pools'),'⛏️ WLD Miner','🗳️ Votación']
          return <button key={v} onClick={()=>loadTab(v)} style={{background:'none',border:'none',borderBottom:`2px solid ${tab===v?'#a78bfa':'transparent'}`,color:tab===v?'#a78bfa':'#8b949e',padding:'12px 14px',fontSize:13,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Georgia,serif',textShadow:tab===v?'0 0 8px #a78bfa':''}}>{labels[i]}</button>
        })}
      </div>}
      {!SHOW_TOP_NAV&&tab!=='home'&&<div style={{background:'#12022a',borderBottom:'1px solid #3b0764',padding:'8px 12px'}}>
        <button onClick={()=>loadTab('home')} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',padding:'6px 12px',fontSize:13,cursor:'pointer'}}>← Volver a Inicio</button>
      </div>}

      <div style={{maxWidth:480,margin:'0 auto',padding:16}}>

        {tab==='home'&&<div>
          {priceAlert&&<div style={{background:'rgba(248,113,113,.1)',border:'1px solid rgba(248,113,113,.4)',borderRadius:8,padding:12,marginBottom:12,fontSize:13,color:'#f87171',textAlign:'center'}}>⚠ Ventas WLD pausadas — HACHI devaluado ({fmt(wldHachi)} &gt; {MAX_HACHI.toLocaleString()})</div>}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
            {[
              {icon:'🎯',label:'Centro Hachi',tab:'centrohachi' as Tab,delay:0,isNew:true},
              {icon:'⛏️',label:'Minería',tab:'mineria' as Tab,delay:0.15},
              {icon:'🔒',label:'Lock',tab:'lock' as Tab,delay:0.3},
              {icon:'🌊',label:'Pools',tab:'pools' as Tab,delay:0.6},
              {icon:'🗳️',label:'Votación',tab:'voting' as Tab,delay:1.2},
            ].map(btn=><button key={btn.tab} onClick={()=>loadTab(btn.tab)} style={{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'12px 4px',borderRadius:12,border:'1px solid #5b21b6',background:'linear-gradient(135deg,#2d1b69,#1e0840)',color:'#e6edf3',cursor:'pointer',animation:`quickAccessPulse 3s ease-in-out infinite`,animationDelay:`${btn.delay}s`}}>
              {(btn as any).isNew&&<span style={{position:'absolute',top:-6,right:-6,background:'#f59e0b',color:'#1e0840',fontSize:8,fontWeight:800,padding:'2px 5px',borderRadius:8,boxShadow:'0 0 8px rgba(245,158,11,.6)'}}>NUEVO</span>}
              {(btn as any).iconImg ? <img src={(btn as any).iconImg} alt="" width={22} height={22} style={{borderRadius:11,objectFit:'cover'}} /> : <span style={{fontSize:22}}>{btn.icon}</span>}
              <span style={{fontSize:10,fontWeight:600}}>{btn.label}</span>
            </button>)}
          </div>
          <div style={card}><div style={cTitle}>🎁 Reward</div>
            <button onClick={()=>setShowInfoWeekly(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',marginBottom:10,width:'100%'}}>ℹ️ ¿Qué es esto?</button>
            {showInfoWeekly&&<div style={{background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c4b5fd',lineHeight:1.6}}>
              Cada 7 días, si tenés licencias WLD o una minería de Drachma activa, se te va preparando un <strong>regalo sorpresa</strong> — un extra esporádico de agradecimiento, no algo garantizado por sistema.
              <br/><br/>
              No vas a ver el monto acumulándose — solo vas a saber que tenés un regalo esperando cuando esté listo para abrir. Una vez que lo abrís, tenés 3 días de gracia para reclamarlo antes de que vuelva al pool.
            </div>}
            <div style={{textAlign:'center',padding:'24px 8px'}}>
              {(()=>{
                const listo = weeklyBonus.secondsUntilNext<=0 && weeklyBonus.pending>0
                const bloqueado = !listo
                if (bloqueado) {
                  const d = Math.floor(weeklyBonus.secondsUntilNext/86400), h = Math.floor((weeklyBonus.secondsUntilNext%86400)/3600)
                  return <>
                    <div style={{fontSize:64,marginBottom:12,filter:'grayscale(0.4) opacity(0.6)'}}>🎁</div>
                    <div style={{fontSize:14,color:'#8b949e',marginBottom:6}}>Tu próximo regalo se está preparando</div>
                    {weeklyBonus.dailyRate<=0
                      ? <div style={{fontSize:12,color:'#f87171',lineHeight:1.5}}>Necesitás una licencia WLD activa o una minería de Drachma activa para empezar a generar tu regalo.</div>
                      : <div style={{fontSize:13,color:'#fbbf24',fontWeight:700}}>{weeklyBonus.everClaimed ? `Listo en ${d}d ${h}h` : 'Ya podés reclamar tu primer regalo'}</div>}
                    {!weeklyBonus.everClaimed && weeklyBonus.dailyRate>0 && <button onClick={claimWeeklyBonus} disabled={!connected||claimingWeekly} style={{...btnP,width:'100%',marginTop:16,opacity:(!connected||claimingWeekly)?0.4:1}}>{claimingWeekly?'Abriendo...':'🎁 Abrir mi primer regalo'}</button>}
                  </>
                }
                if (listo && !giftOpened) {
                  return <>
                    <div onClick={()=>setGiftOpened(true)} style={{fontSize:72,marginBottom:12,cursor:'pointer',animation:'giftBounceV1 1.2s ease-in-out infinite'}}>🎁</div>
                    <div style={{fontSize:15,fontWeight:800,color:'#fbbf24',marginBottom:6}}>¡Tenés un regalo esperando!</div>
                    <div style={{fontSize:12,color:'#8b949e'}}>Tocá el regalo para abrirlo</div>
                    <style>{`@keyframes giftBounceV1 { 0%,100%{transform:translateY(0) rotate(-3deg);} 50%{transform:translateY(-10px) rotate(3deg);} }`}</style>
                  </>
                }
                return <>
                  <div style={{fontSize:56,marginBottom:12}}>🎉</div>
                  <div style={{fontSize:16,fontWeight:800,color:'#3fb950',marginBottom:4}}>¡Felicidades!</div>
                  <div style={{fontSize:14,color:'#e6edf3',marginBottom:16}}>Ganaste <strong style={{color:'#fbbf24'}}>{weeklyBonus.pending.toFixed(2)} SUSHI</strong></div>
                  <button onClick={async()=>{await claimWeeklyBonus(); setGiftOpened(false)}} disabled={!connected||claimingWeekly} style={{...btnP,width:'100%',opacity:(!connected||claimingWeekly)?0.4:1}}>{claimingWeekly?'Reclamando...':'Reclamar'}</button>
                  <div style={{fontSize:11,color:'#8b949e',marginTop:12}}>Gracias por usar Hachi Miner 🐱</div>
                </>
              })()}
            </div>
          </div>
          <button onClick={()=>window.open(HACHI_BUY_URL,'_blank')} style={{...btnG,width:'100%',marginBottom:12}}>🪙 Comprar HACHI</button>
          {!connected&&<div style={{textAlign:'center',padding:'32px 16px',color:'#8b949e'}}>
            <div style={{fontSize:32,marginBottom:8}}>👋</div>
            <div style={{fontWeight:600,color:'#e6edf3',marginBottom:4}}>Bienvenido a HachiMiner</div>
            <div>{t('connect_prompt')}</div>
            <button onClick={connectWallet} style={{...btnP,marginTop:16,maxWidth:200}}>{t('connect')}</button>
          </div>}
        </div>}

        {tab==='lics'&&<div>
          <div style={{...sLabel,display:'flex',alignItems:'center',gap:10}}><img src="/hachi-logo.png" alt="" width={44} height={44} style={{borderRadius:10,flexShrink:0,objectFit:'cover'}} />Hachi Miner</div>
          <button onClick={()=>setShowInfoLics(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',marginBottom:10,width:'100%'}}>ℹ️ ¿Cómo funcionan las licencias?</button>
          {showInfoLics&&<div style={{background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c4b5fd',lineHeight:1.6}}>
            <strong>¿Quién puede participar?</strong> Cualquier usuario verificado con World ID. Comprar tu primera licencia WLD es el punto de entrada a todo el sistema de minería de Hachi.
            <br/><br/>
            <strong>Licencias WLD:</strong> pagás WLD una vez y recibís HACHI de forma lineal durante 3 meses (30% de retorno total, 35% en Elite). Podés tener hasta <strong>5 licencias WLD nuevas por mes</strong>.
            <br/><br/>
            <strong>Tu licencia te convierte en minero:</strong> según tu nivel (Básica/Estándar/Premium/Elite), tenés acceso a distintos mineros más avanzados dentro de la app — Drachma Miner y WLD Miner — cada uno con un tope de inversión que crece con tu nivel.
            <br/><br/>
            <strong>Sistema limitado y sostenible:</strong> todos los topes de inversión están pensados según tu nivel, para que el sistema crezca de forma controlada. El equipo de Hachi reinvierte parte de lo recaudado y distribuye recursos entre los distintos pools para mantener todo funcionando.
          </div>}
          <div style={{background:'rgba(251,191,36,.1)',border:'1px solid rgba(251,191,36,.4)',borderRadius:8,padding:12,marginBottom:12,fontSize:12,color:'#fbbf24',textAlign:'center',fontWeight:700}}>
            🔒 Máximo 3 licencias Elite activas al mismo tiempo, por usuario
          </div>
          <div style={sLabel}>Mis licencias WLD</div>
          {!wldLicsLoaded?<div style={empty}><div style={{fontSize:28}}>⏳</div><div>Consultando tus licencias...</div></div>:wldLics.length===0?<div style={empty}><div style={{fontSize:28}}>💠</div><div>{t('no_lics')}</div></div>:<div style={card}>
            {wldLics.map(({id,l,pend})=>{
              const nowSecs = Math.floor(Date.now()/1000)
              const endSecs = Number(l[7])
              const startSecs = Number(l[6])
              const secsLeft = endSecs - nowSecs
              const diasLeft = Math.floor(Math.abs(secsLeft)/86400)
              const horasLeft = Math.floor((Math.abs(secsLeft)%86400)/3600)
              const countdownLabel = secsLeft <= 0 ? 'Vencida' : `${diasLeft}d ${horasLeft}h restantes`
              return <div key={id.toString()} style={{borderBottom:'1px solid #3b0764',paddingBottom:10,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><strong>{['Básica','Estándar','Premium','Elite'][l[1]]} <span style={{fontSize:11,color:'#8b949e'}}>#{id.toString()}</span></strong><div style={{color:l[10]?'#3fb950':'#8b949e'}}>●</div></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Pendiente</span><span style={{color:'#3fb950',fontFamily:'monospace'}}>{fmt(fe(pend))} HACHI</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Comprada</span><span style={{fontFamily:'monospace'}}>{new Date(startSecs*1000).toLocaleDateString()}</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Vence</span><span style={{fontFamily:'monospace'}}>{new Date(endSecs*1000).toLocaleDateString()}</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Tiempo restante</span><span style={{fontFamily:'monospace',color:secsLeft<=0?'#f87171':'#fbbf24',fontWeight:700}}>{countdownLabel}</span></div>
            </div>})}
            <button onClick={claimAllWLD} style={{...btnG,width:'100%',marginTop:4}}>Cobrar todo</button>
          </div>}
          <button onClick={()=>setShowBuyWLD(true)} style={{...btnP,width:'100%',marginTop:12}}>🛒 Comprá tu licencia</button>
        </div>}
        {showBuyWLD&&<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'#0f0224',zIndex:200,overflowY:'auto',padding:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <span style={{...sLabel,margin:0}}>Comprar licencia WLD</span>
            <button onClick={()=>setShowBuyWLD(false)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#e6edf3',fontSize:13,padding:'6px 12px',cursor:'pointer'}}>✕ Cerrar</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
            {wldNames.map((n,i)=>{
              const now_ts = Math.floor(Date.now()/1000)
              const activeEliteCount = wldLics.filter(({l}:any) => Number(l[1])===3 && l[10] && Number(l[7])>now_ts).length
              const locked = i===3 && activeEliteCount>=3
              return <div key={i} onClick={()=>{if(!locked) setSelWLD(i)}} style={{...lCard,border:`1px solid ${selWLD===i?'#fbbf24':'#5b21b6'}`,background:selWLD===i?'rgba(251,191,36,.08)':'#1e0840',boxShadow:selWLD===i?'0 0 12px rgba(251,191,36,.3)':'none',opacity:locked?0.35:1,cursor:locked?'not-allowed':'pointer'}}>
              <div style={{fontSize:11,fontWeight:700}}>{n}{i===3&&<span style={{color:'#34d399'}}> +5%</span>}</div>
              <div style={{fontFamily:'monospace',fontSize:18,fontWeight:700,color:'#34d399'}}>{fmt(Math.round([1,3,5,10][i]*wldHachi*(i===3?1.35:1.3)))}</div>
              <div style={{fontSize:10,color:'#8b949e'}}>HACHI · 3 meses · {i===3?'35%':'30%'}</div>
              <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginTop:6}}>{locked?'Ya tenés 3 activas':wldPrices[i]}</div>
            </div>})}
          </div>
          <div style={pBox}>{[['Tipo',wldNames[selWLD]],['Precio',wldPrices[selWLD]],['HACHI base',wldPrev.base],[selWLD===3?'Total ×1.35 (Elite +5%)':'Total ×1.3',wldPrev.total],['HACHI/día',wldPrev.daily],['Mensual',wldPrev.monthly]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace',fontSize:13}}>{v}</span></div>)}</div>
          {(()=>{
            const now_ts = Math.floor(Date.now()/1000)
            const activeEliteCount = wldLics.filter(({l}:any) => Number(l[1])===3 && l[10] && Number(l[7])>now_ts).length
            const eliteLocked = selWLD===3 && activeEliteCount>=3
            return <button onClick={buyWLD} disabled={!connected||wldHachi>MAX_HACHI||licsAvailNum<=0||eliteLocked} style={{...btnP,width:'100%',opacity:(!connected||wldHachi>MAX_HACHI||licsAvailNum<=0||eliteLocked)?0.4:1}}>{wldHachi>MAX_HACHI?'⚠ Ventas pausadas':licsAvailNum<=0?'Sin stock disponible':eliteLocked?'Ya tenés 3 Elite activas (máximo)':`Comprar · ${wldPrices[selWLD]}`}</button>
          })()}
        </div>}

        {tab==='bocado'&&<div>
          {wldTierActive===255&&<div style={{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.35)',borderRadius:8,padding:20,textAlign:'center',marginBottom:12}}>
            <div style={{fontSize:28,marginBottom:8}}>🔒</div>
            <div style={{fontWeight:700,color:'#f87171',marginBottom:6}}>Necesitás una licencia WLD activa</div>
            <div style={{fontSize:13,color:'#8b949e'}}>El Bocado ya no está disponible para quienes no tienen una licencia WLD.</div>
          </div>}
          {wldTierActive!==255&&<>
            <div style={{...sLabel,display:'flex',alignItems:'center',gap:10}}><img src="/hachi-cat-savings.png" alt="" width={88} height={88} style={{borderRadius:14,flexShrink:0,objectFit:'cover',boxShadow:'0 0 18px rgba(124,58,237,.35)'}} />Convertí tus HACHI en Bocado</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              <div onClick={()=>setSelSUSHI(0)} style={{...lCard,border:`1px solid ${selSUSHI===0?'#fbbf24':'#5b21b6'}`,background:selSUSHI===0?'rgba(251,191,36,.08)':'#1e0840',cursor:'pointer'}}>
                <div style={{fontSize:11,fontWeight:700}}>{sushiNames[0]}</div>
                <div style={{fontFamily:'monospace',fontSize:18,fontWeight:700,color:'#34d399'}}>{fmt(Math.round(500*hachiSushi*1.25))}</div>
                <div style={{fontSize:10,color:'#8b949e'}}>SUSHI inmediato ×1.25</div>
                <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginTop:6}}>{sushiPrices[0]}</div>
              </div>
            </div>
            <div style={pBox}>{[['Tipo',sushiNames[selSUSHI]],['Precio',sushiPrices[selSUSHI]],['SUSHI base',sushiPrev.base],['Bonus inmediato','+25%'],['Recibís al instante (×1.25)',sushiPrev.total]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace',fontSize:13}}>{v}</span></div>)}</div>
            {(()=>{
              const poolEmpty = !(poolsData.poolAFreeNum > 0)
              const maxBasicNow = wldTierActive===255?0:wldTierActive===0?1:wldTierActive===1?2:wldTierActive===2?3:4
              const dailyLimitHit = selSUSHI===0 && basicBoughtToday >= maxBasicNow
              const disabled = poolEmpty || dailyLimitHit
              const label = poolEmpty ? '⏳ En pausa por ahora' : dailyLimitHit ? '🚫 Límite diario alcanzado, volvé mañana' : `Comprar · ${sushiPrices[selSUSHI]}`
              return <>
                {poolEmpty && <div style={{background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c4b5fd',lineHeight:1.6}}>
                  <strong>🐱 Bocado en pausa por ahora</strong>
                  <br/><br/>
                  La plataforma de SUSHI está teniendo problemas técnicos externos a nosotros — no es algo de nuestro contrato ni de la app. Ellos mismos informaron que ya están trabajando en solucionarlo.
                  <br/><br/>
                  Mientras tanto, ponemos Bocado en pausa para cuidar el sistema. Apenas se resuelva (o encontremos una alternativa mejor), lo reactivamos y avisamos acá mismo.
                </div>}
                <button onClick={buySUSHI} disabled={disabled} style={{...btnG, opacity: disabled?0.5:1, cursor: disabled?'not-allowed':'pointer'}}>{label}</button>
              </>
            })()}
            {(()=>{
              const maxBasic = wldTierActive===255?0:wldTierActive===0?1:wldTierActive===1?2:wldTierActive===2?3:4
              const limitReached = basicBoughtToday >= maxBasic
              return (
                <div style={{background:'rgba(124,58,237,.08)',border:'1px solid #5b21b6',borderRadius:8,padding:12,marginTop:12,fontSize:12,textAlign:'center',fontWeight:700,color:limitReached?'#f87171':'#8b949e'}}>
                  {limitReached ? `🚫 Límite alcanzado — ${basicBoughtToday}/${maxBasic} Bocados cada 24 horas` : `${basicBoughtToday}/${maxBasic} Bocados disponibles hoy`}
                </div>
              )
            })()}
            <div style={{background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.3)',borderRadius:8,padding:12,marginTop:12,fontSize:12,color:'#8b949e',lineHeight:1.5}}>
              <strong style={{color:'#34d399'}}>Intercambio inmediato:</strong> pagás en HACHI y recibís SUSHI (base + 25%) al instante en tu wallet. Sin esperas ni cobros pendientes.
            </div>
          </>}
        </div>}

        {tab==='mineria'&&<div>
          <div style={sLabel}>⛏️ Minería</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:12}}>
            {[
              {icon:'📜',label:'Hachi Miner',action:()=>loadTab('lics'),iconImg:'/hachi-logo.png'},
              {icon:'🍡',label:'Bocado',action:()=>loadTab('bocado'),iconImg:'/hachi-cat-savings.png'},
              {icon:'⛏️',label:'WLD Miner',action:()=>loadTab('wldminer')},
            ].map(btn=><button key={btn.label} onClick={btn.action} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,padding:'16px 8px',borderRadius:12,border:'1px solid #5b21b6',background:'linear-gradient(135deg,#2d1b69,#1e0840)',color:'#e6edf3',cursor:'pointer'}}>
              {(btn as any).iconImg ? <img src={(btn as any).iconImg} alt="" width={26} height={26} style={{borderRadius:13,objectFit:'cover'}} /> : <span style={{fontSize:26}}>{btn.icon}</span>}
              <span style={{fontSize:12,fontWeight:600}}>{btn.label}</span>
            </button>)}
          </div>
        </div>}

          {tab==='centrohachi'&&<div>
            <div style={sLabel}>🎯 Centro Hachi</div>
            <div style={{fontSize:11,color:'#8b949e',textAlign:'center',marginBottom:12,lineHeight:1.5}}>
              Todo lo que tenés disponible para reclamar o usar, en un solo lugar.
            </div>
            {(()=>{
              const wldLicsPendTotal = wldLics.reduce((acc:number,l:any)=>acc+Number(fe(l.pend||BigInt(0))),0)
              const maxBasicCH = wldTierActive===255?0:wldTierActive===0?1:wldTierActive===1?2:wldTierActive===2?3:4
              const bocadoDisponible = Math.max(0, maxBasicCH - basicBoughtToday)
              const lockPendNum = parseFloat(lockData.pending) || 0
              const fmtSecsCH = (s:number) => { const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600); return d>0?`${d}d ${h}h`:`${h}h` }
              const msUntilMidnightUTC = new Date().setUTCHours(24,0,0,0) - Date.now()
              const bocadoResetIn = fmtSecsCH(Math.floor(msUntilMidnightUTC/1000))

              const items = [
                { key:'wldlics', iconImg:'/hachi-logo.png', label:'Hachi Miner (Licencias WLD)', valor: wldLicsPendTotal>0.01 ? `${wldLicsPendTotal.toFixed(2)} HACHI` : null, pendiente: 'Sin nada acumulado todavía', disponibleAhora:true, tieneInversion: wldLics.length>0, claimFn: claimAllWLD },
                { key:'wldminer', icon:'⛏️', label:'WLD Miner', valor: (wldMiner.pendingHachi>0.01||wldMiner.pendingDrachma>0.01) ? `${wldMiner.pendingHachi.toFixed(2)} HACHI + ${wldMiner.pendingDrachma.toFixed(2)} Drachma` : null, pendiente: 'Sin nada acumulado todavía', disponibleAhora:true, tieneInversion: wldMiner.tier!==255, claimFn: claimWldMinerAction },
                { key:'lock', icon:'🔒', label:'Lock (APY)', valor: lockPendNum>0.01 ? `${lockData.pending} HACHI` : null, pendiente: lockData.nextClaimIn!=='—' ? `Disponible en ${lockData.nextClaimIn}` : 'Sin nada acumulado todavía', disponibleAhora: lockData.nextClaimIn==='—', tieneInversion: parseFloat(lockData.total)>0, claimFn: claimAPY },
                { key:'bocado', iconImg:'/hachi-cat-savings.png', label:'Bocado disponible hoy', valor: bocadoDisponible>0 ? `${bocadoDisponible} disponible${bocadoDisponible>1?'s':''}` : null, pendiente: `Se resetea en ${bocadoResetIn}`, disponibleAhora:false, tieneInversion: wldTierActive!==255, action:()=>loadTab('bocado') },
                { key:'reinversion', icon:'💎', label:'Reinversión VIP', valor: vipData.pendingHachi>0.01 ? `${vipData.pendingHachi.toFixed(2)} HACHI acumulado` : null, pendiente: 'Sin nada acumulado todavía', disponibleAhora:true, tieneInversion: vipData.level!==255, action:()=>loadTab('lock') },
                { key:'semanal', icon:'📅', label:'Bono Semanal', valor: weeklyBonus.pending>0.01 ? `${weeklyBonus.pending.toFixed(2)} SUSHI` : null, pendiente: weeklyBonus.secondsUntilNext>0 ? `Disponible en ${fmtSecsCH(weeklyBonus.secondsUntilNext)}` : 'Sin nada acumulado todavía', disponibleAhora: weeklyBonus.secondsUntilNext<=0, tieneInversion: weeklyBonus.dailyRate>0, claimFn: claimWeeklyBonus },
              ]

              return <>
                {items.map(i=>{
                  const tieneAlgo = !!i.valor
                  const puedeReclamarYa = tieneAlgo && (i as any).disponibleAhora
                  const colorBoton = puedeReclamarYa ? '#3fb950' : (i as any).tieneInversion ? '#fbbf24' : '#f87171'
                  return <div key={i.key} style={{...card,display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 14px',marginBottom:12,gap:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:12,flex:'1 1 auto',minWidth:0}}>
                      {(i as any).iconImg ? <img src={(i as any).iconImg} alt="" width={28} height={28} style={{borderRadius:14,objectFit:'cover',flexShrink:0}} /> : <span style={{fontSize:28,flexShrink:0}}>{(i as any).icon}</span>}
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,color:'#8b949e',marginBottom:3}}>{i.label}</div>
                        <div style={{fontSize:15,fontWeight:700,color:'#e6edf3'}}>{(i as any).disponibleAhora ? (i.valor || i.pendiente) : i.pendiente}</div>
                      </div>
                    </div>
                    <button onClick={()=> (i as any).claimFn ? ((i as any).disponibleAhora && (i as any).claimFn()) : (i as any).action()} disabled={!(i as any).action && !((i as any).disponibleAhora)} style={{flex:'0 0 auto',width:64,padding:'6px 4px',fontSize:10,fontWeight:700,borderRadius:8,border:`1px solid ${colorBoton}`,background:colorBoton,color:'#1e0840',cursor:(!(i as any).action && !((i as any).disponibleAhora))?'not-allowed':'pointer',opacity:(!(i as any).action && !((i as any).disponibleAhora))?0.6:1}}>{(i as any).claimFn?'Reclamar':'Ir'}</button>
                  </div>
                })}
              </>
            })()}
          </div>}

        {tab==='lock'&&<div>
          <div style={card}><div style={cTitle}>Tu posición</div>
            <div style={{display:'flex',alignItems:'baseline',gap:8,margin:'8px 0 12px'}}>
              <div style={{fontSize:24,fontWeight:700,fontFamily:'monospace',color:'#34d399'}}>{lockData.pending}</div>
              <div style={{fontSize:12,color:'#8b949e'}}>HACHI APY pendiente</div>
            </div>
            {[['Total lockeado',lockData.total],['Tier',lockData.tier],['APY anual',lockData.apy],['Próximo cobro en',lockData.nextClaimIn]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e'}}>{l}</span><span style={{fontFamily:'monospace',fontWeight:600}}>{v}</span></div>)}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
            <button onClick={claimAPY} disabled={lockData.nextClaimIn!=='—'} style={{...btnG,opacity:lockData.nextClaimIn!=='—'?0.4:1}}>{lockData.nextClaimIn!=='—'?`Disponible en ${lockData.nextClaimIn}`:'Cobrar APY'}</button>
            <button onClick={doUnstake} style={btnGh}>Retirar HACHI</button>
          </div>
          <div style={sLabel}>Depositar HACHI</div>
          <input value={depositAmt} onChange={e=>setDepositAmt(e.target.value)} type="number" placeholder="Cantidad de HACHI" style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:14,color:'#e6edf3',width:'100%',marginBottom:8,fontFamily:'monospace'}} />
          <div style={{fontSize:11,color:'#d29922',marginBottom:8,lineHeight:1.4}}>⚠ Depositar reinicia el cooldown de 24h para cobrar APY</div>
          <button onClick={doDeposit} style={btnP}>Depositar</button>
          <button onClick={()=>setShowInfoTiers(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'8px 12px',cursor:'pointer',margin:'8px 0',width:'100%'}}>ℹ️ Niveles del Lock — Saber más</button>
          {showInfoTiers&&<div style={{...card,marginTop:0}}>
            <div style={{fontSize:11,color:'#8b949e',marginBottom:10,lineHeight:1.5}}>Con menos de 50,000 HACHI bloqueados (Sin tier) accedés a las licencias Bocado Básicas, pero no generás APY. Desde 50,000 HACHI (Tier 1 — Akira) empezás a ganar rendimiento. Desde 250,000 HACHI además accedés a la Reinversión VIP.</div>
            {[{name:'Akira',min:'50,000',apy:'10%',vip:null},{name:'Zen',min:'200,000',apy:'20%',vip:null},{name:'Koban',min:'500,000',apy:'30%',vip:'8%'},{name:'Tayko',min:'750,000',apy:'40%',vip:'10%'},{name:'Hachi',min:'1,000,000',apy:'50%',vip:'12%'}].map(({name,min,apy,vip})=>{
              const isCurrent = lockData.tier === name
              return <div key={name} style={{padding:'7px 6px',borderRadius:6,marginBottom:2,background:isCurrent?'rgba(52,211,153,.08)':'transparent',border:isCurrent?'1px solid rgba(52,211,153,.3)':'1px solid transparent'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:13,fontWeight:isCurrent?700:400,color:isCurrent?'#34d399':'#8b949e'}}>{isCurrent?'→ ':''}{name}</span>
                  <span style={{fontFamily:'monospace',fontSize:11,color:'#8b949e'}}>{min} HACHI</span>
                  <span style={{fontFamily:'monospace',fontSize:12,fontWeight:600,color:isCurrent?'#fbbf24':'#6b7280'}}>{apy} APY</span>
                </div>
                {vip&&<div style={{fontSize:10,color:'#fbbf24',marginTop:2,textAlign:'right'}}>💎 +{vip} bono en Reinversión VIP</div>}
                {name==='Zen'&&<div style={{fontSize:10,color:'#8b949e',marginTop:2,textAlign:'right'}}>Con 250,000+ (dentro de este nivel): 5% bono en Reinversión VIP</div>}
              </div>
            })}
          </div>}
          <button onClick={()=>setShowDeposits(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'8px 12px',cursor:'pointer',margin:'8px 0',width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>📦 Mis depósitos ({lockBatches.length})</span>
            <span>{showDeposits?'▲':'▼'}</span>
          </button>
          {showDeposits&&(lockBatches.length===0?<div style={empty}><div>Sin depósitos aún</div></div>:lockBatches.map((b,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #3b0764',fontSize:12}}><span style={{fontFamily:'monospace'}}>{fmt(b.amount)} HACHI</span><span style={{color:b.ready?'#3fb950':'#8b949e'}}>{b.ready?'✓ Disponible':'Hasta '+b.unlocks.toLocaleDateString()}</span></div>))}

          <div style={{...card,marginTop:12,border:'1px solid #fbbf24',boxShadow:'0 0 16px rgba(251,191,36,.2)'}}>
            <div style={{...cTitle,display:'flex',alignItems:'center',gap:6}}>💎 Reinversión VIP</div>
            <div style={{background:'rgba(52,211,153,.1)',border:'1px solid rgba(52,211,153,.4)',borderRadius:8,padding:12,marginTop:8,marginBottom:4,fontSize:12,color:'#6ee7b7',lineHeight:1.5,textAlign:'center'}}>
              ✅ <strong>¡Ya disponible!</strong> Por ahora solo podés cambiar tus ganancias por SUSHI (el pool de Drachma todavía no se cargó).
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#8b949e',marginBottom:8,padding:'0 2px'}}>
              <span>Pool Drachma: <strong style={{color:'#60a5fa'}}>{vipData.drachmaPoolFree.toFixed(0)}</strong></span>
              <span>Pool SUSHI: <strong style={{color:'#a78bfa'}}>{vipData.sushiPoolFree.toFixed(0)}</strong></span>
            </div>
            <button onClick={()=>setShowInfoVip(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',margin:'8px 0',width:'100%'}}>ℹ️ ¿Qué es y cómo funciona?</button>
            {showInfoVip&&<div style={{background:'rgba(251,191,36,.08)',border:'1px solid rgba(251,191,36,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#fde68a',lineHeight:1.6}}>
              <strong>Es un beneficio exclusivo para holders grandes</strong> — con 250,000+ HACHI lockeados, en vez de vender el HACHI que vas generando por APY, lo cambiás acá directo por Drachma o SUSHI, con un bono extra según tu nivel:
              <br/>• 250,000 - 499,999: <strong>5%</strong> de bono
              <br/>• 500,000 - 749,999: <strong>8%</strong> de bono
              <br/>• 750,000 - 999,999: <strong>10%</strong> de bono
              <br/>• 1,000,000+: <strong>12%</strong> de bono
              <br/><br/>
              El HACHI que vas generando se acumula solo (calculado en vivo desde tu Lock), hasta un tope de <strong>4 semanas</strong> — no se pierde mientras no lo uses, y podés cambiarlo cuando quieras.
              <br/><br/>
              Elegís si preferís recibir Drachma o SUSHI; si ese pool no tiene fondos en ese momento, usa el otro automáticamente. El HACHI que aportás ayuda a financiar licencias WLD para el resto de la comunidad — así tu ganancia sigue generando valor para el sistema, en vez de salir a la venta.
            </div>}
            {!vipData.loaded?<div style={{textAlign:'center',padding:'12px 8px',color:'#8b949e',fontSize:13}}>⏳ Consultando tu Lock...</div>:vipData.level===255?<div style={{textAlign:'center',padding:'12px 8px',color:'#8b949e',fontSize:13}}>🔒 Necesitás al menos 250,000 HACHI lockeados para acceder</div>:<>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Tu nivel</span><span style={{fontFamily:'monospace',fontWeight:700,color:'#fbbf24'}}>{['5% bono','8% bono','10% bono','12% bono'][vipData.level]}</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>HACHI acumulado</span><span style={{fontFamily:'monospace'}}>{vipData.pendingHachi.toFixed(4)}</span></div>
              {(()=>{
                const drachmaLocked = vipData.drachmaOut > vipData.drachmaPoolFree
                const sushiLocked = vipData.sushiOut > vipData.sushiPoolFree
                return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,margin:'10px 0'}}>
                  <div onClick={()=>{if(!drachmaLocked) setVipPreferredToken(0)}} style={{...lCard,padding:10,border:`1px solid ${vipPreferredToken===0&&!drachmaLocked?'#fbbf24':'#5b21b6'}`,background:vipPreferredToken===0&&!drachmaLocked?'rgba(251,191,36,.08)':'#1e0840',cursor:drachmaLocked?'not-allowed':'pointer',textAlign:'center',opacity:drachmaLocked?0.4:1}}>
                    <div style={{fontSize:11,color:'#8b949e'}}>Drachma</div>
                    <div style={{fontFamily:'monospace',fontWeight:700,color:'#60a5fa'}}>{vipData.drachmaOut.toFixed(2)}</div>
                    {drachmaLocked&&<div style={{fontSize:9,color:'#f87171',marginTop:2}}>Sin fondos</div>}
                  </div>
                  <div onClick={()=>{if(!sushiLocked) setVipPreferredToken(1)}} style={{...lCard,padding:10,border:`1px solid ${vipPreferredToken===1&&!sushiLocked?'#fbbf24':'#5b21b6'}`,background:vipPreferredToken===1&&!sushiLocked?'rgba(251,191,36,.08)':'#1e0840',cursor:sushiLocked?'not-allowed':'pointer',textAlign:'center',opacity:sushiLocked?0.4:1}}>
                    <div style={{fontSize:11,color:'#8b949e'}}>SUSHI</div>
                    <div style={{fontFamily:'monospace',fontWeight:700,color:'#a78bfa'}}>{vipData.sushiOut.toFixed(2)}</div>
                    {sushiLocked&&<div style={{fontSize:9,color:'#f87171',marginTop:2}}>Sin fondos</div>}
                  </div>
                </div>
              })()}
              <button onClick={exchangeVipAction} disabled={exchangingVip||vipData.pendingHachi<=0} style={{...btnP,width:'100%',opacity:(exchangingVip||vipData.pendingHachi<=0)?0.4:1}}>{exchangingVip?'Cambiando...':vipData.pendingHachi<=0?'Nada acumulado todavía':'Cambiar ahora'}</button>
            </>}
          </div>
        </div>}

        {tab==='wldminer'&&<div>
          <div style={{marginBottom:8}}>
            <span style={sLabel}>⛏️ WLD Miner</span>
          </div>
          <button onClick={()=>setShowInfoWldMiner(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',marginBottom:10,width:'100%'}}>ℹ️ ¿Cómo funciona?</button>
          {showInfoWldMiner&&<div style={{background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c4b5fd',lineHeight:1.6}}>
            Pagás WLD y recibís HACHI + Drachma combinados (70%/30%), generados de a poco durante el plazo que elijas. Cuanto más largo el plazo, mayor el retorno.
            <br/><br/>
            El tope de WLD que podés invertir depende de tu licencia WLD o Lock (el que sea más alto). Solo podés tener <strong>1 minería activa a la vez</strong>.
          </div>}
          {!wldMiner.loaded?<div style={empty}><div style={{fontSize:28}}>⏳</div><div>Consultando tu licencia y Lock...</div></div>:wldMiner.tier===255?<div style={empty}><div style={{fontSize:28}}>🔒</div><div>Necesitás una licencia WLD o Lock activo para acceder</div></div>:<>
            {(()=>{
              const nowSecsWld = Math.floor(Date.now()/1000)
              const wldReallyActive = wldMiner.active && (nowSecsWld < wldMiner.endTime || wldMiner.pendingHachi > 0.01 || wldMiner.pendingDrachma > 0.01)

              return <>
                {wldReallyActive && <div style={card}>
                  <div style={cTitle}>Tu minería activa</div>
                  <div style={row}><span style={{color:'#8b949e',fontSize:12}}>HACHI total / reclamado</span><span style={{fontFamily:'monospace'}}>{wldMiner.hachiTotal.toFixed(2)} / <span style={{color:'#3fb950'}}>{wldMiner.hachiClaimed.toFixed(2)}</span></span></div>
                  <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Drachma total / reclamado</span><span style={{fontFamily:'monospace'}}>{wldMiner.drachmaTotal.toFixed(2)} / <span style={{color:'#3fb950'}}>{wldMiner.drachmaClaimed.toFixed(2)}</span></span></div>
                  <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Liberados HACHI</span><span style={{fontFamily:'monospace',color:'#3fb950'}}>{wldMiner.pendingHachi.toFixed(2)}</span></div>
                  <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Liberados Drachma</span><span style={{fontFamily:'monospace',color:'#60a5fa'}}>{wldMiner.pendingDrachma.toFixed(2)}</span></div>
                  {(()=>{
                    const durDias = wldMinerVariants[wldMiner.variant]?.days || 0
                    const startTime = wldMiner.endTime - durDias*86400
                    const nowSecs = Math.floor(Date.now()/1000)
                    const diasRestantes = Math.max(0, Math.ceil((wldMiner.endTime - nowSecs) / 86400))
                    return <>
                      <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Fecha de inicio</span><span style={{fontFamily:'monospace'}}>{new Date(startTime*1000).toLocaleDateString()}</span></div>
                      <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Fecha de término</span><span style={{fontFamily:'monospace'}}>{new Date(wldMiner.endTime*1000).toLocaleDateString()}</span></div>
                      <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Duración</span><span style={{fontFamily:'monospace'}}>{durDias} días</span></div>
                      <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Te quedan</span><span style={{fontFamily:'monospace',color:diasRestantes<=0?'#3fb950':'#fbbf24',fontWeight:700}}>{diasRestantes<=0?'Terminada — reclamá el saldo':`${diasRestantes} días minando`}</span></div>
                    </>
                  })()}
                  <button onClick={claimWldMinerAction} disabled={claimingWldMiner||(wldMiner.pendingHachi<=0&&wldMiner.pendingDrachma<=0)} style={{...btnG,marginTop:8,opacity:(wldMiner.pendingHachi>0||wldMiner.pendingDrachma>0)?1:0.4}}>{claimingWldMiner?'Reclamando...':'Reclamar'}</button>
                </div>}

                <button onClick={()=>setShowWldHistory(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',marginTop:12,marginBottom:10,width:'100%'}}>📜 Minerías terminadas</button>
                {showWldHistory&&<div style={{background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c9d1d9',lineHeight:1.6}}>
                  {wldMinerHistory.filter(h=>h.done).length===0?<div style={{textAlign:'center',color:'#8b949e'}}>Todavía no tenés ninguna minería terminada.</div>:wldMinerHistory.filter(h=>h.done).map(h=>(
                    <div key={h.contrato+h.id} style={{padding:'6px 0',borderBottom:'1px solid #3b0764'}}>
                      <div style={{display:'flex',justifyContent:'space-between'}}><span>✓ Mina #{h.id} ({h.contrato})</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#8b949e'}}><span>Pagaste</span><span style={{fontFamily:'monospace'}}>{h.wldPaid.toFixed(2)} WLD</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><span style={{color:'#8b949e'}}>Recibiste</span><span style={{fontFamily:'monospace',color:'#3fb950'}}>{h.hachiTotal.toFixed(2)} HACHI + {h.drachmaTotal.toFixed(2)} Drachma</span></div>
                    </div>
                  ))}
                </div>}

                {!wldReallyActive && <div style={card}>
                  <div style={{fontSize:12,color:'#8b949e',marginBottom:8}}>Tu tope máximo: <strong style={{color:'#fbbf24'}}>{wldMiner.cap.toFixed(2)} WLD</strong></div>
                  <div style={{background:'rgba(248,113,113,.1)',border:'1px solid rgba(248,113,113,.4)',borderRadius:8,padding:'8px 10px',marginBottom:10,fontSize:11,color:'#f87171',fontWeight:600,textAlign:'center'}}>⚠️ Solo podés tener 1 minería activa a la vez</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:10}}>
                    {wldMinerVariants.map(({days,pct},i)=>[`${days} días`, `${pct}%`]).map(([d,r],i)=>
                      <div key={i} onClick={()=>{setSelWldVariant(i); previewWldMine(i)}} style={{...lCard,padding:8,border:`1px solid ${selWldVariant===i?'#fbbf24':'#5b21b6'}`,background:selWldVariant===i?'rgba(251,191,36,.08)':'#1e0840',cursor:'pointer'}}>
                        <div style={{fontSize:11,fontWeight:700}}>{d}</div>
                        <div style={{fontSize:14,fontWeight:700,color:'#34d399'}}>{r}</div>
                      </div>
                    )}
                  </div>
                  <input type="number" value={selWldAmount} onChange={e=>setSelWldAmount(e.target.value)} onBlur={()=>previewWldMine()} placeholder="Cantidad de WLD" style={{width:'100%',padding:10,borderRadius:8,border:'1px solid #5b21b6',background:'#1e0840',color:'#e6edf3',fontSize:14,marginBottom:10}} />
                  {(wldMinerPreview.hachi>0||wldMinerPreview.drachma>0)&&<div style={{...pBox,marginBottom:10}}>
                    <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Recibirías (HACHI)</span><span style={{fontFamily:'monospace',color:'#3fb950'}}>{wldMinerPreview.hachi.toFixed(4)}</span></div>
                    <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Recibirías (Drachma)</span><span style={{fontFamily:'monospace',color:'#60a5fa'}}>{wldMinerPreview.drachma.toFixed(4)}</span></div>
                  </div>}
                  <button onClick={mineWldAction} disabled={!connected||miningWld} style={{...btnP,opacity:(!connected||miningWld)?0.4:1}}>{miningWld?'Minando...':'Minar'}</button>
                </div>}

                <div style={{fontSize:10,color:'#8b949e',textAlign:'center',marginTop:12}}>Pools: {wldMiner.poolFreeHachi.toFixed(2)} HACHI / {wldMiner.poolFreeDrachma.toFixed(2)} Drachma</div>
              </>
            })()}
          </>}
        </div>}

        {tab==='voting'&&<div>
          <div style={sLabel}>🗳️ Votación — Partido Hachi en World Republic</div>
          <div style={card}>
            {(()=>{
              const open = isVotingOpen()
              const secs = open ? 0 : secondsUntilNextVoting()
              const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600)
              return <div style={{textAlign:'center',marginBottom:12}}>
                <div style={{fontSize:14,fontWeight:800,color:open?'#3fb950':'#e6edf3',marginBottom:4}}>{open?'✓ Votación abierta ahora mismo':'⏳ Próxima votación'}</div>
                {!open&&<div style={{fontSize:12,color:'#8b949e'}}>Faltan <strong style={{color:'#fbbf24'}}>{d}d {h}h</strong></div>}
              </div>
            })()}
            <div style={{background:'rgba(124,58,237,.08)',border:'1px solid #5b21b6',borderRadius:8,padding:12,marginBottom:12,fontSize:12,color:'#c4b5fd',lineHeight:1.6}}>
              🎁 <strong>10,000 SUSHI</strong> a repartir entre quienes voten por el Partido Hachi, y <strong>5,000 SUSHI</strong> entre quienes reaccionen a HACHI en DexScreener.
              <br/><br/>
              ⚠️ Solo se acepta el <strong>link</strong> que te da la propia plataforma al tocar "Compartir" — es el único válido. Las capturas de pantalla <strong>no</strong> se aceptan. Mandanos tu link por WhatsApp para que quede registrado.
            </div>
            <div style={{fontSize:11,color:'#8b949e',marginBottom:12,lineHeight:1.6}}>
              La votación se abre todas las semanas, de <strong>jueves 20:00</strong> a <strong>domingo 19:59</strong> (hora de Chile / GMT-4).
            </div>
            <a href="https://www.worldrepublic.org/es/govern/parties/1f9bc8d0-9ae5-46fe-b6e1-0282cb782c41?ref=GEFSRZRZ" target="_blank" rel="noopener noreferrer" style={{display:'block',textAlign:'center',background:'linear-gradient(135deg,#7c3aed,#a78bfa)',color:'#fff',fontSize:13,fontWeight:700,padding:'11px 20px',borderRadius:10,textDecoration:'none',boxShadow:'0 0 16px rgba(124,58,237,.4)',marginBottom:10}}>Ir al Partido Hachi →</a>
            <div style={{display:'flex',gap:8}}>
              <a href="https://whatsapp.com/channel/0029Vb7aycxDjiOasgPK2k1h" target="_blank" rel="noopener noreferrer" style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px 8px',borderRadius:10,background:'linear-gradient(135deg,#25D366,#128C7E)',color:'#fff',fontSize:12,fontWeight:700,textDecoration:'none'}}><img src="https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg" alt="" width={16} height={16} style={{filter:'brightness(0) invert(1)'}} />Canal Oficial</a>
              <a href="https://t.me/+mg3Tt_4pZJs4NTAx" target="_blank" rel="noopener noreferrer" style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'9px 8px',borderRadius:8,border:'1px solid #229ED9',color:'#229ED9',fontSize:12,fontWeight:600,textDecoration:'none'}}><img src="https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/telegram.svg" alt="" width={16} height={16} style={{filter:'invert(52%) sepia(89%) saturate(1996%) hue-rotate(166deg) brightness(97%) contrast(96%)'}} />Telegram</a>
              <a href="https://hachiminnerworld.netlify.app/transparencia" target="_blank" rel="noopener noreferrer" style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'9px 8px',borderRadius:8,border:'1px solid #a78bfa',color:'#a78bfa',fontSize:12,fontWeight:600,textDecoration:'none'}}>📊 Transparencia</a>
            </div>
          </div>
        </div>}

        {tab==='drachmaminer'&&<div>
          <div style={sLabel}>🪙 Drachma Miner</div>
          {drachmaMiner.activeMineId===0 && drachmaMiner.contractAddr===DRACHMA_MINER_ADDR_OLD && <div style={{background:'linear-gradient(135deg,#fbbf24,#f59e0b)',borderRadius:10,padding:14,marginBottom:12,textAlign:'center',boxShadow:'0 0 16px rgba(251,191,36,.5)'}}>
            <div style={{fontSize:14,fontWeight:800,color:'#1e0840'}}>🎁 ¡Conseguí tu primera minería Drachma y ganá 10,000 SUSHI!</div>
            <div style={{fontSize:11,color:'#1e0840',marginTop:4,lineHeight:1.4}}>Solo por tiempo limitado, hasta agotar el pool. El bono se paga de forma manual los días <strong>5 y 10 de agosto</strong>.</div>
          </div>}
          <div style={{fontSize:10,color:'#8b949e',marginBottom:8,textAlign:'right'}}>Pool disponible: {drachmaMiner.poolFree.toFixed(2)} Drachma</div>
          <button onClick={()=>setShowInfoDrachma(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',marginBottom:10,width:'100%'}}>ℹ️ ¿Cómo funciona el Drachma Miner?</button>
          {showInfoDrachma&&<div style={{background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c4b5fd',lineHeight:1.6}}>
            Con una licencia WLD activa o un Lock de al menos 50,000 HACHI, podés "minar" Drachma: elegís un nivel (según tu tier más alto) y pagás HACHI por un monto fijo de Drachma, con un descuento sobre el precio real de mercado.
            <br/><br/>
            El Drachma no llega de golpe — se genera de a poco durante {drachmaMiner.durationDays} días, y lo vas reclamando cuando quieras con el botón "Reclamar Drachma".
            <br/><br/>
            Solo podés tener <strong>1 minería activa a la vez</strong> — cuando termine de generarse del todo, podés arrancar una nueva.
          </div>}
          <button onClick={()=>setShowDrachmaHistory(v=>!v)} style={{background:'none',border:'1px solid #5b21b6',borderRadius:8,color:'#a78bfa',fontSize:12,padding:'6px 12px',cursor:'pointer',marginBottom:10,width:'100%'}}>📜 Minerías terminadas</button>
          {showDrachmaHistory&&<div style={{background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.35)',borderRadius:8,padding:14,marginBottom:12,fontSize:12,color:'#c9d1d9',lineHeight:1.6}}>
            {drachmaMinerHistory.filter(h=>h.done).length===0?<div style={{textAlign:'center',color:'#8b949e'}}>Todavía no tenés ninguna minería terminada.</div>:drachmaMinerHistory.filter(h=>h.done).map(h=>(
              <div key={h.contrato+h.id} style={{padding:'6px 0',borderBottom:'1px solid #3b0764'}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><span>✓ Mina #{h.id} ({h.contrato})</span></div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#8b949e'}}><span>Pagaste</span><span style={{fontFamily:'monospace'}}>{h.hachiPaid.toFixed(2)} HACHI</span></div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><span style={{color:'#8b949e'}}>Recibiste</span><span style={{fontFamily:'monospace',color:'#3fb950'}}>{h.drachmaTotal.toFixed(2)} Drachma</span></div>
              </div>
            ))}
          </div>}
          {!drachmaMiner.loaded?<div style={empty}><div style={{fontSize:28}}>⏳</div><div>Consultando tu licencia y Lock...</div></div>:drachmaMiner.tier===255?<div style={empty}><div style={{fontSize:28}}>🔒</div><div>Necesitás una licencia WLD o Lock activo para acceder</div></div>:<>
            <div style={card}>
              <div style={cTitle}>Tu tier: {['Básica','Estándar','Premium','Elite'][drachmaMiner.tier]}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12,marginTop:8}}>
                {['Básica','Estándar','Premium','Elite'].map((n,i)=>{
                  const locked = i > drachmaMiner.tier
                  return <div key={i} onClick={()=>{if(!locked) setSelDrachmaTier(i)}} style={{...lCard,border:`1px solid ${selDrachmaTier===i?'#fbbf24':'#5b21b6'}`,background:selDrachmaTier===i?'rgba(251,191,36,.08)':'#1e0840',opacity:locked?0.35:1,cursor:locked?'not-allowed':'pointer'}}>
                    <div style={{fontSize:11,fontWeight:700}}>{n}</div>
                    <div style={{fontFamily:'monospace',fontSize:16,fontWeight:700,color:'#60a5fa'}}>{drachmaMiner.amounts[i].toFixed(2)} Drachma</div>
                    <div style={{fontSize:10,color:'#8b949e'}}>Costo: {drachmaMiner.costs[i].toFixed(4)} HACHI</div>
                  </div>
                })}
              </div>
              <div style={{background:'rgba(52,211,153,.1)',border:'1px solid rgba(52,211,153,.4)',borderRadius:8,padding:10,marginBottom:10,textAlign:'center',fontSize:12,color:'#6ee7b7',fontWeight:700}}>
                🟢 <strong>7 días</strong> de duración durante todo agosto (promo del mes)
              </div>
              {(()=>{
                const nowSecsDm = Math.floor(Date.now()/1000)
                const drachmaReallyActive = drachmaMiner.active && (nowSecsDm < drachmaMiner.endTime || drachmaMiner.pending > 0.01)
                return <button onClick={mineDrachmaAction} disabled={!connected||drachmaReallyActive} style={{...btnP,opacity:(!connected||drachmaReallyActive)?0.4:1}}>{drachmaReallyActive?'Ya tenés una mina activa':`Pagás ${drachmaMiner.costs[selDrachmaTier].toFixed(4)} HACHI → recibís ${drachmaMiner.amounts[selDrachmaTier].toFixed(2)} Drachma`}</button>
              })()}
            </div>
            {drachmaMiner.active&&(Math.floor(Date.now()/1000)<drachmaMiner.endTime||drachmaMiner.pending>0.01)&&<div style={{...card,marginTop:12}}>
              <div style={cTitle}>Tu minería activa</div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Total</span><span style={{fontFamily:'monospace'}}>{drachmaMiner.drachmaTotal.toFixed(2)} Drachma</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Ya reclamado</span><span style={{fontFamily:'monospace'}}>{drachmaMiner.drachmaClaimed.toFixed(2)} Drachma</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Pendiente ahora</span><span style={{fontFamily:'monospace',color:'#3fb950'}}>{drachmaMiner.pending.toFixed(2)} Drachma</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Termina</span><span style={{fontFamily:'monospace'}}>{new Date(drachmaMiner.endTime*1000).toLocaleDateString()}</span></div>
              <button onClick={claimDrachmaMineAction} disabled={drachmaMiner.pending<=0} style={{...btnG,marginTop:8,opacity:drachmaMiner.pending>0?1:0.4}}>Reclamar Drachma</button>
            </div>}
          </>}
        </div>}

        {tab==='pools'&&<div>
          <div style={card}><div style={cTitle}>Estado del sistema</div>
            {[['Oracle',oracleSt],['1 WLD =',fmt(wldHachi)+' HACHI'],['1 HACHI =',hachiSushi.toFixed(4)+' SUSHI'],['Pool WLD disponible',poolFree],['Licencias WLD disponibles',licsAvail],['Máximo HACHI/WLD',MAX_HACHI.toLocaleString()]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e'}}>{l}</span><span style={{fontFamily:'monospace',fontWeight:600}}>{v}</span></div>)}
          </div>
          <div style={sLabel}>Estado de pools</div>
          <div style={card}><div style={cTitle}>💠 Pool WLD</div>
            {[['Total',poolsData.wldTotal||'—'],['Reservado',poolsData.wldComm||'—'],['Libre',poolsData.wldFree||'—'],['Total pagado',poolsData.wldPaid||'—'],['Licencias disponibles',poolsData.licsAvail||'—']].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace'}}>{v}</span></div>)}
          </div>
          <div style={card}><div style={{...cTitle,display:'flex',alignItems:'center',gap:6}}><img src="/hachi-cat-savings.png" width={20} height={20} style={{borderRadius:4,objectFit:'cover',flexShrink:0}} />Pool A — Bocado</div>
            {[['Libre',poolsData.poolAF||'—'],['Licencias Bocado disponibles',poolsData.sushiAvail||'—']].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace'}}>{v}</span></div>)}
          </div>
          <div style={card}><div style={cTitle}>📊 Estadísticas</div>
            {[['Licencias WLD vendidas',poolsData.wldLics||'—'],['Licencias Bocado vendidas',poolsData.sushiLics||'—']].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace'}}>{v}</span></div>)}
            <div style={row}><span style={{color:'#8b949e',fontSize:12}}>🔥 HACHI quemados</span><span style={{fontFamily:'monospace',color:'#f87171',fontWeight:600}}>{poolsData.burned||'—'}</span></div>
          </div>
        </div>}

      {debugMode&&logs.length>0&&<div style={{background:'#0f0224',border:'1px solid #f87171',borderRadius:8,padding:10,margin:'8px 0'}}>
        <div style={{fontSize:10,color:'#f87171',marginBottom:4,fontWeight:700}}>DEBUG</div>
        {logs.map((l,i)=><div key={i} style={{fontFamily:'monospace',fontSize:10,color:'#e6edf3',marginBottom:2}}>{l}</div>)}
        <button onClick={()=>setLogs([])} style={{fontSize:10,color:'#8b949e',background:'none',border:'none',cursor:'pointer',marginTop:4}}>Limpiar</button>
      </div>}
      </div>
    </div>
  )
}

const card: React.CSSProperties = {background:'#240a45',border:'1px solid #5b21b6',borderRadius:12,padding:16,marginBottom:12,boxShadow:'0 0 16px rgba(124,58,237,.25)'}
const cTitle: React.CSSProperties = {fontSize:13,color:'#c4b5fd',fontFamily:'Georgia,serif',fontStyle:'italic',marginBottom:12}
const row: React.CSSProperties = {display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #3b0764'}
const sLabel: React.CSSProperties = {fontSize:13,fontWeight:700,fontFamily:'Georgia,serif',color:'#e6edf3',margin:'16px 0 8px',borderBottom:'1px solid #3b0764',paddingBottom:4}
const pBox: React.CSSProperties = {background:'#1e0840',border:'1px solid #5b21b6',borderRadius:8,padding:12,marginBottom:12}
const lCard: React.CSSProperties = {borderRadius:8,padding:12,cursor:'pointer',transition:'border-color .15s'}
const empty: React.CSSProperties = {textAlign:'center',padding:'32px 16px',color:'#8b949e'}
const btnP: React.CSSProperties = {background:'#7c3aed',color:'#fff',border:'1px solid #7c3aed',borderRadius:8,padding:'10px 16px',fontSize:13,fontWeight:600,cursor:'pointer',width:'100%',fontFamily:'Georgia,serif',boxShadow:'0 0 14px rgba(124,58,237,.5)'}
const btnG: React.CSSProperties = {background:'transparent',color:'#34d399',border:'1px solid #34d399',borderRadius:8,padding:'10px 16px',fontSize:13,fontWeight:600,cursor:'pointer',width:'100%',fontFamily:'Georgia,serif'}
const btnGo: React.CSSProperties = {background:'transparent',color:'#fbbf24',border:'1px solid #fbbf24',borderRadius:8,padding:'10px 16px',fontSize:13,fontWeight:600,cursor:'pointer',width:'100%',fontFamily:'Georgia,serif',marginBottom:12}
const btnGh: React.CSSProperties = {background:'transparent',color:'#8b949e',border:'1px solid #30363d',borderRadius:8,padding:'10px 16px',fontSize:13,fontWeight:600,cursor:'pointer',width:'100%',fontFamily:'Georgia,serif'}
