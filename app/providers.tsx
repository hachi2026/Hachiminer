'use client'

import { MiniKit } from '@worldcoin/minikit-js'
import { useEffect } from 'react'

export function MiniKitProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    MiniKit.install('app_faaadf7d4dc1285275a436a8cac18e69')
  }, [])

  return <>{children}</>
}
