import type { BodyMode, FormDataEntry, RawLanguage, RequestBody } from '@shared/types'
import { VarInput } from './VarInput'
import { fileName } from '@shared/http'
import { api } from '../api'
import { CodeEditor } from './CodeEditor'
import { KeyValueTable } from './KeyValueTable'
import { prettyJson } from '../format'

const MODES: { id: BodyMode; label: string }[] = [
  { id: 'none', label: 'none' },
  { id: 'formdata', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'raw', label: 'raw' },
  { id: 'file', label: 'binary' }
]

const LANGS: { id: RawLanguage; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'xml', label: 'XML' }
]

const MONACO_LANG: Record<RawLanguage, string> = {
  text: 'plaintext',
  javascript: 'javascript',
  json: 'json',
  html: 'html',
  xml: 'xml'
}

export function BodyEditor({ body, onChange }: { body: RequestBody; onChange(b: RequestBody): void }) {
  const lang = body.options?.raw?.language ?? 'text'
  return (
    <div className="body-editor">
      <div className="body-modes">
        {MODES.map((m) => (
          <label key={m.id} className="radio">
            <input type="radio" name="body-mode" checked={body.mode === m.id} onChange={() => onChange({ ...body, mode: m.id })} />
            {m.label}
          </label>
        ))}
        {body.mode === 'raw' && (
          <>
            <select
              className="lang-select"
              value={lang}
              onChange={(e) => onChange({ ...body, options: { ...body.options, raw: { language: e.target.value as RawLanguage } } })}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
            <div className="spacer" />
            {lang === 'json' && (
              <button className="link" onClick={() => onChange({ ...body, raw: prettyJson(body.raw ?? '') })}>
                Beautify
              </button>
            )}
          </>
        )}
      </div>

      {body.mode === 'none' && <div className="placeholder">This request does not have a body</div>}
      {body.mode === 'raw' && (
        <CodeEditor value={body.raw ?? ''} language={MONACO_LANG[lang]} onChange={(raw) => onChange({ ...body, raw })} />
      )}
      {body.mode === 'urlencoded' && (
        <KeyValueTable title="" rows={body.urlencoded ?? []} onChange={(urlencoded) => onChange({ ...body, urlencoded })} />
      )}
      {body.mode === 'formdata' && (
        <FormDataTable rows={body.formdata ?? []} onChange={(formdata) => onChange({ ...body, formdata })} />
      )}
      {body.mode === 'file' && (
        <div className="binary">
          <button
            className="btn small"
            onClick={async () => {
              const [src] = await api.invoke('dialog:openFiles', false)
              if (src) onChange({ ...body, file: { src } })
            }}
          >
            {body.file?.src ? 'Change file' : 'Select file'}
          </button>
          {body.file?.src && (
            <>
              <span className="file-chip" title={body.file.src}>{fileName(body.file.src)}</span>
              <button className="icon-btn" title="Remove" onClick={() => onChange({ ...body, file: { src: null } })}>×</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FormDataTable({ rows, onChange }: { rows: FormDataEntry[]; onChange(r: FormDataEntry[]): void }) {
  const display: FormDataEntry[] = [...rows, { key: '', type: 'text', value: '' }]
  const edit = (i: number, patch: Partial<FormDataEntry>) => {
    const next = display.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange(next.filter((r, idx) => idx < next.length - 1 || r.key || r.value || r.src || r.description))
  }
  return (
    <table className="kv-table">
      <thead>
        <tr>
          <th className="kv-check" />
          <th>Key</th>
          <th className="fd-type">Type</th>
          <th>Value</th>
          <th>Description</th>
          <th className="kv-del" />
        </tr>
      </thead>
      <tbody>
        {display.map((r, i) => {
          const placeholder = i === display.length - 1
          const srcs = Array.isArray(r.src) ? r.src : r.src ? [r.src] : []
          return (
            <tr key={i} className={r.disabled ? 'disabled' : ''}>
              <td className="kv-check">
                {!placeholder && <input type="checkbox" checked={!r.disabled} onChange={(e) => edit(i, { disabled: !e.target.checked })} />}
              </td>
              <td>
                <VarInput value={r.key} placeholder="Key" onChange={(v) => edit(i, { key: v })} />
              </td>
              <td className="fd-type">
                <select
                  value={r.type}
                  onChange={(e) =>
                    edit(i, e.target.value === 'file' ? { type: 'file', value: undefined, src: [] } : { type: 'text', src: undefined, value: '' })
                  }
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td>
                {r.type === 'file' ? (
                  <div className="fd-files">
                    {srcs.map((s) => (
                      <span key={s} className="file-chip" title={s}>
                        {fileName(s)}
                        <button onClick={() => edit(i, { src: srcs.filter((x) => x !== s) })}>×</button>
                      </span>
                    ))}
                    <button
                      className="link"
                      onClick={async () => {
                        const picked = await api.invoke('dialog:openFiles', true)
                        if (picked.length) edit(i, { src: [...srcs, ...picked.filter((p) => !srcs.includes(p))] })
                      }}
                    >
                      Select files
                    </button>
                  </div>
                ) : (
                  <VarInput value={r.value ?? ''} placeholder="Value" onChange={(v) => edit(i, { value: v })} />
                )}
              </td>
              <td>
                <input value={r.description ?? ''} placeholder="Description" onChange={(e) => edit(i, { description: e.target.value })} />
              </td>
              <td className="kv-del">
                {!placeholder && (
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
  )
}
