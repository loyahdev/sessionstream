let bar,status,message;
const pending=new Map();
const originals=new Map();
function ensureStatus(){
 if(status)return;
 bar=document.createElement('div');bar.className='ss-navigation-progress';bar.setAttribute('aria-hidden','true');bar.hidden=true;
 status=document.createElement('div');status.className='ss-navigation-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
 const spinner=document.createElement('span');spinner.className='ss-nav-spinner';spinner.setAttribute('aria-hidden','true');message=document.createElement('span');status.append(spinner,message);document.body.append(bar,status);
}
function restoreSource(source,saved){source.replaceChildren(...saved.children);if('disabled' in source)source.disabled=saved.disabled;if(saved.busy===null)source.removeAttribute('aria-busy');else source.setAttribute('aria-busy',saved.busy);source.classList.remove('ss-navigation-source');originals.delete(source)}
function refreshStatus(){const latest=[...pending.values()].at(-1);if(latest){message.textContent=latest.label;status.hidden=false;bar.hidden=false}else{if(status)status.hidden=true;if(bar)bar.hidden=true}}
export function clearNavigation(){pending.clear();for(const [source,saved] of originals)restoreSource(source,saved);refreshStatus()}

export function startNavigation(label='Opening page…',source){
 ensureStatus();const token=Symbol();pending.set(token,{label});refreshStatus();
 if(source){if(!originals.has(source))originals.set(source,{children:[...source.childNodes],disabled:source.disabled,busy:source.getAttribute('aria-busy')});originals.get(source).token=token;const hadText=originals.get(source).children.some(node=>node.textContent.trim());const spinner=document.createElement('span');spinner.className='ss-nav-spinner';spinner.setAttribute('aria-hidden','true');const original=document.createElement('span');original.hidden=true;original.append(...originals.get(source).children);source.replaceChildren(original,spinner);if(hadText)source.append(document.createTextNode(label));if('disabled' in source)source.disabled=true;source.setAttribute('aria-busy','true');source.classList.add('ss-navigation-source');}
 return ()=>{pending.delete(token);const saved=source&&originals.get(source);if(saved?.token===token)restoreSource(source,saved);refreshStatus()};
}
export function navigationLabel(path){if(path.startsWith('/dashboard/account/billing'))return 'Opening billing…';if(path.startsWith('/dashboard/account'))return 'Opening account settings…';if(path.startsWith('/dashboard/billing'))return 'Opening checkout…';if(path.startsWith('/dashboard'))return 'Opening dashboard…';if(/sign-(in|up)/.test(path))return 'Opening sign-in…';return 'Opening page…'}
export function navigate(url,label,source){startNavigation(label||navigationLabel(new URL(url,location.href).pathname),source);location.assign(url)}
document.addEventListener('click',event=>{
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const link=event.target.closest?.('a[href]');if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
 const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.protocol!==location.protocol)return;
 if(url.pathname===location.pathname&&url.search===location.search)return;
 if(link.getAttribute('aria-busy')==='true'){event.preventDefault();return}
 startNavigation(navigationLabel(url.pathname),link);
},true);
window.addEventListener('pageshow',clearNavigation);
