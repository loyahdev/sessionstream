import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const needsLegacyUpgrade = status => !!status?.native && !status.live
  && (!status.engineProtocol || !(status.controlProtocol >= 3));

// Upgrade old idle helpers that predate lifecycle leases or protected invites. Never retire an
// active broadcast, an unrelated process, or a process belonging to another user.
export async function retireLegacyHelper(port) {
  // Only old macOS releases used this lifecycle protocol and bundle layout.
  if(process.platform!=='darwin')return;
  const url = `http://127.0.0.1:${port}/api/studio`;
  const read = async () => {
    const response = await fetch(url, {signal:AbortSignal.timeout(1000)});
    return response.ok ? response.json() : null;
  };
  let original;
  try { original = await read(); } catch { return; }
  if (!needsLegacyUpgrade(original)) return;
  let output;
  try { ({stdout:output} = await exec('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {timeout:2000})); }
  catch { return; }
  const expected = /(?:^|\/)SessionStream\.(?:vst3|component|app)(?:\.backup-[^/ ]+)?\/Contents\/Resources\/runtime\/bin\/node\s+--expose-gc\s+.+\/scripts\/companion\.mjs(?:\s|$)/;
  const command = async pid => {
    try {
      const {stdout} = await exec('/bin/ps', ['-p', String(pid), '-o', 'uid=,command='], {timeout:1000});
      const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
      return match && Number(match[1]) === process.getuid() && expected.test(match[2]) ? match[2] : null;
    } catch { return null; }
  };
  for (const text of output.trim().split(/\s+/)) {
    const pid = Number(text);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
    const initialCommand = await command(pid);
    if (!initialCommand) continue;
    let latest;
    try { latest = await read(); } catch { return; }
    if (!needsLegacyUpgrade(latest) || latest.token !== original.token) return;
    try { process.kill(pid, 'SIGTERM'); } catch { continue; }
    for (let attempt=0; attempt<30 && await command(pid) === initialCommand; attempt++) await sleep(100);
    if (await command(pid) === initialCommand) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    console.log('Retired idle legacy SessionStream helper.');
  }
}
