import { useCallback, useEffect, useState } from 'react'
import type React from 'react'

function load(key: string, def: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : def
  } catch {
    return def
  }
}

/**
 * Largura arrastável por uma alça vertical, lembrada entre aberturas do app.
 * `side`: 'left' quando o painel fica à esquerda da alça (cresce para a direita, como a barra lateral);
 * 'right' quando fica à direita da alça (cresce para a esquerda, como o detalhe do Runner).
 */
export function useResizableWidth(key: string, def: number, min: number, maxFraction: number, side: 'left' | 'right') {
  const clamp = useCallback((w: number) => Math.round(Math.max(min, Math.min(w, Math.max(min, window.innerWidth * maxFraction)))), [min, maxFraction])
  const [width, setWidth] = useState(() => clamp(load(key, def)))
  // janela mudou de tamanho: a largura gravada, dentro do limite da janela de agora (o gravado não muda)
  useEffect(() => {
    const onResize = () => setWidth(clamp(load(key, def)))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp, key, def])

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width
    let last = w0
    document.body.classList.add('col-resizing')
    const move = (ev: MouseEvent) => {
      last = clamp(side === 'left' ? w0 + (ev.clientX - x0) : w0 - (ev.clientX - x0))
      setWidth(last)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('col-resizing')
      try {
        localStorage.setItem(key, String(last))
      } catch {
        /* sem armazenamento: só não lembra */
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** duplo clique na alça volta ao tamanho padrão */
  const reset = () => {
    setWidth(clamp(def))
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignora */
    }
  }

  return { width, onMouseDown, reset }
}
