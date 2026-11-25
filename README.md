# GoldPriceIndia.live

Real-time Indian gold price tracker (`24K`, `22K`, `20K`, `18K` in INR) powered by Cloudflare Workers and static assets.

## Project Structure
- `src/index.js` — Edge-cached `/api/rates` Cloudflare Worker fetching live `XAU/USD` and `USD/INR` rates every 60 seconds.
- `public/index.html` — Responsive frontend dashboard with Raw Bullion Spot vs. Estimated Retail (+6% Duty & 3% GST) toggle, standard weight comparison table, and jewellery price calculator.
- `wrangler.jsonc` — Cloudflare Worker & Static Assets configuration.
- `.github/workflows/deploy.yml` — Automated GitHub Actions deployment workflow.

## Setup & Deployment
1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub **Settings → Secrets and variables → Actions**.
2. Push to `main` to deploy automatically, or run `npm install && npx wrangler deploy` locally.
