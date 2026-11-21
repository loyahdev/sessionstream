import {createHash,randomBytes} from 'node:crypto';
const browserKey=credential=>typeof credential==='string'&&/^[a-f0-9]{64}$/.test(credential)
  ?'browser:'+createHash('sha256').update(credential).digest('hex'):null;
const denied=status=>status==='rejected'||status==='revoked';
const clean=name=>typeof name==='string'?name.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,48):'';
export class ListenerAdmission {
 constructor({now=Date.now}={}){this.now=now;this.approval=false;this.requireAccount=false;this.records=new Map();this.notes=[];this.noteTimestamps=new Map();}
 reset(){this.records.clear();this.notes=[];this.noteTimestamps.clear();}
 configure({approval,requireAccount}){if(typeof approval!=='boolean'||typeof requireAccount!=='boolean')throw Error('Invalid listener settings.');this.approval=approval;this.requireAccount=requireAccount;}
 decision(credential,identity){
  const browser=browserKey(credential);
  const account=identity&&this.records.get('account:'+identity.id);
  if(denied(account?.status))return account.status;
  if(browser)for(const record of this.records.values())
    if(record.browser===browser&&denied(record.status))return record.status;
  return null;
 }
 request({credential,name,identity,connection}){
  const blocked=this.decision(credential,identity);
  if(blocked)return {status:blocked};
  if(this.requireAccount&&!identity)return {status:'sign-in-required'};
  const browser=browserKey(credential);
  if(this.approval&&!browser&&!identity)return {status:'name-required'};
  const key=identity?'account:'+identity.id:browser||'legacy:'+connection;
  let record=this.records.get(key);
  if(record?.status==='account-required')record.status=this.approval?'pending':'approved';
  if(!record){if(this.records.size>=256)return {status:'full'};record={id:randomBytes(8).toString('hex'),key,browser,name:clean(identity?.name)||clean(name)||'Guest',verified:!!identity,status:this.approval?'pending':'approved',at:this.now(),connection};this.records.set(key,record);}
  const replacedConnection=record.connection&&record.connection!==connection?record.connection:null;record.connection=connection;record.at=this.now();
  return {status:record.status,record,replacedConnection};
 }
 expirePending(){const expired=[];for(const [key,r] of this.records)if(r.status==='pending'&&this.now()-r.at>120000){expired.push(r);this.records.delete(key);}return expired;}
 find(id){return [...this.records.values()].find(r=>r.id===id);}
 decide(id,action){const r=this.find(id);if(!r)throw Error('Listener request is no longer available.');if(action==='accept'&&r.status==='pending')r.status='approved';else if(action==='reject'&&r.status==='pending')r.status='rejected';else if(action==='revoke'&&r.status==='approved'){r.status='revoked';this.approval=true;}else throw Error('This listener request has changed.');return r;}
 cancel(connection){
  for(const [key,record] of this.records)
    if(record.connection===connection&&record.status==='pending'){this.records.delete(key);return;}
 }
 disconnected(connection){this.noteTimestamps.delete(connection);for(const r of this.records.values())if(r.connection===connection)r.connection=null;}
 addNote(connection,rawText,offsetSeconds=0){
  const text=typeof rawText==='string'?rawText.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,120):'';
  if(!text)return false;
  const now=this.now(),last=this.noteTimestamps.get(connection)||0;
  if(now-last<2000)return false;
  this.noteTimestamps.set(connection,now);
  const record=[...this.records.values()].find(r=>r.connection===connection&&r.status==='approved');
  const offset=Math.max(0,Math.floor(Number(offsetSeconds)||0));
  if(record){record.note=text;record.noteOffset=offset;}
  this.notes.push({id:randomBytes(6).toString('hex'),name:record?.name||'Listener',text,offsetSeconds:offset,at:now});
  if(this.notes.length>20)this.notes.shift();
  return true;
 }
 snapshot(){return {approval:this.approval,requireAccount:this.requireAccount,notes:[...this.notes],listeners:[...this.records.values()].filter(r=>r.status==='pending'||r.status==='approved').map(({id,name,verified,status,connection,note,noteOffset})=>({id,name,verified,status,online:!!connection,...(note?{note,noteOffset}:{})}))};}
}
