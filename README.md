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
