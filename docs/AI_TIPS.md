# Offline AI tips

`backend/routes/tips.js` is the "AI tips" feature — fully offline, no model, no network call. It reads the local database and applies straightforward rules:

- Low stock on finished goods or raw materials
- Week-over-week sales swings per product (up or down)
- Outstanding customer credit that needs following up
- A cash ledger sanity check (negative balance = a missing entry somewhere)

This was a deliberate choice over calling out to an LLM: it's instant, costs nothing, needs no internet, and can never hallucinate a wrong number — which matters more than eloquence for a shop floor tool.

## Upgrading to a real local LLM later

If you outgrow the rule-based tips and want more natural, flexible commentary, the upgrade path is:

1. Install [Ollama](https://ollama.com) on the server machine and pull a small model (`ollama pull phi3:mini` or `llama3.2:3b`).
2. In `routes/tips.js`, after computing the same rule-based facts (stock levels, sales trend, cash balance), pass them as structured context in a prompt to `http://localhost:11434/api/generate` and let the model phrase the summary.
3. Keep the rule-based checks as the source of truth for numbers — only hand the *phrasing* to the model, never let it invent figures.

This keeps the API response shape (`{ generated_at, tips: [{ level, area, message }] }`) identical, so the frontend needs no changes either way.
