import {startNavigation,navigate} from '/websrc/navigation.js';
import {billingDestination} from '/websrc/billing-navigation.js';
import {freshSessionToken} from '/websrc/account-session.js';
function renderWelcome(){if(new URLSearchParams(location.search).get('welcome')!=='pro'&&!location.pathname.startsWith('/dashboard/welcome'))return;document.documentElement.dataset.view='welcome';document.title='Welcome to Pro | SessionStream';document.querySelector('nav a.active').href='/dashboard/';document.querySelectorAll('nav a[href^="#"]').forEach(a=>a.href='/dashboard/'+a.getAttribute('href'));let section=$('#pro-welcome');if(!section){section=el('section','','pro-welcome');section.id='pro-welcome';$('.welcome').after(section)}section.replaceChildren();section.append(el('p',account.plan==='pro'?'SESSIONSTREAM PRO':'CHECKING YOUR PAYMENT','eyebrow'),el('h2',account.plan==='pro'?'Welcome to Pro.':'We’re confirming your subscription.'),el('p',account.plan==='pro'?'Thanks for supporting SessionStream. Your account is ready for up to 8 listeners per local session, up to 30 per cloud session, reusable links, audio quality controls, and DAW-to-DAW collaboration. Sign in to the plugin with this same account to use your Pro features.':'Your payment confirmation can take a moment. We’ll check again automatically. You don’t need to buy another subscription.'));const next=el('a',account.plan==='pro'?'Back to overview':'Questions? Email us','button primary');next.href=account.plan==='pro'?'/dashboard/':'mailto:support@sessionstream.app';section.append(next);if(account.plan!=='pro')$('.billing-button').hidden=true}
import {makeIcon} from '/websrc/icons.js';
let account=null,period='month',loadVersion=0,refreshFailed=false;
const $=selector=>document.querySelector(selector),dialog=$('#preview-dialog');
const el=(tag,text,className)=>{const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e};
let entranceAnimations=[],loaderExit=null;
function revealDashboard(){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const loader=$('#account-loading');loader.hidden=false;loader.classList.add('is-exiting');
 loaderExit=loader.animate([{opacity:1},{opacity:0}],{duration:150,easing:'ease-out',fill:'forwards'});
 loaderExit.onfinish=()=>{loader.hidden=true;loader.classList.remove('is-exiting');loaderExit.cancel();loaderExit=null};
 const fade=element=>element.animate([{opacity:0},{opacity:1}],{duration:260,delay:60,easing:'ease-out',fill:'backwards'});
 entranceAnimations=[fade($('.sidebar')),fade($('.page>header'))];
 const sections=[...document.querySelectorAll('#account-notice,.welcome,.period-toolbar,.session-status,.metrics article,.dashboard-grid>.panel,#pro-welcome,main>footer')]
  .map(element=>({element,box:element.getBoundingClientRect()})).filter(({box})=>box.width&&box.height)
  .sort((a,b)=>a.box.top-b.box.top||a.box.left-b.box.left);
 sections.forEach(({element},index)=>entranceAnimations.push(element.animate(
  [{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],
  {duration:320,delay:Math.min(90+index*28,300),easing:'cubic-bezier(.2,.7,.2,1)',fill:'backwards'}
 )));
}
function dashboardState(state){
 const ready=state==='ready',entering=ready&&document.body.dataset.accountState!=='ready';
 if(!ready){entranceAnimations.forEach(animation=>animation.cancel());entranceAnimations=[];loaderExit?.cancel();loaderExit=null;$('#account-loading').classList.remove('is-exiting');}
 document.body.dataset.accountState=state;
 if(!ready&&dialog.open)dialog.close();
 $('.sidebar').hidden=!ready;$('.page').hidden=!ready;
 $('.page').setAttribute('aria-busy',String(!ready));
 $('#account-content').hidden=!ready;$('#account-loading').hidden=ready;
 if(entering)revealDashboard();
}
function showLoading(){
 dashboardState('loading');
 $('#account-loading').classList.remove('has-error');
 $('#account-loading-title').textContent='Loading your account';
 $('#account-loading-message').textContent='Checking your sign-in and subscription.';
 $('#account-retry').hidden=true;
}
async function api(path='',method='GET',body){const token=await freshSessionToken();const response=await fetch('/api/account'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json','X-Clerk-Session-Token':token},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Please try again.'),{status:response.status});return data}
function message(title,paragraphs){$('#dialog-title').textContent=title;$('#dialog-body').replaceChildren(...paragraphs.map(text=>el('p',text)));dialog.showModal();$('#dialog-title').focus({preventScroll:true})}
function closeDialog(){if(!dialog.open||dialog.classList.contains('closing'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close();return}dialog.classList.add('closing');setTimeout(()=>{dialog.close();dialog.classList.remove('closing')},150)}
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog()});
function notice(text){$('#account-notice').hidden=false;$('#account-notice').textContent=text}
function hours(seconds){const minutes=Math.floor(seconds/60);return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`}
async function billing(action,button){if(!account){navigate('/api/account/sign-in?intent=upgrade','Opening sign-in…',button);return}if(action==='portal'){navigate('/dashboard/account/billing','Opening billing…',button);return}const finish=startNavigation('Opening checkout…',button);try{const result=await api('/'+action,'POST');location.assign(billingDestination(result.url,location.origin))}catch(error){finish();message('Billing',[error.message])}}
function renderUsage(){
 if(!account)return;
 const all=Array.isArray(account.usage)?account.usage:[],records=period==='week'?all.slice(-7):all;
 const hasActivity=records.some(r=>r.seconds>0||r.listenerSeconds>0||r.bytes>0),hasHistory=all.some(r=>r.seconds>0||r.listenerSeconds>0||r.bytes>0);
 const empty=$('#activity-empty');empty.hidden=hasActivity;$('#usage').classList.toggle('is-empty',!hasActivity);
 empty.querySelector('h3').textContent=hasHistory?'No activity in this period':'No streaming activity yet';
 empty.querySelector('p').textContent=hasHistory?'Choose Last 30 days to see your recent account-linked sessions.':'Your activity will appear after your first account-linked session. Sign in to SessionStream in your DAW, then start streaming.';
 if(!empty.querySelector('.icon'))empty.querySelector('.empty-activity-icon').append(makeIcon('chart-no-axes-combined'));
 const totals=records.reduce((sum,r)=>({seconds:sum.seconds+r.seconds,listenerSeconds:sum.listenerSeconds+r.listenerSeconds,bytes:sum.bytes+r.bytes}),{seconds:0,listenerSeconds:0,bytes:0});
 $('#streaming-metric').textContent=hours(totals.seconds);$('#listener-metric').textContent=hours(totals.listenerSeconds);$('#data-metric').textContent=totals.bytes>=1e9?`${(totals.bytes/1e9).toFixed(1)} GB`:`${Math.round(totals.bytes/1e6)} MB`;$('#chart-total').textContent=hours(totals.seconds);
 const format=date=>new Date(date+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
 $('#date-label').textContent=records.length?`${format(records[0].date)} – ${format(records.at(-1).date)}`:'No activity recorded';
 if(records.length){$('#chart-start').textContent=format(records[0].date);$('#chart-middle').textContent=format(records[Math.floor(records.length/2)].date);$('.chart-dates>span:last-child').textContent=format(records.at(-1).date)}
 const maximum=Math.max(30,Math.ceil(Math.max(0,...records.map(r=>r.seconds/60))/30)*30);$('#chart-max').textContent=`${maximum} min`;$('#chart-mid').textContent=`${maximum/2} min`;
 $('#chart-bars').replaceChildren(...(hasActivity?records.map(record=>{const button=el('button','');button.style.height=`${record.seconds/60/maximum*100}%`;button.title=`${format(record.date)}: ${hours(record.seconds)}`;button.setAttribute('aria-label',button.title);button.addEventListener('click',()=>message(format(record.date),[`${hours(record.seconds)} spent streaming.`,`${hours(record.listenerSeconds)} combined listening time.`]));return button}):[]));
}
function render(){const name=account.user.name||'Your account';document.querySelectorAll('[data-user-name]').forEach(e=>e.textContent=name);document.querySelectorAll('[data-user-email]').forEach(e=>e.textContent=account.user.email||'Account settings');document.querySelectorAll('[data-avatar]').forEach(e=>{e.replaceChildren();if(account.user.imageUrl){const image=document.createElement('img');image.src=account.user.imageUrl;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{e.textContent=name[0].toUpperCase()},{once:true});e.append(image)}else e.append(makeIcon('user-round'))});document.querySelectorAll('[data-plan]').forEach(e=>e.textContent=account.plan==='pro'?'Pro':'Free');$('#sign-in-panel').hidden=true;$('#plan-title').textContent=account.plan==='pro'?'SessionStream Pro':'SessionStream Free';$('#plan-value').textContent=account.plan==='pro'?'More listeners, reusable links, and audio received directly in your DAW.':'Upgrade to Pro for:';$('#plan-benefits').hidden=account.plan==='pro';$('#plan-sessions').hidden=account.plan==='pro';const renewal=$('#plan-renewal');renewal.hidden=account.plan!=='pro';renewal.firstElementChild.textContent=account.billing.cancelAtPeriodEnd?'Access ends':'Next renewal';const renewalAt=Number(account.billing.renewsAt),days=Number.isFinite(renewalAt)&&renewalAt>0?Math.max(0,Math.ceil((renewalAt-Date.now())/86400000)):null;renewal.lastElementChild.textContent=days===null?'—':days===0?'Today':`In ${days} ${days===1?'day':'days'}`;renewal.lastElementChild.title=days===null?'':new Date(renewalAt).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});$('.session-status>span:last-child').textContent=account.plan==='pro'?'Local: 1 per device · Cloud: 1 per account':'One session at a time per account';$('#listener-limit').textContent=`Up to ${account.limits.listeners}`;const cloudListeners=account.limits.cloudListeners??30;$('#plan-cloud-listeners').hidden=account.plan!=='pro';$('#cloud-listener-limit').textContent=`Up to ${cloudListeners}`;$('#plan-usage').hidden=account.plan!=='pro';$('#billing-note').textContent=account.plan==='pro'?(account.billing.cancelAtPeriodEnd?'Cancels at the end of this billing period':'$5 USD/month · Manage your subscription'):'Free · No subscription';$('#plan-action-label').textContent=account.plan==='pro'?'Manage billing':'Upgrade to Pro · $5/month';$('#nav-plan-label').textContent=account.plan==='pro'?'Billing':'Upgrade to Pro';$('.session-status strong').textContent=account.active?'Session streaming':'No session running';$('#device-count').textContent=`${account.devices.length} / 3 connected`;const list=$('#device-list');list.replaceChildren();if(!account.devices.length)list.append(el('p','No computers connected yet. Sign in from the plugin to add your first computer.','empty-devices'));account.devices.forEach(device=>{const row=el('div','','device'),icon=el('span','','device-icon'),info=el('div','');info.append(el('strong',device.name),el('p',`${device.platform} · SessionStream ${device.version}`),el('small',`Last seen ${new Date(device.lastSeen).toLocaleString()}`));const button=el('button','Disconnect');button.className='disconnect-device';button.addEventListener('click',()=>{message(`Disconnect ${device.name}?`,['This computer will be signed out of your account and its active account session will end.']);const confirm=el('button','Disconnect computer','button disconnect-confirm');confirm.addEventListener('click',async()=>{confirm.disabled=true;confirm.textContent='Disconnecting…';try{await api('/device','DELETE',{id:device.id});closeDialog();await load()}catch(error){confirm.disabled=false;confirm.textContent=error.message}});$('#dialog-body').append(confirm)});icon.append(makeIcon('monitor'));row.append(icon,info,button);list.append(row)});renderUsage();}
async function load({block=false}={}){
 const version=++loadVersion;
 if(block)showLoading();
 try{
  const nextAccount=await api();
  if(version!==loadVersion)return;
  account=nextAccount;render();renderWelcome();dashboardState('ready');
  if(refreshFailed){$('#account-notice').hidden=true;refreshFailed=false;}
  if(new URLSearchParams(location.search).get('intent')==='upgrade'){
   history.replaceState(null,'','/dashboard/');if(account.plan!=='pro')void billing('checkout');
  }
  if(new URLSearchParams(location.search).get('checkout')==='success')notice(account.plan==='pro'?'Your Pro subscription is active.':'Your payment is being confirmed. Your plan will update automatically.');
 }catch(error){
  if(version!==loadVersion)return;
  if(error.status===401){
   account=null;showLoading();$('#account-loading-title').textContent='Opening sign-in';
   $('#account-loading-message').textContent='Please sign in again to continue.';
   location.replace('/api/account/sign-in');
  }else if(document.body.dataset.accountState==='ready'){
   refreshFailed=true;notice('Your account could not be refreshed. '+error.message);
  }else{
   dashboardState('error');$('#account-loading').classList.add('has-error');
   $('#account-loading-title').textContent='Your account couldn’t be loaded';
   $('#account-loading-message').textContent=error.message;$('#account-retry').hidden=false;
  }
 }
}

const actions={plan:button=>account?.plan==='pro'?actions.billing(button):billing('checkout',button),billing:button=>billing('portal',button),pro:button=>billing('checkout',button),connect:()=>message('Connect a computer',['Install SessionStream and open it inside your DAW. Choose Sign in in the plugin, then finish signing in through your browser.','Your account supports up to three connected computers, with one local session per device on Pro; cloud sessions are limited to one per account.']),account:()=>{if(!account){location.href='/api/account/sign-in';return}message('Your profile',[account.user.name,account.user.email||'']);const summary=el('div','','profile-editor-summary'),avatar=el('span','','profile-editor-avatar');if(account.user.imageUrl){const image=document.createElement('img');image.src=account.user.imageUrl;image.alt='Your profile photo';avatar.append(image)}else avatar.textContent=account.user.name[0].toUpperCase();const edit=el('a','Edit photo & profile','button primary');edit.href='/dashboard/account/';edit.append(makeIcon('pencil'));summary.append(avatar,edit);$('#dialog-body').prepend(summary);$('#dialog-body').append(el('p','Update your photo, name, and email in account settings. Your dashboard refreshes when you return.'));const out=el('button','Sign out','button tonal signout-button');out.prepend(makeIcon('log-out'));out.addEventListener('click',async()=>{startNavigation('Signing out…',out);try{await api('/sign-out','POST')}finally{try{await window.Clerk?.signOut()}finally{location.href='/'}}});const deletion=el('a','Request account & data deletion','button deletion-request');deletion.href='mailto:support@sessionstream.app?subject='+encodeURIComponent('Account and data deletion request')+'&body='+encodeURIComponent('Please review deletion of my SessionStream account and data. Account ID: '+account.user.id+'\nPlease confirm how any existing subscription will be handled.');$('#dialog-body').append(deletion,el('p','Have a question? support@sessionstream.app'),out)},metrics:()=>message('What gets counted?',['Time streaming is time your signed-in plugin spends sending audio.','Listener hours add everyone’s listening time together. Two listeners for one hour count as two listener hours.','Data sent is an estimate based on stream quality and listener count, not a charge. Only account-linked activity is included; no audio is recorded.'])};
document.querySelectorAll('[data-dialog]').forEach(button=>button.addEventListener('click',()=>actions[button.dataset.dialog]?.(button)));
document.querySelectorAll('.dialog-close,#dialog-done').forEach(button=>button.addEventListener('click',()=>closeDialog()));
document.querySelectorAll('[data-period]').forEach(button=>{button.setAttribute('aria-pressed',String(button.classList.contains('selected')));button.addEventListener('click',()=>{period=button.dataset.period;document.querySelectorAll('[data-period]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button))});renderUsage()})});
$('#theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('sessionstream-theme',theme)}catch{}$('#theme').setAttribute('aria-label',theme==='dark'?'Switch to light mode':'Switch to dark mode')});
void load();setInterval(()=>{if(account&&!document.hidden)void load()},30000);

window.addEventListener('focus',()=>{if(account)void load()});

window.addEventListener('pageshow',event=>{if(event.persisted)void load({block:true})});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&account)void load()});
