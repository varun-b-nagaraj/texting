# Private Texting

A minimal two-person chat with a shared password, Supabase storage, realtime updates, reactions, replies, and presence.

## Quick start

1. **Create a Supabase project**.
2. Open **SQL Editor** in Supabase and run `supabase.sql`.
3. Enable Realtime for the `messages` table (Database → Replication or Realtime).
4. Copy `.env.example` to `.env.local` and fill in values from Supabase.
5. Install deps and run locally:

```bash
npm install
npm run dev
```

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key
- `NEXT_PUBLIC_CHAT_PASSWORD`: Shared password used at the gate screen

## Vercel deploy

1. Push this repo to GitHub.
2. Create a new project on Vercel and import the repo.
3. Add the environment variables from `.env.example` in the Vercel project settings.
4. Deploy.

## Notes

- This is intentionally simple and disables RLS. It is meant for private use by two people.
- Usernames are stored locally in each browser via localStorage.
# texting
