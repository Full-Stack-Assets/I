# ContractScan calibration kit

The build plan's one critical pre-launch step: *"test the analysis against 5–10 real
contracts so the output isn't confidently wrong."* This kit makes that repeatable.

## What's here

- `contracts/` — sample contracts (synthetic, with deliberately planted risky clauses).
- `expected/<name>.json` — the answer key for each contract: the red flags that *should* be
  caught, with keywords used for automatic recall scoring.
- `run.js` — runs every contract through the same prompt + JSON schema the app uses, scores
  **recall** (did it catch the planted flags?), and lists all findings so you can judge
  **precision** (did it invent or over-rate anything?).

## Run it

```bash
ANTHROPIC_API_KEY=sk-ant-...  node calibration/run.js
# try a cheaper model:
MODEL=claude-sonnet-4-6  node calibration/run.js
```

Requires Node 18+ (uses global `fetch`). Each run costs a few API calls.

## Add your own contracts (do this before launch)

1. Drop a real, **anonymized** contract into `contracts/my_contract.txt` (or `.pdf` — but the
   harness currently reads text; for PDFs, paste the text).
2. Create `expected/my_contract.json`:
   ```json
   {
     "contract": "my_contract.txt",
     "niche": "freelance",
     "planted_red_flags": [
       { "id": "short_id", "category": "Liability",
         "keywords": ["unlimited", "liability"],
         "note": "8.2 — what's wrong and why" }
     ]
   }
   ```
   A flag counts as "caught" if at least half its `keywords` show up across the model's
   findings. Keep keywords specific but not so narrow they miss a correct paraphrase.
3. Re-run. Aim for **high recall** on critical/moderate flags and **no confident false
   positives** before charging money.

## Reading the output

- `✅/❌` per planted flag = recall.
- "All model findings" = the precision check — read these yourself. A tool that's
  *confidently wrong* is the one real risk here (it's the legal-framing risk the build plan
  calls out), so weight false positives and mis-scored severity heavily.
- If recall is low, tighten the niche guidance / system prompt in `buildBody()` (kept in sync
  between `run.js` and `ContractScan.html`). If it invents issues, add a calibration
  instruction to the system prompt.
