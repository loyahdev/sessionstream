const monthAt=t=>new Date(t).toISOString().slice(0,7);
const valid=n=>Number.isSafeInteger(n)&&n>0;
export function validBillingCycle(cycle){return !!cycle&&valid(cycle.start)&&valid(cycle.end)&&cycle.end>cycle.start&&['month','annual'].includes(cycle.interval);}
function anniversary(start,offset){const date=new Date(start),month=date.getUTCMonth()+offset,day=Math.min(date.getUTCDate(),new Date(Date.UTC(date.getUTCFullYear(),month+1,0)).getUTCDate());return Date.UTC(date.getUTCFullYear(),month,day,date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds());}
function within(cycle,time){
 let start=cycle.start,end=cycle.end;
 if(cycle.interval==='annual'){for(let i=1;i<=13;i++){const next=Math.min(cycle.end,anniversary(cycle.start,i));if(time<next||next===cycle.end){end=next;break;}start=next;}}
 return {key:'billing:'+start,start,end};
}
// Never invent a paid renewal from elapsed time. Monthly terms advance only
// after Clerk confirms the next period. Annual plans refill on monthly anniversaries.
export function cloudPeriodAt(entitlement,time){
 const cycles=(entitlement?.billingCycles||[]).filter(validBillingCycle).sort((a,b)=>a.start-b.start);
 const cycle=cycles.find(c=>time>=c.start&&time<c.end);
 if(cycle)return within(cycle,time);
 const previous=cycles.filter(c=>c.start<=time).at(-1);
 if(previous){const period=within(previous,previous.end-1);return {...period,end:Infinity};}
 const date=new Date(time),key=monthAt(time);return {key,start:Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1),end:Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)};
}
