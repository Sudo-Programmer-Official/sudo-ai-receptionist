# Vercel Deployment

Recommended Vercel project:

- Project name: `sudo-ai-receptionist-web`
- Framework preset: `Vite`
- Root Directory: `apps/receptionist-web`
- Install Command: `npm install --include=dev`
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment variable: `VITE_RECEPTIONIST_API_URL=https://sudo-ai-receptionist-api.onrender.com`

## Notes

- The frontend is now a static browser app built by Vite.
- The browser talks to the backend only through `VITE_RECEPTIONIST_API_URL`.
- The Vercel rewrites are for deployment convenience and SPA fallback only.

## Root-directory fallback

If workspace installation under the app root fails, deploy from the repository root instead:

- Root Directory: blank
- Install Command: `npm ci`
- Build Command: `npm run build:web`
- Output Directory: `apps/receptionist-web/dist`

