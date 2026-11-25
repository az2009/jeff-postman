import { useRef, useState } from 'react'
import type { PmEvent } from '@shared/types'
import { CodeEditor } from './CodeEditor'

type Listen = 'prerequest' | 'test'

export function getScript(events: PmEvent[] | undefined, listen: Listen): string {
  return (events ?? [])
    .filter((e) => e.listen === listen)
    .map((e) => (Array.isArray(e.script?.exec) ? e.script.exec.join('\n') : ''))
    .join('\n')
}

/** Troca o código de um evento mantendo os demais campos; código vazio remove o evento. */
export function setScript(events: PmEvent[] | undefined, listen: Listen, code: string): PmEvent[] {
  const list = [...(events ?? [])]
  if (!code.trim()) return list.filter((e) => e.listen !== listen)
  const exec = code.split('\n')
  const i = list.findIndex((e) => e.listen === listen)
  if (i < 0) return [...list, { listen, script: { type: 'text/javascript', exec } }]
  list[i] = { ...list[i], script: { type: 'text/javascript', ...list[i].script, exec } }
  return list.filter((e, j) => j === i || e.listen !== listen)
}

export const hasScripts = (events: PmEvent[] | undefined) => (events ?? []).some((e) => e.script?.exec?.some((l) => l.trim()))

const SNIPPETS: Record<Listen, [string, string][]> = {
  prerequest: [
    ['Get an environment variable', 'pm.environment.get("variable_key");'],
    ['Get a global variable', 'pm.globals.get("variable_key");'],
    ['Get a variable', 'pm.variables.get("variable_key");'],
    ['Get a collection variable', 'pm.collectionVariables.get("variable_key");'],
    ['Set an environment variable', 'pm.environment.set("variable_key", "variable_value");'],
    ['Set a global variable', 'pm.globals.set("variable_key", "variable_value");'],
    ['Set a collection variable', 'pm.collectionVariables.set("variable_key", "variable_value");'],
    ['Clear an environment variable', 'pm.environment.unset("variable_key");'],
    ['Clear a global variable', 'pm.globals.unset("variable_key");'],
    ['Add a header', 'pm.request.headers.add({ key: "X-Header", value: "valor" });'],
    ['Timestamp in a variable', 'pm.variables.set("timestamp", Date.now());'],
    [
      'Send a request',
      'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});'
    ]
  ],
  test: [
    ['Status code: Code is 200', 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});'],
    [
      'Response body: Contains string',
      'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});'
    ],
    [
      'Response body: JSON value check',
      'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});'
    ],
    ['Response body: Is equal to a string', 'pm.test("Body is correct", function () {\n    pm.response.to.have.body("response_body_string");\n});'],
    ['Response headers: Content-Type header check', 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});'],
    ['Response time is less than 200ms', 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});'],
    ['Status code: Successful POST request', 'pm.test("Successful POST request", function () {\n    pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});'],
    ['Status code: Code name has string', 'pm.test("Status code name has string", function () {\n    pm.response.to.have.status("Created");\n});'],
    [
      'Response body: JSON schema',
      'var schema = {\n    type: "object",\n    required: ["id"]\n};\n\npm.test("Schema is valid", function () {\n    pm.response.to.have.jsonSchema(schema);\n});'
    ],
    ['Set an environment variable from the response', 'pm.environment.set("token", pm.response.json().token);'],
    ['Set next request (runner)', 'pm.execution.setNextRequest("request_name");']
  ]
}

/** Editor de scripts no layout do Postman: Pre-request / Post-response à esquerda, snippets à direita. */
export function ScriptsEditor({ events, onChange }: { events: PmEvent[] | undefined; onChange(e: PmEvent[]): void }) {
  const [which, setWhich] = useState<Listen>('prerequest')
  const code = getScript(events, which)
  const latest = useRef(events)
  latest.current = events
  return (
    <div className="scripts-editor">
      <nav className="scripts-nav">
        {(
          [
            ['prerequest', 'Pre-request'],
            ['test', 'Post-response']
          ] as [Listen, string][]
        ).map(([id, label]) => (
          <button key={id} className={`scripts-tab ${which === id ? 'active' : ''}`} onClick={() => setWhich(id)}>
            {label}
            {getScript(events, id).trim() ? <span className="dot-green" /> : null}
          </button>
        ))}
      </nav>
      <div className="scripts-code">
        <CodeEditor
          key={which}
          value={code}
          language="javascript"
          onChange={(v) => onChange(setScript(latest.current, which, v))}
        />
      </div>
      <aside className="snippets">
        <div className="snippets-title">Snippets</div>
        <p className="snippets-hint">
          {which === 'prerequest' ? 'Roda antes do envio.' : 'Roda depois da resposta.'} Use <code>pm.</code> para ver a API.
        </p>
        {SNIPPETS[which].map(([label, snip]) => (
          <button
            key={label}
            className="snippet"
            onClick={() => {
              const cur = getScript(latest.current, which)
              onChange(setScript(latest.current, which, cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${snip}\n` : `${snip}\n`))
            }}
          >
            {label}
          </button>
        ))}
      </aside>
    </div>
  )
}
