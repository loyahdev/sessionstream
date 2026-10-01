// Export only project source; installed dependencies and local state stay private.
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid package.json version');
// Source and installer filenames use the manifest display version.
const version = manifest.version.replace(/\.0$/, '');
const files = ['.gitignore', '.nvmrc', 'CMakeLists.txt', 'LICENSE', 'README.md', 'package.json', 'package-lock.json', 'version.txt'];
const directories = ['docs', 'installer', 'plugin', 'scripts', 'server', 'tests', 'web'];
const scratch = await mkdtemp(path.join(tmpdir(), 'sessionstream-source-'));
const destination = path.join(scratch, 'SessionStream');
const artifacts = path.join(root, 'artifacts');
const archive = path.join(artifacts, `SessionStream-${version}-source.zip`);
const excluded = name => name === '.DS_Store' || name.startsWith('._') || name === '__MACOSX' ||
  name === 'node_modules' || name === '.env' || (name.startsWith('.env.') && name !== '.env.example') ||
  /\.(log|swp|swo|tgz)$/.test(name);

async function copy(relative) {
  const source = path.join(root, relative);
  const target = path.join(destination, relative);
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Source archive refuses symlink: ${relative}`);
  if (stat.isDirectory()) {
    await mkdir(target, {recursive:true});
    for (const name of (await readdir(source)).sort()) {
      if (!excluded(name)) await copy(path.join(relative, name));
    }
  } else {
    await cp(source, target);
  }
}

try {
  await mkdir(destination);
  for (const relative of [...files, ...directories]) await copy(relative);
  // Include future GitHub workflows without exporting a local .git repository.
  try { await lstat(path.join(root, '.github')); await copy('.github'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(artifacts, {recursive:true});
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', destination, archive]);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
  console.log(`Source archive: ${archive}`);
  console.log(`SHA-256: ${digest}`);
} finally {
  await rm(scratch, {recursive:true, force:true});
}
