import { useMemo, useState } from 'react'
import type { KeyValue } from '@shared/types'
import { Icon } from '../icons'
import { lookupFor, useStore, type OpenTab } from '../store'
import { VarContext, VarInput } from './VarInput'

const TITLE: Record<string, string> = { environment: 'Environment', globals: 'Globals', collection: 'Collection variables' }

/** Editor de variáveis no estilo do Postman: tabela com Variable, Type e Value, filtro e Save. */
export function VariablesEditor({ tab }: { tab: OpenTab }) {
  const vars = tab.vars!
  const update = useStore((s) => s.updateVars)
  const save = useStore((s) => s.saveActive)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const setActive = useStore((s) => s.setActiveEnv)
  const globals = useStore((s) => s.globals)
  const collections = useStore((s) => s.collections)
  const environments = useStore((s) => s.environments)
  const [filter, setFilter] = useState('')
  const [reveal, setReveal] = useState<Record<number, boolean>>({})

  const scope = vars.scope
  const isEnv = scope.type === 'environment'
  const lookup = useMemo(
    () =>
      lookupFor(
        { globals, collections, environments, activeEnvId: isEnv ? scope.id : activeEnvId },
        scope.type === 'collection' ? scope.id : null
      ),
    [globals, collections, environments, activeEnvId, isEnv, scope]
  )

  const rows: KeyValue[] = [...vars.values, { key: '', value: '', type: 'default' }]
  const set = (i: number, patch: Partial<KeyValue>) =>
    update((v) => {
      const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
      return { ...v, values: next.filter((r, idx) => idx < next.length - 1 || r.key || r.value) }
    })
  const remove = (i: number) => update((v) => ({ ...v, values: v.values.filter((_, idx) => idx !== i) }))
  const q = filter.trim().toLowerCase()

  return (
    <VarContext.Provider value={lookup}>
      <div className="vars-editor">
        <div className="vars-head">
          <span className="vars-kind">
            <Icon name={scope.type === 'globals' ? 'globe' : scope.type === 'collection' ? 'collections' : 'environments'} size={16} />
            {TITLE[scope.type]}
          </span>
          {scope.type === 'globals' ? (
            <span className="vars-title">Globals</span>
          ) : isEnv ? (
            <input className="vars-title edit" value={vars.name} onChange={(e) => update((v) => ({ ...v, name: e.target.value }))} />
          ) : (
            <span className="vars-title">{vars.name}</span>
          )}
          <div className="spacer" />
          {isEnv && (
            <button
              className={`btn small ${activeEnvId === scope.id ? 'ghost active-env' : 'ghost'}`}
              onClick={() => setActive(activeEnvId === scope.id ? null : scope.id)}
              title="Usar este environment nas requisições"
            >
              <Icon name="check" size={14} /> {activeEnvId === scope.id ? 'Active' : 'Set active'}
            </button>
          )}
          <div className="search small">
            <Icon name="search" size={13} />
            <input placeholder="Filter variables" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {scope.type !== 'collection' && (
            <button
              className="btn ghost"
              title={tab.dirty ? 'Salve antes de exportar' : 'Exportar no formato do Postman'}
              disabled={tab.dirty}
              onClick={() => useStore.getState().exportEnvironment(scope.type === 'environment' ? scope.id : null)}
            >
              Export
            </button>
          )}
          <button className="btn ghost" disabled={!tab.dirty} onClick={() => save()} title="Ctrl+S">
            Save
          </button>
        </div>

        <p className="vars-hint">
          {scope.type === 'globals'
            ? 'Globals valem em todas as requisições, com a menor precedência.'
            : scope.type === 'collection'
              ? 'Valem nas requisições desta collection; o environment ativo vence quando o nome é igual.'
              : 'Valem quando este environment está ativo e vencem as variáveis de collection e Globals.'}{' '}
          Use como <code>{'{{nome}}'}</code> na URL, nos headers e no corpo.
        </p>

        <div className="vars-table-wrap">
          <table className="kv-table vars-table">
            <thead>
              <tr>
                <th className="kv-check" />
                <th>Variable</th>
                <th className="vt-type">Type</th>
                <th>Value</th>
                <th className="kv-del" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const placeholder = i === rows.length - 1
                if (q && !placeholder && !r.key.toLowerCase().includes(q)) return null
                const secret = r.type === 'secret'
                return (
                  <tr key={i} className={r.disabled ? 'disabled' : ''}>
                    <td className="kv-check">
                      {!placeholder && <input type="checkbox" checked={!r.disabled} onChange={(e) => set(i, { disabled: !e.target.checked })} />}
                    </td>
                    <td>
                      <input value={r.key} placeholder="Add new variable" onChange={(e) => set(i, { key: e.target.value })} />
                    </td>
                    <td className="vt-type">
                      <select value={r.type ?? 'default'} onChange={(e) => set(i, { type: e.target.value as 'default' | 'secret' })}>
                        <option value="default">default</option>
                        <option value="secret">secret</option>
                      </select>
                    </td>
                    <td>
                      <div className="vt-value">
                        {secret && !reveal[i] ? (
                          <input type="password" value={r.value} placeholder="Value" onChange={(e) => set(i, { value: e.target.value })} />
                        ) : (
                          <VarInput value={r.value} placeholder="Value" onChange={(v) => set(i, { value: v })} />
                        )}
                        {secret && (
                          <button className="icon-btn" title={reveal[i] ? 'Ocultar' : 'Mostrar'} onClick={() => setReveal((m) => ({ ...m, [i]: !m[i] }))}>
                            <Icon name="eye" size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="kv-del">
                      {!placeholder && (
                        <button className="icon-btn" title="Delete" onClick={() => remove(i)}>
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
      </div>
    </VarContext.Provider>
  )
}
