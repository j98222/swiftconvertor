<#
Run end-to-end: build validator image, run validator container, start server, POST test payload, validate Document

Usage: from repo root in PowerShell
  .\tools\run-e2e.ps1

This script is idempotent and will try to reuse running container/processes where possible.
#>

Set-StrictMode -Version Latest

Push-Location (Split-Path -Parent $MyInvocation.MyCommand.Definition)
Push-Location ..\

function Write-Log($m){ Write-Host "[e2e] $m" }

$validatorImage = 'swiftconvertor-validator-api'
$validatorContainer = 'swiftconvertor-validator'

Write-Log "Building validator image ($validatorImage) from tools/validator/api..."
docker build -t $validatorImage ./tools/validator/api | Write-Host

# Start validator container if not running
$ctr = docker ps -a --filter "name=$validatorContainer" --format "{{.Names}}:{{.Status}}" | Select-String $validatorContainer -Quiet
if (-not $ctr) {
  Write-Log "Starting validator container ($validatorContainer)..."
  docker run -d --name $validatorContainer -p 3001:3001 -v "${PWD}/app/xsds:/xsds" $validatorImage | Write-Host
  Start-Sleep -Seconds 1
} else {
  # ensure it's running
  $running = docker ps --filter "name=$validatorContainer" --format "{{.Names}}" | Where-Object { $_ -eq $validatorContainer }
  if (-not $running) {
    Write-Log "Starting existing validator container instance..."
    docker start $validatorContainer | Write-Host
    Start-Sleep -Seconds 1
  } else { Write-Log "Validator container already running." }
}

# Start Node server (server.js) if not running
$pidFile = ".server.pid"
function Start-Server {
  if (Test-Path $pidFile) {
    try { $oldPid = Get-Content $pidFile -ErrorAction Stop } catch { $oldPid = $null }
    if ($oldPid) {
      try { Get-Process -Id $oldPid -ErrorAction Stop | Out-Null ; Write-Log "Server already running (pid=$oldPid)." ; return } catch { Remove-Item $pidFile -ErrorAction SilentlyContinue }
    }
  }
  Write-Log "Starting Node server (server.js)..."
  $p = Start-Process -FilePath node -ArgumentList 'server.js' -PassThru -WorkingDirectory $PWD
  $p.Id | Out-File $pidFile -Encoding ascii
  Start-Sleep -Seconds 1
}
Start-Server

# Trigger conversion: write last_generated.xml (use curl if available, else fallback)
$outFile = "$PWD\app\test-data\last_generated.xml"
Write-Log "Posting test payload using Invoke-RestMethod and handling non-2xx responses"
try {
  $json = Get-Content -Raw -Path "$PWD\app\test-data\valid_payment.json"
  Invoke-RestMethod -Uri 'http://localhost:3000/convert' -Method Post -ContentType 'application/json' -Body $json -OutFile $outFile
} catch {
  # try to read response body from exception
  $resp = $_.Exception.Response
  if ($resp) {
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $sr.ReadToEnd(); $sr.Close()
    try {
      $o = $body | ConvertFrom-Json -ErrorAction Stop
      if ($o.xml) { $o.xml | Out-File -FilePath $outFile -Encoding utf8 }
      else { $body | Out-File $outFile -Encoding utf8 }
    } catch { $body | Out-File $outFile -Encoding utf8 }
  } else { throw }
}

if (-not (Test-Path $outFile)) { Write-Host "Failed to produce $outFile"; Exit 2 }

Write-Log "Copying generated file into validator container (for record) and preparing extracted Document for validation..."
docker cp "$outFile" "$($validatorContainer):/tmp/last_generated.xml"

# Extract Document locally to avoid shell quoting issues inside container
$localDoc = "$PWD\app\test-data\document.xml"
$content = Get-Content -Raw -Path $outFile -ErrorAction Stop
if ($content -match '(?s)<Document\b.*?</Document>') {
  $doc = $Matches[0]
  $doc | Out-File -FilePath $localDoc -Encoding utf8
  Write-Log "Extracted <Document> to $localDoc"
} else {
  Write-Log "No <Document> element found in generated XML"; Exit 3
}

# Copy extracted document into container and validate
docker cp "$localDoc" "$($validatorContainer):/tmp/document.xml"
docker exec $validatorContainer sh -lc 'xmllint --noout --schema /xsds/pacs.009.001.09.xsd /tmp/document.xml && echo VALID || echo INVALID'

Write-Log "Done. Inspect $outFile and the container logs if you need more details."

Pop-Location
Pop-Location

Exit 0
