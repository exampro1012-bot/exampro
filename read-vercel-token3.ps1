try {
    Add-Type -AssemblyName Windows.Security -ErrorAction Stop
    $vault = New-Object Windows.Security.Credentials.PasswordVault
    $creds = $vault.RetrieveAll()
    foreach ($c in $creds) {
        Write-Output "Resource: $($c.Resource)"
        Write-Output "User: $($c.UserName)"
        $pass = $c.RetrievePassword()
        Write-Output "Password: $pass"
        Write-Output "---"
    }
} catch {
    Write-Output "Error: $_"
}
