// Canonical Clerk subscription data only; never use browser metadata as an entitlement.
const stamp=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):null};
export function clerkSubscriptionState(data,planId,now=Date.now()){
 if(!data||typeof data!=='object'||!Array.isArray(data.subscription_items))throw new Error('Invalid Clerk subscription response.');
 const items=data.subscription_items.filter(item=>item?.plan?.id===planId||item?.plan_id===planId);
 const allowed=item=>!['ended','abandoned'].includes(data.status)&&(item.status==='active'||(item.status==='canceled'&&stamp(item.period_end)>now));
 const item=items.find(allowed)||items.filter(x=>x.status!=='upcoming').sort((a,b)=>(stamp(b.created_at)||0)-(stamp(a.created_at)||0))[0];
 const pro=!!item&&allowed(item),cancelled=!!item&&(item.status==='canceled'||!!stamp(item.canceled_at));
 return {provider:'clerk',plan:pro?'pro':'free',status:item?.status||'none',subscription:data.id||null,subscriptionItem:item?.id||null,customer:null,renewsAt:cancelled?stamp(item?.period_end):(stamp(item?.next_payment?.date)||stamp(data.next_payment?.date)||stamp(item?.period_end)),cancelAtPeriodEnd:pro&&cancelled,checkedAt:now};
}
export function validClerkProPlan(plan,planId){return !!plan&&plan.id===planId&&plan.for_payer_type==='user'&&plan.is_recurring===true&&plan.publicly_visible===true&&plan.fee?.amount===500&&String(plan.fee?.currency).toLowerCase()==='usd'&&!plan.annual_fee;}
