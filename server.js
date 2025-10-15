"use strict";

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// fetch polyfill for older Node versions (Node 18+ has global fetch)
if (typeof fetch === 'undefined') {
  try { global.fetch = require('undici').fetch; } catch (e) { /* undici not available, validator calls may fail */ }
}

// Configuration constants for DataPDU Message fields
const SENDER_CODE = 'AAAAAAAAXXX';
const SENDER_DN = 'ou=xxx,o=aaaaaaa9,o=swift';

// Middleware
app.use(cors());
app.use(express.json({ limit: '128kb' }));
// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Ensure root serves index.html (fallback)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Helpers
function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSwiftDateTime(d) {
  const iso = (d || new Date()).toISOString();
  // Trim fractional seconds to seconds precision (keep trailing Z)
  return iso.replace(/\.\d+Z$/, 'Z');
}

function generateUniqueId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.-]/g, '').replace(/Z$/, 'Z');
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `MSG-${ts}-${rand}`;
}

function normalizeFormat(input) {
  if (!input) return '009';
  const s = String(input).toLowerCase().replace(/^pacs\.?/, '');
  if (s.startsWith('008')) return '008';
  return '009';
}

function bicSafe(bic) {
  if (!bic) return '';
  return String(bic).toUpperCase();
}

function buildHeader(values, defaultMsgDef) {
  const msgDef = escapeXml(values.msgDefIdr || defaultMsgDef);
  const creDt = escapeXml(values._creDt || formatSwiftDateTime());
  const bizSvc = 'paymentsca.lynx.03';
  const fromBIC = escapeXml(bicSafe(values.fromBIC));
  const toBIC = escapeXml(bicSafe(values.toBIC));
  const bizMsgId = escapeXml(values.bizMsgIdr || values._uniqueId || generateUniqueId());

  const saaHeader = [
    '<SAAHeader>',
    `  <MessageIdentifier>${escapeXml(values.messageIdentifier || '')}</MessageIdentifier>`,
    '</SAAHeader>',
  ].join('\n');

  const networkInfo = [
    '<NetworkInfo>',
    `  <RequestType>${escapeXml(values.requestType || '')}</RequestType>`,
    '</NetworkInfo>',
  ].join('\n');

  const appHdr = [
    '<AppHdr xmlns="urn:iso:std:iso:20022:tech:xsd:head.001.001.01">',
    `  <MsgDefIdr>${msgDef}</MsgDefIdr>`,
    `  <BizMsgIdr>${bizMsgId}</BizMsgIdr>`,
    `  <CreDt>${creDt}</CreDt>`,
    `  <BizSvc>${bizSvc}</BizSvc>`,
    `  <Fr><FIId><FINInstnId><BICFI>${fromBIC}</BICFI></FINInstnId></FIId></Fr>`,
    `  <To><FIId><FINInstnId><BICFI>${toBIC}</BICFI></FINInstnId></FIId></To>`,
    '</AppHdr>',
  ].join('\n');

  return { headerXml: [saaHeader, networkInfo].join('\n'), appHdrXml: appHdr, bizMsgId };
}

function buildPacsBody(values, tagName) {
  // Build FinInstnId XML (BIC, Name, Postal Address)
  function finInstnIdXml(prefix, obj) {
    if(!obj) obj = {};
    const parts = [];
      // For FinInstnId (used in agent elements and also Debtor/Creditor when requested)
      // includeParty flag enables emitting Nm and PstlAdr inside FinInstnId (required for BranchAndFinancialInstitutionIdentification6)
      parts.push(`${prefix}<FinInstnId>`);
      if (obj.bic) parts.push(`  <BICFI>${escapeXml(obj.bic)}</BICFI>`);
      if (obj.name && obj._includeParty) {
        parts.push(`  <Nm>${escapeXml(obj.name)}</Nm>`);
      }
      // Postal address when requested
      const a = obj.address || {};
      if (obj._includeParty && a && (a.department || a.streetName || a.buildingNumber || a.city || a.province || a.postalCode)) {
        parts.push('  <PstlAdr>');
        const lines = [];
        if (a.department) lines.push(escapeXml(a.department));
        const street = [a.streetName, a.buildingNumber].filter(Boolean).join(' ').trim();
        if (street) lines.push(escapeXml(street));
        if (a.city) lines.push(escapeXml(a.city));
        if (a.province) lines.push(escapeXml(a.province));
        if (a.postalCode) lines.push(escapeXml(a.postalCode));
        lines.forEach(l => parts.push(`    <AdrLine>${l}</AdrLine>`));
        parts.push('  </PstlAdr>');
      }
      parts.push(`${prefix}</FinInstnId>`);
    return parts.join('\n');
  }


  function accountXml(prefix, acc) {
    if(!acc) acc = {};
    const parts = [];
    parts.push(`${prefix}<Id>`);
  if (acc.iban) parts.push(`  <IBAN>${escapeXml(acc.iban)}</IBAN>`);
  // omit Othr by default to avoid schema mismatch; include only IBAN when present
    parts.push('</Id>');
    return parts.join('\n');
  }

  // Map common fields according to Mapping.csv
  const amt = values.amount || '';
  const stlDate = values.settlementDate || '';
  const rmt = values.remittanceInfo || '';
  const sttlmMtd = values.requestType || '';
  // map requested settlement method to allowed enumeration used by the XSD
  const allowedSttlm = ['INDA','INGA','COVE','CLRG','TDSO','TDSA'];
  const sttlmCode = allowedSttlm.includes(sttlmMtd) ? sttlmMtd : 'CLRG';
  const uniqueId = escapeXml(values._uniqueId || values.bizMsgIdr || generateUniqueId());
  const creDt = escapeXml(values._creDt || formatSwiftDateTime());

  const inter1 = values.intermediaryAgent1 || {};
  const inter2 = values.intermediaryAgent2 || {};
  const dbtrAgt = values.debtorAgent || {};
  const dbtr = values.debtor || {};
  const cdtrAgt = values.creditorAgent || {};
  const cdtr = values.creditor || {};

  const lines = [];
  // ISO20022 payload: Document should contain FICdtTrf directly (no Pacs008/Pacs009 wrapper)
  lines.push('    <FICdtTrf>');
  lines.push('        <GrpHdr>');
  lines.push(`          <MsgId>${uniqueId}</MsgId>`);
  lines.push(`          <CreDtTm>${creDt}</CreDtTm>`);
  lines.push('          <NbOfTxs>1</NbOfTxs>');
  lines.push('          <SttlmInf>');
  lines.push(`            <SttlmMtd>${escapeXml(sttlmCode)}</SttlmMtd>`);
  lines.push('            <ClrSys>');
  lines.push('              <Cd>LYX</Cd>');
  lines.push('            </ClrSys>');
  // If this is a pacs.008 message and charge bearer present, include ChrgBr
  if (tagName === 'Pacs008' && values && values.chargeBearer) {
    lines.push(`            <ChrgBr>${escapeXml(values.chargeBearer)}</ChrgBr>`);
  }
  lines.push('          </SttlmInf>');
  lines.push('        </GrpHdr>');
  lines.push('        <CdtTrfTxInf>');
  // Payment identifier required by schema: include EndToEndId only
  lines.push('          <PmtId>');
  lines.push(`            <EndToEndId>${uniqueId}</EndToEndId>`);
  lines.push('          </PmtId>');
  lines.push(`          <IntrBkSttlmAmt Ccy="CAD">${escapeXml(amt)}</IntrBkSttlmAmt>`);
  if (stlDate) lines.push(`          <IntrBkSttlmDt>${escapeXml(stlDate)}</IntrBkSttlmDt>`);

  // Intermediary Agent 1
  lines.push('          <IntrmyAgt1>');
  lines.push(finInstnIdXml('            ', inter1));
  lines.push('          </IntrmyAgt1>');
  // Intermediary Agent 1 Account
  lines.push('          <IntrmyAgt1Acct>');
  lines.push(accountXml('            ', inter1.account));
  lines.push('          </IntrmyAgt1Acct>');

  // Intermediary Agent 2
  lines.push('          <IntrmyAgt2>');
  lines.push(finInstnIdXml('            ', inter2));
  lines.push('          </IntrmyAgt2>');
  lines.push('          <IntrmyAgt2Acct>');
  lines.push(accountXml('            ', inter2.account));
  lines.push('          </IntrmyAgt2Acct>');

  // Debtor (party) comes before Debtor Agent in the sequence required by the XSD
  lines.push('          <Dbtr>');
  // use FinInstnId with party info for Debtor to match BranchAndFinancialInstitutionIdentification6
  dbtr._includeParty = true;
  lines.push(finInstnIdXml('            ', dbtr));
  lines.push('          </Dbtr>');
  lines.push('          <DbtrAcct>');
  lines.push(accountXml('            ', dbtr.account));
  lines.push('          </DbtrAcct>');

  // Debtor Agent
  lines.push('          <DbtrAgt>');
  lines.push(finInstnIdXml('            ', dbtrAgt));
  lines.push('          </DbtrAgt>');
  lines.push('          <DbtrAgtAcct>');
  lines.push(accountXml('            ', dbtrAgt.account));
  lines.push('          </DbtrAgtAcct>');

  // Creditor Agent
  lines.push('          <CdtrAgt>');
  lines.push(finInstnIdXml('            ', cdtrAgt));
  lines.push('          </CdtrAgt>');
  lines.push('          <CdtrAgtAcct>');
  lines.push(accountXml('            ', cdtrAgt.account));
  lines.push('          </CdtrAgtAcct>');

  // Creditor
  lines.push('          <Cdtr>');
  cdtr._includeParty = true;
  lines.push(finInstnIdXml('            ', cdtr));
  lines.push('          </Cdtr>');
  lines.push('          <CdtrAcct>');
  lines.push(accountXml('            ', cdtr.account));
  lines.push('          </CdtrAcct>');

  // Remittance
  if (rmt) {
    lines.push(`          <RmtInf>`);
    lines.push(`            <Ustrd>${escapeXml(rmt)}</Ustrd>`);
    lines.push(`          </RmtInf>`);
  }

  lines.push('        </CdtTrfTxInf>');
  lines.push('      </FICdtTrf>');

  return lines.join('\n');
}

// removed legacy quick-build; use buildPacsDocument + buildDataPDU for proper envelope

function buildPacsDocument(values, tagName) {
  const body = buildPacsBody(values, tagName);
  // Document with appropriate namespace
  // Use ISO 20022 namespaces for pacs messages
  // Use the 001.09 namespaces which match the XSD files present in app/xsds
  const ns = tagName === 'Pacs009' ? 'urn:iso:std:iso:20022:tech:xsd:pacs.009.001.09' : 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.09';
  return `<Document xmlns="${ns}">\n${body}\n</Document>`;
}

function buildDataPDU(headerInnerXml, appHdrXml, documentXml, fmt, bizMsgId) {
  // Swift-standard DataPDU layout: Revision, Header (SAAHeader+NetworkInfo+Message), Body (AppHdr + Document), LAU
  const revision = '<Revision>2.0.14</Revision>';

  // Build Message node under Header per request
  const senderReference = `${SENDER_CODE}$${escapeXml(bizMsgId || '')}`;
  // align MessageIdentifier with local XSD versions
  const messageIdentifier = fmt === '009' ? 'pacs.009.001.09' : 'pacs.008.001.09';
  const message = [
    '<Message>',
    `  <SenderReference>${escapeXml(senderReference)}</SenderReference>`,
    `  <MessageIdentifier>${messageIdentifier}</MessageIdentifier>`,
  '  <Format>MX</Format>',
  '  <NetworkInfo>',
  '    <Service>paymentscanada.lynx</Service>',
  '    <SWIFTNetNetworkInfo>',
  `      <RequestType>${escapeXml(messageIdentifier)}</RequestType>`,
  '      <RequestSubtype>paymentsca.lynx.00</RequestSubtype>',
  '    </SWIFTNetNetworkInfo>',
  '  </NetworkInfo>',
    '  <Sender>',
    `    <DN>${escapeXml(SENDER_DN)}</DN>`,
    '    <FullName>',
    `      <X1>${escapeXml(SENDER_CODE)}</X1>`,
    '    </FullName>',
    '  </Sender>',
    '  <Receiver>',
    `    <DN>${escapeXml(SENDER_DN)}</DN>`,
    '    <FullName>',
    `      <X1>${escapeXml(SENDER_CODE)}</X1>`,
    '    </FullName>',
    '  </Receiver>',
    '  <InterfaceInfo>',
    `    <UserReference>${escapeXml(bizMsgId || '')}</UserReference>`,
    '  </InterfaceInfo>',
    '</Message>'
  ].join('\n');

  const header = ['<Header>', headerInnerXml || '', message, '</Header>'].join('\n');
  const body = ['<Body>', appHdrXml || '', documentXml || '', '</Body>'].join('\n');
  const lau = '<LAU></LAU>'; // placeholder for signing/LAU

  return ['<?xml version="1.0" encoding="UTF-8"?>', '<DataPDU xmlns="urn:swift:saa:xsd:saa.2.0">', revision, header, body, lau, '</DataPDU>'].join('\n');
}

function buildPacs009(values) {
  const parts = buildHeader(values, 'pacs.009.001.09');
  const doc = buildPacsDocument(values, 'Pacs009');
  return buildDataPDU(parts.headerXml, parts.appHdrXml, doc, '009', parts.bizMsgId);
}

function buildPacs008(values) {
  const parts = buildHeader(values, 'pacs.008.001.09');
  const doc = buildPacsDocument(values, 'Pacs008');
  return buildDataPDU(parts.headerXml, parts.appHdrXml, doc, '008', parts.bizMsgId);
}

app.get('/health', (req, res) => res.json({ status: 'ok', now: formatSwiftDateTime() }));

app.post('/convert', async (req, res) => {
  const body = req.body || {};
  // Allow client to pass either messageFormat or paymentType to select 008/009
  const requested = body.messageFormat || body.paymentType || body.format || '009';
  const fmt = normalizeFormat(requested);

  // Server-side validation
  const errors = [];

  function isValidBIC(b) {
    if (!b) return true; // empty allowed if not provided
    const s = String(b).toUpperCase();
    // SWIFT BIC/BIC8/BIC11 pattern
    const re = /^[A-Z]{4}[A-Z]{2}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/;
    return re.test(s);
  }

  function ibanChecksum(iban) {
    if(!iban) return false;
    const s = String(iban).replace(/\s+/g,'').toUpperCase();
    if (!/^[A-Z]{2}[0-9A-Z]{14,30}$/.test(s)) return false;
    // move first four to the end
    const rearr = s.slice(4) + s.slice(0,4);
    // convert letters to numbers (A=10..Z=35)
    let converted = '';
    for (let i = 0; i < rearr.length; i++) {
      const ch = rearr.charAt(i);
      if (ch >= '0' && ch <= '9') converted += ch;
      else converted += (ch.charCodeAt(0) - 55).toString();
    }
    // compute mod-97 iteratively to avoid big integers
    let remainder = 0;
    for (let offset = 0; offset < converted.length; offset += 7) {
      const block = remainder.toString() + converted.substr(offset, 7);
      remainder = parseInt(block, 10) % 97;
    }
    return remainder === 1;
  }

  function isValidAmount(a) {
    if (a === undefined || a === null || a === '') return false;
    const n = Number(String(a));
    return Number.isFinite(n) && n >= 0;
  }

  function isValidDate(d) {
    if (!d) return true;
    // YYYY-MM-DD
    return /^\d{4}-\d{2}-\d{2}$/.test(d);
  }

  // require amount
  if (!isValidAmount(body.amount)) errors.push('amount is required and must be a non-negative number');
  if (!isValidDate(body.settlementDate)) errors.push('settlementDate must be YYYY-MM-DD');

  // validate top-level BICs
  if (!isValidBIC(body.fromBIC)) errors.push('fromBIC is not a valid BIC');
  if (!isValidBIC(body.toBIC)) errors.push('toBIC is not a valid BIC');

  // validate nested zones for BICs and IBANs
  const zones = ['intermediaryAgent1','intermediaryAgent2','debtorAgent','debtor','creditorAgent','creditor'];
  zones.forEach(z => {
    const obj = body[z];
    if (!obj) return;
    if (obj.bic && !isValidBIC(obj.bic)) errors.push(`${z}.bic is not a valid BIC`);
    const acc = obj.account || {};
    if (acc.iban && !ibanChecksum(acc.iban)) errors.push(`${z}.account.iban is not a valid IBAN`);
  });

  if (errors.length) return res.status(400).json({ errors });

  const xml = fmt === '008' ? buildPacs008(body) : buildPacs009(body);

  // Debug: write the generated XML to disk for offline inspection/validation
  try {
    const outDir = path.join(__dirname, 'app', 'test-data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'last_generated.xml'), xml, { encoding: 'utf8' });
  } catch (e) {
    console.warn('Failed to write debug XML file:', e && e.message);
  }

  // Optional: call external validator API (configurable)
  const validatorBase = process.env.VALIDATOR_API_URL || 'http://localhost:3001';
  const xsdMap = { '008': 'pacs.008.001.09.xsd', '009': 'pacs.009.001.09.xsd' };
  const xsdFile = xsdMap[fmt] || xsdMap['009'];

  try {
    // attempt to call validator API; extract inner <Document> because pacs XSD
    // expects <Document> as the root (DataPDU is a wrapper)
    let documentXml = xml;
    try {
      const m = xml.match(/<Document\b[\s\S]*?<\/Document>/i);
      if (m && m[0]) {
        documentXml = m[0];
      } else {
        console.warn('No <Document> element found when preparing payload for XSD validation; sending full XML');
      }
    } catch (ex) {
      console.warn('Error extracting <Document> for validation:', ex && ex.message);
    }

    const resp = await fetch(`${validatorBase}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: documentXml, xsd: xsdFile })
    });

    if (resp.ok) {
      const j = await resp.json();
      if (j && j.valid) {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.send(xml);
      }
      // validator returned not-ok but with 200 and valid:false
      return res.status(422).json({ validation: j, xml });
    }

    // If validator returned 422 with details, forward them
    if (resp.status === 422) {
      const j = await resp.json().catch(() => null);
      return res.status(422).json({ validation: j, xml });
    }

    // other non-OK responses: log and fall back to sending XML
    console.warn('Validator API returned', resp.status);
  } catch (err) {
    console.warn('Validator API call failed:', err.message);
    // proceed to send XML as fallback
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  return res.send(xml);
});

// Export app for tests; start server if run directly
if (require.main === module) {
  app.listen(port, () => console.log(`SwiftConvertor listening on ${port}`));
}

module.exports = app;
