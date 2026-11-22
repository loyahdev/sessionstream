// Only backend-fetched Clerk private metadata controls recurring grants.
export function cloudPolicyForUser(plan,user){
 const config=user?.private_metadata?.sessionstream||{},legacy=config.cloudMonthlyHours,renew=config.cloudMonthlyRenewHours??legacy??300;
 for(const value of [legacy,renew])if(value!==undefined&&value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(value*3600)))throw Error('Invalid administrator Cloud allowance.');
 return {available:true,monthlyRenewHours:renew,monthlySeconds:plan==='pro'?renew*3600:0};
}
