# SwiftConvertor — Business Requirements

Summary
-------
This document captures the business requirements for the SwiftConvertor prototype implemented in this repository. The system accepts a JSON payment message from a simple UI or REST call, converts it to an ISO20022 pacs XML payload wrapped in a Swift DataPDU envelope, and validates the payload against provided XSDs using a Dockerized xmllint validator.

Objectives
----------
- Provide a UI + REST endpoint to accept payment instruction data.
- Convert client JSON into an ISO20022 pacs XML Document (FICdtTrf) and embed it in a Swift DataPDU envelope with AppHdr.
- Validate the generated Document against authoritative pacs XSDs (pacs.008.001.09 / pacs.009.001.09) and report validation results.
- Keep the validator separate (containerized) to avoid host build toolchain issues and to simplify XSD updates.

Primary Stakeholders
--------------------
- Payments product manager — acceptance and business rules.
- Integrations team — using generated XML to send to clearing networks.
- QA — validating correctness against XSDs.
- Developers — maintain mapping logic and validator.

Scope (in-scope)
----------------
- A web form (static frontend) that collects a defined set of payment fields.
- A Node/Express backend that performs mapping and generates DataPDU + AppHdr + Document.
- Server-side validation of basic fields (IBAN, BIC, amount, date formats).
- Automatic XSD validation by posting the generated <Document> to the validator service.
- A Dockerized xmllint-based validator REST container.
- Debug output: latest generated XML saved to `app/test-data/last_generated.xml`.

Out of scope
------------
- Live production signing / LAU integration.
- Full message enrichment (bank-specific business rules beyond the mapping provided).
- High-volume performance tuning or production hardening.

Functional Requirements
-----------------------
1) Input capture
   - Fields collected: sender/receiver BICs, debtor/creditor names and postal address, intermediary agents, account IBANs, amount (numeric), settlement date (YYYY-MM-DD), remittance info, charge bearer (for pacs.008).
   - Source: UI form (`public/dashboard.html`) or POST JSON to `/convert`.

2) Mapping & Conversion
   - Map JSON fields to an ISO20022 FICdtTrf payload inside `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.*">` using pacs.009.001.09 (payments-instruction flow) or pacs.008.001.09 where applicable.
   - Wrap the `AppHdr` and `Document` inside a Swift `DataPDU` envelope with header subtrees (SAAHeader, Message, NetworkInfo, Sender/Receiver, InterfaceInfo).
   - Generate unique message identifiers and timestamps (BizMsgIdr / MsgId / CreDtTm) using deterministic but unique logic implemented in `server.js`.
   - Emit IBAN-only account `Id` elements (omit `Othr` unless explicitly needed).
   - Emit postal addresses as `<PstlAdr>` with `<AdrLine>` entries to match the XSD expectations.
   - For certain fields (SttlmMtd), map incoming values to allowed enumeration values (fallback to `CLRG`).

3) Validation
   - Run XSD validation for the generated `<Document>` using the validator API (calls the containerized xmllint).
   - If validation passes, return XML (Content-Type: application/xml). If validation fails, return 422 with validator errors and include the generated XML for debugging.

4) Operational helpers
   - Save last generated XML to `app/test-data/last_generated.xml` for inspection.
   - Provide a small automated script `tools/run-e2e.ps1` to build/run the validator, start the server, post sample payload and validate end-to-end.

Non-functional Requirements
---------------------------
- Developer-friendly: minimal local dependencies (validator runs in Docker to avoid node-gyp/native builds).
- Traceability: generated messages include unique IDs and timestamps.
- Observability: validation errors are returned to the client to aid debugging.
- Portability: PowerShell-friendly scripts are provided for Windows developers; scripts are shell-friendly for Linux/macOS in Docker parts.

Data Shapes and Key Fields
--------------------------
- Input JSON (example in `app/test-data/valid_payment.json`) contains nested objects for `debtor`, `creditor`, `intermediaryAgent1`, `intermediaryAgent2`, each with `bic`, `name`, `address` and `account.iban`.
- Generated XML:
  - DataPDU (urn:swift:saa:xsd:saa.2.0)
  - Body -> AppHdr (urn:iso:std:iso:20022:tech:xsd:head.001.001.01)
  - Body -> Document (urn:iso:std:iso:20022:tech:xsd:pacs.009.001.09)
  - Document -> FICdtTrf -> GrpHdr and one CdtTrfTxInf with the mapped fields.

Validation Rules (implemented)
------------------------------
- IBAN checksum validation for `account.iban` (server-side).
- BIC syntax validation for BICs (allow empty when not provided).
- Amount must be present and non-negative.
- Settlement date must be YYYY-MM-DD when provided.
- XSD validation against `app/xsds/pacs.009.001.09.xsd` (and pacs.008 counterpart when relevant).

Acceptance Criteria
-------------------
1) For the provided sample JSON (`app/test-data/valid_payment.json`), the server produces a Document that validates against `pacs.009.001.09.xsd` when the `<Document>` is extracted and validated with xmllint inside the validator container.
2) The server returns `Content-Type: application/xml` and the DataPDU when the validator reports valid.
3) If validation fails, the server returns HTTP 422 with validator output and the generated XML for debugging.
4) `tools/run-e2e.ps1` completes end-to-end and reports VALID for the sample payload in the repository.

Traceability to code / artifacts
--------------------------------
- Mapping, generation, and validation logic: `server.js`
- Frontend: `public/dashboard.html`
- Sample payloads: `app/test-data/valid_payment.json`
- XSDs: `app/xsds/pacs.009.001.09.xsd`, `app/xsds/pacs.008.001.09.xsd`, `app/xsds/head.001.001.03.xsd`
- Validator API + Dockerfile: `tools/validator/api/`
- E2E automation script (PowerShell): `tools/run-e2e.ps1`
- Last generated XML (debug): `app/test-data/last_generated.xml`

Open items / Recommendations
----------------------------
- Add unit tests that assert tag-level correctness (element order and presence) for key permutations.
- Expand mapping rules for edge-cases: nested UltmtDbtr/UltmtCdtr, InstrId vs EndToEndId choices, and optional account schemes.
- Add CI job that runs `tools/run-e2e.ps1` (or a portable shell equivalent) to prevent regressions.
- Consider implementing a stricter production error policy (e.g., fail-fast and log to centralised store) if used beyond prototype stage.

Approval
--------
This document is intended for review by product, integrations, and QA. Sign-off items should include the acceptance criteria above.
