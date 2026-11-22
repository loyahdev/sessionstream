const idPattern=/^[a-zA-Z0-9_-]{1,128}$/;
const fail=(message,status=503)=>{throw Object.assign(Error(message),{status});};
export class CloudSFU {
 constructor(env){this.env=env;}
 get configured(){return typeof this.env.REALTIME_SFU_APP_ID==='string'&&idPattern.test(this.env.REALTIME_SFU_APP_ID.trim())&&typeof this.env.REALTIME_SFU_BEARER_TOKEN==='string'&&!!this.env.REALTIME_SFU_BEARER_TOKEN.trim();}
 async call(method,path,body,allowGone=false){
  if(!this.configured)fail('Cloud streaming is not configured.');
  let response,data;
  try{
   response=await (this.env.SFU_FETCH||fetch)(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(this.env.REALTIME_SFU_APP_ID.trim())}${path}`,{method,headers:{Authorization:`Bearer ${this.env.REALTIME_SFU_BEARER_TOKEN.trim()}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
   data=await response.json();
  }catch(error){console.error('cloud_sfu_failure',JSON.stringify({operation:path.split('/').at(-1),kind:error.name,reason:String(error.message).replaceAll(this.env.REALTIME_SFU_BEARER_TOKEN.trim(),'[redacted]').replaceAll(this.env.REALTIME_SFU_APP_ID.trim(),'[app]').slice(0,200)}));fail('Cloud connection could not be confirmed. Reconnect before trying again.');}
  if(allowGone&&response.status===410&&data?.errorCode==='session_error')return {gone:true};
  if(!response.ok||!data||data.errorCode){console.error('cloud_sfu_failure',JSON.stringify({operation:path.split('/').at(-1),status:response.status,code:typeof data?.errorCode==='string'&&/^[a-z_0-9-]{1,64}$/i.test(data.errorCode)?data.errorCode:'invalid_response'}));fail('Cloud connection could not be completed. Reconnect and try again.');}
  // Never pass provider error descriptions or credentials through to clients.
  return data;
 }
 validSession(id){if(typeof id!=='string'||!idPattern.test(id))fail('Invalid Cloud connection.',400);return encodeURIComponent(id);}
 async create(){const data=await this.call('POST','/sessions/new');if(!idPattern.test(data.sessionId||''))fail('Cloud returned an invalid connection.');return data.sessionId;}
 async establish(id){const data=await this.call('POST',`/sessions/${this.validSession(id)}/datachannels/establish`,{dataChannel:{location:'remote',dataChannelName:'server-events'}});if(data.dataChannel?.errorCode||!Number.isInteger(data.dataChannel?.id)||data.sessionDescription?.type!=='offer'||typeof data.sessionDescription.sdp!=='string'||data.sessionDescription.sdp.length>32768)fail('Cloud returned an invalid transport offer.');return {sessionDescription:data.sessionDescription};}
 async answer(id,description){if(description?.type!=='answer'||typeof description.sdp!=='string'||description.sdp.length<16||description.sdp.length>32768)fail('Invalid Cloud transport answer.',400);await this.call('PUT',`/sessions/${this.validSession(id)}/renegotiate`,{sessionDescription:{type:'answer',sdp:description.sdp}});}
 async channel(id,name,publisher){
  const entry={location:publisher?'remote':'local',dataChannelName:name,ordered:false,maxPacketLifeTime:120,...(publisher?{sessionId:publisher,waitForAck:true}: {})};
  const data=await this.call('POST',`/sessions/${this.validSession(id)}/datachannels/new`,{dataChannels:[entry]});
  const result=data.dataChannels?.[0];if(data.dataChannels?.length!==1||result?.errorCode||!Number.isInteger(result?.id)||result.id<0||result.id>65534)fail('Cloud channel could not be confirmed. Reconnect before trying again.');
  return result.id;
 }
 async close(id,channel){if(!Number.isInteger(channel)||channel<0||channel>65534)fail('Invalid Cloud channel.',400);const data=await this.call('PUT',`/sessions/${this.validSession(id)}/datachannels/close`,{dataChannels:[{id:channel}]},true);if(data.gone)return;const result=data.dataChannels?.find(x=>x.id===channel);if(!result||result.errorCode&&result.errorCode!=='close_track_error')fail('Cloud disconnect could not be confirmed.');}
}
