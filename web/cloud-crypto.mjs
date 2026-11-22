// Shared Node/browser audio-frame encryption. This is a transport primitive,
// not a connected cloud room. Keys belong only on authorized endpoints.
const magic=new Uint8Array([83,83,67,49]); // SSC1
const headerBytes=16,tagBytes=16,maxPayload=32768;
const asBytes=value=>value instanceof Uint8Array?value:new Uint8Array(value);
export function createCloudKey(){return crypto.getRandomValues(new Uint8Array(32));}
export async function importCloudKey(raw){
 const bytes=asBytes(raw);if(bytes.byteLength!==32)throw Error('Cloud audio requires a 256-bit key.');
 return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export class CloudFrameEncryptor {
 constructor(key){this.key=key;this.prefix=crypto.getRandomValues(new Uint8Array(8));this.sequence=0;}
 async encrypt(raw){
  const payload=asBytes(raw);
  if(!payload.byteLength||payload.byteLength>maxPayload)throw Error('Invalid cloud audio frame size.');
  // Reserve the counter before awaiting, so concurrent calls cannot reuse a nonce.
  if(this.sequence>0xffffffff)throw Error('Cloud audio key rotation is required.');
  const header=new Uint8Array(headerBytes);header.set(magic);header.set(this.prefix,4);
  new DataView(header.buffer).setUint32(12,this.sequence++,false);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:header.subarray(4),additionalData:header,tagLength:128},this.key,payload);
  const frame=new Uint8Array(headerBytes+encrypted.byteLength);frame.set(header);frame.set(new Uint8Array(encrypted),headerBytes);return frame;
 }
}
export class CloudFrameDecryptor {
 constructor(key){this.key=key;this.prefix=null;this.highest=-1;this.received=new Set();this.pending=new Set();this.pendingPrefix=null;}
 async decrypt(raw){
  // Copy input because callers may reuse network receive buffers while awaiting.
  const frame=asBytes(raw).slice();
  if(frame.byteLength<=headerBytes+tagBytes||frame.byteLength>headerBytes+tagBytes+maxPayload||magic.some((byte,i)=>frame[i]!==byte))throw Error('Invalid cloud audio frame.');
  const prefix=Array.from(frame.subarray(4,12),n=>n.toString(16).padStart(2,'0')).join('');
  const sequence=new DataView(frame.buffer,frame.byteOffset,frame.byteLength).getUint32(12,false);
  if((this.prefix&&this.prefix!==prefix)||(this.pendingPrefix&&this.pendingPrefix!==prefix))throw Error('Cloud audio stream changed. Join the new stream first.');
  if(sequence<=this.highest-256||this.received.has(sequence)||this.pending.has(sequence))throw Error('Repeated or expired cloud audio frame.');
  if(this.pending.size>=64)throw Error('Too many cloud audio frames pending.');
  this.pending.add(sequence);this.pendingPrefix=prefix;
  try{
   const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:frame.subarray(4,16),additionalData:frame.subarray(0,16),tagLength:128},this.key,frame.subarray(headerBytes));
   if(sequence<=this.highest-256)throw Error('Expired cloud audio frame.');
   this.prefix=prefix;this.highest=Math.max(this.highest,sequence);this.received.add(sequence);
   for(const old of this.received)if(old<=this.highest-256)this.received.delete(old);
   return new Uint8Array(plaintext);
  }finally{this.pending.delete(sequence);if(!this.pending.size)this.pendingPrefix=null;}
 }
}
