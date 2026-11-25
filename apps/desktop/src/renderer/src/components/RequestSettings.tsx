import type { RequestDoc } from '@shared/types'
import { Toggle } from './Toggle'

type Tri = 'default' | 'on' | 'off'

/** Aba Settings da requisição (protocolProfileBehavior do Postman). Sem valor = usa o padrão do app. */
export function RequestSettings({ doc, onChange }: { doc: RequestDoc; onChange(ppb: Record<string, unknown> | undefined): void }) {
  const ppb = (doc.protocolProfileBehavior ?? {}) as Record<string, unknown>
  const set = (k: string, v: unknown) => {
    const n = { ...ppb }
    if (v === undefined) delete n[k]
    else n[k] = v
    onChange(Object.keys(n).length ? n : undefined)
  }
  const tri = (k: string): Tri => (ppb[k] === true ? 'on' : ppb[k] === false ? 'off' : 'default')
  const TriSel = ({ k }: { k: string }) => (
    <select className="tri" value={tri(k)} onChange={(e) => set(k, e.target.value === 'default' ? undefined : e.target.value === 'on')}>
      <option value="default">Padrão do app</option>
      <option value="on">Ligado</option>
      <option value="off">Desligado</option>
    </select>
  )
  return (
    <div className="req-settings">
      <Row label="Enable SSL certificate verification" hint="Verifica o certificado do servidor. Desligue para certificados autoassinados.">
        <TriSel k="strictSSL" />
      </Row>
      <Row label="Automatically follow redirects" hint="Segue respostas 3xx.">
        <TriSel k="followRedirects" />
      </Row>
      <Row label="Follow original HTTP method" hint="Mantém o método (ex.: POST) ao seguir 301/302 em vez de trocar por GET.">
        <Toggle value={ppb.followOriginalHttpMethod === true} onChange={(v) => set('followOriginalHttpMethod', v || undefined)} />
      </Row>
      <Row label="Maximum number of redirects" hint="Vazio = padrão do app.">
        <input
          type="number"
          min={0}
          max={50}
          className="num"
          value={typeof ppb.maxRedirects === 'number' ? ppb.maxRedirects : ''}
          placeholder="padrão"
          onChange={(e) => set('maxRedirects', e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))}
        />
      </Row>
      <Row label="Disable cookie jar" hint="Não envia nem guarda cookies nesta requisição.">
        <Toggle value={ppb.disableCookies === true} onChange={(v) => set('disableCookies', v || undefined)} />
      </Row>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="opt">
      <div className="opt-label">
        <span>{label}</span>
        <small>{hint}</small>
      </div>
      <div className="opt-ctl">{children}</div>
    </div>
  )
}
