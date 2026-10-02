import {homedir} from 'node:os';
import path from 'node:path';

export function executableName(name, platform=process.platform) {
  return platform==='win32'?`${name}.exe`:name;
}

export function runtimeStateDirectory({platform=process.platform,env=process.env,home=homedir()}={}) {
  if(env.SESSIONSTREAM_STATE_DIR)return env.SESSIONSTREAM_STATE_DIR;
  if(platform==='win32')return path.win32.join(env.LOCALAPPDATA||path.win32.join(home,'AppData','Local'),'SessionStream','Cache');
  if(platform==='darwin')return path.join(home,'Library','Caches','SessionStream');
  return path.join(env.XDG_CACHE_HOME||path.join(home,'.cache'),'SessionStream');
}
