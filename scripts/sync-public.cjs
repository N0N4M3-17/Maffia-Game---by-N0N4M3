const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '..', 'src', 'main', 'resources', 'public');
const vendor = path.join(source, 'vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(require.resolve('lucide/dist/umd/lucide.min.js'), path.join(vendor, 'lucide.js'));
fs.copyFileSync(path.join(path.dirname(require.resolve('lucide/package.json')), 'LICENSE'), path.join(vendor, 'lucide-LICENSE'));
function mirror(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (item.isDirectory()) mirror(path.join(from, item.name), path.join(to, item.name));
    else fs.copyFileSync(path.join(from, item.name), path.join(to, item.name));
  }
}
mirror(source, path.join(__dirname, '..', 'public'));
console.log('Local assets and public mirrors synchronized.');
