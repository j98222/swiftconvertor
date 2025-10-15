// tools/validator/runValidator.js
// Usage: node tools/validator/runValidator.js <xmlPath> <xsdPath>
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

if (process.argv.length < 4) {
  console.error('Usage: node tools/validator/runValidator.js <xmlPath> <xsdPath>');
  process.exit(2);
}

const xmlPath = path.resolve(process.argv[2]);
const xsdPath = path.resolve(process.argv[3]);

if (!fs.existsSync(xmlPath)) { console.error('XML file not found:', xmlPath); process.exit(2); }
if (!fs.existsSync(xsdPath)) { console.error('XSD file not found:', xsdPath); process.exit(2); }

// We'll run the Docker image and mount the current project so xmllint can access files
const args = [
  'run', '--rm',
  '-v', `${process.cwd()}:/work`,
  'swiftconvertor-validator',
  '--noout', '--schema', `/work/${path.relative(process.cwd(), xsdPath).replace(/\\/g,'/')}`,
  `/work/${path.relative(process.cwd(), xmlPath).replace(/\\/g,'/')}`
];

console.log('Running: docker', args.join(' '));
const p = spawn('docker', args, { stdio: 'inherit' });

p.on('close', (code) => {
  process.exit(code);
});
