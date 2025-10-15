# Architecture Overview

This document contains a high-level architecture diagram for the SwiftConvertor prototype and a short explanation of each component and how they interact.

Mermaid diagram (renderable in compatible viewers):

```mermaid
flowchart LR
  Browser[Browser / UI]
  Browser -->|POST JSON / Form| WebServer[Node.js Express server\n`server.js`]
  WebServer -->|Generates XML| DataPDU[DataPDU + AppHdr + Document]
  WebServer -->|Writes file| TestData[`app/test-data/last_generated.xml`]
  WebServer -->|Call Validator API (HTTP)| ValidatorAPI[Validator REST API\n`tools/validator/api/server.js`]
  ValidatorAPI -->|Runs xmllint inside container| Xmllint[xmllint daemon / libxml2]
  Xmllint --> ValidatorAPI
  ValidatorAPI -->|Validation result| WebServer
  WebServer -->|200 xml or 422 json| Browser

  subgraph Repo
    DataPDU
    TestData
    ValidatorAPI
    XSDs[`app/xsds/*.xsd`]
    E2E[`tools/run-e2e.ps1`]
    Docs[`docs/BUSINESS_REQUIREMENTS.md`]
  end

  note right of WebServer
    - mapping & generation logic
    - server-side validation (BIC/IBAN/amount/date)
    - debug write to disk
  end

  classDef infra fill:#f9f,stroke:#333,stroke-width:1px
  ValidatorAPI,Xmllint,XSDs class infra
```

Explanation
-----------
- Browser / UI: the static frontend (`public/dashboard.html`) posts JSON or lets users submit a payment form.
- Node.js Express server (`server.js`): maps JSON to ISO20022 payload (FICdtTrf) and wraps it in a Swift DataPDU envelope with AppHdr. It performs basic validation (IBAN checksum, BIC syntax, amount/date checks) and writes `app/test-data/last_generated.xml` for debug.
- Validator REST API (containerized): small Express API that runs `xmllint` inside an Alpine container. The server sends the extracted `<Document>` XML and the XSD filename; the validator returns valid/errors.
- xmllint: authoritative XSD validation engine (libxml2) used inside the validator container.
- XSDs: authoritative schema files are stored under `app/xsds/` and mounted into the validator container.
- E2E script: `tools/run-e2e.ps1` automates building the validator image, starting the container, starting the server, posting the sample payload, copying the generated file into the container, and running xmllint.

Files of interest
-----------------
- `server.js` — main server and XML generation.
- `public/dashboard.html` — UI for message input.
- `app/xsds/` — XSDs used by the validator.
- `tools/validator/api/` — validator API and Dockerfile.
- `tools/run-e2e.ps1` — end-to-end script.
- `app/test-data/last_generated.xml` — last generated DataPDU (debug output).

Render options
--------------
- Mermaid: `docs/ARCHITECTURE.md` contains a Mermaid diagram you can render in VS Code with the Mermaid plugin or on GitHub (if enabled).
- PlantUML: `docs/architecture.puml` contains a PlantUML source file you can render to PNG/SVG with any PlantUML renderer.
