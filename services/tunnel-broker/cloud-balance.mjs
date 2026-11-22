import {cloudPolicyForUser} from './cloud-entitlements.mjs';
import {clerkSubscriptionState} from './clerk-billing.mjs';
// Clerk permits source-specific refill/top-up edits, never an editable combined total.
// The ledger preserves the source of every hour; PATCH merges only these fields.
export class CloudBalance {
 constructor(storage,env){this.storage=storage;this.env=env;const request=env.CLOUD_BALANCE_FETCH||fetch;this.request=(url,options)=>request(url,options);}
 get configured(){return !!this.env.CLERK_SECRET_KEY;}
 async call(user,method,body){
  const response=await this.request('https://api.clerk.com/v1/users/'+encodeURIComponent(user)+(method==='PATCH'?'/metadata':''),{method,headers:{Authorization:'Bearer '+this.env.CLERK_SECRET_KEY.trim(),'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(5000),...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('Clerk balance sync unavailable.');const data=await response.json();if(data.id!==user)throw Error('Invalid Clerk balance owner.');return data;
 }
 async reconcile(user,cloud,now=Date.now(),{force=false}={}){
  this.ready=false;this.fresh=false;if(!this.configured)return;
  try{
   const state=await this.storage.get('cloud-balance-sync')||{};
   const entitlement=await this.storage.get('cloud-entitlement')||{},lastCycle=entitlement.billingCycles?.at(-1),renewalDue=lastCycle&&now>=lastCycle.end;
   if(!force&&!renewalDue&&state.policy?.plan===entitlement.plan&&state.checkedAt>now-15000){await cloud.setAllowance(state.policy,now);this.observedFields=state.observedFields||{};this.ready=true;return;}
   const profile=await this.call(user,'GET'),config=profile.private_metadata?.sessionstream||{};
   let plan=entitlement.plan||'free',cycle;
   if(renewalDue&&this.env.CLERK_PRO_PLAN_ID){
    const response=await this.request('https://api.clerk.com/v1/users/'+encodeURIComponent(user)+'/billing/subscription',{headers:{Authorization:'Bearer '+this.env.CLERK_SECRET_KEY.trim()},redirect:'manual',signal:AbortSignal.timeout(5000)});
    if(!response.ok&&response.status!==404)throw Error('Subscription renewal could not be verified.');
    const bill=clerkSubscriptionState(response.status===404?{subscription_items:[]}:await response.json(),this.env.CLERK_PRO_PLAN_ID,now);plan=bill.plan;
    cycle=plan==='pro'&&bill.periodStart&&bill.periodEnd?{start:bill.periodStart,end:bill.periodEnd,interval:bill.planPeriod}:null;
   }
   const policy={...cloudPolicyForUser(plan,profile),plan,billingTester:config.billingTester===true};await cloud.setAllowance({...policy,...(cycle!==undefined?{billingCycle:cycle}:{})},now);
   const topup=config.cloudTopupHoursRemaining;
   if(topup!==undefined&&topup!==null){
    if(typeof topup!=='number'||!Number.isFinite(topup)||topup<0||topup*3600>Number.MAX_SAFE_INTEGER)throw Error('Invalid administrator top-up balance.');
    const published=state.publishedTopupHours??state.observedFields?.cloudTopupHoursRemaining;
    if(topup!==published&&topup!==state.pendingTopupHours){
     await cloud.expire(now);
     await cloud.setTopupRemaining(topup*3600,JSON.stringify([state.projectionVersion||0,topup]),now);
    }
   }
   this.observedFields=Object.fromEntries(['cloudMonthlyRenewHours','cloudHoursRemaining','cloudTopupHoursRemaining','cloudNormalHoursRemaining'].filter(k=>config[k]!==undefined).map(k=>[k,config[k]]));
   // The obsolete total is observed only so publish can remove it. It cannot change credit.
   this.ready=true;this.fresh=true;
   await this.storage.put('cloud-balance-sync',{...state,policy,observedFields:this.observedFields,checkedAt:now});
  }catch{this.ready=false;await this.retry();}
 }
 async publish(user,cloud,now=Date.now()){
  if(!this.configured)return;
  if(!this.ready)await this.reconcile(user,cloud,now,{force:true});
  if(!this.ready)return;
  try{
   let seconds=(await cloud.snapshot(now)).usage.remainingSeconds;let state=await this.storage.get('cloud-balance-sync')||{};if(!this.fresh&&seconds!==state.lastSyncedSeconds){await this.reconcile(user,cloud,now,{force:true});if(!this.ready)return;seconds=(await cloud.snapshot(now)).usage.remainingSeconds;state=await this.storage.get('cloud-balance-sync')||{};}
   await this.scheduleRenewal(cloud,now);
   const current=await cloud.snapshot(now),entitlement=await this.storage.get('cloud-entitlement')||{};
   const projection={cloudMonthlyRenewHours:this.observedFields?.cloudMonthlyRenewHours??entitlement.monthlyRenewHours??300,cloudTopupHoursRemaining:Number(((current.usage.purchasedRemainingSeconds+current.usage.sandboxRemainingSeconds+current.usage.adminRemainingSeconds)/3600).toFixed(9)),cloudNormalHoursRemaining:Number((current.usage.includedRemainingSeconds/3600).toFixed(9))};
   const removeTotal=Object.hasOwn(this.observedFields||{},'cloudHoursRemaining');
   if(!removeTotal&&Object.entries(projection).every(([key,value])=>this.observedFields?.[key]===value)){await this.storage.put('cloud-balance-sync',{...state,lastSyncedSeconds:seconds,publishedTopupHours:projection.cloudTopupHoursRemaining,pendingTopupHours:null,pending:false});return;}
   await this.storage.put('cloud-balance-sync',{...state,pendingTopupHours:projection.cloudTopupHoursRemaining,pending:true});
   await this.call(user,'PATCH',{private_metadata:{sessionstream:{...projection,...(removeTotal?{cloudHoursRemaining:null}:{})}}});
   console.info('cloud_balance_synced',JSON.stringify({...projection,...(removeTotal?{removedLegacyTotal:true}:{})}));
   this.observedFields=projection;
   await this.storage.put('cloud-balance-sync',{...state,lastSyncedSeconds:seconds,observedFields:projection,publishedTopupHours:projection.cloudTopupHoursRemaining,pendingTopupHours:null,projectionVersion:(state.projectionVersion||0)+1,pending:false});
  }catch{await this.retry();}
 }
 async scheduleRenewal(cloud,now){
  const period=await cloud.period(now),entitlement=await this.storage.get('cloud-entitlement'),expired=entitlement?.billingCycles?.at(-1)?.end<=now;
  const next=Number.isFinite(period.end)?period.end:(expired?now+60000:null),alarm=await this.storage.getAlarm?.();
  if(next&&next>now&&(!alarm||alarm<=now||alarm>next))await this.storage.setAlarm(next);
 }
 async retry(){
  const state=await this.storage.get('cloud-balance-sync')||{};await this.storage.put('cloud-balance-sync',{...state,pending:true,checkedAt:0});
  const next=Date.now()+15000,alarm=await this.storage.getAlarm?.();if(!alarm||alarm>next)await this.storage.setAlarm(next);
  console.error('cloud_balance_sync_pending');
 }
}
