import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {expiredPage} from '../server/expired-page.mjs';
test('ended page removes the stale marker without navigating, so a custom link can be reloaded',async()=>{
 const response=expiredPage(),html=await response.text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 assert.equal(response.status,410);assert(html.includes('href="?">Try again'));
 assert(response.headers.get('Content-Security-Policy').includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));
 let replaced=null;vm.runInNewContext(script,{URL,location:{href:'https://sessionstream.app/studio-room?expired=1#old-invite'},history:{replaceState:(_state,_title,url)=>{replaced=url;}}});
 assert.equal(replaced,'/studio-room');
 replaced=null;vm.runInNewContext(script,{URL,location:{href:'https://sessionstream.app/studio-room'},history:{replaceState:()=>{replaced=true;}}});assert.equal(replaced,null);
});
