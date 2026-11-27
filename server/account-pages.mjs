import {readFileSync} from 'node:fs';
const accountCSS=readFileSync(new URL('../web/account.css',import.meta.url),'utf8');
export function pluginSignInURL(authorizationURL){
  const url=new URL(authorizationURL);
  // Test/custom Clerk issuers keep their own existing sign-in flow.
  if(url.origin!=='https://clerk.sessionstream.app')return authorizationURL;
  return 'https://sessionstream.app/sign-in/?plugin='+encodeURIComponent(url.href);
}
const pluginResults={
 ready:{title:'Ready to stream.',detail:'Your computer is connected. Return to SessionStream in your DAW to start streaming.'},
 session:{title:'Signed in for this session.',detail:'Your computer is connected, but your sign-in could not be saved. You may need to sign in again after restarting your DAW.'},
 pending:{title:'Finishing setup in SessionStream.',detail:'Your account was verified. Return to the plugin to check the connection and see what to do next.'},
 storage:{title:'macOS approval is needed.',detail:'Your account was verified. Return to SessionStream and choose Approve Mac access to connect this computer.'},
 limit:{title:'All three computer slots are in use.',detail:'Open your dashboard and disconnect a computer you no longer use. Then return to the plugin and retry the connection.'},
};
export function accountResultPage(ok,{expired=false,result}={}){
 const outcome=pluginResults[result];
 const title=outcome?.title??(ok?"You're signed in.":expired?"Confirmation expired.":"Sign-in incomplete.");
 const detail=outcome?.detail??(ok?'Return to your DAW to continue.':expired?'This page no longer has a sign-in confirmation. Check your account in the plug-in.':'Return to the plug-in and choose Sign in to start again.');
 const connected=ok&&(!result||result==='ready'||result==='session');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${title} | SessionStream</title><style>${accountCSS}</style></head><body><div class="auth-shell"><header><a class="brand" href="https://sessionstream.app/"><img src="https://sessionstream.app/websrc/assets/logo.svg" alt="" width="25" height="29">sessionstream</a><a class="back-link" href="https://sessionstream.app/">Back to the site ↗</a></header><main><section class="account-intro" aria-labelledby="account-title"><h1 id="account-title">Session<br>stream</h1><p>SessionStream for your DAW.</p></section><section class="auth-panel" aria-labelledby="result-title"><div class="result-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${connected?'<path d="m5 12 4 4L19 6"/>':'<path d="M12 4v10m0 5h.01"/>'}</svg></div><h2 id="result-title">${title}</h2><p>${detail}</p><a class="button" href="https://sessionstream.app/${ok?'dashboard/':''}">${result==='limit'?'Manage computers':ok?'Open dashboard':'Back to SessionStream'} <span aria-hidden="true">↗</span></a><div class="return-note">${ok?'You can close this tab.':expired?'This page does not change your sign-in.':'Start a new attempt from your DAW.'}</div></section></main><footer><span>© ${new Date().getFullYear()} SessionStream</span><nav aria-label="Legal and support"><a href="https://sessionstream.app/terms/">Terms</a><a href="https://sessionstream.app/privacy/">Privacy</a><a href="mailto:support@sessionstream.app">Support</a></nav></footer></div></body></html>`;
}
