'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { IDKitRequestWidget } from '@worldcoin/idkit'
import { ethers } from 'ethers'

// ─── CONTRATOS ────────────────────────────────────────────
const C = {
  oracle:   '0x0e18Ff0A2b9981D2FF50658aD4960d17c9b7C22b',
  poolWLD:  '0x9F8ccE86271319f36AA25d8390cfC18741719f19',
  lock:     '0x51126154b0F9091E3004CbA6254b7ea2bbf98d82',
  ranking:  '0x8aFA67292202e867a2Cc8072e390E17cE40D5dC2',
  core:     '0xC42A7E97804dF19EAb8F5d4758593964Ae377BE7',
  adMgr:    '0x9c5A8107Ea1513E3dCf1D5692790BfaA3109318f',
  referral: '0x2A2122349c2AFf0F4A2f633e14596172ec3A07F4',
  hachi:    '0xbE0313f279580FDD1aA1b1b6888407E6504fF19E',
  wld:      '0x2cfc85d8e48f8eab294be644d9e25c3030863003',
  sushi:    '0xab09a728e53d3d6bc438be95eed46da0bbe7fb38',
}

const WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/public'
const MIN_WLD_HACHI = 20000
const WLD_ACTION = 'verify-human'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]

const ORACLE_ABI = [
  'function getRates() view returns (uint256,uint256,uint256,bool,bool,uint256)',
  'function previewWldLicense(uint256) view returns (uint256,uint256,uint256,uint256,uint256)',
  'function previewSushiLicense(uint256) view returns (uint256,uint256,uint256,uint256)',
]

const POOL_WLD_ABI = [
  'function getPoolStatus() view returns (uint256,uint256,uint256,uint256,uint256)',
]

const CORE_ABI = [
  'function humanVerified(address) view returns (bool)',
  'function getUserWLDLics(address) view returns (uint256[])',
  'function getUserSushiLics(address) view returns (uint256[])',
  'function wldLics(uint256) view returns (address,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool)',
  'function pendingWLDHachi(uint256) view returns (uint256)',
  'function monthlyWLDRemaining(address) view returns (uint256,uint256)',
  'function getWLDAvailability() view returns (uint256,uint256)',
  'function getSushiAvailability() view returns (uint256,uint256,uint256,uint256,uint8,uint256,uint256)',
  'function hachiDailyPool() view returns (uint256)',
  'function lastDailyClaim(address) view returns (uint256)',
  'function DAILY_CLAIM_COOLDOWN() view returns (uint256)',
  'function getSalesStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'function buyLicenseWLD(uint8)',
  'function buyLicenseSushi(uint8)',
  'function claimWLDHachi(uint256)',
  'function claimSushiDay1(uint256)',
  'function claimSushiDay2(uint256)',
  'function claimSushiPerp(uint256)',
  'function claimDailyHachi()',
  'function verifyHuman(uint256,uint256,uint256[8])',
]

const LOCK_ABI = [
  'function getPosition(address) view returns (uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,bool)',
  'function getUserBatches(address) view returns (uint256[],uint256[],bool[])',
  'function deposit(uint256)',
  'function claimAPY()',
  'function unstake(uint256)',
]

const ADMGR_ABI = [
  'function getActiveCampaigns() view returns (uint256[],string[],uint8[],uint256[],uint256[])',
  'function canParticipate(address,uint256) view returns (bool,uint256,uint256)',
  'function previewCampaign(uint8) view returns (uint256,uint256,uint256,uint256)',
  'function participate(uint256)',
  'function createCampaign(uint8,string,string,uint8)',
]

const RANKING_ABI = [
  'function getUserStats(address) view returns (uint256,uint256,uint256,uint256)',
  'function getCurrentRanking() view returns (address[],uint256[])',
  'function getWeekNumber() view returns (uint256)',
  'function claimPrize()',
]

// ─── TIPOS ────────────────────────────────────────────────
type Tab = 'home' | 'lics' | 'lock' | 'ranking' | 'pools' | 'ads' | 'refs'
type LicTab = 'wld' | 'sushi'
type Lang = 'es' | 'en' | 'pt'

const TRANSLATIONS = {
  es: {
    connect: 'Conectar',
    connecting: 'Conectando...',
    verified: 'World ID ✓',
    not_verified: 'Sin verificar',
    verify_btn: 'Verificar World ID',
    daily_claim: 'Cobrar 10 HACHI',
    nav_home: '🏠 Inicio',
    nav_lics: '📜 Licencias',
    nav_lock: '🔒 Lock',
    nav_rank: '🏆 Ranking',
    nav_pools: '🌊 Pools',
    nav_ads: '📢 Anuncios',
    nav_refs: '👥 Referidos',
    day1: 'Día 1 — recibís de vuelta',
    day2: 'Día 2 — tu ganancia (24h)',
    err_connect: 'Conecta tu wallet',
    err_verify: 'Verifica tu World ID primero',
    err_price: 'Ventas pausadas — HACHI devaluado',
    approving: 'Aprobando...',
    no_lics: 'Sin licencias activas',
    connect_prompt: 'Conecta tu wallet para comenzar',
    access_title: 'Acceso restringido',
    access_desc: 'Para licencias SUSHI necesitas 5,000 HACHI lockeados o una licencia WLD activa',
  },
  en: {
    connect: 'Connect',
    connecting: 'Connecting...',
    verified: 'World ID ✓',
    not_verified: 'Not verified',
    verify_btn: 'Verify World ID',
    daily_claim: 'Claim 10 HACHI',
    nav_home: '🏠 Home',
    nav_lics: '📜 Licenses',
    nav_lock: '🔒 Lock',
    nav_rank: '🏆 Ranking',
    nav_pools: '🌊 Pools',
    nav_ads: '📢 Ads',
    nav_refs: '👥 Referrals',
    day1: 'Day 1 — get back investment',
    day2: 'Day 2 — your profit (24h)',
    err_connect: 'Connect your wallet',
    err_verify: 'Verify your World ID first',
    err_price: 'Sales paused — HACHI devalued',
    approving: 'Approving...',
    no_lics: 'No active licenses',
    connect_prompt: 'Connect your wallet to start',
    access_title: 'Restricted access',
    access_desc: 'For SUSHI licenses you need 5,000 HACHI locked or an active WLD license',
  },
  pt: {
    connect: 'Conectar',
    connecting: 'Conectando...',
    verified: 'World ID ✓',
    not_verified: 'Não verificado',
    verify_btn: 'Verificar World ID',
    daily_claim: 'Cobrar 10 HACHI',
    nav_home: '🏠 Início',
    nav_lics: '📜 Licenças',
    nav_lock: '🔒 Lock',
    nav_rank: '🏆 Ranking',
    nav_pools: '🌊 Pools',
    nav_ads: '📢 Anúncios',
    nav_refs: '👥 Indicações',
    day1: 'Dia 1 — recupere investimento',
    day2: 'Dia 2 — seu lucro (24h)',
    err_connect: 'Conecte sua carteira',
    err_verify: 'Verifique seu World ID primeiro',
    err_price: 'Vendas pausadas — HACHI desvalorizado',
    approving: 'Aprovando...',
    no_lics: 'Sem licenças ativas',
    connect_prompt: 'Conecte sua carteira para começar',
    access_title: 'Acesso restrito',
    access_desc: 'Para licenças SUSHI você precisa de 5.000 HACHI bloqueados ou uma licença WLD ativa',
  },
}

// ─── UTILS ────────────────────────────────────────────────
const fmt = (n: number) => {
  if (!n && n !== 0 || isNaN(n)) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.round(n).toLocaleString()
}
const fmtAddr = (a: string) => a ? a.slice(0, 6) + '...' + a.slice(-4) : '—'
const fe = (v: bigint) => Number(ethers.formatEther(v))
const pe = (v: string | number) => ethers.parseEther(String(v))

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────
export default function HachiMiner() {
  const [tab, setTab] = useState<Tab>('home')
  const [licTab, setLicTab] = useState<LicTab>('wld')
  const [lang, setLang] = useState<Lang>('es')
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null)
  
  // Estado de conexion
  const [addr, setAddr] = useState('')
  const [connected, setConnected] = useState(false)
  const [verified, setVerified] = useState(false)
  const [inWorldApp, setInWorldApp] = useState(false)
  
  // Balances
  const [hachiB, setHachiB] = useState('0')
  const [wldB, setWldB] = useState('0')
  const [sushiB, setSushiB] = useState('0')
  
  // Oracle
  const [wldHachi, setWldHachi] = useState(10000)
  const [hachiSushi, setHachiSushi] = useState(1.5)
  const [oracleStatus, setOracleStatus] = useState('—')
  const [poolWLDFree, setPoolWLDFree] = useState('—')
  const [licsAvail, setLicsAvail] = useState('—')
  const [priceAlert, setPriceAlert] = useState(false)
  
  // Daily claim
  const [dailyBtn, setDailyBtn] = useState({ disabled: true, text: '...' })
  
  // Licencias WLD
  const [selWLD, setSelWLD] = useState(0)
  const [wldPreview, setWldPreview] = useState({ base: '—', total: '—', daily: '—', monthly: '—/5' })
  const [wldLics, setWldLics] = useState<any[]>([])
  
  // Licencias SUSHI
  const [selSUSHI, setSelSUSHI] = useState(0)
  const [sushiPreview, setSushiPreview] = useState({ base: '—', d1: '—', d2: '—', total: '—', dailyLeft: '—' })
  const [sushiAccess, setSushiAccess] = useState(false)
  const [sushiLics, setSushiLics] = useState<any[]>([])
  
  // Lock
  const [lockData, setLockData] = useState({ total: '0', tier: 'Sin tier', apy: '0%', pending: '0', unstake: '0' })
  const [lockBatches, setLockBatches] = useState<any[]>([])
  const [depositAmt, setDepositAmt] = useState('')
  
  // Ranking
  const [rankStats, setRankStats] = useState({ points: '0', pos: '—', reward: '0', earned: '0' })
  const [rankList, setRankList] = useState<any[]>([])
  
  // Pools
  const [poolsData, setPoolsData] = useState<any>({})
  
  // Debug
  const [debugLog, setDebugLog] = useState<string[]>([])
  const addLog = (msg: string) => setDebugLog(prev => [...prev.slice(-5), msg])

  // Anuncios
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [campType, setCampType] = useState(0)
  const [campTitle, setCampTitle] = useState('')
  const [campUrl, setCampUrl] = useState('')
  const [campPlatform, setCampPlatform] = useState(0)
  const [campHPV, setCampHPV] = useState('—')

  // Stats home
  const [homeStats, setHomeStats] = useState({ wldLics: 0, sushiLics: 0, lockTotal: '0', tier: 'Sin tier', points: '0' })
  
  const t = (k: keyof typeof TRANSLATIONS.es) => TRANSLATIONS[lang][k] || TRANSLATIONS.es[k]

  // Provider de solo lectura
  const getProvider = () => new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
  
  const showToast = (msg: string, color = 'var(--c1)') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 3000)
  }

  // ─── DETECTAR WORLD APP ───────────────────────────────
  useEffect(() => {
    const isWA = MiniKit.isInstalled()
    setInWorldApp(isWA)
    if (isWA) connectWallet()
  }, [])

  // ─── CONEXION ─────────────────────────────────────────
  const connectWallet = useCallback(async () => {
    try {
      if (inWorldApp || MiniKit.isInstalled()) {
        // MiniKit v2 inyecta window.ethereum
        addLog('MiniKit v2 detectado')
        const ethereum = (window as any).ethereum
        if (!ethereum) {
          addLog('ERROR: no ethereum')
          showToast('Error: sin wallet', '#f85149')
          return
        }
        await ethereum.request({ method: 'eth_requestAccounts' })
        const provider = new ethers.BrowserProvider(ethereum)
        const signer = await provider.getSigner()
        const walletAddr = await signer.getAddress()
        addLog('addr: ' + walletAddr.slice(0,8))
        setAddr(walletAddr)
        setConnected(true)
        setInWorldApp(true)
        setVerified(true)
        showToast('Conectado: ' + fmtAddr(walletAddr), '#3fb950')
        await loadAllData(walletAddr)
        setInterval(() => loadAllData(walletAddr), 30000)

      } else if (typeof window !== 'undefined' && (window as any).ethereum) {
        // MetaMask
        const ethereum = (window as any).ethereum
        await ethereum.request({ method: 'eth_requestAccounts' })
        const chainId = await ethereum.request({ method: 'eth_chainId' })
        if (chainId !== '0x1E0') {
          try {
            await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1E0' }] })
          } catch {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x1E0', chainName: 'World Chain',
                rpcUrls: [WORLD_CHAIN_RPC],
                nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                blockExplorerUrls: ['https://worldscan.org'],
              }]
            })
          }
        }
        const provider = new ethers.BrowserProvider(ethereum)
        const signer = await provider.getSigner()
        const address = await signer.getAddress()
        setAddr(address)
        setConnected(true)
        showToast('Conectado: ' + fmtAddr(address), '#3fb950')
        await loadAllData(address)
        setInterval(() => loadAllData(address), 30000)
      } else {
        showToast('Abre en World App o instala MetaMask', '#f85149')
      }
    } catch (e: any) {
      addLog('connect ERR: ' + (e.message || '').slice(0, 50))
      showToast('Error: ' + (e.message || 'no se pudo conectar').slice(0,60), '#f85149')
    }
  }, [lang])

  // ─── CARGAR DATOS ─────────────────────────────────────
  const loadAllData = async (address: string) => {
    const provider = getProvider()
    await Promise.allSettled([
      loadBalances(address, provider),
      loadOracleRates(address, provider),
      checkVerified(address, provider),
      checkDailyClaimStatus(address, provider),
    ])
  }

  const loadBalances = async (address: string, provider: ethers.JsonRpcProvider) => {
    const [h, w, s] = await Promise.all([
      new ethers.Contract(C.hachi, ERC20_ABI, provider).balanceOf(address),
      new ethers.Contract(C.wld,   ERC20_ABI, provider).balanceOf(address),
      new ethers.Contract(C.sushi, ERC20_ABI, provider).balanceOf(address),
    ])
    setHachiB(fmt(fe(h))); setWldB(fmt(fe(w))); setSushiB(fmt(fe(s)))
  }

  const loadOracleRates = async (address: string, provider: ethers.JsonRpcProvider) => {
    try {
      const oracle = new ethers.Contract(C.oracle, ORACLE_ABI, provider)
      const r = await oracle.getRates()
      const wh = fe(r[0]), hs = fe(r[1])
      setWldHachi(wh); setHachiSushi(hs)
      setOracleStatus(r[3] ? 'Manual' : 'DEX en vivo ✓')
      setPriceAlert(wh > MIN_WLD_HACHI)
      const core = new ethers.Contract(C.core, CORE_ABI, provider)
      const avail = await core.getWLDAvailability()
      const hf = fe(avail[0]), hpb = wh * 1.3
      const lb = hpb > 0 ? Math.floor(hf / hpb) : 0
      setPoolWLDFree(fmt(hf) + ' HACHI')
      setLicsAvail(lb > 0 ? lb + ' lics. básicas' : '0 (sin fondos)')
    } catch (e) { console.warn('oracle:', e) }
  }

  const checkVerified = async (address: string, provider: ethers.JsonRpcProvider) => {
    try {
      const core = new ethers.Contract(C.core, CORE_ABI, provider)
      const v = await core.humanVerified(address)
      setVerified(v)
    } catch (e) {}
  }

  const checkDailyClaimStatus = async (address: string, provider: ethers.JsonRpcProvider) => {
    try {
      const core = new ethers.Contract(C.core, CORE_ABI, provider)
      const [last, cool, pool] = await Promise.all([
        core.lastDailyClaim(address),
        core.DAILY_CLAIM_COOLDOWN(),
        core.hachiDailyPool(),
      ])
      const next = Number(last) + Number(cool)
      const now = Math.floor(Date.now() / 1000)
      if (Number(pool) === 0) setDailyBtn({ disabled: true, text: 'Pool vacío' })
      else if (now >= next) setDailyBtn({ disabled: false, text: t('daily_claim') })
      else {
        const h = Math.floor((next - now) / 3600)
        const m = Math.floor(((next - now) % 3600) / 60)
        setDailyBtn({ disabled: true, text: `Disponible en ${h}h ${m}m` })
      }
    } catch (e) {}
  }

  // ─── WORLD ID ─────────────────────────────────────────
  const verifyWorldID = async () => {
    if (!connected) { showToast(t('err_connect'), '#f85149'); return }
    if (verified) { showToast(t('verified'), '#3fb950'); return }
    try {
      if (MiniKit.isInstalled()) {
        const verifyRes = await (MiniKit as any).verify({
          action: WLD_ACTION,
          signal: addr,
          verification_level: "orb",
        })
        const finalPayload = verifyRes?.finalPayload || verifyRes
        if (finalPayload?.status === 'success') {
          await sendTx(C.core, CORE_ABI, 'verifyHuman', [
            finalPayload.merkle_root,
            finalPayload.nullifier_hash,
            finalPayload.proof,
          ])
          setVerified(true)
          showToast(t('verified'), '#3fb950')
        }
      } else {
        // Modo testing
        setVerified(true)
        showToast('World ID simulado (testing)', '#d29922')
      }
    } catch (e: any) {
      showToast('Error: ' + (e.reason || e.message), '#f85149')
    }
  }

  // ─── TRANSACCIONES ────────────────────────────────────
  const getSigner = async () => {
    if (inWorldApp) return null // MiniKit maneja las tx
    const ethereum = (window as any).ethereum
    const provider = new ethers.BrowserProvider(ethereum)
    return provider.getSigner()
  }

  const sendTx = async (contractAddr: string, abi: string[], fnName: string, args: any[]) => {
    addLog('tx: ' + fnName + ' minikit:' + MiniKit.isInstalled())

    if (MiniKit.isInstalled()) {
      // MiniKit disponible — usar sendTransaction
      const mk = MiniKit as any
      const iface = new ethers.Interface(abi)
      const jsonAbi = JSON.parse(iface.formatJson())
      const fmtArgs = args.map((a: any) => {
        if (typeof a === 'bigint') return a.toString()
        if (typeof a === 'number') return a.toString()
        if (Array.isArray(a)) return a.map((x: any) => typeof x === 'bigint' ? x.toString() : String(x))
        return a
      })
      const result = await mk.sendTransaction({
        transactions: [{ to: contractAddr, abi: jsonAbi, functionName: fnName, args: fmtArgs }]
      })
      addLog('res: ' + JSON.stringify(result?.data?.status || result?.executedWith))
      if (result?.data?.status !== 'success' && result?.executedWith !== 'minikit' && result?.executedWith !== 'wagmi') {
        throw new Error('Tx fallida: ' + JSON.stringify(result?.data))
      }
      return result
    } else {
      // MetaMask
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error('No wallet')
      const provider = new ethers.BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(contractAddr, abi, signer)
      const tx = await contract[fnName](...args)
      return tx.wait()
    }
  }

    const doApprove = async (tokenAddr: string, spender: string, amount: bigint) => {
    showToast(t('approving'), '#d29922')
    await sendTx(tokenAddr, ERC20_ABI, 'approve', [spender, amount])
  }

  const execTx = async (label: string, contractAddr: string, abi: string[], fnName: string, args: any[]) => {
    try {
      addLog('→ ' + fnName)
      showToast(label + '...', '#d29922')
      const result = await sendTx(contractAddr, abi, fnName, args)
      addLog('✓ ' + fnName)
      showToast('✓ ' + label, '#3fb950')
      await loadAllData(addr)
      return true
    } catch (e: any) {
      const err = e.reason || e.message || JSON.stringify(e) || 'error desconocido'
      addLog('✗ ' + fnName + ': ' + err.slice(0,60))
      showToast('Error: ' + err.slice(0,80), '#f85149')
      return false
    }
  }

  // ─── ACCIONES ─────────────────────────────────────────
  const buyWLDLic = async () => {
    if (!connected) { showToast(t('err_connect'), '#f85149'); return }
    if (!verified)  { showToast(t('err_verify'), '#f85149'); return }
    if (wldHachi > MIN_WLD_HACHI) { showToast(t('err_price'), '#f85149'); return }
    const prices = [pe(1), pe(3), pe(5), pe(10)]
    await doApprove(C.wld, C.core, prices[selWLD])
    await execTx('Comprando licencia WLD', C.core, CORE_ABI, 'buyLicenseWLD', [selWLD])
  }

  const buySushiLic = async () => {
    if (!connected) { showToast(t('err_connect'), '#f85149'); return }
    if (!verified)  { showToast(t('err_verify'), '#f85149'); return }
    const prices = [pe(500), pe(2000), pe(5000), pe(10000)]
    await doApprove(C.hachi, C.core, prices[selSUSHI])
    await execTx('Comprando licencia SUSHI', C.core, CORE_ABI, 'buyLicenseSushi', [selSUSHI])
  }

  const claimDaily = () => execTx('Cobrando 10 HACHI', C.core, CORE_ABI, 'claimDailyHachi', [])
  const claimWLDHachi = (id: bigint) => execTx('Cobrando HACHI', C.core, CORE_ABI, 'claimWLDHachi', [id])
  const doDeposit = async () => {
    if (!depositAmt || Number(depositAmt) <= 0) { showToast('Ingresa un monto válido', '#f85149'); return }
    await doApprove(C.hachi, C.lock, pe(depositAmt))
    await execTx('Depositando HACHI', C.lock, LOCK_ABI, 'deposit', [pe(depositAmt)])
    setDepositAmt('')
  }
  const claimAPY = () => execTx('Cobrando APY', C.lock, LOCK_ABI, 'claimAPY', [])
  const claimRankPrize = () => execTx('Cobrando premio', C.ranking, RANKING_ABI, 'claimPrize', [])

  // ─── ADS ──────────────────────────────────────────────
  const loadAds = async (provider: ethers.JsonRpcProvider) => {
    try {
      const adMgr = new ethers.Contract(C.adMgr, ADMGR_ABI, provider)
      const camps = await adMgr.getActiveCampaigns()
      if (!camps[0].length) { setCampaigns([]); return }
      const items = await Promise.all(camps[0].map(async (id: bigint, i: number) => {
        let canPart = false, waitHours = 0, reward: bigint = BigInt(0)
        try {
          const cp = await adMgr.canParticipate(addr, id)
          canPart = cp[0]
          waitHours = Math.ceil(Number(cp[1]) / 3600)
          reward = cp[2]
        } catch (e) {}
        return {
          id,
          title: camps[1][i],
          platform: Number(camps[2][i]),
          views: Number(camps[3][i]),
          reward: reward || camps[4][i],
          canPart,
          waitHours,
        }
      }))
      setCampaigns(items)
      // Preview campaña
      try {
        const prev = await adMgr.previewCampaign(campType)
        setCampHPV(fmt(fe(prev[3])) + ' HACHI')
      } catch (e) {}
    } catch (e) { console.warn('ads:', e) }
  }

  const participateAd = async (id: bigint) => {
    await execTx('Participando en anuncio', C.adMgr, ADMGR_ABI, 'participate', [id])
    const provider = getProvider()
    loadAds(provider)
  }

  const createCampaign = async () => {
    if (!campTitle || !campUrl) { showToast('Completa todos los campos', '#f85149'); return }
    const prices = [pe(5), pe(10), pe(20), pe(50)]
    await doApprove(C.wld, C.adMgr, prices[campType])
    await execTx('Creando campaña', C.adMgr, ADMGR_ABI, 'createCampaign', [campType, campTitle, campUrl, campPlatform])
    setCampTitle(''); setCampUrl('')
    const provider = getProvider()
    loadAds(provider)
  }

  // ─── LOAD TABS ────────────────────────────────────────
  const loadTab = async (t: Tab) => {
    setTab(t)
    if (!connected) return
    const provider = getProvider()
    if (t === 'lics') loadWLDLics(provider)
    if (t === 'lock') loadLock(provider)
    if (t === 'ranking') loadRanking(provider)
    if (t === 'pools') loadPools(provider)
    if (t === 'ads') loadAds(provider)
  }

  const loadWLDLics = async (provider: ethers.JsonRpcProvider) => {
    try {
      const core = new ethers.Contract(C.core, CORE_ABI, provider)
      // Preview
      const prices = [1, 3, 5, 10]
      const p = prices[selWLD]
      let base = p * wldHachi, total = Math.round(base * 1.3), perDay = Math.round(total / 90)
      try {
        const prev = await new ethers.Contract(C.oracle, ORACLE_ABI, provider).previewWldLicense(pe(p))
        base = fe(prev[0]); total = fe(prev[1]); perDay = fe(prev[2])
      } catch (e) {}
      const monthly = await core.monthlyWLDRemaining(addr).catch(() => [BigInt(5), BigInt(0)])
      setWldPreview({
        base: fmt(base) + ' HACHI',
        total: fmt(total) + ' HACHI',
        daily: '~' + fmt(perDay) + ' HACHI/día',
        monthly: Number(monthly[1]) + '/5 usadas · quedan ' + Number(monthly[0]),
      })
      // Licencias activas
      const ids = await core.getUserWLDLics(addr)
      const lics = await Promise.all(ids.map(async (id: bigint) => {
        const l = await core.wldLics(id)
        const pend = await core.pendingWLDHachi(id)
        return { id, l, pend }
      }))
      setWldLics(lics.filter((x: any) => x.l[10] || x.l[11]))
    } catch (e) { console.warn('wld lics:', e) }
  }

  const loadLock = async (provider: ethers.JsonRpcProvider) => {
    try {
      const lock = new ethers.Contract(C.lock, LOCK_ABI, provider)
      const pos = await lock.getPosition(addr)
      const tiers = ['Sin tier', 'Akira', 'Zen', 'Koban', 'Tayko', 'Hachi']
      setLockData({
        total: fmt(fe(pos[0])) + ' HACHI',
        tier: tiers[pos[3]],
        apy: pos[4].toString() + '% APY',
        pending: fmt(fe(pos[2])) + ' HACHI',
        unstake: fmt(fe(pos[1])) + ' HACHI',
      })
      const batches = await lock.getUserBatches(addr)
      const items = batches[0].map((amt: bigint, i: number) => ({
        amount: fe(amt),
        unlocks: new Date(Number(batches[1][i]) * 1000),
        ready: batches[2][i],
      })).filter((b: any) => b.amount > 0)
      setLockBatches(items)
    } catch (e) { console.warn('lock:', e) }
  }

  const loadRanking = async (provider: ethers.JsonRpcProvider) => {
    try {
      const ranking = new ethers.Contract(C.ranking, RANKING_ABI, provider)
      const stats = await ranking.getUserStats(addr)
      setRankStats({
        points: fmt(Number(stats[0])),
        pos: Number(stats[1]) > 0 ? '#' + stats[1] : '—',
        reward: fmt(fe(stats[2])) + ' HACHI',
        earned: fmt(fe(stats[3])) + ' HACHI',
      })
      const r = await ranking.getCurrentRanking()
      const entries = r[0].map((a: string, i: number) => ({ a, pts: Number(r[1][i]) }))
        .filter((e: any) => e.pts > 0)
        .sort((a: any, b: any) => b.pts - a.pts)
      setRankList(entries)
    } catch (e) { console.warn('ranking:', e) }
  }

  const loadPools = async (provider: ethers.JsonRpcProvider) => {
    try {
      // Pool WLD
      const poolWLDContract = new ethers.Contract(C.poolWLD, POOL_WLD_ABI, provider)
      const ws = await poolWLDContract.getPoolStatus()
      const wldTotal = fmt(fe(ws[0])) + ' HACHI'
      const wldCommitted = fmt(fe(ws[1])) + ' HACHI'
      const wldFree = fmt(fe(ws[2])) + ' HACHI'
      const wldPaid = fmt(fe(ws[3])) + ' HACHI'

      // Pool SUSHI (A y C) via Core
      const core = new ethers.Contract(C.core, [...CORE_ABI, 'function getPoolStatus() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)'], provider)
      let poolA = '—', poolAComm = '—', poolAFree = '—'
      let poolC = '—', poolCComm = '—', poolCFree = '—'
      try {
        const ps = await core.getPoolStatus()
        poolA = fmt(fe(ps[0])) + ' SUSHI'
        poolAComm = fmt(fe(ps[1])) + ' SUSHI'
        poolAFree = fmt(fe(ps[2])) + ' SUSHI'
        poolC = fmt(fe(ps[3])) + ' SUSHI'
        poolCComm = fmt(fe(ps[4])) + ' SUSHI'
        poolCFree = fmt(fe(ps[5])) + ' SUSHI'
      } catch (e) { console.warn('sushi pools:', e) }

      // Stats globales
      const stats = await core.getSalesStats()

      setPoolsData({
        wldTotal, wldCommitted, wldFree, wldPaid,
        poolA, poolAComm, poolAFree,
        poolC, poolCComm, poolCFree,
        wldSales: fmt(fe(stats[0])) + ' WLD',
        wldLics: stats[2].toString(),
        sushiLics: stats[3].toString(),
        burned: fmt(fe(stats[4])) + ' HACHI',
        poolWLDFree: wldFree,
        licsAvail,
      })
    } catch (e) { console.warn('pools:', e) }
  }

  // ─── RENDER ───────────────────────────────────────────
  const wldTypes = ['🌱 Básica', '⚡ Estándar', '💎 Premium', '🚀 Elite']
  const wldPrices = ['1 WLD', '3 WLD', '5 WLD', '10 WLD']
  const sushiTypes = ['🌱 Básica', '⚡ Estándar', '💎 Premium', '🚀 Elite']
  const sushiPrices = ['500 HACHI', '2,000 HACHI', '5,000 HACHI', '10,000 HACHI']

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #1a0533 0%, #0f0224 60%, #1a0533 100%)', color: '#e6edf3', fontFamily: 'Georgia, serif' }}>
      
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 999, padding: '10px 16px',
          borderRadius: 8, background: '#161b22', border: `1px solid ${toast.color}`,
          color: toast.color, fontSize: 13, maxWidth: 320,
        }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div style={{ background: '#12022a', borderBottom: '1px solid #3b0764', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 700, color: '#e879f9', textShadow: '0 0 12px rgba(232,121,249,.5)' }}>⛏ HachiMiner</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['es', 'en', 'pt'] as Lang[]).map(l => (
              <button key={l} onClick={() => setLang(l)} style={{ background: 'none', border: `1px solid ${lang===l?'#a78bfa':'#30363d'}`, borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer', color: lang===l?'#e6edf3':'#8b949e' }}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {connected && (
            <div style={{ display: 'flex', gap: 12 }}>
              {[['HACHI', hachiB], ['WLD', wldB], ['SUSHI', sushiB]].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
          )}
          {connected && (
            <div onClick={verifyWorldID} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b949e', cursor: 'pointer' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: verified ? '#3fb950' : '#30363d' }}></div>
              <span>{verified ? t('verified') : t('not_verified')}</span>
            </div>
          )}
          <button onClick={connectWallet} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 0 14px rgba(124,58,237,.5)' }}>
            {connected ? fmtAddr(addr) : t('connect')}
          </button>
        </div>
      </div>

      {/* NAV */}
      <div style={{ background: '#12022a', borderBottom: '1px solid #3b0764', display: 'flex', overflowX: 'auto', gap: 2, padding: '0 12px' }}>
        {(['home', 'lics', 'lock', 'ranking', 'pools', 'ads', 'refs'] as Tab[]).map((v, i) => {
          const labels = [t('nav_home'), t('nav_lics'), t('nav_lock'), t('nav_rank'), t('nav_pools'), t('nav_ads'), t('nav_refs')]
          return (
            <button key={v} onClick={() => loadTab(v)} style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab===v?'#a78bfa':'transparent'}`, color: tab===v?'#a78bfa':'#8b949e', padding: '12px 14px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Georgia, serif', textShadow: tab===v?'0 0 8px #a78bfa':'' }}>
              {labels[i]}
            </button>
          )
        })}
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>

        {/* HOME */}
        {tab === 'home' && (
          <div>
            {/* Alerta precio */}
            {priceAlert && (
              <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13, color: '#f87171', textAlign: 'center' }}>
                ⚠ Ventas WLD pausadas — HACHI devaluado ({fmt(wldHachi)} &gt; {MIN_WLD_HACHI.toLocaleString()})
              </div>
            )}

            {/* Oracle */}
            <div style={card}>
              <div style={cardTitle}>Estado del sistema</div>
              {[['Oracle', oracleStatus], ['1 WLD =', fmt(wldHachi) + ' HACHI'], ['1 HACHI =', hachiSushi.toFixed(4) + ' SUSHI'], ['Pool WLD disponible', poolWLDFree], ['Licencias WLD disponibles', licsAvail], ['Máximo HACHI/WLD permitido', MIN_WLD_HACHI.toLocaleString()]].map(([l, v]) => (
                <div key={l} style={row}><span style={{ color: '#8b949e' }}>{l}</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span></div>
              ))}
            </div>

            {/* Daily claim */}
            <div style={card}>
              <div style={cardTitle}>HACHI diario</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>10 HACHI</div>
                  <div style={{ fontSize: 12, color: '#8b949e' }}>Para usuarios verificados · cada 24h</div>
                </div>
                <button onClick={claimDaily} disabled={dailyBtn.disabled || !connected} style={{ ...btnGreen, width: 'auto', padding: '8px 16px', opacity: (dailyBtn.disabled || !connected) ? 0.4 : 1 }}>
                  {dailyBtn.text}
                </button>
              </div>
            </div>

            {/* DEBUG PANEL */}
            {debugLog.length > 0 && (
              <div style={{ background: '#0f0224', border: '1px solid #f87171', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#f87171', marginBottom: 4, fontWeight: 700 }}>DEBUG</div>
                {debugLog.map((log, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: 10, color: '#e6edf3', marginBottom: 2 }}>{log}</div>
                ))}
                <button onClick={() => setDebugLog([])} style={{ fontSize: 10, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}>Limpiar</button>
              </div>
            )}

            {!connected && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#8b949e' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
                <div style={{ fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>Bienvenido a HachiMiner</div>
                <div>{t('connect_prompt')}</div>
                <button onClick={connectWallet} style={{ ...btnPrimary, marginTop: 16, maxWidth: 200 }}>{t('connect')}</button>
              </div>
            )}
          </div>
        )}

        {/* LICENCIAS */}
        {tab === 'lics' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <button onClick={() => setLicTab('wld')} style={licTab === 'wld' ? btnPrimary : btnGhost}>💠 WLD</button>
              <button onClick={() => { setLicTab('sushi') }} style={licTab === 'sushi' ? {...btnGreen, background: 'transparent'} : btnGhost}>🍣 SUSHI</button>
            </div>

            {/* WLD PANEL */}
            {licTab === 'wld' && (
              <div>
                <div style={secLabel}>Comprar licencia WLD</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  {wldTypes.map((name, i) => (
                    <div key={i} onClick={() => setSelWLD(i)} style={{ ...licCard, border: `1px solid ${selWLD===i?'#fbbf24':'#5b21b6'}`, background: selWLD===i?'rgba(251,191,36,.08)':'#1e0840', boxShadow: selWLD===i?'0 0 12px rgba(251,191,36,.3)':'none' }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{name}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#34d399' }}>{fmt(Math.round([1,3,5,10][i] * wldHachi * 1.3))}</div>
                      <div style={{ fontSize: 10, color: '#8b949e' }}>HACHI · 3 meses</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginTop: 6 }}>{wldPrices[i]}</div>
                    </div>
                  ))}
                </div>
                <div style={previewBox}>
                  {[['Tipo', wldTypes[selWLD]], ['Precio', wldPrices[selWLD]], ['HACHI base', wldPreview.base], ['Total ×1.3 · 90 días', wldPreview.total], ['HACHI/día', wldPreview.daily], ['Usadas este mes', wldPreview.monthly]].map(([l, v]) => (
                    <div key={l} style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>{l}</span><span style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</span></div>
                  ))}
                </div>
                <button onClick={buyWLDLic} disabled={!connected || !verified || wldHachi > MIN_WLD_HACHI} style={{ ...btnPrimary, opacity: (!connected || !verified || wldHachi > MIN_WLD_HACHI) ? 0.4 : 1 }}>
                  {wldHachi > MIN_WLD_HACHI ? '⚠ Ventas pausadas' : `Comprar · ${wldPrices[selWLD]}`}
                </button>

                <div style={secLabel}>Licencias WLD activas</div>
                {wldLics.length === 0 ? (
                  <div style={emptyState}><div style={{ fontSize: 28 }}>💠</div><div>{t('no_lics')}</div></div>
                ) : wldLics.map(({ id, l, pend }) => (
                  <div key={id.toString()} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div><strong>{['Básica','Estándar','Premium','Elite'][l[1]]}</strong> · {wldPrices[l[1]]}</div>
                      <div style={{ color: l[10] ? '#3fb950' : '#8b949e' }}>●</div>
                    </div>
                    <div style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>Pendiente</span><span style={{ color: '#3fb950', fontFamily: 'monospace' }}>{fmt(fe(pend))} HACHI</span></div>
                    <div style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>Vence</span><span style={{ fontFamily: 'monospace' }}>{new Date(Number(l[7])*1000).toLocaleDateString()}</span></div>
                    <button onClick={() => claimWLDHachi(id)} style={{ ...btnGreen, marginTop: 8 }}>Cobrar HACHI</button>
                  </div>
                ))}
              </div>
            )}

            {/* SUSHI PANEL */}
            {licTab === 'sushi' && (
              <div>
                {!sushiAccess && (
                  <div style={{ background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.35)', borderRadius: 8, padding: 20, textAlign: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
                    <div style={{ fontWeight: 700, color: '#f87171', marginBottom: 6 }}>{t('access_title')}</div>
                    <div style={{ fontSize: 13, color: '#8b949e' }}>{t('access_desc')}</div>
                  </div>
                )}
                {sushiAccess && (
                  <>
                    <div style={secLabel}>Comprar licencia HACHI/SUSHI</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                      {sushiTypes.map((name, i) => (
                        <div key={i} onClick={() => setSelSUSHI(i)} style={{ ...licCard, border: `1px solid ${selSUSHI===i?'#fbbf24':'#5b21b6'}`, background: selSUSHI===i?'rgba(251,191,36,.08)':'#1e0840' }}>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>{name}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#34d399' }}>{fmt(Math.round([500,2000,5000,10000][i] * hachiSushi * 1.5))}</div>
                          <div style={{ fontSize: 10, color: '#8b949e' }}>SUSHI total ×1.5</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginTop: 6 }}>{sushiPrices[i]}</div>
                        </div>
                      ))}
                    </div>
                    <div style={previewBox}>
                      {[['Tipo', sushiTypes[selSUSHI]], ['Precio', sushiPrices[selSUSHI]], ['SUSHI base', sushiPreview.base], [t('day1'), sushiPreview.d1], [t('day2'), sushiPreview.d2], ['Total ×1.5', sushiPreview.total], ['Perpetuidad', '10 SUSHI/día · 6 meses'], ['Disponibles hoy', sushiPreview.dailyLeft]].map(([l, v]) => (
                        <div key={l} style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>{l}</span><span style={{ fontFamily: 'monospace', fontSize: 13 }}>{v}</span></div>
                      ))}
                    </div>
                    <button onClick={buySushiLic} style={btnGreen}>{`Comprar · ${sushiPrices[selSUSHI]}`}</button>
                  </>
                )}
                <div style={secLabel}>Licencias SUSHI activas</div>
                {sushiLics.length === 0 ? (
                  <div style={emptyState}><div style={{ fontSize: 28 }}>🍣</div><div>{t('no_lics')}</div></div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* LOCK */}
        {tab === 'lock' && (
          <div>
            <div style={card}>
              <div style={cardTitle}>Tu posición</div>
              {[['Total lockeado', lockData.total], ['Tier', lockData.tier], ['APY anual', lockData.apy], ['APY pendiente', lockData.pending], ['Disponible retirar', lockData.unstake]].map(([l, v]) => (
                <div key={l} style={row}><span style={{ color: '#8b949e' }}>{l}</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span></div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <button onClick={claimAPY} style={btnGreen}>Cobrar APY</button>
              <button style={btnGhost}>Retirar HACHI</button>
            </div>
            <div style={secLabel}>Depositar HACHI</div>
            <input value={depositAmt} onChange={e => setDepositAmt(e.target.value)} type="number" placeholder="Cantidad de HACHI" style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#e6edf3', width: '100%', marginBottom: 8, fontFamily: 'monospace' }} />
            <button onClick={doDeposit} style={btnPrimary}>Depositar</button>

            <div style={secLabel}>Mis depósitos</div>
            {lockBatches.length === 0 ? (
              <div style={emptyState}><div>Sin depósitos aún</div></div>
            ) : lockBatches.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #3b0764', fontSize: 12 }}>
                <span style={{ fontFamily: 'monospace' }}>{fmt(b.amount)} HACHI</span>
                <span style={{ color: b.ready ? '#3fb950' : '#8b949e' }}>{b.ready ? '✓ Disponible' : 'Hasta ' + b.unlocks.toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* RANKING */}
        {tab === 'ranking' && (
          <div>
            <div style={card}>
              <div style={cardTitle}>Mis estadísticas</div>
              {[['Mis puntos', rankStats.points], ['Mi posición', rankStats.pos], ['Premio pendiente', rankStats.reward], ['Total ganado', rankStats.earned]].map(([l, v]) => (
                <div key={l} style={row}><span style={{ color: '#8b949e' }}>{l}</span><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span></div>
              ))}
            </div>
            <button onClick={claimRankPrize} style={btnGold}>Cobrar premio</button>
            <div style={secLabel}>Ranking semanal · Top 100</div>
            {rankList.length === 0 ? (
              <div style={emptyState}><div style={{ fontSize: 28 }}>🏆</div><div>Sin participantes aún</div></div>
            ) : rankList.map((e, i) => {
              const isMe = e.a.toLowerCase() === addr.toLowerCase()
              const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`
              return (
                <div key={e.a} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, marginBottom: 4, background: '#1e0840', border: `1px solid ${isMe?'#34d399':'#5b21b6'}` }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, width: 28 }}>{medal}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }}>{fmtAddr(e.a)}{isMe && <span style={{ color: '#34d399' }}> (tú)</span>}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>{fmt(e.pts)}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* POOLS */}
        {tab === 'pools' && (
          <div>
            <div style={secLabel}>Estado de pools</div>
            {[
              ['💠 Pool WLD — HACHI para licencias', [
                ['Total', poolsData.wldTotal||'—'],
                ['Reservado (licencias activas)', poolsData.wldCommitted||'—'],
                ['Libre para nuevas licencias', poolsData.wldFree||'—'],
                ['Total pagado', poolsData.wldPaid||'—'],
                ['Licencias disponibles', poolsData.licsAvail||'—'],
              ]],
              ['🍣 Pool A — Ciclos SUSHI', [
                ['Total', poolsData.poolA||'—'],
                ['Reservado', poolsData.poolAComm||'—'],
                ['Libre', poolsData.poolAFree||'—'],
              ]],
              ['♾️ Pool C — Perpetuidades', [
                ['Total', poolsData.poolC||'—'],
                ['Reservado', poolsData.poolCComm||'—'],
                ['Libre', poolsData.poolCFree||'—'],
              ]],
              ['📊 Estadísticas globales', [
                ['WLD recaudado', poolsData.wldSales||'—'],
                ['Licencias WLD vendidas', poolsData.wldLics||'—'],
                ['Licencias SUSHI vendidas', poolsData.sushiLics||'—'],
                ['HACHI quemados', poolsData.burned||'—'],
              ]],
            ].map(([title, rows]: any) => (
              <div key={title} style={card}>
                <div style={cardTitle}>{title}</div>
                {rows.map(([l, v]: any) => (
                  <div key={l} style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>{l}</span><span style={{ fontFamily: 'monospace' }}>{v}</span></div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ADS */}
        {tab === 'ads' && (
          <div>
            <div style={secLabel}>Campañas activas</div>
            {campaigns.length === 0 ? (
              <div style={emptyState}><div style={{ fontSize: 28 }}>📢</div><div>Sin campañas activas</div></div>
            ) : campaigns.map((camp: any) => (
              <div key={camp.id.toString()} style={{ ...card, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{camp.title}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
                  <span>{['▶ YouTube', '✈ Telegram', '𝕏 Twitter'][camp.platform]}</span>
                  <span>{camp.views} vistas restantes</span>
                  <span style={{ color: '#34d399' }}>{fmt(fe(camp.reward))} HACHI/vista</span>
                </div>
                <button
                  onClick={() => participateAd(camp.id)}
                  disabled={!camp.canPart || !connected || !verified}
                  style={{ ...btnGreen, opacity: (!camp.canPart || !connected || !verified) ? 0.4 : 1 }}
                >
                  {camp.canPart ? `Participar · ${fmt(fe(camp.reward))} HACHI` : camp.waitHours > 0 ? `En ${camp.waitHours}h` : 'No disponible'}
                </button>
              </div>
            ))}

            <div style={secLabel}>Publicar anuncio</div>
            <div style={card}>
              <div style={cardTitle}>Nueva campaña</div>
              <select
                value={campType}
                onChange={e => setCampType(Number(e.target.value))}
                style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e6edf3', width: '100%', marginBottom: 8 }}
              >
                <option value={0}>500 vistas — 5 WLD</option>
                <option value={1}>1,000 vistas — 10 WLD</option>
                <option value={2}>2,000 vistas — 20 WLD</option>
                <option value={3}>5,000 vistas — 50 WLD</option>
              </select>
              <input
                value={campTitle}
                onChange={e => setCampTitle(e.target.value)}
                placeholder="Título del anuncio"
                style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e6edf3', width: '100%', marginBottom: 8, fontFamily: 'monospace' }}
              />
              <input
                value={campUrl}
                onChange={e => setCampUrl(e.target.value)}
                placeholder="URL del contenido"
                style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e6edf3', width: '100%', marginBottom: 8, fontFamily: 'monospace' }}
              />
              <select
                value={campPlatform}
                onChange={e => setCampPlatform(Number(e.target.value))}
                style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e6edf3', width: '100%', marginBottom: 8 }}
              >
                <option value={0}>▶ YouTube</option>
                <option value={1}>✈ Telegram</option>
                <option value={2}>𝕏 Twitter/X</option>
              </select>
              <div style={{ ...previewBox, marginBottom: 12 }}>
                <div style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>Costo</span><span style={{ fontFamily: 'monospace' }}>{[5,10,20,50][campType]} WLD</span></div>
                <div style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>HACHI por vista</span><span style={{ fontFamily: 'monospace', color: '#34d399' }}>{campHPV}</span></div>
              </div>
              <button onClick={createCampaign} disabled={!connected || !verified || !campTitle || !campUrl} style={{ ...btnPrimary, opacity: (!connected || !verified || !campTitle || !campUrl) ? 0.4 : 1 }}>
                Publicar campaña · {[5,10,20,50][campType]} WLD
              </button>
            </div>
          </div>
        )}

        {/* REFS */}
        {tab === 'refs' && (
          <div>
            <div style={card}>
              <div style={cardTitle}>Mi código de referido</div>
              <div style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', marginBottom: 8 }}>
                {addr || 'Conecta tu wallet'}
              </div>
              <button onClick={() => { navigator.clipboard.writeText(addr); showToast('Código copiado', '#3fb950') }} style={btnGhost}>Copiar código</button>
            </div>
            <div style={secLabel}>Registrar referido</div>
            <div style={card}>
              <input placeholder={'Wallet del referidor (0x...)'} style={{ background: '#12022a', border: '1px solid #5b21b6', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e6edf3', width: '100%', marginBottom: 8, fontFamily: 'monospace' }} />
              <div style={previewBox}>
                <div style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>Recibes</span><span style={{ color: '#3fb950', fontFamily: 'monospace' }}>50 HACHI</span></div>
                <div style={row}><span style={{ color: '#8b949e', fontSize: 12 }}>Tu referidor recibe</span><span style={{ color: '#a78bfa', fontFamily: 'monospace' }}>100 HACHI</span></div>
              </div>
              <button style={btnPrimary}>Registrar referido</button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── ESTILOS ──────────────────────────────────────────────
const card: React.CSSProperties = { background: '#240a45', border: '1px solid #5b21b6', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 0 16px rgba(124,58,237,.25)' }
const cardTitle: React.CSSProperties = { fontSize: 13, color: '#c4b5fd', fontFamily: 'Georgia, serif', fontStyle: 'italic', marginBottom: 12 }
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #3b0764' }
const secLabel: React.CSSProperties = { fontSize: 13, fontWeight: 700, fontFamily: 'Georgia, serif', color: '#e6edf3', margin: '16px 0 8px', borderBottom: '1px solid #3b0764', paddingBottom: 4 }
const previewBox: React.CSSProperties = { background: '#1e0840', border: '1px solid #5b21b6', borderRadius: 8, padding: 12, marginBottom: 12 }
const licCard: React.CSSProperties = { borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'border-color .15s' }
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '32px 16px', color: '#8b949e' }
const btnPrimary: React.CSSProperties = { background: '#7c3aed', color: '#fff', border: '1px solid #7c3aed', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif', boxShadow: '0 0 14px rgba(124,58,237,.5)' }
const btnGreen: React.CSSProperties = { background: 'transparent', color: '#34d399', border: '1px solid #34d399', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif' }
const btnGold: React.CSSProperties = { background: 'transparent', color: '#fbbf24', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif', marginBottom: 12 }
const btnGhost: React.CSSProperties = { background: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif' }








