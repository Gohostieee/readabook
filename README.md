# readabook

readabook is a Clerk-enforced Next.js and Convex app that turns YouTube
transcripts into saved, book-like reading experiences.

## What It Does

- Requires Clerk auth for every app route except `/sign-in` and `/sign-up`.
- Accepts a YouTube URL and language code from an authenticated user.
- Uses Supadata to fetch or poll for the video transcript.
- Uses the OpenAI Agents SDK to format the transcript into readabook markup while
  preserving the spoken words.
- Stores one canonical Convex book per video/language/settings key.
- Saves canonical books into each user's private library, including save-on-open
  when a signed-in user visits `/books/[bookId]`.

## Required Setup

Create these environment variables before real end-to-end use:

### Next.js / Vercel

```bash
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CONVEX_SITE_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
```

### Convex

```bash
SUPADATA_API_KEY=
OPENAI_API_KEY=
READABOOK_OPENAI_MODEL=gpt-5.2
```

Configure Clerk's Convex JWT template with audience `convex`. Then replace the
placeholder issuer in `convex/auth.config.ts` with your Clerk issuer URL before
production deploy, or update it during setup to match your Clerk instance.

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npx convex codegen
npm run lint
npm run build
```

External API calls are server-side only. If `OPENAI_API_KEY` is missing, the
formatter uses a transcript-preserving fallback so the job still creates a book
for setup-time smoke tests.
