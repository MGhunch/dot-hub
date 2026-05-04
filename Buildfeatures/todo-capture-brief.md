# Todo Capture — Build Brief

A unified capture system for Michael's Hunch todo list. One backend worker, many input doors. Replaces the current Claude-skill-with-MCP approach, which stalls in the car because every Airtable write triggers an approval prompt.

---

## Why we're building this

Right now todos live in an Airtable base. Capture happens through a Claude skill that uses the Airtable MCP. Two problems with that:

1. **Every MCP write needs an approval tap.** Auto-approve in the Claude.ai connector settings doesn't override it. Hands-free use (Siri while driving) is broken.
2. **Capture is locked to the Claude.ai chat surface.** Email, voice shortcuts, desktop hotkeys, the Hub itself — none of those can capture without opening a chat.

The classification logic (rewriting the dump as a tight Title, picking Bucket/Client/Urgent/Confidence) needs an LLM. That's the only part of the pipeline where Claude actually earns its keep. Everything else — auth, write, transport — is plumbing.

So: move the LLM call into a worker we control, expose it as an endpoint, and point as many doors at it as we want.

---

## Architecture

```
┌──────────────┐
│ Email door   │──┐
└──────────────┘  │
┌──────────────┐  │     ┌─────────────────────┐     ┌──────────┐
│ Siri door    │──┼────▶│  Dot Hub: /capture  │────▶│ Airtable │
└──────────────┘  │     │  (worker)           │     │ Todo     │
┌──────────────┐  │     └─────────────────────┘     └──────────┘
│ Claude skill │──┤              │
└──────────────┘  │              ▼
┌──────────────┐  │       ┌─────────────┐
│ Desktop      │──┘       │ Anthropic   │
└──────────────┘          │ API (Sonnet)│
                          └─────────────┘
```

**The worker** lives in Dot Hub on Railway. One endpoint: `POST /capture`. Accepts `{ text: "..." }`, returns `{ ok, todo, record_id }`.

**The doors** are independent and can be built in any order. Each one just POSTs `{ text }` to the worker.

---

## The worker

### Endpoint

```
POST https://dot.hunch.co.nz/api/capture
Content-Type: application/json
Authorization: Bearer <CAPTURE_TOKEN>

Request body:
{
  "text": "remind me to email Keith re the strat pack tomorrow"
}

Response (200):
{
  "ok": true,
  "todo": {
    "title": "Email Keith re strat pack",
    "bucket": "CLIENTS",
    "client": null,
    "urgent": false,
    "confidence": "Low"
  },
  "record_id": "recXXXXXXXXXXXXXX"
}

Response (4xx/5xx):
{
  "ok": false,
  "error": "<short message>"
}
```

### Auth

Single shared bearer token, env var `CAPTURE_TOKEN`. Each door stores it. No user accounts — this is a single-user system.

### What the worker does

1. Validates auth and request body
2. Calls Anthropic API with the classification prompt (see below) — model: `claude-sonnet-4-20250514`, max_tokens: ~300
3. Parses the JSON response
4. Resolves `client` code to Airtable record ID using the cached map
5. POSTs to Airtable REST API (`https://api.airtable.com/v0/app8CI7NAZqhQ4G1Y/tblm3We91K95mmLgc`) with the field IDs
6. Returns the parsed todo + Airtable record ID

### Required env vars

```
ANTHROPIC_API_KEY=...
AIRTABLE_API_KEY=...
CAPTURE_TOKEN=...
```

### Error handling

- Anthropic API failure → return 502 with `error: "classification_failed"`
- Airtable write failure → return 502 with `error: "write_failed"` (still return parsed todo so doors can show it)
- Malformed input → return 400
- Bad auth → return 401

Log every capture (text, parsed todo, success/failure) to Railway logs. No personal data risk — this is Michael's own todos.

---

## Classification prompt

This is the system prompt for the Anthropic API call. Ported from the existing `todolist` skill — the logic has been refined over months of use, don't rewrite it from memory.

```
You are a todo classifier for Michael Goldthorpe's Hunch agency todo list.

Given a raw dump of text, return a JSON object with these exact fields:

{
  "title": string,    // tight imperative rewrite, 3–8 words, action-first
  "bucket": "CLIENTS" | "OTHER",
  "client": string | null,  // 3-letter code, or null
  "urgent": boolean,
  "confidence": "High" | "Low"
}

Return ONLY the JSON. No prose, no markdown, no code fences.

## Title rules
- 3–8 words, imperative, action-first
- Strip padding ("Make sure to...", "I should...", "Need to remember to...")
- "remind me to email Keith about the strategy pack tomorrow" → "Email Keith re strategy pack"

## Bucket rules
- CLIENTS = anything for a client account, project, contact, OR for Hunch the agency itself (Hunch is treated as a client, code HUN)
- OTHER = personal, side projects, life admin, non-client
- Default to OTHER when in doubt

## Valid client codes
- ONE = One NZ Marketing
- ONS = One NZ Simplification
- ONB = One NZ Business
- SKY = Sky
- TOW = Tower Insurance
- FIS = Fisher Funds
- LAB = Laboratory (Hunch R&D)
- HUN = Hunch internal (Dot platform, agency admin, team)

## Client assignment
DO NOT auto-assign a client just because a company name appears.

A client name in the SUBJECT of the work is not the same as the CLIENT the work is for.
- "Email Keith re Tower strat pack" — Keith may not be at Tower. Tower is the topic. Leave client null.
- "Email Tracey at One NZ" — Tracey defaults to ONS (Simplification).
- "Sort SKY 044 invoice" — explicit job number → SKY.
- "Update the Tower tracker" — explicit client artefact → TOW.

Strong evidence (assign client):
- Explicit job number ("TOW 023", "SKY 044")
- Explicit "for [client]" or "[client]'s [thing]"
- Unambiguous artefact reference ("Tower tracker", "Sky brief")

Weak evidence (leave null):
- A person's name alone
- A company name that might be the topic
- Vague reference

If bucket is OTHER, client is always null.

## One NZ disambiguation
- "Business" mentioned with One NZ → ONB
- "Simplification" mentioned with One NZ → ONS
- Tracey at One NZ → ONS (she's in Simplification)
- Otherwise One NZ → ONE (Marketing default)
- Vodafone is the old name for One NZ → ONE by default

## Urgent
- true ONLY if the dump explicitly signals urgency: "ASAP", "urgent", "today", "this morning", "before [imminent date]", "!!!"
- Default false. Don't read between the lines.

## Confidence
Set Low if ANY of:
- A person was named and you guessed (or didn't assign) a client
- A client name appeared but you weren't sure if it was client or topic
- The dump was vague enough that you interpreted heavily
- Bucket choice felt like a coin-flip

Set High if:
- Explicit job number, or explicit "for [client]" framing
- Bucket is OTHER with no client
- Bucket is CLIENTS with code HUN and the dump clearly references Hunch internal work
- Crystal-clear personal todo

When in doubt, prefer Low. The Hub renders a "?" badge on Low cards so Michael can glance.

## Worked examples

Input: "Remind me to email Keith about the Tower strat pack tomorrow"
Output: {"title": "Email Keith re Tower strat pack", "bucket": "CLIENTS", "client": null, "urgent": false, "confidence": "Low"}

Input: "Sort SKY 044 invoice today"
Output: {"title": "Sort SKY 044 invoice", "bucket": "CLIENTS", "client": "SKY", "urgent": true, "confidence": "High"}

Input: "Don't forget to book All Blacks tickets before they sell out"
Output: {"title": "Book All Blacks tickets", "bucket": "OTHER", "client": null, "urgent": false, "confidence": "High"}

Input: "Add to my todo: ship the Dot platform Todo skill"
Output: {"title": "Ship Dot Todo skill", "bucket": "CLIENTS", "client": "HUN", "urgent": false, "confidence": "High"}

Input: "Email Tracey re the migration plan"
Output: {"title": "Email Tracey re migration plan", "bucket": "CLIENTS", "client": "ONS", "urgent": false, "confidence": "High"}
```

---

## Cached IDs

These are stable. Don't look them up at runtime — bake them into the worker as constants.

### Airtable

```
BASE_ID  = app8CI7NAZqhQ4G1Y
TABLE_ID = tblm3We91K95mmLgc  (Todo)
```

### Field IDs (Todo table)

```
Title       = fld0PHzeiD9l2OqIt   (text)
Bucket      = fldbv4pJxTYBKQIvw   (single select: "CLIENTS" | "OTHER")
Client      = fld5kpvLLe8BkGK8g   (linked record array, one ID)
Urgent      = fldfwtHFWfJm5KOge   (checkbox)
Confidence  = fldHF5fIoigmiTeCz   (single select: "High" | "Low")
```

Don't write `Done` (defaults false in Airtable). Don't write `Created` (auto-fill).

### Client record IDs (Clients table — for Client field linking)

```
ONE  = recEAFYlnPcooQrzC
ONS  = recMHaLoXwaxiRWQV
ONB  = recO1Jp0TXphkhg5q
SKY  = recZSdB01LYQLOFLF
TOW  = recSLnCYdG0L3KJqj
FIS  = recv8sQAToWv8QHlj
LAB  = recSB3pcAir8bMQ5g
HUN  = reckgCEXREn18UzZO
```

### Example Airtable payload

```json
POST https://api.airtable.com/v0/app8CI7NAZqhQ4G1Y/tblm3We91K95mmLgc

{
  "records": [{
    "fields": {
      "fld0PHzeiD9l2OqIt": "Email Joe at One",
      "fldbv4pJxTYBKQIvw": "CLIENTS",
      "fld5kpvLLe8BkGK8g": ["recEAFYlnPcooQrzC"],
      "fldfwtHFWfJm5KOge": false,
      "fldHF5fIoigmiTeCz": "Low"
    }
  }]
}
```

If `client` is null, omit the `fld5kpvLLe8BkGK8g` field entirely from the payload.

---

## The doors

Build the worker first, validate with curl, then add doors one at a time. Each door is independent — none of them depend on each other.

### 1. Claude skill (rewrite)

Replace the existing `todolist` skill. Same classification logic moves out of the SKILL.md and into the worker. The skill becomes:

1. Take Michael's dump
2. Use `web_fetch` (or `bash_tool` curl) to POST to `/capture`
3. Read the response
4. Reply `Saved.` (or `Couldn't save — <error>`)

No MCP, no approval prompt. The skill becomes 30 lines.

**Open question:** confirm `web_fetch` supports POST with a JSON body and Authorization header. If not, fall back to `bash_tool` running curl. Test both before committing.

### 2. Siri Shortcut

iOS Shortcut:
- Trigger phrase: "Hey Siri, add todo"
- Action: dictate text
- Action: POST `{text}` to `/capture` with bearer auth
- Action: speak the response title back ("Saved: Email Joe at One")

15–30 minutes once you've done one Shortcut. The fiddle is tuning Siri to recognise the trigger reliably while driving.

### 3. Email

Power Automate flow on the address that already triages Dot:
- Trigger: email arrives with subject prefix `todo:` (or sent to a dedicated address)
- Action: extract subject (minus the prefix) or first line of body as `text`
- Action: POST to `/capture`
- Action: reply with "Saved: <title>" or move to a Saved folder

Reuses the existing Power Automate infrastructure. No new auth surface.

### 4. Desktop hotkey

Raycast or Alfred command:
- Trigger: hotkey (⌘⇧T or similar) opens an input box
- Action: POST to `/capture`
- Action: native notification with the parsed title

Same shape as Siri but for the desk. Fastest capture surface when you're already typing.

---

## Build order

1. **Worker** — `/capture` endpoint. Test with curl until classification + write are bulletproof.
2. **Claude skill rewrite** — fastest validation that the worker works end-to-end.
3. **Siri Shortcut** — the actual reason this exists. Validate the car case.
4. **Email + desktop** — nice-to-have, build when you want them.

Don't build all four in one session. Get the worker right, ship it, see how the Claude+Siri combo feels for a week, then decide what to add.

---

## Effort estimate

**Honest answer to "is it a couple of hours?":**

- Worker (endpoint, classification call, Airtable write, error handling, deploy): 2–3 hours
- Claude skill rewrite: 30 min
- Siri Shortcut (first time, including debugging): 1 hour
- Email door (assuming existing Power Automate): 45 min
- Desktop hotkey: 30 min

**Phase 1 (worker + skill) ≈ 3 hours.** That's the minimum useful system — replaces what we have today and removes the MCP friction.

**Phase 2 (add Siri) ≈ +1 hour.** This is the bit that motivated the rebuild.

**Full system (all four doors) ≈ 5–6 hours.** A long afternoon.

The "couple of hours" framing is right for Phase 1. Phase 2 is also a couple of hours. Don't promise the whole thing in one sitting unless you're feeling it.

---

## Things to validate before building

- `web_fetch` POST with auth header works in a Claude.ai chat (especially mobile). If not, use `bash_tool` curl or accept that the skill door needs an alternative.
- Anthropic API JSON-mode reliability with the classification prompt. If parsing fails >1% of the time, tighten the prompt or add a retry-with-stricter-instruction step.
- Railway environment variable handling for `CAPTURE_TOKEN` — make sure it's not exposed in client-side bundles if Hub is Next.js.

---

## What "done" looks like

- I can dictate "Hey Siri, add todo, email Joe at One about the launch deck" while driving and it appears in the Hub correctly classified within 5 seconds, no taps.
- I can type a dump in a Claude chat and get `Saved.` with no approval prompt.
- I can send a `todo:` email from any client and it appears in the Hub.
- The Hub `?` badge fires on every Low-confidence capture.
- The classification prompt lives in one place. Updates apply to all doors.

---

## Notes for the next session

- The classification prompt is the asset. Don't lose it. Test changes against the worked examples before deploying.
- Don't recreate the cached IDs from scratch — they're in this brief. Look them up only if a write fails with a schema error.
- The whole point is no approval prompts. If you find yourself building anything that needs the Airtable MCP, stop and reconsider.
- Hub already has Airtable REST integration patterns from the Inside Voice / DOT work. Reuse them.
