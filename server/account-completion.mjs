import {createHash,randomBytes} from 'node:crypto';
// Presentation receipts only: these never authorize an account or reuse an OAuth code.
export class AccountCompletion {
 constructor({now=Date.now,lifetime=300000,limit=8}={}){this.now=now;this.lifetime=lifetime;this.limit=limit;this.receipts=new Map();}
 fingerprint(params){return createHash('sha256').update(JSON.stringify(['state','code','iss','error'].map(key=>params.getAll(key)))).digest('hex');}
 prune(){for(const [id,item] of this.receipts)if(item.expires<=this.now())this.receipts.delete(id);while(this.receipts.size>this.limit)this.receipts.delete(this.receipts.keys().next().value);}
 remember(params,epoch){const id=randomBytes(24).toString('hex');this.receipts.set(id,{fingerprint:this.fingerprint(params),epoch,expires:this.now()+this.lifetime});this.prune();return id;}
 lookup(params,epoch){this.prune();if(epoch===null)return null;const fingerprint=this.fingerprint(params);for(const [id,item] of this.receipts)if(item.epoch===epoch&&item.fingerprint===fingerprint)return id;return null;}
 get(id,epoch){this.prune();const item=this.receipts.get(id);return epoch!==null&&item?.epoch===epoch;}
 clear(){this.receipts.clear();}
}
