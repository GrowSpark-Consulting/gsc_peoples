<#
.SYNOPSIS
  One-time local setup of hr_db, hr_app and hr_migrator on the native PostgreSQL service.

.DESCRIPTION
  Prompts for the PostgreSQL administrator password (never stored or printed), generates random
  passwords for the two HR roles, runs setup-local-db.sql, and writes DATABASE_URL / DIRECT_URL
  into the untracked repo-root .env. Does not restart or reconfigure the PostgreSQL service and
  does not touch other databases or roles.

.EXAMPLE
  pnpm db:setup
  pnpm db:setup -- -ResetPasswords
#>
param(
  [string]$HostName = 'localhost',
  [int]$Port = 5432,
  [string]$AdminUser = 'postgres',
  [switch]$ResetPasswords
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $root '.env'
$sqlFile = Join-Path $PSScriptRoot 'setup-local-db.sql'

$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) { $psql = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' | Sort-Object FullName -Descending | Select-Object -First 1).FullName }
if (-not $psql) { throw 'psql not found. Install PostgreSQL client tools or add psql to PATH.' }

# Cryptographically secure random alphanumeric string. Works in Windows PowerShell 5.1 and 7+.
# Rejection sampling: bytes >= the largest multiple of the alphabet size are discarded, so every
# character is equally likely (no modulo bias).
function New-Secret([int]$length = 32) {
  $chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $limit = 256 - (256 % $chars.Length)
  $result = New-Object System.Text.StringBuilder
  $buffer = New-Object byte[] ($length * 2)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    while ($result.Length -lt $length) {
      $rng.GetBytes($buffer)
      foreach ($b in $buffer) {
        if ($b -lt $limit) {
          [void]$result.Append($chars[$b % $chars.Length])
          if ($result.Length -eq $length) { break }
        }
      }
    }
  }
  finally {
    $rng.Dispose()
  }
  $result.ToString()
}

$secure = Read-Host "Password for PostgreSQL user '$AdminUser'" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
  $base = @('-h', $HostName, '-p', $Port, '-U', $AdminUser, '-w', '-X', '-q')

  & $psql @base -d postgres -Atc 'select 1' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not connect with the supplied administrator password.' }

  $existing = [int](& $psql @base -d postgres -Atc "select count(*) from pg_roles where rolname in ('hr_app','hr_migrator')")

  if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root '.env.example') $envFile }
  $envText = Get-Content $envFile -Raw
  $haveUrls = ($envText -match '(?m)^DATABASE_URL=\S') -and ($envText -match '(?m)^DIRECT_URL=\S')
  $reset = $ResetPasswords.IsPresent -or $existing -lt 2 -or -not $haveUrls

  $appPw = New-Secret
  $migPw = New-Secret
  $header = "\set app_pw '$appPw'`n\set migrator_pw '$migPw'`n\set reset $($reset.ToString().ToLower())`n"
  ($header + (Get-Content $sqlFile -Raw)) | & $psql @base -d postgres -f -
  if ($LASTEXITCODE -ne 0) { throw 'Database setup SQL failed.' }

  if ($reset) {
    $dbUrl = "postgresql://hr_app:$appPw@${HostName}:$Port/hr_db?schema=hr"
    $directUrl = "postgresql://hr_migrator:$migPw@${HostName}:$Port/hr_db?schema=hr"
    foreach ($pair in @(@('DATABASE_URL', $dbUrl), @('DIRECT_URL', $directUrl))) {
      $key, $val = $pair
      if ($envText -match "(?m)^$key=.*$") { $envText = [regex]::Replace($envText, "(?m)^$key=.*$", { "$key=$val" }) }
      else { $envText = $envText.TrimEnd() + "`n$key=$val`n" }
    }
    Set-Content -Path $envFile -Value $envText -NoNewline -Encoding utf8
    Write-Host 'Wrote DATABASE_URL (hr_app) and DIRECT_URL (hr_migrator) to .env'
  } else {
    Write-Host '.env already has URLs and roles exist; left unchanged (use -ResetPasswords to rotate).'
  }
  Write-Host 'Done. Next: pnpm db:generate; pnpm db:migrate'
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
