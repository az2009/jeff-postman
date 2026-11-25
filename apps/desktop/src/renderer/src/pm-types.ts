/** Declarações da API pm para o autocompletar do editor de scripts (Monaco). */
export const PM_DTS = `
interface PmVariableScope {
  /** Lê uma variável deste escopo. */
  get(key: string): any
  /** Grava (e cria se não existir). */
  set(key: string, value: any, type?: 'default' | 'secret'): void
  unset(key: string): void
  has(key: string): boolean
  clear(): void
  toObject(): Record<string, any>
  /** Troca {{variáveis}} no texto. */
  replaceIn(text: string): string
}
interface PmPropertyList {
  get(key: string): string | undefined
  has(key: string, value?: string): boolean
  add(item: { key: string; value: any } | string): void
  upsert(item: { key: string; value: any }): void
  remove(keyOrPredicate: string | ((item: { key: string; value: string }) => boolean)): void
  all(): { key: string; value: string }[]
  each(fn: (item: { key: string; value: string }) => void): void
  toObject(): Record<string, string>
  count(): number
}
interface PmUrl {
  toString(): string
  getHost(): string
  getPath(): string
  getQueryString(): string
  update(raw: string): void
  query: PmPropertyList
  readonly protocol: string
  readonly port: string | undefined
}
interface PmRequest {
  url: PmUrl | string
  method: string
  headers: PmPropertyList
  body: { mode: string; raw?: string; urlencoded?: any[]; formdata?: any[]; update(v: string | object): void }
  readonly name: string
  readonly id: string | null
  addHeader(h: { key: string; value: string }): void
  removeHeader(key: string): void
  upsertHeader(h: { key: string; value: string }): void
}
interface PmResponseAssertions {
  have: {
    status(codeOrReason: number | string): void
    header(key: string, value?: string): void
    body(text?: string | RegExp): void
    jsonBody(path?: string | object, value?: any): void
    jsonSchema(schema: object): void
    cookie(name: string, value?: string): void
    responseTime: { below(ms: number): void; above(ms: number): void }
  }
  be: {
    ok: any; success: any; redirection: any; clientError: any; serverError: any; error: any; json: any
    accepted: any; badRequest: any; unauthorized: any; forbidden: any; notFound: any; rateLimited: any
  }
  not: PmResponseAssertions
}
interface PmResponse {
  code: number
  status: string
  responseTime: number
  responseSize: number
  headers: PmPropertyList
  text(): string
  json(): any
  to: PmResponseAssertions
}
interface PmSendResponse { code: number; status: string; responseTime: number; headers: PmPropertyList; text(): string; json(): any }
interface Pm {
  info: { eventName: 'prerequest' | 'test'; iteration: number; iterationCount: number; requestName: string; requestId: string | null }
  globals: PmVariableScope
  environment: PmVariableScope & { name?: string }
  collectionVariables: PmVariableScope
  iterationData: PmVariableScope
  /** Lê com a precedência local > data > environment > collection > global; set grava no escopo local. */
  variables: PmVariableScope
  request: PmRequest
  response: PmResponse
  cookies: { has(name: string): boolean; get(name: string): string | undefined; toObject(): Record<string, string> }
  /** Registra um teste. Use pm.expect dentro. */
  test: ((name: string, fn: (done?: (err?: any) => void) => void | Promise<void>) => Pm) & { skip(name: string, fn?: Function): Pm }
  /** Asserções do Chai (BDD). */
  expect: (value: any, message?: string) => any
  sendRequest(req: string | { url: string; method?: string; header?: any; body?: any }, cb?: (err: any, res: PmSendResponse) => void): Promise<PmSendResponse>
  execution: { setNextRequest(name: string | null): void; skipRequest(): void }
}
declare const pm: Pm
declare const postman: { setNextRequest(name: string | null): void; setEnvironmentVariable(k: string, v: any): void; getEnvironmentVariable(k: string): any; setGlobalVariable(k: string, v: any): void; getGlobalVariable(k: string): any }
declare const tests: Record<string, boolean>
declare const responseBody: string
declare const responseCode: { code: number; name: string }
declare function require(name: 'lodash' | 'chai' | 'moment' | 'crypto-js' | 'tv4' | 'uuid' | 'atob' | 'btoa'): any
declare const _: any
declare const CryptoJS: any
`
