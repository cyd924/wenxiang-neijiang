// Regenerate the API deployment's fallback assets whenever web/ changes.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const file = path.join(__dirname, 'worker.js');
let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('const STATIC='), end = source.indexOf('export default', start);
if (start < 0 || end < 0) throw new Error('Static asset placeholders are missing');
const asset = name => fs.readFileSync(path.join(root,'web',name),'utf8');
source = source.slice(0,start) + 'const STATIC=' + JSON.stringify({index:asset('index.html'),js:asset('app.js'),css:asset('styles.css')}) + ';\n' + source.slice(end);
fs.writeFileSync(file,source);
