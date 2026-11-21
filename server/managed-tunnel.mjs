import {validShare} from './link-names.mjs';
import {randomBytes,createHash} from 'node:crypto';
export const DEFAULT_BROKER='https://sessionstream.app';
export const inviteRevision=room=>createHash('sha256').update(room).digest('hex');
export function sanitizeIceServers(value){
  if(!Array.isArray(value))return null;
  const out=[];
  for(const entry of value){
    const raw=Array.isArray(entry?.urls)?entry.urls:typeof entry?.urls==='string'?[entry.urls]:[];
    const urls=raw.filter(u=>typeof u==='string'&&u.length<=256&&/^(stun|turns?):[a-z0-9.-]+(?::\d{2,5})?(?:\?transport=(?:udp|tcp))?$/i.test(u));
    if(!urls.length)continue;
    const needsAuth=urls.some(u=>/^turns?:/i.test(u));
    if(needsAuth&&(typeof entry.username!=='string'||!entry.username||entry.username.length>512||typeof entry.credential!=='string'||!entry.credential||entry.credential.length>512))continue;
    out.push(needsAuth?{urls,username:entry.username,credential:entry.credential}:{urls});
  }
  return out.length?out:null;
}
export async function acquireManagedTunnel({port,room,broker=process.env.SESSIONSTREAM_TUNNEL_BROKER??DEFAULT_BROKER,request=fetch,custom=()=>null}){
  if(!broker||broker==='off')return null;
  const base=new URL(broker);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))throw Error('Tunnel broker must use HTTPS');
  if(base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw Error('Invalid tunnel broker');
  const secret=randomBytes(32).toString('hex');
  const call=async(path,method,body)=>{
    const selection=custom();if(body)body.custom=selection?.name||null;
    const response=await request(new URL(path,base),{method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(selection?{'X-SessionStream-Link-Credential':`Bearer ${selection.token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(method==='POST'?15000:5000)});
    if(!response.ok)throw Error('Managed tunnel request failed');
    return response.json();
  };
  const result=await call('/v1/leases','POST',{port,revision:inviteRevision(room)});
  const validURL=value=>{try{const url=new URL(value);return url.origin===base.origin&&validShare(url.pathname.slice(1))&&!url.search&&!url.hash;}catch{return false;}};
  if(!/^[a-f0-9-]{36}$/.test(result.id)||typeof result.token!=='string'||!result.token.length||result.token.length>8192||!validURL(result.url))throw Error('Invalid managed tunnel lease');
  const initialIce=sanitizeIceServers(result.iceServers);
  return {id:result.id,token:result.token,url:result.url,expires:result.expires,
    iceServers:initialIce,iceExpires:Number.isFinite(result.iceExpires)?result.iceExpires:0,
    async renew(room){
      const refreshTurn=!!(this.iceExpires&&Date.now()>=this.iceExpires-600000);
      const update=await call(`/v1/leases/${result.id}`,'PUT',{revision:inviteRevision(room),...(refreshTurn?{refreshTurn:true}:{})});
      if(!validURL(update.url))throw Error('Invalid managed tunnel URL');
      this.url=update.url;this.expires=update.expires;
      const refreshedIce=sanitizeIceServers(update.iceServers);
      if(refreshedIce){this.iceServers=refreshedIce;this.iceExpires=Number.isFinite(update.iceExpires)?update.iceExpires:0;}
      return this.url;
    },
    async release(){await call(`/v1/leases/${result.id}`,'DELETE');}
  };
}
