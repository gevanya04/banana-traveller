# 🍌 Banana Traveller

A private app for our travel crew: share photos and videos, react and comment, poke each other, chat (squad chat + private DMs), and plan events with an **Add to Google Calendar** button.

Built with plain HTML/CSS/JavaScript, **Supabase** (login, database, private file storage, realtime) and **Vercel** (hosting + two small admin functions).

---

## Setup (about 15 minutes, one time)

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → **New project**. Pick the Singapore region if offered.
2. Open **SQL Editor → New query**, paste everything in [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. **Authentication → Sign In / Providers**: keep **"Allow new users to sign up"** on, so friends can create accounts. Anyone who signs up joins straight away, so only share the link with friends.
4. **Authentication → URL Configuration**:
   - **Site URL**: your Vercel address, e.g. `https://banana-traveller.vercel.app`
   - **Redirect URLs**: add the same address with `/**` on the end, e.g. `https://banana-traveller.vercel.app/**`
5. **Project Settings → API**: copy the **Project URL**, the **anon / publishable key**, and the **service_role / secret key**.

### 2. Add the public keys to the app
Edit [`config.js`](config.js) in this repo and paste in the **Project URL** and **anon key**. Commit the change.
(The anon key is meant to be public. Never put the service_role / secret key in this file.)

### 3. Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import **gevanya04/banana-traveller**.
2. Framework preset: **Other**. No build command needed.
3. Under **Environment Variables**, add:
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role / secret key |
4. Click **Deploy**. Every future push to `main` redeploys automatically.

### 4. Make yourself the admin
1. In Supabase, **Authentication → Users → Add user → Send invitation**, using your own email.
2. Open the email, click the link, set your name and password.
3. In **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
4. Refresh the app. The **Me** tab now has an **Admin** section where you invite friends by email and remove members.

---

## How things work

- **Privacy**: every table has row-level security. Nothing is readable unless you're a signed-in member. Photos and videos live in a private bucket and load through links that expire after an hour. Search engines are told not to index the site.
- **Direct messages** are visible only to the two people in them — not even the admin can read them. The admin can delete messages in the squad chat.
- **Sign-up**: friends tap **Create account** on the sign-in page, confirm their email, and they're in. To require admin approval instead, change `'approved'` to `'pending'` in `handle_new_user` in the schema — the Admin section then shows an Approve / Decline list.
- **Admin** can approve, invite and remove members, and delete any memory, comment or event.
- **Removing a member** deletes their account, uploads, comments, reactions, pokes, messages and the events they created.
- **Google Calendar**: each event has an "Add to Google Calendar" button that opens Google Calendar pre-filled. It's a copy — if the event changes in the app, tap the button again.

## Limits on the Supabase free plan
- 50 MB per file (the app blocks bigger uploads), 1 GB total storage.
- Free projects **pause after a week with no activity** — open the Supabase dashboard to restore it.
- If videos fill the 1 GB, upgrade to Supabase Pro.

## Files
```
index.html            app shell + bottom tabs
styles.css            all styling
config.js             public Supabase URL + anon key (edit this)
js/                   app code: login, memories, events, chat, friends, me/admin
api/invite.js         admin-only: email an invite (Vercel function)
api/remove-member.js  admin-only: remove a member (Vercel function)
supabase/schema.sql   database tables, security rules, storage, realtime
```
