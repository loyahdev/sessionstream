import {randomBytes} from 'node:crypto';
export class LinkAuthorization {
  constructor(account,store,{broker='https://sessionstream.app',request=fetch}={}){this.account=account;this.store=store;this.broker=broker;this.request=request;this.generation=0;this.ready=this.restore();}
  async restore(){const generation=this.generation;try{const saved=await this.store.read();if(saved&&generation===this.generation){const data=JSON.parse(saved);this.token=data.token;this.user=data.user;this.expires=data.expires||0;}}catch{}}
  credential(){return this.account.status().phase==='signed-in'&&this.account.identity?.sub===this.user&&(!this.expires||this.expires>Date.now())?this.token:null;}
  async ensure(){
    await this.ready;await this.account.ready;
    if(this.credential())return this.credential();
    if(this.ensuring)return this.ensuring;
    const generation=this.generation,user=this.account.identity?.sub,access=this.account.accessCredential?.();
    if(!user||!access)throw Error('Your account session is unavailable. Use Sign in in the header.');
    const operation=(async()=>{
      // Exchange the existing short-lived login grant for a link-only capability.
      // The refresh token stays in the OS credential store and is never sent.
      const response=await this.request(new URL('/v1/link-auth/exchange',this.broker),{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Custom-link authorization is temporarily unavailable.');
      if(generation!==this.generation||this.account.status().phase!=='signed-in'||this.account.identity?.sub!==user)throw Error('Account changed. Try again.');
      if(data.user!==user||typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))throw Error('Custom-link authorization could not be verified.');
      this.token=data.token;this.user=user;this.expires=Date.now()+30*86400000-60000;
      try{await this.store.write(JSON.stringify({token:this.token,user:this.user,expires:this.expires}));}catch{/* A storage outage must not reject a valid session grant. */}
      if(generation!==this.generation)throw Error('Account changed. Try again.');
      return this.token;
    })();
    this.ensuring=operation;try{return await operation;}finally{if(this.ensuring===operation)this.ensuring=null;}
  }
  async begin(redirectUri){
    const generation=++this.generation,capability=randomBytes(32).toString('hex');
    const data=await this.call('/v1/link-auth/start',capability,{redirectUri});
    if(generation!==this.generation)return null;
    this.pending={state:data.state,capability,generation,expires:Date.now()+300000};return data.url;
  }
  matches(params){return this.pending&&params.get('state')===this.pending.state;}
  async callback(params){
    const pending=this.pending;this.pending=null;
    if(!pending||pending.expires<Date.now()||params.get('state')!==pending.state||params.has('error')||!params.get('code'))return false;
    const data=await this.call('/v1/link-auth/finish',pending.capability,{state:pending.state,code:params.get('code')});
    if(pending.generation!==this.generation||data.user!==this.account.identity?.sub)return false;
    if(typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))return false;
    this.token=data.token;this.user=data.user;this.expires=Date.now()+30*86400000-60000;await this.store.write(JSON.stringify({token:this.token,user:this.user,expires:this.expires}));return pending.generation===this.generation;
  }
  async clear(){const token=this.token;++this.generation;this.ensuring=null;this.pending=null;this.token=null;this.user=null;await this.store.clear();if(token)void this.request(new URL('/v1/link-auth/session',this.broker),{method:'DELETE',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{});}
  async call(path,capability,body){const response=await this.request(new URL(path,this.broker),{method:'POST',headers:{Authorization:`Bearer ${capability}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not authorize custom links.');return data;}
}
