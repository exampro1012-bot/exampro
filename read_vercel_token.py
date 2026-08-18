import ctypes
from ctypes import wintypes

CRED_TYPE_GENERIC = 1

class CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]

advapi32 = ctypes.WinDLL("advapi32.dll", use_last_error=True)
CredRead = advapi32.CredReadW
CredRead.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
CredRead.restype = wintypes.BOOL

CredFree = advapi32.CredFree
CredFree.argtypes = [ctypes.c_void_p]
CredFree.restype = None

target = "vercel|511b08192b045b3d.Codex MCP Credentials"
pcred = ctypes.c_void_p()
if CredRead(target, CRED_TYPE_GENERIC, 0, ctypes.byref(pcred)):
    cred = ctypes.cast(pcred, ctypes.POINTER(CREDENTIAL)).contents
    blob = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
    # CredentialBlob is UTF-16LE
    password = blob.decode("utf-16le", errors="ignore")
    print(f"User: {cred.UserName}")
    print(f"Password: {password}")
    CredFree(pcred)
else:
    print(f"Failed to read credential. Error: {ctypes.get_last_error()}")
