import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DYNAMIC, findVars, isDynamic, type Lookup } from '@shared/variables'

/** Variáveis da aba ativa; sem provedor, o campo funciona como input comum. */
export const VarContext = createContext<Lookup | null>(null)

const SCOPE_LABEL: Record<string, string> = {
  global: 'Global',
  collection: 'Collection',
  environment: 'Environment',
  data: 'Data',
  local: 'Local'
}

interface Props {
  value: string
  onChange(v: string): void
  placeholder?: string
  className?: string
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void
  spellCheck?: boolean
  autoFocus?: boolean
}

interface Suggestion {
  name: string
  detail: string
  scope: string
}

const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

export function VarInput({ value, onChange, placeholder, className, onKeyDown, spellCheck = false, autoFocus }: Props) {
  const lookup = useContext(VarContext)
  const inputRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [hover, setHover] = useState<{ name: string; x: number } | null>(null)
  const [ac, setAc] = useState<{ start: number; query: string; x: number; index: number } | null>(null)

  const vars = useMemo(() => findVars(value), [value])

  // copia fonte e recuos do input para a camada de trás
  useLayoutEffect(() => {
    const i = inputRef.current
    const b = backRef.current
    if (!i || !b) return
    const cs = getComputedStyle(i)
    b.style.font = cs.font
    b.style.letterSpacing = cs.letterSpacing
    b.style.paddingLeft = cs.paddingLeft
    b.style.paddingRight = cs.paddingRight
  }, [className])

  const syncScroll = () => setScroll(inputRef.current?.scrollLeft ?? 0)

  /** posição x (px, relativa ao input) do caractere `index` */
  const xOf = (index: number) => {
    const i = inputRef.current
    if (!i || !canvas) return 0
    const ctx = canvas.getContext('2d')!
    const cs = getComputedStyle(i)
    ctx.font = cs.font
    return parseFloat(cs.paddingLeft) + ctx.measureText(value.slice(0, index)).width - i.scrollLeft
  }

  /** índice do caractere sob o x do mouse */
  const indexAt = (clientX: number) => {
    const i = inputRef.current
    if (!i || !canvas) return -1
    const ctx = canvas.getContext('2d')!
    const cs = getComputedStyle(i)
    ctx.font = cs.font
    const x = clientX - i.getBoundingClientRect().left - parseFloat(cs.paddingLeft) + i.scrollLeft
    let lo = 0
    let hi = value.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ctx.measureText(value.slice(0, mid + 1)).width < x) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const suggestions: Suggestion[] = useMemo(() => {
    if (!ac) return []
    const q = ac.query.toLowerCase()
    const out: Suggestion[] = []
    if (lookup)
      for (const [name, v] of lookup)
        if (name.toLowerCase().includes(q)) out.push({ name, scope: SCOPE_LABEL[v.scope], detail: v.secret ? '••••••' : v.value })
    if (q.startsWith('$') || q === '')
      for (const [name, d] of Object.entries(DYNAMIC))
        if (name.toLowerCase().includes(q) && !lookup?.has(name)) out.push({ name, scope: 'Dynamic', detail: d.doc })
    return out.slice(0, 50)
  }, [ac, lookup])

  const updateAc = (text: string, caret: number) => {
    if (!lookup) return setAc(null)
    const before = text.slice(0, caret)
    const m = /\{\{([^{}\s]*)$/.exec(before)
    if (!m) return setAc(null)
    const start = before.length - m[0].length
    setAc((old) => ({ start, query: m[1], x: 0, index: old && old.start === start ? Math.min(old.index, 49) : 0 }))
  }

  const accept = (name: string) => {
    if (!ac) return
    const i = inputRef.current!
    const caret = i.selectionStart ?? value.length
    let after = value.slice(caret)
    if (after.startsWith('}}')) after = after.slice(2)
    const insert = `{{${name}}}`
    const next = value.slice(0, ac.start) + insert + after
    onChange(next)
    setAc(null)
    const pos = ac.start + insert.length
    requestAnimationFrame(() => {
      i.focus()
      i.setSelectionRange(pos, pos)
      syncScroll()
    })
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (ac && suggestions.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setAc({ ...ac, index: (ac.index + 1) % suggestions.length })
      if (e.key === 'ArrowUp') return e.preventDefault(), setAc({ ...ac, index: (ac.index - 1 + suggestions.length) % suggestions.length })
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), accept(suggestions[Math.min(ac.index, suggestions.length - 1)].name)
      if (e.key === 'Escape') return e.preventDefault(), setAc(null)
    }
    onKeyDown?.(e)
  }

  const info = hover ? lookup?.get(hover.name) : undefined
  const hoverDynamic = hover && !info && isDynamic(hover.name)

  return (
    <div className={`var-input ${className ?? ''}`}>
      <div className="var-back" ref={backRef} aria-hidden>
        <span style={{ transform: `translateX(${-scroll}px)` }}>{renderHighlighted(value, vars, lookup)}</span>
      </div>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={spellCheck}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value)
          updateAc(e.target.value, e.target.selectionStart ?? e.target.value.length)
          syncScroll()
        }}
        onKeyDown={handleKey}
        onKeyUp={syncScroll}
        onScroll={syncScroll}
        onSelect={syncScroll}
        onBlur={() => setTimeout(() => setAc(null), 150)}
        onMouseMove={(e) => {
          if (!lookup || vars.length === 0) return hover && setHover(null)
          const idx = indexAt(e.clientX)
          const v = vars.find((x) => idx >= x.start && idx < x.end)
          if (!v) return hover && setHover(null)
          if (hover?.name !== v.name) setHover({ name: v.name, x: Math.max(0, xOf(v.start)) })
        }}
        onMouseLeave={() => setHover(null)}
      />
      {hover && lookup && (
        <div className="var-tip" style={{ left: Math.min(hover.x, (inputRef.current?.clientWidth ?? 300) - 40) }}>
          {info ? (
            <>
              <div className="var-tip-head">
                <span className={`scope-badge s-${info.scope}`}>{SCOPE_LABEL[info.scope]}</span>
                <b>{hover.name}</b>
              </div>
              <div className="var-tip-value">{info.secret ? '••••••••' : info.value || <i>(vazio)</i>}</div>
            </>
          ) : hoverDynamic ? (
            <>
              <div className="var-tip-head">
                <span className="scope-badge s-dynamic">Dynamic</span>
                <b>{hover.name}</b>
              </div>
              <div className="var-tip-value msg">{DYNAMIC[hover.name].doc}, gerado a cada envio</div>
            </>
          ) : (
            <>
              <div className="var-tip-head">
                <span className="scope-badge s-unresolved">Unresolved</span>
                <b>{hover.name}</b>
              </div>
              <div className="var-tip-value msg">Não existe no environment ativo, na collection nem em Globals.</div>
            </>
          )}
        </div>
      )}
      {ac && suggestions.length > 0 && (
        <div className="var-ac" style={{ left: Math.max(0, Math.min(xOf(ac.start), (inputRef.current?.clientWidth ?? 300) - 280)) }}>
          {suggestions.map((sg, i) => (
            <div
              key={sg.name}
              className={`var-ac-row ${i === ac.index ? 'active' : ''}`}
              onMouseDown={(e) => (e.preventDefault(), accept(sg.name))}
              onMouseEnter={() => setAc({ ...ac, index: i })}
            >
              <span className={`scope-badge s-${sg.scope.toLowerCase()}`}>{sg.scope[0]}</span>
              <span className="var-ac-name">{sg.name}</span>
              <span className="var-ac-detail">{sg.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function renderHighlighted(text: string, vars: ReturnType<typeof findVars>, lookup: Lookup | null): ReactNode {
  if (!vars.length || !lookup) return text
  const out: ReactNode[] = []
  let pos = 0
  for (const v of vars) {
    if (v.start > pos) out.push(text.slice(pos, v.start))
    const ok = lookup.has(v.name) || isDynamic(v.name)
    out.push(
      <span key={v.start} className={ok ? 'var-ok' : 'var-bad'}>
        {text.slice(v.start, v.end)}
      </span>
    )
    pos = v.end
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}
