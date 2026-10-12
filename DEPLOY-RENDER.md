# Implantação ONDA — GitHub e Render

Este arquivo prepara a loja completa para implantação. Nada foi contratado, publicado ou conectado por este Blueprint. GitHub guarda o código; o Render executa o site, PostgreSQL e o processo permanente de entrega. GitHub Pages serve somente uma prévia estática e não executa o painel, PIX ou entregas desta aplicação.

## O que o cliente precisa disponibilizar

- Conta Render e autorização dos custos de dois serviços e um banco gerenciado.
- Repositório privado GitHub, com acesso delegado ao desenvolvedor e autorização de leitura para o Render.
- Conta Google/Google Cloud, aplicação Mercado Pago e conta Resend controladas pelo cliente. Ele autoriza o acesso aos próprios arquivos e fornece as credenciais pelos painéis apropriados.
- Acesso DNS somente se usar domínio próprio. A primeira implantação pode usar o endereço HTTPS `onrender.com` fornecido pelo Render.

Não envie senhas pessoais ou credenciais por GitHub, arquivos públicos ou mensagens de atendimento. Convites de acesso permitem configurar as contas sem transferir sua propriedade.

## 1. Publicar o código e revisar os recursos

Envie o conteúdo desta pasta `onda` como raiz do repositório. `package.json`, `Dockerfile`, `.dockerignore` e `render.yaml` devem ficar na raiz. Preserve `.gitignore`: não envie `.env`, `.local`, `node_modules`, `.next`, bancos, tokens ou senhas. A conta local `capo/admin` não acompanha a nova instalação.

Revise `render.yaml`: ele prevê um site Docker, um worker Docker e PostgreSQL 17, todos em `virginia`, com planos pagos básicos e 5 GB de disco no banco. A escolha é uma configuração inicial revisável; capacidade, disponibilidade e custos devem ser confirmados no painel antes da criação. Se já existirem recursos com os mesmos nomes, altere os nomes e todas as referências antes de aplicar.

As duas aplicações compartilham **uma única** `ENCRYPTION_KEY` e um único `BETTER_AUTH_SECRET`, gerados no grupo `onda-production-secrets`. O banco permite somente conexão interna. Vendas reais e prévias automáticas ficam desativadas. Consulte a [referência de Blueprints](https://render.com/docs/blueprint-spec).

## 2. Criar a instalação na conta autorizada

No Render, escolha **New → Blueprint**, conecte o repositório privado e selecione `render.yaml`. Revise a lista de recursos e a cobrança apresentada antes de confirmar a criação. A estrutura foi conferida localmente contra o JSON Schema oficial do Render, incluindo os nomes de planos e tipos de referência. O Blueprint ainda precisa ser validado pelo Render durante esse procedimento; não houve validação autenticada pela CLI/API nem execução de build Docker no provedor. [Fluxo oficial de Blueprints](https://render.com/docs/infrastructure-as-code).

O site aplica `npm run db:migrate` antes de iniciar. O worker pode registrar uma tentativa de banco indisponível durante a primeira implantação até as migrations terminarem; ele tenta novamente. Se a migration falhar, corrija o erro nos logs antes de prosseguir. [Deploy e migrations](https://render.com/docs/deploys#pre-deploy-command).

Abra o endereço HTTPS mostrado em `onda-web`. O Blueprint usa esse endereço automaticamente em `APP_URL` e `BETTER_AUTH_URL`. O endpoint `/api/health` confirma resposta do site e conexão com o banco; ele não confirma Drive, PIX, Resend ou worker. [Health checks](https://render.com/docs/health-checks).

## 3. Criar o administrador de produção

No serviço `onda-web`, adicione temporariamente estas variáveis em **Environment**:

| Variável | Preenchimento |
| --- | --- |
| `ADMIN_EMAIL` | E-mail administrativo do titular |
| `ADMIN_NAME` | Nome do titular |
| `ADMIN_USERNAME` | `capo` ou outro usuário de 3 a 30 caracteres |
| `ADMIN_PASSWORD` | Senha exclusiva com pelo menos 14 caracteres |

Carregue a alteração pelo deploy, abra **Shell** do serviço e execute:

```sh
npm run admin:create
```

Após a confirmação, remova essas quatro variáveis temporárias e faça deploy para carregar a remoção. Abra `/admin` no endereço do site e entre com a conta criada. O comando não recria um administrador já existente. A instalação pública não aceita a senha local `admin`.

No grupo `onda-production-secrets`, guarde `ENCRYPTION_KEY` e `BETTER_AUTH_SECRET` em um cofre seguro. Preserve a mesma chave de criptografia durante todas as atualizações: alterar apenas seu valor impede ler credenciais já armazenadas. O cofre e o backup do banco são partes complementares da recuperação.

## 4. Preparar OAuth, webhooks, remetente e mídias

Use o endereço HTTPS real de `onda-web` nos endpoints abaixo. Não publique produtos para venda antes de configurar e testar as integrações.

| Serviço | Configuração técnica |
| --- | --- |
| Google Cloud | Ativar Drive API, preparar consentimento e criar cliente OAuth Web. Cadastrar `https://ENDERECO-REAL/api/drive/callback`. |
| Render | Adicionar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` ao **grupo compartilhado** `onda-production-secrets`; fazer deploy do site e worker para carregar os valores. Não incluir os segredos no YAML. |
| Mercado Pago | Na aplicação do cliente, cadastrar `https://ENDERECO-REAL/api/webhooks/mercadopago` e evento `payment`. O cliente informa token, recebedor e assinatura secreta no painel ONDA. |
| Resend | Verificar o domínio de envio com os registros DNS fornecidos pelo Resend. O cliente informa chave API e remetente no painel ONDA. |
| Mídias | Hospedar capas e trechos em armazenamento HTTPS público; editar `MEDIA_HOSTS` no Blueprint com os domínios exatos, sem protocolo, separados por vírgula. |

O manual completo entregue com o projeto explica cada configuração Google, Mercado Pago e Resend. Essas integrações dependem de contas autorizadas e da homologação com os provedores. Adicionar variáveis manualmente ao grupo não dispensa um novo deploy para carregá-las. Os valores novos de origem referenciados entre serviços são atualizados no **sync do Blueprint**, portanto revise o site e o worker após mudanças. [Variáveis de ambiente](https://render.com/docs/configure-environment-variables).

Depois, o cliente conecta o Drive, salva a pasta principal restrita, testa conexões e cadastra produtos, preços, capas, prévias e textos da loja. Em `/admin`, confirme que o worker aparece em execução.

## 5. Domínio próprio, quando houver

Adicione o domínio em **onda-web → Settings → Custom Domains**, publique no DNS os registros indicados pelo Render e aguarde validação/HTTPS. Não há domínio definido no Blueprint. [Domínio e certificado](https://render.com/docs/custom-domains).

Para usar o novo domínio como origem permanente, substitua os dois `fromService` de **APP_URL e BETTER_AUTH_URL do serviço web** no YAML por `value: https://DOMINIO-REAL` (sem barra final). Mantenha as referências do worker ao web; sincronize o Blueprint e faça deploy dos dois serviços. Cadastre o callback desse domínio no Google e o webhook correspondente no Mercado Pago. Refaça o login e os testes. Somente adicionar o domínio ao Render não altera a origem usada pela aplicação.

## 6. Homologação, operação e entrega ao cliente

Use **outro Blueprint com nomes de recursos, grupo de segredos e banco separados** para homologação. Não conecte uma prévia ao banco ou aos tokens de produção. Mantenha `ALLOW_LIVE_PAYMENTS=false` nos dois serviços até a aceitação do fluxo. Os testes automatizados locais não substituem uma compra homologada no ambiente publicado.

Confira cobrança, confirmação consultada no Mercado Pago, permissão de leitor no item comprado e e-mail recebido. Verifique notificações duplicadas, recuperação do worker e falhas de entrega. A compatibilidade do fluxo PIX de teste com as credenciais da aplicação do cliente precisa ser confirmada e pode exigir ajuste técnico antes da liberação. A autorização Google também pode exigir publicação/verificação para operação permanente.

Configure alertas dos serviços e confira backups/recuperação do PostgreSQL no plano escolhido. Ensaiar a restauração em banco separado e preservar a chave de criptografia são necessários para provar que uma recuperação funciona. [Backups PostgreSQL](https://render.com/docs/postgresql-backups).

O deploy automático está desativado. Em uma atualização aprovada, faça deploy do web primeiro e só depois do worker no mesmo commit, conferindo migrations, saúde e heartbeat. Mudanças de schema devem manter compatibilidade enquanto a versão anterior ainda estiver em execução.

Somente após homologação configure credenciais de produção e habilite vendas reais no servidor de produção. O Blueprint fornecido continua com essa função desativada. A liberação e a atualização dessa configuração devem ser feitas pelo responsável técnico, com acesso autorizado e registro da alteração.

Entregue ao titular o endereço `/admin`, a conta administrativa, o manual, os convites de acesso às contas e o procedimento de suporte/backup. O trabalho técnico só está concluído depois do deploy e dos testes com os serviços reais. Este pacote prepara a implantação e não representa uma loja já publicada.
