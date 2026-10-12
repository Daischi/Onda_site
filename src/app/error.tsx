'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="shell empty"><h1>Uma pausa inesperada.</h1><p>Não conseguimos carregar esta página. Tente novamente em instantes.</p><button className="button" onClick={reset}>Tentar novamente</button><a href="/">Voltar à loja</a></main>;}
