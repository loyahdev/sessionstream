import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const runtime=process.argv[2]||'build/SessionStream_artefacts/Release/VST3/SessionStream.vst3/Contents/Resources/runtime';
const controller=spawn('./build/controller-probe',[path.resolve(runtime),'http://127.0.0.1:9898','--verify-link'],{
  env:{...process.env,PORT:'9897',STUDIO_PORT:'9898',UDP_PORT:'49302',SESSIONSTREAM_STATE_DIR:'/private/tmp/sessionstream-cold-start-validation'},stdio:['pipe','pipe','pipe']
});
let output='',settled=false;let resolveInvite,rejectInvite;
const inviteReady=new Promise((resolve,reject)=>{resolveInvite=resolve;rejectInvite=reject;});
controller.stdout.on('data',b=>{output+=b;process.stdout.write(b);const match=output.match(/INVITE: (https:\/\/[^\s]+)/);if(match&&!settled){settled=true;resolveInvite(match[1]);}});
controller.stderr.on('data',b=>process.stderr.write(b));
const exit=new Promise(resolve=>controller.on('exit',(code,signal)=>{if(!settled)rejectInvite(Error(`Controller exited ${code}/${signal}`));resolve({code,signal});}));
const timeout=setTimeout(()=>{rejectInvite(Error('Cold startup timed out'));controller.kill('SIGTERM');},115000);
let browser;
try{
 const invite=await inviteReady;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(invite,{timeout:30000});assert.equal(await page.title(),'SessionStream — listen in');
 assert.equal(await page.locator('#volume').inputValue(),'1');await page.locator('#connect').click();
 await page.waitForFunction(()=>document.querySelector('#message').textContent==='Audio will start when your host is ready.',null,{timeout:15000});
 assert.deepEqual(errors,[]);await page.locator('#connect').click();await browser.close();browser=null;
 console.log('PASS: first cold-start invite loads in Chrome and joins its current private room through the public tunnel');
 controller.stdin.end('verified\n');const result=await exit;assert.equal(result.code,0,`Controller terminated ${result.signal}`);
 console.log('PASS: controller shutdown completes normally');
}finally{clearTimeout(timeout);if(browser)await browser.close();if(controller.exitCode===null)controller.kill('SIGTERM');}
