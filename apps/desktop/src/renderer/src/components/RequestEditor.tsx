import { useMemo, useState } from 'react'
import { VarInput } from './VarInput'
import { looksLikeCurl, parseCurl } from '@shared/curl'
import { pathVarNames } from '@shared/variables'
import { HTTP_METHODS, type HttpMethod } from '@shared/types'
import { activeBody, autoHeaders, userOverrides } from '@shared/http'
import { KeyValueTable } from './KeyValueTable'
import { BodyEditor } from './BodyEditor'
import { itemPath, methodClass, parseQuery, useStore, withQuery, type OpenTab, type RequestTab } from '../store'

const SUB_TABS: { id: RequestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'auth', label: 'Authorization' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'settings', label: 'Settings' }
]

export function RequestEditor({ tab }: { tab: OpenTab }) {
  const update = useStore((s) => s.updateActive)
  const setSubTab = useStore((s) => s.setSubTab)
  const save = useStore((s) => s.saveActive)
  const send = useStore((s) => s.sendActive)
  const cancel = useStore((s) => s.cancelActive)
  const version = useStore((s) => s.appVersion)
  const collectionName = useStore((s) => s.collections.find((c) => c.id === tab.collectionId)?.name)
  const colItems = useStore((s) => (tab.collectionId ? s.items[tab.collectionId] : undefined))
  const folders = useMemo(() => itemPath(colItems ?? [], tab.itemId), [colItems, tab.itemId])
  const { request } = tab.doc
  const params = parseQuery(request.url.raw)
  const pathVars = pathVarNames(request.url.raw)
  const loading = tab.run?.state === 'loading'
  const auto = autoHeaders(tab.doc, version)
  const overridden = userOverrides(request.header)

  const counts: Partial<Record<RequestTab, number>> = {
    params: params.length + (request.url.query?.length ?? 0) + pathVars.length,
    headers: request.header.filter((h) => !h.disabled && h.key).length + auto.filter((h) => !overridden.has(h.key.toLowerCase())).length
  }

  return (
    <div className="editor">
      <div className="breadcrumb">
        <span className="crumb-muted">{collectionName ? [collectionName, ...folders].join(' / ') : 'HTTP'} /</span>
        <input
          className="crumb-name"
          value={tab.doc.name}
          onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
        />
        <div className="spacer" />
        <button className="btn ghost" disabled={!!tab.itemId && !tab.dirty} onClick={() => save()} title="Ctrl+S">
          Save
        </button>
      </div>

      <div className="url-bar">
        <select
          className={`method-select ${methodClass(request.method)}`}
          value={request.method}
          onChange={(e) => update((d) => ({ ...d, request: { ...d.request, method: e.target.value as HttpMethod } }))}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <VarInput
          className="url-input"
          placeholder="Enter URL or paste text"
          value={request.url.raw}
          onChange={(raw) =>
            update((d) => {
              if (looksLikeCurl(raw)) {
                try {
                  const c = parseCurl(raw)
                  return { ...d, request: c.request, name: d.name === 'Untitled Request' ? c.name : d.name }
                } catch {
                  // não é cURL completo ainda: segue como texto
                }
              }
              return { ...d, request: { ...d.request, url: { ...d.request.url, raw } } }
            })
          }
          onKeyDown={(e) => e.key === 'Enter' && !e.ctrlKey && send()}
        />
        {loading ? (
          <button className="btn send cancel" onClick={cancel}>Cancel</button>
        ) : (
          <button className="btn primary send" disabled={!request.url.raw.trim()} onClick={() => send()} title="Ctrl+Enter">
            Send
          </button>
        )}
      </div>

      <div className="subtabs">
        {SUB_TABS.map((t) => (
          <button key={t.id} className={`subtab ${tab.subTab === t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)}>
            {t.label}
            {counts[t.id] ? <span className="count">({counts[t.id]})</span> : null}
            {t.id === 'body' && activeBody(request.body) ? <span className="dot-green" /> : null}
          </button>
        ))}
      </div>

      <div className={`subtab-body ${tab.subTab === 'body' ? 'fill' : ''}`}>
        {tab.subTab === 'params' && (
          <>
            <KeyValueTable
              title="Query Params"
              rows={[...params, ...(request.url.query ?? []).map((q) => ({ key: q.key, value: q.value ?? '', disabled: true }))]}
              onChange={(rows) =>
                update((d) => {
                  const off = rows.filter((r) => r.disabled).map((r) => ({ key: r.key, value: r.value, disabled: true }))
                  return {
                    ...d,
                    request: {
                      ...d.request,
                      url: { ...d.request.url, raw: withQuery(d.request.url.raw, rows.filter((r) => !r.disabled)), query: off.length ? off : undefined }
                    }
                  }
                })
              }
            />
            {pathVars.length > 0 && (
              <KeyValueTable
                title="Path Variables"
                fixedKeys
                rows={pathVars.map((k) => request.url.variable?.find((v) => v.key === k) ?? { key: k, value: '' })}
                onChange={(rows) =>
                  update((d) => ({
                    ...d,
                    request: {
                      ...d.request,
                      url: {
                        ...d.request.url,
                        variable: [...(d.request.url.variable ?? []).filter((v) => !pathVars.includes(v.key)), ...rows]
                      }
                    }
                  }))
                }
              />
            )}
          </>
        )}
        {tab.subTab === 'headers' && (
          <HeadersTab
            tab={tab}
            hidden={auto.map((h) => ({ ...h, disabled: overridden.has(h.key.toLowerCase()) }))}
            onChange={(rows) => update((d) => ({ ...d, request: { ...d.request, header: rows } }))}
          />
        )}
        {tab.subTab === 'body' && (
          <BodyEditor
            body={request.body ?? { mode: 'none' }}
            onChange={(body) => update((d) => ({ ...d, request: { ...d.request, body } }))}
          />
        )}
        {tab.subTab === 'auth' && <Placeholder text="Basic Auth, Bearer, API Key, OAuth 1.0 e OAuth 2.0 entram na fase 5." />}
        {tab.subTab === 'scripts' && <Placeholder text="Pre-request e Post-response com a API pm entram na fase 6." />}
        {tab.subTab === 'settings' && <Placeholder text="Timeout, redirects e SSL entram na fase 9." />}
      </div>
    </div>
  )
}

function HeadersTab({
  tab,
  hidden,
  onChange
}: {
  tab: OpenTab
  hidden: { key: string; value: string; disabled?: boolean }[]
  onChange(rows: OpenTab['doc']['request']['header']): void
}) {
  const [show, setShow] = useState(false)
  const visibleAuto = hidden.filter((h) => !h.disabled).length
  return (
    <>
      <div className="hidden-toggle">
        <button className="link" onClick={() => setShow((s) => !s)}>
          {show ? 'Hide auto-generated headers' : `${visibleAuto} hidden`}
        </button>
      </div>
      {show && (
        <table className="kv-table ro auto-headers">
          <tbody>
            {hidden.map((h) => (
              <tr key={h.key} className={h.disabled ? 'disabled' : ''} title={h.disabled ? 'Substituído por um header seu' : ''}>
                <td className="kv-check">
                  <input type="checkbox" checked={!h.disabled} readOnly disabled />
                </td>
                <td>{h.key}</td>
                <td className="mono">{h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <KeyValueTable title="Headers" rows={tab.doc.request.header} onChange={onChange} />
    </>
  )
}

function Placeholder({ text }: { text: string }) {
  return <div className="placeholder">{text}</div>
}
