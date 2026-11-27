import {PluginUpdater} from './plugin-updater.mjs';
import {expiredPage} from './expired-page.mjs';
import {StreamDelivery} from './stream-delivery.mjs';
import {ListenerAdmission} from './listener-admission.mjs';
import {pluginSignInURL, accountResultPage} from './account-pages.mjs';
import {AccountCompletion} from './account-completion.mjs';
import {DashboardClient} from './dashboard-client.mjs';
import http from 'node:http';
import {sharePrefix,validName,normalizeName} from './link-names.mjs';
import {LinkClient} from './link-client.mjs';
import {LinkAuthorization} from './link-auth.mjs';
import {NativeReceiver} from './native-receiver.mjs';
import {Account, accountConfig} from './account.mjs';
import {CredentialStore} from './credential-store.mjs';
import dgram from 'node:dgram';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {convertPCM} from '../web/pcm-format.mjs';
import { parsePacket } from './protocol.mjs';
import {EngineLifetime} from './engine-lifetime.mjs';
import {InviteAccess, JoinAttempts, validPasscode} from './invite-access.mjs';
import {ListenerHealth} from './listener-health.mjs';
import {audioFormat,freeAudioFormat,SessionPolicy,validSessionSettings} from './session-policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.svg':'image/svg+xml','.woff':'font/woff'};
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]+$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(data)); };
async function readJSON(req, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) return {status: 413, error: 'Too large'};
    chunks.push(chunk);
  }
  // Decode after collecting bounded bytes, so a multibyte passcode split
  // across request chunks retains exactly the characters the producer chose.
  try { return {value: JSON.parse(Buffer.concat(chunks).toString('utf8'))}; }
  catch { return {status: 400, error: 'Invalid JSON'}; }
}

export async function createStreamServer(options = {}) {
  const publicPort = options.publicPort ?? Number(process.env.PORT || 8787);
  const studioPort = options.studioPort ?? Number(process.env.STUDIO_PORT || 8788);
  const udpPort = options.udpPort ?? Number(process.env.UDP_PORT || 49300);
  let controlQueue=Promise.resolve();
  let accountError='',reconnectFlow=null;
  const updater=options.updater||new PluginUpdater({directory:path.join(options.runtimeDir||path.join(root,'.runtime'),'updates'),currentVersion:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,...options.updateOptions});
  let usageSequence=null,usageSource=null;
  // Test workers must never restore/rotate the user's real Keychain login.
  const testWorker=!!process.env.NODE_TEST_CONTEXT;
  const config=accountConfig();
  const account = options.account || new Account({...config,autoRestore:false,store:new CredentialStore(config.issuer,config.clientId)});
  const accountCompletion=new AccountCompletion();
  const accountEpoch=()=>account.status().phase==='signed-in'?(account.generation??0):null;
  const linkAuth=new LinkAuthorization(account,options.linkStore||new CredentialStore(config.issuer,`${config.clientId}|custom-links`),options.linkOptions);
  const links=new LinkClient(account,linkAuth,{preferences:path.join(options.runtimeDir||path.join(root,'.runtime'),'link-preferences.json'),...options.linkOptions});
  const receivers=new Map(),receiverCredentials=new Map();
  let managedIce=null;
  const token = randomBytes(32).toString('hex');
  const instance = randomBytes(16).toString('hex');
  let tunnel={phase:'starting',url:''},inviteRequest=null,inviteCustomName='';
  let room = randomBytes(24).toString('hex'), publisher = null, live = false, title = 'Studio session';
  let native = null, delivery=null, deliveryMode='direct', extraEncryption=false, cloudStarting=false, owner = null, inviteSource = null, lease = 0;
  const lifetime = new EngineLifetime(options.lifetimeOptions);
  const log=options.log||(()=>{});
  const inviteAccess = new InviteAccess();
  const sessionPolicy=new SessionPolicy(options.now||Date.now);
  const joinAttempts = new JoinAttempts({limit:30});
  const listenerHealth = new ListenerHealth();
  let idleNotified = false;
  let source = null, lastAudio = 0, audio = null, packets = 0, drops = 0;
  const peers = new Map();
  const admission=new ListenerAdmission();
  let accessOwner=null,hostNameAccount=null;
  const hostName=()=>hostNameAccount&&hostNameAccount===account.identity?.sub&&account.status().phase==='signed-in'?String(account.status().name||'').trim().slice(0,80):'';
  const waiting=new Map();
  const wss = new WebSocketServer({noServer:true, maxPayload:65536});
  const udp = dgram.createSocket('udp4');
  const ice = () => {
    if (Array.isArray(managedIce) && managedIce.length) return managedIce;
    const servers = [{urls:'stun:stun.cloudflare.com:3478'}];
    // Ephemeral coturn REST credentials, generated only for authorized participants.
    if (process.env.TURN_URLS && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now()/1000)+3600}:sessionstream`;
      servers.push({urls:process.env.TURN_URLS.split(','), username,
        credential:createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64')});
    } else if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
      servers.push({urls:process.env.TURN_URLS.split(','), username:process.env.TURN_USERNAME, credential:process.env.TURN_PASSWORD});
    }
    return servers;
  };
  const notifyHost = m => native ? native.handle(m) : send(publisher,m);
  const info = () => ({...sessionPolicy.status(),delivery:deliveryMode,encrypted:extraEncryption,native:!!native, owner, inviteSource, engine:native?.buffer.stats(), engineError:native?.error, type:'status', feedbackEnabled:admission.feedback&&dashboard.plan==='pro', live, title, hostName:hostName(), listeners:peers.size, audio:Date.now()-lastAudio < 1500 ? audio : null,
    packets, drops, relayConfigured:ice().length > 1});
  const dashboard=new DashboardClient({account,enabled:options.dashboardReporting??(!options.account&&!testWorker),...options.dashboardOptions,onDenied:message=>{if(live)accountError=message;native?.stop();live=false;owner=null;sessionPolicy.stop();listenerHealth.clear();for(const p of peers.values())send(p,{type:'publisher-left'});},onLimits:limit=>{if(dashboard.plan!=='pro'&&(admission.approval||admission.requireAccount)&&live){accountError='Pro is required for the current listener controls.';native?.stop();live=false;stopReporting();}if(dashboard.plan!=='pro')for(const p of peers.values())if(p.dawReceive)p.close(4017,'The sender needs SessionStream Pro for DAW-to-DAW.');if(deliveryMode==='direct')for(const p of [...peers.values()].slice(limit))p.close(4009,'Session listener limit changed');}});
  const stopReporting=()=>{void dashboard.stopped();void delivery?.pause();};
  const listenerLimit=()=>deliveryMode==='cloud'?(dashboard.plan==='pro'?Infinity:3):dashboard.listenerLimit;
  async function beginStreaming(id){cloudStarting=true;try{await delivery?.start();source=id;lease=Date.now();lastAudio=0;live=true;native.start([...peers.entries()].filter(([,p])=>native.needsControl||p.mode==='webrtc').map(([id])=>id));}catch(error){accountError=error.message;live=false;owner=null;sessionPolicy.stop();stopReporting();throw Object.assign(error,{status:503});}finally{cloudStarting=false;}}
  const broadcastStatus = () => { send(publisher, info()); for (const p of peers.values()) send(p, info()); };
  const privateRequest = req => !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers.forwarded
      && /^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(req.headers.host || '');
  const headerAuth = req => safeEqual(req.headers.authorization?.replace(/^Bearer /, ''), token);
  function releaseSource(id,closeCode=4003,reason='Host disabled or removed') {
    receivers.get(id)?.close();receivers.delete(id);
    if (owner === id) { native?.stop();sessionPolicy.stop(); live = false; stopReporting(); owner = null; listenerHealth.clear(); }
    if (inviteSource === id) {
      void delivery?.end().catch(e=>log('cloud',e.message));
      inviteSource = null; inviteRequest = null; inviteCustomName=''; hostNameAccount=null; admission.reset();for(const p of waiting.values())p.close(4003,'Invite changed');waiting.clear(); room = randomBytes(24).toString('hex');
      inviteAccess.clear();sessionPolicy.end(); listenerHealth.clear();
      source = null; lastAudio = 0;
      for (const p of peers.values()) p.close(closeCode,reason);
    }
  }
  function expireInvite(){
    if(!sessionPolicy.expired)return;
    native?.stop();live=false;stopReporting();owner=null;sessionPolicy.stop();listenerHealth.clear();
    for(const p of peers.values())p.close(4011,'Invite expired');
    for(const p of waiting.values())p.close(4011,'Invite expired');
  }
  async function handler(req, res, studio) {
    expireInvite();
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' ws://127.0.0.1:*; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const currentInvite=!tunnel.url||!sharePrefix(new URL(tunnel.url).pathname)||tunnel.invite===room;
    const url = new URL(req.url, 'http://localhost');
    const prefix=sharePrefix(url.pathname);
    const listenerDocument=req.method==='GET'&&['/','/listen'].includes(url.pathname.slice(prefix.length)||'/');
    async function expiredDocument(){
      const page=expiredPage();
      res.writeHead(page.status,Object.fromEntries(page.headers));
      res.end(await page.text());
    }
    if(!studio&&listenerDocument&&(url.searchParams.get('expired')==='1'||sessionPolicy.expired))return expiredDocument();
    if(prefix){
      if(studio)return res.writeHead(404).end();
      const expected=tunnel.url?new URL(tunnel.url).pathname:'';
      if(prefix!==expected||tunnel.invite!==room)return listenerDocument?expiredDocument():res.writeHead(404).end();
      url.pathname=url.pathname.slice(prefix.length)||'/';
    }
    const reply = (status, data) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
    if (studio && !privateRequest(req)) return reply(403,{error:'Studio is only available locally.'});
    if (url.pathname === '/health') return reply(200,{ok:true,instance});
    if (url.pathname === '/api/studio') {
      if (!studio) return reply(404,{error:'Not found'});
      let publicURL = process.env.PUBLIC_URL || `http://127.0.0.1:${pub.address().port}`;
      if(options.managedTunnel)publicURL=(currentInvite&&tunnel.phase==='ready'?tunnel.url:'')||`http://127.0.0.1:${pub.address().port}`;
      else try { const stored = JSON.parse(await readFile(path.join(options.runtimeDir||path.join(root,'.runtime'),'public-url.json'),'utf8')); if (stored.url && !options.ignoreStoredURL) publicURL = stored.url; } catch {}
      const publicPath=new URL(publicURL).pathname;
      const tunnelReady=tunnel.phase==='ready'&&currentInvite;
      const wrongCustomLink=options.managedTunnel&&tunnelReady&&inviteCustomName&&publicPath!==`/${inviteCustomName}`;
      const tunnelError=wrongCustomLink?'Your saved link is unavailable. Cancel to retry or choose Random code in Settings.':'';
      return reply(200,{account:account.status(),accountConnection:dashboard.status(),updater:await updater.status(),listenerAccess:admission.snapshot(),accountError, links:links.status(), receivers:Object.fromEntries([...receivers].map(([id,receiver])=>[id,receiver.status()])), featureProtocol:1, token, room, listenerURL:wrongCustomLink?'':sharePrefix(publicPath)?publicURL:`${publicURL}/listen#${room}`,transportDiagnostics:native?.diagnostics(),controlProtocol:10,passcodeRequired:inviteAccess.required,listenerIssue:listenerHealth.issue(live),engineProtocol:native?1:0,enginePID:process.pid,tunnelPID:options.tunnelPID?.(),engineClients:lifetime.clients.size,publicSiteReady:options.managedTunnel?tunnelReady&&!wrongCustomLink:publicURL.startsWith('https://'),tunnelPhase:options.managedTunnel?tunnel.phase:undefined,tunnelError,inviteRequest,iceServers:ice(), ...info()});
    }
    if(url.pathname==='/api/update'&&req.method==='POST'){
      if(!studio||!native||!headerAuth(req)||req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,512);if(body.error)return reply(body.status,{error:body.error});const value=body.value;
      if(!value||!['download','install','cancel','dismiss'].includes(value.action)||Object.keys(value).some(k=>!['action','hostPID','reopen'].includes(k))||(value.reopen!==undefined&&(value.action!=='install'||typeof value.reopen!=='boolean')))return reply(400,{error:'Invalid update action.'});
      try{const result=value.action==='download'?await updater.prepare():value.action==='install'?await updater.install(value.hostPID,{reopen:value.reopen}):value.action==='cancel'?await updater.cancel():await updater.dismiss();return reply(200,{ok:true,...result});}catch(error){if(!['applying','waiting'].includes(updater.state?.phase))await updater.save({phase:'error',message:error.message}).catch(()=>{});return reply(400,{ok:false,error:error.message});}
    }
    if (url.pathname === '/api/links' && req.method === 'POST') {
      if(!studio||!headerAuth(req)||req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,1024);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if((m?.action==='claim'||m?.action==='mode'&&m?.value==='custom')){const access=await dashboard.requirePro();if(!access.ok)return reply(403,{error:access.error});}
      if(links.busy){links.error='Checking your saved link. Try again shortly.';return reply(200,{ok:false,error:links.error});}
      if(m?.action==='claim'&&!validName(normalizeName(m.value))){links.error='Use 3–32 letters, numbers or dashes; start with a letter. This name may be reserved.';return reply(200,{ok:false});}
      if(live&&['claim','release','mode'].includes(m?.action)){links.error='Stop streaming before changing the session link.';return reply(409,{ok:false,error:links.error});}
      void links.action(m?.action,m?.value);
      return reply(200,{ok:true});
    }
    if(url.pathname==='/api/listeners'&&req.method==='POST'){
      if(!studio||!headerAuth(req)||req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,1024);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!m||!Number.isInteger(m.source)||!(inviteSource===m.source||(m.action==='settings'&&inviteSource===null&&lifetime.clients.has(m.source))))return reply(403,{error:'Only the session host can manage listeners.'});
      if(!['settings','accept','reject','revoke'].includes(m.action))return reply(400,{error:'Invalid listener action.'});
      const disabling=m.action==='settings'&&m.approval===false&&m.requireAccount===false&&m.feedback!==true;
      if(!disabling){const access=await dashboard.requirePro();if(!access.ok)return reply(403,{error:access.error});}
      try{
        if(m.action==='settings'){
          admission.configure(m);accessOwner=m.source;
          for(const record of admission.records.values()){
            if(admission.requireAccount&&!record.verified&&!['rejected','revoked'].includes(record.status)){const p=peers.get(record.connection)||waiting.get(record.connection);if(p){send(p,{type:'sign-in-required'});p.close(4015,'Sign in to request access.');}record.status='account-required';}
            else if(!admission.approval&&record.status==='pending'&&peers.size<listenerLimit()){record.status='approved';const p=waiting.get(record.connection);if(p)admitListener(p);}
          }
        }else{
          const previous=admission.find(m.id);if(m.action==='accept'&&peers.size>=listenerLimit()&&previous?.connection)return reply(409,{error:'The session listener limit has been reached.'});
          const record=admission.decide(m.id,m.action),p=waiting.get(record.connection)||peers.get(record.connection);
          if(m.action==='accept'){if(p)admitListener(p);}
          else if(p){peers.delete(p.id);waiting.delete(p.id);native?.handle({type:'peer-left',id:p.id});listenerHealth.remove(p.id);send(p,{type:m.action==='revoke'?'access-revoked':'access-rejected'});p.close(4014,m.action==='revoke'?'The host revoked your access.':'The host declined your request.');}
        }
        broadcastStatus();return reply(200,{ok:true,...admission.snapshot()});
      }catch(error){return reply(400,{error:error.message});}
    }
    if (url.pathname === '/api/receive' && req.method === 'POST') {
      if(!studio||!headerAuth(req)||req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,2048);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!Number.isInteger(m?.source)||!lifetime.clients.has(m.source))return reply(400,{error:'Attach the plugin first.'});
      if(!['start','stop'].includes(m.action))return reply(400,{error:'Unknown receive action'});
      if(m.action==='start'&&(!Number.isInteger(m.port)||m.port<1024||m.port>65535||!validPasscode(m.passcode)))return reply(400,{error:'Invalid receiver'});
      if(m.action==='start'&&m.transport!==undefined&&!['pcm','webrtc'].includes(m.transport))return reply(400,{error:'Invalid receive transport'});
      receivers.get(m.source)?.close();receivers.delete(m.source);
      if(m.action==='start'){
        const credKey=`${account.identity?.sub||'local'}:${m.source}`;
        let listenerCredential=receiverCredentials.get(credKey);
        if(!listenerCredential){listenerCredential=randomBytes(32).toString('hex');receiverCredentials.set(credKey,listenerCredential);}
        try{
          receivers.set(m.source,new NativeReceiver({
            target:m.target,passcode:m.passcode,port:m.port,
            mode:m.transport==='webrtc'?'webrtc':'pcm',
            listenerCredential,
            name:()=>String(account.status().name||'').trim().slice(0,48)||'Studio DAW',
            ticketProvider:async roomId=>{const res=await dashboard.issueListenerTicket(roomId);return res.ok?res.ticket:null;}
          }));
        }catch(e){return reply(200,{ok:false,error:e.message});}
      }
      return reply(200,{ok:true});
    }
    if (url.pathname === '/api/account' && req.method === 'POST') {
      if (!studio || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      const body = await readJSON(req,512);
      if (body.error) return reply(body.status,{error:body.error});
      if (body.value?.action === 'open-sign-in'){
        const target=account.signInURL();
        return reply(200,target?{url:pluginSignInURL(target)}:{error:'Sign-in is already finishing. Check your account in SessionStream.'});
      }
      if (body.value?.action === 'cancel-sign-in'){
        const cancelled=account.cancelSignIn();
        if(cancelled){
          if(reconnectFlow)void account.restore();
          reconnectFlow=null;
        }
        return reply(200,{ok:cancelled,...(!cancelled?{error:'Sign-in is already finishing. Check your account in SessionStream.'}:{})});
      }
      if (body.value?.action === 'retry-device'){
        void dashboard.retryDeviceConnection()?.catch(()=>{});
        return reply(200,{ok:true});
      }
      if (body.value?.action === 'sign-out'){accountCompletion.clear();reconnectFlow=null;native?.stop();live=false;stopReporting();await delivery?.end();owner=null;sessionPolicy.stop();await dashboard.stopped();for(const receiver of receivers.values())receiver.close();receivers.clear();await linkAuth.clear().catch(()=>{});return reply(200,await account.signOut());}
      if (['sign-in','reconnect'].includes(body.value?.action)){
        const reconnect=body.value.action==='reconnect'||!!reconnectFlow;
        if(reconnect&&live)return reply(200,{ok:false,error:'Stop streaming before reconnecting.'});
        // Keep the denied device ID until a fresh OAuth callback proves the
        // account. A cancelled or invalid callback must never re-enroll it.
        const previous=reconnect?(reconnectFlow?.previous||{sub:dashboard.sub,status:dashboard.blockedStatus}):null;
        reconnectFlow=null;
        const result=account.begin(`http://127.0.0.1:${local.address().port}/auth/callback`,{reconnect});
        if(result.url){
          if(reconnect)reconnectFlow={state:new URL(result.url).searchParams.get('state'),previous};
          result.url=pluginSignInURL(result.url);
        }
        return reply(200,result);
      }
      return reply(400,{error:'Unknown account action'});
    }
    if(url.pathname.startsWith('/auth/complete/')){
      if(!studio||req.method!=='GET')return reply(404,{error:'Not found'});
      const ok=accountCompletion.get(url.pathname.slice('/auth/complete/'.length),accountEpoch());
      const connection=dashboard.status();
      const result=ok&&dashboard.enabled
        ?connection.deviceLimitReached?'limit'
          :connection.deviceAccessRequired?'storage'
          :connection.connected&&connection.planKnown?(account.status().remembered&&connection.deviceRemembered?'ready':'session'):'pending'
        :undefined;
      res.writeHead(ok?200:410,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src https://sessionstream.app; font-src https://sessionstream.app; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      return res.end(accountResultPage(ok,{expired:!ok,result}));
    }
    if (url.pathname === '/auth/callback') {
      if (!studio || req.method !== 'GET' || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length > 1) return reply(404,{error:'Not found'});
      const completed=accountCompletion.lookup(url.searchParams,accountEpoch());
      if(completed){res.writeHead(303,{Location:'/auth/complete/'+completed});return res.end();}
      const linkCallback=linkAuth.matches(url.searchParams);
      const reconnect=!linkCallback&&reconnectFlow?.state===url.searchParams.get('state')?reconnectFlow:null;
      const generation=account.generation;
      const ok=linkCallback?await links.callback(url.searchParams):await account.callback(url.searchParams);
      if(!linkCallback&&ok&&generation===account.generation){
        reconnectFlow=null;
        accountError='';
        await dashboard.reconnectAfterSignIn(reconnect?.previous);
      }
      if(ok&&generation===account.generation){
        const receipt=accountCompletion.remember(url.searchParams,accountEpoch());
        res.writeHead(303,{Location:'/auth/complete/'+receipt,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        return res.end();
      }
      res.writeHead(400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src https://sessionstream.app; font-src https://sessionstream.app; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      return res.end(accountResultPage(false));
    }
    if (url.pathname === '/api/invite' && req.method === 'POST') {
      const body=await readJSON(req,512);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!safeEqual(m?.room,room))return reply(403,{error:'Invalid invite'});
      if(sessionPolicy.expired)return reply(410,{error:'This invite has expired. Ask the host for a new link.'});
      const accessDecision=admission.decision(m.listenerCredential);
      return reply(200,{...(accessDecision?{accessDecision}:{}),format:sessionPolicy.status().format,delivery:deliveryMode,encrypted:extraEncryption,passcodeRequired:inviteAccess.required,approvalRequired:admission.approval,accountRequired:admission.requireAccount,...(hostName()?{hostName:hostName()}:{})});
    }
    if (url.pathname === '/api/engine' && req.method === 'POST') {
      if (!studio || !native || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,2048);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!Number.isInteger(m?.source)||m.source<0||m.source>0xffffffff||!['attach','detach'].includes(m.action))return reply(400,{error:'Invalid engine request'});
      if(m.action==='attach'){if(!lifetime.clients.has(m.source))log('engine','controller attached');lifetime.attach(m.source);}
      else {log('engine','controller detached');lifetime.detach(m.source);releaseSource(m.source);}
      return reply(200,{ok:true});
    }
    if (url.pathname === '/api/control' && req.method === 'POST') {
      if (!studio || !native || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,2048);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!Number.isInteger(m?.source)||m.source<0||m.source>0xffffffff)return reply(400,{error:'Invalid source'});
      if(!['generate','start','stop','lease','end','handoff'].includes(m.action))return reply(400,{error:'Unknown action'});
      if(dashboard.enabled&&['generate','start','handoff'].includes(m.action)&&account.status().phase!=='signed-in')return reply(401,{error:'Sign in to SessionStream before starting a session.'});
      if(m.requestId!==undefined&&(typeof m.requestId!=='string'||!/^[a-f0-9-]{32,36}$/.test(m.requestId)))return reply(400,{error:'Invalid request ID'});
      if(!validPasscode(m.passcode))return reply(400,{error:'Passcode must be at most 64 characters.'});
      if(m.delivery!==undefined&&!['direct','cloud'].includes(m.delivery)||m.encrypted!==undefined&&typeof m.encrypted!=='boolean')return reply(400,{error:'Invalid audio delivery settings.'});
      if(!validSessionSettings(m.quality,m.expiresInHours))return reply(400,{error:'Invalid session settings.'});
      const requestedQuality=m.quality||(['start','handoff'].includes(m.action)&&sessionPolicy.created?sessionPolicy.quality:'balanced');
      const requestedChannels=m.channels??(['start','handoff'].includes(m.action)&&sessionPolicy.created?sessionPolicy.channels:2);let requestedFormat;try{requestedFormat=audioFormat(requestedQuality,requestedChannels);}catch(e){return reply(400,{error:e.message});}
      if(['generate','start','handoff'].includes(m.action)&&m.inputChannels!==undefined&&(![1,2,6,8].includes(m.inputChannels)||requestedChannels>2&&requestedChannels!==m.inputChannels))return reply(409,{error:'The selected surround layout requires a matching DAW bus.'});
      if(['generate','start','handoff','end'].includes(m.action)){
        lifetime.trackRequest(m.source,res,()=>{if(owner===m.source)lease=Date.now();});
      }
      if(['generate','start','handoff'].includes(m.action)&&!freeAudioFormat(requestedQuality,requestedChannels)){if(account.status().phase!=='signed-in')return reply(403,{error:'SessionStream Pro is required for this audio format.'});const access=await dashboard.requirePro();if(!access.ok)return reply(403,{error:access.error});}
      if((m.action==='start'||m.action==='handoff')&&sessionPolicy.expired)return reply(410,{error:'This invite has expired. Create a new invite.'});
      if(m.action==='end'){
        if(inviteSource!==null&&inviteSource!==m.source)return reply(403,{error:'Only the session host can end this session.'});
        if(inviteSource===m.source){native.stop();sessionPolicy.end();releaseSource(m.source,4012,'Session ended by the host.');await links.action('mode','random');}
        broadcastStatus();return reply(200,{ok:true});
      }
      if(m.action==='handoff'){
        if(lifetime.clients.size>0&&!lifetime.clients.has(m.source))return reply(400,{error:'Attach the plugin first.'});
        if(inviteSource===null)return reply(409,{error:'No active session to switch.'});
        owner=m.source;inviteSource=m.source;accessOwner=m.source;source=m.source;lease=Date.now();lastAudio=0;
        native.buffer.reset();
        if(!live){
          if(admission.approval||admission.requireAccount||admission.feedback||links.mode==='custom'){const access=await dashboard.requirePro();if(!access.ok)return reply(403,{error:access.error});}
          const approval=await dashboard.authorizeStart();if(!approval.ok){accountError=approval.error;return reply(approval.status||409,{error:approval.error});}
          accountError='';sessionPolicy.start();await beginStreaming(m.source);
        }
        log('control','handoff');
        broadcastStatus();return reply(200,{ok:true});
      }
      if(m.action!=='lease')log('control',m.action);
      if(owner!==null&&owner!==m.source&&Date.now()-lease<5000)return reply(409,{error:'Another SessionStream instance owns this session.'});
      if(m.action==='stop'){if(owner===m.source){native.pause();sessionPolicy.stop();live=false;stopReporting();owner=null;listenerHealth.clear();}}
      else if(m.action==='lease'){if(owner===m.source)lease=Date.now();}
      else {
        const newOwner=inviteSource!==m.source;
        const repeated=m.action==='generate'&&m.requestId&&inviteSource===m.source&&inviteRequest===m.requestId;
        const creating=(m.action==='generate'&&!repeated)||newOwner;
        const hasPreferences=typeof m.listenerApproval==='boolean'&&typeof m.listenerAccounts==='boolean';
        if(creating&&(m.linkType==='custom'||hasPreferences&&(m.listenerApproval||m.listenerAccounts||m.listenerFeedback===true))){
          const access=await dashboard.requirePro();
          if(!access.ok)return reply(403,{error:access.error});
        }
        if(creating&&['random','custom'].includes(m.linkType)){
          const linkStatus=links.status();
          if(m.linkType==='custom'&&(!linkStatus.authenticated||!linkStatus.name||!linkStatus.authorized))
            return reply(409,{error:'Claim or authorize your custom link first.'});
          if(links.mode!==m.linkType)await links.action('mode',m.linkType);
        }
        if(links.mode==='custom'&&account.status().phase==='restoring')
          return reply(503,{error:'Restoring account settings.'});
        if(links.status().mode==='custom'&&!links.selection())
          return reply(409,{error:'Claim or authorize your custom link first.'});
        owner=m.source;lease=Date.now();
        if(creating){
          const customName=links.selection()?.name||'';
          const mode=m.delivery||'direct';if(mode==='cloud'){const access=await dashboard.requirePro();if(!access.ok)return reply(403,{error:access.error});const status=await dashboard.cloud('status');if(!status.ok||!status.canCloud||!status.configured)return reply(status.status||402,{error:status.error||'Add Cloud listener-hours before using Cloud.'});}
          await delivery?.configure({mode,encrypted:m.encrypted===true,quality:requestedQuality,channels:requestedChannels});deliveryMode=mode;admission.uncapped=mode==='cloud';extraEncryption=m.encrypted===true;native.needsControl=mode==='cloud'||extraEncryption;native.cloudMode=mode==='cloud';dashboard.mode=mode;
          inviteCustomName=customName;
          if(hasPreferences||accessOwner!==m.source){
            admission.configure({approval:m.listenerApproval===true,requireAccount:m.listenerAccounts===true,feedback:m.listenerFeedback===true});
            accessOwner=m.source;
          }
          hostNameAccount=m.showHostName===true&&account.status().phase==='signed-in'?account.identity?.sub:null;inviteSource=m.source;inviteRequest=m.requestId||null;native.stop();live=false;stopReporting();listenerHealth.clear();for(const p of peers.values())p.close(4003,'Invite changed');admission.reset();for(const p of waiting.values())p.close(4003,'Invite changed');waiting.clear();room=randomBytes(24).toString('hex');inviteAccess.set(m.passcode);sessionPolicy.create(requestedQuality,m.expiresInHours,requestedChannels);native.setQuality(sessionPolicy.quality,requestedChannels);}
        if(m.action==='start'&&!live){if(admission.approval||admission.requireAccount||admission.feedback||links.mode==='custom'){const access=await dashboard.requirePro();if(!access.ok)return reply(403,{error:access.error});}const approval=await dashboard.authorizeStart();if(!approval.ok){accountError=approval.error;return reply(approval.status||409,{error:approval.error});}accountError='';sessionPolicy.start();await beginStreaming(m.source);}
      }
      if(m.action==='generate'||m.action==='start')options.onInviteRequested?.();
      broadcastStatus();return reply(200,{ok:true});
    }
    if (url.pathname === '/api/rotate' && req.method === 'POST') {
      if (!studio || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      for (const p of peers.values()) p.close(4003,'Invite changed');
      admission.reset();for(const p of waiting.values())p.close(4003,'Invite changed');waiting.clear(); room = randomBytes(24).toString('hex'); inviteRequest = null; inviteAccess.clear();sessionPolicy.create(); listenerHealth.clear(); options.onInviteRequested?.(); return reply(200,{ok:true});
    }
    const allowed = ['/theme-init.js','/brand-mark.svg','/fonts/DMSans.woff','/fonts/Manrope.woff','/app.mjs','/cloud-peer.mjs','/cloud-crypto.mjs','/listener-delivery.mjs','/vendor/cloud-decoder.mjs','/audio.mjs','/pcm-worklet.mjs','/pcm-format.mjs','/peak-limiter.mjs','/style.css','/favicon.svg'];
    const isPage = url.pathname === '/' || url.pathname === '/listen' || (studio && url.pathname === '/studio');
    if (req.method !== 'GET' || (!isPage && !allowed.includes(url.pathname))) return reply(404,{error:'Not found'});
    try {
      const file = isPage ? '/index.html' : url.pathname;
      let contents = await readFile(path.join(root,'web',file));
      if (isPage) {
        let html=contents.toString().replace('__MODE__',studio ? 'studio' : 'listener');
        if(prefix)html=html.replace('<html ',`<html data-room="${room}" data-share-prefix="${prefix}" `).replace(/(href|src)="\//g,`$1="${prefix}/`);
        contents=Buffer.from(html);
      }
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]}); res.end(contents);
    } catch { reply(500,{error:'Unable to load page'}); }
  }
  const failedRequest=(error,res)=>{log('http error',error);res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.status?error.message:'This request could not be completed.'}));};
  const pub = http.createServer((req,res)=>handler(req,res,false).catch(error=>failedRequest(error,res)));
  const local = http.createServer((req,res)=>{
    const run=()=>handler(req,res,true).catch(error=>failedRequest(error,res));
    if(req.method==='POST'||req.url.startsWith('/auth/callback'))controlQueue=controlQueue.then(run,run);else void run();
  });
  function upgrade(server, studio) {
    server.on('upgrade',(req,socket,head)=>{
      const origin = req.headers.origin;
      const prefix=sharePrefix(req.url);const signalPath=prefix?req.url.slice(prefix.length):req.url;
      const signalPrefix=req.url.slice(0,req.url.length-signalPath.length);
      if(signalPrefix&&(studio||!tunnel.url||signalPrefix!==new URL(tunnel.url).pathname||tunnel.invite!==room))return socket.destroy();
      if (signalPath !== '/signal' || !origin || (studio && !privateRequest(req))) return socket.destroy();
      let parsed; try { parsed = new URL(origin); } catch { return socket.destroy(); }
      // Exact origin prevents another website connecting to the local bridge.
      if (parsed.host !== req.headers.host || !['http:','https:'].includes(parsed.protocol)) return socket.destroy();
      wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,studio));
    });
  }
  upgrade(pub,false); upgrade(local,true);
  function admitListener(ws){
    if(ws.readyState!==WebSocket.OPEN||ws.requestRoom!==room)return;
    if(ws.dawReceive&&dashboard.plan!=='pro'){ws.close(4017,'The sender needs SessionStream Pro for DAW-to-DAW.');return;}
    if(peers.size>=listenerLimit()){ws.close(4009,'Session is full');return;}
    waiting.delete(ws.id);ws.role='listener';peers.set(ws.id,ws);clearTimeout(ws.joinTimer);
    send(ws,{type:'joined',id:ws.id,dawReceive:ws.dawReceive===true,iceServers:ice(),delivery:deliveryMode,encrypted:extraEncryption,format:sessionPolicy.status().format});if(native?.needsControl||ws.mode!=='pcm')notifyHost({type:'peer-joined',id:ws.id});send(ws,info());broadcastStatus();
  }
  wss.on('connection',(ws,studio)=>{
    ws.isAlive = true; ws.role = null; ws.id = randomBytes(8).toString('hex'); ws.mode = 'webrtc';
    ws.on('error',()=>{}); ws.on('pong',()=>ws.isAlive=true);
    const joinTimer = ws.joinTimer = setTimeout(()=>{ if (!ws.role) ws.close(4001,'Join required'); },60000);
    const attempts = new JoinAttempts();
    let recent = 0, windowStart = Date.now();
    ws.on('message',async(raw,binary)=>{
      if(ws.verifying)return;
      if (binary) return ws.close(4002,'Invalid message');
      if (Date.now()-windowStart > 1000) {recent=0;windowStart=Date.now();}
      if (++recent > 120) return ws.close(4008,'Too many messages');
      let m; try {m = JSON.parse(raw.toString());} catch {return ws.close(4002,'Invalid JSON');}
      if (!m || typeof m !== 'object') return ws.close(4002,'Invalid message');
      if (!ws.role) {
        if (m.type !== 'join') return ws.close(4001,'Join first');
        if (m.role === 'publisher' && studio && safeEqual(m.token,token)) {
          if (publisher || native) return ws.close(4009,'A broadcaster is already open');
          publisher = ws; ws.role = 'publisher';
          send(ws,{type:'joined',id:ws.id,iceServers:ice(),peers:[...peers.entries()].filter(([,peer])=>peer.mode === 'webrtc').map(([id])=>id)});
        } else if (m.role === 'listener' && safeEqual(m.room,room)) {
          expireInvite();if(sessionPolicy.expired)return ws.close(4011,'Invite expired');
          if (inviteAccess.required && !inviteAccess.accepts(m.passcode)) {
            if (!attempts.allow() || !joinAttempts.allow()) return ws.close(4008,'Too many passcode attempts. Try again shortly.');
            return send(ws,{type:'passcode-required',invalid:typeof m.passcode==='string'&&m.passcode.length>0});
          }
          if(m.dawReceive===true){
            ws.verifying=true;
            const access=dashboard.enabled?await dashboard.requirePro():{ok:false};
            ws.verifying=false;
            if(ws.readyState!==WebSocket.OPEN||m.room!==room)return;
            if(!access.ok)return ws.close(4017,'The sender needs SessionStream Pro for DAW-to-DAW.');
            ws.dawReceive=true;
          }
          ws.requestRoom=room;ws.mode=sessionPolicy.status().format.codec==='pcm'||m.mode==='pcm'?'pcm':'webrtc';
          let identity;
          if(admission.requireAccount||m.listenerTicket){
            if(typeof m.listenerTicket!=='string'){send(ws,{type:'sign-in-required'});return;}
            ws.verifying=true;const checked=await dashboard.verifyListener(m.listenerTicket,room);ws.verifying=false;
            if(ws.readyState!==WebSocket.OPEN||ws.requestRoom!==room)return;
            if(sessionPolicy.expired)return ws.close(4011,'Invite expired');
            if(!checked.ok||typeof checked.listener?.id!=='string'||!checked.listener.id||checked.listener.id.length>256){send(ws,{type:'sign-in-required',error:checked.error});return;}
            identity=checked.listener;
          }
          const result=admission.request({credential:m.listenerCredential,name:m.name,identity,connection:ws.id});
          if(result.status==='sign-in-required'){send(ws,{type:'sign-in-required'});return;}
          if(result.status==='name-required'){send(ws,{type:'name-required'});return;}
          if(result.status==='full'){send(ws,{type:'access-full'});return ws.close(4009,'This session cannot accept more requests.');}
          if(result.status==='revoked'||result.status==='rejected'){
            send(ws,{type:'access-'+result.status});
            return ws.close(4014,result.status==='revoked'?'The host revoked your access.':'The host declined your request.');
          }
          if(result.replacedConnection){const previous=peers.get(result.replacedConnection)||waiting.get(result.replacedConnection);peers.delete(result.replacedConnection);waiting.delete(result.replacedConnection);native?.handle({type:'peer-left',id:result.replacedConnection});previous?.close(4009,'This listener reconnected in another tab.');}
          if(result.status==='pending'){ws.role='waiting';waiting.set(ws.id,ws);clearTimeout(joinTimer);send(ws,{type:'approval-pending'});return;}
          admitListener(ws);return;
        } else return ws.close(4003,'Invalid invite');
        clearTimeout(joinTimer); send(ws,info()); broadcastStatus(); return;
      }
      if(ws.role==='waiting'){
        if(m.type==='cancel-request'){admission.cancel(ws.id);waiting.delete(ws.id);ws.close(1000,'Request cancelled');}
        else if(m.type==='ping')send(ws,{type:'pong',at:m.at});
        return;
      }
      if (m.type === 'ping') return send(ws,{type:'pong',at:m.at});
      if(m.type==='listener-connection'&&ws.role==='listener'){
        if(['retry-requested','fallback-after-retry'].includes(m.event))native?.record(ws.id,m.event);
        return;
      }
      if (m.type === 'listener-health' && ws.role === 'listener') {
        if (live) listenerHealth.report(ws.id,m.state);
        else listenerHealth.remove(ws.id);
        return;
      }
      if (m.type === 'listener-note' && ws.role === 'listener') {
        if(!live||!admission.feedback||dashboard.plan!=='pro')return send(ws,{type:'note-error',error:'Feedback is not enabled for this session.'});
        const offsetSeconds = sessionPolicy.sessionStartedAt ? Math.max(0, Math.floor((sessionPolicy.now() - sessionPolicy.sessionStartedAt) / 1000)) : 0;
        if(admission.addNote(ws.id,m.text,offsetSeconds))send(ws,{type:'note-ack',offsetSeconds,text:admission.notes.at(-1).text});
        else send(ws,{type:'note-error',error:'Wait a moment before sending another note.'});
        return;
      }
      if (m.type === 'publishing' && ws.role === 'publisher') {
        controlQueue=controlQueue.then(async()=>{
          if(publisher!==ws)return;
          if(m.live&&!live){const approval=await dashboard.authorizeStart();if(!approval.ok)return send(ws,{type:'error',error:approval.error});if(publisher!==ws){stopReporting();return;}}
          live=!!m.live;if(!live){stopReporting();listenerHealth.clear();}
          title=typeof m.title==='string'?m.title.trim().slice(0,80)||'Studio session':title;broadcastStatus();
        }).catch(()=>{});return;
      }
      if (m.type === 'mode' && ws.role === 'listener') {
        const nextMode = sessionPolicy.status().format.codec==='pcm'||m.mode==='pcm'?'pcm':'webrtc';
        if (nextMode === ws.mode) return;
        if(native?.needsControl&&nextMode==='pcm'){ws.mode=nextMode;notifyHost({type:'renegotiate',id:ws.id});return;}
        ws.mode = nextMode;
        notifyHost({type:'peer-mode',id:ws.id,mode:ws.mode}); return;
      }
      if (m.type === 'offer' || m.type === 'answer' || m.type === 'candidate' || m.type === 'renegotiate') {
        if(native && ws.role==='listener'){
          if(m.type!=='offer')native.handle({type:m.type,sdp:m.sdp,candidate:m.candidate,generation:m.generation,from:ws.id});
          return;
        }
        const target = ws.role === 'publisher' ? peers.get(m.to) : publisher;
        if (!target) return;
        if (m.type === 'offer' && ws.role !== 'publisher') return;
        if ((m.type === 'answer' || m.type === 'renegotiate') && ws.role !== 'listener') return;
        send(target,{type:m.type,from:ws.id,sdp:m.sdp,candidate:m.candidate,generation:m.generation});
      }
    });
    ws.on('close',()=>{
      clearTimeout(joinTimer);
      if (publisher === ws) { publisher=null; live=false;stopReporting(); listenerHealth.clear(); for (const p of peers.values()) send(p,{type:'publisher-left'}); }
      waiting.delete(ws.id);admission.disconnected(ws.id);listenerHealth.remove(ws.id);
      if (peers.delete(ws.id)){void delivery?.remove(ws.id).catch(e=>log('cloud',e.message));notifyHost({type:'peer-left',id:ws.id});}
      broadcastStatus();
    });
  });
  udp.on('message',(data)=>{
    const p = parsePacket(data); if (!p) return;
    if(native&&(!live||p.source!==owner))return;
    if(native&&p.channels!==sessionPolicy.channels){native.error='DAW channel layout changed. End the session and choose a matching layout.';return;}
    if (source !== null && source !== p.source && Date.now()-lastAudio < 2000) return;
    source = p.source; lastAudio = Date.now(); audio = p; ++packets;
    if (!live || (!publisher&&!native)) return;
    const connected=[...peers.values()].filter(ws=>ws.mode==='pcm'||native?.peers.get(ws.id)?.connectionState==='connected');
    const fresh=usageSource!==p.source||usageSequence===null||((p.sequence-usageSequence)>>>0)>0&&((p.sequence-usageSequence)>>>0)<0x80000000;
    if(fresh){dashboard.audio(p.frames/p.rate,connected.length,deliveryMode==='cloud'?connected.length*(delivery.format.codec==='pcm'?p.rate*delivery.format.channels*delivery.format.bitDepth/8:delivery.format.bitrate/8):connected.reduce((sum,ws)=>sum+(ws.mode==='pcm'?p.rate*p.channels*p.width:(native?.bitrate||510000)/8),0));usageSequence=p.sequence;usageSource=p.source;}
    native?.feed(data,p);
    if(deliveryMode==='cloud'){delivery.rawFrame(data);return;}
    const wire=delivery?.format?.codec==='pcm'?Buffer.from(convertPCM(data,delivery.format.bitDepth)):data;
    // Keep socket queues bounded. Slow clients reconnect at the live edge.
    for (const ws of [...(publisher?[publisher]:[]),...[...peers.values()].filter(p=>p.mode === 'pcm')]) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > 65536) { ++drops; ws.close(4010,'Audio connection too slow; reconnecting'); continue; }
      if(extraEncryption&&ws.role==='listener'){void delivery.buffered(ws.id,wire).catch(e=>log('audio',e.message));}else ws.send(wire,{binary:true});
    }
  });
  if(options.nativeSender){const {NativeSender}=await import('./native-sender.mjs');native=new NativeSender((id,m)=>send(peers.get(id),m),ice);delivery=new StreamDelivery({PeerConnection:native.PeerConnection,iceServers:ice,api:(action,body)=>dashboard.cloud(action,body),allowed:id=>peers.has(id),sendControl:(id,m)=>native.sendControl(id,m),sendBinary:(id,raw)=>{const ws=peers.get(id);if(ws?.readyState===WebSocket.OPEN&&ws.bufferedAmount<65536)ws.send(raw,{binary:true});},onError:e=>{accountError=e.message;native.pause();live=false;stopReporting();broadcastStatus();}});native.onControlOpen=id=>{void delivery.join(id).catch(e=>{accountError=e.message;});};native.onControl=(id,m)=>delivery.control(id,m);native.onAudio=samples=>{if(live&&deliveryMode==='cloud')delivery.frame(samples);};}
  await Promise.all([
    new Promise((resolve,reject)=>{pub.once('error',reject);pub.listen(publicPort,'127.0.0.1',resolve);}),
    new Promise((resolve,reject)=>{local.once('error',reject);local.listen(studioPort,'127.0.0.1',resolve);}),
    new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(udpPort,'127.0.0.1',resolve);})
  ]);
  if(!options.account&&!testWorker)account.ready=account.restore();
  const lifetimeTimer = options.managedLifetime ? setInterval(()=>{
    const state=lifetime.poll();for(const id of state.expired){log('engine','controller heartbeat expired');releaseSource(id);}
    if(state.idle&&!idleNotified){idleNotified=true;options.onNoClients?.();}
  },250) : null;
  const statusTimer = setInterval(()=>{for(const r of admission.expirePending())waiting.get(r.connection)?.close(4016,'Access request expired. Request access again.');expireInvite();if(native&&!cloudStarting&&owner!==null&&Date.now()-lease>5000&&!lifetime.isHandlingRequest(owner)){native.stop();sessionPolicy.stop();live=false;stopReporting();owner=null;listenerHealth.clear();for(const p of peers.values())send(p,{type:'publisher-left'});}broadcastStatus();},1000);
  const heartbeat = setInterval(()=>{ for (const ws of wss.clients) {if (!ws.isAlive) ws.terminate(); else {ws.isAlive=false;ws.ping();}} },15000);
  return {instance,get customLinkSelection(){return links.selection();},get inviteRevision(){return room;},publicPort:pub.address().port, studioPort:local.address().port, udpPort:udp.address().port,
    setManagedIceServers(servers){managedIce=Array.isArray(servers)&&servers.length?servers:null;},
    setTunnelState(phase,url='',invite=room){tunnel={phase,url,invite};},
    async close() {await updater.close();await delivery?.end();await dashboard.close();for(const receiver of receivers.values())receiver.close();account.close();native?.close();clearInterval(lifetimeTimer);clearInterval(statusTimer);clearInterval(heartbeat);for (const ws of wss.clients) ws.terminate();
      await Promise.all([new Promise(r=>wss.close(r)),new Promise(r=>pub.close(r)),new Promise(r=>local.close(r)),new Promise(r=>udp.close(r))]);}};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createStreamServer();
  console.log(`SessionStream ready. Broadcaster: http://127.0.0.1:${app.studioPort}/studio\nListener server: http://127.0.0.1:${app.publicPort}\nPlugin bridge: UDP 127.0.0.1:${app.udpPort}`);
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
}
