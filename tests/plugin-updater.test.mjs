import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PluginUpdater,releaseAsset,releaseAPI,newerVersion,downloadResponse} from '../server/plugin-updater.mjs';
import {runUpdateJob} from '../server/update-worker.mjs';
const payload=Buffer.from('verified fixture payload'),sha=createHash('sha256').update(payload).digest('hex');
const metadata=(platform='darwin')=>{const name=platform==='darwin'?'SessionStream-mac-arm64.pkg':'SessionStream-windows-x64-arm64.exe';return {tag_name:'1.0.4',draft:false,prerelease:false,assets:[{name,size:payload.length,digest:'sha256:'+sha,browser_download_url:`https://github.com/loyahdev/sessionstream/releases/download/1.0.4/${name}`}]};};
async function fixture(extra={}){const folder=await mkdtemp(path.join(tmpdir(),'ss-updater-test-')),calls=[];const updater=new PluginUpdater({directory:folder,currentVersion:'1.0.3',platform:'darwin',fetchImpl:async url=>{calls.push(url);return url===releaseAPI?Response.json(metadata()):new Response(payload,{headers:{'content-length':String(payload.length)}});},...extra});return {folder,updater,calls,close:async()=>{await updater.close();await rm(folder,{recursive:true,force:true});}};}
test('release metadata permits only newer stable platform assets from the fixed repository with SHA-256',()=>{
 assert(newerVersion('1.0.4','1.0.3'));assert(!newerVersion('1.0.3','1.0.3'));assert(!newerVersion('1.0.2','1.0.3'));assert.equal(releaseAsset(metadata(),'darwin','1.0.3').sha256,sha);assert.equal(releaseAsset(metadata('win32'),'win32','1.0.3').name,'SessionStream-windows-x64-arm64.exe');
 for(const change of [r=>r.draft=true,r=>r.prerelease=true,r=>r.tag_name='1.0.2',r=>r.assets[0].digest='',r=>r.assets[0].size=Infinity,r=>r.assets[0].browser_download_url='https://evil.invalid/setup.pkg']){const r=metadata();change(r);assert.throws(()=>releaseAsset(r,'darwin','1.0.3'));}
});
test('update checks never download automatically; explicit download verifies bytes before becoming ready',async()=>{
 const f=await fixture();try{await f.updater.ready;assert.equal(f.calls.length,0);assert.equal((await f.updater.status()).phase,'idle');await f.updater.prepare();await f.updater.pending;assert.equal((await f.updater.status()).phase,'ready');assert.deepEqual(await readFile(path.join(f.updater.job,'SessionStream-mac-arm64.pkg')),payload);const n=f.calls.length;await f.updater.prepare();assert.equal(f.calls.length,n,'duplicate click must not download twice');const restored=new PluginUpdater({directory:f.folder,currentVersion:'1.0.3',platform:'darwin'});assert.equal((await restored.status()).phase,'ready');}finally{await f.close();}
});
test('wrong digest, truncated data, oversized data and failed metadata never become installable',async()=>{
 for(const mode of ['digest','truncated','oversized','metadata']){const f=await fixture({fetchImpl:async url=>{if(url===releaseAPI)return mode==='metadata'?new Response('no',{status:503}):Response.json(metadata());return new Response(mode==='digest'?Buffer.alloc(payload.length):mode==='truncated'?payload.subarray(0,2):Buffer.concat([payload,payload]));}});try{await f.updater.prepare();await f.updater.pending;assert.equal((await f.updater.status()).phase,'error',mode);await assert.rejects(f.updater.install(9999),/Download/);if(f.updater.job)await assert.rejects(stat(path.join(f.updater.job,'SessionStream-mac-arm64.pkg.part')),{code:'ENOENT'});}finally{await f.close();}}
});
test('downloads follow only approved HTTPS release redirects',async()=>{
 let count=0;await downloadResponse(metadata().assets[0].browser_download_url,{fetchImpl:async()=>++count===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/asset'}}):new Response(payload)});assert.equal(count,2);
 for(const location of ['http://github.com/a','https://github.com.evil.invalid/a','https://user:password@github.com/a','https://evil.invalid/a'])await assert.rejects(downloadResponse(metadata().assets[0].browser_download_url,{fetchImpl:async()=>new Response(null,{status:302,headers:{location}})}),/Invalid update redirect/);
});
test('cancel interrupts a pending download and cannot schedule an install',async()=>{
 let entered;const started=new Promise(r=>entered=r);const f=await fixture({fetchImpl:async(url,{signal})=>{if(url===releaseAPI)return Response.json(metadata());entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});try{await f.updater.prepare();await started;await f.updater.cancel();assert.equal((await f.updater.status()).phase,'cancelled');await assert.rejects(f.updater.install(9999),/Download/);}finally{await f.close();}
});
test('install is opt-in, rechecks tampering, and launches only the cached detached worker',async()=>{
 const launches=[];const f=await fixture({launch:(binary,args,options)=>{launches.push({binary,args,options});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});try{await f.updater.prepare();await f.updater.pending;await assert.rejects(f.updater.install(process.pid),/Download/);assert.equal(launches.length,0);await f.updater.install(99999);assert.equal((await f.updater.status()).phase,'waiting');assert.equal(launches.length,1);assert.equal(launches[0].options.detached,true);assert.equal(launches[0].options.stdio,'ignore');assert(launches[0].binary.startsWith(f.updater.job+path.sep));await f.updater.install(99999);assert.equal(launches.length,1);await f.updater.cancel();assert.equal((await f.updater.status()).phase,'cancelled');}finally{await f.close();}
 const g=await fixture();try{await g.updater.prepare();await g.updater.pending;await writeFile(path.join(g.updater.job,'SessionStream-mac-arm64.pkg'),'tampered');await assert.rejects(g.updater.install(99999),/verification/);}finally{await g.close();}
});
async function workerFixture(){const folder=await mkdtemp(path.join(tmpdir(),'ss-worker-test-')),asset=releaseAsset(metadata(),'darwin','1.0.3'),job={asset,platform:'darwin',hostPID:99991,enginePID:99992,createdAt:Date.now()};await writeFile(path.join(folder,asset.name),payload);await writeFile(path.join(folder,'job.json'),JSON.stringify(job));return {folder,job,file:path.join(folder,'job.json'),status:async()=>JSON.parse(await readFile(path.join(folder,'status.json'),'utf8')),close:()=>rm(folder,{recursive:true,force:true})};}
test('detached update waits for both host and engine exit before applying, then confirms completion',async()=>{
 const f=await workerFixture();let tick=0,applied=0;try{await runUpdateJob(f.file,{platform:'darwin',alive:pid=>pid===99991?tick<1:tick<3,sleep:async()=>{tick++;},apply:async(file,job)=>{assert.equal(tick,3);assert.equal(job.asset.version,'1.0.4');assert.equal(file,path.join(f.folder,job.asset.name));applied++;}});assert.equal(applied,1);assert.equal((await f.status()).phase,'complete');}finally{await f.close();}
});
test('cancelling a queued update, changed payload, invalid job, and install failure never report success',async()=>{
 for(const mode of ['cancel','tamper','invalid','install-failure']){const f=await workerFixture();let applied=0;try{if(mode==='cancel')await writeFile(path.join(f.folder,'cancel'),'');if(mode==='tamper')await writeFile(path.join(f.folder,f.job.asset.name),'changed');if(mode==='invalid'){f.job.asset.name='../unexpected.exe';await writeFile(f.file,JSON.stringify(f.job));}await runUpdateJob(f.file,{platform:'darwin',alive:()=>false,apply:async()=>{applied++;throw Error('fixture installer failed');}});assert.equal((await f.status()).phase,mode==='cancel'?'cancelled':'error');assert.equal(applied,mode==='install-failure'?1:0);}finally{await f.close();}}
});
test('an applying update cannot be cancelled after it holds the installation lock',async()=>{
 const f=await fixture();try{await f.updater.prepare();await f.updater.pending;await writeFile(path.join(f.updater.job,'control.lock'),'');await assert.rejects(f.updater.cancel(),/already started/);assert.equal((await f.updater.status()).phase,'ready');}finally{await f.close();}
});

test('local update actions require the native engine token and exact local origin',async()=>{
 const {createStreamServer}=await import('../server/index.mjs');const calls=[],updater={state:{phase:'idle'},status:async()=>({phase:'idle'}),prepare:async()=>{calls.push('download');return {phase:'downloading'};},cancel:async()=>({phase:'cancelled'}),dismiss:async()=>({phase:'idle'}),close:async()=>{}};
 const account={ready:Promise.resolve(),status:()=>({phase:'signed-out'}),close(){}};const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,account,dashboardReporting:false,updater,linkStore:{read:async()=>null,write:async()=>{},clear:async()=>{}}});
 try{const base=`http://127.0.0.1:${app.studioPort}`,state=await(await fetch(base+'/api/studio')).json();for(const headers of [{},{Origin:base},{Authorization:'Bearer '+state.token,Origin:'https://evil.invalid'}]){const r=await fetch(base+'/api/update',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action:'download'})});assert.equal(r.status,403);}assert.equal(calls.length,0);const headers={'Content-Type':'application/json',Authorization:'Bearer '+state.token,Origin:base};const invalid=await fetch(base+'/api/update',{method:'POST',headers,body:JSON.stringify({action:'download',url:'https://evil.invalid'})});assert.equal(invalid.status,400);const response=await fetch(base+'/api/update',{method:'POST',headers,body:JSON.stringify({action:'download'})});assert.equal(response.status,200);assert.equal((await response.json()).phase,'downloading');assert.deepEqual(calls,['download']);}finally{await app.close();}
});

test('a completed detached update remains successful after its worker exits',async()=>{
 const f=await fixture();try{await f.updater.prepare();await f.updater.pending;await writeFile(path.join(f.updater.job,'status.json'),JSON.stringify({phase:'complete',version:'1.0.4',message:'Updated.'}));await writeFile(path.join(f.updater.job,'worker.json'),JSON.stringify({pid:1073741823}));f.updater.state={phase:'waiting'};assert.equal((await f.updater.status()).phase,'complete');}finally{await f.close();}
});
