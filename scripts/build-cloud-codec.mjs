import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(root+'web/vendor',{recursive:true});
await build({entryPoints:[root+'web/cloud-decoder.mjs'],outfile:root+'web/vendor/cloud-decoder.mjs',bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof'});
console.log('Offline Cloud audio decoder bundled.');
