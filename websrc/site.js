import {startNavigation,navigate} from '/websrc/navigation.js';
import {billingDestination} from '/websrc/billing-navigation.js';
import {freshSessionToken} from '/websrc/account-session.js';
let configuration;
async function getConfiguration(){
 if(!configuration)configuration=fetch('/api/account/config',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async response=>{
  if(!response.ok)throw Error('Downloads could not be loaded. Please try again.');
  return response.json();
 }).catch(error=>{configuration=undefined;throw Error(error.name==='TimeoutError'?'Loading downloads took too long. Please try again.':'Downloads could not be loaded. Please try again.');});
 return configuration;
}
async function accountAction(action,button){const finish=startNavigation('Opening checkout…',button);try{const token=await freshSessionToken();const response=await fetch(`/api/account/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Clerk-Session-Token':token}});const data=await response.json();if(response.status===401){navigate('/api/account/sign-in?intent=upgrade','Opening sign-in…');return}if(!response.ok)throw Error(data.error||'Please try again shortly.');location.assign(billingDestination(data.url,location.origin))}catch(error){if(error.status===401){navigate('/api/account/sign-in?intent=upgrade','Opening sign-in…');return}finish();document.querySelector('#placeholder-title').textContent='Please try again';document.querySelector('#placeholder-dialog p').textContent=error.message;document.querySelector('#placeholder-dialog').showModal()}}
document.querySelectorAll('[data-buy]').forEach(button=>button.addEventListener('click',()=>accountAction('checkout',button)));
document.querySelectorAll('[data-download]').forEach(button=>button.addEventListener('click',async()=>{const finish=startNavigation('Preparing download…',button);try{const config=await getConfiguration(),url=config.downloads?.[button.dataset.download];if(!url)throw Error('This download is temporarily unavailable. Please try again shortly.');finish();location.href=url}catch(error){finish();document.querySelector('#placeholder-title').textContent='Download unavailable';document.querySelector('#placeholder-dialog p').textContent=error.message;document.querySelector('#placeholder-dialog').showModal()}}));
