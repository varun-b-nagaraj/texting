# Neniboo Chat

A minimal two-person chat with room-code access, Supabase storage, reactions, replies, and image uploads.

## Quick start

1. **Create a Supabase project**.
2. Open **SQL Editor** in Supabase and run `supabase.sql`.
4. Copy `.env.example` to `.env.local` and fill in values from Supabase.
5. Install deps and run locally:

```bash
npm install
npm run dev
```

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key

## Vercel deploy

1. Push this repo to GitHub.
2. Create a new project on Vercel and import the repo.
3. Add the environment variables from `.env.example` in the Vercel project settings.
4. Deploy.

## Notes

- This is intentionally simple and disables RLS. It is meant for private use.
- Usernames are stored locally in each browser via localStorage.
- Room access is allowlisted in `app/page.jsx` via `ALLOWED_ROOM_CODES`.
# texting
