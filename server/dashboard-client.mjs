import {randomBytes, randomUUID} from 'node:crypto';
import os from 'node:os';
import {CredentialStore} from './credential-store.mjs';

// One client per shared companion, never per processor. Secrets stay in private
// OS-store pipes and HTTPS requests; status is an explicit public allowlist.
export class DashboardClient {
  constructor({account, storeFactory, onDenied=()=>{}, onLimits=()=>{}, fetchImpl=fetch, now=Date.now, origin='https://sessionstream.app', version='1.0.4', enabled=true, autoTimer=true}) {
    this.enabled=enabled;this.account=account; this.storeFactory=storeFactory || (sub=>new CredentialStore(account.issuer,`${account.clientId}|installation-v1|${sub}`));
    this.onDenied=onDenied; this.onLimits=onLimits; this.fetch=fetchImpl; this.now=now; this.origin=origin; this.version=version;
    this.plan='free'; this.listenerLimit=3; this.live=false; this.queue=Promise.resolve(); this.reset();
    this.timer=autoTimer&&enabled?setInterval(()=>void this.tick(),1000):null; this.timer?.unref();
    if(autoTimer&&enabled)Promise.resolve(account?.ready).then(()=>{if(!this.closed)void this.tick();}).catch(()=>{});
  }
  reset() {this.run=randomBytes(16).toString('hex');this.sequence=0;this.totals=new Map();this.pending=null;this.next=0;this.backoff=1000;this.lastAck=0;this.planKnown=false;this.cloudAccess=null;this.broadcast=null;this.broadcastAck=0;this.blocked=false;this.blockedStatus=0;this.message='';this.record=null;this.enrollingId=null;this.unsaved=null;}
  status(){const cloudValid=!this.blocked&&this.sub===this.account.identity?.sub&&this.account.status().phase==='signed-in';return {broadcast:cloudValid?this.broadcast:null,cloud:cloudValid?this.cloudAccess:null,plan:this.plan,planKnown:this.planKnown&&!this.blocked&&this.sub===this.account.identity?.sub,listeners:this.listenerLimit,connected:!!this.record&&!this.blocked,message:this.message,reconnectRequired:!this.connectingAfterSignIn&&this.blocked&&this.sub===this.account.identity?.sub};}
  serial(fn){const task=this.queue.then(fn);this.queue=task.catch(()=>{});return task;}
  async syncAccount(){
    if(!this.enabled)return false;
    const sub=this.account.status().phase==='signed-in'?this.account.identity?.sub:null;
    if(sub!==this.sub){const active=this.live;this.sub=sub;this.reset();this.live=false;this.plan='free';this.listenerLimit=3;this.onLimits(3);if(active)this.onDenied('Account changed. Start streaming again.');}
    return !!sub;
  }
  async request(endpoint,body){
    let response;
    for(let attempt=0;attempt<2;attempt++){
      const token=this.account.accessCredential();if(!token)return {ok:false,status:401,error:'Sign in again to connect this installation.'};
      response=await this.fetch(`${this.origin}/api/account/plugin/v1/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body,redirect:'error',signal:AbortSignal.timeout(endpoint==='cloud'?40000:8000)});
      if(response.status!==401||attempt)break;
      await this.account.renew(); // Existing rotating-token path; never another OAuth flow.
    }
    const text=await response.text();if(text.length>65536)throw Error('Oversized account response');
    const data=JSON.parse(text);return {...data,ok:response.ok,status:response.status};
  }
  deny(message,status){this.blocked=true;this.blockedStatus=status;this.live=false;this.message=message;this.onDenied(message);}
  async enroll(){
    if(this.record)return {ok:true};
    this.store=this.storeFactory(this.sub);
    const interaction={interactive:this.authorizingCredentials===true};
    const saved=await this.store.read(interaction);
    let stored=saved?JSON.parse(saved):null;
    if(stored?.deviceCredential){if(!/^[a-f0-9-]{36}$/.test(stored.device)||!/^[a-f0-9]{64}$/.test(stored.deviceCredential))throw Error('Invalid saved installation');this.record=stored;return {ok:true};}
    // Persist an enrollment intent before the request. If its response is lost,
    // retry the same ID; 409 then requires an explicit dashboard cleanup.
    const id=stored?.device || (this.enrollingId ||= randomUUID());
    if(!stored)await this.store.write(JSON.stringify({device:id}),interaction);
    if(this.unsaved){await this.store.write(JSON.stringify(this.unsaved),interaction);this.record=this.unsaved;this.unsaved=null;return {ok:true};}
    const result=await this.request('enroll',JSON.stringify({device:id,name:os.hostname().slice(0,80),platform:process.platform==='darwin'?'macOS':process.platform==='win32'?'Windows':process.platform,version:this.version}));
    if(!result.ok)return result;
    if(!/^[a-f0-9]{64}$/.test(result.deviceCredential))throw Error('Invalid enrollment response');
    const record={device:id,deviceCredential:result.deviceCredential};
    this.unsaved=record;await this.store.write(JSON.stringify(record),interaction);this.unsaved=null;this.record=record;this.enrollingId=null;return {ok:true};
  }
  totalsForReport(){const date=new Date(this.now()).toISOString().slice(0,10),yesterday=new Date(this.now()-86400000).toISOString().slice(0,10);for(const key of this.totals.keys())if(key!==date&&key!==yesterday)this.totals.delete(key);if(!this.totals.has(date))this.totals.set(date,{date,seconds:0,listenerSeconds:0,bytes:0});return [...this.totals.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(t=>({...t}));}
  // Called from the UDP handler with packet duration, never from the audio
  // callback. Actual accepted frames exclude stopped/bypassed/silent hosts.
  audio(seconds,listeners,bytesPerSecond){
    if(!this.live||!this.sub||this.blocked||!Number.isFinite(seconds)||seconds<=0)return;
    seconds=Math.min(seconds,1);listeners=Math.max(0,Math.min(this.mode==='cloud'?Number.MAX_SAFE_INTEGER:this.listenerLimit,listeners));
    let end=this.now(),start=end-seconds*1000;
    while(start<end){const date=new Date(start).toISOString().slice(0,10),boundary=Date.parse(`${date}T00:00:00Z`)+86400000,until=Math.min(end,boundary),elapsed=(until-start)/1000;
      const t=this.totals.get(date)||{date,seconds:0,listenerSeconds:0,bytes:0};t.seconds+=elapsed;t.listenerSeconds+=elapsed*listeners;t.bytes+=elapsed*bytesPerSecond;this.totals.set(date,t);start=until;}
    if(this.plan==='free'&&this.broadcast&&Number.isFinite(this.broadcast.remainingSeconds)&&[...this.totals.values()].reduce((sum,t)=>sum+t.seconds,0)-this.broadcastAck>=this.broadcast.remainingSeconds){this.live=false;this.onDenied('Your 15 Free streaming hours are used for this month. Upgrade to Pro or wait for the monthly reset.');void this.serial(()=>this.flush(false));}
  }
  async flush(live=this.live){
    if(!await this.syncAccount())return {ok:true};
    if(this.blocked)return {ok:false,status:403,error:this.message};
    try{
      const enrollment=await this.enroll();if(!enrollment.ok)return this.failure(enrollment);
      if(!this.pending)this.pending=JSON.stringify({...this.record,run:this.run,sequence:++this.sequence,live,...(this.mode==='cloud'?{mode:'cloud'}:{}),version:this.version,totals:this.totalsForReport()});
      const sent=JSON.parse(this.pending),result=await this.request('report',this.pending);
      if(!result.ok)return this.failure(result);
      if(result.broadcast){this.broadcast=result.broadcast;this.broadcastAck=sent.totals.reduce((sum,t)=>sum+t.seconds,0);}
      if(result.cloud&&typeof result.cloud.canCloud==='boolean')this.cloudAccess=result.cloud;
      this.pending=null;this.backoff=1000;this.next=this.now()+15000;this.message='';
      if(!result.duplicate)this.lastAck=this.now();
      if(['free','pro'].includes(result.plan)){this.plan=result.plan;this.planKnown=true;}
      if(Number.isInteger(result.listeners)&&result.listeners>=1&&result.listeners<=100){this.listenerLimit=result.listeners;this.onLimits(result.listeners);}
      // A retry acknowledges old liveness only. Immediately send current state
      // (also renew on duplicate: replay does not renew the server lease).
      if(result.duplicate||sent.live!==live)return this.flush(live);
      return {ok:true};
    }catch(error){if(error.code==='SECURE_STORAGE_AUTH_REQUIRED'){const result={ok:false,status:423,error:'Saved installation needs Keychain approval. Use Sign in to reconnect.'};this.deny(result.error,result.status);return result;}return this.failure({ok:false,status:503,error:'Account connection unavailable. Retrying automatically.'});}
  }
  failure(result){if(result.broadcast?.remainingSeconds===0){this.broadcast=result.broadcast;this.live=false;this.pending=null;this.message=result.error;this.next=this.now()+15000;this.onDenied(result.error);return result;}if(this.mode==='cloud'&&result.status===403&&result.error==='Cloud listener-hours are required.'){this.live=false;this.mode='direct';this.pending=null;this.onDenied(result.error);this.next=this.now()+1000;return result;}this.message=result.error||'Account reporting failed.';
    if([400,403,409,426].includes(result.status))this.deny(this.message,result.status);
    this.next=this.now()+this.backoff;this.backoff=Math.min(15000,this.backoff*2);return result;
  }
  authorizeStart(){if(!this.enabled)return Promise.resolve({ok:true});return this.serial(async()=>{await this.syncAccount();if(!this.sub)return {ok:false,status:401,error:'Sign in to SessionStream before starting a session.'};if(!this.record){const initial=await this.flush(false);if(!initial.ok)return initial;}const result=await this.flush(true);if(result.ok)this.live=true;return result;});}
  async cloud(action,payload={}){
    return this.serial(async()=>{
      await this.syncAccount();if(!this.sub)return {ok:false,status:401,error:'Sign in to use your Cloud listener-hours.'};
      const verified=await this.flush();if(!verified.ok)return verified;
      if(!this.record||this.blocked)return {ok:false,status:403,error:'Reconnect this installation to use Cloud streaming.'};
      const {device,deviceCredential}=this.record;
      try{return await this.request('cloud',JSON.stringify({...payload,action,device,deviceCredential,run:this.run}));}
      catch{return {ok:false,status:503,error:'Cloud connection could not be confirmed. Reconnect before trying again.'};}
    });
  }
  async verifyListener(ticket,room){
    if(!this.enabled)return {ok:false,error:'Listener sign-in verification is unavailable.'};
    try{return await this.request('listener/verify',JSON.stringify({ticket,room}));}catch{return {ok:false,error:'Could not verify listener sign-in. Try again.'};}
  }
  async issueListenerTicket(room){
    if(!this.enabled)return {ok:false,error:'Account verification is unavailable.'};
    try{await this.syncAccount();if(!this.sub)return {ok:false,error:'Sign in to verify your account.'};return await this.request('listener/ticket',JSON.stringify({room}));}catch{return {ok:false,error:'Could not verify your account. Try again.'};}
  }
  requirePro(){if(this.enabled&&!this.blocked&&this.record&&this.sub===this.account.identity?.sub&&this.account.status().phase==='signed-in'&&this.now()-this.lastAck<25000)return Promise.resolve(this.plan==='pro'?{ok:true}:{ok:false,error:'SessionStream Pro is required for this feature.'});return this.serial(async()=>{if(!this.enabled)return {ok:true};await this.syncAccount();if(!this.sub)return {ok:false,error:'Sign in with a Pro account to use this feature.'};const result=await this.flush();if(!result.ok)return result;return this.plan==='pro'?{ok:true}:{ok:false,error:'SessionStream Pro is required for this feature.'};});}
  stopped(){const active=this.live;this.live=false;if(!active)return this.queue;return this.serial(()=>this.flush(false));}
  tick(){if(this.ticking||this.closed)return this.queue;
    if(this.live&&this.sub&&this.now()-this.lastAck>=30000){this.live=false;this.onDenied('Account connection lost. Start again when connected.');}
    this.ticking=true;return this.serial(async()=>{await this.syncAccount();if(this.sub&&!this.blocked&&this.now()>=this.next)await this.flush();}).finally(()=>{this.ticking=false;});
  }
  reconnectAfterSignIn(previous={}){
    this.connectingAfterSignIn=true;
    return this.serial(async()=>{
      this.authorizingCredentials=true;
      try{
      await this.syncAccount();
      if(!this.sub)return {ok:false,error:'Sign in first.'};
      const knownRevocation=previous.sub===this.sub&&previous.status===403||this.blockedStatus===403;
      if(!knownRevocation){
        this.blocked=false;
        this.blockedStatus=0;
        const result=await this.flush(false);
        if(result.status!==403)return result;
      }
      // Only a fresh browser callback can replace a denied installation.
      await this.storeFactory(this.sub).clear({interactive:true});
      this.reset();
      return this.flush(false);
      }finally{this.authorizingCredentials=false;}
    }).catch(()=>({ok:false,error:'Could not update the saved installation. Try reconnecting again.'}))
      .finally(()=>{this.connectingAfterSignIn=false;});
  }
  async close(){this.closed=true;clearInterval(this.timer);await this.stopped();}
}
