import test from 'node:test';
import assert from 'node:assert/strict';
import {accountResultPage,pluginSignInURL} from '../server/account-pages.mjs';
import {pluginAuthorization} from '../websrc/auth/plugin-flow.js';
const authorization=()=>{const u=new URL('https://clerk.sessionstream.app/oauth/authorize');u.search=new URLSearchParams({client_id:'pc8es4va5qJsFDVW',response_type:'code',redirect_uri:'http://127.0.0.1:8788/auth/callback',scope:'profile offline_access',state:'a'.repeat(43),code_challenge:'b'.repeat(43),code_challenge_method:'S256'});return u;};
test('branded login preserves the exact existing Clerk PKCE authorization',()=>{
 const original=authorization().href,landing=new URL(pluginSignInURL(original));
 assert.equal(landing.origin,'https://sessionstream.app');assert.equal(landing.pathname,'/sign-in/');assert.equal(landing.hash,'');
 assert.equal(pluginAuthorization('#plugin='+encodeURIComponent(landing.searchParams.get('plugin'))),original);assert.equal(pluginAuthorization('#/sign-in'),null);
 assert.equal(pluginSignInURL('https://example.clerk.accounts.dev/oauth/authorize?state=abc'),'https://example.clerk.accounts.dev/oauth/authorize?state=abc');
});
test('plugin login cannot redirect to other websites or arbitrary local endpoints',()=>{
 const mutations=[u=>u.hostname='evil.example',u=>u.username='evil',u=>u.pathname='/other',u=>u.searchParams.set('client_id','other'),u=>u.searchParams.set('scope','admin'),u=>u.searchParams.set('code_challenge_method','plain'),u=>u.searchParams.set('state','short'),u=>u.searchParams.append('state','x'),u=>u.searchParams.set('redirect_uri','https://evil.example/auth/callback'),u=>u.searchParams.set('redirect_uri','http://127.0.0.1:8788/other'),u=>u.searchParams.set('redirect_uri','http://127.0.0.1:8788/auth/callback?foo=1'),u=>u.searchParams.set('redirect_uri','http://localhost:8788/auth/callback')];
 for(const mutate of mutations){const u=authorization();mutate(u);assert.throws(()=>pluginAuthorization('#plugin='+encodeURIComponent(u.href)));}
 assert.throws(()=>pluginAuthorization('#plugin=%'));assert.throws(()=>pluginAuthorization('#plugin=https://evil.example'));
});
test('success and cancellation pages use matching branding and no private identity or tokens',()=>{
 for(const ok of [true,false]){const html=accountResultPage(ok);assert(html.includes('Session<br>stream'));assert(html.includes('studio-session.webp'));assert(html.includes('--violet:'));assert(html.includes('Manrope'));assert(html.includes('prefers-color-scheme:dark'));assert(html.includes('https://sessionstream.app/privacy/'));assert(!html.includes('<script'));assert(!html.includes('access_token'));assert(html.includes(ok?"You're signed in.":"Sign-in incomplete."));}
});

test('expired confirmation is neutral about the current plugin sign-in',()=>{const html=accountResultPage(false,{expired:true});assert(html.includes('Confirmation expired.'));assert(html.includes('This page does not change your sign-in.'));assert(!html.includes('Sign-in was cancelled'));});
