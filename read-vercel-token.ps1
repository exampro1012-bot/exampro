Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CredentialManager {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CredFree(IntPtr credentialPtr);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
}
"@

$target = "vercel|511b08192b045b3d.Codex MCP Credentials"
$credentialPtr = [IntPtr]::Zero
if ([CredentialManager]::CredRead($target, 1, 0, [ref]$credentialPtr)) {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [CredentialManager+CREDENTIAL])
    $passwordBytes = New-Object byte[] $cred.CredentialBlobSize
    [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $passwordBytes, 0, $cred.CredentialBlobSize)
    $password = [System.Text.Encoding]::Unicode.GetString($passwordBytes)
    Write-Output "User: $($cred.UserName)"
    Write-Output "Password: $password"
    [CredentialManager]::CredFree($credentialPtr)
} else {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "Failed to read credential. Error: $err"
}
