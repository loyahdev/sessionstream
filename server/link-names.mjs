const reserved=new Set(['dashboard','billing','download','privacy','terms','health','api','auth','v1','listen','studio','assets','fonts','downloads','docs','web','websrc','sign-in','sign-up','account','accounts','favicon','index','robots','sitemap','signal','maintenance','resolve']);
export const normalizeName=value=>typeof value==='string'?value.trim().toLowerCase():'';
export const validName=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{2,31}$/.test(value)&&!reserved.has(value)&&!value.endsWith('-');
export const validShare=value=>/^\d{6}$/.test(value)||validName(value);
export function sharePrefix(path){const value=path.split('/')[1];return validShare(value)?`/${value}`:'';}
