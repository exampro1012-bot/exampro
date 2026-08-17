# Firebase Setup — DEPRECATED

ExamPro has migrated from Firebase to **Supabase** (PostgreSQL + Auth + Storage + Edge Functions).

This document is retained for historical reference only. Do not follow these instructions for new deployments.

## Migration notes

- All authentication now uses **Supabase Auth** (email/password + Google OAuth).
- All data now lives in **Supabase PostgreSQL** with Row Level Security.
- All files are stored in **Google Drive** via the ExamPro centralized storage account.
- No Firebase SDK, Firestore, Realtime Database, or Cloud Functions are used.

If you encounter references to Firebase in legacy files (`build/`, `tests/legacy-firebase/`), those directories have been removed from the active codebase.
