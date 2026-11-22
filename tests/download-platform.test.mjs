import test from 'node:test';
import assert from 'node:assert/strict';
import {detectDownloadPlatform} from '../websrc/download-platform.js';
for(const [name,input,expected] of [
 ['Windows desktop',{platform:'Win32',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},'windows'],
 ['Windows client hints',{platform:'Windows'},'windows'],
 ['macOS desktop',{platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'},'mac'],
 ['macOS client hints',{platform:'macOS'},'mac'],
 ['iPad desktop mode',{platform:'MacIntel',maxTouchPoints:5,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)'},null],
 ['iPhone',{platform:'iPhone',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18)'},null],
 ['Android',{platform:'Linux armv8l',userAgent:'Mozilla/5.0 (Linux; Android 16)'},null],
 ['Linux',{platform:'Linux x86_64',userAgent:'Mozilla/5.0 (X11; Linux x86_64)'},null],
 ['ChromeOS',{platform:'Linux',userAgent:'Mozilla/5.0 (X11; CrOS x86_64)'},null],
 ['unknown',{},null]
])test(name,()=>assert.equal(detectDownloadPlatform(input),expected));
