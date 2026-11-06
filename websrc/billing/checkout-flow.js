export function verifyCheckoutIdentity(user,account){
 const primary=user?.primaryEmailAddress;
 if(!user||user.id!==account?.user?.id)throw Error('Please sign in again before subscribing.');
 if(!primary?.emailAddress||primary.verification?.status!=='verified'||primary.emailAddress.toLowerCase()!==account.user.email?.toLowerCase())throw Error('Verify your primary account email in account settings before subscribing.');
 return primary.emailAddress;
}
export function verifyCheckoutPrice(checkout,planId){
 const due=checkout?.totals?.totalDueNow;
 if(checkout?.plan?.id!==planId||checkout.planPeriod!=='month'||due?.amount!==500||String(due.currency).toLowerCase()!=='usd')throw Error('The subscription price could not be verified. Please contact support.');
}
export function paymentMessage(error){return String(error?.errors?.[0]?.longMessage||error?.errors?.[0]?.message||error?.error?.message||error?.message||'Your payment could not be completed. Please try again.').slice(0,300);}
export async function completeCheckout({verify,submit,confirm,finalize}){
 await verify();
 const method=await submit();
 if(method.error)throw Error(paymentMessage(method.error));
 if(!method.data?.paymentToken||method.data.gateway!=='stripe')throw Error('Please check your payment details.');
 let result;
 try{result=await confirm(method.data)}catch{throw Object.assign(Error('We could not confirm the payment result. Check your billing before trying again.'),{uncertain:true})}
 if(result.error)throw Error(paymentMessage(result.error));
 if(result.data?.status!=='completed')throw Object.assign(Error('Your payment is still being confirmed. Check your billing before trying again.'),{uncertain:true});
 try{await finalize()}catch{throw Object.assign(Error('Your payment was received. Open your dashboard to check your Pro subscription.'),{uncertain:true})}
}
