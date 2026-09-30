import https from 'node:https';
import {Resolver} from 'node:dns/promises';
import {isIP} from 'node:net';
const freshDNS=new Resolver({timeout:1500,tries:1});
freshDNS.setServers(['1.1.1.1','8.8.8.8']);
// Networks blocking external UDP DNS can still check through HTTPS. Only this
// stable resolver hostname goes through local DNS before the tunnel is ready.
function lookupOverHTTPS(host){
  return new Promise((resolve,reject)=>{
    const req=https.get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,{family:4,headers:{Accept:'application/dns-json'}},res=>{
      let body='';res.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy(Error('DNS response too large'));});
      res.on('end',()=>{try{const data=JSON.parse(body),addresses=(data.Answer||[]).filter(a=>a.type===1&&isIP(a.data)===4).map(a=>a.data);if(res.statusCode!==200||data.Status!==0||!addresses.length)throw Error('DNS pending');resolve(addresses);}catch(e){reject(e);}});
    });
    const timeout=setTimeout(()=>req.destroy(Error('DNS HTTPS timeout')),4000);
    req.on('error',reject);req.on('close',()=>clearTimeout(timeout));
  });
}
export async function resolveFreshTunnel(host,{lookup=name=>freshDNS.resolve4(name),fallback=lookupOverHTTPS}={}){
  try{return await lookup(host);}catch{return fallback(host);}
}
// First check direct DNS availability without priming macOS's negative DNS
// cache while a brand-new hostname is still being provisioned.
export async function probeTunnel(url,instance){
  const host=new URL(url).hostname;
  let address,dnsTimeout;
  try{const result=await Promise.race([resolveFreshTunnel(host),new Promise((_,reject)=>dnsTimeout=setTimeout(()=>reject(Error('DNS pending')),8500))]);address=result[0];}catch{return false;}finally{clearTimeout(dnsTimeout);}
  return probeHealth(url,instance,{lookup(_host,_opts,cb){cb(null,address,4);}});
}
// A successful direct DNS probe alone does not prove a normal browser can open
// the hostname. Only consult the OS resolver after the tunnel answers twice.
export const probeBrowserTunnel=(url,instance)=>probeHealth(url,instance,{family:4});
function probeHealth(url,instance,options){
  return new Promise(resolve=>{
    let settled=false;const finish=ok=>{if(settled)return;settled=true;clearTimeout(timeout);resolve(ok);};
    const req=https.get(url+'/health',{...options,autoSelectFamily:false,headers:{'Cache-Control':'no-cache'}},res=>{
      let body='';res.on('data',chunk=>{body+=chunk;if(body.length>4096)req.destroy();});
      res.on('end',()=>{try{const data=JSON.parse(body);finish(res.statusCode===200&&data.ok===true&&data.instance===instance);}catch{finish(false);}});
    });
    const timeout=setTimeout(()=>{req.destroy();finish(false);},4000);req.on('error',()=>finish(false));
  });
}
// Keep an advertisement local to one tunnel generation. A slow health probe from
// an exited/replaced tunnel must never publish its old hostname.
export async function awaitTunnelReady({url,instance,current,probe=probeTunnel,browserProbe=probeBrowserTunnel,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=90}){
  let successes=0;const deadline=Date.now()+90000;
  for(let i=0;i<attempts&&Date.now()<deadline&&current();i++){
    const ok=await probe(url,instance);if(!current())return false;
    successes=ok?successes+1:0;
    if(successes>=2){const browserReady=await browserProbe(url,instance);if(!current())return false;if(browserReady)return true;}
    await sleep(500);
  }
  return false;
}
