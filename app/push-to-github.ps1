# push-to-github.ps1
# Helper to create a GitHub repo (using gh) or push to an existing remote.
# Usage: Run from project root (C:\workspaces\jx\SwiftConvertor) in PowerShell

param(
  [string]$RepoName = 'swiftconvertor',
  [switch]$Public
)

Set-Location -Path (Join-Path $PSScriptRoot '\..')
Write-Output "Working directory: $(Get-Location)"

# Ensure git repo
if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
  Write-Output 'Initializing git repository'
  git init
}

# Stage and commit
git add -A
try {
  git commit -m "chore: initial commit" -q
  Write-Output 'Committed changes (or no changes to commit)'
} catch {
  Write-Output 'No changes to commit or commit failed (already committed)'
}

if (Get-Command gh -ErrorAction SilentlyContinue) {
  Write-Output 'GitHub CLI found. Creating and pushing repository using gh...'
  $flags = '--public'
  if (-not $Public) { $flags = '--private' }
  gh auth status 2>&1 | Out-String | Write-Output
  gh repo create $RepoName $flags --source=. --remote=origin --push --confirm
  Write-Output 'Finished gh repo create (check above for output)'
} else {
  Write-Output 'GitHub CLI (gh) not found on this machine.'
  $remote = Read-Host 'Enter remote Git URL to push to (e.g. https://github.com/you/repo.git), or leave empty to abort'
  if (-not $remote) { Write-Output 'Aborted: no remote provided'; exit 1 }
  # add remote if not present
  try { git remote get-url origin -q; $hasOrigin = $true } catch { $hasOrigin = $false }
  if (-not $hasOrigin) { git remote add origin $remote; Write-Output "Added origin -> $remote" } else { Write-Output 'origin remote already exists; will push to it' }
  git branch -M main 2>$null; git push -u origin main
  Write-Output 'Push complete (check output above for any errors)'
}
