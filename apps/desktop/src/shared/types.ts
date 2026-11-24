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
  request: SentRequest
}

export type SendResult =
  | { ok: true; response: HttpResponse }
  | { ok: false; requestId: string; error: string; code: string | null; cancelled: boolean; request: SentRequest | null }

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
  'history:delete'
]

export interface JeffPostmanBridge {
  invoke<K extends IpcChannel>(channel: K, ...args: IpcContract[K]['args']): Promise<IpcContract[K]['ret']>
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
