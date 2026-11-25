import { useState } from 'react'
import type { ScriptsReport } from '@shared/types'

type Filter = 'all' | 'passed' | 'skipped' | 'failed'

export const testCounts = (r: ScriptsReport | undefined) => {
  const t = r?.tests ?? []
  return { total: t.filter((x) => !x.skipped).length, passed: t.filter((x) => x.passed).length, failed: t.filter((x) => !x.passed && !x.skipped).length, skipped: t.filter((x) => x.skipped).length }
}

/** Aba Test Results: filtro All/Passed/Skipped/Failed, erro de cada teste e erros de script. */
export function TestResults({ report }: { report: ScriptsReport | undefined }) {
  const [filter, setFilter] = useState<Filter>('all')
  const c = testCounts(report)
  const tests = (report?.tests ?? []).filter((t) =>
    filter === 'all' ? true : filter === 'passed' ? t.passed : filter === 'skipped' ? t.skipped : !t.passed && !t.skipped
  )
  if (!report || (report.tests.length === 0 && report.errors.length === 0))
    return <div className="placeholder pad">Nenhum teste nesta requisição. Escreva em Scripts → Post-response, por exemplo: pm.test("Status 200", () =&gt; pm.response.to.have.status(200))</div>
  return (
    <div className="test-results">
      <div className="tr-filters">
        {(
          [
            ['all', `All`],
            ['passed', `Passed (${c.passed})`],
            ['skipped', `Skipped (${c.skipped})`],
            ['failed', `Failed (${c.failed})`]
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button key={id} className={`seg ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {report.errors.map((e, i) => (
        <div key={`e${i}`} className="tr-row error">
          <span className="tr-badge bad">ERROR</span>
          <span>
            Erro no {e.event === 'prerequest' ? 'pre-request' : 'post-response'} script ({e.source}): <span className="mono">{e.error}</span>
          </span>
        </div>
      ))}
      {tests.map((t, i) => (
        <div key={i} className="tr-row">
          <span className={`tr-badge ${t.skipped ? 'skip' : t.passed ? 'ok' : 'bad'}`}>{t.skipped ? 'SKIPPED' : t.passed ? 'PASS' : 'FAIL'}</span>
          <div className="tr-text">
            <span>{t.name}</span>
            {t.error && <span className="tr-err mono">{t.error}</span>}
          </div>
          {t.source !== 'Requisição' && <span className="tr-src">{t.source}</span>}
        </div>
      ))}
    </div>
  )
}
