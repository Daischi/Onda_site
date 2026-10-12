export const driveOAuthErrors:Record<string,string>={
  oauth_missing:'A conexão com o Google Drive ainda não foi configurada. Falta cadastrar as credenciais OAuth do Google no servidor. Confira as instruções abaixo.',
  state_invalid:'A autorização do Google expirou ou já foi utilizada. Clique em Conectar Google Drive para iniciar novamente.',
  cancelled:'Você cancelou a autorização no Google. Clique em Conectar Google Drive quando quiser tentar novamente.',
  provider_denied:'O Google não concedeu a autorização. Confira o cliente OAuth, a Conta Google autorizada para teste e o endereço de retorno.',
  offline_missing:'O Google não concedeu acesso permanente. Inicie a conexão novamente e autorize o acesso solicitado.',
  connection_failed:'Não foi possível concluir a conexão com o Google. Confira as credenciais OAuth e o endereço de retorno e tente novamente.',
  '1':'Não foi possível concluir a conexão com o Google. Confira as credenciais OAuth e tente novamente.'
};
export function googleOAuthReady(){return !!process.env.GOOGLE_CLIENT_ID?.trim()&&!!process.env.GOOGLE_CLIENT_SECRET?.trim();}
