import {cp,mkdir,readFile,rm,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('package.json must contain a dotted release version');
const version=manifest.version.replace(/\.0$/,'');
const stage=path.join(root,'artifacts','windows-stage');
const bundle=path.join(stage,'SessionStream.vst3');
const output=path.join(root,'artifacts',`SessionStream-${version}-windows-x64-arm64.exe`);
await rm(stage,{recursive:true,force:true});await mkdir(bundle,{recursive:true});
const architectures=[['x64','x86_64-win',0x8664],['arm64','arm64-win',0xaa64]];
function machine(bytes){const offset=bytes.readUInt32LE(0x3c);if(bytes.toString('ascii',offset,offset+4)!=='PE\0\0')throw Error('Invalid PE binary');return bytes.readUInt16LE(offset+4);}
for(const [arch,folder,expected] of architectures){
  const contents=path.join(root,`build-windows-${arch}`,'SessionStream_artefacts','Release','VST3','SessionStream.vst3','Contents');
  const binary=path.join(contents,folder,'SessionStream.vst3');
  const bytes=await readFile(binary);
  if(machine(bytes)!==expected)throw Error(`Wrong plugin architecture: ${binary}`);
  if(!bytes.includes(Buffer.from(manifest.version+'\0','utf16le')))throw Error(`Plugin resource version differs from package.json: ${binary}`);
  await cp(path.join(contents,folder),path.join(bundle,'Contents',folder),{recursive:true});
}
const runtime=path.join(root,'vendor','windows-runtime-x64');
for(const relative of ['bin/node.exe','bin/cloudflared.exe','bin/windows-tunnel-supervisor.exe','node_modules/@roamhq/wrtc-win32-x64/wrtc.node']){
  if(machine(await readFile(path.join(runtime,relative)))!==0x8664)throw Error(`Wrong helper architecture: ${relative}`);
}
const runtimeManifest=JSON.parse(await readFile(path.join(runtime,'runtime-manifest.json'),'utf8'));
if(runtimeManifest.version!==manifest.version)throw Error('Runtime version differs from package.json');
await cp(runtime,path.join(bundle,'Contents','Resources','runtime'),{recursive:true});
// Both architecture folders share one resources/runtime directory, per VST3 bundle layout.
await writeFile(path.join(bundle,'Contents','Resources','sessionstream-version.txt'),manifest.version+'\n');
const hashes=[];
async function hashTree(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await hashTree(file);else hashes.push(`${createHash('sha256').update(await readFile(file)).digest('hex')}  ${path.relative(stage,file).replaceAll('\\','/')}`);}}
await hashTree(bundle);await writeFile(path.join(root,'artifacts',`SessionStream-${version}-windows-payload.sha256`),hashes.sort().join('\n')+'\n');
console.log(`Staged both architectures: ${bundle}`);
if(!process.argv.includes('--stage-only')){
  const nsis=process.env.MAKENSIS_PATH||'makensis';
  const prefix=process.platform==='win32'?'/':'-';
  execFileSync(nsis,[`${prefix}WX`,`${prefix}DPROJECT_DIR=${root}`,`${prefix}DSTAGE_DIR=${stage}`,`${prefix}DOUTPUT_FILE=${output}`,`${prefix}DPACKAGE_VERSION=${manifest.version}`,`${prefix}DDISPLAY_VERSION=${version}`,path.join(root,'installer','windows','sessionstream.nsi')],{stdio:'inherit'});
  const digest=createHash('sha256').update(await readFile(output)).digest('hex');
  await writeFile(`${output}.sha256`,`${digest}  ${path.basename(output)}\n`);console.log(`Installer: ${output}\nSHA-256: ${digest}`);
}
