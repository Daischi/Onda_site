# Verificação da entrega

## O que foi executado

- `tsc --noEmit`: concluído sem erros.
- `next build --webpack` em modo produção: concluído. As páginas são renderizadas no servidor; a aplicação não é exportação estática.
- `npm run build` também concluído em cópia isolada sem `.env`, `DATABASE_URL`, credenciais Google ou segredos de produção. O processo usa autenticação temporária apenas para compilar. A verificação local foi feita no Windows com a adaptação local de filesystem. O GitHub Actions também concluiu o build em Linux com Node.js 22; a imagem Docker ainda não foi compilada no provedor.
- Testes de segurança: **11 passaram**. Cobrem alteração de preço/total pelo navegador, itens duplicados, e-mail sem domínio Gmail, HMAC e replay de webhook, valor/moeda/recebedor/modo/referência incompatíveis, status de pagamento e reembolso, cifra AES-GCM, token privado, URLs do Drive e origem de mutações.
- Integração com PostgreSQL temporário: **16 passaram**. Os endpoints reais de autenticação e administração foram exercitados junto com cadastro de faixa/pacote, snapshots e idempotência, pesquisa e paginação de pedidos, API de pedido privado, webhook inválido, confirmação duplicada e fora de ordem, geração/idempotência do PIX, compartilhamento de arquivo e pasta, retentativas após falhas, correção auditada de endereço, reembolso e bloqueio de publicação de itens não autorizados. Também foram verificados redirecionamento OAuth, callback exato, state de uso único, cancelamento, expiração, mensagem de credenciais Google ausentes e o health check sem exposição de configurações.
- `render.yaml`: estrutura validada localmente contra o JSON Schema oficial do Render; site, worker e banco separados, segredos compartilhados e vendas reais desativadas. Sem criação de recursos ou validação autenticada no provedor.
- GitHub Actions: instalação de dependências, build sem credenciais de produção e testes de segurança concluídos com sucesso em Linux/Node.js 22 no commit `b19982eab6757d1334b66298c2731dfe4c2cfcaf`. [Execução verificada](https://github.com/Daischi/Onda_site/actions/runs/38302383986).
- Demonstração em `demo/`: scripts verificados sem chamadas ao backend. Persistência entre páginas, alterações no painel, snapshots de preço dos pedidos, transições de entrega e restauração verificados com o estado compartilhado. No navegador, foram exercitados reprodução real de áudio de exemplo, carrinho, checkout, expiração, nova tentativa, aprovação e entrega, recarga do pedido, download ZIP e recibo, histórico, métricas do painel, alteração de preço persistente, abertura do produto na vitrine, personalização e textos de compra. Os downloads e as amostras foram verificados quanto a formato e integridade. O workflow publica apenas essa pasta no GitHub Pages.

Os testes substituem os serviços externos por respostas simuladas. Eles **não** atestam acesso a contas do vendedor, entrega real pelo Drive, recebimento do webhook público, reputação DNS ou entrega de mensagem em caixa postal. Não foram criadas cobranças reais. Credenciais de teste, documento de teste e pedidos de teste são gerados no ambiente temporário, fora do pacote.

## Estado atual

- Código publicado em [Daischi/Onda_site](https://github.com/Daischi/Onda_site), na branch `main`. O acesso da conta Daischi foi confirmado e o envio por Git foi concluído. A publicação do código não cria a hospedagem da loja.
- A demonstração para apresentação usa uma vitrine e um painel estáticos, separados da aplicação completa. Não possui autenticação administrativa real, pagamento, banco, acesso aos arquivos pagos ou envio de e-mail. Consulte a seção de demonstração do README.
- Neste computador há banco PostgreSQL local persistente e conta administrativa por usuário. O login por usuário, a rejeição de senha incorreta, a sessão, a abertura de `/admin`, o salvamento de configurações e a reabertura do banco foram verificados com endpoints reais. O iniciador Windows foi atualizado para ligar banco, servidor e worker.
- Não há conta Mercado Pago, Google Drive ou Resend conectada. A aplicação completa ainda não foi implantada no servidor; a demonstração pública funciona no GitHub Pages com dados locais fictícios.
- A vitrine exibe dados visuais de demonstração quando não há banco e impede o checkout. Com banco vazio, mostra o estado sem produtos.
- Os testes de Google, pagamento e e-mail no painel continuam pendentes até configuração e validação real.
- O Sites não publicou esta loja. O projeto requer Node.js, PostgreSQL com conexão TCP, HTTPS e um worker permanente; use a configuração de deploy documentada para esse ambiente.
- A prévia HTTP local não pôde ser aberta pelo navegador isolado desta sessão. O build de produção e os endpoints foram verificados por execução automatizada.

## Falta configurar para vender

1. Instalar a aplicação em um host Node.js e PostgreSQL, definir os segredos e URL HTTPS, aplicar migrations e criar a primeira conta administrativa.
2. Manter o worker ativo e o banco protegido, com backups.
3. Configurar o projeto OAuth e a API Drive da conta proprietária, conectar essa conta e completar eventual verificação do escopo restrito solicitado pelo Google.
4. Configurar credenciais, recebedor e webhook de teste do Mercado Pago; homologar um pagamento PIX de teste por todo o fluxo.
5. Verificar o domínio, salvar a chave do Resend e confirmar na prática o recebimento de teste.
6. Criar as categorias, revisar conteúdo, licenças e textos legais, cadastrar cada item no catálogo restrito, validar e publicar.
7. Homologar faixa e pacote com contas de comprador, falhas de integração, correção de e-mail e reembolso. Depois, usar banco e URLs separados para produção e habilitar `ALLOW_LIVE_PAYMENTS=true` no servidor.

Veja o [README.md](README.md) para os procedimentos, endpoints e documentação oficial usados.
