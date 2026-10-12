'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LockKeyhole, LoaderCircle } from 'lucide-react';
export default function Login(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    const f=new FormData(e.currentTarget);
    const login=String(f.get('login')||'').trim();
    const emailLogin=login.includes('@');
    try{
      const r=await fetch(`/api/auth/sign-in/${emailLogin?'email':'username'}`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({[emailLogin?'email':'username']:login,password:f.get('password')})
      });
      if(!r.ok)throw new Error();
      location.href='/admin';
    }catch{setError('Não foi possível entrar. Confira suas credenciais e a conexão com o banco.');setBusy(false);}
  }
  return <main className="login-page"><Link href="/" className="text-button"><ArrowLeft size={16}/> Voltar à loja</Link><form className="panel form-stack" onSubmit={submit}><span className="brand"><span className="brand-icon">≋</span>ONDA</span><span className="eyebrow">ÁREA DO VENDEDOR</span><h1>Seu som.<br/>Seu negócio.</h1><p className="muted">Entre para cuidar da sua loja.</p><label>Usuário ou e-mail<input name="login" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false}/></label><label>Senha<input name="password" type="password" required autoComplete="current-password"/></label>{error&&<div role="alert" className="alert error">{error}</div>}<button className="button" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<LockKeyhole size={18}/>}Entrar com segurança</button><details><summary>Primeiro acesso ou perdeu a senha?</summary><p className="help">O desenvolvedor cria a primeira conta pelo comando <code>npm run admin:create</code>, com um nome de usuário opcional e uma senha exclusiva. Em produção, a senha precisa ter pelo menos 14 caracteres. Não há cadastro público nem senha padrão. Para recuperar a conta, siga o procedimento administrativo no README.</p></details></form></main>;
}
