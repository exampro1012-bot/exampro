# Runs all database suites against local PostgreSQL on fresh databases.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/db-test.ps1 -PgHost localhost
param(
  [string]$PgHost = "localhost",
  [int]$Port = 5432,
  [string]$User = "postgres"
)

$root = Split-Path -Parent $PSScriptRoot

if (-not $env:PGPASSWORD) {
  $ss = Read-Host -Prompt "Postgres password for $User" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss))
}

function Run-Psql([string]$db, [string]$file) {
  & psql -h $PgHost -p $Port -U $User -d $db -v ON_ERROR_STOP=1 -f $file *> $null
  if ($LASTEXITCODE -ne 0) { Write-Output "FAILED: $file"; exit 1 }
}

function Show-Suite([string]$db, [string]$file, [string]$label) {
  Write-Output "--- $label ---"
  $out = & psql -h $PgHost -p $Port -U $User -d $db -v ON_ERROR_STOP=1 -f $file 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Output "FAILED: $file"; $out | ForEach-Object { Write-Output $_.ToString() }; exit 1 }
  $out | ForEach-Object { $_.ToString() } | Where-Object { $_ -match "NOTICE|ERROR|OK " } | ForEach-Object { $_.Trim() }
}

foreach ($db in @("exampro_test", "exampro_rls")) {
  & psql -h $PgHost -p $Port -U $User -d postgres -c "DROP DATABASE IF EXISTS $db;" *> $null
  & psql -h $PgHost -p $Port -U $User -d postgres -c "CREATE DATABASE $db;" *> $null
  Run-Psql $db (Join-Path $root "supabase\tests\_local_stubs.sql")
  Get-ChildItem (Join-Path $root "supabase\migrations\*.sql") | Sort-Object Name | ForEach-Object {
    Run-Psql $db $_.FullName
  }
  Write-Output "$db : migrations OK"
}

Show-Suite "exampro_test" (Join-Path $root "supabase\tests\engine_test2.sql") "engine_test2"
Show-Suite "exampro_test" (Join-Path $root "supabase\tests\engine_parity_test.sql") "engine_parity_test"
Show-Suite "exampro_test" (Join-Path $root "supabase\tests\engine_0015_test.sql") "engine_0015_test"
Show-Suite "exampro_test" (Join-Path $root "supabase\tests\engine_0019_test.sql") "engine_0019_test"
Show-Suite "exampro_test" (Join-Path $root "supabase\tests\engine_0030_test.sql") "engine_0030_test"
Show-Suite "exampro_rls" (Join-Path $root "supabase\tests\rls_isolation_test.sql") "rls_isolation_test"
Write-Output "ALL DB SUITES DONE"