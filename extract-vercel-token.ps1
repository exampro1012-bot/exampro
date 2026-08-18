$target = "vercel|511b08192b045b3d.Codex MCP Credentials"
$cred = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList $target, (Read-Host "Enter password for $target" -AsSecureString)
Write-Output "User: $($cred.UserName)"
Write-Output "Pass: $($cred.GetNetworkCredential().Password)"
