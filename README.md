# CPM / PERT Solver (Activity-on-Arrow)
FastAPI backend (`api/index.py`) + Vite/React frontend (`frontend/`) as ONE Vercel project.

## Deploy
1. Push to GitHub, import in Vercel (root = repo root, framework "Other").
2. Add env vars from `.env.example` (GEMINI_API_KEY or ANTHROPIC_API_KEY for image extraction).
3. Deploy. Frontend calls `/api/*` on the same origin.

## Local
    pip install -r requirements-dev.txt && uvicorn api.index:app --port 8000
    cd frontend && npm i && npm run dev      # proxies /api -> :8000
    pytest tests

Vercel caps request bodies at ~4.5 MB; keep image uploads under 4 MB.
