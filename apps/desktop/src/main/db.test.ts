import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { Repo } from './db'
import { exportCollection, parsePostman } from '@shared/postman'
import { canon, sample } from '@shared/postman.fixtures'

/** importar no SQLite e exportar de volta tem de dar o mesmo conteúdo */
function viaDb(json: any) {
  const repo = new Repo(':memory:')
  const p = parsePostman(json)
  if (p.kind !== 'collection') throw new Error('não é collection')
  const c = repo.importCollection(p.data)
  const out = exportCollection(repo.exportCollectionData(c.id), '2.1')
  return { repo, c, out }
}

describe('Repo: importar e exportar collection', () => {
  it('amostra completa', () => {
    const { repo, c, out } = viaDb(sample)
    expect(canon(out)).toEqual(canon(sample))
    // a árvore aparece certa no app
    const items = repo.listItems(c.id)
    expect(items.filter((i) => i.kind === 'folder').map((i) => i.name)).toEqual(['Pasta 1', 'Sub'])
    expect(items.filter((i) => i.kind === 'request')).toHaveLength(8)
    expect(repo.listCollections()[0].variables).toEqual([{ key: 'base', value: 'https://api.local' }, { key: 'off', value: '1', disabled: true }])
  })
  it('renomear e mover no app aparece na exportação', () => {
    const { repo, c } = viaDb(sample)
    const items = repo.listItems(c.id)
    const pasta = items.find((i) => i.name === 'Sub')!
    const criar = items.find((i) => i.name === 'Criar')!
    repo.renameItem(pasta.id, 'Sub renomeada')
    repo.moveItem(criar.id, c.id, pasta.id, null)
    const out: any = exportCollection(repo.exportCollectionData(c.id))
    const sub = out.item[0].item[0]
    expect(sub.name).toBe('Sub renomeada')
    expect(sub.item.map((x: any) => x.name)).toEqual(['Usuário por id', 'Criar'])
  })
  it('environment importado guarda secret e desligado', () => {
    const repo = new Repo(':memory:')
    const p = parsePostman({ name: 'E', values: [{ key: 'a', value: '1', type: 'secret', enabled: false }], _postman_variable_scope: 'environment' })
    const e = repo.createEnvironment(p.data.name, (p.data as any).values)
    expect(repo.getEnvironment(e.id)?.values).toEqual([{ key: 'a', value: '1', type: 'secret', disabled: true }])
  })
})

const real = (process.env.PM_FILES ?? '').split(';').filter((f) => f.endsWith('collection.json'))
describe.skipIf(real.length === 0)('Repo com arquivos reais', () => {
  for (const f of real)
    it(f.split(/[\\/]/).pop()!, () => {
      const json = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
      expect(canon(viaDb(json).out)).toEqual(canon(json))
    })
})
