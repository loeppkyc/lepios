'use client'

import { useState, useEffect } from 'react'

const KEY = 'lepios_dev_mode'
const EVENT = 'lepios:devmode'

export function useDevMode(): [boolean, () => void] {
  const [devMode, setDevMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    function onToggle(e: Event) {
      setDevMode((e as CustomEvent<boolean>).detail)
    }
    window.addEventListener(EVENT, onToggle)
    return () => window.removeEventListener(EVENT, onToggle)
  }, [])

  function toggle() {
    const next = !devMode
    setDevMode(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
      window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
    } catch {}
  }

  return [devMode, toggle]
}
