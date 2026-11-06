import {appendFileSync,existsSync,mkdirSync,renameSync,statSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {format} from 'node:util';
import {runtimeStateDirectory} from './platform.mjs';

// Keep useful errors and tunnel output without persisting private invites or
// credentials. Each writer retains the current log plus two prior generations.
export function redactLog(value){
  return String(value)
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi,'[url redacted]')
    .replace(/\beyJ[A-Za-z0-9_+/=-]{20,}/g,'[tunnel credential redacted]')
    .replace(/\bBearer\s+[^\s"']+/gi,'Bearer [redacted]')
    .replace(/\b(token|passcode|password|room|credential|secret|authorization)\b(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1$2[redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi,'[id redacted]');
}
export function createRuntimeLogger(name,{directory=runtimeStateDirectory(),maxBytes=256*1024}={}){
  const file=path.join(directory,`${name}.log`);
  return (label,...values)=>{
    // Diagnostics must never prevent streaming if the cache is unwritable.
    try{
      mkdirSync(directory,{recursive:true});
      const line=`${new Date().toISOString()} ${label} ${redactLog(format(...values))}\n`;
      const bytes=Buffer.from(line);const bounded=bytes.subarray(0,Math.min(bytes.length,maxBytes));
      if(existsSync(file)&&statSync(file).size+bounded.length>maxBytes){
        if(existsSync(file+'.2'))unlinkSync(file+'.2');
        if(existsSync(file+'.1'))renameSync(file+'.1',file+'.2');
        renameSync(file,file+'.1');
      }
      appendFileSync(file,bounded,{mode:0o600});
    }catch{}
  };
}
export function createLineLogger(write){
  let pending='';
  const capture=chunk=>{
    pending+=chunk.toString();const lines=pending.split(/\r?\n/);pending=lines.pop();
    for(const line of lines)write(line);
    // A malformed child must not grow memory indefinitely. Discard oversized
    // unterminated records rather than logging a partially split credential.
    if(pending.length>65536)pending='[oversized log line omitted]';
  };
  capture.end=()=>{if(pending)write(pending);pending='';};
  return capture;
}
export function installRuntimeLogging(name){
  const log=createRuntimeLogger(name);
  for(const method of ['log','info','warn','error','debug']){
    const original=console[method].bind(console);
    console[method]=(...values)=>{log(method,...values);original(...values);};
  }
  process.on('uncaughtExceptionMonitor',error=>log('uncaughtException',error));
  log('lifecycle',`${name} started; Node ${process.version} ${process.platform}/${process.arch}; pid=${process.pid}`);
  return log;
}
