// Run with Node on Windows or a cross-build host. Downloads are pinned and verified.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,rm,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=path.join(root,'vendor','windows-runtime-x64');
const downloads=path.join(root,'vendor','windows-downloads');
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const nodeVersion='24.3.0';
const cloudflaredVersion='2026.9.3';
const nodeHash='c0c8efbca1b57e5b074bbdf7cef1ccca40979d6b46e5bcadaad5d4b07cbb3b10';
const cloudflaredHash='f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2';
const modules=['@roamhq/wrtc','@roamhq/wrtc-win32-x64','ws','domexception','webidl-conversions'];
await mkdir(downloads,{recursive:true});
async function download(name,url,algorithm,expected,encoding='hex'){
  const file=path.join(downloads,name);
  let bytes;try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes||createHash(algorithm).update(bytes).digest(encoding)!==expected){
    console.log(`Downloading ${name}`);
    const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(createHash(algorithm).update(bytes).digest(encoding)!==expected)throw Error(`Integrity check failed: ${name}`);
    await writeFile(file,bytes);
  }
  return file;
}
await rm(cache,{recursive:true,force:true});
await mkdir(path.join(cache,'bin'),{recursive:true});
const archive=await download(`node-v${nodeVersion}-win-x64.zip`,`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`,'sha256',nodeHash);
const nodeExtract=path.join(downloads,'node-extracted');
await rm(nodeExtract,{recursive:true,force:true});await mkdir(nodeExtract);
execFileSync('tar',['-xf',archive,'-C',nodeExtract]);
await cp(path.join(nodeExtract,`node-v${nodeVersion}-win-x64`,'node.exe'),path.join(cache,'bin','node.exe'));
await cp(path.join(nodeExtract,`node-v${nodeVersion}-win-x64`,'LICENSE'),path.join(cache,'bin','NODE-LICENSE'));
await cp(await download(`cloudflared-${cloudflaredVersion}-windows-amd64.exe`,`https://github.com/cloudflare/cloudflared/releases/download/${cloudflaredVersion}/cloudflared-windows-amd64.exe`,'sha256',cloudflaredHash),path.join(cache,'bin','cloudflared.exe'));
let supervisor;
for(const candidate of ['build-windows-x64/windows-tunnel-supervisor.exe','build-windows-x64/Release/windows-tunnel-supervisor.exe']){
  try{await stat(path.join(root,candidate));supervisor=path.join(root,candidate);break;}catch(error){if(error.code!=='ENOENT')throw error;}
}
if(supervisor)await cp(supervisor,path.join(cache,'bin','windows-tunnel-supervisor.exe'));
else if(!process.argv.includes('--prepare'))throw Error('Build the Windows x64 tunnel supervisor first');
for(const module of modules){
  const entry=lock.packages[`node_modules/${module}`];
  if(!entry?.integrity?.startsWith('sha512-'))throw Error(`Missing SHA-512 lockfile integrity: ${module}`);
  const archive=await download(`${module.replaceAll('/','-').replace('@','')}-${entry.version}.tgz`,entry.resolved,'sha512',entry.integrity.slice(7),'base64');
  const destination=path.join(cache,'node_modules',module);await mkdir(destination,{recursive:true});
  execFileSync('tar',['-xf',archive,'--strip-components=1','-C',destination]);
}
for(const dir of ['server','web'])await cp(path.join(root,dir),path.join(cache,dir),{recursive:true,filter:p=>!path.basename(p).startsWith('._')&&path.basename(p)!=='.DS_Store'});
await mkdir(path.join(cache,'scripts'));await mkdir(path.join(cache,'notices'));
for(const file of ['companion.mjs','launch-engine.mjs'])await cp(path.join(root,'scripts',file),path.join(cache,'scripts',file));
for(const file of ['THIRD_PARTY.md','NODE-WEBRTC-LICENSE.md','CLOUDFLARED-LICENSE.txt','NSIS-LICENSE.txt'])await cp(path.join(root,'docs',file),path.join(cache,'notices',file));
await cp(path.join(root,'plugin','third_party','LICENSE-qrcodegen.txt'),path.join(cache,'notices','LICENSE-qrcodegen.txt'));
await cp(path.join(root,'vendor','JUCE','LICENSE.md'),path.join(cache,'notices','JUCE-LICENSE.md'));
for(const file of ['LICENSE','README.md'])await cp(path.join(root,file),path.join(cache,'notices',file));
await writeFile(path.join(cache,'package.json'),JSON.stringify({name:'sessionstream-runtime',version:manifest.version,private:true,type:'module'},null,2)+'\n');
await writeFile(path.join(cache,'runtime-manifest.json'),JSON.stringify({version:manifest.version,platform:'win32',runtimeArch:'x64',pluginArchitectures:['x64','arm64'],minimumOS:'Windows 11',arm64Note:'Native ARM64 plugin; separate x64 Node/WebRTC/cloudflared helper uses Windows 11 x64 emulation.',node:{version:nodeVersion,sha256:nodeHash},cloudflared:{version:cloudflaredVersion,sha256:cloudflaredHash},modules:modules.map(name=>({name,version:lock.packages[`node_modules/${name}`].version,integrity:lock.packages[`node_modules/${name}`].integrity}))},null,2)+'\n');
console.log(`Prepared verified runtime: ${cache}`);
if(!process.argv.includes('--prepare')){
  for(const build of process.argv.slice(2)){
    const bundle=path.resolve(root,build,'SessionStream_artefacts','Release','VST3','SessionStream.vst3');
    if(!(await stat(bundle)).isDirectory())throw Error(`Build the VST3 first: ${bundle}`);
    const destination=path.join(bundle,'Contents','Resources','runtime');
    await rm(destination,{recursive:true,force:true});await cp(cache,destination,{recursive:true});
    console.log(`Bundled: ${bundle}`);
  }
}
