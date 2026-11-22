const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const bytes=new TextEncoder();
export const TOPUP_SECONDS=300*3600;
export class CloudTopups {
 constructor(env,{sandbox=false}={}){
  this.env=env;this.sandbox=sandbox;
  this.key=String(env[sandbox?'STRIPE_TOPUP_TEST_SECRET_KEY':'STRIPE_TOPUP_SECRET_KEY']||'').trim();
  this.signingSecret=String(env[sandbox?'STRIPE_TOPUP_TEST_WEBHOOK_SECRET':'STRIPE_TOPUP_WEBHOOK_SECRET']||'').trim();
  const request=env.STRIPE_TOPUP_FETCH||fetch;this.fetch=(input,init)=>request(input,init);
 }
 get available(){return new RegExp('^(sk|rk)_'+(this.sandbox?'test':'live')+'_').test(this.key)&&this.signingSecret.startsWith('whsec_');}
 get purpose(){return this.sandbox?'cloud-hours-300-test':'cloud-hours-300';}
 async stripe(path,options={}){
  if(!this.available)fail(this.sandbox?'Sandbox top-up payments are not configured yet.':'Cloud top-up payments are not configured yet.',503);
  let response;
  try{response=await this.fetch('https://api.stripe.com/v1/'+path,{...options,headers:{Authorization:'Bearer '+this.key,'Stripe-Version':'2026-11-18.endive',...options.headers},redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch(error){console.error('cloud_topup_request_failed',JSON.stringify({sandbox:this.sandbox,kind:error.name,reason:String(error.message).replaceAll(this.key,'[redacted]').slice(0,180)}));fail('Cloud top-up payment is temporarily unavailable.',503);}
  if(!response.ok){let data;try{data=await response.json();}catch{}console.error('cloud_topup_request_failed',JSON.stringify({sandbox:this.sandbox,status:response.status,code:typeof data?.error?.code==='string'&&/^[a-z_]{1,64}$/.test(data.error.code)?data.error.code:'provider_error',reason:String(data?.error?.message||'').replaceAll(this.key,'[redacted]').slice(0,240)}));fail('Cloud top-up payment could not be confirmed. Please try again.',503);}
  return response.json();
 }
 async checkout(user,requestId,origin){
  if(typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId))fail('Invalid payment request.');
  const query=this.sandbox?'topup_test':'topup';
  const form=new URLSearchParams({mode:'payment','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':'500','line_items[0][price_data][product_data][name]':'SessionStream: 300 Cloud hours',client_reference_id:user.id,'metadata[account]':user.id,'metadata[purpose]':this.purpose,success_url:origin+'/dashboard/?'+query+'={CHECKOUT_SESSION_ID}',cancel_url:origin+'/dashboard/?'+query+'=cancelled'});
  const session=await this.stripe('checkout/sessions',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'cloud-topup:'+(this.sandbox?'test:':'live:')+user.id+':'+requestId},body:form});
  let url;try{url=new URL(session.url);}catch{fail('Payment checkout was not created.',503);}
  if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)fail('Invalid payment checkout.',503);
  if(session.livemode!==!this.sandbox)fail('Payment environment does not match this checkout.',503);
  return {url:url.href,sandbox:this.sandbox};
 }
 async verify(raw,signature,now=Date.now()){
  if(!this.available)fail('Cloud top-up payments are not configured yet.',503);
  if(typeof raw!=='string'||bytes.encode(raw).length>262144||typeof signature!=='string'||signature.length>2048)fail('Invalid payment notification.');
  const parts=signature.split(','),timestamps=parts.filter(p=>p.startsWith('t='));
  if(timestamps.length!==1||!/^t=\d+$/.test(timestamps[0]))fail('Invalid payment signature.');
  const timestamp=Number(timestamps[0].slice(2));if(Math.abs(now/1000-timestamp)>300)fail('Expired payment notification.');
  const key=await crypto.subtle.importKey('raw',bytes.encode(this.signingSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);let valid=false;
  for(const part of parts.filter(p=>/^v1=[a-f0-9]{64}$/.test(p))){const sig=Uint8Array.from(part.slice(3).match(/../g),b=>parseInt(b,16));if(await crypto.subtle.verify('HMAC',key,sig,bytes.encode(timestamp+'.'+raw)))valid=true;}
  if(!valid)fail('Invalid payment signature.');
  let event;try{event=JSON.parse(raw);}catch{fail('Invalid payment notification.');}
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return null;
  const id=event.data?.object?.id;if(typeof id!=='string'||!/^cs_(test_|live_)?[A-Za-z0-9]{1,200}$/.test(id))fail('Invalid checkout session.');
  const session=await this.stripe('checkout/sessions/'+encodeURIComponent(id)+'?expand%5B%5D=line_items');
  if(session.payment_status!=='paid')return null;
  if(session.livemode!==!this.sandbox)fail('Payment environment does not match this checkout.');
  if(session.id!==id||session.mode!=='payment'||session.currency!=='usd'||session.amount_total!==500||session.amount_subtotal!==500||session.metadata?.purpose!==this.purpose||typeof session.metadata.account!=='string'||!session.metadata.account||session.metadata.account.length>256||session.client_reference_id!==session.metadata.account)fail('Payment does not match a Cloud top-up.');
  const items=session.line_items?.data;
  if(session.line_items?.has_more||!Array.isArray(items)||items.length!==1||items[0].quantity!==1||items[0].price?.unit_amount!==500||items[0].price?.currency!=='usd'||items[0].price?.recurring)fail('Payment does not match the Cloud top-up price.');
  return {user:session.metadata.account,purchase:id,seconds:TOPUP_SECONDS};
 }
}
