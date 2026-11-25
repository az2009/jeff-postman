export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export interface KeyValue {
  key: string
  value: string
  description?: string
  disabled?: boolean
  /** só em variáveis: 'secret' mascara o valor na tela */
  type?: 'default' | 'secret'
}

export interface Collection {
  id: string
  name: string
  updatedAt: number
  variables: KeyValue[]
}

export type ItemKind = 'folder' | 'request'

/** Linha da árvore: só o necessário para desenhar a barra lateral. */
export interface TreeItem {
  id: string
  collectionId: string
  parentId: string | null
  kind: ItemKind
  name: string
  method: HttpMethod | null
  sortOrder: number
}

/**
 * Requisição no formato de item da Collection v2.1 do Postman. Campos que o app ainda não edita
 * (auth, response, protocolProfileBehavior...) ficam guardados para a exportação não perder nada.
 */
export interface RequestDoc {
  name: string
  request: {
    method: HttpMethod
    url: RequestUrl
    header: KeyValue[]
    body?: RequestBody
    description?: unknown
    auth?: PmAuth
  }
  event?: PmEvent[]
  response?: unknown[]
  protocolProfileBehavior?: Record<string, unknown>
}

export interface RequestUrl {
  raw: string
  /** só os query params desligados (os ligados vivem no raw, como no Postman) */
  query?: QueryParam[]
  /** path variables (`/users/:id`) */
  variable?: KeyValue[]
}

export interface QueryParam {
  key: string
  value: string | null
  disabled?: boolean
  description?: unknown
}

/** Auth no formato v2.1: { type: 'bearer', bearer: [{ key, value, type }] } */
export interface PmAuth {
  type: string
  [k: string]: unknown
}

export interface PmEvent {
  listen: 'prerequest' | 'test' | string
  disabled?: boolean
  script: { type?: string; exec: string[]; id?: string; [k: string]: unknown }
  [k: string]: unknown
}

/** Dados extras de pasta, guardados no body_json da pasta. */
export interface FolderDoc {
  name: string
  description?: unknown
  auth?: PmAuth
  event?: PmEvent[]
  variable?: KeyValue[]
  protocolProfileBehavior?: Record<string, unknown>
}

/** Modos de corpo como no Collection v2.1 ("file" é o "binary" da interface do Postman). */
export type BodyMode = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file'
export type RawLanguage = 'text' | 'javascript' | 'json' | 'html' | 'xml'

export interface FormDataEntry {
  key: string
  type: 'text' | 'file'
  value?: string
  src?: string | string[]
  contentType?: string
  description?: string
  disabled?: boolean
}

export interface RequestBody {
  mode: BodyMode
  raw?: string
  options?: { raw?: { language: RawLanguage } }
  urlencoded?: KeyValue[]
  formdata?: FormDataEntry[]
  file?: { src: string | null }
  disabled?: boolean
}

// ---------- execução HTTP ----------
export interface SendInput {
  requestId: string
  doc: RequestDoc
  /** escopos usados para resolver {{variáveis}} no envio */
  environmentId: string | null
  collectionId: string | null
  /** requisição salva (para herdar auth das pastas); null em aba não salva */
  itemId: string | null
  /** preenchido pelo main antes de enviar: auth efetivo já com variáveis resolvidas */
  auth?: PmAuth
}

export interface HttpTimings {
  /** ms; 0 quando a etapa não aconteceu (ex.: conexão reaproveitada) */
  dns: number
  tcp: number
  tls: number
  ttfb: number
  download: number
  total: number
}

export interface SentRequest {
  method: string
  url: string
  headers: [string, string][]
  bodySize: number
  /** corpo enviado como texto (até 64 KB), para o console */
  bodyPreview?: string
}

export interface HttpResponse {
  requestId: string
  status: number
  statusText: string
  httpVersion: string
  headers: [string, string][]
  /** corpo já descompactado */
  body: Uint8Array
  /** bytes recebidos na rede (antes de descompactar) */
  bodySize: number
  headersSize: number
  timings: HttpTimings
  url: string
  redirects: number
  remoteAddress: string | null
  reusedConnection: boolean
  /** OAuth 2.0: token renovado automaticamente antes deste envio */
  refreshedToken?: OAuth2Token
  scripts?: ScriptsReport
  request: SentRequest
}

export type SendResult =
  | { ok: true; response: HttpResponse }
  | { ok: false; requestId: string; error: string; code: string | null; cancelled: boolean; request: SentRequest | null; scripts?: ScriptsReport; skipped?: boolean }

export interface HistoryEntry {
  id: number
  name: string
  method: HttpMethod
  url: string
  status: number | null
  timeMs: number | null
  createdAt: number
}

export interface Environment {
  id: string
  name: string
  values: KeyValue[]
  updatedAt: number
}

export interface NewItemInput {
  collectionId: string
  parentId: string | null
  kind: ItemKind
  name: string
  method?: HttpMethod
}

export interface AppInfo {
  version: string
  dbPath: string
  electron: string
}

/** Contrato do IPC: canal -> argumentos e retorno. Main e preload usam este mapa. */
export interface IpcContract {
  'app:info': { args: []; ret: AppInfo }
  'app:setTheme': { args: [theme: 'dark' | 'light']; ret: void }
  'collections:list': { args: []; ret: Collection[] }
  'collections:create': { args: [name: string]; ret: Collection }
  'collections:rename': { args: [id: string, name: string]; ret: void }
  'collections:delete': { args: [id: string]; ret: void }
  'collections:duplicate': { args: [id: string]; ret: Collection }
  'items:list': { args: [collectionId: string]; ret: TreeItem[] }
  'items:create': { args: [input: NewItemInput]; ret: TreeItem }
  'items:rename': { args: [id: string, name: string]; ret: void }
  'items:delete': { args: [id: string]; ret: void }
  'items:move': { args: [id: string, collectionId: string, parentId: string | null, beforeId: string | null]; ret: void }
  'items:duplicate': { args: [id: string]; ret: string }
  'items:get': { args: [id: string]; ret: RequestDoc | null }
  'items:saveRequest': { args: [id: string, doc: RequestDoc]; ret: void }
  'environments:list': { args: []; ret: Environment[] }
  'environments:create': { args: [name: string]; ret: Environment }
  'environments:delete': { args: [id: string]; ret: void }
  'environments:update': { args: [id: string, patch: { name?: string; values?: KeyValue[] }]; ret: Environment }
  'environments:duplicate': { args: [id: string]; ret: Environment }
  'globals:get': { args: []; ret: KeyValue[] }
  'globals:set': { args: [values: KeyValue[]]; ret: void }
  'collections:setVariables': { args: [id: string, values: KeyValue[]]; ret: void }
  'collections:getAuth': { args: [id: string]; ret: PmAuth | null }
  'collections:setAuth': { args: [id: string, auth: PmAuth | null]; ret: void }
  'items:getFolder': { args: [id: string]; ret: FolderDoc | null }
  'items:setFolderAuth': { args: [id: string, auth: PmAuth | null]; ret: void }
  'collections:getEvents': { args: [id: string]; ret: PmEvent[] }
  'collections:setEvents': { args: [id: string, events: PmEvent[]]; ret: void }
  'items:setFolderEvents': { args: [id: string, events: PmEvent[]]; ret: void }
  'auth:inherited': { args: [collectionId: string, parentId: string | null]; ret: InheritedAuth }
  'oauth2:getToken': { args: [auth: PmAuth, collectionId: string | null, environmentId: string | null]; ret: OAuth2Token }
  'oauth2:listTokens': { args: []; ret: OAuth2Token[] }
  'oauth2:deleteToken': { args: [id: string]; ret: void }
  'oauth2:refresh': { args: [id: string, auth: PmAuth | null, collectionId: string | null, environmentId: string | null]; ret: OAuth2Token }
  'import:text': { args: [text: string, fileName: string | null]; ret: ImportResult }
  'import:pickFiles': { args: []; ret: { name: string; text: string }[] }
  'export:collection': { args: [id: string, version: '2.1' | '2.0']; ret: string | null }
  'export:environment': { args: [id: string]; ret: string | null }
  'export:globals': { args: []; ret: string | null }
  'state:get': { args: [key: string]; ret: unknown }
  'state:set': { args: [key: string, value: unknown]; ret: void }
  'http:send': { args: [input: SendInput]; ret: SendResult }
  'http:cancel': { args: [requestId: string]; ret: void }
  'dialog:openFiles': { args: [multi: boolean]; ret: string[] }
  'history:list': { args: [limit: number]; ret: HistoryEntry[] }
  'history:get': { args: [id: number]; ret: RequestDoc | null }
  'history:clear': { args: []; ret: void }
  'history:delete': { args: [ids: number[]]; ret: void }
  'console:save': { args: [text: string]; ret: string | null }
  'runner:order': { args: [collectionId: string, folderId: string | null]; ret: { id: string; name: string; method: string; path: string }[] }
  'runner:start': { args: [config: RunConfig]; ret: RunSummary }
  'runner:stop': { args: [runId: string]; ret: void }
  'runner:list': { args: [collectionId: string | null]; ret: RunSummary[] }
  'runner:get': { args: [runId: string]; ret: { summary: RunSummary; results: RunRequestResult[] } | null }
  'runner:delete': { args: [runId: string]; ret: void }
  'runner:pickData': { args: []; ret: { name: string; columns: string[]; rows: Record<string, string>[] } | null }
  'runner:export': { args: [runId: string]; ret: string | null }
  'settings:get': { args: []; ret: AppSettings }
  'settings:set': { args: [settings: AppSettings]; ret: AppSettings }
  'cookies:list': { args: []; ret: StoredCookie[] }
  'cookies:save': { args: [cookie: StoredCookie, replace: { domain: string; path: string; name: string } | null]; ret: void }
  'cookies:delete': { args: [domain: string, path: string, name: string]; ret: void }
  'cookies:clear': { args: [domain: string | null]; ret: void }
  'search:requests': { args: [q: string]; ret: SearchHit[] }
}

export type IpcChannel = keyof IpcContract

export const IPC_CHANNELS: IpcChannel[] = [
  'app:info',
  'app:setTheme',
  'collections:list',
  'collections:create',
  'collections:rename',
  'collections:delete',
  'collections:duplicate',
  'items:list',
  'items:create',
  'items:rename',
  'items:delete',
  'items:move',
  'items:duplicate',
  'items:get',
  'items:saveRequest',
  'environments:list',
  'environments:create',
  'environments:delete',
  'environments:update',
  'environments:duplicate',
  'globals:get',
  'globals:set',
  'collections:setVariables',
  'collections:getAuth',
  'collections:setAuth',
  'items:getFolder',
  'items:setFolderAuth',
  'collections:getEvents',
  'collections:setEvents',
  'items:setFolderEvents',
  'auth:inherited',
  'oauth2:getToken',
  'oauth2:listTokens',
  'oauth2:deleteToken',
  'oauth2:refresh',
  'import:text',
  'import:pickFiles',
  'export:collection',
  'export:environment',
  'export:globals',
  'state:get',
  'state:set',
  'http:send',
  'http:cancel',
  'dialog:openFiles',
  'history:list',
  'history:get',
  'history:clear',
  'history:delete',
  'console:save',
  'runner:order',
  'runner:start',
  'runner:stop',
  'runner:list',
  'runner:get',
  'runner:delete',
  'runner:pickData',
  'runner:export',
  'settings:get',
  'settings:set',
  'cookies:list',
  'cookies:save',
  'cookies:delete',
  'cookies:clear',
  'search:requests'
]

export const EVENT_CHANNELS = ['runner:event'] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface JeffPostmanBridge {
  invoke<K extends IpcChannel>(channel: K, ...args: IpcContract[K]['args']): Promise<IpcContract[K]['ret']>
  /** assina eventos do main; devolve a função para cancelar */
  on(channel: EventChannel, cb: (payload: unknown) => void): () => void
}

export type ImportResult =
  | { ok: true; kind: 'collection'; name: string; folders: number; requests: number; collection: Collection; version: string }
  | { ok: true; kind: 'environment'; name: string; environment: Environment }
  | { ok: true; kind: 'globals'; name: string; count: number; globals: KeyValue[] }
  | { ok: true; kind: 'curl'; name: string; doc: RequestDoc }
  | { ok: false; name: string; error: string }

export interface OAuth2Token {
  id: string
  name: string
  accessToken: string
  tokenType: string
  refreshToken: string | null
  idToken: string | null
  scope: string | null
  /** epoch ms; null quando o servidor não informou expires_in */
  expiresAt: number | null
  createdAt: number
  grantType: string
  clientId: string
  accessTokenUrl: string
  extra: Record<string, string>
}

export interface InheritedAuth {
  auth: PmAuth | null
  from: { kind: 'folder' | 'collection'; name: string } | null
}

// ---------- scripts (pre-request / post-response) ----------
export interface ScriptRequestState {
  id: string | null
  name: string
  method: string
  url: string
  headers: KeyValue[]
  body: RequestBody
  auth?: PmAuth
}

export interface ScriptResponseState {
  code: number
  status: string
  headers: [string, string][]
  body: string
  responseTime: number
  responseSize: number
}

export interface ScriptState {
  globals: KeyValue[]
  collectionVariables: KeyValue[]
  /** null quando não há environment ativo */
  environment: KeyValue[] | null
  environmentName: string | null
  iterationData: KeyValue[]
  local: KeyValue[]
  request: ScriptRequestState
  response?: ScriptResponseState
  cookies?: { name: string; value: string; domain?: string; path?: string }[]
  changed?: Record<string, boolean>
}

export interface ScriptInfo {
  eventName: 'prerequest' | 'test'
  iteration: number
  iterationCount: number
  requestName: string
  requestId: string | null
  /** de onde veio o script: collection, pasta ou requisição */
  location?: string[]
}

export interface ScriptInput {
  script: string
  /** configurações de rede usadas pelo pm.sendRequest */
  httpSettings?: AppSettings
  state: ScriptState
  info: ScriptInfo
  timeoutMs?: number
  deadlineMs?: number
}

export interface TestResult {
  name: string
  passed: boolean
  skipped: boolean
  error?: string
}

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
}

export interface ScriptRunResult {
  /** chamadas de pm.sendRequest feitas pelo script (para o console) */
  network?: { method: string; url: string; status: number | null; ms: number; error?: string }[]
  state: (Omit<ScriptState, 'response' | 'cookies' | 'iterationData' | 'environmentName'> & { changed: Record<string, boolean> }) | null
  tests: TestResult[]
  logs: LogEntry[]
  /** undefined = não mexeu; null = parar o runner; texto = próxima requisição */
  nextRequest: string | null | undefined
  skip: boolean
  error: string | null
}

export interface SendRequestSpec {
  url: string
  method: string
  header: KeyValue[]
  body: RequestBody
}

export type SendRequestReply =
  | { response: { code: number; status: string; headers: [string, string][]; body: string; responseTime: number } }
  | { error: string }

/** O que os scripts produziram num envio (para Test Results, console e variáveis). */
export interface ScriptsReport {
  tests: (TestResult & { source: string })[]
  logs: (LogEntry & { source: string; event: 'prerequest' | 'test' })[]
  errors: { source: string; event: 'prerequest' | 'test'; error: string }[]
  /** escopos alterados pelos scripts e já gravados */
  updated: { globals?: KeyValue[]; environment?: { id: string; values: KeyValue[] }; collection?: { id: string; values: KeyValue[] } }
  skipped: boolean
  nextRequest: string | null | undefined
}

// ---------- Collection Runner ----------
export interface RunConfig {
  collectionId: string
  folderId: string | null
  /** requisições marcadas, na ordem em que vão rodar */
  requestIds: string[]
  iterations: number
  delayMs: number
  data: Record<string, string>[] | null
  dataFileName: string | null
  environmentId: string | null
  /** grava no fim as variáveis alteradas pelos scripts (environment, globals, collection) */
  keepVariableValues: boolean
  stopOnError: boolean
  /** guarda o corpo das respostas (até 64 KB cada) no resultado */
  saveResponses: boolean
}

export interface RunRequestResult {
  seq: number
  iteration: number
  itemId: string
  name: string
  method: string
  url: string
  status: number | null
  statusText: string
  timeMs: number
  size: number
  tests: TestResult[]
  error: string | null
  skipped: boolean
  responseBody?: string
}

export interface RunSummary {
  id: string
  collectionId: string
  folderId: string | null
  name: string
  environmentName: string | null
  dataFileName: string | null
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'finished' | 'stopped' | 'error'
  iterations: number
  executed: number
  testsPassed: number
  testsFailed: number
  errors: number
  avgMs: number
  totalMs: number
  message?: string
}

export type RunnerEvent =
  | { type: 'started'; summary: RunSummary }
  | { type: 'result'; runId: string; result: RunRequestResult; summary: RunSummary }
  | { type: 'finished'; summary: RunSummary }

// ---------- configurações, cookies e busca ----------
export interface ClientCert {
  id: string
  /** host (com * para subdomínios) e porta opcional: api.exemplo.com, *.exemplo.com:8443 */
  host: string
  crtPath: string
  keyPath: string
  pfxPath: string
  passphrase: string
}

export interface AppSettings {
  /** 0 = sem limite */
  requestTimeoutMs: number
  sslVerification: boolean
  followRedirects: boolean
  maxRedirects: number
  maxResponseMb: number
  /** guarda os cookies das respostas e reenvia nas próximas requisições */
  sendCookies: boolean
  scriptTimeoutMs: number
  proxy: { enabled: boolean; host: string; port: number; auth: boolean; username: string; password: string; bypass: string }
  ca: { enabled: boolean; path: string }
  clientCerts: ClientCert[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  requestTimeoutMs: 0,
  sslVerification: true,
  followRedirects: true,
  maxRedirects: 10,
  maxResponseMb: 200,
  sendCookies: true,
  scriptTimeoutMs: 5000,
  proxy: { enabled: false, host: '', port: 8080, auth: false, username: '', password: '', bypass: 'localhost,127.0.0.1' },
  ca: { enabled: false, path: '' },
  clientCerts: []
}

export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number | null
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  sameSite?: string
  createdAt: number
}

export interface SearchHit {
  id: string
  collectionId: string
  collectionName: string
  name: string
  method: string
  url: string
}
