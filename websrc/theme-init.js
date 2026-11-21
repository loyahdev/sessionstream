try{
 const saved=localStorage.getItem('sessionstream-theme');
 const fallback=document.documentElement.dataset.site==='home'?'light':matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
 document.documentElement.dataset.theme=saved==='light'||saved==='dark'?saved:fallback;
}catch{
 document.documentElement.dataset.theme='light';
}
