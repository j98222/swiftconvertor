const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const port = process.env.PORT || 3001;

app.use(bodyParser.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', now: new Date().toISOString() }));

// POST JSON: { xml: '<...>', xsd: 'pacs.009.001.06.xsd' }
app.post('/validate', async (req, res) => {
  try {
    const { xml, xsd } = req.body || {};
    if (!xml || !xsd) return res.status(400).json({ error: 'body must include xml and xsd (filename under /xsds)' });

    const xsdsDir = '/xsds';
    const xsdPath = path.join(xsdsDir, path.basename(xsd));
    if (!fs.existsSync(xsdPath)) return res.status(400).json({ error: 'xsd not found on server', xsd: path.basename(xsd) });

    const tmpFile = path.join('/tmp', `in-${Date.now()}.xml`);
    fs.writeFileSync(tmpFile, xml, 'utf8');

    const args = ['--noout', '--schema', xsdPath, tmpFile];
    const child = spawn('xmllint', args);

    let stderr = '';
    child.stderr.on('data', d => stderr += d.toString());

    child.on('close', (code) => {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      if (code === 0) return res.json({ valid: true });
      return res.status(422).json({ valid: false, errors: stderr.trim() });
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => console.log(`Validator API listening on ${port}`));
