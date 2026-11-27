import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Public OAuth configuration only. Never bundle a Clerk secret in the plugin.
export function accountConfig() {
  let file = {};
  try { file = JSON.parse(readFileSync(new URL('./account-config.json', import.meta.url), 'utf8')); } catch {}
  return {issuer:process.env.SESSIONSTREAM_CLERK_ISSUER || file.issuer,
    clientId:process.env.SESSIONSTREAM_CLERK_CLIENT_ID || file.clientId};
}
export class Account {
  constructor({issuer, clientId, fetchImpl=fetch, now=Date.now, store, autoRestore=true} = {}) {
    try {
      const url = new URL(issuer);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
      if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 512) throw Error();
      this.issuer = url.origin; this.clientId = clientId;
    } catch {}
    this.fetch=fetchImpl;this.now=now;this.store=store;this.generation=0;
    this.ready=autoRestore?this.restore():Promise.resolve();
  }
  status() {
    if(this.pending && this.pending.expires<=this.now()){this.pending=null;this.message='Sign-in expired. Try again.';}
    if(this.identity && this.identity.expires<=this.now())this.identity=null;
    return {configured:!!this.issuer,phase:this.identity?'signed-in':this.restoring?'restoring':(this.pending||this.exchanging)?'signing-in':'signed-out',
      remembered: !!this.identity && this.remembered === true,
      name:this.identity?.name||'',imageUrl:this.identity?.imageUrl||null,message:this.message||''};
  }
  // Memory-only access grant; never serialize this into studio status or logs.
  accessCredential(){return this.status().phase==='signed-in'?this.accessToken:null;}
  begin(redirectUri,{reconnect=false}={}) {
    if(!this.issuer)return {error:'Sign-in is not configured yet.'};
    clearTimeout(this.refreshTimer);this.restoring=false;this.exchanging=false;
    if(reconnect){this.identity=null;this.accessToken=null;this.refreshToken=null;this.remembered=false;}
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    this.pending={state,verifier,redirectUri,expires:this.now()+300000,generation:++this.generation};this.message='';
    const url=new URL('/oauth/authorize',this.issuer);
    url.search=new URLSearchParams({client_id:this.clientId,response_type:'code',redirect_uri:redirectUri,
      scope:'profile offline_access',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    this.pending.url=url.href;
    return {url:url.href};
  }
  signInURL() {
    return this.status().phase==='signing-in'?this.pending?.url:null;
  }
  cancelSignIn() {
    if(!this.pending)return false;
    ++this.generation;this.pending=null;this.message='Sign-in cancelled.';
    return true;
  }
  async signOut() {
    ++this.generation;clearTimeout(this.refreshTimer);this.pending=null;this.exchanging=false;this.restoring=false;
    this.identity=null;this.accessToken=null;this.refreshToken=null;this.remembered=false;this.message='';
    try{await this.store?.clear({interactive:true});return {ok:true};}
    catch{this.message='Could not remove saved sign-in. Try signing out again.';return {ok:false};}
  }
  close(){++this.generation;clearTimeout(this.refreshTimer);}
  async restore() {
    if(!this.store||!this.issuer)return;
    const generation=this.generation;this.restoring=true;
    try{
      const refreshToken=await this.store.read();
      if(generation!==this.generation)return;
      if(!refreshToken)return;
      this.refreshToken=refreshToken;this.remembered=true;await this.renew(generation);
    }catch(error){if(generation===this.generation)this.message=error.code==='SECURE_STORAGE_AUTH_REQUIRED'?'Saved sign-in needs Keychain approval. Use Sign in to reconnect.':'Saved sign-in is unavailable. You can sign in again.';}
    finally{if(generation===this.generation)this.restoring=false;}
  }
  schedule(generation,delay) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer=setTimeout(()=>{void this.renew(generation);},delay);this.refreshTimer.unref();
  }
  renew(generation=this.generation) {
    if(this.renewing)return this.renewing;
    this.renewing=this.renewOnce(generation).finally(()=>{this.renewing=null;});return this.renewing;
  }
  async renewOnce(generation=this.generation) {
    if(!this.refreshToken||generation!==this.generation)return;
    try{
      const token=await this.json('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'refresh_token',client_id:this.clientId,refresh_token:this.refreshToken})});
      await this.accept(token,generation);
    }catch(error){
      if(generation!==this.generation)return;
      if(error.oauth==='invalid_grant'||error.oauth==='invalid_token'){
        this.identity=null;this.accessToken=null;this.refreshToken=null;this.message='Sign in again to continue.';
        try{await this.store?.clear();}catch{}
      }else{this.message='Account connection unavailable. Retrying automatically.';this.schedule(generation,30000);}
    }
  }
  async accept(token,generation,{interactive=false}={}) {
    if(typeof token.access_token!=='string'||token.access_token.length>16384||token.token_type?.toLowerCase()!=='bearer')throw Error();
    if(generation!==this.generation)return false;
    // Persist rotated refresh tokens before user-info: a temporary profile
    // outage must not leave the old, already consumed token on this device.
    if(typeof token.refresh_token==='string'&&token.refresh_token.length>0&&token.refresh_token!==this.refreshToken){
      this.refreshToken=token.refresh_token;this.remembered=false;
    }
    if(this.refreshToken&&this.store&&!this.remembered){
      try{
        await this.store.write(this.refreshToken,{interactive});
        if(interactive&&(await this.store.read())!==this.refreshToken)throw Error('Saved login could not be restored silently');
        if(generation===this.generation)this.remembered=true;
      }catch{}
    }
    if(generation!==this.generation)return false;
    const user=await this.json('/oauth/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`}});
    if(typeof user.sub!=='string'||!user.sub)throw Error();
    if(generation!==this.generation)return false;
    const name=[user.name,[user.given_name,user.family_name].filter(v=>typeof v==='string').join(' '),user.preferred_username].find(v=>typeof v==='string'&&v.trim())||'there';
    const seconds=Math.min(Number(token.expires_in)||3600,86400);if(seconds<=0)throw Error();
    this.accessToken=token.access_token;
    let imageUrl=null;for(const value of [user.picture,user.image_url,user.profile_image_url]){try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['img.clerk.com','images.clerk.com','images.clerk.dev','clerk.sessionstream.app','avatars.githubusercontent.com','lh3.googleusercontent.com','lh4.googleusercontent.com','lh5.googleusercontent.com','lh6.googleusercontent.com'].includes(u.hostname)){imageUrl=u.href;break}}catch{}}
    this.identity={sub:user.sub,imageUrl,name:name.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,64),expires:this.now()+seconds*1000};this.message='';
    if(this.refreshToken){
      if(!this.remembered)this.message='Signed in for this session. This device could not save your sign-in.';
      this.schedule(generation,Math.max(1000,seconds*1000-60000));
    }else this.message='Signed in for this session. Your account did not return a saved sign-in.';
    return true;
  }
  async callback(params) {
    const pending=this.pending,state=params.get('state');
    if(!pending||pending.expires<=this.now()||!state||Buffer.byteLength(state)!==Buffer.byteLength(pending.state)||
      !timingSafeEqual(Buffer.from(state),Buffer.from(pending.state)))return false;
    this.pending=null;
    if(params.has('error')){this.message=params.get('error')==='access_denied'?'Sign-in was cancelled.':'The sign-in provider could not finish. Try again.';return false;}
    const code=params.get('code');if(!code||code.length>4096){this.message='Sign-in failed. Try again.';return false;}
    if(params.has('iss')&&params.get('iss')!==this.issuer){this.message='Sign-in failed. Try again.';return false;}
    this.exchanging=true;
    try{
      const token=await this.json('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'authorization_code',client_id:this.clientId,code,redirect_uri:pending.redirectUri,code_verifier:pending.verifier})});
      return await this.accept(token,pending.generation,{interactive:true});
    }catch{if(pending.generation===this.generation)this.message='Sign-in failed. Try again.';return false;}
    finally{if(pending.generation===this.generation)this.exchanging=false;}
  }
  async json(endpoint,options) {
    const response=await this.fetch(new URL(endpoint,this.issuer),{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
    const text=await response.text();if(text.length>65536)throw Error();
    const data=JSON.parse(text);
    if(!response.ok){const error=Error('Account request failed');error.oauth=data.error;throw error;}
    return data;
  }
}
