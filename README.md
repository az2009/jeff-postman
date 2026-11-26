# JEFF Postman (clone local do Postman para Windows)

Plano completo: [PLANO.md](PLANO.md).

## Estado

**Todas as 9 fases do plano concluídas em 25/11/2026.** Testes: 111 automáticos (`npm test`; 116 com os arquivos reais em `PM_FILES`) e 13 de ponta a ponta com o app aberto (`npm run test:e2e`).

**Revisão de código em 25/11/2026:** 16 ajustes (3 de segurança, 7 bugs, 6 refinos), descritos em [REVISAO.md](REVISAO.md). Os principais: a janela não navega mais para fora da tela do app e o IPC só aceita a tela do app; limite também no corpo descompactado (zip bomb); o pedido de token OAuth 2.0 passa a respeitar proxy, SSL e timeout; o callback do OAuth 2.0 é comparado pelo endereço inteiro; fechar aba ou o app com alteração não salva pede confirmação; a aba não fica mais travada em "Sending..." quando o envio dá erro interno; importa o "Copy as cURL (cmd)" do Chrome.

**Versão 0.2.0 (26/11/2026):**
- **Abas em janela separada** (como no IntelliJ): arraste uma aba para fora da janela, ou clique direito → **Abrir em janela separada**. A janela destacada tem barra de abas própria e pode ter várias abas; arrastar uma aba dela até a janela principal (ou clique direito → **Mover para a janela principal**) devolve aquela aba; **Anexar à janela principal** ou fechar a janela (X) devolve todas, sem perder alteração não salva nem a resposta. O que uma janela salva aparece nas outras (collections, environments, globals, histórico, tokens, tema e environment ativo), e clicar numa requisição que já está numa janela destacada traz essa janela para a frente. Bom para comparar payloads lado a lado.
- **Barra de abas com scroll:** roda do mouse, setas quando as abas não cabem, lista das abas abertas (▾ com o número) e a aba ativa sempre à vista; arrastar uma aba sobre outra reordena.
- **PDF e imagem formatados:** o tipo vem do `Content-Type` e, quando ele falta ou é `octet-stream`, dos bytes. PDF abre no visualizador embutido (páginas, zoom, imprimir, baixar); imagem aparece com as dimensões; Pretty e Raw de binário mostram um aviso em vez de caracteres soltos. Botão **Save response to file** (nome do `Content-Disposition`).
- **Aba Console na resposta:** só os logs daquele envio (pre-request, a requisição com detalhe, post-response e erros de script). Envio com erro ou pulado mostra o console abaixo do erro.
- **Aba Console no detalhe do Runner:** os logs de cada requisição da execução (até 200 linhas e 32 KB por requisição).

Fase 9, acabamento:
- **Settings** (engrenagem ou Ctrl+,): timeout das requisições, verificação de certificado SSL, seguir redirects e limite, tamanho máximo da resposta, cookies automáticos, tempo limite dos scripts, tema. Guardadas **cifradas** (têm senhas).
- **Proxy:** HTTP e HTTPS (túnel CONNECT), com usuário e senha e lista de exceções (`*.dominio.com`).
- **Certificados:** CA extra (PEM) somada às do sistema; certificados de cliente por host (`api.exemplo.com`, `*.exemplo.com:8443`) em CRT+KEY ou PFX com senha (mTLS).
- **Aba Settings da requisição** (como no Postman, gravada em `protocolProfileBehavior`): SSL, seguir redirects, manter o método original no 301/302, máximo de redirects e desligar cookies, cada um podendo usar o padrão do app.
- **Cookies:** o app guarda os `Set-Cookie` (regras de domínio, caminho, `Secure` e validade da RFC 6265) e reenvia nas próximas requisições; header `Cookie` manual vence. **Manage Cookies** (rodapé): por domínio, editar valor, apagar, acrescentar e limpar tudo.
- **Gerar código** (`</>` ao lado do Save): cURL, PowerShell (Invoke-RestMethod), JavaScript fetch e Python requests, com as variáveis e o auth já resolvidos.
- **Busca Ctrl+K:** requisições por nome ou URL em todas as collections, além de collections e environments; Enter abre.
- Mensagens de erro claras para SSL, proxy fora do ar e timeout.
- **Instalador menor:** 111 MB (era 132 MB): as dependências já vão dentro do bundle e só ficam as traduções pt-BR e en-US do Chromium.

Fase 8, Collection Runner:
- Menu da collection → **Run collection** (ou da pasta → **Run folder**, ou **Runner** no rodapé).
- **Run order** com marcar/desmarcar e arrastar para reordenar; **iterações**, **intervalo** entre requisições, **data file** CSV (vírgula ou ponto e vírgula, aspas) ou JSON com prévia; environment; "Keep variable values" (grava no fim o que os scripts mudaram); "Stop run if an error occurs"; "Save responses".
- Cada linha do data file é uma iteração: `{{coluna}}` e `pm.iterationData.get("coluna")`. Variáveis gravadas por uma requisição valem nas seguintes da mesma execução. `setNextRequest("Nome")` desvia, `setNextRequest(null)` encerra a iteração, `skipRequest()` pula.
- Resultados ao vivo: cartões (executadas, duração, testes aprovados/reprovados, erros, tempo médio), filtro All/Passed/Failed e por iteração, clicar numa requisição abre à direita a requisição enviada e a resposta recebida (body e headers de cada uma, e os testes), num painel de largura ajustável, com as setas ↑/↓ passando de uma para outra; **Pause/Resume** (a requisição em andamento termina e a próxima só sai no Resume; o intervalo também espera) e **Stop**; **Export Results** (JSON no formato do Postman); execuções anteriores guardadas. O Runner não suja o History.
- Medido: 2.000 requisições com 2 scripts cada em ~9 s; memória estável em 3 execuções seguidas (6.000 requisições).
- **Comando de terminal** (como o Newman): `jeff-postman run colecao.json -e env.json -d dados.csv -n 3 --folder "Pasta" --bail -k --env-var base=... --reporters cli,json --reporter-json-export saida.json`. Código de saída 1 quando algum teste falha (bom para CI). No app instalado: `"<pasta do app>\resources\jeff-postman.cmd" run ...` (usa o Node que vem dentro do app); no projeto: `npm run cli -- run ...`.

Fase 7, Console (Ctrl+Alt+C):
- Um item por envio, que abre em Network (endereço, HTTP, tempos de DNS/TCP/TLS/espera/download, tamanhos), Request Headers, Request Body, Response Headers e Response Body.
- `console.log/info/warn/error` dos scripts na ordem em que rodaram, com a origem (collection, pasta, requisição), e as chamadas de `pm.sendRequest`.
- Busca, filtro por nível, "Hide network", "Show raw log" (texto HTTP cru), **Export** para arquivo `.log`, Clear e altura ajustável.

Fase 6, scripts e testes:
- **Aba Scripts** (requisição, pasta e collection) com Pre-request e Post-response, editor JavaScript com **autocompletar da API `pm`** e **snippets** do Postman. Collection e pasta: menu → **Scripts**.
- **Ordem igual à do Postman:** pre-request da collection → pastas (de fora para dentro) → requisição; envio; post-response na mesma ordem.
- **API `pm`:** `pm.test` (síncrono, `async` e com `done`), `pm.test.skip`, `pm.expect` (Chai 4), `pm.response` (`code`, `status`, `headers`, `json()`, `text()`, `responseTime`, `to.have.status/header/body/jsonBody/jsonSchema/cookie`, `to.be.ok/success/clientError/...`, `to.not...`), `pm.request` (URL, query, método, headers, corpo; alterável no pre-request), `pm.environment`, `pm.globals`, `pm.collectionVariables`, `pm.variables` (precedência e `replaceIn`), `pm.iterationData`, `pm.cookies`, `pm.info`, `pm.sendRequest` (callback ou `await`), `pm.execution.setNextRequest/skipRequest`, `console.*`, `setTimeout`, `require` de lodash, chai, moment, crypto-js, tv4, uuid, atob/btoa. Legado: `tests[...]`, `responseBody`, `responseCode`, `postman.setEnvironmentVariable` etc.
- **Variáveis alteradas pelos scripts são gravadas** (environment ativo, globals, collection) e a tela atualiza; `pm.variables.set` vale só naquele envio.
- **Test Results** na resposta com contagem (ex.: `3/4`), filtro All/Passed/Skipped/Failed, mensagem de erro de cada teste e origem (collection/pasta).
- Erro no pre-request **não envia** a requisição e mostra a causa; `pm.execution.skipRequest()` pula o envio; erro no post-response aparece junto dos testes.
- **Console** (Ctrl+Alt+C) com cada envio e os `console.log` de cada script, na ordem, com a origem.
- **Isolamento:** os scripts rodam num worker separado, em contexto `vm` sem acesso ao Node (sem `process`, `require` de módulos do Node, disco ou rede, exceto `pm.sendRequest`); laço infinito é cortado em 5 s, inclusive dentro de callbacks; promessa pendurada para em 15 s; memória do worker limitada a 256 MB.
- **Testes:** 69 automáticos (`npm test`), incluindo os snippets do Postman, variáveis, mudança da requisição, `pm.sendRequest`, bibliotecas, limites de tempo e 11 tentativas de escapar do isolamento. No app: ordem dos 6 scripts, variáveis gravadas, erro e skip no pre-request, laço infinito, autocompletar. Custo medido: ~1,5 ms a mais por requisição com um script.

Fase 5, autenticação (aba Authorization):
- **Tipos:** Inherit auth from parent, No Auth, Basic Auth, Bearer Token, API Key (header ou query), OAuth 1.0 e OAuth 2.0, no formato v2.1 do Postman (importa e exporta igual). Todos os campos aceitam `{{variáveis}}`; segredos aparecem mascarados com olho para mostrar.
- **Herança:** requisição em "Inherit" usa a pasta mais próxima com auth e, sem pasta, a collection; a aba mostra de onde vem. Auth de collection e de pasta: menu da collection/pasta → **Authorization** (aba própria, Ctrl+S salva). "No Auth" na requisição corta a herança.
- **OAuth 1.0:** HMAC-SHA1/256/512, RSA-SHA1/256/512 (chave privada PEM) e PLAINTEXT; dados no header ou no corpo/URL; avançado com callback, verifier, timestamp, nonce, version, realm, body hash e parâmetros vazios. A assinatura sai da URL e do corpo finais (já com variáveis).
- **OAuth 2.0:** Authorization Code, Authorization Code com PKCE (S256 ou plain), Implicit, Password Credentials e Client Credentials; client auth por header Basic ou no corpo; scope, state (gerado se vazio e conferido na volta), audience. Os fluxos com login abrem numa janela própria, com sessão isolada, e o app captura o redirect (Callback URL padrão `https://oauth.pstmn.io/v1/callback`).
- **Tokens:** guardados no banco **cifrados** com a proteção do Windows (DPAPI, via Electron). "Manage tokens" lista, mostra detalhes, copia, renova (refresh_token) e apaga. Token na requisição: header com prefixo (Bearer por padrão) ou na URL (`access_token`). **Auto-refresh**: com o token escolhido da lista, o app renova antes de vencer e avisa.
- Headers automáticos mostram o `Authorization` gerado pelo auth; um header seu com o mesmo nome vence.
- History: dá para apagar uma entrada só (ícone de lixeira).
- **Testes:** 44 automáticos (`npm test`), incluindo os vetores da RFC 5849 (seções 1.2 e 3.4.1.1) e o exemplo publicado do Twitter. No app, contra um servidor OAuth local: Basic, API Key, OAuth 1.0 conferido por implementação independente no servidor (GET, POST com formulário e segredo errado recusado), os 5 fluxos do OAuth 2.0 (3 com janela de login), segredo errado recusado, token na URL, auto-refresh e herança em 2 níveis de pasta.

Fase 4, importar e exportar:
- **Import** (botão no topo ou Ctrl+O): arrastar arquivos, escolher arquivos ou colar texto. Reconhece sozinho collection **v2.0 e v2.1**, environment, globals (mescla por nome) e **comando cURL** (abre numa aba nova). Mostra o resultado de cada arquivo e o erro quando não reconhece. Collection v1 é recusada com aviso.
- **Colar cURL na URL** converte na hora (método, headers, corpo raw/urlencoded/form-data, `-u`, `-G`, `--json`; aceita o formato bash, o do cmd do Windows com `^` e o do PowerShell com `` ` ``).
- **Export** de collection (menu da collection) em v2.1 (recomendado) ou v2.0, com o nome `<collection>.postman_collection.json`; de environment (ícone na lista ou botão no editor) e de Globals (`workspace.postman_globals.json`).
- **Nada se perde na ida e volta:** auth (convertida entre v2.0 e v2.1), scripts (`event`), exemplos de resposta, `protocolProfileBehavior`, descrições, variáveis da collection, campos extras do `info`, corpo GraphQL e outros modos que o app ainda não edita.
- **Query params desligados** agora aparecem (desmarcados) na aba Params e são guardados; desmarcar um param não o apaga mais.
- **Path Variables** (`/users/:id`): tabela própria na aba Params, e o valor entra no envio.
- **Testes:** a ida e volta foi conferida com 2 collections reais exportadas do Postman (108 requisições, 21 pastas, até 4 níveis, 44 query params desligados, auth bearer/OAuth2) e 1 environment real com 32 variáveis, passando também pelo SQLite. Para repetir com arquivos seus: `PM_FILES="a.json;b.json" npm test` (os arquivos não ficam no projeto).

Fase 3, variáveis:
- **Environments** (barra lateral Environments): criar, editar em aba própria (Variable, Type, Value, filtro, Save com Ctrl+S), renomear, duplicar, apagar e ativar (círculo verde ou seletor no canto superior direito).
- **Globals** e **variáveis da collection** (menu da collection, "Edit variables").
- Tipo **secret**: valor mascarado na tela (olho para mostrar), mas usado normalmente no envio.
- **Precedência igual à do Postman:** Global < Collection < Environment (< Data < Local, que entram com o Runner e os scripts). Variável desligada não vale. Valor pode citar outra variável (`{{base}}` = `https://{{host}}`), até 10 níveis, sem travar em ciclo. Não definida fica literal.
- **Dinâmicas:** `{{$guid}}`, `{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomBoolean}}`, `{{$randomAlphaNumeric}}`, `{{$randomFirstName}}`, `{{$randomLastName}}`, `{{$randomFullName}}`, `{{$randomEmail}}`, `{{$randomColor}}`, `{{$randomIP}}`, `{{$randomPhoneNumber}}`.
- Resolvidas no envio em URL, headers e corpo (raw, urlencoded, form-data texto); o histórico guarda a requisição com as `{{}}` originais.
- **Na tela:** `{{var}}` em laranja quando existe e em vermelho quando não; passar o mouse mostra escopo e valor; digitar `{{` abre o autocompletar (setas, Enter ou Tab). Vale na URL e nas tabelas de Params, Headers, urlencoded e form-data.
- **Quick look** (olho ao lado do seletor): variáveis do environment ativo e Globals, com atalho para editar.
- Testes automáticos: `npm test` (13 testes de precedência e resolução, em `src/shared/variables.test.ts`).

Fase 2, collections:
- **Arrastar e soltar** na árvore: reordenar, pôr dentro de pasta (meio da linha), antes/depois (bordas), mover pasta inteira e mover entre collections. Pasta não entra nela mesma (a tela não deixa e o banco recusa).
- **Duplicar** requisição, pasta (com tudo dentro) e collection inteira; **renomear** por duplo clique ou menu; Ctrl+D duplica a requisição da aba.
- **Menu** de três pontos ou botão direito, flutuante (Add request, Add folder, Rename, Duplicate, Delete; Run e Export aparecem desativados até as fases 8 e 4).
- **Busca** nas collections: filtra pelo nome, abre as pastas do caminho e destaca o trecho.
- **Save** de requisição nova (Ctrl+S): diálogo para dar nome e escolher collection ou pasta, com "+ New Collection".
- Breadcrumb mostra o caminho completo (`Collection / Pasta / Sub /`); o estado aberto/fechado das pastas fica salvo.
- **Árvore virtualizada:** medido com 5.051 linhas abertas: ~44 elementos na tela, rolar até o fim em 6 ms, busca em 11 ms; criar 5.050 itens levou 0,8 s e listar 23 ms.

Fase 1, envio de requisições:
- **Send** (botão, Enter na URL ou Ctrl+Enter) e **Cancel** durante o envio. Requisição sai do processo principal (`src/main/http.ts`), sem CORS.
- **Body:** none, form-data (texto e arquivos, vários por campo), x-www-form-urlencoded, raw (Text, JavaScript, JSON, HTML, XML, com Beautify no JSON) e binary. Editor Monaco local (sem CDN).
- **Headers automáticos** como no Postman (Content-Type pelo corpo, Content-Length, JeffPostman-Token, Host, User-Agent `JeffPostmanRuntime/<versão>`, Accept, Accept-Encoding, Connection); link "N hidden" mostra a lista, e header seu com o mesmo nome substitui o automático.
- **Redirects** seguidos (até 10; 303, e 301/302 em POST, viram GET; Authorization e Cookie caem ao trocar de host). **gzip, deflate e br** descompactados.
- **Resposta:** status colorido, tempo com o detalhe (DNS, TCP, SSL, TTFB, download) e tamanho (headers, corpo, descompactado) ao passar o mouse; Body em Pretty (JSON reindentado sem perder número grande), Raw e Preview (HTML em iframe isolado, sem script; imagem); abas Cookies e Headers; erro de rede com a causa ("Could not resolve host", "Connection refused").
- **Barra lateral ajustável:** arraste a borda direita para alargar ou estreitar (fica lembrado); duplo clique volta ao padrão.
- **Histórico** no SQLite (últimas 1000), barra lateral History agrupada por dia, busca, abrir de novo e limpar tudo.
- Divisor arrastável entre requisição e resposta (posição salva).

Fase 0, base: Electron 45 + React 19 + TypeScript (electron-vite); SQLite local em `%APPDATA%\JEFF Postman\jeff-postman.db` pelo `node:sqlite`; IPC tipado com lista de canais permitidos; tela no estilo do Postman com collections, pastas, abas, Params ↔ URL, Bulk Edit, tema escuro e claro; atalhos Ctrl+S, Ctrl+T, Ctrl+W, Ctrl+Alt+C.

**Limites conhecidos:** não há workspaces na nuvem, sincronização, mock servers, monitors nem GraphQL/WebSocket/gRPC (GraphQL importado é preservado e exportado, mas não editado). OAuth 2.0 abre o login numa janela do app (sem a opção de usar o navegador do sistema). `require` nos scripts não tem cheerio/xml2js e não há `pm.visualizer`. A verificação SSL vem **ligada** (o Postman vem desligada); desligue em Settings se precisar.

**Seus dados:** `%APPDATA%\JEFF Postman\jeff-postman.db` (SQLite). Tokens OAuth e Settings ficam cifrados com a proteção do Windows. Para testar sem tocar nos seus dados: variável `JEFF_POSTMAN_USER_DATA=<pasta>`.

## Comandos (na pasta `apps/desktop`)

```powershell
npm install
```

```powershell
npm run dev
```

```powershell
npm run typecheck
```

```powershell
npm test
```

```powershell
npm run test:e2e
```

```powershell
npm run dist
```

```powershell
npm run cli -- run caminho\colecao.json -e caminho\env.json -d caminho\dados.csv
```

`npm run dist` gera em `apps/desktop/dist/` o instalador `JEFF Postman-Setup-<versão>.exe` e o `JEFF Postman-<versão>-portable.exe` (sem assinatura de código; o Windows SmartScreen avisa na primeira vez).

## Estrutura

```
apps/desktop/
  src/shared/      # código puro (main, tela, CLI e testes): tipos e contrato do IPC, variáveis,
                   # auth, conversor Postman, cURL, data files, cookies, geração de código
  src/main/        # processo principal: index (janela), db (SQLite), ipc, http (envio),
                   # execute (pipeline com scripts), runner, oauth1, oauth2(-core), scripts
  src/main/sandbox # worker dos scripts: pm-runtime.js (API pm), run.ts (vm isolado)
  src/preload/     # ponte segura (window.jeffPostman), só canais da lista
  src/renderer/src # React: App, store (zustand), components/, styles.css
  src/cli/         # comando de terminal jeff-postman
  e2e/             # testes de ponta a ponta (Playwright + Electron)
  build/jeff-postman.cmd  # atalho do CLI que vai junto do app instalado
```
