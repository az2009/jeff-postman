import { useState } from 'react'
import { VarInput } from './VarInput'
import type { KeyValue } from '@shared/types'

interface Props {
  title: string
  rows: KeyValue[]
  onChange(rows: KeyValue[]): void
  /** chaves vêm de fora (path variables): sem linha nova, sem apagar, sem editar a chave */
  fixedKeys?: boolean
}

/** Tabela chave/valor com checkbox, descrição, linha vazia no fim e Bulk Edit. */
export function KeyValueTable({ title, rows, onChange, fixedKeys }: Props) {
  const [bulk, setBulk] = useState(false)
  const display = fixedKeys ? rows : [...rows, { key: '', value: '', description: '' }]

  const edit = (i: number, patch: Partial<KeyValue>) => {
    const next = display.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange(fixedKeys ? next : next.filter((r, idx) => idx < next.length - 1 || r.key || r.value || r.description))
  }

  if (bulk) {
    const text = rows.map((r) => `${r.disabled ? '//' : ''}${r.key}:${r.value}`).join('\n')
    return (
      <div className="kv">
        <div className="kv-head">
          <span>{title}</span>
          <button className="link" onClick={() => setBulk(false)}>Key-Value Edit</button>
        </div>
        <textarea
          className="bulk"
          defaultValue={text}
          spellCheck={false}
          onBlur={(e) =>
            onChange(
              e.target.value
                .split('\n')
                .filter((l) => l.trim())
                .map((l) => {
                  const disabled = l.startsWith('//')
                  const line = disabled ? l.slice(2) : l
                  const c = line.indexOf(':')
                  return c < 0
                    ? { key: line.trim(), value: '', disabled }
                    : { key: line.slice(0, c).trim(), value: line.slice(c + 1).trim(), disabled }
                })
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="kv">
      <div className="kv-head">
        <span>{title}</span>
        {!fixedKeys && (
          <button className="link" onClick={() => setBulk(true)}>
            Bulk Edit
          </button>
        )}
      </div>
      <table className="kv-table">
        <thead>
          <tr>
            <th className="kv-check" />
            <th>Key</th>
            <th>Value</th>
            <th>Description</th>
            <th className="kv-del" />
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => {
            const placeholder = !fixedKeys && i === display.length - 1
            return (
              <tr key={i} className={r.disabled ? 'disabled' : ''}>
                <td className="kv-check">
                  {!placeholder && !fixedKeys && (
                    <input type="checkbox" checked={!r.disabled} onChange={(e) => edit(i, { disabled: !e.target.checked })} />
                  )}
                </td>
                <td>
                  {fixedKeys ? (
                    <input value={r.key} readOnly className="ro-key" />
                  ) : (
                    <VarInput value={r.key} placeholder="Key" onChange={(v) => edit(i, { key: v })} />
                  )}
                </td>
                <td>
                  <VarInput value={r.value} placeholder="Value" onChange={(v) => edit(i, { value: v })} />
                </td>
                <td>
                  <input
                    value={r.description ?? ''}
                    placeholder="Description"
                    onChange={(e) => edit(i, { description: e.target.value })}
                  />
                </td>
                <td className="kv-del">
                  {!placeholder && !fixedKeys && (
                    <button className="icon-btn" title="Delete" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
