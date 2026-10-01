import http from 'node:http';
import dgram from 'node:dgram';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { parsePacket } from './protocol.mjs';
import {EngineLifetime} from './engine-lifetime.mjs';
import {InviteAccess, JoinAttempts, validPasscode} from './invite-access.mjs';
import {ListenerHealth} from './listener-health.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml'};
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
  const token = randomBytes(32).toString('hex');
  const instance = randomBytes(16).toString('hex');
  let tunnel={phase:'starting',url:''},inviteRequest=null;
  let room = randomBytes(24).toString('hex'), publisher = null, live = false, title = 'Studio session';
  let native = null, owner = null, inviteSource = null, lease = 0;
  const lifetime = new EngineLifetime(options.lifetimeOptions);
  const inviteAccess = new InviteAccess();
  const joinAttempts = new JoinAttempts({limit:30});
  const listenerHealth = new ListenerHealth();
  let idleNotified = false;
  let source = null, lastAudio = 0, audio = null, packets = 0, drops = 0;
  const peers = new Map();
  const wss = new WebSocketServer({noServer:true, maxPayload:65536});
  const udp = dgram.createSocket('udp4');
  const ice = () => {
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
  const info = () => ({native:!!native, owner, inviteSource, engine:native?.buffer.stats(), engineError:native?.error, type:'status', live, title, listeners:peers.size, audio:Date.now()-lastAudio < 1500 ? audio : null,
    packets, drops, relayConfigured:ice().length > 1});
  const broadcastStatus = () => { send(publisher, info()); for (const p of peers.values()) send(p, info()); };
  const privateRequest = req => !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers.forwarded
      && /^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(req.headers.host || '');
  const headerAuth = req => safeEqual(req.headers.authorization?.replace(/^Bearer /, ''), token);
  function releaseSource(id) {
    if (owner === id) { native?.stop(); live = false; owner = null; listenerHealth.clear(); }
    if (inviteSource === id) {
      inviteSource = null; inviteRequest = null; room = randomBytes(24).toString('hex');
      inviteAccess.clear(); listenerHealth.clear();
      source = null; lastAudio = 0;
      for (const p of peers.values()) p.close(4003, 'Host disabled or removed');
    }
  }
  async function handler(req, res, studio) {
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:*; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const url = new URL(req.url, 'http://localhost');
    const reply = (status, data) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
    if (studio && !privateRequest(req)) return reply(403,{error:'Studio is only available locally.'});
    if (url.pathname === '/health') return reply(200,{ok:true,instance});
    if (url.pathname === '/api/studio') {
      if (!studio) return reply(404,{error:'Not found'});
      let publicURL = process.env.PUBLIC_URL || `http://127.0.0.1:${pub.address().port}`;
      if(options.managedTunnel)publicURL=tunnel.url||`http://127.0.0.1:${pub.address().port}`;
      else try { const stored = JSON.parse(await readFile(path.join(options.runtimeDir||path.join(root,'.runtime'),'public-url.json'),'utf8')); if (stored.url && !options.ignoreStoredURL) publicURL = stored.url; } catch {}
      return reply(200,{token, room, listenerURL:`${publicURL}/listen#${room}`,controlProtocol:3,passcodeRequired:inviteAccess.required,listenerIssue:listenerHealth.issue(live),engineProtocol:native?1:0,enginePID:process.pid,tunnelPID:options.tunnelPID?.(),engineClients:lifetime.clients.size,publicSiteReady:options.managedTunnel?tunnel.phase==='ready':publicURL.startsWith('https://'),tunnelPhase:options.managedTunnel?tunnel.phase:undefined,inviteRequest,iceServers:ice(), ...info()});
    }
    if (url.pathname === '/api/invite' && req.method === 'POST') {
      const body=await readJSON(req,512);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!safeEqual(m?.room,room))return reply(403,{error:'Invalid invite'});
      return reply(200,{passcodeRequired:inviteAccess.required});
    }
    if (url.pathname === '/api/engine' && req.method === 'POST') {
      if (!studio || !native || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,2048);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!Number.isInteger(m?.source)||m.source<0||m.source>0xffffffff||!['attach','detach'].includes(m.action))return reply(400,{error:'Invalid engine request'});
      if(m.action==='attach')lifetime.attach(m.source);
      else {lifetime.detach(m.source);releaseSource(m.source);}
      return reply(200,{ok:true});
    }
    if (url.pathname === '/api/control' && req.method === 'POST') {
      if (!studio || !native || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      const body=await readJSON(req,2048);if(body.error)return reply(body.status,{error:body.error});const m=body.value;
      if(!Number.isInteger(m?.source)||m.source<0||m.source>0xffffffff)return reply(400,{error:'Invalid source'});
      if(!['generate','start','stop','lease'].includes(m.action))return reply(400,{error:'Unknown action'});
      if(m.requestId!==undefined&&(typeof m.requestId!=='string'||!/^[a-f0-9-]{32,36}$/.test(m.requestId)))return reply(400,{error:'Invalid request ID'});
      if(!validPasscode(m.passcode))return reply(400,{error:'Passcode must be at most 64 characters.'});
      if(owner!==null&&owner!==m.source&&Date.now()-lease<5000)return reply(409,{error:'Another SessionStream instance owns this session.'});
      if(m.action==='stop'){if(owner===m.source){native.stop();live=false;owner=null;listenerHealth.clear();for(const p of peers.values())send(p,{type:'publisher-left'});}}
      else if(m.action==='lease'){if(owner===m.source)lease=Date.now();}
      else {
        const newOwner=inviteSource!==m.source;owner=m.source;lease=Date.now();
        const repeated=m.action==='generate'&&m.requestId&&inviteSource===m.source&&inviteRequest===m.requestId;
        if((m.action==='generate'&&!repeated)||newOwner){inviteSource=m.source;inviteRequest=m.requestId||null;native.stop();live=false;listenerHealth.clear();for(const p of peers.values())p.close(4003,'Invite changed');room=randomBytes(24).toString('hex');inviteAccess.set(m.passcode);}
        if(m.action==='start'&&!live){source=m.source;lastAudio=0;live=true;native.start([...peers.entries()].filter(([,p])=>p.mode==='webrtc').map(([id])=>id));}
      }
      broadcastStatus();return reply(200,{ok:true});
    }
    if (url.pathname === '/api/rotate' && req.method === 'POST') {
      if (!studio || !headerAuth(req) || req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Unauthorized'});
      for (const p of peers.values()) p.close(4003,'Invite changed');
      room = randomBytes(24).toString('hex'); inviteRequest = null; inviteAccess.clear(); listenerHealth.clear(); return reply(200,{ok:true});
    }
    const allowed = ['/app.mjs','/audio.mjs','/pcm-worklet.mjs','/style.css','/favicon.svg'];
    const isPage = url.pathname === '/' || url.pathname === '/listen' || (studio && url.pathname === '/studio');
    if (req.method !== 'GET' || (!isPage && !allowed.includes(url.pathname))) return reply(404,{error:'Not found'});
    try {
      const file = isPage ? '/index.html' : url.pathname;
      let contents = await readFile(path.join(root,'web',file));
      if (isPage) contents = Buffer.from(contents.toString().replace('__MODE__',studio ? 'studio' : 'listener'));
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]}); res.end(contents);
    } catch { reply(500,{error:'Unable to load page'}); }
  }
  const pub = http.createServer((req,res)=>handler(req,res,false).catch(()=>{res.writeHead(500);res.end();}));
  const local = http.createServer((req,res)=>handler(req,res,true).catch(()=>{res.writeHead(500);res.end();}));
  function upgrade(server, studio) {
    server.on('upgrade',(req,socket,head)=>{
      const origin = req.headers.origin;
      if (req.url !== '/signal' || !origin || (studio && !privateRequest(req))) return socket.destroy();
      let parsed; try { parsed = new URL(origin); } catch { return socket.destroy(); }
      // Exact origin prevents another website connecting to the local bridge.
      if (parsed.host !== req.headers.host || !['http:','https:'].includes(parsed.protocol)) return socket.destroy();
      wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,studio));
    });
  }
  upgrade(pub,false); upgrade(local,true);
  wss.on('connection',(ws,studio)=>{
    ws.isAlive = true; ws.role = null; ws.id = randomBytes(8).toString('hex'); ws.mode = 'webrtc';
    ws.on('error',()=>{}); ws.on('pong',()=>ws.isAlive=true);
    const joinTimer = setTimeout(()=>{ if (!ws.role) ws.close(4001,'Join required'); },60000);
    const attempts = new JoinAttempts();
    let recent = 0, windowStart = Date.now();
    ws.on('message',(raw,binary)=>{
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
          if (inviteAccess.required && !inviteAccess.accepts(m.passcode)) {
            if (!attempts.allow() || !joinAttempts.allow()) return ws.close(4008,'Too many passcode attempts. Try again shortly.');
            return send(ws,{type:'passcode-required',invalid:typeof m.passcode==='string'&&m.passcode.length>0});
          }
          if (peers.size >= 8) return ws.close(4009,'Session is full');
          ws.role = 'listener'; peers.set(ws.id,ws);
          send(ws,{type:'joined',id:ws.id,iceServers:ice()});
          notifyHost({type:'peer-joined',id:ws.id});
        } else return ws.close(4003,'Invalid invite');
        clearTimeout(joinTimer); send(ws,info()); broadcastStatus(); return;
      }
      if (m.type === 'ping') return send(ws,{type:'pong',at:m.at});
      if (m.type === 'listener-health' && ws.role === 'listener') {
        if (live) listenerHealth.report(ws.id,m.state);
        else listenerHealth.remove(ws.id);
        return;
      }
      if (m.type === 'publishing' && ws.role === 'publisher') {
        live = !!m.live; if (!live) listenerHealth.clear(); title = typeof m.title === 'string' ? m.title.trim().slice(0,80) || 'Studio session' : title;
        broadcastStatus(); return;
      }
      if (m.type === 'mode' && ws.role === 'listener') {
        const nextMode = m.mode === 'pcm' ? 'pcm' : 'webrtc';
        if (nextMode === ws.mode) return;
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
      if (publisher === ws) { publisher=null; live=false; listenerHealth.clear(); for (const p of peers.values()) send(p,{type:'publisher-left'}); }
      listenerHealth.remove(ws.id);
      if (peers.delete(ws.id)) notifyHost({type:'peer-left',id:ws.id});
      broadcastStatus();
    });
  });
  udp.on('message',(data)=>{
    const p = parsePacket(data); if (!p) return;
    if(native&&(!live||p.source!==owner))return;
    if (source !== null && source !== p.source && Date.now()-lastAudio < 2000) return;
    source = p.source; lastAudio = Date.now(); audio = p; ++packets;
    if (!live || (!publisher&&!native)) return;
    native?.feed(data,p);
    // Keep socket queues bounded. Slow clients reconnect at the live edge.
    for (const ws of [...(publisher?[publisher]:[]),...[...peers.values()].filter(p=>p.mode === 'pcm')]) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > 65536) { ++drops; ws.close(4010,'Audio connection too slow; reconnecting'); continue; }
      ws.send(data,{binary:true});
    }
  });
  if(options.nativeSender){const {NativeSender}=await import('./native-sender.mjs');native=new NativeSender((id,m)=>send(peers.get(id),m),ice);}
  await Promise.all([
    new Promise((resolve,reject)=>{pub.once('error',reject);pub.listen(publicPort,'127.0.0.1',resolve);}),
    new Promise((resolve,reject)=>{local.once('error',reject);local.listen(studioPort,'127.0.0.1',resolve);}),
    new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(udpPort,'127.0.0.1',resolve);})
  ]);
  const lifetimeTimer = options.managedLifetime ? setInterval(()=>{
    const state=lifetime.poll();for(const id of state.expired)releaseSource(id);
    if(state.idle&&!idleNotified){idleNotified=true;options.onNoClients?.();}
  },250) : null;
  const statusTimer = setInterval(()=>{if(native&&owner!==null&&Date.now()-lease>5000){native.stop();live=false;owner=null;listenerHealth.clear();for(const p of peers.values())send(p,{type:'publisher-left'});}broadcastStatus();},1000);
  const heartbeat = setInterval(()=>{ for (const ws of wss.clients) {if (!ws.isAlive) ws.terminate(); else {ws.isAlive=false;ws.ping();}} },15000);
  return {instance,publicPort:pub.address().port, studioPort:local.address().port, udpPort:udp.address().port,
    setTunnelState(phase,url=''){tunnel={phase,url:phase==='ready'?url:''};},
    async close() {native?.close();clearInterval(lifetimeTimer);clearInterval(statusTimer);clearInterval(heartbeat);for (const ws of wss.clients) ws.terminate();
      await Promise.all([new Promise(r=>wss.close(r)),new Promise(r=>pub.close(r)),new Promise(r=>local.close(r)),new Promise(r=>udp.close(r))]);}};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createStreamServer();
  console.log(`SessionStream ready. Broadcaster: http://127.0.0.1:${app.studioPort}/studio\nListener server: http://127.0.0.1:${app.publicPort}\nPlugin bridge: UDP 127.0.0.1:${app.udpPort}`);
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
}
