import {CloudSFU} from './cloud-sfu.mjs';
import {cloudPeriodAt,validBillingCycle} from './cloud-period.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const opaque=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const validId=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
const month=t=>new Date(t).toISOString().slice(0,7);
export class CloudRoom {
 constructor(storage,env){this.storage=storage;this.sfu=new CloudSFU(env);}
 async setAllowance(policy,now=Date.now()){
  if(policy?.available===false)return;if(!Number.isSafeInteger(policy?.monthlySeconds)||policy.monthlySeconds<0)fail('Invalid Cloud allowance.');
  const old=await this.storage.get('cloud-entitlement')||{},cycle=policy.billingCycle;
  let billingCycles=old.billingCycles||[];
  if(cycle===null)billingCycles=[];
  else if(validBillingCycle(cycle))billingCycles=[...billingCycles.filter(c=>c.start!==cycle.start),cycle].sort((a,b)=>a.start-b.start).slice(-2);
  const monthlySeconds=policy.plan==='free'?0:policy.monthlySeconds;
  const next={plan:policy.plan||old.plan||(policy.monthlySeconds>0?'pro':'free'),monthlyRenewHours:policy.monthlyRenewHours??policy.monthlySeconds/3600,monthlySeconds,billingTester:policy.billingTester===true,billingCycles};
  if(validBillingCycle(cycle)&&!old.billingCycles?.length&&!await this.storage.get('cloud-billing-migrated')){
   const previous=cloudPeriodAt(old,now).key,current=cloudPeriodAt(next,now).key;
   if(old.monthlySeconds>0&&previous!==current&&!await this.storage.get('cloud-usage:'+current)){
    const usage=await this.storage.get('cloud-usage:'+previous),adjustment=await this.storage.get('cloud-included-adjustment:'+previous);
    if(usage)await this.storage.put('cloud-usage:'+current,usage);if(adjustment)await this.storage.put('cloud-included-adjustment:'+current,adjustment);
   }
   await this.storage.put('cloud-billing-migrated',true);
  }
  if(old.plan==='pro'&&next.plan==='free'){const room=await this.storage.get('cloud-room');if(room){await this.settle(room,now);if(Object.keys(room.members).length>3)await this.end(room);}}
  await this.storage.put('cloud-entitlement',next);
 }
 async period(now=Date.now()){return cloudPeriodAt(await this.storage.get('cloud-entitlement'),now);}
 async allowance(){return (await this.storage.get('cloud-entitlement'))?.monthlySeconds||0;}
 async snapshot(now=Date.now()){
  const period=await this.period(now),limitSeconds=await this.allowance(),room=await this.storage.get('cloud-room'),usage=await this.storage.get('cloud-usage:'+period.key)||{listenerSeconds:0},credit=await this.storage.get('cloud-credit')||{remainingSeconds:0},admin=(await this.storage.get('cloud-admin-credit'))?.remainingSeconds||0,adjustment=(await this.storage.get('cloud-included-adjustment:'+period.key))?.seconds||0,tester=(await this.storage.get('cloud-entitlement'))?.billingTester===true,sandbox=tester?(await this.storage.get('cloud-test-credit'))?.remainingSeconds||0:0;
  return {configured:this.sfu.configured,canCloud:(await this.storage.get('cloud-entitlement'))?.plan==='pro'&&(Math.max(0,limitSeconds+adjustment-usage.listenerSeconds)+credit.remainingSeconds+sandbox+admin>0),listenerLimit:(await this.storage.get('cloud-entitlement'))?.plan==='pro'?null:3,room:room?{id:room.id,phase:room.phase,listeners:Object.values(room.members).filter(m=>m.ready).length,expiresAt:room.expiresAt}:null,usage:{period:period.key,renewsAt:Number.isFinite(period.end)?period.end:null,listenerSeconds:usage.listenerSeconds,includedSeconds:limitSeconds,includedRemainingSeconds:Math.max(0,limitSeconds+adjustment-usage.listenerSeconds),purchasedRemainingSeconds:credit.remainingSeconds,sandboxRemainingSeconds:sandbox,adminRemainingSeconds:admin,remainingSeconds:Math.max(0,limitSeconds+adjustment-usage.listenerSeconds)+credit.remainingSeconds+sandbox+admin}};
 }
 // Set only carried-over credit. Included allowance and purchase receipts are untouched.
 async setTopupRemaining(seconds,command,now=Date.now()){
  if(!Number.isFinite(seconds)||seconds<0||seconds>Number.MAX_SAFE_INTEGER||typeof command!=='string'||command.length>200)fail('Invalid administrator top-up balance.');
  const snapshot=await this.snapshot(now),current=snapshot.usage.purchasedRemainingSeconds+snapshot.usage.sandboxRemainingSeconds+snapshot.usage.adminRemainingSeconds;
  return this.storage.transaction(async tx=>{
   if((await tx.get('cloud-topup-admin-command'))?.id===command)return {duplicate:true};
   const admin=await tx.get('cloud-admin-credit')||{remainingSeconds:0},delta=seconds-current;
   if(delta>=0){admin.remainingSeconds+=delta;await tx.put('cloud-admin-credit',admin);}
   else{
    let reduction=-delta;
    for(const key of ['cloud-admin-credit',...(snapshot.usage.sandboxRemainingSeconds>0?['cloud-test-credit']:[]),'cloud-credit']){
     const credit=await tx.get(key)||{remainingSeconds:0},used=Math.min(reduction,credit.remainingSeconds);credit.remainingSeconds-=used;reduction-=used;await tx.put(key,credit);
    }
   }
   await tx.put('cloud-topup-admin-command',{id:command,remainingSeconds:seconds,at:now});return {ok:true};
  });
 }
 async save(room){await this.storage.put('cloud-room',room);const remaining=(await this.snapshot()).usage.remainingSeconds,count=room.phase==='streaming'?Object.values(room.members).filter(m=>m.ready).length:0;await this.storage.setAlarm(Date.now()+Math.max(1,Math.min(15000,count?Math.ceil(remaining/count*1000):15000)));}
 async settle(room,now){
  const end=Math.min(now,room.expiresAt),count=room.phase==='streaming'?Object.values(room.members).filter(m=>m.ready).length:0;
  const entitlement=await this.storage.get('cloud-entitlement'),cursor=room.meteredAt,allowance=await this.allowance(),tester=(await this.storage.get('cloud-entitlement'))?.billingTester===true;
  // Persist the usage delta and its cursor together. Invalid requests, crashes
  // and retries must not charge the same elapsed interval more than once.
  await this.storage.transaction(async tx=>{
   let start=cursor;
   while(start<end){const cycle=cloudPeriodAt(entitlement,start),period=cycle.key,until=Math.min(end,cycle.end),key='cloud-usage:'+period,usage=await tx.get(key)||{listenerSeconds:0};const adjustedAllowance=Math.max(0,allowance+((await tx.get('cloud-included-adjustment:'+period))?.seconds||0)),before=usage.listenerSeconds;usage.listenerSeconds+=(until-start)/1000*count;let debit=Math.max(0,usage.listenerSeconds-adjustedAllowance)-Math.max(0,before-adjustedAllowance);if(debit>0){const admin=await tx.get('cloud-admin-credit')||{remainingSeconds:0},used=Math.min(debit,admin.remainingSeconds);admin.remainingSeconds-=used;debit-=used;await tx.put('cloud-admin-credit',admin);}if(debit>0&&tester){const sandbox=await tx.get('cloud-test-credit')||{remainingSeconds:0},used=Math.min(debit,sandbox.remainingSeconds);sandbox.remainingSeconds-=used;debit-=used;await tx.put('cloud-test-credit',sandbox);}if(debit>0){const credit=await tx.get('cloud-credit')||{remainingSeconds:0};credit.remainingSeconds=Math.max(0,credit.remainingSeconds-debit);await tx.put('cloud-credit',credit);}await tx.put(key,usage);start=until;}
   room.meteredAt=Math.max(cursor,now);await tx.put('cloud-room',room);
  });
 }
 async closeEndpoint(endpoint){if(Number.isInteger(endpoint?.channelId))await this.sfu.close(endpoint.sessionId,endpoint.channelId);}
 async end(room){
  // Closing the publication first cuts off every subscriber, even if one
  // subscriber cleanup fails. Keep uncertain closure visible and retryable.
  room.phase='ending';await this.storage.put('cloud-room',room);await this.storage.setAlarm(Date.now()+15000);
  await this.closeEndpoint(room.publisher);
  const results=await Promise.allSettled(Object.values(room.members).map(m=>this.closeEndpoint(m)));
  if(results.some(r=>r.status==='rejected')){await this.storage.setAlarm(Date.now()+15000);fail('Cloud audio stopped. Some connections are still being cleaned up.',503);}
  await this.storage.delete('cloud-room');
 }
 async expire(now=Date.now()){
  const room=await this.storage.get('cloud-room');if(!room)return;
  await this.settle(room,now);await this.storage.put('cloud-room',room);
  if(room.phase==='ending'||room.expiresAt<=now||!(await this.snapshot(now)).canCloud)await this.end(room);
  else await this.save(room);
 }
 async credit(purchase,seconds,{sandbox=false}={}){if(typeof purchase!=='string'||!/^cs_(test_|live_)?[A-Za-z0-9]{1,200}$/.test(purchase)||seconds!==1080000)fail('Invalid Cloud purchase.');return this.storage.transaction(async tx=>{const prefix=sandbox?'cloud-test-':'cloud-',key=prefix+'purchase:'+purchase;if(await tx.get(key))return {ok:true,duplicate:true};const credit=await tx.get(prefix+'credit')||{remainingSeconds:0};credit.remainingSeconds+=seconds;if(!Number.isFinite(credit.remainingSeconds)||credit.remainingSeconds<0||credit.remainingSeconds>Number.MAX_SAFE_INTEGER)fail('Invalid Cloud balance.');await tx.put(prefix+'credit',credit);await tx.put(key,{seconds,at:Date.now()});return {ok:true};});}
 async handle(body,now=Date.now()){
  const allowed={status:[],create:['requestId'],connect:['room','member'],answer:['room','member','sessionDescription'],open:['room','member'],ready:['room','member'],heartbeat:['room'],pause:['room'],remove:['room','member'],end:['room']};
  const fields=allowed[body.action];if(!fields)fail('Unknown Cloud action.');
  for(const key of Object.keys(body))if(!['action','device','deviceCredential','run',...fields].includes(key))fail('Unexpected Cloud request field.');
  if(!validId(body.run))fail('Invalid Cloud installation run.');
  await this.expire(now);
  if(body.action==='status')return this.snapshot(now);
  if((await this.storage.get('cloud-entitlement'))?.plan!=='pro')fail('SessionStream Pro is required for Cloud streaming.',403);
  if(!this.sfu.configured)fail('Cloud streaming is not configured.',503);
  let room=await this.storage.get('cloud-room');
  if(body.action==='create'){
   if(!validId(body.requestId))fail('Invalid Cloud room request.');
   if(room){if(room.device===body.device&&room.run===body.run&&room.requestId===body.requestId)return {ok:true,room:room.id};fail('End the existing Cloud room before starting another.',409);}
   const usage=(await this.snapshot(now)).usage;if(usage.remainingSeconds<=0)fail('Your Cloud listening allowance has been used.',402);
   room={id:opaque(),device:body.device,run:body.run,requestId:body.requestId,phase:'preparing',publisher:null,members:{},createdAt:now,meteredAt:now,expiresAt:now+45000};await this.save(room);return {ok:true,room:room.id};
  }
  if(!room&&body.action==='end'&&validId(body.room))return {ok:true};
  if(!room||body.room!==room.id)fail('Cloud room is no longer available.',404);
  if(room.device!==body.device||room.run!==body.run)fail('Only this room’s hosting installation can change it.',403);
  room.expiresAt=now+45000;
  if(body.action==='end'){await this.settle(room,now);await this.end(room);return {ok:true};}
  if(room.phase==='ending')fail('Cloud room is closing. Try ending it again.',409);
  await this.settle(room,now);
  const usage=(await this.snapshot(now)).usage;if(usage.remainingSeconds<=0){await this.end(room);fail('Your Cloud listening allowance has been used.',402);}
  if(body.action==='heartbeat'){room.expiresAt=now+45000;await this.save(room);return {ok:true,...await this.snapshot(now)};}
  if(body.action==='pause'){await this.end(room);return {ok:true};}
  const member=body.member;if(member!=='publisher'&&!validId(member))fail('Invalid Cloud participant.');
  const publisher=member==='publisher';let endpoint=publisher?room.publisher:room.members[member];
  if(body.action==='remove'){
   if(publisher)fail('End the room to remove its publisher.');
   if(!endpoint)return {ok:true};
   // Persist a non-ready state before awaiting a remote revocation.
   endpoint.ready=false;endpoint.phase='closing';await this.save(room);
   try{await this.closeEndpoint(endpoint);}catch{await this.end(room);fail('Cloud room ended because listener removal could not be confirmed.',503);}
   delete room.members[member];await this.save(room);return {ok:true};
  }
  if(body.action==='connect'){
   if(!publisher&&!endpoint&&(await this.storage.get('cloud-entitlement'))?.plan!=='pro'&&Object.keys(room.members).length>=3)fail('Free Cloud sessions allow up to 3 listeners.',403);
   if(endpoint){if(endpoint.phase==='offered')return {ok:true,sessionDescription:endpoint.offer};fail('Cloud participant already has a connection. Remove it before reconnecting.',409);}
   if(!publisher&&!Number.isInteger(room.publisher?.channelId))fail('The Cloud publisher is not ready.',409);
   endpoint={phase:'allocating',ready:false};if(publisher)room.publisher=endpoint;else room.members[member]=endpoint;
   await this.save(room);
   // An uncertain upstream allocation is never retried blindly.
   endpoint.sessionId=await this.sfu.create();await this.save(room);
   const offer=await this.sfu.establish(endpoint.sessionId);endpoint.offer=offer.sessionDescription;endpoint.phase='offered';await this.save(room);return {ok:true,...offer};
  }
  if(!endpoint)fail('Cloud participant has no connection.',404);
  if(body.action==='answer'){
   if(endpoint.phase!=='offered')fail('Cloud connection must be recreated before negotiation can continue.',409);
   endpoint.phase='answering';await this.save(room);await this.sfu.answer(endpoint.sessionId,body.sessionDescription);delete endpoint.offer;endpoint.phase='answered';await this.save(room);return {ok:true};
  }
  if(body.action==='open'){
   if(Number.isInteger(endpoint.channelId))return {ok:true,channelId:endpoint.channelId,ordered:false,maxPacketLifeTime:120};
   if(endpoint.phase!=='answered')fail('Finish the Cloud connection first.',409);
   endpoint.phase='opening';await this.save(room);endpoint.channelId=await this.sfu.channel(endpoint.sessionId,'audio-'+room.id,publisher?null:room.publisher.sessionId);endpoint.phase='open';endpoint.ready=true;if(publisher)room.phase='streaming';await this.save(room);return {ok:true,channelId:endpoint.channelId,ordered:false,maxPacketLifeTime:120};
  }
  if(body.action==='ready'){
   if(endpoint.phase!=='open')fail('Cloud audio channel is not open.',409);
   endpoint.ready=true;if(publisher)room.phase='streaming';await this.save(room);return {ok:true};
  }
 }
}
