export {AccountHub} from './accounts.mjs';
export {AccountState} from './account-state.mjs';
import {normalizeName,validName,sharePrefix} from '../../server/link-names.mjs';
// Account credentials live only in this Worker. Each installation gets its own
// tunnel token and a separate random capability for renewing/releasing its lease.
const TTL=300000;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function readBody(request){
  const reader=request.body?.getReader();if(!reader)throw Error('Missing body');
  const chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024){await reader.cancel();throw Error('Body too large');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
function code(){let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4294000000);return String(n%1000000).padStart(6,'0');}
export default {
  async scheduled(_event,env,ctx){
    const broker=env.BROKER.get(env.BROKER.idFromName('account'));
    ctx.waitUntil(broker.fetch(new Request(`${env.PUBLIC_ORIGIN}/maintenance`,{method:'POST'})));
  },
  async fetch(request,env){
    const url=new URL(request.url),broker=env.BROKER.get(env.BROKER.idFromName('account'));
    if(url.origin!==env.PUBLIC_ORIGIN)return json({error:'Unknown host'},404);
    if(url.pathname==='/api/account'||url.pathname.startsWith('/api/account/')){if(env.ACCOUNT_LIMITER&&!(await env.ACCOUNT_LIMITER.limit({key:request.headers.get('cf-connecting-ip')||'unknown'})).success)return json({error:'Too many account requests. Please wait a moment.'},429);return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(request);}
    if(url.pathname==='/dashboard'||url.pathname.startsWith('/dashboard/')){
      const check=new URL('/api/account/access',env.PUBLIC_ORIGIN);
      const access=await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(new Request(check,{headers:{Cookie:request.headers.get('cookie')||'',...((url.pathname==='/dashboard'||url.pathname==='/dashboard/'||url.pathname==='/dashboard/index.html'||url.pathname==='/dashboard/welcome/'||url.pathname==='/dashboard/welcome'||/^\/dashboard\/(billing|account)(?:\/|$)/.test(url.pathname))?{'x-dashboard-document':'1'}:{})}}));
      if(access.status===401)return new Response(null,{status:302,headers:{Location:'/api/account/sign-in','Cache-Control':'no-store'}});
      if(!access.ok)return new Response('Account verification is temporarily unavailable. Please try again.',{status:503,headers:{'Cache-Control':'no-store'}});
    }
    if(url.pathname==='/health')return json({ok:true,managedConfigured:!!env.CF_API_TOKEN});
    if(url.pathname==='/v1/links'||url.pathname.startsWith('/v1/link-auth/')){
      if(!(await env.LINK_LIMITER.limit({key:'claims:'+(request.headers.get('cf-connecting-ip')||'unknown')})).success)return json({error:'Too many requests'},429);
      return broker.fetch(request);
    }
    if(url.pathname.startsWith('/v1/leases')){
      if(!env.CF_API_TOKEN)return json({error:'Managed tunnels temporarily unavailable'},503);
      return broker.fetch(request);
    }
    const prefix=sharePrefix(url.pathname),match=prefix?[prefix,prefix.slice(1)]:null;
    if(!match||['/dashboard','/dashboard/'].includes(url.pathname)||url.pathname.startsWith('/dashboard/')){
      if(!env.ASSETS)return json({error:'Open the invite shared by your SessionStream host.'},404);
      const assetURL=['/dashboard/welcome','/dashboard/welcome/'].includes(url.pathname)?'/dashboard/':/^\/dashboard\/account(?:\/|$)/.test(url.pathname)?'/dashboard/account/':null;
      const asset=await env.ASSETS.fetch(assetURL?new Request(new URL(assetURL,url),request):request),response=new Response(asset.body,asset);
      if(url.pathname==='/dashboard'||url.pathname.startsWith('/dashboard/'))response.headers.set('Cache-Control','private, no-store');
      response.headers.set('X-Content-Type-Options','nosniff');
      response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
      const authPage=/^\/sign-(in|up)(?:\/|$)/.test(url.pathname),billingPage=/^\/dashboard\/(billing|account)(?:\/|$)/.test(url.pathname),clerkUI=authPage||billingPage;
      if(authPage)response.headers.set('Cache-Control','private, no-store');
      response.headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://clerk.sessionstream.app"+(clerkUI?" https://challenges.cloudflare.com":"")+(billingPage?" https://js.stripe.com":"")+"; connect-src 'self' https://clerk.sessionstream.app"+(billingPage?" https://api.stripe.com https://*.stripe.com":"")+"; frame-src https://accounts.sessionstream.app https://clerk.sessionstream.app"+(clerkUI?" https://challenges.cloudflare.com":"")+(billingPage?" https://js.stripe.com https://hooks.stripe.com https://*.stripe.com":"")+"; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"+(authPage?"; worker-src 'self' blob:":""));
      return response;
    }
    if(!(await env.LINK_LIMITER.limit({key:request.headers.get('cf-connecting-ip')||'unknown'})).success)return json({error:'Too many requests'},429);
    const resolved=await broker.fetch(new Request(`${env.PUBLIC_ORIGIN}/resolve/${match[1]}`));
    if(!resolved.ok)return json({error:'This session link has expired.'},404);
    const {hostname}=await resolved.json();
    // Keep the code prefix for the local listener to validate. The tunnel only
    // exposes the listener port; studio/control endpoints remain inaccessible.
    url.hostname=hostname;
    const headers=new Headers(request.headers);
    headers.delete('cookie');headers.delete('x-sessionstream-link-credential');headers.delete('authorization');headers.delete('host');
    // The Node listener enforces exact Origin/Host equality for WebSocket joins.
    // Reject a foreign browser origin before translating it for the tunnel host.
    const origin=headers.get('origin');
    if(origin&&origin!==env.PUBLIC_ORIGIN)return json({error:'Invalid origin'},403);
    if(origin)headers.set('origin',url.origin);
    try{
      const upstream=await fetch(new Request(url,request),{headers,redirect:'manual'});
      if(upstream.status===101)return upstream;
      const response=new Response(upstream.body,upstream);
      response.headers.set('Cache-Control','no-store');
      response.headers.delete('set-cookie');return response;
    }catch{return json({error:'The host is reconnecting. Please try again.'},502);}
  }
};
export class TunnelBroker {
  constructor(state,env){this.state=state;this.env=env;this.queue=Promise.resolve();}
  exclusive(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
  async linkAuth(request){
    if(request.headers.has('origin'))return json({},403);
    const auth=request.headers.get('authorization')||'';
    const endpoint=new URL(request.url).pathname;
    if(endpoint==='/v1/link-auth/exchange'&&request.method==='POST'){
      if(!/^Bearer [^\s]{1,16384}$/.test(auth))return json({error:'Sign in to use custom links.'},401);
      const issuer=this.env.CLERK_ISSUER||'https://clerk.sessionstream.app';
      try{
        const response=await (this.env.AUTH_FETCH||globalThis.fetch.bind(globalThis))(new URL('/oauth/userinfo',issuer),{headers:{Authorization:auth},redirect:'manual',signal:AbortSignal.timeout(10000)});
        if(!response.ok)return json({error:response.status===401?'Your account session could not be verified.':'Account verification is temporarily unavailable.'},response.status===401?401:503);
        const user=await response.json();if(typeof user.sub!=='string'||!user.sub||user.sub.length>256)return json({error:'Account verification failed.'},401);
        const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
        await this.state.storage.put(`link-session:${await digest(`Bearer ${token}`)}`,{user:user.sub,expires:Date.now()+30*86400000});
        await this.state.storage.setAlarm(Date.now()+60000);
        return json({token,user:user.sub});
      }catch(error){console.error('Account verification failure',error.name,error.message);return json({error:'Account verification is temporarily unavailable. Try again shortly.',diagnostic:{stage:'account-userinfo',kind:error.name}},503);}
    }
    if(!/^Bearer [a-f0-9]{64}$/.test(auth))return json({},401);
    const capability=await digest(auth),store=this.state.storage,url=new URL(request.url);
    if(url.pathname==='/v1/link-auth/session'&&request.method==='DELETE'){await store.delete(`link-session:${capability}`);return json({ok:true});}
    if(request.method!=='POST')return json({},405);const body=await readBody(request);
    if(url.pathname==='/v1/link-auth/start'){
      if(typeof body.redirectUri!=='string'||!/^http:\/\/127\.0\.0\.1:(\d{4,5})\/auth\/callback$/.test(body.redirectUri))return json({},400);
      const state=crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID(),challenge=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
      const encoded=btoa(String.fromCharCode(...challenge)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      await store.put(`link-auth:${state}`,{capability,verifier,redirectUri:body.redirectUri,expires:Date.now()+300000});await store.setAlarm(Date.now()+60000);
      const target=new URL('/oauth/authorize',this.env.CLERK_ISSUER||'https://clerk.sessionstream.app');
      target.search=new URLSearchParams({client_id:this.env.CLERK_CLIENT_ID||'pc8es4va5qJsFDVW',response_type:'code',redirect_uri:body.redirectUri,scope:'profile',state,code_challenge:encoded,code_challenge_method:'S256'});
      return json({state,url:target.href});
    }
    if(url.pathname!=='/v1/link-auth/finish'||typeof body.state!=='string'||typeof body.code!=='string'||body.code.length>4096)return json({},400);
    const pending=await store.get(`link-auth:${body.state}`);
    if(!pending||pending.capability!==capability||pending.expires<Date.now())return json({error:'Authorization expired. Try again.'},401);
    await store.delete(`link-auth:${body.state}`);
    const issuer=this.env.CLERK_ISSUER||'https://clerk.sessionstream.app',authFetch=this.env.AUTH_FETCH||globalThis.fetch.bind(globalThis);
    const response=await authFetch(`${issuer}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:this.env.CLERK_CLIENT_ID||'pc8es4va5qJsFDVW',code:body.code,redirect_uri:pending.redirectUri,code_verifier:pending.verifier}),redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return json({error:'Clerk authorization failed. Try again.'},401);
    const token=await response.json();if(typeof token.access_token!=='string')return json({},401);
    const profile=await authFetch(`${issuer}/oauth/userinfo`,{headers:{Authorization:`Bearer ${token.access_token}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!profile.ok)return json({},401);const user=await profile.json();if(typeof user.sub!=='string'||!user.sub||user.sub.length>256)return json({},401);
    const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
    // This credential grants only custom-link management/tunnel binding. Clerk
    // tokens are discarded here and never accepted from the desktop session.
    await store.put(`link-session:${await digest(`Bearer ${secret}`)}`,{user:user.sub,expires:Date.now()+30*86400000});
    return json({token:secret,user:user.sub});
  }
  async user(token){
    if(!/^Bearer [a-f0-9]{64}$/.test(token||''))return null;
    const session=await this.state.storage.get(`link-session:${await digest(token)}`);
    return session?.expires>Date.now()?session.user:null;
  }
  async links(request){
    if(request.headers.has('origin'))return json({error:'Use the SessionStream plugin to manage links.'},403);
    const user=await this.user(request.headers.get('authorization'));if(!user)return json({error:'Authorize custom links to continue.'},401);
    if(this.env.ACCOUNTS){const access=await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).fetch(new Request(`${this.env.PUBLIC_ORIGIN}/internal/account-plan`,{method:'POST',body:JSON.stringify({user})}));if((await access.json()).plan!=='pro')return json({error:'SessionStream Pro is required for reusable links.'},403);}
    const store=this.state.storage,old=await store.get(`owner:${user}`);
    if(request.method==='GET')return json({name:old||''});
    if(request.method==='DELETE'){
      await store.transaction(async tx=>{if(old)await tx.delete(`name:${old}`);await tx.delete(`owner:${user}`);});return json({name:''});
    }
    if(request.method!=='PUT')return json({},405);
    const body=await readBody(request),name=normalizeName(body.name);
    if(!validName(name))return json({error:'Use 3–32 letters, numbers or dashes; start with a letter. This name may be reserved.'},400);
    const claimed=await store.transaction(async tx=>{
      const taken=await tx.get(`name:${name}`);if(taken&&taken!==user)return false;
      const previous=await tx.get(`owner:${user}`);if(previous&&previous!==name)await tx.delete(`name:${previous}`);
      await tx.put(`name:${name}`,user);await tx.put(`owner:${user}`,name);return true;
    });
    if(!claimed)return json({error:'That link is already claimed. Your current link is unchanged.'},409);
    return json({name});
  }
  async bindCustom(lease,body,request){
    const store=this.state.storage;
    if(body.custom){
      const user=await this.user(request.headers.get('x-sessionstream-link-credential'));
      if(!user)return json({error:'Authorize custom links to continue.'},401);
      const name=await store.get(`owner:${user}`);if(!name)return json({error:'Claim a custom link first.'},409);
      const activeId=await store.get(`custom:${user}`),active=activeId&&await store.get(`lease:${activeId}`);
      if(active&&active.id!==lease.id&&active.active&&active.expires>Date.now())return json({error:'Your custom link is already in use by another session.'},409);
      lease.account=user;lease.customName=name;await store.put(`custom:${user}`,lease.id);
    }else if(lease.account){
      if(await store.get(`custom:${lease.account}`)===lease.id)await store.delete(`custom:${lease.account}`);
      delete lease.account;delete lease.customName;
    }
    return null;
  }
  publicURL(lease){return `${this.env.PUBLIC_ORIGIN}/${lease.customName||lease.code}`;}
  async api(path,method='GET',body){
    this.diagnostic={stage:path.includes('/dns_records')?'dns':path.endsWith('/token')?'connector-token':path.endsWith('/configurations')?'configuration':'tunnel',method};
    const response=await (this.env.CF_FETCH||fetch)(`https://api.cloudflare.com/client/v4${path}`,{
      method,headers:{Authorization:`Bearer ${this.env.CF_API_TOKEN}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)
    });
    this.diagnostic.status=response.status;
    if(response.status===404&&method==='DELETE')return null;
    if(!response.headers.get('content-type')?.includes('application/json')){console.error('Cloudflare non-JSON response',method,response.status);throw Error('Unexpected Cloudflare response');}
    const data=await response.json();this.diagnostic.codes=(data.errors||[]).map(e=>e.code);
    if(!response.ok||!data.success){console.error('Cloudflare operation failed',JSON.stringify({method,resource:path.split('?')[0].split('/').slice(-2).join('/'),status:response.status,codes:(data.errors||[]).map(e=>e.code)}));throw Error('Cloudflare operation failed');}
    return data.result;
  }
  get account(){return `/accounts/${this.env.CF_ACCOUNT_ID}/cfd_tunnel`;}
  get dns(){return `/zones/${this.env.CF_ZONE_ID}/dns_records`;}
  async newCode(){for(let i=0;i<30;i++){const value=code();if(!await this.state.storage.get(`code:${value}`))return value;}throw Error('Code allocation failed');}
  async save(lease){await this.state.storage.put(`lease:${lease.id}`,lease);}
  async remove(lease){
    // Recover operations whose response or subsequent storage write was lost.
    if(!lease.tunnelId){const found=await this.api(`${this.account}?name=${encodeURIComponent(lease.name)}&is_deleted=false`);lease.tunnelId=found.find(t=>t.name===lease.name)?.id;await this.save(lease);}
    if(!lease.dnsId){const found=await this.api(`${this.dns}?type=CNAME&name=${encodeURIComponent(lease.hostname)}`);lease.dnsId=found.find(d=>d.name===lease.hostname&&d.content===`${lease.tunnelId}.cfargotunnel.com`)?.id;await this.save(lease);}
    if(lease.dnsId){await this.api(`${this.dns}/${lease.dnsId}`,'DELETE');delete lease.dnsId;await this.save(lease);}
    if(lease.tunnelId){
      await this.api(`${this.account}/${lease.tunnelId}/connections`,'DELETE');
      await this.api(`${this.account}/${lease.tunnelId}`,'DELETE');
    }
    if(lease.account&&await this.state.storage.get(`custom:${lease.account}`)===lease.id)await this.state.storage.delete(`custom:${lease.account}`);
    await this.state.storage.delete([`lease:${lease.id}`,`code:${lease.code}`]);
  }
  async maintain(){
    const store=this.state.storage;
    for(const lease of (await store.list({prefix:'lease:'})).values()){
      if(lease.expires<=Date.now())try{await this.remove(lease);}catch{}
    }
    for(const [key,entry] of await store.list({prefix:'rate:'}))if(entry.reset<=Date.now())await store.delete(key);
    for(const prefix of ['link-auth:','link-session:'])for(const [key,entry] of await store.list({prefix}))if(entry.expires<=Date.now())await store.delete(key);
    let leases=[...(await store.list({prefix:'lease:'})).values()];
    const target=Math.min(Number(this.env.WARM_POOL_SIZE||0),Number(this.env.MAX_LEASES||900));
    let warm=leases.filter(l=>l.kind==='pool').length;
    while(warm<target&&leases.length<Number(this.env.MAX_LEASES||900)){
      const id=crypto.randomUUID(),lease={id,kind:'warming',name:`sessionstream-${id}`,hostname:`t-${id}.${this.env.TUNNEL_DOMAIN}`,expires:Date.now()+TTL,active:false};
      await this.save(lease);
      try{
        const tunnel=await this.api(this.account,'POST',{name:lease.name,config_src:'cloudflare'});
        lease.tunnelId=tunnel.id;await this.save(lease);
        const record=await this.api(this.dns,'POST',{type:'CNAME',name:lease.hostname,content:`${tunnel.id}.cfargotunnel.com`,proxied:true,ttl:1});
        lease.dnsId=record.id;lease.kind='pool';lease.readyAt=Date.now()+45000;lease.expires=Date.now()+86400000;
        await this.save(lease);warm++;
      }catch{lease.expires=0;await this.save(lease);try{await this.remove(lease);}catch{}break;}
      leases=[...(await store.list({prefix:'lease:'})).values()];
    }
    if(target||leases.length)await store.setAlarm(Date.now()+60000);
  }
  async alarm(){return this.exclusive(()=>this.maintain());}
  async fetch(request){
    // Read-only routing never waits behind Cloudflare provisioning/cleanup I/O.
    if(/^\/resolve\//.test(new URL(request.url).pathname))return this.handle(request);
    return this.exclusive(async()=>{
      try{return await this.handle(request);}catch(error){console.error('Broker request failed',error.name,error.message);return json({error:'Managed tunnels temporarily unavailable',diagnostic:{...this.diagnostic,kind:error.name}},503);}
    });
  }
  async handle(request){
    const url=new URL(request.url),store=this.state.storage;
    if(url.pathname.startsWith('/v1/link-auth/'))return this.linkAuth(request);
    if(url.pathname==='/v1/links')return this.links(request);
    if(url.pathname==='/maintenance'&&request.method==='POST'){await this.maintain();return json({ok:true});}
    const resolve=url.pathname.match(/^\/resolve\/([a-z0-9-]+)$/);
    if(resolve){
      const name=resolve[1];const lease=await store.transaction(async tx=>{
        let found;
        if(/^\d{6}$/.test(name)){const id=await tx.get(`code:${name}`);found=id&&await tx.get(`lease:${id}`);if(found?.customName||found?.code!==name)found=null;}
        else if(validName(name)){const owner=await tx.get(`name:${name}`),id=owner&&await tx.get(`custom:${owner}`);found=id&&await tx.get(`lease:${id}`);if(found?.account!==owner||found?.customName!==name)found=null;}
        return found;
      });
      return lease?.active&&lease.expires>Date.now()?json({hostname:lease.hostname}):json({},404);
    }
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer [a-f0-9]{64}$/.test(auth))return json({error:'Lease capability required'},401);
    const secretHash=await digest(auth);
    if(Number(request.headers.get('content-length')||0)>1024)return json({},413);
    const match=url.pathname.match(/^\/v1\/leases\/([a-f0-9-]{36})$/);
    if(match){
      const lease=await store.get(`lease:${match[1]}`);
      if(!lease||lease.secretHash!==secretHash||lease.expires<=Date.now())return json({},404);
      if(request.method==='DELETE'){lease.expires=0;lease.active=false;await this.save(lease);await this.remove(lease);return json({ok:true});}
      if(request.method!=='PUT')return json({},405);
      const body=await readBody(request);
      if(!/^[a-f0-9]{64}$/.test(body.revision))return json({},400);
      const denied=await this.bindCustom(lease,body,request);if(denied)return denied;
      if(body.revision!==lease.revision){
        const old=lease.code;lease.code=await this.newCode();lease.revision=body.revision;
        await store.transaction(async tx=>{await tx.delete(`code:${old}`);await tx.put(`code:${lease.code}`,lease.id);await tx.put(`lease:${lease.id}`,lease);});
      }
      lease.expires=Date.now()+TTL;await this.save(lease);
      return json({url:this.publicURL(lease),expires:lease.expires});
    }
    if(url.pathname!=='/v1/leases'||request.method!=='POST')return json({},404);
    // Native clients do not set Origin. Do not let third-party webpages allocate.
    if(request.headers.has('origin'))return json({},403);
    const body=await readBody(request);
    if(!Number.isInteger(body.port)||body.port<1024||body.port>65535||!/^[a-f0-9]{64}$/.test(body.revision))return json({},400);
    const leases=[...(await store.list({prefix:'lease:'})).values()];
    const pooled=leases.find(l=>l.kind==='pool'&&l.readyAt<=Date.now()&&l.expires>Date.now());
    if(Number(this.env.WARM_POOL_SIZE||0)&&!pooled){await store.setAlarm(Date.now()+100);return json({error:'Managed tunnels are warming up'},503);}
    if(!pooled&&leases.length>=Number(this.env.MAX_LEASES||900))return json({error:'Tunnel capacity reached'},503);
    const ip=request.headers.get('cf-connecting-ip');if(!ip)return json({},403);
    const key=`rate:${await digest(ip)}`,now=Date.now();
    let rate=await store.get(key);if(!rate||rate.reset<=now)rate={count:0,reset:now+3600000};
    if(rate.count>=Number(this.env.ALLOCATIONS_PER_HOUR||20))return json({error:'Try again later'},429);
    rate.count++;await store.put(key,rate);
    const id=pooled?.id||crypto.randomUUID(),lease={...(pooled||{}),id,kind:'leased',secretHash,code:await this.newCode(),revision:body.revision,expires:now+TTL,active:false,name:pooled?.name||`sessionstream-${id}`,hostname:pooled?.hostname||`t-${id}.${this.env.TUNNEL_DOMAIN}`};
    const denied=await this.bindCustom(lease,body,request);if(denied)return denied;
    await this.save(lease);await store.setAlarm(now+60000);
    try{
      const tunnel=pooled?{id:lease.tunnelId}:await this.api(this.account,'POST',{name:lease.name,config_src:'cloudflare'});
      lease.tunnelId=tunnel.id;await this.save(lease);
      await this.api(`${this.account}/${tunnel.id}/configurations`,'PUT',{config:{ingress:[{hostname:lease.hostname,service:`http://127.0.0.1:${body.port}`},{service:'http_status:404'}]}});
      if(!pooled){const record=await this.api(this.dns,'POST',{type:'CNAME',name:lease.hostname,content:`${tunnel.id}.cfargotunnel.com`,proxied:true,ttl:1});lease.dnsId=record.id;await this.save(lease);}
      const token=await this.api(`${this.account}/${tunnel.id}/token`);
      lease.active=true;await this.save(lease);await store.put(`code:${lease.code}`,id);
      return json({id,token,url:this.publicURL(lease),expires:lease.expires},201);
    }catch(error){
      console.error('Broker provisioning failed',error.name,error.message);
      lease.active=false;lease.expires=0;await this.save(lease);
      try{await this.remove(lease);}catch{}
      return json({error:'Managed tunnels temporarily unavailable',diagnostic:{...this.diagnostic,kind:error.name}},503);
    }
  }
}
