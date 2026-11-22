import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudRoom} from '../services/tunnel-broker/cloud-room.mjs';
import {CloudBalance} from '../services/tunnel-broker/cloud-balance.mjs';
const now=Date.UTC(2026,10,21);
function fixture(){
 const values=new Map(),storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},async delete(k){values.delete(k);},async transaction(fn){return fn(this);},async setAlarm(t){this.alarm=t;},async getAlarm(){return this.alarm;}};
 const profile={id:'alice',private_metadata:{sessionstream:{cloudMonthlyRenewHours:300,billingTester:true},unrelated:'preserve'}},calls=[];
 const env={CLERK_SECRET_KEY:'fake-secret',CLOUD_BALANCE_FETCH:async(url,options)=>{
  calls.push({url,options});if(env.offline)return Response.json({}, {status:503});if(url.endsWith('/billing/subscription'))return Response.json(env.subscription||{subscription_items:[]});
  if(options.method==='PATCH'){
   const patch=JSON.parse(options.body).private_metadata.sessionstream;
   assert(Object.keys(patch).every(k=>['cloudMonthlyRenewHours','cloudTopupHoursRemaining','cloudNormalHoursRemaining','cloudHoursRemaining'].includes(k)));
   if(Object.hasOwn(patch,'cloudHoursRemaining'))assert.equal(patch.cloudHoursRemaining,null,'obsolete total can only be removed');
   for(const [key,value] of Object.entries(patch)){if(value===null)delete profile.private_metadata.sessionstream[key];else profile.private_metadata.sessionstream[key]=value;}
   if(env.lostResponse)throw Error('Response lost');
  }
  return Response.json(profile);
 }};
 return {storage,values,profile,calls,env,cloud:new CloudRoom(storage,{}),sync:new CloudBalance(storage,env)};
}
test('Clerk contains only the refill and bucket breakdown, preserving other metadata',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000,billingTester:true});await f.cloud.credit('cs_test_paid',1080000,{sandbox:true});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);
 const c=f.profile.private_metadata.sessionstream;assert.equal(c.cloudNormalHoursRemaining,300);assert.equal(c.cloudTopupHoursRemaining,300);assert.equal(c.cloudMonthlyRenewHours,300);assert.equal(Object.hasOwn(c,'cloudHoursRemaining'),false);assert.equal(c.billingTester,true);assert.equal(f.profile.private_metadata.unrelated,'preserve');assert(f.calls[1].url.endsWith('/users/alice/metadata'));assert.equal(f.calls[1].options.redirect,'manual');
});
test('old totals, including malformed values, cannot reset buckets and are removed from Clerk',async()=>{
 for(const value of [0,25,999999,-1,'100',{}]){
  const f=fixture();f.profile.private_metadata.sessionstream.cloudHoursRemaining=value;await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000,billingTester:true});await f.cloud.credit('cs_test_kept',1080000,{sandbox:true});await f.sync.reconcile('alice',f.cloud,now);assert.equal(f.sync.ready,true);await f.sync.publish('alice',f.cloud,now);
  assert.equal((await f.cloud.snapshot(now)).usage.remainingSeconds,2160000);assert.equal((await f.storage.get('cloud-test-credit')).remainingSeconds,1080000);assert.equal(Object.hasOwn(f.profile.private_metadata.sessionstream,'cloudHoursRemaining'),false);
 }
});
test('a lost metadata response cannot replay old credit over a newer top-up',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'free',monthlySeconds:0});await f.cloud.credit('cs_live_first',1080000);await f.sync.reconcile('alice',f.cloud,now);f.env.lostResponse=true;await f.sync.publish('alice',f.cloud,now);assert.equal(f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining,300);
 await f.cloud.credit('cs_live_next',1080000);f.env.lostResponse=false;await f.sync.reconcile('alice',f.cloud,now+16000,{force:true});await f.sync.publish('alice',f.cloud,now+16000);assert.equal((await f.cloud.snapshot(now)).usage.remainingSeconds,2160000);assert.equal(f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining,600);assert.equal(Object.hasOwn(f.profile.private_metadata.sessionstream,'cloudHoursRemaining'),false);
});
test('Clerk outages leave balances intact and metadata cleanup retries safely',async()=>{
 const f=fixture();f.profile.private_metadata.sessionstream.cloudHoursRemaining=0;await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000});f.env.offline=true;await f.sync.reconcile('alice',f.cloud,now,{force:true});await f.sync.publish('alice',f.cloud,now);assert.equal((await f.cloud.snapshot(now)).usage.remainingSeconds,1080000);assert.equal((await f.storage.get('cloud-balance-sync')).pending,true);
 f.env.offline=false;await f.sync.reconcile('alice',f.cloud,now+16000,{force:true});await f.sync.publish('alice',f.cloud,now+16000);assert.equal(f.profile.private_metadata.sessionstream.cloudNormalHoursRemaining,300);assert.equal(Object.hasOwn(f.profile.private_metadata.sessionstream,'cloudHoursRemaining'),false);assert.equal((await f.storage.get('cloud-balance-sync')).pending,false);
});
test('reintroduced legacy totals never change a newer purchase or its source',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);f.profile.private_metadata.sessionstream.cloudHoursRemaining=5;await f.sync.reconcile('alice',f.cloud,now+1000);await f.cloud.credit('cs_live_new',1080000);await f.sync.publish('alice',f.cloud,now+1000);assert.equal((await f.cloud.snapshot(now+1000)).usage.remainingSeconds,2160000);assert.equal(f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining,300);assert.equal(Object.hasOwn(f.profile.private_metadata.sessionstream,'cloudHoursRemaining'),false);
});
test('verified billing renewal refills only the normal bucket: 200 plus 300 becomes 300 plus 300',async()=>{
 const f=fixture(),start=Date.UTC(2026,10,20),end=Date.UTC(2026,11,20),next=Date.UTC(2027,0,20);f.env.CLERK_PRO_PLAN_ID='cplan_pro';await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000,monthlyRenewHours:300,billingTester:true,billingCycle:{start,end,interval:'month'}},now);const old=await f.cloud.snapshot(now);await f.storage.put('cloud-usage:'+old.usage.period,{listenerSeconds:100*3600});await f.cloud.credit('cs_live_rollover',1080000);await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);assert.equal((await f.cloud.snapshot(now)).usage.remainingSeconds,500*3600);
 f.env.subscription={id:'sub_example',status:'active',subscription_items:[{id:'item_example',plan_id:'cplan_pro',status:'active',period_start:end,period_end:next,plan_period:'month'}]};await f.sync.reconcile('alice',f.cloud,end);await f.sync.publish('alice',f.cloud,end);const c=f.profile.private_metadata.sessionstream;assert.equal(c.cloudMonthlyRenewHours,300);assert.equal(c.cloudNormalHoursRemaining,300);assert.equal(c.cloudTopupHoursRemaining,300);assert.equal(Object.hasOwn(c,'cloudHoursRemaining'),false);assert.equal((await f.cloud.snapshot(end)).usage.remainingSeconds,600*3600);assert.equal(await f.storage.getAlarm(),next);
});
test('ended subscriptions retain purchased hours without a new included grant',async()=>{
 const f=fixture(),start=Date.UTC(2026,10,20),end=Date.UTC(2026,11,20);f.env.CLERK_PRO_PLAN_ID='cplan_pro';await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000,billingCycle:{start,end,interval:'month'}},now);await f.cloud.credit('cs_live_keep',1080000);await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);f.env.subscription={subscription_items:[]};await f.sync.reconcile('alice',f.cloud,end);await f.sync.publish('alice',f.cloud,end);const c=f.profile.private_metadata.sessionstream;assert.equal(c.cloudNormalHoursRemaining,0);assert.equal(c.cloudTopupHoursRemaining,300);assert.equal(c.cloudMonthlyRenewHours,300);assert.equal((await f.cloud.snapshot(end)).usage.remainingSeconds,1080000);
});

test('Clerk top-up edits change only carried-over hours and immediately change the calculated total',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);
 f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=125;await f.sync.reconcile('alice',f.cloud,now+1000,{force:true});await f.sync.publish('alice',f.cloud,now+1000);let s=await f.cloud.snapshot(now+1000);assert.equal(s.usage.includedRemainingSeconds,1080000);assert.equal(s.usage.adminRemainingSeconds,125*3600);assert.equal(s.usage.remainingSeconds,425*3600);assert.equal(f.profile.private_metadata.sessionstream.cloudMonthlyRenewHours,300);
 f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=25;await f.sync.reconcile('alice',f.cloud,now+2000,{force:true});await f.sync.publish('alice',f.cloud,now+2000);s=await f.cloud.snapshot(now+2000);assert.equal(s.usage.includedRemainingSeconds,1080000);assert.equal(s.usage.remainingSeconds,325*3600);assert.equal(f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining,25);
});
test('reductions preserve normal hours and purchase receipts without mixing paid and test credit',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000,billingTester:true});await f.cloud.credit('cs_live_keepReceipt',1080000);await f.cloud.credit('cs_test_keepReceipt',1080000,{sandbox:true});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);
 f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=100;await f.sync.reconcile('alice',f.cloud,now+1000,{force:true});await f.sync.publish('alice',f.cloud,now+1000);const s=await f.cloud.snapshot(now+1000);assert.equal(s.usage.includedRemainingSeconds,1080000);assert.equal(s.usage.sandboxRemainingSeconds,0);assert.equal(s.usage.purchasedRemainingSeconds,100*3600);assert.equal((await f.cloud.credit('cs_live_keepReceipt',1080000)).duplicate,true);assert.equal((await f.cloud.credit('cs_test_keepReceipt',1080000,{sandbox:true})).duplicate,true);assert.equal((await f.cloud.snapshot(now+1000)).usage.remainingSeconds,400*3600);
});
test('Free accounts can receive a non-expiring administrator top-up without a monthly grant',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'free',monthlySeconds:0});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=10;await f.sync.reconcile('alice',f.cloud,now+1000,{force:true});await f.sync.publish('alice',f.cloud,now+1000);assert.equal((await f.cloud.snapshot(now+1000)).canCloud,true);assert.equal((await f.cloud.snapshot(Date.UTC(2027,0,1))).usage.remainingSeconds,36000);assert.equal((await f.storage.get('cloud-entitlement')).plan,'free');f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=0;await f.sync.reconcile('alice',f.cloud,now+2000,{force:true});await f.sync.publish('alice',f.cloud,now+2000);assert.equal((await f.cloud.snapshot(now+2000)).canCloud,false);
});
test('invalid top-up values cannot add or remove hours',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000});await f.cloud.credit('cs_live_valid',1080000);await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);for(const value of [-1,'500',{},1e20]){f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=value;await f.sync.reconcile('alice',f.cloud,now+1000,{force:true});assert.equal(f.sync.ready,false);assert.equal((await f.cloud.snapshot(now+1000)).usage.remainingSeconds,2160000);}
});
test('replaying an applied administrator command cannot erase a later purchase',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=100;await f.sync.reconcile('alice',f.cloud,now+1000,{force:true});await f.cloud.credit('cs_live_afterEdit',1080000);const restored=new CloudBalance(f.storage,f.env);await restored.reconcile('alice',f.cloud,now+2000,{force:true});await restored.publish('alice',f.cloud,now+2000);assert.equal(f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining,400);assert.equal((await f.cloud.snapshot(now+2000)).usage.remainingSeconds,700*3600);
});
test('a lost acknowledgment of an edited top-up cannot reset a newer purchase',async()=>{
 const f=fixture();await f.cloud.setAllowance({plan:'pro',monthlySeconds:1080000});await f.sync.reconcile('alice',f.cloud,now);await f.sync.publish('alice',f.cloud,now);f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining=100;await f.sync.reconcile('alice',f.cloud,now+1000,{force:true});f.env.lostResponse=true;await f.sync.publish('alice',f.cloud,now+1000);await f.cloud.credit('cs_live_afterLostAck',1080000);f.env.lostResponse=false;await f.sync.reconcile('alice',f.cloud,now+2000,{force:true});await f.sync.publish('alice',f.cloud,now+2000);assert.equal(f.profile.private_metadata.sessionstream.cloudTopupHoursRemaining,400);
});
