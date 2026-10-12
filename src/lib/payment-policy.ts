import type { Payment } from './providers';
export function paymentMatches(p:Payment,o:{id:string;total:number;collectorId:string;liveMode:boolean;paymentId:string|null}){
  return p.external_reference===o.id&&Math.round(p.transaction_amount*100)===o.total&&p.currency_id==='BRL'&&String(p.collector_id)===o.collectorId&&p.live_mode===o.liveMode&&(!o.paymentId||String(p.id)===o.paymentId);
}
export function paymentState(p:Payment){if((p.transaction_amount_refunded||0)>0||['refunded','charged_back'].includes(p.status))return 'refunded';if(p.status==='approved')return 'approved';if(p.status==='cancelled')return p.status_detail==='expired'?'expired':'cancelled';if(p.status==='rejected')return 'cancelled';return 'pending';}
export const canDeliver=(payment:string,correction=false)=>payment==='approved'&&!correction;
