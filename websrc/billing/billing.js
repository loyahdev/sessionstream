import '/websrc/navigation.js';
import {loadAccountClerk,freshSessionToken} from '/websrc/account-session.js';
import {billingDestination} from '/websrc/billing-navigation.js';
import {verifyCheckoutIdentity} from '/websrc/billing/checkout-flow.js';
const inclusions=document.querySelector('.plan-inclusions'),compact=matchMedia('(max-width:760px)');inclusions.open=!compact.matches;compact.addEventListener('change',event=>{inclusions.open=!event.matches});
const profile=location.pathname.startsWith('/dashboard/account'),loading=document.querySelector('#billing-loading');
document.querySelector('#billing-retry').addEventListener('click',()=>location.reload());
if(profile){document.title='Account settings | SessionStream';document.querySelector('#checkout-layout').hidden=true;document.querySelector('#profile-heading').hidden=false;loading.hidden=false;}
const css=getComputedStyle(document.documentElement),color=name=>css.getPropertyValue(name).trim();
const appearance={variables:{colorPrimary:color('--accent'),colorTextOnPrimaryBackground:color('--accent-text'),colorText:color('--ink'),colorTextSecondary:color('--muted'),colorBackground:color('--surface'),colorInputBackground:color('--input'),colorInputText:color('--ink'),colorNeutral:color('--ink'),fontFamily:'"DM Sans", sans-serif',borderRadius:'0.8rem'},elements:{formButtonPrimary:{borderRadius:'999px',minHeight:'44px'},formFieldInput:{fontSize:'16px',minHeight:'44px'},rootBox:{width:'100%',minWidth:0,maxWidth:'100%'},cardBox:{boxShadow:'none',width:'100%',minWidth:0,maxWidth:'100%'},scrollBox:{minWidth:0,maxWidth:'100%'},pageScrollBox:{minWidth:0,maxWidth:'100%'},page:{minWidth:0,maxWidth:'100%'},profilePage:{minWidth:0,maxWidth:'100%'}}};
async function accountRequest(path='',method='GET'){const token=await freshSessionToken();const response=await fetch('/api/account'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-Clerk-Session-Token':token}});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Please try again.'),{status:response.status});return data;}
try{
 const verification=profile?fetch('/api/account/profile',{cache:'no-store',credentials:'same-origin'}).then(response=>({response}),error=>({error})):null;
 const clerk=await loadAccountClerk({appearance});
 let account;
 if(profile){const result=await verification;if(result.error)throw result.error;if(result.response.status===401)account=await accountRequest('/profile');else{account=await result.response.json();if(!result.response.ok)throw Object.assign(Error(account.error||'Please try again.'),{status:result.response.status});}}
 else account=await accountRequest();
 if(!clerk.user||clerk.user.id!==account.user.id)throw Object.assign(Error('Please sign in again.'),{status:401});
 if(profile){
  const subpage=location.pathname.replace(/^\/dashboard\/account\/?/,'');
  if(subpage&&!location.hash)history.replaceState(null,'','/dashboard/account/#/'+subpage);
  const mount=document.querySelector('#clerk-profile');mount.setAttribute('aria-busy','true');
  const observer=new MutationObserver(()=>{if(mount.childElementCount){loading.hidden=true;mount.setAttribute('aria-busy','false');observer.disconnect()}});observer.observe(mount,{childList:true});
  clerk.mountUserProfile(mount,{routing:'hash',appearance});
 }
 else{
  const email=verifyCheckoutIdentity(clerk.user,account);document.querySelector('#billing-identity').hidden=false;document.querySelector('#billing-email').textContent=email;
  const destination=await accountRequest('/checkout','POST'),url=billingDestination(destination.url,location.origin);
  if(new URL(url).pathname!=='/dashboard/billing/')location.replace(url);
  else{
   const {mountCheckout}=await import('/websrc/billing/checkout.js');
   const stripeAppearance={colorPrimary:color('--accent'),colorBackground:color('--input'),colorText:color('--ink'),colorTextSecondary:color('--muted'),colorSuccess:color('--accent'),colorDanger:color('--danger'),colorWarning:'#a77623',fontWeightNormal:'400',fontWeightMedium:'500',fontWeightBold:'600',fontSizeXl:'18px',fontSizeLg:'16px',fontSizeSm:'14px',fontSizeXs:'12px',borderRadius:'12px',spacingUnit:'4px'};
   const verify=async()=>{await clerk.user.reload();const latest=await accountRequest();verifyCheckoutIdentity(clerk.user,latest);const check=await accountRequest('/checkout','POST');if(new URL(billingDestination(check.url,location.origin)).pathname!=='/dashboard/billing/'){location.replace(billingDestination(check.url,location.origin));throw Error('Your account already has a subscription. Opening billing…');}if(check.planId!==destination.planId)throw Error('Your plan changed. Reload checkout before continuing.');};
   mountCheckout(document.querySelector('#checkout-mount'),{clerk,planId:destination.planId,appearance,stripeAppearance,verify});
  }
 }
}catch(error){loading.hidden=true;if(error.status===401)location.replace('/api/account/sign-in?intent=upgrade');else{document.querySelector('#checkout-mount').replaceChildren();const panel=document.querySelector('#billing-error');panel.hidden=false;panel.querySelector('p').textContent=error.message;if(!profile)document.querySelector('#checkout-mount').append(panel);}}
