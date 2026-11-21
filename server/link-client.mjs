import {normalizeName,validName} from './link-names.mjs';
export class LinkClient {
  constructor(account,auth,{broker='https://sessionstream.app',request=fetch,preferences}={}){
    this.account=account;this.auth=auth;this.broker=broker;this.request=request;this.preferences=preferences;
    this.mode='random';this.name='';this.error='';this.busy=false;this.generation=0;this.user=null;this.nextRestore=0;this.needsRefresh=false;
    // Link type is a session choice, not an account preference. Reserved names
    // and credentials still restore, but every fresh helper starts with a code.
    this.ready=Promise.resolve();
  }
  status(){this.sync();return {mode:this.account.status().phase==='signed-in'?this.mode:'random',name:this.name,error:this.error,busy:this.busy,authenticated:this.account.status().phase==='signed-in',authorized:!!this.auth.credential(),authorizationURL:this.authorizationURL||'',authorizationSource:this.authorizationSource};}
  selection(){this.sync();const token=this.auth.credential();return this.account.status().phase==='signed-in'&&this.mode==='custom'&&this.name&&token?{name:this.name,token}:null;}
  sync(){
    const user=this.account.status().phase==='signed-in'?this.account.identity?.sub:null;
    if(user!==this.user){this.user=user;this.mode='random';this.name='';this.error='';++this.generation;this.busy=false;this.nextRestore=0;this.needsRefresh=!!user;}
    if(user&&!this.busy&&(this.needsRefresh||!this.auth.credential())&&Date.now()>=this.nextRestore)void this.restore();
  }
  async restore(){
    const generation=this.generation;this.busy=true;this.nextRestore=Date.now()+30000;
    try{
      await this.ready;await this.ensure();const data=await this.call('GET');
      if(generation===this.generation){this.name=data.name||'';this.error='';this.needsRefresh=false;}
    }catch(e){if(generation===this.generation){this.error=e.message;this.needsRefresh=true;}}
    finally{if(generation===this.generation)this.busy=false;}
  }
  async ensure(){
    if(this.auth.ready)await this.auth.ready;
    if(!this.auth.credential()){
      if(!this.auth.ensure)throw Error('Sign in to use custom links.');
      await this.auth.ensure();
    }
    if(!this.auth.credential())throw Error('Your account session is unavailable. Try again.');
  }
  // Retain callback compatibility for a browser already opened by an older helper.
  async authorize(action,value,redirectUri,source){
    this.busy=true;this.error='';try{this.pendingAction={action,value};this.authorizationSource=source;this.authorizationURL=await this.auth.begin(redirectUri);}
    catch(e){this.error=e.message;}finally{this.busy=false;}
  }
  async callback(params){this.authorizationURL='';try{
    if(!await this.auth.callback(params)){this.error='Custom-link authorization was not completed.';return false;}
    const pending=this.pendingAction;this.pendingAction=null;
    if(pending)await this.action(pending.action,pending.value);else await this.action('refresh');return !this.error;
  }catch(e){this.error=e.message;return false;}}
  async call(method,body,retry=true){
    const token=this.auth.credential();if(!token)throw Error('Sign in to use custom links.');
    const response=await this.request(new URL('/v1/links',this.broker),{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
    let data;try{data=await response.json();}catch{throw Error('Custom links are temporarily unavailable. Try again shortly.');}
    if(response.status===401){
      await this.auth.clear().catch(()=>{});
      if(retry&&this.auth.ensure&&this.account.status().phase==='signed-in'){await this.ensure();return this.call(method,body,false);}
    }
    if(!response.ok)throw Error(data.error||'Custom links are temporarily unavailable.');return data;
  }
  async refresh(){return this.action('refresh');}
  async action(action,value){
    await this.ready;this.sync();const generation=++this.generation;this.busy=true;this.error='';
    try{
      if(action==='mode'){
        if(!['random','custom'].includes(value))throw Error('Invalid link mode.');
        if(value==='custom'&&this.account.status().phase!=='signed-in')throw Error('Sign in to use a custom link.');
        this.mode=value;
        if(value==='custom'&&!this.name){await this.ensure();const data=await this.call('GET');if(generation===this.generation)this.name=data.name||'';}
      }else{
        if(action==='claim'&&!validName(normalizeName(value)))throw Error('Use 3–32 letters, numbers or dashes; start with a letter.');
        if(!['claim','release','refresh'].includes(action))throw Error('Unknown link action.');
        await this.ensure();
        const data=await this.call(action==='claim'?'PUT':action==='release'?'DELETE':'GET',action==='claim'?{name:normalizeName(value)}:undefined);
        if(generation===this.generation){this.name=data.name||'';if(action==='claim')this.mode='custom';if(action==='release')this.mode='random';this.needsRefresh=false;}
      }
    }catch(e){if(generation===this.generation)this.error=e.message;}
    finally{if(generation===this.generation)this.busy=false;}
  }
}
