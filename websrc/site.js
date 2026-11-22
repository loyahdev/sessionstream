import {detectDownloadPlatform} from '/websrc/download-platform.js';
import {startNavigation,navigate} from '/websrc/navigation.js';
import {billingDestination,checkoutDestination,readBillingPeriod,saveBillingPeriod} from '/websrc/billing-navigation.js';
import {freshSessionToken} from '/websrc/account-session.js';
let configuration;
async function getConfiguration(){
 if(!configuration)configuration=fetch('/api/account/config',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async response=>{
  if(!response.ok)throw Error('Downloads could not be loaded. Please try again.');
  return response.json();
 }).catch(error=>{configuration=undefined;throw Error(error.name==='TimeoutError'?'Loading downloads took too long. Please try again.':'Downloads could not be loaded. Please try again.');});
 return configuration;
}
async function accountAction(action,button){if(action==='checkout')saveBillingPeriod(button.dataset.period||readBillingPeriod());const finish=startNavigation('Opening checkout…',button);try{const token=await freshSessionToken();const response=await fetch(`/api/account/${action}${action==='checkout'?'?period='+readBillingPeriod():''}`,{method:'POST',headers:{'Content-Type':'application/json','X-Clerk-Session-Token':token}});const data=await response.json();if(response.status===401){navigate('/api/account/sign-in?intent=upgrade','Opening sign-in…');return}if(!response.ok)throw Error(data.error||'Please try again shortly.');location.assign(checkoutDestination(data.url,location.origin))}catch(error){if(error.status===401){navigate('/api/account/sign-in?intent=upgrade','Opening sign-in…');return}finish();document.querySelector('#placeholder-title').textContent='Please try again';document.querySelector('#placeholder-dialog p').textContent=error.message;document.querySelector('#placeholder-dialog').showModal()}}
document.querySelectorAll('[data-buy]').forEach(button=>button.addEventListener('click',()=>accountAction('checkout',button)));
const downloadPlatform=detectDownloadPlatform({platform:navigator.userAgentData?.platform||navigator.platform,userAgent:navigator.userAgent,maxTouchPoints:navigator.maxTouchPoints});
if(downloadPlatform){
 const mac=downloadPlatform==='mac',title=mac?'Download for macOS':'Download for Windows';
 const direct=mac?'https://github.com/loyahdev/sessionstream/releases/latest/download/SessionStream-mac-arm64.dmg':'https://github.com/loyahdev/sessionstream/releases/latest/download/SessionStream-windows-x64-arm64.exe';
 const recommended=document.querySelector('#recommended-download');
 recommended.dataset.download=downloadPlatform;recommended.href=direct;recommended.hidden=false;
 recommended.querySelector('[data-recommended-title]').textContent=title;
 recommended.querySelector('[data-recommended-format]').textContent=mac?'Apple Silicon · VST3 + AU · macOS 13.5+':'Windows 11 · VST3 · x64 / ARM64';
 document.querySelector('#download-detection').hidden=false;
 const alternatives=document.querySelector('.download-alternatives');alternatives.open=false;alternatives.querySelector('summary').textContent='Other downloads';
 for(const hero of document.querySelectorAll('[data-auto-download]')){hero.dataset.download=downloadPlatform;hero.href=direct;hero.querySelector('[data-download-label]').textContent=title;}
}
document.querySelectorAll('[data-download]').forEach(button=>button.addEventListener('click',async event=>{event.preventDefault();const finish=startNavigation('Preparing download…',button);try{const config=await getConfiguration(),url=config.downloads?.[button.dataset.download];if(!url)throw Error('This download is temporarily unavailable. Please try again shortly.');finish();location.href=url}catch(error){finish();document.querySelector('#placeholder-title').textContent='Download unavailable';document.querySelector('#placeholder-dialog p').textContent=error.message;document.querySelector('#placeholder-dialog').showModal()}}));

function displayBillingPeriod(period){
 saveBillingPeriod(period);const annual=period==='annual';
 document.querySelectorAll('[data-billing-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.billingPeriod===period)));
 const price=document.querySelector('#pro-price');if(price){price.textContent=annual?'$100 ':'$10 ';const unit=document.createElement('span');unit.textContent=annual?'USD / year':'USD / month';price.append(unit);}
 for(const button of document.querySelectorAll('[data-buy="pro"]')){button.dataset.period=period;if(button.hasAttribute('data-period-price'))button.textContent=annual?'Get Pro · $100 USD / year':'Get Pro · $10 USD / month';}
 const renewal=document.querySelector('#pricing-renewal');if(renewal)renewal.textContent=annual?'Billed yearly. 2 months free. Cancel future renewal anytime.':'Billed monthly. Cancel future renewal anytime.';
}
document.querySelectorAll('[data-billing-period]').forEach(button=>button.addEventListener('click',()=>displayBillingPeriod(button.dataset.billingPeriod)));displayBillingPeriod(readBillingPeriod());
