import { db } from '../src/lib/db';
import { runOne, reconcile } from '../src/lib/delivery';
let stopping=false;process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
async function main(){
  let last=0;
  const heartbeat=setInterval(()=>{void db.heartbeat.upsert({where:{id:'worker'},create:{id:'worker'},update:{at:new Date()}}).catch(()=>{});},15000);
  try{while(!stopping){try{await db.heartbeat.upsert({where:{id:'worker'},create:{id:'worker'},update:{at:new Date()}});if(Date.now()-last>60000){await reconcile();last=Date.now();}const did=await runOne();if(!did)await new Promise(r=>setTimeout(r,2000));}catch{console.error('Worker: ciclo falhou; nova tentativa em 5 segundos.');await new Promise(r=>setTimeout(r,5000));}}}
  finally{clearInterval(heartbeat);await db.$disconnect();}
}
void main();
