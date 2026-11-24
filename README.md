# JEFF Postman (clone local do Postman para Windows)

Plano completo: [PLANO.md](PLANO.md).

## Estado

**Fases 0 a 5 concluídas em 24/11/2026.**

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
- **Histórico** no SQLite (últimas 1000), barra lateral History agrupada por dia, busca, abrir de novo e limpar tudo.
- Divisor arrastável entre requisição e resposta (posição salva).

Fase 0, base: Electron 45 + React 19 + TypeScript (electron-vite); SQLite local em `%APPDATA%\JEFF Postman\jeff-postman.db` pelo `node:sqlite`; IPC tipado com lista de canais permitidos; tela no estilo do Postman com collections, pastas, abas, Params ↔ URL, Bulk Edit, tema escuro e claro; atalhos Ctrl+S, Ctrl+T, Ctrl+W, Ctrl+Alt+C.

Ainda sem efeito (próximas fases): variáveis `{{}}` (fase 3), Import/Export (4), Authorization (5), Scripts e testes (6), Console (7), Runner (8), Settings da requisição, proxy e certificados (9). A verificação de certificado SSL está **ligada** (o Postman vem com ela desligada); a opção de desligar entra na fase 9.

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
npm run dist
```

`npm run dist` gera em `apps/desktop/dist/` o instalador `JEFF Postman-Setup-<versão>.exe` e o `JEFF Postman-<versão>-portable.exe` (sem assinatura de código).

## Estrutura

```
apps/desktop/
  src/shared/types.ts        # modelo e contrato do IPC
  src/main/index.ts          # janela
  src/main/db.ts             # SQLite, migrações e repositório
  src/main/ipc.ts            # handlers do IPC
  src/preload/index.ts       # ponte segura (window.jeffPostman)
  src/renderer/src/          # React: App, store (zustand), components/, styles.css
```
