"use strict";

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

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
  const creDt = escapeXml(formatSwiftDateTime());
  const bizSvc = 'paymentsca.lynx.03';
  const fromBIC = escapeXml(bicSafe(values.fromBIC));
  const toBIC = escapeXml(bicSafe(values.toBIC));

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
    '<AppHdr>',
    `  <MsgDefIdr>${msgDef}</MsgDefIdr>`,
    `  <CreDt>${creDt}</CreDt>`,
    `  <BizSvc>${bizSvc}</BizSvc>`,
    `  <Fr><FIId><FINInstnId><BICFI>${fromBIC}</BICFI></FINInstnId></FIId></Fr>`,
    `  <To><FIId><FINInstnId><BICFI>${toBIC}</BICFI></FINInstnId></FIId></To>`,
    '</AppHdr>',
  ].join('\n');

  return { headerXml: [saaHeader, networkInfo].join('\n'), appHdrXml: appHdr };
}

function buildPacsBody(values, tagName) {
  // Build FinInstnId XML (BIC, Name, Postal Address)
  function finInstnIdXml(prefix, obj) {
    if(!obj) obj = {};
    const parts = [];
    parts.push(`${prefix}<FinInstnId>`);
    if (obj.bic) parts.push(`  <BICFI>${escapeXml(obj.bic)}</BICFI>`);
    if (obj.name) parts.push(`  <Nm>${escapeXml(obj.name)}</Nm>`);
    // Postal address
    const a = obj.address || {};
    if (a.department || a.streetName || a.buildingNumber || a.city || a.citySubDivision || a.province || a.country) {
      parts.push('  <PstlAdr>');
      if (a.department) parts.push(`    <Dept>${escapeXml(a.department)}</Dept>`);
      if (a.streetName) parts.push(`    <StrtNm>${escapeXml(a.streetName)}</StrtNm>`);
      if (a.buildingNumber) parts.push(`    <BldgNb>${escapeXml(a.buildingNumber)}</BldgNb>`);
      if (a.city) parts.push(`    <TwnNm>${escapeXml(a.city)}</TwnNm>`);
      if (a.citySubDivision) parts.push(`    <CtrySubDvsn>${escapeXml(a.citySubDivision)}</CtrySubDvsn>`);
      if (a.province) parts.push(`    <PstCd>${escapeXml(a.province)}</PstCd>`);
      if (a.country) parts.push(`    <Ctry>${escapeXml(a.country)}</Ctry>`);
      parts.push('  </PstlAdr>');
    }
    parts.push('</FinInstnId>');
    return parts.join('\n');
  }

  function accountXml(prefix, acc) {
    if(!acc) acc = {};
    const parts = [];
    parts.push(`${prefix}<Id>`);
    if (acc.iban) parts.push(`  <IBAN>${escapeXml(acc.iban)}</IBAN>`);
    if (acc.id) parts.push(`  <Othr>\n    <Id>${escapeXml(acc.id)}</Id>\n  </Othr>`);
    parts.push('</Id>');
    return parts.join('\n');
  }

  // Map common fields according to Mapping.csv
  const amt = values.amount || '';
  const stlDate = values.settlementDate || '';
  const rmt = values.remittanceInfo || '';
  const sttlmMtd = values.requestType || '';

  const inter1 = values.intermediaryAgent1 || {};
  const inter2 = values.intermediaryAgent2 || {};
  const dbtrAgt = values.debtorAgent || {};
  const dbtr = values.debtor || {};
  const cdtrAgt = values.creditorAgent || {};
  const cdtr = values.creditor || {};

  const lines = [];
  lines.push(`    <${tagName}>`);
  lines.push('      <FICdtTrf>');
  lines.push('        <GrpHdr>');
  lines.push('          <SttlmInf>');
  lines.push(`            <SttlmMtd>${escapeXml(sttlmMtd)}</SttlmMtd>`);
  lines.push('          </SttlmInf>');
  lines.push('        </GrpHdr>');
  lines.push('        <CdtTrfTxInf>');
  lines.push(`          <IntrBkSttlmAmt>${escapeXml(amt)}</IntrBkSttlmAmt>`);
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

  // Debtor Agent
  lines.push('          <DbtrAgt>');
  lines.push(finInstnIdXml('            ', dbtrAgt));
  lines.push('          </DbtrAgt>');
  lines.push('          <DbtrAgtAcct>');
  lines.push(accountXml('            ', dbtrAgt.account));
  lines.push('          </DbtrAgtAcct>');

  // Debtor
  lines.push('          <Dbtr>');
  lines.push('            <FinInstnId>');
  if (dbtr.bic) lines.push(`              <BICFI>${escapeXml(dbtr.bic)}</BICFI>`);
  if (dbtr.name) lines.push(`              <Nm>${escapeXml(dbtr.name)}</Nm>`);
  const daddr = dbtr.address || {};
  if (Object.keys(daddr).length) {
    lines.push('              <PstlAdr>');
    if (daddr.department) lines.push(`                <Dept>${escapeXml(daddr.department)}</Dept>`);
    if (daddr.streetName) lines.push(`                <StrtNm>${escapeXml(daddr.streetName)}</StrtNm>`);
    if (daddr.buildingNumber) lines.push(`                <BldgNb>${escapeXml(daddr.buildingNumber)}</BldgNb>`);
    if (daddr.city) lines.push(`                <TwnNm>${escapeXml(daddr.city)}</TwnNm>`);
    if (daddr.citySubDivision) lines.push(`                <CtrySubDvsn>${escapeXml(daddr.citySubDivision)}</CtrySubDvsn>`);
    if (daddr.province) lines.push(`                <PstCd>${escapeXml(daddr.province)}</PstCd>`);
    if (daddr.country) lines.push(`                <Ctry>${escapeXml(daddr.country)}</Ctry>`);
    lines.push('              </PstlAdr>');
  }
  lines.push('            </FinInstnId>');
  lines.push('          </Dbtr>');
  lines.push('          <DbtrAcct>');
  lines.push(accountXml('            ', dbtr.account));
  lines.push('          </DbtrAcct>');

  // Creditor Agent
  lines.push('          <CdtrAgt>');
  lines.push(finInstnIdXml('            ', cdtrAgt));
  lines.push('          </CdtrAgt>');
  lines.push('          <CdtrAgtAcct>');
  lines.push(accountXml('            ', cdtrAgt.account));
  lines.push('          </CdtrAgtAcct>');

  // Creditor
  lines.push('          <Cdtr>');
  lines.push('            <FinInstnId>');
  if (cdtr.bic) lines.push(`              <BICFI>${escapeXml(cdtr.bic)}</BICFI>`);
  if (cdtr.name) lines.push(`              <Nm>${escapeXml(cdtr.name)}</Nm>`);
  const caddr = cdtr.address || {};
  if (Object.keys(caddr).length) {
    lines.push('              <PstlAdr>');
    if (caddr.department) lines.push(`                <Dept>${escapeXml(caddr.department)}</Dept>`);
    if (caddr.streetName) lines.push(`                <StrtNm>${escapeXml(caddr.streetName)}</StrtNm>`);
    if (caddr.buildingNumber) lines.push(`                <BldgNb>${escapeXml(caddr.buildingNumber)}</BldgNb>`);
    if (caddr.city) lines.push(`                <TwnNm>${escapeXml(caddr.city)}</TwnNm>`);
    if (caddr.citySubDivision) lines.push(`                <CtrySubDvsn>${escapeXml(caddr.citySubDivision)}</CtrySubDvsn>`);
    if (caddr.province) lines.push(`                <PstCd>${escapeXml(caddr.province)}</PstCd>`);
    if (caddr.country) lines.push(`                <Ctry>${escapeXml(caddr.country)}</Ctry>`);
    lines.push('              </PstlAdr>');
  }
  lines.push('            </FinInstnId>');
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
  lines.push(`    </${tagName}>`);

  return lines.join('\n');
}

function buildPacs009(values) {
  const header = buildHeader(values, 'pacs.009.001.08');
  const body = buildPacsBody(values, 'Pacs009');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<DataPDU>', header, '  <Document xmlns="urn:swift:pacs.009">', body, '  </Document>', '</DataPDU>'].join('\n');
}

function buildPacsDocument(values, tagName) {
  const body = buildPacsBody(values, tagName);
  // Document with appropriate namespace
  const ns = tagName === 'Pacs009' ? 'urn:swift:pacs.009' : 'urn:swift:pacs.008';
  return `<Document xmlns="${ns}">\n${body}\n</Document>`;
}

function buildDataPDU(headerInnerXml, appHdrXml, documentXml) {
  // Swift-standard DataPDU layout: Revision, Header, Body (AppHdr + Document), LAU
  const revision = '<Revision>1</Revision>';
  const header = ['<Header>', headerInnerXml || '', '</Header>'].join('\n');
  const body = ['<Body>', appHdrXml || '', documentXml || '', '</Body>'].join('\n');
  const lau = '<LAU></LAU>'; // placeholder for signing/LAU

  return ['<?xml version="1.0" encoding="UTF-8"?>', '<DataPDU>', revision, header, body, lau, '</DataPDU>'].join('\n');
}

function buildPacs009(values) {
  const parts = buildHeader(values, 'pacs.009.001.01');
  const doc = buildPacsDocument(values, 'Pacs009');
  return buildDataPDU(parts.headerXml, parts.appHdrXml, doc);
}

function buildPacs008(values) {
  const parts = buildHeader(values, 'pacs.008.001.02');
  const doc = buildPacsDocument(values, 'Pacs008');
  return buildDataPDU(parts.headerXml, parts.appHdrXml, doc);
}

app.get('/health', (req, res) => res.json({ status: 'ok', now: formatSwiftDateTime() }));

app.post('/convert', (req, res) => {
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
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  return res.send(xml);
});

// Export app for tests; start server if run directly
if (require.main === module) {
  app.listen(port, () => console.log(`SwiftConvertor listening on ${port}`));
}

module.exports = app;
