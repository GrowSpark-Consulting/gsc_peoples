<#
.SYNOPSIS
  Creates the dedicated integration-test database `hr_test` on the native PostgreSQL service.

.DESCRIPTION
  Uses the hr_migrator credentials already in the untracked .env (DIRECT_URL). No administrator
  password is needed because hr_migrator has CREATEDB. Idempotent: if hr_test exists it is reused.
  Writes TEST_DATABASE_URL (hr_app) and TEST_DIRECT_URL (hr_migrator) into .env.

  SAFEGUARDS
   * The database name is the constant 'hr_test'. It is never taken from input.
   * Refuses to run if DIRECT_URL itself points at hr_test, or if the name would equal the
     development database.
   * Every statement after creation runs only after `current_database()` is confirmed as hr_test.
   * Never connects to, or modifies, hr_db or any other application's database for DDL.
#>
param(
  [string]$HostName,
  [int]$Port
)

$ErrorActionPreference = 'Stop'
$TestDb = 'hr_test'   # constant on purpose

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { throw '.env not found. Run pnpm db:setup first.' }
$envText = Get-Content $envFile -Raw

$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) { $psql = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' | Sort-Object FullName -Descending | Select-Object -First 1).FullName }
if (-not $psql) { throw 'psql not found.' }

function Get-UrlParts([string]$key) {
  $m = [regex]::Match($envText, "(?m)^$key=postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?\s]+)")
  if (-not $m.Success) { throw "$key is missing or malformed in .env" }
  [pscustomobject]@{ User = $m.Groups[1].Value; Password = $m.Groups[2].Value; Host = $m.Groups[3].Value; Port = $m.Groups[4].Value; Db = $m.Groups[5].Value }
}

$mig = Get-UrlParts 'DIRECT_URL'
$app = Get-UrlParts 'DATABASE_URL'
if ($HostName) { $mig.Host = $HostName; $app.Host = $HostName }
if ($Port) { $mig.Port = $Port; $app.Port = $Port }

if ($mig.User -ne 'hr_migrator' -or $app.User -ne 'hr_app') { throw 'Expected DIRECT_URL=hr_migrator and DATABASE_URL=hr_app.' }
if ($mig.Db -eq $TestDb) { throw "DIRECT_URL already points at $TestDb; it must point at the development database." }
if ($TestDb -eq $mig.Db) { throw 'Test database name must differ from the development database.' }
if ($TestDb -notmatch '^hr_test$') { throw 'Test database name safeguard failed.' }

$env:PGPASSWORD = $mig.Password
try {
  $base = @('-h', $mig.Host, '-p', $mig.Port, '-U', $mig.User, '-w', '-X', '-q')
  # Connect to the development database only to issue CREATE DATABASE (cannot run inside hr_test).
  $exists = & $psql @base -d $mig.Db -Atc "select 1 from pg_database where datname = '$TestDb'"
  if ($exists -ne '1') {
    & $psql @base -d $mig.Db -c "CREATE DATABASE $TestDb OWNER hr_migrator"
    if ($LASTEXITCODE -ne 0) { throw 'CREATE DATABASE failed.' }
    Write-Host "Created database $TestDb"
  } else { Write-Host "Database $TestDb already exists; reusing." }

  # Everything below runs INSIDE hr_test, guarded by a current_database() check.
  $guard = & $psql @base -d $TestDb -Atc 'select current_database()'
  if ($guard -ne $TestDb) { throw "Safeguard: connected database is '$guard', expected '$TestDb'." }

  & $psql @base -d $TestDb -v ON_ERROR_STOP=1 -c "REVOKE ALL ON DATABASE $TestDb FROM PUBLIC; GRANT CONNECT ON DATABASE $TestDb TO hr_app, hr_migrator; CREATE SCHEMA IF NOT EXISTS hr AUTHORIZATION hr_migrator; REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA hr TO hr_app;"
  if ($LASTEXITCODE -ne 0) { throw 'Grant/schema setup failed.' }

  foreach ($pair in @(@('TEST_DATABASE_URL', $app), @('TEST_DIRECT_URL', $mig))) {
    $key, $p = $pair
    $url = "postgresql://$($p.User):$($p.Password)@$($p.Host):$($p.Port)/${TestDb}?schema=hr"
    if ($envText -match "(?m)^$key=.*$") { $envText = [regex]::Replace($envText, "(?m)^$key=.*$", { "$key=$url" }) }
    else { $envText = $envText.TrimEnd() + "`n$key=$url`n" }
  }
  Set-Content -Path $envFile -Value $envText -NoNewline -Encoding utf8
  Write-Host "TEST_DATABASE_URL and TEST_DIRECT_URL written to .env (point at $TestDb only)."
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
