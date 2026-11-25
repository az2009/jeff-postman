# Plano: JEFF Postman (clone do Postman para Windows)

Data: 24/11/2026. Referência: Postman 12.38.3 instalado nesta máquina (`%LOCALAPPDATA%\Postman`).

## 1. Objetivo e escopo

App desktop para Windows, offline e local, com as funções básicas do Postman e a mesma cara.

**Entra (v1):**
- Collections com pastas e requisições; abas de requisição; drag and drop na árvore.
- Editor de requisição: método, URL, Params, Authorization, Headers, Body, Scripts (Pre-request e Post-response), Settings.
- Autenticação: No Auth, Inherit from parent, Basic, Bearer, API Key, OAuth 1.0, OAuth 2.0.
- Variáveis: globais, de environment, de collection, de dados (data file) e locais; `{{var}}` com destaque e autocompletar.
- Scripts com a API `pm.*` (subconjunto compatível) e testes por requisição (`pm.test` + `pm.expect`).
- Painel de resposta: Body (Pretty/Raw/Preview), Cookies, Headers, Test Results; status, tempo e tamanho.
- Console (como o do Postman): requisição e resposta cruas, `console.log` dos scripts, erros.
- Collection Runner: ordem, iterações, delay, data file CSV/JSON, resultado por iteração, exportar resultado.
- Importar e exportar collection e environment no formato Postman (Collection v2.1.0 e v2.0.0; environment `.postman_environment.json`).
- Armazenamento local rápido (SQLite) e histórico de requisições.

**Fica fora da v1:** workspaces na nuvem, sincronização, times, mock servers, monitors, flows, GraphQL/gRPC/WebSocket, documentação publicada, IA. (GraphQL e WebSocket entram como fase opcional.)

## 2. Stack recomendada

| Camada | Escolha | Por quê |
|---|---|---|
| Shell desktop | **Electron** + `electron-builder` (instalador NSIS e portable) | É o que o próprio Postman usa; dá Node no processo principal para HTTP sem CORS, sandbox de script e OAuth com janela própria |
| UI | **React + TypeScript + Vite** | Ecossistema e velocidade de desenvolvimento |
| Estado | **Zustand** (+ Immer) | Simples, rápido com muitas abas |
| Componentes | Radix UI + CSS próprio (tokens no tema escuro/claro do Postman) | Controle fino do visual |
| Editor de código | **Monaco** (body, scripts, resposta) | Autocompletar da API `pm`, realce JSON/XML/JS |
| Árvore e listas | `react-arborist` (árvore) e virtualização (`@tanstack/react-virtual`) para console e histórico | Collections grandes sem travar |
| HTTP | `node:http`/`node:https` no processo principal, com agentes keep-alive; proxy com túnel CONNECT, CA extra e mTLS por host | Sem dependência; tempos exatos por evento do socket (DNS, TCP, TLS, TTFB, download); redirects e descompactação (gzip, deflate, br) feitos no app |
| Banco local | **SQLite** pelo `node:sqlite` nativo do Node 24 que vem no Electron (WAL) | Local, transacional, sem módulo nativo para compilar (o `better-sqlite3` não tem binário para o Electron 45 e a máquina não tem Visual Studio) |
| Sandbox de script | `node:vm` dentro de um worker thread (o `isolated-vm` precisa de compilação nativa, indisponível nesta máquina); contexto sem protótipo, só texto cruza a fronteira, tempo limite inclusive em callbacks, worker encerrado se travar | Script do usuário não toca Node nem disco (11 tentativas de fuga testadas) |
| Bibliotecas do sandbox | chai, lodash, moment, crypto-js, tv4/ajv, cheerio, xml2js, uuid (as mesmas que o Postman expõe via `require`) | Compatibilidade com scripts existentes |
| Formato Postman | `postman-collection` (SDK oficial, Apache-2.0) para ler/escrever + validação com o JSON Schema v2.1 | Fidelidade na importação/exportação |
| Data files | `papaparse` (CSV) | |
| Testes do app | Vitest (unidade), Playwright for Electron (ponta a ponta) | |

Alternativa considerada: Tauri (Rust + WebView2), mais leve (~10 MB). Descartada para a v1 porque o sandbox JS e as bibliotecas `pm` exigiriam um runtime JS embutido (QuickJS/Deno), o que atrasa o projeto.

## 3. Arquitetura

```
┌───────────────────────── Renderer (React) ─────────────────────────┐
│ Sidebar (Collections, Environments, History) │ Abas │ Editor │ Resposta │ Console │
└───────────────▲──────────────────────────────────────────────────────┘
                │ IPC tipado (contextBridge, sem nodeIntegration)
┌───────────────┴──────────── Main process ───────────────────────────┐
│ RepoService (SQLite)   ImportExportService   RunnerService           │
│ RequestExecutor ── AuthEngine (Basic, Bearer, OAuth1, OAuth2)        │
│        │                                                            │
│        └── ScriptSandbox (utility process + isolated-vm)            │
│ CookieJar (tough-cookie)   ConsoleBus (eventos → renderer)           │
└─────────────────────────────────────────────────────────────────────┘
```

**Pipeline de execução de uma requisição** (igual à ordem do Postman):
1. Resolver herança: auth e scripts de collection → pasta → requisição.
2. Pre-request scripts na ordem collection → pasta → requisição (podem mudar variáveis, headers, URL, body; `pm.sendRequest` permitido).
3. Resolver variáveis `{{...}}` (precedência: local > data > environment > collection > global) e variáveis dinâmicas (`{{$guid}}`, `{{$timestamp}}`, `{{$randomInt}}`…).
4. Aplicar auth (gera header/parâmetros; OAuth 1.0 assina por último, depois do body final).
5. Enviar (undici), medir tempos, guardar cookies.
6. Post-response scripts na ordem collection → pasta → requisição; coletar `pm.test`.
7. Publicar no console, salvar no histórico, devolver para a UI.

## 4. Modelo de dados (SQLite)

Guardar o item no próprio formato da collection v2.1 (JSON) para importar/exportar sem perda, com colunas de índice para a árvore.

```sql
collections(id TEXT PK, name, description, auth_json, variables_json, events_json, info_json, updated_at)
items(id TEXT PK, collection_id, parent_id NULL, kind 'folder'|'request', name, sort_order REAL,
      body_json  -- objeto item v2.1 completo (request, event, auth, protocolProfileBehavior)
      , updated_at)
environments(id TEXT PK, name, values_json, updated_at)
globals(id=1, values_json)
active_state(key PK, value)          -- environment ativo, abas abertas, layout
history(id INTEGER PK, request_json, response_meta_json, response_body BLOB, created_at)
runs(id PK, collection_id, started_at, config_json, summary_json)
run_results(run_id, iteration, item_id, status, time_ms, tests_json, request_json, response_meta_json)
oauth_tokens(id PK, scope_key, name, token_json, expires_at)   -- cifrado com safeStorage (DPAPI)
cookies(domain, path, name, value, json)
```

- Pasta de dados: `%APPDATA%\JEFF Postman\jeff-postman.db` (+ `-wal`). Versão do esquema em `PRAGMA user_version`; migrações em `src/main/db.ts`.
- Segredos (tokens OAuth, senhas de auth, valores "secret" de environment) cifrados com `safeStorage` do Electron (DPAPI no Windows).
- Escrita com debounce (300 ms) e autosave; "Save" (Ctrl+S) só tira o marcador de "não salvo" da aba.
- Backup: exportar tudo para uma pasta de JSONs v2.1.

## 5. Interface (igual ao Postman)

Layout:
- **Barra de cima:** Home, Workspace, busca (Ctrl+K), Settings, botão New, Import.
- **Barra lateral esquerda** com ícones: Collections, Environments, History; árvore com menu de três pontos (Add request, Add folder, Rename, Duplicate, Delete, Run collection, Export).
- **Centro:** abas (com ponto laranja de "não salvo", Ctrl+T, Ctrl+W, clique do meio fecha), breadcrumb `Collection / Pasta / Requisição`, linha de método colorido + URL + **Send** (azul) + Save.
- Sub-abas: Params | Authorization | Headers (n) | Body | Scripts (Pre-request / Post-response) | Settings.
- **Resposta embaixo** (ou ao lado, alternável): Body | Cookies | Headers | Test Results (x/y); status em verde/vermelho, tempo com tooltip de etapas, tamanho.
- **Seletor de environment** no canto superior direito + olho para ver/editar variáveis rapidamente.
- **Rodapé:** Console (Ctrl+Alt+C), Runner, Cookies.
- Tema escuro e claro com as cores de método do Postman (GET verde, POST amarelo, PUT azul, PATCH roxo, DELETE vermelho).

Detalhes que dão a sensação de "igual":
- Tabela de chave/valor com checkbox, descrição, edição em massa (Bulk Edit) e linha vazia sempre no fim.
- URL e Params sincronizados nos dois sentidos; variáveis `{{x}}` em laranja (verde se definida, vermelho se não).
- Headers automáticos ocultos (User-Agent, Accept, Content-Length, Host, Postman-Token-equivalente) visíveis por "hidden".
- Body: none, form-data (texto e arquivo), x-www-form-urlencoded, raw (Text, JavaScript, JSON, HTML, XML), binary.
- Snippets na lateral do editor de scripts ("Status code is 200", "Response body: JSON value check", "Set an environment variable"…).
- Importar: arrastar arquivo, colar texto bruto ou **cURL**; "Code" (</>) gera cURL/fetch/Python.

## 6. Autenticação

| Tipo | Detalhes |
|---|---|
| Inherit | Sobe até achar auth na pasta/collection |
| Basic | `Authorization: Basic base64(user:pass)` |
| Bearer / API Key | header ou query |
| **OAuth 1.0** | Assinatura HMAC-SHA1, HMAC-SHA256, HMAC-SHA512, RSA-SHA1/256/512, PLAINTEXT; consumer key/secret, token/secret, callback, verifier, timestamp, nonce, version, realm; "add params to header" ou "body/URL"; opção "include body hash"; base string pela RFC 5849 (normalização de parâmetros e de URL) |
| **OAuth 2.0** | Grants: Authorization Code, Authorization Code + PKCE (S256/plain), Implicit, Password Credentials, Client Credentials; client auth em header Basic ou no body; scope, state, audience/resource; janela `BrowserWindow` isolada captura o redirect (callback `https://oauth.pstmn.io/v1/callback`-like próprio ou `http://localhost:<porta>`); refresh automático; gerenciador de tokens (lista, usar, apagar); prefixo do header ("Bearer") e onde enviar (header ou URL) |

Teste das assinaturas OAuth 1.0 com os vetores da RFC 5849 e com requisições reais conferidas no Postman.

## 7. Scripts e testes (API `pm`)

Executados no sandbox, com timeout configurável (padrão 5 s) e sem acesso a Node, rede (exceto `pm.sendRequest`) ou disco.

Subconjunto da v1:
- `pm.environment`, `pm.globals`, `pm.collectionVariables`, `pm.variables`, `pm.iterationData`: `get`, `set`, `unset`, `has`, `clear`, `toObject`, `replaceIn`.
- `pm.request`: `url`, `method`, `headers.add/upsert/remove`, `body`; em pre-request, alterável.
- `pm.response`: `code`, `status`, `headers`, `responseTime`, `responseSize`, `json()`, `text()`, `to.have.status()`, `to.be.ok`, `to.have.header()`, `to.have.jsonSchema()`.
- `pm.test(nome, fn)` (inclusive assíncrono), `pm.expect` (chai BDD), `pm.sendRequest(req, cb)` e versão com Promise.
- `pm.info` (requestName, requestId, iteration, iterationCount, eventName).
- `pm.execution.setNextRequest(nome|null)` e `pm.execution.skipRequest()` (+ alias legado `postman.setNextRequest`).
- `pm.cookies`, `console.log/info/warn/error`, `require('lodash' | 'chai' | 'moment' | 'crypto-js' | 'uuid' | 'cheerio' | 'xml2js' | 'ajv')`.
- Compatibilidade legada mínima: `tests["nome"] = cond`, `responseBody`, `responseCode`.

Resultado dos testes: pass/fail/skip com mensagem de erro, mostrados na aba Test Results e no Runner.

## 8. Console

- Lista virtualizada, uma entrada por requisição (método, URL, status, tempo) que expande em: request headers, request body, response headers, response body, rede (IP, TLS), tempos.
- Logs de script com o nível e a origem (requisição + pre/post).
- Filtro por nível e texto, limpar, "Show raw log", exportar.
- Limite de entradas (ex.: 5.000) para não pesar a memória.

## 9. Collection Runner

- Escolher collection ou pasta, reordenar e desmarcar requisições.
- Iterações, delay entre requisições, data file **CSV ou JSON** (prévia das linhas; cada linha = uma iteração; colunas viram `pm.iterationData` e `{{coluna}}`).
- Opções: manter valores de variáveis, salvar respostas, parar no primeiro erro, desligar logs.
- Respeitar `setNextRequest` e `skipRequest`.
- Tela de resultado: resumo (passaram/falharam, tempo médio), por iteração e por requisição; filtro All/Passed/Failed; exportar JSON (formato parecido com o do Postman) e reexecutar.
- Execução no main process, com cancelamento e progresso por IPC; histórico de runs no SQLite.
- Bônus: CLI `jeff-postman run coleção.json -d dados.csv -e env.json` reaproveitando o mesmo motor (equivalente ao Newman).

## 10. Importar e exportar

- Importar: Collection v2.1 e v2.0 (v1 convertida pelo `postman-collection`), environment, globals, cURL; arrastar vários arquivos.
- Exportar: Collection v2.1.0 (padrão) e v2.0.0, environment e globals, com `_postman_id`, `info.schema` correto, `event[]` com `listen: "prerequest" | "test"`, `auth`, `variable`, `protocolProfileBehavior`.
- Teste de ida e volta: importar collections reais exportadas do Postman 12.38, exportar de volta, comparar o JSON (diff semântico) e reimportar no Postman para confirmar.

## 11. Fases e entregas

| Fase | Entrega | Critério de pronto | Estimativa (1 dev) |
|---|---|---|---|
| 0. Base ✅ 24/11 | Electron + React + TS, IPC tipado, SQLite, tema, layout vazio igual ao Postman | App abre em < 1,5 s; instalador NSIS gerado | 1 semana |
| 1. Requisição ✅ 24/11 | Abas, editor (params, headers, body), Send, painel de resposta, histórico | GET/POST/PUT/PATCH/DELETE com form-data, urlencoded, raw e binary | 2 semanas |
| 2. Collections ✅ 24/11 | Árvore, pastas, drag and drop, salvar, duplicar, busca | 5.000 requisições sem travar a árvore | 1,5 semana |
| 3. Variáveis ✅ 24/11 | Environments, globals, collection vars, `{{}}` com realce, dinâmicas | Precedência igual à do Postman (testes de unidade) | 1 semana |
| 4. Import/Export ✅ 24/11 | v2.1/v2.0, environment, cURL | Ida e volta sem perda com 3 collections reais | 1 semana |
| 5. Auth ✅ 24/11 | Basic, Bearer, API Key, herança, OAuth 1.0, OAuth 2.0 (5 grants + PKCE), gerenciador de tokens | Vetores RFC 5849; fluxo real com um provedor (ex.: GitHub ou Keycloak local) | 2 semanas |
| 6. Scripts e testes ✅ 24/11 | Sandbox, API `pm`, snippets, Test Results, `pm.sendRequest` | Bateria de scripts típicos do Postman rodando igual | 2,5 semanas |
| 7. Console ✅ 25/11 | Console completo | Mostra requisição crua, logs, erros | 0,5 semana |
| 8. Runner ✅ 25/11 | Runner com CSV/JSON, iterações, delay, resultado, exportação, CLI | 100 iterações × 20 requisições sem vazamento de memória | 2 semanas |
| 9. Acabamento ✅ 25/11 | Atalhos, cookies, settings (timeout, SSL, proxy, certificados), gerar código, testes E2E, auto-update opcional | Checklist de paridade da seção 12 | 1,5 semana |

Total aproximado: **15 semanas** para uma pessoa; com dois desenvolvedores, fases 5–8 rodam em paralelo (~9 semanas).

## 12. Checklist de paridade com o Postman (usar o Postman local como gabarito)

Para cada item, fazer no Postman 12.38 e no clone e comparar:
Situação em 25/11/2026 (o Postman local exige login, então os itens marcados com ⚠️ foram conferidos contra servidores de teste e especificações, não lado a lado com o Postman):

- [~] ⚠️ Mesma requisição gera os mesmos headers automáticos e o mesmo corpo: conferido num servidor de eco (headers automáticos no padrão do Postman, com `JeffPostman-Token` e `JeffPostmanRuntime`); falta comparar no console do Postman.
- [x] Assinatura OAuth 1.0 idêntica com timestamp e nonce fixos: vetores oficiais da RFC 5849 (1.2 e 3.4.1.1) e do Twitter, e servidor com implementação independente.
- [x] Token OAuth 2.0 obtido nos 5 grants (servidor OAuth local, inclusive PKCE e os 3 fluxos com janela de login).
- [x] Ordem de execução dos scripts collection → pasta → requisição.
- [x] `setNextRequest` no Runner desvia o fluxo (nome e `null`).
- [x] Runner com CSV de 3 linhas faz 3 iterações e preenche `{{coluna}}`.
- [~] ⚠️ Collection exportada pelo clone abre no Postman: ida e volta sem diferença com 2 collections e 1 environment reais exportados do Postman 12; falta importar no Postman um arquivo exportado pelo clone.
- [x] Atalhos: Ctrl+Enter (Send), Ctrl+S, Ctrl+T, Ctrl+W, Ctrl+Alt+C, Ctrl+K (e Ctrl+O import, Ctrl+D duplicar, Ctrl+, settings).

Antes da fase 0, abrir o Postman local e registrar capturas de cada tela (requisição, auth OAuth 1/2, scripts, console, runner, import/export) em `referencia/` para servir de gabarito visual.

## 13. Estrutura de pastas proposta

```
postman-clone/
  apps/desktop/            # Electron (main, preload, renderer)
    src/main/              # executor HTTP, auth, runner, sqlite, ipc
    src/sandbox/           # utility process + isolated-vm + api pm
    src/renderer/          # React: layout, sidebar, abas, editor, resposta, console, runner
  packages/core/           # modelo, variáveis, herança, conversão v2.1 (reusado pela CLI)
  packages/cli/            # jeff-postman run
  referencia/              # capturas do Postman e collections de teste
  PLANO.md
```

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Compatibilidade da API `pm` é grande | Implementar o subconjunto acima; registrar no console chamadas não suportadas; ampliar pelo uso real |
| Sandbox inseguro | `isolated-vm` em processo separado, sem `require` de Node, com limite de memória e tempo |
| `isolated-vm` exige compilação nativa no Windows | Usar binários pré-compilados do `electron-rebuild`; reserva com `node:vm` em worker |
| OAuth 2.0 com provedores que bloqueiam webview | Opção de abrir no navegador do sistema com callback em `localhost` |
| Marca e direitos | Nome escolhido pelo operador em 24/11: **JEFF Postman** (uso pessoal). "Postman" é marca registrada da Postman, Inc.: trocar o nome antes de distribuir ou publicar o app. Não usar logo nem ícones do Postman (o formato de collection é aberto) |
| Collections enormes | SQLite com índice por `parent_id`, árvore virtualizada, carregar o item completo só ao abrir a aba |

## 15. Próximo passo

Aprovar a stack (Electron + React + SQLite) e o nome; então começar pela fase 0 e pelas capturas de referência do Postman local.
