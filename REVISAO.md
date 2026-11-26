# Ajustes da 0.2.1 (26/11/2026, uso real)

| # | Tipo | Achado | Ajuste |
|---|---|---|---|
| 1 | Bug | Ao anexar, a aba que voltava apagava a aba vazia que o usuário já tinha na principal (a regra de "a aba vazia dá lugar" valia para qualquer aba vazia). Com duas janelas e abas vazias, parecia que o Anexar só fechava a janela. | Só a aba vazia que o próprio app abriu ao esvaziar a janela pode ser substituída. Teste e2e do cenário. |
| 2 | Refino | Arrastar a aba usava o arrasto nativo do navegador: fora da janela aparecia o círculo de proibido e não havia sinal de onde ela iria. | Arrasto próprio com o mouse capturado: cursor de mover o tempo todo, etiqueta "Nova janela: …" / "Anexar aqui: …" seguindo o mouse e a barra de abas da janela de destino acesa. Esc cancela. Teste e2e da reordenação com o mouse. |
| 3 | Bug | A etiqueta do arrasto crescia a cada movimento (setPosition no Windows com escala de tela). | Posição e tamanho juntos (setBounds). Conferido no app real. |
| 4 | Bug | A etiqueta ficava atrás das janelas: no Windows o alwaysOnTop do construtor não vale para janela que não recebe foco. | setAlwaysOnTop(true, 'screen-saver') e moveTop ao mostrar. Conferido (isAlwaysOnTop) e o conteúdo capturado. |

# Revisão de código (26/11/2026, versão 0.2.0)

Revisão das entregas de 25 e 26/11: Runner com detalhe e Pause, barra lateral ajustável, PDF e imagem, Console na resposta e no Runner, barra de abas com scroll e abas em janela separada.

| # | Tipo | Achado | Ajuste |
|---|---|---|---|
| 1 | Bug | Soltar uma aba arrastada sobre a URL ou um editor colava o nome da aba ali (o arrasto usava `text/plain`). | Tipo próprio no arrasto (`application/x-jeff-postman-tab`), que nenhum campo aceita. |
| 2 | Bug | A cada envio a resposta voltava para Pretty, mesmo com Raw escolhido (a resposta é recriada a cada envio). | O último modo escolhido para texto vale nos envios seguintes; binário abre em Preview. Teste e2e. |
| 3 | Falha | Arrastar uma aba da principal sobre uma janela destacada criava outra janela em vez de juntar a aba àquela. | O main acha a janela do app sob o mouse (a mais recente em foco) e a aba vai para ela (`window:moveTo`). |
| 4 | Falha | Na janela destacada, abrir pela busca uma requisição aberta na principal criava uma segunda cópia editável. | Todas as janelas informam as requisições abertas; abrir uma que está em outra janela traz aquela janela. Teste e2e. |
| 5 | Refino | Reordenar arrastando "pulava" entre abas de larguras diferentes. | Só troca de lugar depois de passar do meio da aba. |
| 6 | Refino | No detalhe do Runner, a aba escolhida (Console, Headers) voltava para Response a cada linha. | A aba e a sub-aba ficam as mesmas ao trocar de linha. Teste e2e. |
| 7 | Refino | O menu de clique direito da aba podia sair da janela perto da borda. | Posição limitada à janela. |
| 8 | Refino | A largura da barra lateral e do detalhe do Runner não se reajustava quando a janela diminuía. | Ao redimensionar, vale a largura gravada dentro do limite da janela atual. |

Testes: 111 automáticos e 13 de ponta a ponta. O arrasto real de uma aba para fora da janela (soltar sobre a área de trabalho) não é simulável no Playwright; destacar pelo menu, mover, anexar, fechar e sincronizar estão cobertos.

# Revisão de código (25/11/2026)

Revisão completa do app depois das 9 fases: processo principal (envio HTTP, execução, Runner, OAuth, banco, IPC), sandbox dos scripts, código compartilhado (variáveis, auth, cookies, cURL, Postman, geração de código, data files), tela e CLI. Cada ajuste tem teste novo, e os testes de segurança foram conferidos falhando sem a correção.

## Segurança

| # | Achado | Ajuste |
|---|---|---|
| 1 | A janela podia navegar para outra página (soltar um `.html` fora da área de import, link, redirect). A página nova recebia o preload e, com ele, o IPC inteiro: ler arquivo do disco e mandar para a rede por um form-data, por exemplo. | `will-navigate` só deixa ficar na tela do app; `will-attach-webview` recusado; cada chamada de IPC confere se veio da tela do app (`event.senderFrame.url`). Teste e2e novo, que falha sem a correção. |
| 2 | O limite de tamanho da resposta valia só para o corpo compactado. Uma resposta gzip/br de poucos KB podia abrir em gigabytes (zip bomb) e derrubar o app. | `decode` usa `maxOutputLength` com o mesmo limite de Settings; acima dele, erro claro. Testes com gzip, br e deflate, e um envio real. |
| 3 | O renderer podia ler e sobrescrever `settings_enc` (as Settings cifradas) pelo `state:get/set`. | Chave reservada: `state:get` devolve nada e `state:set` recusa. |

## Bugs

| # | Achado | Ajuste |
|---|---|---|
| 4 | Se o `http:send` lançasse exceção (banco, IPC, refresh), a aba ficava em "Sending..." para sempre e não deixava enviar de novo. | `sendActive` trata a exceção e mostra o erro na resposta. |
| 5 | Falha no auto-refresh do OAuth 2.0 subia como exceção; no Runner, parava a execução inteira. | Vira erro só daquela requisição (`OAUTH2_REFRESH`), com a orientação de pedir token novo. |
| 6 | O pedido de token (client credentials, password, code, refresh) usava o `fetch` do Node: ignorava proxy, verificação SSL, CA extra, certificado de cliente e timeout, e podia ficar pendurado. | O pedido de token sai pelo mesmo envio das requisições, com as Settings; sem timeout configurado, 60 s. Testes contra servidor local (Basic, corpo, resposta em form, erro, timeout, refresh). |
| 7 | A captura do callback do OAuth 2.0 era por prefixo de texto: com o login e o callback no mesmo endereço (callback `http://localhost:3000`, login em `/oauth/authorize`) concluía na hora, sem code; e `.../callbackEVIL` também passava. | `isRedirectTarget` compara esquema, host, porta e caminho. Testes. |
| 8 | Fechar uma aba (X, botão do meio, Ctrl+W) ou o app com alterações não salvas perdia tudo sem aviso. | A aba pede confirmação; o app pergunta "Sair sem salvar" ao fechar. Teste e2e novo. |
| 9 | Cancel e timeout não derrubavam o túnel CONNECT do proxy HTTPS enquanto o proxy não respondia. | O CONNECT usa o mesmo signal da requisição. |
| 10 | Dois envios ao mesmo tempo gravavam o jar de cookies inteiro, e o último apagava os cookies que o outro tinha recebido. | O jar guarda só o que mudou (`changes`) e o banco aplica essas mudanças. |

## Refinos

| # | Achado | Ajuste |
|---|---|---|
| 11 | Cookie com valor entre aspas perdia as aspas ao voltar (a RFC 6265 e os navegadores mantêm). | Valor guardado como veio. |
| 12 | O "Copy as cURL (cmd)" do Chrome e do Edge (`^"`, `^&`, `^\^"`) não importava. | O escape com `^` é desfeito antes de ler o comando. Teste com um comando real desse formato. |
| 13 | No cURL gerado, `--form` com `"` ou `\` no valor quebrava o comando. | Valor escapado. |
| 14 | O JSON da API do Postman (`{ "collection": {...} }`, `{ "environment": {...} }`) não importava. | Reconhecido. |
| 15 | A versão do CLI estava escrita à mão. | Sai do `package.json` no build. |
| 16 | O Runner, com "Keep variable values", gravava as variáveis com campos internos, e dava erro se o environment fosse apagado durante a execução. | Grava só os campos do Postman e confere se o environment existe. |

## Visto e mantido

- **Isolamento dos scripts:** o `__host` sai do contexto antes do script do usuário, só texto cruza a fronteira e há tempo limite em todo código do usuário. Os 11 testes de fuga continuam passando.
- **Client auth Basic do OAuth 2.0** usa `encodeURIComponent` no id e no segredo, como manda a RFC 6749 (2.3.1). Servidor que não decodifica pode recusar segredo com `+`, `/` ou `=`. Nesse caso, use "Send client credentials in body".
- **Segredos em texto puro** no corpo das requisições salvas e no histórico, igual ao Postman. Só os tokens OAuth e as Settings são cifrados.
- **Sem lista de sufixos públicos (PSL) nos cookies:** um `Domain=com` seria aceito. Tem pouco efeito num app local.

## Testes

- `npm test`: 101 automáticos (eram 82; os 19 novos estão em `http.test.ts`, `oauth2-core.test.ts`, cookies, cURL, codegen e postman).
- `npm run test:e2e`: 6 de ponta a ponta (eram 4; os novos são a confirmação ao fechar aba e o bloqueio de navegação).
