# ONDA — loja de músicas e pacotes

Aplicação Next.js App Router + TypeScript + Tailwind, PostgreSQL/Prisma, Better Auth, Mercado Pago Payments API (PIX), Google Drive OAuth e Resend. Inclui loja, painel e worker persistente. Interface em português, preços em centavos e exibição em reais.

**Não está conectada às contas do vendedor.** Nenhuma cobrança real foi realizada. Sem `DATABASE_URL`, a vitrine mostra quatro exemplos visuais identificados e bloqueia a compra; eles não são inseridos no banco. Um banco configurado e vazio mostra o estado de catálogo vazio. Os testes automatizados usam banco isolado e respostas simuladas dos provedores.

## Executar localmente

Requisitos: Node.js 22.18+ LTS, npm e Docker com Compose (ou PostgreSQL 17+ existente).

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run db:generate
npm run db:migrate
```

No Windows, use `Copy-Item .env.example .env`. Gere dois segredos diferentes, localmente, com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`: um para `BETTER_AUTH_SECRET`, outro para `ENCRYPTION_KEY`. Não compartilhe os valores. A chave de criptografia precisa representar exatamente 32 bytes em base64. Preserve-a em um cofre e no backup seguro: sem ela as credenciais do banco não podem ser recuperadas.

Preencha temporariamente `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_USERNAME` (opcional) e `ADMIN_PASSWORD` no `.env`. O painel aceita usuário ou e-mail. A senha precisa ter pelo menos 14 caracteres em produção e não há senha padrão.

```sh
npm run admin:create
# Remova ADMIN_PASSWORD do .env depois de criar a conta.
npm run dev
# Em outro terminal, no mesmo diretório:
npm run worker
```

Abra `http://localhost:3000` e `/admin`. O primeiro administrador só pode ser criado pelo operador com acesso ao servidor. O comando usa lock de banco para impedir dois bootstraps simultâneos. Cadastro público está desativado. A conta pode trocar a senha no assistente; outras sessões são revogadas.

### Ambiente local deste computador

O banco PostgreSQL local e a conta administrativa já foram configurados neste computador. Dê dois cliques em `../iniciar-loja.cmd`: o iniciador liga o banco, o servidor e o worker e abre `/admin` no navegador quando o servidor estiver pronto. Mantenha a janela aberta enquanto usar a aplicação. O banco fica em `.local/postgres` e as credenciais do servidor em `.env`; ambos ficam fora do Git, Docker e ZIP. Para reabrir, use o mesmo iniciador. Não execute duas cópias ao mesmo tempo.

O usuário é persistido no banco, e a senha é armazenada como hash do Better Auth. O ambiente local explicitamente configurado com `ONDA_LOCAL_PREVIEW=true`, URLs em localhost/127.0.0.1 e pagamentos reais desabilitados aceita senhas a partir de cinco caracteres. Fora desse ambiente, o mínimo continua sendo 14. A configuração das contas Google, Mercado Pago e Resend continua sendo feita no painel; o iniciador não conecta essas contas nem cria cobranças.

Em uma instalação nova, o pacote de código não contém a conta ou o banco deste computador. O comando `node --import tsx scripts/local.ts --setup` pode preparar um banco local usando `ADMIN_USERNAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` temporários no ambiente do processo. Remova essas variáveis após o bootstrap. Este iniciador é para desenvolvimento; o deploy de produção usa PostgreSQL gerenciado e os passos anteriores.

Recuperação administrativa: no ambiente do servidor, defina temporariamente `ADMIN_EMAIL`, nova `ADMIN_PASSWORD` e `CONFIRM_RESET=RESET_ADMIN_PASSWORD`. Execute `npm run admin:reset`, remova essas variáveis e entregue a senha ao titular por canal seguro. A recuperação é auditada e encerra todas as sessões.

## O que é do desenvolvedor e o que é do vendedor

| Responsável | Configuração |
| --- | --- |
| Desenvolvedor | PostgreSQL, migrations, backups, Node.js, deploy, proxy HTTPS, worker, segredos do servidor, allowlist de mídia e monitoramento |
| Desenvolvedor + proprietário Google | Projeto Cloud, Drive API, cliente OAuth Web, consentimento e eventual verificação Google |
| Vendedor | Conectar sua Conta Google, indicar pasta principal, cadastrar/validar produtos e testar conexões |
| Vendedor com acesso ao Mercado Pago | Access Token, ID recebedor e segredo do webhook pelo painel |
| Desenvolvedor | Expor webhook HTTPS, habilitar o evento `payment` e homologar o fluxo |
| Vendedor + responsável DNS | Chave Resend, remetente e registros de verificação de domínio |
| Vendedor | Nome, logo, banner, categorias, preços, conteúdo dos pacotes, licença, suporte e textos de compra/privacidade |

O assistente tem sete etapas. Salvar uma credencial **não** a marca como funcionando. Tokens e chaves editáveis são enviados ao backend e cifrados com AES-256-GCM; as respostas do painel contêm apenas estado e mensagens, nunca o valor armazenado. O e-mail de suporte recebe dúvidas; o remetente é a identidade de envio no Resend; a conta Google é proprietária dos arquivos.

## Google Drive

1. Ative a Google Drive API no projeto do proprietário.
2. Configure um cliente OAuth do tipo aplicação Web. Defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` exclusivamente no servidor.
3. Cadastre a URL exata de redirecionamento: `https://sualoja.com.br/api/drive/callback`. Localmente, use `http://localhost:3000/api/drive/callback`.
4. Configure a tela de consentimento. Em modo Testing, inclua o proprietário como usuário de teste e observe a validade limitada dos refresh tokens. Para operação permanente, revise publicação/verificação do consentimento.
5. No painel, clique em **Conectar Google Drive**. O fluxo valida estado aleatório, sessão administrativa, expiração e uso único. O refresh token fica cifrado no banco; access tokens são renovados pelo `google-auth-library`. Revogação ou falha de renovação exige reconectar.
6. Crie uma pasta principal restrita. Coloque diretamente dentro dela os arquivos de músicas e as pastas de pacotes. Salve o ID/link dessa pasta no assistente e teste a conexão.
7. Para cada produto, valide e publique. O servidor consulta MIME type, pasta superior, lixeira, `capabilities.canShare` e permissões. Não aceita atalhos, não vende a pasta principal e rejeita acesso público/por domínio no item (inclusive permissões herdadas retornadas pela API). A publicação repete a validação.

O botão usa navegação completa na mesma aba, sem prefetch do endpoint OAuth. Se faltarem credenciais, o painel informa o motivo e mostra as instruções e o callback exato. Após editar `.env`, encerre e reabra o iniciador para o servidor carregar os valores. Cancelamento, expiração e falha de autorização têm mensagens próprias, sem expor detalhes ou segredos do provedor. Uma reconexão exige salvar e testar novamente a pasta principal.

**Estratégia de escopo:** esta implementação usa `https://www.googleapis.com/auth/drive` para trabalhar com links de arquivos já existentes autorizados pelo proprietário. Não usa `drive.file`, portanto não pressupõe que colar uma URL autorize o aplicativo e não requer Picker. O escopo é restrito e amplo: pode exigir verificação OAuth e avaliação de segurança pelo Google conforme uso/distribuição. Para loja de um único proprietário, o desenvolvedor precisa confirmar o enquadramento aplicável (interno/externo) antes de publicar. Não há promessa de aprovação automática. Se a política da organização exigir `drive.file`, será necessário adaptar o fluxo para Google Picker antes de mudar o escopo.

Só é criada permissão `type=user`, `role=reader` para o e-mail comprador, no arquivo ou na pasta comprada. Nada é compartilhado como `anyone`. O Google pode recusar convites, contas inexistentes, compartilhamento externo, limites diários ou políticas Workspace. Esses casos ficam em tentativa/pendência, sem desfazer o pagamento confirmado. O comprador confirma que o endereço corresponde a uma Conta Google; não se exige domínio Gmail.

Uma pasta compartilhada inclui seu conteúdo e pode incluir adições futuras. O vendedor deve definir o conteúdo contratado e manter o catálogo organizado. Mover/remover arquivos ou revogar acesso após publicação pode impedir entregas futuras; o worker revalida antes de liberar. O controle do Drive não impede redistribuição de arquivos já baixados.

## PIX / Mercado Pago

É usada a **Payments API**, com `POST /v1/payments`, `payment_method_id=pix` e consulta `GET /v1/payments/{id}`. O checkout pede nome, e-mail e CPF do pagador conforme a integração Pix do Mercado Pago. O CPF é cifrado enquanto a cobrança ainda precisa ser criada e removido assim que um pagamento consultado ou criado fica associado ao pedido. Cadastre o evento **Payments (`payment`)**, não `orders`, no webhook da aplicação.

1. Abra [Suas integrações](https://www.mercadopago.com.br/developers/panel/app).
2. No painel da loja, informe Access Token, ID recebedor (`collector_id`) e assinatura secreta de Webhooks. Para teste, selecione Teste e use a credencial de teste da aplicação.
3. Cadastre `https://sualoja.com.br/api/webhooks/mercadopago` como webhook. A URL também é enviada em `notification_url` da cobrança. Use um domínio HTTPS de homologação ou túnel controlado pelo desenvolvedor para testes locais de webhook.
4. **Testar conexão** consulta `/users/me`, confere o recebedor e separação de credenciais. Não cria cobrança nem prova recebimento do webhook.
5. A cobrança só surge quando o comprador conclui o checkout e o worker processa a tarefa persistida. Nenhum teste de conexão ou startup cria cobrança.

O checkout aceita apenas IDs, dados necessários do comprador, confirmações e chaves de idempotência. O checkout coleta CPF do pagador (11 dígitos) para a identificação exigida no PIX. Ele fica cifrado até a cobrança ser persistida e então é removido da loja; não é exposto no painel ou em logs. A validade solicitada do PIX é de 24 horas, respeitando a margem mínima de 30 minutos do provedor. Preços vêm do banco; nome, preço, licença, conteúdo e vínculo de cada item ficam em snapshot. O pedido é persistido antes da cobrança. Um token de 256 bits protege a consulta; só seu SHA-256 fica no banco. O link privado usa fragmento, removido da barra após leitura e guardado em sessionStorage. A API recebe o token em `Authorization`, nunca busca pedido por e-mail. Guarde esse link; trocar de navegador exige utilizá-lo novamente.

A criação usa `X-Idempotency-Key` persistida. Falhas e reinícios repetem a mesma chave e corpo, sem nova cobrança. Webhook verifica HMAC SHA-256 do manifesto `id:...;request-id:...;ts:...;`, comparação em tempo constante e janela de cinco minutos. Depois consulta o provedor e confere ID, referência externa, valor, BRL, recebedor, modo e data. Eventos duplicados não duplicam a fila; eventos antigos não regridem o pagamento. Notificações antigas rejeitadas pela janela são cobertas pela reconciliação.

Pagamentos pendentes, aprovados, cancelados, expirados e reembolsados são separados do estado de entrega. Reembolso parcial e chargeback também suspendem entrega e enfileiram revisão/revogação do acesso. O sistema não inicia reembolsos financeiros pelo painel: eles são feitos na conta Mercado Pago e reconciliados aqui.

Teste e produção devem usar **bancos e URLs separados**. Para produção, configure as credenciais reais no banco de produção vazio e, somente após homologação, `ALLOW_LIVE_PAYMENTS=true`. Troca de credencial PIX com pedidos ativos é bloqueada no painel; faça uma manutenção planejada para preservar consultas de pagamentos anteriores. Dados demonstrativos nunca são semeados em produção.

## Resend

1. Verifique um domínio em [Domains](https://resend.com/domains). O operador de DNS precisa publicar os registros fornecidos pelo Resend.
2. Crie uma API Key com envio autorizado para esse domínio e salve-a no painel.
3. Configure nome, e-mail de remetente, assinatura e contato de suporte.
4. Envie o teste. O estado funcionando significa que o provedor aceitou o envio com esse remetente. Confirme manualmente caixa de entrada e spam.

Há mensagens separadas de pagamento confirmado e entrega. A entrega inclui produtos, links, licença, conteúdo, conta autorizada e suporte. O histórico usa **“aceito pelo provedor”**, não “entregue à caixa de entrada”. Envios usam chaves de idempotência; o Resend mantém sua janela de deduplicação por 24 horas. Uma falha de processo após aceite remoto e antes do commit, seguida de recuperação após essa janela, pode causar repetição de e-mail; não cria cobrança ou novo acesso. Reenvio manual é uma ação nova e auditada.

## Worker, concorrência e recuperação

Execute `npm run worker` como processo permanente, separado do Next.js, com as mesmas variáveis de ambiente. Pode executar mais de uma instância: `FOR UPDATE SKIP LOCKED` reserva tarefas dentro de transação; locks consultivos por pedido e item serializam alterações. A cada item liberado há um commit para preservar o avanço de pedidos grandes. O recebimento do webhook não depende de trabalho em memória após a resposta.

- `charge`: cobrança idempotente de pedido persistido.
- `confirmation`: mensagem de pagamento confirmado.
- `deliver`: libera um item e agenda o próximo; permissões e destinatário são registrados.
- `delivery-email`: envio após todos os itens liberados; falhar o e-mail não refaz permissões.
- `correct-email`: revoga acessos exclusivos anteriores, altera o endereço e agenda nova entrega.
- `revoke`: revisão de acessos após reembolso.
- `resend`: reenvio explícito pelo administrador.

Erros persistem no histórico com mensagens sem payloads ou credenciais. Há até oito tentativas com recuo exponencial; depois a tarefa fica `failed` e o administrador pode corrigir a causa e tentar novamente. O worker sinaliza atividade a cada 15 segundos. Checkout bloqueia sem sinal nos últimos dois minutos. A cada minuto, reconcilia até 100 pagamentos em ordem de consulta, inclusive aprovados para identificar reembolsos. A cadência efetiva depende da latência e volume; monitore a fila e ajuste capacidade antes de crescer. A API nunca entrega por “já paguei”, comprovante, parâmetro do navegador ou botão administrativo.

Permissões preexistentes ou com origem incerta após falha entre operação remota e commit são conservadoramente preservadas. Outras compras válidas para o mesmo item/e-mail também preservam o acesso. Correção/reembolso registra essa decisão para revisão do vendedor. Não se tenta remover permissões herdadas de terceiros. Os locks coordenam instâncias desta aplicação; alterações simultâneas por aplicativos externos não são controladas.

## Mídia e segurança

Capas, logo, banner e prévias são cadastrados por URL HTTPS. Upload direto não é oferecido. Defina domínios exatos em `MEDIA_HOSTS`, separados por vírgula; hospede apenas as prévias em storage público. O servidor não busca URLs arbitrárias cadastradas. Links do Drive, localhost, credenciais na URL e protocolos inseguros são rejeitados. Arquivos pagos nunca entram em `public/` nem na seleção pública de dados.

Rotas administrativas exigem sessão Better Auth e papel admin em cada operação, inclusive OAuth. Mutações conferem Origin; cookies de produção são seguros; há rate limiting persistido e token de pedido. O acesso ao painel é restrito; dados pessoais necessários ao atendimento ficam no banco. Proteja backups e banco com criptografia de infraestrutura. Configure retenção para auditoria, tentativas, pedidos e rate limits conforme a operação. Restrinja o banco à rede da aplicação. O proxy deve preservar o Origin original e impor limites de corpo/conexão; não confie em `X-Forwarded-For` arbitrário.

## Build, testes e deploy

Para GitHub + Render, use [DEPLOY-RENDER.md](DEPLOY-RENDER.md) e o Blueprint `render.yaml`. Ele prepara site, worker e PostgreSQL separados, com segredos compartilhados e pagamentos reais desativados. Ainda depende de conta autorizada, aprovação dos custos e configuração dos provedores; não representa um deploy já publicado.

O comando `npm run build` usa um segredo de autenticação temporário apenas nos subprocessos de compilação. Não precisa receber a credencial real de produção nem inclui esse segredo como variável persistente na imagem. O servidor em execução continua precisando de seu próprio `BETTER_AUTH_SECRET`. O GitHub Actions verifica a compilação e as regras de segurança sem credenciais do vendedor. `/api/health` verifica somente a conexão com o banco e retorna um estado genérico, sem substituir o teste comercial do painel.

```sh
npm run typecheck
npm test
npm run build
npm run test:integration
npm start
```

Os testes de integração inicializam PostgreSQL temporário em porta loopback livre, aplicam a migration, sobem o build de produção do Next em outra porta e testam endpoints reais. Usam mocks estritos apenas para Mercado Pago/Drive/Resend. Não carregam `.env` de produção. Os dados isolados ficam em `work/test-db-*`, fora do pacote de entrega. O executável PostgreSQL é uma dependência apenas de desenvolvimento; em Linux execute os testes como usuário sem privilégios (Postgres não executa como root). Docker Compose usa PostgreSQL 17; os testes embarcados usam a versão distribuída pelo pacote de teste.

Deploy sugerido: servidor/container Node.js com PostgreSQL gerenciado e um worker permanente. Não é uma exportação estática. `Dockerfile` e `compose.production.yaml` são fornecidos; configure `.env` exclusivamente no host ou um gerenciador de segredos. Execute `npm run db:migrate` e bootstrap antes de abrir a loja. Coloque um proxy HTTPS na frente da porta 3000. Use `APP_URL` e `BETTER_AUTH_URL` com a URL pública exata. O worker deve reiniciar automaticamente. Não execute cron efêmero que interrompa o processo no meio de uma tarefa; alternativamente extraia `runOne()` em um runner com duração e agendamento garantidos.

O ambiente Sites/Cloudflare não foi usado para hospedar este projeto porque a stack solicitada exige Node.js, PostgreSQL por TCP e worker permanente. Nenhum domínio de produção foi publicado.

Este checkout usa Webpack/Babel para compatibilidade com o ambiente Windows de preparação, em que SWC não conseguiu canonicalizar o caminho. Não afeta a arquitetura. O build da entrega foi executado com uma adaptação local de filesystem, descrita no relatório de verificação; fora desse sandbox os comandos padrão acima são os previstos.

## Homologar uma compra antes de vender

1. Use banco/URL/credenciais de teste isolados. Configure Drive com itens de teste e Resend com remetente verificado.
2. Crie música e pacote reais de teste, valide no painel e publique. Tente publicar um vínculo inválido e confirme a rejeição.
3. Cadastre os textos de compra, uso e privacidade e mantenha worker ativo.
4. Faça checkout com conta de comprador de teste conforme o Mercado Pago; siga o fluxo PIX de teste oferecido pelo provedor. Não use pagamento real para simular teste nem altere status diretamente no banco de produção.
5. Confira webhook recebido, aprovação consultada, valor/recebedor/referência e tarefas persistidas.
6. Verifique acesso de leitor no arquivo e pasta, sem acesso à pasta principal, usando exatamente a Conta Google compradora. Confira o e-mail real.
7. Repita webhook e interrompa/reinicie worker; não deve haver cobrança extra.
8. Teste falha/reconexão Drive, falha Resend, correção auditada e reembolso em homologação.
9. Só então configure produção separada, backups/monitoramento e habilite vendas reais no servidor.

## Documentação oficial consultada

- [PIX / Payments API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix?scope=prod)
- [Webhooks Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks)
- [OAuth Google para aplicações Web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Escopos do Google Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Criação de permissões / restrição de concorrência](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)
- [Better Auth](https://better-auth.com/docs/installation)
- [Envio de e-mails Resend](https://resend.com/docs/api-reference/emails/send-email)

Consulte `VERIFICACAO.md` para os resultados efetivamente obtidos nesta entrega e o que ainda depende de contas externas.
