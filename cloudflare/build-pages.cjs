// Build a single-file Pages entry from the same API and fresh web assets.
// This alternate deployment serves assets from the bundle and never redirects
// requests to workers.dev, so its API stays on the pages.dev origin too.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'work', 'pages');
const booking = fs.readFileSync(path.join(__dirname, 'booking.js'), 'utf8').replace(/^export /gm, '');
const assistant = fs.readFileSync(path.join(__dirname, 'assistant.mjs'), 'utf8').replace(/^export /gm, '');
let worker = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
worker = worker.replace(/^import .* from '\.\/booking\.js';\r?\n/m, '');
worker = worker.replace(/^import .* from '\.\/assistant\.mjs';\r?\n/m, '');
const start = worker.indexOf('const STATIC='), end = worker.indexOf('export default', start);
if (start < 0 || end < 0) throw new Error('Missing Worker static asset marker');
const assets = {};
for (const [key, name] of Object.entries({index:'index.html', js:'app.js', css:'styles.css'})) {
  assets[key] = fs.readFileSync(path.join(root, 'web', name), 'utf8');
}
worker = worker.slice(0, start) + 'const STATIC=' + JSON.stringify(assets) + ';\n' + worker.slice(end);
const assetsCall = 'if(env.ASSETS)return env.ASSETS.fetch(request);';
if (!worker.includes(assetsCall)) throw new Error('Worker asset routing has changed; review Pages build');
worker = worker.replace(assetsCall, '');
fs.mkdirSync(out, {recursive:true});
fs.writeFileSync(path.join(out, '_worker.js'), booking + '\n' + assistant + '\n' + worker);
console.log('Pages entry created: work/pages/_worker.js');
