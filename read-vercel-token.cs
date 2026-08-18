using System;
using System.Runtime.InteropServices;

class Program {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CredFree(IntPtr credentialPtr);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWrittenLow;
        public long LastWrittenHigh;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    static void Main() {
        string target = "vercel|511b08192b045b3d.Codex MCP Credentials";
        IntPtr credentialPtr = IntPtr.Zero;
        if (CredRead(target, 1, 0, out credentialPtr)) {
            CREDENTIAL cred = Marshal.PtrToStructure<CREDENTIAL>(credentialPtr);
            byte[] passwordBytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, passwordBytes, 0, cred.CredentialBlobSize);
            string password = System.Text.Encoding.Unicode.GetString(passwordBytes);
            Console.WriteLine("User: " + cred.UserName);
            Console.WriteLine("Password: " + password);
            CredFree(credentialPtr);
        } else {
            int err = Marshal.GetLastWin32Error();
            Console.WriteLine("Failed to read credential. Error: " + err);
        }
    }
}
