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
if(plugin){document.querySelector('#account-title').innerHTML='Your studio.<br><em>Connected.</em>';document.querySelector('.account-intro>p').textContent='Sign in to connect SessionStream in your DAW. Your account, saved links, and streaming activity stay together.';document.querySelector('#auth-state p').textContent='Preparing your plugin sign-in…';document.querySelector('#account-form').setAttribute('aria-label','Sign in to the plugin');}
document.title=(signup?'Create an account':'Sign in')+' | SessionStream';
document.querySelector('#signup-eligibility').hidden=!signup;
document.querySelector('#auth-fallback').href=complete;
document.querySelector('#auth-retry').addEventListener('click',()=>location.reload());
const wave=document.querySelector('.signal-bars');for(let i=0;i<28;i++){const bar=document.createElement('i');bar.style.setProperty('--height',`${12+Math.abs(Math.sin(i*.72)*Math.cos(i*.21))*45}px`);bar.style.setProperty('--delay',`${i*-.11}s`);wave.append(bar)}
function appearance(){
 const css=getComputedStyle(document.documentElement),color=name=>css.getPropertyValue(name).trim();
 return {
  variables:{colorPrimary:color('--accent'),colorTextOnPrimaryBackground:color('--accent-text'),colorText:color('--ink'),colorTextSecondary:color('--muted'),colorBackground:color('--surface'),colorInputBackground:color('--input'),colorInputText:color('--ink'),colorNeutral:color('--ink'),colorDanger:color('--danger'),fontFamily:'"DM Sans", sans-serif',fontFamilyButtons:'"DM Sans", sans-serif',borderRadius:'0.8rem',fontSize:'14px'},
  layout:{logoPlacement:'none',socialButtonsPlacement:'top',socialButtonsVariant:'blockButton'},
  elements:{
   rootBox:{width:'100%',minWidth:0,maxWidth:'100%'},
   cardBox:{width:'100%',maxWidth:'100%',minWidth:0,boxShadow:'none',border:'none',overflow:'visible',background:'transparent',borderRadius:0},
   card:{width:'100%',minWidth:0,maxWidth:'100%',boxShadow:'none',background:'transparent',padding:0,border:0,margin:0},
   headerTitle:{fontFamily:'Manrope, sans-serif',fontSize:'25px',fontWeight:500,letterSpacing:'-0.8px',lineHeight:1.3},
   headerSubtitle:{fontSize:'12px',lineHeight:1.8},
   formButtonPrimary:{borderRadius:'999px',minHeight:'46px',fontSize:'14px',fontWeight:600,textTransform:'none',boxShadow:'none'},
   socialButtonsBlockButton:{borderRadius:'999px',minHeight:'46px',background:color('--input'),borderColor:color('--line'),color:color('--ink'),boxShadow:'none'},
   formFieldInputGroup:{minWidth:0,width:'100%'},
   formFieldInput:{minHeight:'46px',fontSize:'16px',borderRadius:'12px',borderColor:color('--line'),boxShadow:'none'},
   formFieldLabel:{fontSize:'13px'},
   footer:{background:'transparent',padding:'20px 0 0',margin:0,border:0,gap:'18px'},
   footerAction:{padding:0,margin:0,flexWrap:'wrap',gap:'4px 6px',justifyContent:'center'},
   footerActionText:{fontSize:'13px',lineHeight:1.7},
   footerActionLink:{color:color('--accent'),fontWeight:600,fontSize:'13px',lineHeight:1.7},
   dividerLine:{background:color('--line')}
  }
 };
}
try{
 if(pluginError)throw pluginError;
 const clerk=await loadAccountClerk({...(plugin?{allowedRedirectOrigins:['https://clerk.sessionstream.app']}:{}),signInUrl,signUpUrl,signInForceRedirectUrl:complete,signUpForceRedirectUrl:complete});
 if(clerk.session){loading.querySelector('p').textContent='Opening your account…';location.replace(complete)}
 else{
  const observer=new MutationObserver(()=>{if(mount.childElementCount){loading.hidden=true;observer.disconnect()}});observer.observe(mount,{childList:true});
  const options={routing:'hash',signInUrl,signUpUrl,forceRedirectUrl:complete,signInForceRedirectUrl:complete,signUpForceRedirectUrl:complete,appearance:appearance()};
  if(signup)clerk.mountSignUp(mount,options);else clerk.mountSignIn(mount,options);
 }
}catch{loading.hidden=true;failure.hidden=false;if(pluginError){failure.querySelector('h2').textContent='Start sign-in from the plugin.';failure.querySelector('p').textContent='This sign-in link is incomplete or expired. Return to SessionStream and choose Sign in again.';document.querySelector('#auth-fallback').hidden=true;}}
