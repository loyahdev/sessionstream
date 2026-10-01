// Give the helper its own process group and let macOS reap it when it exits.
// The brief launcher remains the DAW's child only until the local API is ready.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=spawn(process.execPath,['--expose-gc',fileURLToPath(new URL('./companion.mjs',import.meta.url)),...process.argv.slice(2)],{
  detached:true,stdio:['ignore','ignore','ignore','ipc']
});
const timeout=setTimeout(()=>{helper.kill('SIGTERM');process.exit(1);},8000);
helper.on('error',()=>process.exit(1));
helper.on('exit',code=>process.exit(code||1));
helper.on('message',message=>{
  if(!message?.ready)return;
  clearTimeout(timeout);helper.disconnect();helper.unref();process.exit(0);
});
