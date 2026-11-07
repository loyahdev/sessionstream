export function billingDestination(value,origin){
 const url=new URL(value,origin);
 if(url.username||url.password)throw Error('Could not open billing.');
 if(url.origin===origin&&['/dashboard/billing/','/dashboard/account/billing','/dashboard/account/'].includes(url.pathname)&&!url.search&&!url.hash)return url.href;
 throw Error('Could not open billing.');
}
