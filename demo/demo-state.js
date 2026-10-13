(function () {
  'use strict';
  const storageKey = 'onda-public-demo-state-v2';
  const clone = value => JSON.parse(JSON.stringify(value));
  const text = (value, fallback = '', limit = 2000) => typeof value === 'string' ? value.slice(0, limit) : fallback;
  const amount = (value, fallback = 0, minimum = 0) => Number.isFinite(Number(value)) ? Math.max(minimum, Math.min(10000000, Math.round(Number(value)))) : fallback;
  const id = (value, fallback) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : fallback;
  const asset = (value, kind, fallback) => typeof value === 'string' && (kind === 'audio' ? /^assets\/audio\/[A-Za-z0-9_-]+\.wav$/ : /^assets\/downloads\/[A-Za-z0-9_-]+\.(wav|zip)$/).test(value) ? value : fallback;
  const date = (value, fallback) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
  const statuses = ['pending', 'approved', 'expired', 'cancelled'];
  const defaults = {
    version: 2,
    categories: [{id:'lofi',name:'Lo-fi'},{id:'ambient',name:'Ambient'},{id:'house',name:'House'},{id:'cinematic',name:'Cinemático'}],
    settings: {
      name:'ONDA',tagline:'CURADORIA INDEPENDENTE DE SONS',heroTitle:'Boas ideias merecem um som à altura.',
      description:'Encontre o som da sua próxima ideia. Músicas e coleções selecionadas para dar vida ao que você imagina.',
      supportEmail:'suporte@exemplo.invalid',accentColor:'#cdfc73',
      terms:'Demonstração da compra de músicas e pacotes. Nenhuma cobrança ou venda real é realizada. Os arquivos disponíveis são exemplos criados para apresentar o funcionamento da loja.',
      privacy:'Os dados desta demonstração são guardados somente neste navegador. Use informações fictícias. Não são enviados ao Mercado Pago, Google Drive ou serviço de e-mail.',
      usage:'Os arquivos de demonstração são amostras sintéticas. Não contêm músicas do vendedor. A licença dos produtos reais será definida pelo cliente antes das vendas.',
      senderName:'ONDA',senderEmail:'musica@exemplo.invalid',signature:'Sinta. Crie. Repita. — ONDA'
    },
    products: [
      {id:'demo-1',name:'Depois da meia-noite',price:1990,type:'track',category:'lofi',categoryName:'Lo-fi',description:'Texturas quentes, acordes macios e um ritmo que deixa as ideias respirarem.',formats:'WAV · MP3',contents:'1 faixa original',published:true,archived:false,featured:true,previewUrl:'assets/audio/demo-1.wav',downloadUrl:'assets/downloads/demo-1.wav'},
      {id:'demo-2',name:'Frequências orgânicas',price:7990,type:'bundle',category:'ambient',categoryName:'Ambient',description:'Uma coleção de paisagens sonoras para imaginar outros lugares.',formats:'WAV · MP3',contents:'12 faixas',published:true,archived:false,featured:true,previewUrl:'assets/audio/demo-2.wav',downloadUrl:'assets/downloads/demo-2.zip'},
      {id:'demo-3',name:'Lado B do verão',price:2490,type:'track',category:'house',categoryName:'House',description:'Grooves solares e uma linha de baixo que pede movimento.',formats:'WAV · MP3',contents:'1 faixa original',published:true,archived:false,featured:false,previewUrl:'assets/audio/demo-3.wav',downloadUrl:'assets/downloads/demo-3.wav'},
      {id:'demo-4',name:'Entre órbitas',price:8990,type:'bundle',category:'cinematic',categoryName:'Cinemático',description:'Camadas, atmosferas e pequenos universos em forma de som.',formats:'WAV · MP3',contents:'8 faixas',published:true,archived:false,featured:false,previewUrl:'assets/audio/demo-4.wav',downloadUrl:'assets/downloads/demo-4.zip'}
    ],
    cart: [], orders: []
  };
  defaults.products.forEach(p => { p.license = defaults.settings.usage; });
  let memory = normalize(defaults);
  function normalize(input) {
    const raw = input && typeof input === 'object' ? input : defaults;
    const settings = {};
    for (const key of Object.keys(defaults.settings)) settings[key] = text(raw.settings?.[key], defaults.settings[key], ['terms','privacy','usage','signature'].includes(key) ? 12000 : 2000);
    settings.name = settings.name.trim() || defaults.settings.name;
    settings.accentColor = /^#[0-9a-f]{6}$/i.test(settings.accentColor) ? settings.accentColor : defaults.settings.accentColor;
    const categories = [];
    for (const [index, candidate] of (Array.isArray(raw.categories) ? raw.categories : defaults.categories).slice(0,100).entries()) {
      if (!candidate || typeof candidate !== 'object') continue;
      const category = {id:id(candidate.id,'category-'+index),name:text(candidate.name,'Categoria',100).trim() || 'Categoria'};
      if (!categories.some(c => c.id === category.id)) categories.push(category);
    }
    if (!categories.length) categories.push({id:'uncategorized',name:'Sem categoria'});
    const products = [];
    for (const [index, candidate] of (Array.isArray(raw.products) ? raw.products : defaults.products).slice(0,100).entries()) {
      if (!candidate || typeof candidate !== 'object') continue;
      const type = candidate.type === 'bundle' ? 'bundle' : 'track';
      const category = categories.find(c => c.id === candidate.category) || categories[0];
      const product = {
        id:id(candidate.id,'product-'+index),name:text(candidate.name,'Produto de exemplo',200).trim() || 'Produto de exemplo',
        price:amount(candidate.price,1990,1),type,category:category.id,categoryName:category.name,
        description:text(candidate.description,'Produto fictício para demonstração.',4000),formats:text(candidate.formats,'WAV',100),
        contents:text(candidate.contents,'Arquivo de exemplo',4000),license:text(candidate.license,settings.usage,12000),
        published:candidate.published === true,archived:candidate.archived === true,featured:candidate.featured === true,
        previewUrl:asset(candidate.previewUrl,'audio','assets/audio/demo-'+(type==='bundle'?'2':'1')+'.wav'),
        downloadUrl:asset(candidate.downloadUrl,'download','assets/downloads/demo-'+(type==='bundle'?'2.zip':'1.wav')),
        createdAt:date(candidate.createdAt,'2026-10-12T12:00:00.000Z')
      };
      if (product.archived) product.published = false;
      if (!products.some(p => p.id === product.id)) products.push(product);
    }
    const cart = Array.isArray(raw.cart) ? [...new Set(raw.cart)].filter(productId => products.some(p => p.id === productId && p.published && !p.archived)).slice(0,50) : [];
    const orders = [];
    for (const [index, candidate] of (Array.isArray(raw.orders) ? raw.orders : []).slice(0,100).entries()) {
      if (!candidate || typeof candidate !== 'object') continue;
      const sourceItems = Array.isArray(candidate.items) ? candidate.items : Array.isArray(candidate.itemsSnapshots) ? candidate.itemsSnapshots : [];
      const items = sourceItems.slice(0,50).filter(p => p && typeof p === 'object').map((p,itemIndex) => {
        const type = p.type === 'bundle' ? 'bundle' : 'track';
        return {
          id:id(p.id,'order-item-'+itemIndex),name:text(p.name,'Produto de exemplo',200),price:amount(p.price),type,
          formats:text(p.formats,'WAV',100),contents:text(p.contents,'Arquivo de exemplo',4000),license:text(p.license,settings.usage,12000),
          downloadUrl:asset(p.downloadUrl,'download','assets/downloads/demo-'+(type==='bundle'?'2.zip':'1.wav'))
        };
      });
      if (!items.length) continue;
      const paymentStatus = statuses.includes(candidate.paymentStatus) ? candidate.paymentStatus : 'pending';
      const order = {
        id:id(candidate.id,'order-'+index),orderNumber:text(candidate.orderNumber,'ONDA-DEMO-'+(index+1),80),
        createdAt:date(candidate.createdAt,new Date().toISOString()),updatedAt:date(candidate.updatedAt,date(candidate.createdAt,new Date().toISOString())),
        items,total:items.reduce((sum,item) => sum+item.price,0),
        buyer:{name:text(candidate.buyer?.name,'Pessoa Exemplo',200),email:text(candidate.buyer?.email,'pessoa@exemplo.invalid',254)},
        paymentStatus,deliveryStatus:paymentStatus === 'approved' && candidate.deliveryStatus === 'delivered' ? 'delivered' : 'pending',
        example:candidate.example === true,
        emailPreviewed:candidate.emailPreviewed === true
      };
      if (!orders.some(o => o.id === order.id)) orders.push(order);
    }
    return {version:2,settings,categories,products,cart,orders};
  }
  function read() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) memory = normalize(JSON.parse(saved));
    } catch {}
    return clone(memory);
  }
  function store(state) {
    memory = normalize(state);
    try { localStorage.setItem(storageKey,JSON.stringify(memory)); } catch {}
    window.dispatchEvent(new CustomEvent('onda-demo-change'));
    return clone(memory);
  }
  function update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('Use a function to change the demonstration state.');
    const state = read();
    const result = mutator(state);
    return store(result && typeof result === 'object' ? result : state);
  }
  function reset() {
    try { localStorage.removeItem('onda-public-demo-cart-v1'); } catch {}
    return store(clone(defaults));
  }
  function subscribe(callback) {
    const local = () => callback(read());
    const external = event => { if (event.key === storageKey || event.key === null) callback(read()); };
    window.addEventListener('onda-demo-change',local);
    window.addEventListener('storage',external);
    return () => { window.removeEventListener('onda-demo-change',local);window.removeEventListener('storage',external); };
  }
  window.ONDA_DEMO = Object.freeze({version:2,storageKey,read,update,reset,subscribe});
})();
