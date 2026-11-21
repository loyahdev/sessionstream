import '/websrc/navigation.js';
import {pluginAuthorization} from './plugin-flow.js';
import {loadAccountClerk} from '/websrc/account-session.js';
const signup=location.pathname.startsWith('/sign-up');
const intent=new URLSearchParams(location.search).get('intent')==='upgrade'?'upgrade':null;
const suffix=intent?'?intent=upgrade':'';
const pluginRequests=new URLSearchParams(location.search).getAll('plugin');
let plugin=null,pluginError=null;try{if(pluginRequests.length>1)throw Error('Duplicate plugin request');plugin=pluginAuthorization(pluginRequests.length?'#plugin='+encodeURIComponent(pluginRequests[0]):location.hash);}catch(error){pluginError=error;}
// Clerk uses the hash for its own UI router. Consume older fragment links
// before mounting so their public OAuth parameters cannot become router paths.
if(plugin&&location.hash.startsWith('#plugin='))history.replaceState(null,'',location.pathname+'?plugin='+encodeURIComponent(plugin));
const continuation=plugin?(suffix?'&':'?')+'plugin='+encodeURIComponent(plugin):'';
const signInUrl='/sign-in/'+suffix+continuation,signUpUrl='/sign-up/'+suffix+continuation;
// Fixed same-origin destination. Query parameters cannot supply a return URL.
const complete=plugin||('/api/account/sign-in?flow=authorize'+(intent?'&intent=upgrade':''));
const mount=document.querySelector('#clerk-auth'),loading=document.querySelector('#auth-state'),failure=document.querySelector('#auth-error');
if(plugin){document.querySelector('.account-intro>p').textContent='Connect your account to the SessionStream plug-in.';document.querySelector('#auth-state p').textContent='Preparing your plugin sign-in…';document.querySelector('#account-form').setAttribute('aria-label','Sign in to the plugin');}
document.title=(signup?'Create an account':'Sign in')+' | SessionStream';
document.querySelector('#signup-eligibility').hidden=!signup;
document.querySelector('#auth-fallback').href=complete;
document.querySelector('#auth-retry').addEventListener('click',()=>location.reload());
function appearance(){
 const css=getComputedStyle(document.documentElement),color=name=>css.getPropertyValue(name).trim();
 return {
  variables:{colorPrimary:color('--accent'),colorTextOnPrimaryBackground:color('--accent-text'),colorText:color('--ink'),colorTextSecondary:color('--muted'),colorBackground:color('--surface'),colorInputBackground:color('--input'),colorInputText:color('--ink'),colorNeutral:color('--ink'),colorDanger:color('--danger'),fontFamily:'"DM Sans", sans-serif',fontFamilyButtons:'"DM Sans", sans-serif',borderRadius:'0.25rem',fontSize:'14px'},
  layout:{logoPlacement:'none',socialButtonsPlacement:'top',socialButtonsVariant:'blockButton'},
  elements:{
   rootBox:{width:'100%',minWidth:0,maxWidth:'100%'},
   cardBox:{width:'100%',maxWidth:'100%',minWidth:0,boxShadow:'none',border:'none',overflow:'visible',background:'transparent',borderRadius:0},
   card:{width:'100%',minWidth:0,maxWidth:'100%',boxShadow:'none',background:'transparent',padding:0,border:0,margin:0},
   header:{alignItems:'flex-start',textAlign:'left'},
   headerTitle:{textAlign:'left',fontFamily:'Manrope, sans-serif',fontSize:'32px',fontWeight:750,letterSpacing:'-1.2px',lineHeight:1.3},
   headerSubtitle:{textAlign:'left',fontSize:'12px',lineHeight:1.8},
   formButtonPrimary:{borderRadius:'4px',minHeight:'46px',fontSize:'14px',fontWeight:600,textTransform:'none',boxShadow:'none'},
   socialButtonsBlockButton:{borderRadius:'4px',minHeight:'46px',background:color('--input'),borderColor:color('--line'),color:color('--ink'),boxShadow:'none'},
   formFieldInputGroup:{minWidth:0,width:'100%'},
   formFieldInput:{minHeight:'46px',fontSize:'16px',borderRadius:'4px',borderColor:color('--line'),boxShadow:'none'},
   formFieldLabel:{fontSize:'13px'},
   footer:{background:'transparent',padding:'20px 0 0',margin:0,border:0,gap:'18px'},
   footerAction:{padding:0,margin:0,flexWrap:'wrap',gap:'4px 6px',justifyContent:'center'},
   footerActionText:{fontSize:'13px',lineHeight:1.7},
   footerActionLink:{color:color('--accent'),fontWeight:600,fontSize:'13px',lineHeight:1.7},
   dividerLine:{background:color('--line')}
  }
 };
}
// Preserve Clerk's actual error while offering a useful recovery path.
// Only the error category is used; never copy entered identifiers or credentials.
window.addEventListener('securitypolicyviolation',event=>{
 let host='';try{host=new URL(event.blockedURI).hostname}catch{}
 if(host==='challenges.cloudflare.com'||host.endsWith('.protect.clerk.com')){
  document.querySelector('#signup-help').open=true;
  const diagnostic=document.querySelector('#signup-diagnostic');diagnostic.hidden=false;diagnostic.textContent='The browser blocked part of the security check. Please contact support if reloading doesn’t help.';
 }
});
const authErrorObserver=new MutationObserver(()=>{
 const alert=mount.querySelector('[role="alert"],.cl-formFieldErrorText,.cl-alertText');
 if(alert?.textContent.trim())document.querySelector('#signup-help').open=true;
});
authErrorObserver.observe(mount,{childList:true,subtree:true,characterData:true});
let loadingTimeout=setTimeout(()=>{
 if(!mount.childElementCount&&!clerkMounted){loading.hidden=true;failure.hidden=false;failure.querySelector('p').textContent='The account form is taking longer than expected. Reload, or contact support if it keeps happening.';}
},20000);
let clerkMounted=false;
try{
 if(pluginError)throw pluginError;
 const clerk=await loadAccountClerk({...(plugin?{allowedRedirectOrigins:['https://clerk.sessionstream.app']}:{}),signInUrl,signUpUrl,signInForceRedirectUrl:complete,signUpForceRedirectUrl:complete});
 if(clerk.session){loading.querySelector('p').textContent='Opening your account…';location.replace(complete)}
 else{
  const observer=new MutationObserver(()=>{if(mount.childElementCount){clerkMounted=true;clearTimeout(loadingTimeout);loading.hidden=true;failure.hidden=true;observer.disconnect()}});observer.observe(mount,{childList:true});
  const options={routing:'hash',signInUrl,signUpUrl,forceRedirectUrl:complete,signInForceRedirectUrl:complete,signUpForceRedirectUrl:complete,appearance:appearance()};
  if(signup)clerk.mountSignUp(mount,options);else clerk.mountSignIn(mount,options);
 }
}catch{clearTimeout(loadingTimeout);loading.hidden=true;failure.hidden=false;if(pluginError){failure.querySelector('h2').textContent='Start sign-in from the plugin.';failure.querySelector('p').textContent='This sign-in link is incomplete or expired. Return to SessionStream and choose Sign in again.';document.querySelector('#auth-fallback').hidden=true;}}
