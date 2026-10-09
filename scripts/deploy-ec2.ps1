[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [Parameter(Mandatory = $true)]
  [Alias('Host')]
  [string]$ServerHost,

  [string]$RemoteDirectory = '/opt/costflow',

  [string]$EnvFile = '.env.production'
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found. Install OpenSSH Client and tar, then retry."
  }
}

function Invoke-Remote([string]$Command) {
  & ssh -i $KeyPath "ubuntu@$ServerHost" $Command
  if ($LASTEXITCODE -ne 0) { throw "Remote command failed with exit code $LASTEXITCODE." }
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$key = Resolve-Path $KeyPath
$environmentFile = Resolve-Path (Join-Path $repositoryRoot $EnvFile)
$archive = Join-Path $env:TEMP 'costflow-deploy.tar.gz'

Require-Command ssh
Require-Command scp
Require-Command tar

if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }

try {
  Write-Host 'Packaging local CostFlow source (credentials and Terraform files are excluded)...'
  Push-Location $repositoryRoot
  try {
    & tar -czf $archive --exclude=.git --exclude=.env --exclude=.env.* --exclude=node_modules --exclude=frontend/node_modules --exclude=dist --exclude=frontend/dist --exclude=terraform --exclude=coverage --exclude=exports --exclude=*.log --exclude=*.err .
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the deployment archive.' }
  }
  finally {
    Pop-Location
  }

  Write-Host 'Uploading source and the separate local .env file...'
  Invoke-Remote 'mkdir -p ~/costflow-deploy'
  & scp -i $key $archive "ubuntu@${ServerHost}:~/costflow-deploy/source.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Source upload failed.' }
  & scp -i $key $environmentFile "ubuntu@${ServerHost}:~/costflow-deploy/.env"
  if ($LASTEXITCODE -ne 0) { throw '.env upload failed.' }

  $bootstrap = @"
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker ubuntu
sudo mkdir -p $RemoteDirectory
sudo rm -rf $RemoteDirectory/*
sudo tar -xzf ~/costflow-deploy/source.tar.gz -C $RemoteDirectory
sudo install -o ubuntu -g ubuntu -m 600 ~/costflow-deploy/.env $RemoteDirectory/.env
sudo chown -R ubuntu:ubuntu $RemoteDirectory
cd $RemoteDirectory
# A t3.micro has limited memory; build the two Node images sequentially.
sudo docker compose --progress quiet -f docker-compose.production.yml build app
sudo docker compose --progress quiet -f docker-compose.production.yml build web
sudo docker compose -f docker-compose.production.yml up -d --no-build --remove-orphans
for attempt in `{1..48`}; do
  if sudo docker compose -f docker-compose.production.yml ps --status running | grep -q app \
     && curl -fsS http://localhost/health >/dev/null; then
    echo 'CostFlow is healthy.'
    exit 0
  fi
  sleep 5
done
sudo docker compose -f docker-compose.production.yml logs --tail=200
exit 1
"@

  Write-Host 'Installing Docker if needed and starting CostFlow on EC2...'
  Invoke-Remote $bootstrap
  Write-Host "Deployment complete: http://$ServerHost"
}
finally {
  if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }
}
