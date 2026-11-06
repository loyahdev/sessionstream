import {validShare} from './link-names.mjs';
import {randomBytes,createHash} from 'node:crypto';
export const DEFAULT_BROKER='https://sessionstream.app';
export const inviteRevision=room=>createHash('sha256').update(room).digest('hex');
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
  return {id:result.id,token:result.token,url:result.url,expires:result.expires,
    async renew(room){const update=await call(`/v1/leases/${result.id}`,'PUT',{revision:inviteRevision(room)});if(!validURL(update.url))throw Error('Invalid managed tunnel URL');this.url=update.url;this.expires=update.expires;return this.url;},
    async release(){await call(`/v1/leases/${result.id}`,'DELETE');}
  };
}
