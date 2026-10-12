import { db } from './db';
export const publicProductSelect={id:true,name:true,description:true,price:true,cover:true,preview:true,type:true,featured:true,formats:true,contents:true,license:true,category:{select:{id:true,name:true}},createdAt:true} as const;
export const defaults={name:'ONDA',description:'Encontre o som da sua próxima ideia.',support:'',logo:'',banner:'',terms:'',privacy:'',usage:''};
export async function catalog(){
  if(!process.env.DATABASE_URL)return {products:[],categories:[],settings:defaults,configured:false};
  try{const [products,categories,settings]=await Promise.all([db.product.findMany({where:{status:'published',validatedAt:{not:null}},select:publicProductSelect,orderBy:{createdAt:'desc'}}),db.category.findMany({orderBy:{position:'asc'}}),db.settings.findUnique({where:{id:'store'},select:{name:true,description:true,support:true,logo:true,banner:true,terms:true,privacy:true,usage:true}})]);return {products,categories,settings:settings||defaults,configured:true};}catch{return {products:[],categories:[],settings:defaults,configured:false};}
}
