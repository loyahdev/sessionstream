// Browser platform is a recommendation, never a compatibility guarantee.
export function detectDownloadPlatform({platform='',userAgent='',maxTouchPoints=0}={}){
 const value=String(platform),ua=String(userAgent);
 if(/iPhone|iPad|iPod|Android|CrOS/i.test(ua)||(/Mac/i.test(value)&&maxTouchPoints>1))return null;
 if(/Win/i.test(value)||/Windows/i.test(ua))return 'windows';
 if(/Mac/i.test(value)||/Macintosh|Mac OS X/i.test(ua))return 'mac';
 return null;
}
