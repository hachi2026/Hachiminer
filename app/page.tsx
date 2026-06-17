'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'

const C = {
  oracle:   '0x0e18Ff0A2b9981D2FF50658aD4960d17c9b7C22b',
  poolWLD:  '0x9F8ccE86271319f36AA25d8390cfC18741719f19',
  lock:     '0xB25b9c1cAF5F12899689d8cb5D625487dB3a36b5',
  ranking:  '0xfA503d183cc747cBA75D1a5ba419150f5529eB27',
  core:     '0x71A6E2e16f4Fdd65d5B11B7d0731Aa7b8d74e5bE',
  adMgr:    '0xC51debcdc888d75EE91293B7E2ADE1C22C944097',
  referral: '0x10C489676a074A0d14e75Fd890F4Cf490af41E06',
  hachi:    '0xbE0313f279580FDD1aA1b1b6888407E6504fF19E',
  wld:      '0x2cfc85d8e48f8eab294be644d9e25c3030863003',
  sushi:    '0xab09a728e53d3d6bc438be95eed46da0bbe7fb38',
  // Permit2 canónico de Uniswap (misma dirección en todas las redes EVM, incl. World Chain)
  permit2:  '0x000000000022D473030F116dDEE9F6B43aC78BA3',
}

const RPC = 'https://worldchain-mainnet.g.alchemy.com/public'
const WORLDCHAIN_ID = 480
const MAX_HACHI = 20000
const APP_ID = 'app_faaadf7d4dc1285275a436a8cac18e69'

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
  'function hachiDailyPool() view returns (uint256)',
  'function lastDailySettle(address) view returns (uint256)',
  'function dailyAccrued(address) view returns (uint256)',
  'function pendingDaily(address) view returns (uint256)',
  'function totalDailyClaims() view returns (uint256)',
  'function currentDailyRate() view returns (uint256)',
  'function currentMinWithdraw() view returns (uint256)',
  'function getSalesStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'function getPoolStatus() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  'function buyLicenseWLD(uint8)',
  'function buyLicenseSushi(uint8)',
  'function claimWLDHachi(uint256)',
  'function withdrawDailyHachi()',
  'function verifyHuman(uint256,uint256,uint256[8])',
]
const LOCK = [
  'function getPosition(address) view returns (uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,bool)',
  'function getUserBatches(address) view returns (uint256[],uint256[],bool[])',
  'function deposit(uint256)', 'function claimAPY()', 'function unstake(uint256)',
]
const RANKING = [
  'function getUserStats(address) view returns (uint256,uint256,uint256,uint256,uint8,uint256)',
  'function getCurrentRanking() view returns (address[],uint256[],uint256[],uint8[])',
  'function getPeriodNumber() view returns (uint256)',
  'function timeUntilNextExecution() view returns (uint256)',
  'function claimPrize()',
]
const ADMGR = [
  'function getActiveCampaigns() view returns (uint256[],string[],uint8[],uint256[],uint256[])',
  'function canParticipate(address,uint256) view returns (bool,uint256,uint256)',
  'function previewCampaign(uint8) view returns (uint256,uint256,uint256,uint256)',
  'function participate(uint256)',
  'function createCampaign(uint8,string,string,uint8)',
]
const REFERRAL = [
  'function registerWithReferral(address)',
  'function getReferralInfo(address) view returns (address,uint256,uint256,address[])',
  'function canRegister(address,address) view returns (bool,string)',
  'function currentRefBonus() view returns (uint256)',
  'function currentNewBonus() view returns (uint256)',
]

type Tab = 'home'|'lics'|'lock'|'ranking'|'pools'|'ads'|'refs'
type Lang = 'es'|'en'|'pt'

const TR = {
  es: { connect:'Conectar', verified:'World ID ✓', not_verified:'Sin verificar', daily_claim:'Cobrar 10 HACHI', nav_home:'🏠 Inicio', nav_lics:'📜 Licencias', nav_lock:'🔒 Lock', nav_rank:'🏆 Ranking', nav_pools:'🌊 Pools', nav_ads:'📢 Anuncios', nav_refs:'👥 Referidos', err_connect:'Conecta tu wallet', err_verify:'Verifica tu World ID', err_price:'Ventas pausadas', approving:'Aprobando...', no_lics:'Sin licencias activas', connect_prompt:'Conecta tu wallet para comenzar', access_title:'Acceso restringido', access_desc:'Para licencias SUSHI necesitas 5,000 HACHI lockeados o una licencia WLD activa', day1:'Día 1 — recibís de vuelta', day2:'Día 2 — tu ganancia (24h)' },
  en: { connect:'Connect', verified:'World ID ✓', not_verified:'Not verified', daily_claim:'Claim 10 HACHI', nav_home:'🏠 Home', nav_lics:'📜 Licenses', nav_lock:'🔒 Lock', nav_rank:'🏆 Ranking', nav_pools:'🌊 Pools', nav_ads:'📢 Ads', nav_refs:'👥 Referrals', err_connect:'Connect your wallet', err_verify:'Verify your World ID', err_price:'Sales paused', approving:'Approving...', no_lics:'No active licenses', connect_prompt:'Connect your wallet to start', access_title:'Restricted access', access_desc:'For SUSHI licenses you need 5,000 HACHI locked or an active WLD license', day1:'Day 1 — get back investment', day2:'Day 2 — your profit (24h)' },
  pt: { connect:'Conectar', verified:'World ID ✓', not_verified:'Não verificado', daily_claim:'Cobrar 10 HACHI', nav_home:'🏠 Início', nav_lics:'📜 Licenças', nav_lock:'🔒 Lock', nav_rank:'🏆 Ranking', nav_pools:'🌊 Pools', nav_ads:'📢 Anúncios', nav_refs:'👥 Indicações', err_connect:'Conecte sua carteira', err_verify:'Verifique seu World ID', err_price:'Vendas pausadas', approving:'Aprovando...', no_lics:'Sem licenças ativas', connect_prompt:'Conecte sua carteira para começar', access_title:'Acesso restrito', access_desc:'Para licenças SUSHI você precisa de 5.000 HACHI bloqueados ou uma licença WLD ativa', day1:'Dia 1 — recupere investimento', day2:'Dia 2 — seu lucro (24h)' },
}

const LOGIN = {
  es: {
    tagline: 'Minería de HACHI verificada con World ID en World Chain',
    whatTitle: '¿Qué es HachiMiner?',
    whatDesc: 'HachiMiner es una mini app de World que te permite minar tokens HACHI y operar con licencias WLD y SUSHI directamente en World Chain. Compra licencias, bloquea tokens para ganar APY, participa en el ranking y deja que Hachi ahorre HACHI por vos en su alcancía.',
    features: [
      { icon:'📜', title:'Licencias', desc:'Compra licencias WLD y SUSHI para generar HACHI diario.' },
      { icon:'🔒', title:'Lock & APY', desc:'Bloquea HACHI y gana rendimiento sobre tu posición.' },
      { icon:'🏆', title:'Ranking', desc:'Compite por premios según tu actividad.' },
      { icon:'🐱', title:'La alcancía de Hachi', desc:'Hachi ahorra HACHI por vos sin gas; retirá al juntar 500.' },
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
    whatDesc: 'HachiMiner is a World mini app that lets you mine HACHI tokens and trade WLD and SUSHI licenses directly on World Chain. Buy licenses, lock tokens to earn APY, climb the ranking, and let Hachi save HACHI for you in his piggy bank.',
    features: [
      { icon:'📜', title:'Licenses', desc:'Buy WLD and SUSHI licenses to generate daily HACHI.' },
      { icon:'🔒', title:'Lock & APY', desc:'Lock HACHI and earn yield on your position.' },
      { icon:'🏆', title:'Ranking', desc:'Compete for prizes based on your activity.' },
      { icon:'🐱', title:'Hachi\'s piggy bank', desc:'Hachi saves HACHI for you with no gas; withdraw at 500.' },
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
    whatDesc: 'O HachiMiner é um mini app da World que permite minerar tokens HACHI e operar com licenças WLD e SUSHI diretamente na World Chain. Compre licenças, bloqueie tokens para ganhar APY, suba no ranking e deixe o Hachi guardar HACHI por você no cofrinho dele.',
    features: [
      { icon:'📜', title:'Licenças', desc:'Compre licenças WLD e SUSHI para gerar HACHI diário.' },
      { icon:'🔒', title:'Lock & APY', desc:'Bloqueie HACHI e ganhe rendimento na sua posição.' },
      { icon:'🏆', title:'Ranking', desc:'Concorra a prêmios conforme sua atividade.' },
      { icon:'🐱', title:'Cofrinho do Hachi', desc:'O Hachi guarda HACHI por você sem gas; saque ao juntar 500.' },
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
// nonce alfanumérico de al menos 8 caracteres (requisito de MiniKit v2)
const genNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('')

export default function HachiMiner() {
  const [tab, setTab] = useState<Tab>('home')
  const [licTab, setLicTab] = useState<'wld'|'sushi'>('wld')
  const [lang, setLang] = useState<Lang>('es')
  const [toast, setToast] = useState<{msg:string;color:string}|null>(null)
  const [addr, setAddr] = useState('')
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
  const [priceAlert, setPriceAlert] = useState(false)
  const [piggy, setPiggy] = useState({accrued:0,min:500,accrual:100,canWithdraw:false})
  const [selWLD, setSelWLD] = useState(0)
  const [wldPrev, setWldPrev] = useState({base:'—',total:'—',daily:'—',monthly:'—'})
  const [wldLics, setWldLics] = useState<any[]>([])
  const [selSUSHI, setSelSUSHI] = useState(0)
  const [sushiPrev] = useState({base:'—',d1:'—',d2:'—',total:'—',dailyLeft:'—'})
  const [sushiAccess] = useState(false)
  const [sushiLics] = useState<any[]>([])
  const [lockData, setLockData] = useState({total:'0',tier:'Sin tier',apy:'0%',pending:'0',unstake:'0',unstakeRaw:BigInt(0)})
  const [lockBatches, setLockBatches] = useState<any[]>([])
  const [depositAmt, setDepositAmt] = useState('')
  const [rankStats, setRankStats] = useState({points:'0',pos:'—',reward:'0',earned:'0',nextDist:'—'})
  const [rankList, setRankList] = useState<any[]>([])
  const [refInfo, setRefInfo] = useState({referrer:'',totalRefs:0,earned:'0 HACHI',refBonus:'500',newBonus:'500'})
  const [refInput, setRefInput] = useState('')
  const [poolsData, setPoolsData] = useState<any>({})
  const [logs, setLogs] = useState<string[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [campType, setCampType] = useState(0)
  const [campTitle, setCampTitle] = useState('')
  const [campUrl, setCampUrl] = useState('')
  const [campPlatform, setCampPlatform] = useState(0)
  const [campHPV, setCampHPV] = useState('—')
  const [showVerify, setShowVerify] = useState(false)

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
      if (installed) {
        // Auto inicio de sesión al abrir dentro de World App
        const a = await connectMiniKit()
        if (a) timer = setInterval(() => loadAll(a), 30000)
      }
    }
    init()
    return () => { if (timer) clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Devuelve la dirección conectada o '' si falla
  const connectMiniKit = async (): Promise<string> => {
    try {
      if (!MiniKit.isInstalled()) {
        log('walletAuth: no estás en World App')
        return ''
      }
      log('intentando walletAuth...')
      const res = await MiniKit.walletAuth({
        nonce: genNonce(),
        statement: 'HachiMiner',
        expirationTime: new Date(Date.now() + 7*24*60*60*1000),
        notBefore: new Date(Date.now() - 60*1000),
      })
      log('executedWith: ' + res.executedWith)
      if (res.executedWith === 'fallback') { log('walletAuth fallback'); return '' }
      // v2: la dirección viene en res.data.address y en MiniKit.user.walletAddress
      const walletAddr = (res.data as any)?.address || MiniKit.user?.walletAddress || ''
      if (walletAddr) {
        log('addr: ' + walletAddr.slice(0,10))
        setAddr(walletAddr)
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
    await Promise.allSettled([loadBal(address,p), loadOracle(address,p), checkVerif(address,p), checkDaily(address,p), loadPools(p)])
  }

  const loadBal = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const [h,w,s] = await Promise.all([
        new ethers.Contract(C.hachi,ERC20,p).balanceOf(a),
        new ethers.Contract(C.wld,ERC20,p).balanceOf(a),
        new ethers.Contract(C.sushi,ERC20,p).balanceOf(a),
      ])
      setHachiB(fmt(fe(h))); setWldB(fmt(fe(w))); setSushiB(fmt(fe(s)))
    } catch(e) {}
  }

  const loadOracle = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const r = await new ethers.Contract(C.oracle,ORACLE,p).getRates()
      const wh=fe(r[0]),hs=fe(r[1])
      setWldHachi(wh); setHachiSushi(hs); setOracleSt(r[3]?'Manual':'DEX en vivo ✓'); setPriceAlert(wh>MAX_HACHI)
      const av = await new ethers.Contract(C.core,CORE,p).getWLDAvailability()
      const hf=fe(av[0]),hpb=wh*1.3,lb=hpb>0?Math.floor(hf/hpb):0
      setPoolFree(fmt(hf)+' HACHI'); setLicsAvail(lb>0?lb+' lics. básicas':'0 (sin fondos)')
    } catch(e) {}
  }

  const checkVerif = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      // Estado REAL de verificación: lo decide el contrato (humanVerified),
      // no el hecho de estar dentro de World App. Si forzamos true sin
      // verifyHuman, las compras revierten on-chain y se pierde gas.
      const v = await new ethers.Contract(C.core,CORE,p).humanVerified(a)
      setVerified(!!v)
    } catch(e) {}
  }

  const checkDaily = async (a: string, p: ethers.JsonRpcProvider) => {
    try {
      const core = new ethers.Contract(C.core,CORE,p)
      const [pending,minW,rate] = await Promise.all([
        core.pendingDaily(a), core.currentMinWithdraw(), core.currentDailyRate()
      ])
      const pendingN = Number(fe(pending)), minN = Number(fe(minW)), rateN = Number(fe(rate))
      setPiggy({accrued:pendingN, min:minN, accrual:rateN, canWithdraw:pendingN>=minN})
    } catch(e) {}
  }

  // Interpreta el resultado de MiniKit.sendTransaction y lanza un error legible con el error_code real
  const handleMiniKitResult = (result: any) => {
    log('res: '+result.executedWith)
    if (result.executedWith === 'fallback') {
      const d = result.data as any
      const code = d?.error_code || d?.status || 'fallback'
      throw new Error('World App rechazó la tx: '+code)
    }
    const d = result.data as any
    const status = d?.status
    if (status && status !== 'success') {
      const code = d?.error_code || status
      const detail = d?.details ? ' '+JSON.stringify(d.details) : ''
      throw new Error(code+detail)
    }
    return result
  }

  // Envío de transacciones — codifica calldata y usa el formato CalldataTransaction de MiniKit v2
  const sendTx = async (contractAddr: string, abi: string[], fnName: string, args: any[]) => {
    log('tx: '+fnName+' inWA:'+inWA)
    const iface = new ethers.Interface(abi)
    const data = iface.encodeFunctionData(fnName, args)
    if (MiniKit.isInstalled()) {
      const result = await MiniKit.sendTransaction({
        chainId: WORLDCHAIN_ID,
        transactions: [{ to: contractAddr, data }],
      })
      return handleMiniKitResult(result)
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

  // Envía varias llamadas en UNA sola transacción (MiniKit v2 batch). World App necesita
  // approve + acción juntos; si se envían por separado muestra pantalla en blanco.
  const sendTxMulti = async (calls: { to: string; abi: string[]; fnName: string; args: any[] }[]) => {
    if (MiniKit.isInstalled()) {
      const transactions = calls.map((c) => ({
        to: c.to,
        data: new ethers.Interface(c.abi).encodeFunctionData(c.fnName, c.args),
      }))
      const result = await MiniKit.sendTransaction({ chainId: WORLDCHAIN_ID, transactions })
      return handleMiniKitResult(result)
    } else {
      // MetaMask no soporta batch: enviamos secuencialmente
      for (const c of calls) await sendTx(c.to, c.abi, c.fnName, c.args)
    }
  }

  // Construye los calls de aprobacion Permit2 para un pago (patron AllowanceTransfer ON-CHAIN).
  // Nuestros contratos llaman PERMIT2.transferFrom(user, to, amount, token) internamente,
  // lo que usa IAllowanceTransfer (no SignatureTransfer). Para ese patron hacen falta DOS approves:
  //   1) ERC20.approve(PERMIT2, max)  -> autoriza a Permit2 a mover el token desde el usuario.
  //      World App NO hace esto automaticamente (eso solo aplica al permit2 nativo por firma EIP-712).
  //   2) PERMIT2.approve(token, spender, amount, expiration) -> autoriza a NUESTRO contrato via Permit2.
  // La expiracion debe ser FUTURA (uint48); 0 dejaria el allowance expirado y revertiria el transferFrom.
  const MAX_UINT160 = (BigInt(1) << BigInt(160)) - BigInt(1)
  const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)
  const buildPermit2Approvals = (token: string, spender: string, amount: bigint) => {
    const amt160 = amount > MAX_UINT160 ? MAX_UINT160 : amount
    const expiration = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // +30 dias (uint48)
    return [
      { to: token, abi: ERC20, fnName: 'approve', args: [C.permit2, MAX_UINT256] },
      { to: C.permit2, abi: PERMIT2_ABI, fnName: 'approve', args: [token, spender, amt160, expiration] },
    ]
  }

  const handleVerifySuccess = async (res: any) => {
    try {
      await sendTx(C.core, CORE, 'verifyHuman', [res.merkle_root, res.nullifier_hash, res.proof])
      setVerified(true)
      setShowVerify(false)
      toast_(t('verified'), '#3fb950')
    } catch(e: any) { toast_('Error: '+(e.reason||e.message), '#f85149') }
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
    try {
      toast_('Comprando licencia SUSHI...', '#d29922')
      const amt = [pe(500),pe(2000),pe(5000),pe(10000)][selSUSHI]
      await sendTxMulti([
        ...buildPermit2Approvals(C.hachi, C.core, amt),
        { to: C.core, abi: CORE, fnName: 'buyLicenseSushi', args: [selSUSHI] },
      ])
      toast_('✓ Licencia SUSHI comprada', '#3fb950')
      await loadAll(addr)
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }

  const withdrawDaily = async () => {
    if (!piggy.canWithdraw) { toast_(`Mínimo ${piggy.min} HACHI para retirar`,'#f85149'); return }
    try {
      toast_('Retirando acumulador...', '#d29922')
      await sendTx(C.core, CORE, 'withdrawDailyHachi', [])
      toast_('✓ HACHI retirado a tu wallet', '#3fb950')
      await loadAll(addr)
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }
  const claimWLD = (id: bigint) => execTx('Cobrando HACHI', C.core, CORE, 'claimWLDHachi', [id])
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
    if (v==='lock') loadLock(p)
    if (v==='ranking') loadRanking(p)
    if (v==='pools') loadPools(p)
    if (v==='ads') loadAds(p)
    if (v==='refs') loadRefs(p)
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
    } catch(e) {}
  }

  const loadLock = async (p: ethers.JsonRpcProvider) => {
    try {
      const lock = new ethers.Contract(C.lock,LOCK,p)
      const pos = await lock.getPosition(addr)
      setLockData({total:fmt(fe(pos[0]))+' HACHI', tier:['Sin tier','Akira','Zen','Koban','Tayko','Hachi'][pos[3]], apy:pos[4].toString()+'% APY', pending:fmt(fe(pos[2]))+' HACHI', unstake:fmt(fe(pos[1]))+' HACHI', unstakeRaw:pos[1]})
      const b = await lock.getUserBatches(addr)
      setLockBatches(b[0].map((a:bigint,i:number) => ({amount:fe(a), unlocks:new Date(Number(b[1][i])*1000), ready:b[2][i]})).filter((x:any) => x.amount>0))
    } catch(e) {}
  }

  const loadRanking = async (p: ethers.JsonRpcProvider) => {
    try {
      const r = new ethers.Contract(C.ranking,RANKING,p)
      const [s,rk,nextT] = await Promise.all([r.getUserStats(addr), r.getCurrentRanking(), r.timeUntilNextExecution()])
      const list = rk[0].map((a:string,i:number) => ({a,pts:Number(rk[1][i])})).filter((e:any) => e.pts>0).sort((a:any,b:any) => b.pts-a.pts)
      const myPts = Number(s[1])
      const idx = list.findIndex((e:any) => e.a.toLowerCase()===addr.toLowerCase())
      const secs = Number(nextT), d=Math.floor(secs/86400), h=Math.floor((secs%86400)/3600)
      setRankStats({points:fmt(myPts), pos:idx>=0?'#'+(idx+1):'—', reward:fmt(fe(s[2]))+' HACHI', earned:fmt(fe(s[3]))+' HACHI', nextDist:secs>0?`${d}d ${h}h`:'Disponible'})
      setRankList(list)
    } catch(e) {}
  }

  const loadPools = async (p: ethers.JsonRpcProvider) => {
  try {
  const ws = await new ethers.Contract(C.poolWLD,POOLWLD,p).getPoolStatus()
  const core = new ethers.Contract(C.core,CORE,p)
  let poolA='—',poolAC='—',poolAF='—',poolC='—',poolCC='—',poolCF='—'
  try { const ps=await core.getPoolStatus(); poolA=fmt(fe(ps[0]))+' SUSHI'; poolAC=fmt(fe(ps[1]))+' SUSHI'; poolAF=fmt(fe(ps[2]))+' SUSHI'; poolC=fmt(fe(ps[3]))+' SUSHI'; poolCC=fmt(fe(ps[4]))+' SUSHI'; poolCF=fmt(fe(ps[5]))+' SUSHI' } catch(e:any) { log('poolStatus err: '+(e.message||'').slice(0,40)) }
  const st = await core.getSalesStats()
  setPoolsData({wldTotal:fmt(fe(ws[0]))+' HACHI', wldComm:fmt(fe(ws[1]))+' HACHI', wldFree:fmt(fe(ws[2]))+' HACHI', wldPaid:fmt(fe(ws[3]))+' HACHI', poolA, poolAC, poolAF, poolC, poolCC, poolCF, wldSales:fmt(fe(st[0]))+' WLD', wldLics:st[2].toString(), sushiLics:st[3].toString(), burned:fmt(fe(st[4]))+' HACHI', licsAvail})
  } catch(e:any) { log('loadPools err: '+(e.message||'error').slice(0,50)) }
  }

  const loadAds = async (p: ethers.JsonRpcProvider) => {
    try {
      const ad = new ethers.Contract(C.adMgr,ADMGR,p)
      const c = await ad.getActiveCampaigns()
      if (!c[0].length) { setCampaigns([]); return }
      const items = await Promise.all(c[0].map(async(id:bigint,i:number) => {
        let canPart=false,waitH=0,reward:bigint=BigInt(0)
        try { const cp=await ad.canParticipate(addr,id); canPart=cp[0]; waitH=Math.ceil(Number(cp[1])/3600); reward=cp[2] } catch(e) {}
        return {id, title:c[1][i], platform:Number(c[2][i]), views:Number(c[3][i]), reward:reward||c[4][i], canPart, waitH}
      }))
      setCampaigns(items)
      try { const prev=await ad.previewCampaign(campType); setCampHPV(fmt(fe(prev[3]))+' HACHI') } catch(e) {}
    } catch(e) {}
  }

  const participateAd = async (id: bigint) => { await execTx('Sumando a la alcancía',C.adMgr,ADMGR,'participate',[id]); loadAds(rpc()); if(addr) loadAll(addr) }

  const loadRefs = async (p: ethers.JsonRpcProvider) => {
    try {
      const rf = new ethers.Contract(C.referral,REFERRAL,p)
      const [info,refB,newB] = await Promise.all([rf.getReferralInfo(addr), rf.currentRefBonus(), rf.currentNewBonus()])
      setRefInfo({
        referrer: info[0]!=='0x0000000000000000000000000000000000000000'?info[0]:'',
        totalRefs: Number(info[1]),
        earned: fmt(fe(info[2]))+' HACHI',
        refBonus: fmt(fe(refB)),
        newBonus: fmt(fe(newB)),
      })
    } catch(e) {}
  }
  const registerReferral = async () => {
    const ref = refInput.trim()
    if (!ethers.isAddress(ref)) { toast_('Dirección de referidor inválida','#f85149'); return }
    try {
      const rf = new ethers.Contract(C.referral,REFERRAL,rpc())
      const [ok,reason] = await rf.canRegister(addr,ref)
      if (!ok) { toast_(reason||'No podés registrarte','#f85149'); return }
      await execTx('Registrando referido',C.referral,REFERRAL,'registerWithReferral',[ref])
      setRefInput(''); loadRefs(rpc())
    } catch(e:any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80),'#f85149') }
  }
  const createCampaign = async () => {
    if (!campTitle||!campUrl) { toast_('Completa todos los campos','#f85149'); return }
    try {
      toast_('Creando campaña...', '#d29922')
  const amt = [pe(5),pe(10),pe(20),pe(50)][campType]
  await sendTxMulti([
  ...buildPermit2Approvals(C.wld, C.adMgr, amt),
  { to: C.adMgr, abi: ADMGR, fnName: 'createCampaign', args: [campType,campTitle,campUrl,campPlatform] },
  ])
      toast_('✓ Campaña creada', '#3fb950')
      setCampTitle(''); setCampUrl(''); loadAds(rpc())
    } catch(e: any) { toast_('Error: '+(e.reason||e.message||'error').slice(0,80), '#f85149') }
  }

  const wldNames = ['🌱 Básica','⚡ Estándar','💎 Premium','🚀 Elite']
  const wldPrices = ['1 WLD','3 WLD','5 WLD','10 WLD']
  const sushiNames = ['🌱 Básica','⚡ Estándar','💎 Premium','🚀 Elite']
  const sushiPrices = ['500 HACHI','2,000 HACHI','5,000 HACHI','10,000 HACHI']

  // PANTALLA DE INICIO DE SESIÓN — se muestra mientras no haya wallet conectada
  if (!connected) {
    return (
      <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#2a1f63 0%,#1d1a52 55%,#2b2c78 100%)',color:'#e6edf3',fontFamily:'Georgia,serif',display:'flex',flexDirection:'column'}}>
        {toast&&<div style={{position:'fixed',top:16,right:16,zIndex:999,padding:'10px 16px',borderRadius:8,background:'#161b22',border:`1px solid ${toast.color}`,color:toast.color,fontSize:13,maxWidth:320}}>{toast.msg}</div>}

        {/* selector de idioma arriba a la derecha */}
        <div style={{display:'flex',justifyContent:'flex-end',gap:4,padding:16}}>
          {(['es','en','pt'] as Lang[]).map(l=><button key={l} onClick={()=>setLang(l)} style={{background:'none',border:`1px solid ${lang===l?'#a78bfa':'#30363d'}`,borderRadius:4,padding:'2px 8px',fontSize:11,cursor:'pointer',color:lang===l?'#e6edf3':'#8b949e'}}>{l.toUpperCase()}</button>)}
        </div>

        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'8px 20px 40px',maxWidth:480,margin:'0 auto',width:'100%'}}>

          {/* HERO */}
          <div style={{fontSize:56,marginBottom:8,filter:'drop-shadow(0 0 20px rgba(232,121,249,.6))'}}>⛏</div>
          <h1 style={{fontSize:34,fontWeight:700,color:'#e879f9',textShadow:'0 0 18px rgba(232,121,249,.5)',margin:'0 0 8px',textAlign:'center'}}>HachiMiner</h1>
          <p style={{fontSize:15,color:'#c4b5fd',fontStyle:'italic',textAlign:'center',margin:'0 0 28px',lineHeight:1.5,maxWidth:360}}>{loginCopy.tagline}</p>

          {/* QUÉ ES */}
          <div style={{...card,width:'100%'}}>
            <div style={cTitle}>{loginCopy.whatTitle}</div>
            <p style={{fontSize:13,color:'#c9d1d9',lineHeight:1.6,margin:0}}>{loginCopy.whatDesc}</p>
          </div>

          {/* FEATURES */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,width:'100%',marginBottom:12}}>
            {loginCopy.features.map((f,i)=>(
              <div key={i} style={{background:'#1e0840',border:'1px solid #5b21b6',borderRadius:10,padding:14,boxShadow:'0 0 12px rgba(124,58,237,.2)'}}>
                <div style={{fontSize:22,marginBottom:6}}>{f.icon}</div>
                <div style={{fontSize:13,fontWeight:700,color:'#e6edf3',marginBottom:3}}>{f.title}</div>
                <div style={{fontSize:11,color:'#8b949e',lineHeight:1.5}}>{f.desc}</div>
              </div>
            ))}
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

          {/* CTA */}
          <button onClick={connectWallet} style={{...btnP,marginTop:8,fontSize:15,padding:'14px 16px'}}>
            {inWA ? loginCopy.ctaWA : loginCopy.cta}
          </button>
          <p style={{fontSize:11,color:'#8b949e',textAlign:'center',marginTop:12,lineHeight:1.5}}>{loginCopy.disclaimer}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#2a1f63 0%,#1d1a52 55%,#2b2c78 100%)',color:'#e6edf3',fontFamily:'Georgia,serif'}}>
      {toast&&<div style={{position:'fixed',top:16,right:16,zIndex:999,padding:'10px 16px',borderRadius:8,background:'#161b22',border:`1px solid ${toast.color}`,color:toast.color,fontSize:13,maxWidth:320}}>{toast.msg}</div>}

      {/* POPUP VERIFICACION WORLD ID */}
      {showVerify&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#1e0840',border:'1px solid #5b21b6',borderRadius:16,padding:32,maxWidth:360,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>🌍</div>
            <div style={{fontWeight:700,fontSize:18,marginBottom:8}}>Verificar World ID</div>
            <div style={{fontSize:13,color:'#9b96c4',marginBottom:24}}>La verificación World ID activa el acumulador de Hachi. Las compras de licencias funcionan sin verificar. Para verificarte, abrí HachiMiner dentro de World App.</div>
            <button onClick={()=>setShowVerify(false)} style={{...btnP,marginBottom:8}}>Entendido</button>
            <button onClick={()=>setShowVerify(false)} style={btnGh}>Cancelar</button>
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
            <button onClick={connectWallet} style={{background:'#7c3aed',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',fontSize:13,fontWeight:600,cursor:'pointer',boxShadow:'0 0 14px rgba(124,58,237,.5)',whiteSpace:'nowrap'}}>{connected?fmtA(addr):t('connect')}</button>
          </div>
        </div>
        {connected&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div style={{display:'flex',gap:16}}>{[['HACHI',hachiB],['WLD',wldB],['SUSHI',sushiB]].map(([l,v])=><div key={l} style={{display:'flex',flexDirection:'column'}}><div style={{fontSize:9,color:'#9b96c4',textTransform:'uppercase',letterSpacing:.5}}>{l}</div><div style={{fontFamily:'monospace',fontSize:13,fontWeight:600}}>{v}</div></div>)}</div>
          <div onClick={()=>!verified&&setShowVerify(true)} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#9b96c4',cursor:'pointer',whiteSpace:'nowrap'}}><div style={{width:7,height:7,borderRadius:'50%',background:verified?'#3fb950':'#6b6494'}}></div><span>{verified?t('verified'):t('not_verified')}</span></div>
        </div>}
      </div>

      {/* NAV */}
      <div style={{background:'#12022a',borderBottom:'1px solid #3b0764',display:'flex',overflowX:'auto',gap:2,padding:'0 12px'}}>
        {(['home','lics','lock','ranking','pools','ads','refs'] as Tab[]).map((v,i)=>{
          const labels=[t('nav_home'),t('nav_lics'),t('nav_lock'),t('nav_rank'),t('nav_pools'),t('nav_ads'),t('nav_refs')]
          return <button key={v} onClick={()=>loadTab(v)} style={{background:'none',border:'none',borderBottom:`2px solid ${tab===v?'#a78bfa':'transparent'}`,color:tab===v?'#a78bfa':'#8b949e',padding:'12px 14px',fontSize:13,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Georgia,serif',textShadow:tab===v?'0 0 8px #a78bfa':''}}>{labels[i]}</button>
        })}
      </div>

      <div style={{maxWidth:480,margin:'0 auto',padding:16}}>

        {tab==='home'&&<div>
          {priceAlert&&<div style={{background:'rgba(248,113,113,.1)',border:'1px solid rgba(248,113,113,.4)',borderRadius:8,padding:12,marginBottom:12,fontSize:13,color:'#f87171',textAlign:'center'}}>⚠ Ventas WLD pausadas — HACHI devaluado ({fmt(wldHachi)} &gt; {MAX_HACHI.toLocaleString()})</div>}
          <div style={card}><div style={cTitle}>Estado del sistema</div>
            {[['Oracle',oracleSt],['1 WLD =',fmt(wldHachi)+' HACHI'],['1 HACHI =',hachiSushi.toFixed(4)+' SUSHI'],['Pool WLD disponible',poolFree],['Licencias WLD disponibles',licsAvail],['Máximo HACHI/WLD',MAX_HACHI.toLocaleString()]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e'}}>{l}</span><span style={{fontFamily:'monospace',fontWeight:600}}>{v}</span></div>)}
          </div>
          <div style={card}><div style={cTitle}>La alcancía de Hachi</div>
            <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12}}>
              <img src="/hachi-cat-savings.png" alt="Hachi el gato ahorrando monedas HACHI" width={88} height={88} style={{borderRadius:14,flexShrink:0,objectFit:'cover',boxShadow:'0 0 18px rgba(124,58,237,.35)'}} />
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:8}}>
                  <div style={{fontSize:26,fontWeight:700,fontFamily:'monospace',color:'#fbbf24'}}>{fmt(piggy.accrued)}</div>
                  <div style={{fontSize:13,color:'#8b949e'}}>HACHI ahorrados</div>
                </div>
                <div style={{height:8,borderRadius:4,background:'#1e0840',overflow:'hidden',marginBottom:6}}>
                  <div style={{height:'100%',width:`${Math.min(100,(piggy.accrued/piggy.min)*100)}%`,background:piggy.canWithdraw?'#34d399':'#fbbf24',transition:'width .3s'}} />
                </div>
                <div style={{fontSize:11,color:'#8b949e'}}>{piggy.canWithdraw?`✓ Podés retirar (mín. ${piggy.min})`:`Necesitás ${fmt(Math.max(0,piggy.min-piggy.accrued))} HACHI más (mín. ${piggy.min})`}</div>
              </div>
            </div>
            <button onClick={withdrawDaily} disabled={!piggy.canWithdraw||!connected} style={{...btnG,width:'100%',padding:'10px 12px',opacity:(!piggy.canWithdraw||!connected)?0.4:1}}>Retirar al wallet</button>
            <div style={{fontSize:10,color:'#8b949e',marginTop:8,lineHeight:1.5}}>Hachi ahorra {piggy.accrual} HACHI por día de forma automática (sin gas) más lo que ganás en tareas. Retirá cuando quieras a partir de {piggy.min} HACHI; pagás gas solo al retirar. El ritmo se reduce a la mitad tras 1M de retiros.</div>
          </div>
          {logs.length>0&&<div style={{background:'#0f0224',border:'1px solid #f87171',borderRadius:8,padding:10,marginBottom:12}}>
            <div style={{fontSize:10,color:'#f87171',marginBottom:4,fontWeight:700}}>DEBUG</div>
            {logs.map((l,i)=><div key={i} style={{fontFamily:'monospace',fontSize:10,color:'#e6edf3',marginBottom:2}}>{l}</div>)}
            <button onClick={()=>setLogs([])} style={{fontSize:10,color:'#8b949e',background:'none',border:'none',cursor:'pointer',marginTop:4}}>Limpiar</button>
          </div>}
          {!connected&&<div style={{textAlign:'center',padding:'32px 16px',color:'#8b949e'}}>
            <div style={{fontSize:32,marginBottom:8}}>👋</div>
            <div style={{fontWeight:600,color:'#e6edf3',marginBottom:4}}>Bienvenido a HachiMiner</div>
            <div>{t('connect_prompt')}</div>
            <button onClick={connectWallet} style={{...btnP,marginTop:16,maxWidth:200}}>{t('connect')}</button>
          </div>}
        </div>}

        {tab==='lics'&&<div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
            <button onClick={()=>setLicTab('wld')} style={licTab==='wld'?btnP:btnGh}>💠 WLD</button>
            <button onClick={()=>setLicTab('sushi')} style={licTab==='sushi'?{...btnG,background:'transparent'}:btnGh}>🍣 SUSHI</button>
          </div>
          {licTab==='wld'&&<div>
            <div style={sLabel}>Comprar licencia WLD</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              {wldNames.map((n,i)=><div key={i} onClick={()=>setSelWLD(i)} style={{...lCard,border:`1px solid ${selWLD===i?'#fbbf24':'#5b21b6'}`,background:selWLD===i?'rgba(251,191,36,.08)':'#1e0840',boxShadow:selWLD===i?'0 0 12px rgba(251,191,36,.3)':'none'}}>
                <div style={{fontSize:11,fontWeight:700}}>{n}{i===3&&<span style={{color:'#34d399'}}> +5%</span>}</div>
                <div style={{fontFamily:'monospace',fontSize:18,fontWeight:700,color:'#34d399'}}>{fmt(Math.round([1,3,5,10][i]*wldHachi*(i===3?1.35:1.3)))}</div>
                <div style={{fontSize:10,color:'#8b949e'}}>HACHI · 3 meses · {i===3?'35%':'30%'}</div>
                <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginTop:6}}>{wldPrices[i]}</div>
              </div>)}
            </div>
            <div style={pBox}>{[['Tipo',wldNames[selWLD]],['Precio',wldPrices[selWLD]],['HACHI base',wldPrev.base],[selWLD===3?'Total ×1.35 (Elite +5%)':'Total ×1.3',wldPrev.total],['HACHI/día',wldPrev.daily],['Mensual',wldPrev.monthly]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace',fontSize:13}}>{v}</span></div>)}</div>
            <button onClick={buyWLD} disabled={!connected||wldHachi>MAX_HACHI} style={{...btnP,opacity:(!connected||wldHachi>MAX_HACHI)?0.4:1}}>{wldHachi>MAX_HACHI?'⚠ Ventas pausadas':`Comprar · ${wldPrices[selWLD]}`}</button>
            <div style={sLabel}>Licencias WLD activas</div>
            {wldLics.length===0?<div style={empty}><div style={{fontSize:28}}>💠</div><div>{t('no_lics')}</div></div>:wldLics.map(({id,l,pend})=><div key={id.toString()} style={card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><strong>{['Básica','Estándar','Premium','Elite'][l[1]]}</strong><div style={{color:l[10]?'#3fb950':'#8b949e'}}>●</div></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Pendiente</span><span style={{color:'#3fb950',fontFamily:'monospace'}}>{fmt(fe(pend))} HACHI</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Vence</span><span style={{fontFamily:'monospace'}}>{new Date(Number(l[7])*1000).toLocaleDateString()}</span></div>
              <button onClick={()=>claimWLD(id)} style={{...btnG,marginTop:8}}>Cobrar HACHI</button>
            </div>)}
          </div>}
          {licTab==='sushi'&&<div>
            {!sushiAccess&&<div style={{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.35)',borderRadius:8,padding:20,textAlign:'center',marginBottom:12}}>
              <div style={{fontSize:28,marginBottom:8}}>🔒</div>
              <div style={{fontWeight:700,color:'#f87171',marginBottom:6}}>{t('access_title')}</div>
              <div style={{fontSize:13,color:'#8b949e'}}>{t('access_desc')}</div>
            </div>}
            {sushiAccess&&<>
              <div style={sLabel}>Comprar licencia HACHI/SUSHI</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                {sushiNames.map((n,i)=><div key={i} onClick={()=>setSelSUSHI(i)} style={{...lCard,border:`1px solid ${selSUSHI===i?'#fbbf24':'#5b21b6'}`,background:selSUSHI===i?'rgba(251,191,36,.08)':'#1e0840'}}>
                  <div style={{fontSize:11,fontWeight:700}}>{n}</div>
                  <div style={{fontFamily:'monospace',fontSize:18,fontWeight:700,color:'#34d399'}}>{fmt(Math.round([500,2000,5000,10000][i]*hachiSushi*1.25))}</div>
                  <div style={{fontSize:10,color:'#8b949e'}}>SUSHI inmediato ×1.25</div>
                  <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginTop:6}}>{sushiPrices[i]}</div>
                </div>)}
              </div>
                <div style={pBox}>{[['Tipo',sushiNames[selSUSHI]],['Precio',sushiPrices[selSUSHI]],['SUSHI base',sushiPrev.base],['Bonus inmediato','+25%'],['Recibís al instante (×1.25)',sushiPrev.total],['Disponibles hoy',sushiPrev.dailyLeft]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace',fontSize:13}}>{v}</span></div>)}</div>
              <button onClick={buySUSHI} style={btnG}>{`Comprar · ${sushiPrices[selSUSHI]}`}</button>
              <div style={{background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.3)',borderRadius:8,padding:12,marginTop:12,fontSize:12,color:'#8b949e',lineHeight:1.5}}>
                <strong style={{color:'#34d399'}}>Intercambio inmediato:</strong> pagás en HACHI y recibís el SUSHI (base + 25%) al instante en tu wallet. Sin esperas ni cobros pendientes.
              </div>
            </>}
          </div>}
        </div>}

        {tab==='lock'&&<div>
          <div style={card}><div style={cTitle}>Tu posición</div>
            {[['Total lockeado',lockData.total],['Tier',lockData.tier],['APY anual',lockData.apy],['APY pendiente',lockData.pending],['Disponible retirar',lockData.unstake]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e'}}>{l}</span><span style={{fontFamily:'monospace',fontWeight:600}}>{v}</span></div>)}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
            <button onClick={claimAPY} style={btnG}>Cobrar APY</button>
            <button onClick={doUnstake} style={btnGh}>Retirar HACHI</button>
          </div>
          <div style={sLabel}>Depositar HACHI</div>
          <input value={depositAmt} onChange={e=>setDepositAmt(e.target.value)} type="number" placeholder="Cantidad de HACHI" style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:14,color:'#e6edf3',width:'100%',marginBottom:8,fontFamily:'monospace'}} />
          <button onClick={doDeposit} style={btnP}>Depositar</button>
          <div style={sLabel}>Mis depósitos</div>
          {lockBatches.length===0?<div style={empty}><div>Sin depósitos aún</div></div>:lockBatches.map((b,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #3b0764',fontSize:12}}><span style={{fontFamily:'monospace'}}>{fmt(b.amount)} HACHI</span><span style={{color:b.ready?'#3fb950':'#8b949e'}}>{b.ready?'✓ Disponible':'Hasta '+b.unlocks.toLocaleDateString()}</span></div>)}
        </div>}

        {tab==='ranking'&&<div>
          <div style={card}><div style={cTitle}>Mis estadísticas</div>
            {[['Mis puntos',rankStats.points],['Mi posición',rankStats.pos],['Premio pendiente',rankStats.reward],['Total ganado',rankStats.earned],['Próximo reparto (15 días)',rankStats.nextDist]].map(([l,v])=><div key={l} style={row}><span style={{color:'#8b949e'}}>{l}</span><span style={{fontFamily:'monospace',fontWeight:600}}>{v}</span></div>)}
          </div>
          <button onClick={claimPrize} style={btnGo}>Cobrar premio</button>
          <div style={sLabel}>Ranking (cada 15 días)</div>
          {rankList.length===0?<div style={empty}><div style={{fontSize:28}}>🏆</div><div>Sin participantes aún</div></div>:rankList.map((e,i)=>{
            const isMe=e.a.toLowerCase()===addr.toLowerCase(),medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`
            return <div key={e.a} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,marginBottom:4,background:'#1e0840',border:`1px solid ${isMe?'#34d399':'#5b21b6'}`}}>
              <div style={{fontFamily:'monospace',fontSize:13,fontWeight:700,width:28}}>{medal}</div>
              <div style={{fontFamily:'monospace',fontSize:12,flex:1}}>{fmtA(e.a)}{isMe&&<span style={{color:'#34d399'}}> (tú)</span>}</div>
              <div style={{fontFamily:'monospace',fontSize:12,fontWeight:700,color:'#fbbf24'}}>{fmt(e.pts)}</div>
            </div>
          })}
        </div>}

        {tab==='pools'&&<div>
          <div style={sLabel}>Estado de pools</div>
          {[['💠 Pool WLD',[['Total',poolsData.wldTotal||'—'],['Reservado',poolsData.wldComm||'—'],['Libre',poolsData.wldFree||'—'],['Total pagado',poolsData.wldPaid||'—'],['Licencias disponibles',poolsData.licsAvail||'—']]],['🍣 Pool A — Ciclos',[['Total',poolsData.poolA||'—'],['Reservado',poolsData.poolAC||'—'],['Libre',poolsData.poolAF||'—']]],['♾️ Pool C — Perp',[['Total',poolsData.poolC||'—'],['Reservado',poolsData.poolCC||'—'],['Libre',poolsData.poolCF||'—']]],['📊 Estadísticas',[['WLD recaudado',poolsData.wldSales||'—'],['Licencias WLD',poolsData.wldLics||'—'],['Licencias SUSHI',poolsData.sushiLics||'—'],['HACHI quemados',poolsData.burned||'—']]]].map(([title,rows]:any)=><div key={title} style={card}><div style={cTitle}>{title}</div>{rows.map(([l,v]:any)=><div key={l} style={row}><span style={{color:'#8b949e',fontSize:12}}>{l}</span><span style={{fontFamily:'monospace'}}>{v}</span></div>)}</div>)}
        </div>}

        {tab==='ads'&&<div>
          <div style={sLabel}>Campañas activas</div>
          {campaigns.length===0?<div style={empty}><div style={{fontSize:28}}>📺</div><div>Sin campañas activas</div></div>:campaigns.map((c:any)=><div key={c.id.toString()} style={{...card,marginBottom:8}}>
            <div style={{fontWeight:600,marginBottom:4}}>{c.title}</div>
            <div style={{display:'flex',gap:12,fontSize:12,color:'#8b949e',marginBottom:8}}><span>{['▶ YouTube','✈ Telegram','𝕏 Twitter'][c.platform]}</span><span>{c.views} vistas</span><span style={{color:'#34d399'}}>{fmt(fe(c.reward))} HACHI/vista</span></div>
            <button onClick={()=>participateAd(c.id)} disabled={!c.canPart||!connected||!verified} style={{...btnG,opacity:(!c.canPart||!connected||!verified)?0.4:1}}>{c.canPart?`Participar · +${fmt(fe(c.reward))} a la alcancía`:c.waitH>0?`En ${c.waitH}h`:'No disponible'}</button>
          </div>)}
          <div style={sLabel}>Publicar anuncio</div>
          <div style={card}><div style={cTitle}>Nueva campaña</div>
            <select value={campType} onChange={e=>setCampType(Number(e.target.value))} style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#e6edf3',width:'100%',marginBottom:8}}><option value={0}>500 vistas — 5 WLD</option><option value={1}>1,000 vistas — 10 WLD</option><option value={2}>2,000 vistas — 20 WLD</option><option value={3}>5,000 vistas — 50 WLD</option></select>
            <input value={campTitle} onChange={e=>setCampTitle(e.target.value)} placeholder="Título del anuncio" style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#e6edf3',width:'100%',marginBottom:8,fontFamily:'monospace'}} />
            <input value={campUrl} onChange={e=>setCampUrl(e.target.value)} placeholder="URL del contenido" style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#e6edf3',width:'100%',marginBottom:8,fontFamily:'monospace'}} />
            <select value={campPlatform} onChange={e=>setCampPlatform(Number(e.target.value))} style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#e6edf3',width:'100%',marginBottom:8}}><option value={0}>▶ YouTube</option><option value={1}>✈ Telegram</option><option value={2}>𝕏 Twitter/X</option></select>
            <div style={{...pBox,marginBottom:12}}><div style={row}><span style={{color:'#8b949e',fontSize:12}}>Costo</span><span style={{fontFamily:'monospace'}}>{[5,10,20,50][campType]} WLD</span></div><div style={row}><span style={{color:'#8b949e',fontSize:12}}>HACHI por vista</span><span style={{fontFamily:'monospace',color:'#34d399'}}>{campHPV}</span></div></div>
            <button onClick={createCampaign} disabled={!connected||!verified||!campTitle||!campUrl} style={{...btnP,opacity:(!connected||!verified||!campTitle||!campUrl)?0.4:1}}>Publicar campaña · {[5,10,20,50][campType]} WLD</button>
          </div>
        </div>}

        {tab==='refs'&&<div>
          <div style={card}><div style={cTitle}>Mi código de referido</div>
            <div style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontFamily:'monospace',fontSize:12,wordBreak:'break-all',marginBottom:8}}>{addr||'Conecta tu wallet'}</div>
            <button onClick={()=>{navigator.clipboard.writeText(addr);toast_('Código copiado','#3fb950')}} style={btnGh}>Copiar código</button>
            <div style={pBox}>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>Mis referidos</span><span style={{fontFamily:'monospace',fontWeight:600}}>{refInfo.totalRefs}</span></div>
              <div style={row}><span style={{color:'#8b949e',fontSize:12}}>HACHI ganado</span><span style={{color:'#3fb950',fontFamily:'monospace'}}>{refInfo.earned}</span></div>
            </div>
          </div>
          {refInfo.referrer?
            <div style={card}><div style={cTitle}>Ya tenés referidor</div>
              <div style={{fontFamily:'monospace',fontSize:12,wordBreak:'break-all',color:'#a78bfa'}}>{refInfo.referrer}</div>
            </div>
          :<>
            <div style={sLabel}>Registrar referido</div>
            <div style={card}>
              <input value={refInput} onChange={e=>setRefInput(e.target.value)} placeholder="Wallet del referidor (0x...)" style={{background:'#12022a',border:'1px solid #5b21b6',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#e6edf3',width:'100%',marginBottom:8,fontFamily:'monospace'}} />
              <div style={pBox}><div style={row}><span style={{color:'#8b949e',fontSize:12}}>Recibes</span><span style={{color:'#3fb950',fontFamily:'monospace'}}>{refInfo.newBonus} HACHI</span></div><div style={row}><span style={{color:'#8b949e',fontSize:12}}>Tu referidor recibe</span><span style={{color:'#a78bfa',fontFamily:'monospace'}}>{refInfo.refBonus} HACHI</span></div></div>
              <button onClick={registerReferral} disabled={!connected} style={{...btnP,opacity:connected?1:0.4}}>Registrar referido</button>
            </div>
          </>}
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
