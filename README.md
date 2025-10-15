# SwiftConvertor — quick run & validation

This repo includes a small Node/Express converter (`server.js`) and a Dockerized xmllint-based validator (under `tools/validator/api`). The server writes the last generated XML to `app/test-data/last_generated.xml` for inspection.

Quick steps (PowerShell)

1. Build the validator image (from repo root):

```powershell
docker build -t swiftconvertor-validator-api ./tools/validator/api
```

2. Run the validator container, mounting the local XSDs and exposing port 3001:

```powershell
docker run -d --name swiftconvertor-validator -p 3001:3001 -v "${PWD}/app/xsds:/xsds" swiftconvertor-validator-api
```

Validator API health: http://localhost:3001/health

3. Start the converter server (from repo root):

```powershell
node server.js
```

4. Trigger a conversion using the example payload and write the response to the debug file:

```powershell
#$json = Get-Content -Raw -Path .\app\test-data\valid_payment.json
#Invoke-RestMethod -Uri 'http://localhost:3000/convert' -Method Post -ContentType 'application/json' -Body $json -OutFile .\app\test-data\last_generated.xml

# Alternatively use curl (returns raw XML when validator accepts):
curl -X POST -H "Content-Type: application/json" --data @.\app\test-data\valid_payment.json http://localhost:3000/convert -o .\app\test-data\last_generated.xml
```

Notes: `Invoke-RestMethod` will throw on non-2xx responses (PowerShell behavior). If the server returns 422 with validation details it will include the generated XML in the JSON body. Using `curl` above writes the response to the file directly.

5. Inspect the generated XML locally:

```powershell
type .\app\test-data\last_generated.xml
```

6. Validate the Document portion inside the validator container (copy file into container and run xmllint):

```powershell
docker cp .\app\test-data\last_generated.xml swiftconvertor-validator:/tmp/last_generated.xml
docker exec swiftconvertor-validator sh -c "sed -n '/<Document/,/<\/Document>/p' /tmp/last_generated.xml > /tmp/document.xml && xmllint --noout --schema /xsds/pacs.009.001.09.xsd /tmp/document.xml && echo VALID || echo INVALID"
```

This extracts the `<Document>` element and validates it against the mounted XSDs at `/xsds`.

If you want, I can also add a tiny test script that automates the build/run/validate steps. Tell me which you prefer.
# SwiftConvertor

Small example app that converts simple JSON/form input into PACS.008 or PACS.009-like XML wrapped in a DataPDU with SAAHeader and AppHdr.

Usage:

1. Install dependencies

```powershell
cd C:\workspaces\jx\SwiftConvertor
npm install
```

2. Run

```powershell
npm start
```

3. POST JSON to `/convert` with fields like:

{
  "paymentType": "009",
  "messageIdentifier": "MSG-123",
  "requestType": "REQ",
  "fromBIC": "BANKUS33",
  "toBIC": "BANKGB22",
  "amount": 1000,
  "debtor": "Alice",
  "debtorAccount": "DE1234567890",
  "creditor": "Bob",
  "creditorAccount": "GB0987654321",
  "remittanceInfo": "Invoice 2025-1001"
}

The response will be an XML document.

## VS Code integration

- Tasks are provided in `.vscode/tasks.json`: `npm: install`, `npm: start`, `npm: dev`, `Docker: build image`, `Docker Compose: up`.
- Launch configuration available to debug the server: open the Run view and choose "Launch SwiftConvertor".

## Docker / Compose

- Build and run with Docker Compose (requires Docker Desktop running):

```powershell
docker compose up --build
```

This will expose the service on port 3000.
