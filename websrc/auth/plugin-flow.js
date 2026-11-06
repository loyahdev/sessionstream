// Public PKCE parameters only. Never accept an arbitrary post-login redirect.
export function pluginAuthorization(hash){
  if(!hash.startsWith('#plugin='))return null;
  let url;try{url=new URL(decodeURIComponent(hash.slice(8)));}catch{throw Error('Invalid plugin sign-in. Start again from SessionStream.');}
  const q=url.searchParams,redirect=q.get('redirect_uri');let callback;try{callback=new URL(redirect);}catch{}
  const allowed=['client_id','response_type','redirect_uri','scope','state','code_challenge','code_challenge_method'];
  if(url.origin!=='https://clerk.sessionstream.app'||url.pathname!=='/oauth/authorize'||url.username||url.password||url.hash||
    [...q.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>q.getAll(k).length!==1)||
    q.get('client_id')!=='pc8es4va5qJsFDVW'||q.get('response_type')!=='code'||q.get('scope')!=='profile offline_access'||
    q.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge')||'')||
    !/^[A-Za-z0-9_-]{43}$/.test(q.get('state')||'')||callback?.protocol!=='http:'||callback?.hostname!=='127.0.0.1'||
    !/^[0-9]+$/.test(callback?.port||'')||Number(callback.port)<1024||Number(callback.port)>65535||
    callback.pathname!=='/auth/callback'||callback.search||callback.hash||callback.username||callback.password)
    throw Error('Invalid plugin sign-in. Start again from SessionStream.');
  return url.href;
}
