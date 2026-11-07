let ready;
export async function loadAccountClerk(options={}){
 if(!ready)ready=(async()=>{if(!window.Clerk){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://clerk.sessionstream.app/npm/@clerk/clerk-js@5/dist/clerk.browser.js';script.crossOrigin='anonymous';script.setAttribute('data-clerk-publishable-key','pk_live_'+btoa('clerk.sessionstream.app$'));script.onload=resolve;script.onerror=()=>reject(Error('Sign-in could not be verified.'));document.head.append(script)})}await window.Clerk.load(options);return window.Clerk})();
 return ready;
}
export async function freshSessionToken(){
 const clerk=await loadAccountClerk();if(!clerk.session)throw Object.assign(Error('Please sign in again.'),{status:401});const token=await clerk.session.getToken({skipCache:true});if(!token)throw Object.assign(Error('Please sign in again.'),{status:401});return token;
}
