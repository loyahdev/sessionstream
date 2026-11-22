export function billingDestination(value,origin){
 const url=new URL(value,origin);
 if(url.username||url.password)throw Error('Could not open billing.');
 if(url.origin===origin&&['/dashboard/billing/','/dashboard/account/billing','/dashboard/account/'].includes(url.pathname)&&!url.search&&!url.hash)return url.href;
 throw Error('Could not open billing.');
}

export function readBillingPeriod(){try{return sessionStorage.getItem('sessionstream-billing-period')==='annual'?'annual':'month'}catch{return 'month'}}
export function saveBillingPeriod(period){if(!['month','annual'].includes(period))throw Error('Choose monthly or yearly billing.');try{sessionStorage.setItem('sessionstream-billing-period',period)}catch{}}
export function checkoutDestination(value,origin,period=readBillingPeriod()){
 if(!['month','annual'].includes(period))throw Error('Choose monthly or yearly billing.');
 const url=new URL(billingDestination(value,origin));if(url.pathname==='/dashboard/billing/')url.searchParams.set('period',period);return url.href;
}
