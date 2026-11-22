import {detectDownloadPlatform} from '/websrc/download-platform.js';
import {startNavigation,navigate} from '/websrc/navigation.js';
import {billingDestination,checkoutDestination,readBillingPeriod,saveBillingPeriod} from '/websrc/billing-navigation.js';
import {freshSessionToken,loadAccountClerk} from '/websrc/account-session.js';
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

// Load account UI only when requested, keeping Clerk off the homepage's initial load.
const homeAccount=document.querySelector('.home-account'),homeAccountToggle=document.querySelector('#home-account-toggle'),homeAccountPanel=document.querySelector('#home-account-panel'),homeSignOut=document.querySelector('#home-sign-out'),homeAccountError=document.querySelector('#home-account-error');
let homeAccountOpen=false,homeAccountAnimation,homeAccountLoading;
function setHomeAccountOpen(open){
 homeAccountOpen=open;homeAccountAnimation?.cancel();homeAccountToggle.setAttribute('aria-expanded',String(open));
 homeAccountPanel.hidden=false;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){homeAccountPanel.hidden=!open;return}
 homeAccountAnimation=homeAccountPanel.animate(open?[{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}]:[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-4px)'}],{duration:open?180:130,easing:'ease-out'});
 homeAccountAnimation.onfinish=()=>{homeAccountPanel.hidden=!homeAccountOpen};
}
async function checkHomeAccount(){
 if(!homeAccountLoading)homeAccountLoading=loadAccountClerk().then(clerk=>{homeSignOut.hidden=!clerk.session;clerk.addListener?.(({session})=>{homeSignOut.hidden=!session});return clerk}).catch(()=>{homeAccountLoading=null;homeSignOut.hidden=false;return null});
 return homeAccountLoading;
}
homeAccountToggle?.addEventListener('click',()=>{setHomeAccountOpen(!homeAccountOpen);if(homeAccountOpen)void checkHomeAccount()});
document.addEventListener('pointerdown',event=>{if(homeAccountOpen&&!homeAccount.contains(event.target))setHomeAccountOpen(false)});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&homeAccountOpen){setHomeAccountOpen(false);homeAccountToggle.focus()}});
homeSignOut?.addEventListener('click',async()=>{
 homeSignOut.disabled=true;homeSignOut.textContent='Signing out…';homeAccountError.hidden=true;
 try{
  const response=await fetch('/api/account/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!response.ok&&response.status!==401)throw Error('Could not sign out. Try again.');
  const clerk=await loadAccountClerk();await clerk.signOut();location.assign('/');
 }catch{homeAccountError.textContent='Could not finish signing out. Try again.';homeAccountError.hidden=false;homeSignOut.disabled=false;homeSignOut.textContent='Sign out'}
});
