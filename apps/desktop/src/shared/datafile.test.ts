import { describe, expect, it } from 'vitest'
import { parseCsv, parseDataFile, parseJsonData } from './datafile'

describe('CSV', () => {
  it('cabeçalho, aspas, aspas duplicadas, quebra de linha em aspas, CRLF e BOM', () => {
    const r = parseCsv('﻿nome,idade,obs\r\nAna,30,"tem, vírgula"\r\n"Bruno ""B""",25,"linha1\nlinha2"\r\n')
    expect(r.columns).toEqual(['nome', 'idade', 'obs'])
    expect(r.rows).toEqual([
      { nome: 'Ana', idade: '30', obs: 'tem, vírgula' },
      { nome: 'Bruno "B"', idade: '25', obs: 'linha1\nlinha2' }
    ])
  })
  it('ponto e vírgula (Excel em português), linhas vazias e coluna faltando', () => {
    const r = parseCsv('id;valor\n1;10,5\n\n2\n')
    expect(r.rows).toEqual([
      { id: '1', valor: '10,5' },
      { id: '2', valor: '' }
    ])
  })
  it('erros', () => {
    expect(() => parseCsv('')).toThrow(/vazio/)
    expect(() => parseCsv('a,"b\n1,2')).toThrow(/aspas/)
    expect(() => parseCsv('a,,c\n1,2,3')).toThrow(/sem nome/)
  })
})

describe('JSON', () => {
  it('array de objetos; números, booleanos e objetos viram texto', () => {
    const r = parseJsonData('[{"id":1,"ativo":true,"tags":["a"]},{"id":2,"nome":"Bia","x":null}]')
    expect(r.columns).toEqual(['id', 'ativo', 'tags', 'nome', 'x'])
    expect(r.rows).toEqual([
      { id: '1', ativo: 'true', tags: '["a"]' },
      { id: '2', nome: 'Bia', x: '' }
    ])
  })
  it('erros e detecção pelo nome/conteúdo', () => {
    expect(() => parseJsonData('{"a":1}')).toThrow(/array/)
    expect(() => parseJsonData('[1]')).toThrow(/não é um objeto/)
    expect(parseDataFile('dados.txt', '[{"a":"1"}]').rows).toEqual([{ a: '1' }])
    expect(parseDataFile('dados.csv', 'a\n1').rows).toEqual([{ a: '1' }])
  })
})
