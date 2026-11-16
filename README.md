# AcaPulse

AcaPulse is an Expo SDK 58 academic progress app. Accounts use an email and strong password, with six-digit email verification and password-recovery codes. The app includes student progress, lecturer course and grade tools, and an administrator workspace for lecturer approval and course assignment.

## Run the app

From the AcaPulse folder, install packages and start Expo:

```powershell
npm install
npx expo start
```

Open the QR code with Expo Go while the phone and computer are on the same Wi-Fi network. If `npx` is not available on your Windows setup, use `npm run start`.

## Connect the backend

The screens run without credentials, but sign-up and account data require a Supabase project.

1. Create a Supabase project.
2. In its SQL Editor, run the complete migration at `supabase/migrations/20261111000000_acapulse_schema.sql`.
3. Copy `.env.example` to `.env` in this folder. Set `EXPO_PUBLIC_SUPABASE_URL` to the project URL and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the project's publishable key. Never put a service-role key in the app.
4. In Supabase Authentication → Sign In / Providers → Email, enable email sign-ups and **Confirm email**. Confirmation must stay enabled before the first sign-in.
5. Create a dedicated personal Gmail account for AcaPulse. Enable 2-Step Verification and create a Google app password. Do not use your normal Gmail password.
6. In Authentication → Emails → SMTP Settings, use the Gmail account as the sender and username, host `smtp.gmail.com`, port `465`, and the app password. Set the sender name to `AcaPulse`, then enable and save custom SMTP.
7. In Authentication → Emails → Templates, edit **Confirm sign up** and **Reset Password** so each email body includes `{{ .Token }}`. The app asks for the six-digit code.
8. In Authentication → Settings, set the minimum password length to 10 and require uppercase, lowercase, numeric, and symbol characters to match the app’s password checklist.
9. Restart Expo after editing `.env` or changing the authentication setup.

Gmail SMTP is a no-cost option for a small MVP, but Google may impose sending limits. For larger-scale use, move to a dedicated email provider and verified sending domain.

## Account roles

Anyone can create a student account. A person can request lecturer access; that account stays pending until an administrator approves it. Administrator access cannot be requested in the app.

To bootstrap the first administrator after that person has verified their email, run this in the Supabase SQL Editor, replacing the email:

```sql
update public.profiles p
set role = 'administrator', requested_role = 'student', access_status = 'active'
from auth.users u
where p.user_id = u.id and lower(u.email) = lower('admin@example.com');
```

After the first administrator is set, approve lecturer requests from the administrator workspace. Administrators can create courses and assign them to approved lecturers; lecturers can create and manage their own courses. Row-level security protects account, course, enrollment, assessment, and grade data.

## Current scope

The app has password sign-up with email OTP verification, password sign-in, OTP password recovery, lecturer approval, admin-assigned or lecturer-created courses, course joining, assessment creation with optional due dates, lecturer grade entry or editing, and student course-performance summaries with individual marks and feedback. The migration enforces role access, assessment weight totals, enrollment requirements, and score limits.
