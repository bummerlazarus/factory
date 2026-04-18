# Q11 — Hosting & Privacy Model for the Dashboard

**Date:** 2026-04-17
**Status:** Decision memo. Edmund decides.
**Related:** `03-decisions/open-questions.md` Q11, `05-design/dashboard-architecture.md`

---

## TL;DR + recommendation

**Recommend option (a): Vercel + Supabase Auth (magic link), single-user RLS.** The Telegram burn was Railway reliability, not Vercel privacy. Vercel Hobby on a Next.js app with auth-gated pages is boringly reliable and matches the "will not outbuild Anthropic" principle. The capture webhook lives on Supabase Edge Functions regardless of where the UI runs — so the "public URL" concern is already decided by the pipeline, not by the dashboard. Tailscale-only (b) sounds cleaner but forces Edmund to run and babysit home hardware to use his own dashboard on the road; that is the exact class of friction the rebuild is supposed to remove. Keep (d) as an optional later evolution if a specific surface (e.g. embedded Notion views, family members) earns it.

---

## Decision criteria

Derived from `principles.md`, `profile.md`, `workflows-and-capture.md`, and prior failure modes:

1. **Privacy** — thoughts, journals, voice-memo transcripts, client notes live here. Must be Edmund-only, not "public with obscurity."
2. **Reliability** — Railway burned him once. Solution must be boringly stable; can't require Edmund to restart a Mac mini before a voice dump works.
3. **Velocity** — solo operator, time over money. Setup that takes a weekend is too much.
4. **Accessibility** — phone, desktop, on the road, at a conference, airport Wi-Fi. Capture must work regardless of network posture.
5. **Webhook reachability** — iPhone Shortcuts, email forwarding, Claude MCP tool, Slack slash commands all POST to a URL. That URL must be internet-reachable.
6. **Operational burden** — anything Edmund has to maintain past initial setup is a tax on the rebuild's whole thesis.

---

## The four options

### (a) Vercel + auth (Supabase Auth or Clerk), publicly reachable but locked

**Concretely:** `/factory/dashboard/` deploys to Vercel Hobby. Every page behind `supabase.auth.getUser()` middleware; no session → redirect to magic-link login. RLS policies on every table scope to Edmund's `user_id`. Service role key stays server-side for Edge Function writes.

**Who can reach it:** Anyone can hit the URL; only Edmund's email gets past the magic link. Session cookies are httpOnly, SameSite=Lax.

**Webhook:** Lives as a Supabase Edge Function (`capture`). Protected by shared-secret header (`x-capture-secret`) plus optional HMAC for signed sources. Nothing to do with Vercel.

**Failure modes:** Vercel outage (rare, decoupled from capture path — Edge Function still works). Auth-provider outage (Supabase Auth is the same system as the DB, so single point but already the source of truth). Magic-link phishing (mitigate: short TTL, single-use). Stolen session cookie (mitigate: short session, device fingerprint).

**Velocity:** Lowest. Existing Next.js app deploys to Vercel in ~15 min. Supabase Auth middleware is ~50 lines. Edmund already has Vercel MCP configured.

**Reliability risk:** Low. Vercel + Supabase is the stack Anthropic, OpenAI app teams, and Edmund's other clients use. Decoupled from home network and power.

**Setup:** `vercel link`, enable Supabase Auth with email provider, add middleware, deploy, add `edmund.j.mitchell@gmail.com` as allowed email, done.

---

### (b) Tailscale-only self-hosted

**Concretely:** Next.js app runs as a process on a Mac mini / old MacBook / NAS at the Grapevine house. Tailscale on that machine exposes it on the Tailnet. Edmund's iPhone has the Tailscale iOS client; he hits `http://factory.edmund-tailnet.ts.net:3000` when logged into the Tailnet.

**Who can reach it:** Only devices in Edmund's Tailnet. Truly private.

**Webhook:** This is where (b) leaks. The `capture()` endpoint *must* be internet-reachable — iPhone Shortcuts can't assume Tailnet, email-forward services (SendGrid parse) can't VPN in, and Claude's remote MCP tool needs a public URL to POST to. So the webhook still lives on **Supabase Edge Functions** (public, shared-secret protected). The "self-hosted" applies only to the browser UI, not the capture pipeline. This is fine — it's just important to name: option (b) doesn't actually eliminate the public URL, it just relocates the browser.

**Failure modes:** Home power outage, ISP outage, Mac mini OS update reboots the process, Tailscale auth token expires, macOS App Nap pauses the Node process, iCloud sync interferes, the machine goes to sleep while Edmund is at a conference. This is the *exact* class of problem that killed the Telegram app. Running your own always-on server while traveling is an ops job.

**Velocity:** Medium. Initial Tailscale setup is 20 minutes. But every time the machine restarts or the process dies, Edmund has to notice and fix it — often remotely. PM2 / launchd / Docker helps but doesn't eliminate.

**Reliability risk:** High for a solo, ADHD operator who travels. The failure mode isn't a crash — it's silent unavailability while he's away from home and can't reach the dashboard to dump a voice memo.

**Setup:** Buy/repurpose a Mac mini, install Tailscale, set up launchd plist or PM2 for the Next.js process, set up Cloudflare Tunnel or accept Tailnet-only access, configure iPhone Tailscale client.

---

### (c) Skip dashboard v1 — Claude chat + Supabase + Notion only

**Concretely:** No dashboard deployed. Capture happens via CEO Desk Claude project (MCP tool calls `capture()` Edge Function). Triage happens in Notion. Dashboard code stays on `localhost:3000` for occasional local use.

**Who can reach it:** Nobody — there is no dashboard. Supabase data is reachable via MCP only.

**Webhook:** Same as (a)/(b) — Supabase Edge Function, public, shared secret.

**Failure modes:** Loss of proactive surfacing (pillar 5 of the vision). No "what you pushed forward today" view. No visual goal progress. No Realtime inbox. These are things Claude chat genuinely can't do well — you'd be degrading the whole rebuild thesis to avoid a deployment decision.

**Velocity:** Highest *in the short term* (zero dashboard work). But defers pillars 1/4/5 of the vision that specifically need the dashboard as the surfacing surface. So velocity is an illusion — you'd be shipping less of what the rebuild is for.

**Reliability risk:** N/A for the dashboard; but the rebuild's value prop weakens.

**Setup:** None. But a missed opportunity — the migration work (Track A) is well underway.

---

### (d) Hybrid — public read-only surfaces + Tailnet-only write paths

**Concretely:** Vercel hosts read-only recap pages (daily briefing, "what you pushed today", Notion-embedded views). Writes, task approvals, and triage live on a Tailnet-only instance. Edmund uses the Tailnet instance at his desk; the phone hits the Vercel recap on the road.

**Who can reach it:** Split — recap is public-behind-auth, writes are Tailnet-only.

**Webhook:** Same Supabase Edge Function as always. No change.

**Failure modes:** Two surfaces to maintain, two auth models, split state (write on one, display another). Complexity pays down only if Edmund has a specific need — e.g. "I want the ZPM team or a Real+True beta reader to see a read-only dashboard." He doesn't today.

**Velocity:** Worst — you're building (a) and (b) and gluing them.

**Reliability risk:** Medium (Tailnet half inherits (b)'s issues) + complexity cost.

**Setup:** (a) + (b) combined, plus a conscious UI split of which routes are read-vs-write.

---

## Key insight

**The webhook / capture pipeline's public URL is decoupled from the dashboard's hosting.** In all four options the `capture()` endpoint lives on Supabase Edge Functions (public, shared-secret + HMAC). The "Tailscale keeps captures private" intuition is incorrect — anything that has to accept an iPhone Shortcut, a forwarded email, or a Claude MCP call needs to be internet-reachable. Supabase's auth + RLS + TLS is doing the privacy work, not Vercel vs. home hardware.

What the hosting choice *actually* affects is **who can load the browser UI**. That's a much narrower question than "where do my captures live." Edmund's thoughts live in Supabase in all four cases.

Also worth naming: Telegram's real advantage over a hosted dashboard isn't encryption — it's that Telegram *never goes down* because someone else runs it. Option (a) gets that property. Option (b) explicitly gives it up.

---

## Tradeoff table

| Criterion | (a) Vercel+auth | (b) Tailnet | (c) Skip v1 | (d) Hybrid |
|---|---|---|---|---|
| Privacy | Strong (auth + RLS + TLS) | Strongest (unreachable) | N/A | Split |
| Reliability | High (managed) | Low (home infra) | N/A | Medium |
| Velocity | Fast (≈ hours) | Medium (≈ day+) | Fastest now, slowest overall | Slowest |
| Phone access on road | Yes | Only on Tailnet | N/A | Recap yes, write no |
| Webhook reachability | Edge Function (public) | Edge Function (public) | Edge Function (public) | Edge Function (public) |
| Operational burden | ~zero | Ongoing (babysit host) | Zero | Highest |
| Matches "won't outbuild Anthropic" | Yes | No (self-hosted infra) | Yes | Partial |
| Unblocks vision pillars 4–5 | Yes | Yes | No | Yes |

---

## Recommendation + rationale

**Go with (a) Vercel + Supabase Auth, single-user.**

Why:
- The Telegram wound was **reliability of self-hosted infra on cheap PaaS**, not "public URLs are insecure." Option (b) re-creates the wound in a different color.
- Edmund's own stated priorities — time over money, reliability over cleverness, won't outbuild Anthropic — all point here.
- The capture pipeline's public surface is independent of this choice. Privacy of thoughts ≠ hosting of browser UI.
- Existing Vercel MCP + Supabase MCP + Next.js 16 app means deployment is a short afternoon of work.
- Single-user RLS + magic-link auth is a well-trodden path with named failure modes.

### What would change my mind

- **Edmund names a specific non-Edmund viewer** (family member, employee, ZPM beta tester) who needs dashboard access. That tips toward (d), because you'd need a clean public/private split anyway.
- **A regulatory / client-contractual concern** surfaces — e.g. a client engagement that prohibits their data from touching any third-party web host. Then (b) for that data specifically.
- **Edmund decides he genuinely enjoys running home infra** and a Mac mini / NAS is already on for other reasons (Plex, backups, etc.). Then (b) is low-marginal-cost and you keep everything local.
- **The dashboard grows a compute-heavy workload** (local LLM inference, large video processing) that Vercel can't host. Then a self-hosted worker on Tailscale for that specific function — but the dashboard itself still goes on (a).

---

## Open sub-questions if (a) is chosen

1. **Auth provider — Supabase Auth vs. Clerk?**
   Supabase Auth is free, already in the stack, magic link is one config flip, RLS integrates natively. Clerk is nicer UX (passkeys, device management) but adds another vendor and $0–25/mo. **Leaning: Supabase Auth** — no reason to add a vendor for a single-user app.

2. **Session length** — 7-day rolling vs. 30-day? Phone convenience vs. lost-device window. Leaning: 30 days on trusted devices, 7 days default, explicit "trust this device" toggle.

3. **Allowed email list** — just `edmund.j.mitchell@gmail.com`? Or add a burner for auth recovery? Leaning: primary + one backup in 1Password.

4. **Webhook auth shape** — shared secret in header is MVP. Do we upgrade to per-source HMAC signatures (iPhone Shortcut, email parse, Claude MCP each with their own secret)? Leaning: yes, one-week follow-up, not launch-blocking.

5. **Q10 security hardening** — enable leaked-password protection in Supabase Auth, RLS on the 7 competitive-intel tables, verify public storage bucket policy. Do Q10 as a mini-phase *before* the dashboard goes live on Vercel.

6. **Vercel project settings** — team vs. personal account? Password-protect preview deployments? Leaning: personal, yes protect previews.

7. **Domain** — `factory.edmund.to` or similar custom domain? Matters for magic link sender credibility and memorability. Leaning: yes, pick one now and configure DNS once.

8. **Do we still want a Tailnet fallback?** If Vercel has an incident during a critical capture moment, having a localhost-accessible copy of the dashboard is a nice belt-and-suspenders. Cost: zero (it's the existing `pnpm dev`). Recommend keeping local dev as a personal backup without formalizing it as "option (b) lite."
