import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAudioEngine} from '../web/audio.mjs';
test('audio engine retries once with a fresh module URL',async()=>{
 const urls=[];await loadAudioEngine({async addModule(url){urls.push(url);if(urls.length===1)throw Error('Importing a module script failed');}});
 assert.deepEqual(urls,['/pcm-worklet.mjs','/pcm-worklet.mjs?retry=1']);
});
test('persistent failure gives useful wording and bounded retries',async()=>{
 let attempts=0;await assert.rejects(loadAudioEngine({async addModule(){attempts++;throw Error('private-host-token');}}),e=>e.message.includes('reload this page')&&!e.message.includes('private-host-token'));
 assert.equal(attempts,2);
});
test('missing worklet explains browser and HTTPS requirements',async()=>{
 await assert.rejects(loadAudioEngine(undefined),/modern browser.*HTTPS/);
});
