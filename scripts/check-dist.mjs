import { access, readFile } from 'node:fs/promises';

const requiredFiles = ['dist/plugin.json', 'dist/plugin.min.js', 'dist/screenshot.jpg'];
await Promise.all(requiredFiles.map(file => access(file)));

const [pkg, plugin] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('dist/plugin.json', 'utf8').then(JSON.parse),
]);

for (const field of ['name', 'version']) {
    if (pkg[field] !== plugin[field]) {
        throw new Error(`${field} differs between package.json and dist/plugin.json`);
    }
}

const metadata = JSON.stringify(plugin);
if (/Tu Nombre|tu-usuario/.test(metadata)) {
    throw new Error('Placeholder metadata remains in dist/plugin.json');
}

console.log(`Validated ${plugin.name}@${plugin.version}`);
