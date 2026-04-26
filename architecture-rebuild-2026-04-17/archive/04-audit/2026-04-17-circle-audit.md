# Circle.so Audit — 2026-04-17

**Caveat:** Unlike the Supabase and Pinecone audits (which inventoried live data), this is a *capability audit* of the Circle.so platform and its APIs. No Circle API tokens are configured in this session, so this report describes what the platform offers — not what exists inside the ZPM community. A live-community audit is a separate follow-up that requires pulling an API token from Circle (Developers → Tokens) and running it against the Admin API v2.

Primary sources: [Circle Developer Platform](https://api.circle.so/), [Admin API v2 OpenAPI spec](https://api-headless.circle.so/api/admin/v2/swagger.yaml), [Circle pricing](https://circle.so/pricing), [Admin API usage & limits](https://api.circle.so/apis/admin-api/usage-and-limits).

---

## Summary

- **APIs offered:** 5 distinct surfaces — Admin API v1, Admin API v2, Headless Member API, Headless Auth API, Data API. Plus Websockets (Beta), Circle MCP, and webhooks (via Workflows).
- **Admin API v2 endpoints:** ~67 paths across 20 resource tags (counted from OpenAPI spec).
- **Auth models:** 4 — Bearer API token (Admin), JWT access token + refresh (Headless Member), Circle-account OAuth (MCP), Bearer Headless access token (Websockets).
- **Minimum plan for API access:** Business ($199/mo). Data API requires Plus Platform (custom pricing + sales call). Professional ($89/mo) has metered API access at higher per-request cost.
- **Rate limit:** 2,000 requests / 5 minutes per IP (shared across Admin API v2 and MCP).
- **Monthly quota (Admin API v2):** Business 5,000 / Enterprise+Plus 30,000 / Plus Platform 250,000. Enforcement began 2025-01-01.
- **Official MCP server:** Yes — hosted by Circle at `https://app.circle.so/api/mcp`. Works with Claude, Claude Code, Cursor, ChatGPT (beta), VS Code Copilot, Windsurf.
- **Auth SDKs:** Node.js, Ruby, Go, Python (no Deno — relevant for Supabase Edge Functions).
- **Webhooks:** Configured through the Workflows UI, not a managed REST resource. Cannot be provisioned programmatically.

**Most important finding for the rebuild:** Circle publishes a hosted MCP server. Much of what GravityClaw was doing around "let the agent browse community data" can be replaced by connecting Claude Code to Circle's MCP directly. This matches the rebuild's "don't outbuild Anthropic" principle.

---

## APIs

### Admin API v2 (primary integration surface)

- **Base URL:** `https://api-headless.circle.so/api/admin/v2/`
- **OpenAPI spec:** [swagger.yaml](https://api-headless.circle.so/api/admin/v2/swagger.yaml)
- **Auth:** `Authorization: Bearer <API_TOKEN>` — token minted from the Circle dashboard (Developers → Tokens). Admin-scoped.
- **Pagination:** `page` / `per_page` query params. Responses include `has_next_page`, `count`, `page_count`, `records`.
- **Plan gate:** Business plan and above.
- **Status:** Recommended default. v1 is frozen — no new endpoints going there.

Endpoint inventory (from the OpenAPI spec, 20 tags, ~67 paths):

| Tag | # | Example paths |
|---|---|---|
| Access Group Members | 4 | `POST/DELETE/GET /access_groups/{id}/community_members`, `GET /access_groups/{id}/community_member` |
| Access Groups | 5 | `POST/GET /access_groups`, `PUT/DELETE /access_groups/{id}`, `PATCH /access_groups/{id}/unarchive` |
| Advanced Search | 1 | `GET /advanced_search` |
| Chat Preferences | 1 | `GET /chat_preferences` |
| Comments | 3 | `GET/POST /posts/{post_id}/comments`, `DELETE /comments/{id}` |
| Community | 2 | `GET/PUT /community` |
| Community Members | 6 | `GET/POST /community_members`, `GET/PUT/DELETE /community_members/{id}`, `GET /community_members/{id}/profile_fields` |
| Community Segments | 4 | `GET/POST /community_segments`, `PUT/DELETE /community_segments/{id}` |
| Course Lessons | 3 | `GET /spaces/{space_id}/lessons`, `GET/PUT /spaces/{space_id}/lessons/{id}` |
| Course Sections | 2 | `GET/POST /spaces/{space_id}/sections` |
| Direct Upload | 1 | `POST /direct_uploads` |
| Events | 5 | `GET/POST /events`, `GET/PUT /events/{id}`, `GET /events/{id}/attendees` |
| Flagged Content | 3 | `GET /flagged_contents`, `GET/PUT /flagged_contents/{id}` |
| Forms | 6 | `GET/POST /forms`, `GET/PUT /forms/{id}`, `GET/POST /forms/{id}/submissions` |
| Invitation Links | 2 | `GET/POST /invitation_links` |
| Live Rooms | 1 | `GET /live_rooms` |
| Member Tags | 3 | `GET /member_tags`, `GET/POST /member_tags/{id}/tagged_members` |
| Posts | 5 | `GET/POST /posts`, `GET/PUT/DELETE /posts/{id}` |
| Spaces | 8 | `GET/POST /spaces`, `GET/PUT /spaces/{id}`, `GET/POST /spaces/{id}/members`, `GET /spaces/{id}/ai_summary`, `GET /space_groups` |
| Topics | 2 | `GET/POST /topics` |

Notable endpoints for the rebuild:
- `GET /spaces/{id}/ai_summary` — Circle generates an AI summary for a space. Competes with / complements anything we'd do in Pinecone.
- `GET /advanced_search` — admin-side search across the community. Entry point for dashboards.
- `GET /forms/{id}/submissions` — form submissions are API-accessible. Good for funneling Circle lead capture into the main inbox pipeline.
- `GET /community_members/{id}/profile_fields` — custom profile fields exposed. Necessary if ZPM member profiles hold ministry-role metadata.
- No Direct Messages endpoint in v2 (DMs appear only in Headless Member API + Websockets).

### Admin API v1 (legacy)

- **Base URL:** `https://api-v1.circle.so/`
- **Auth:** Same Bearer token mechanism as v2.
- **Status:** Not officially deprecated, but frozen — no new endpoints. Circle "strongly recommends" v2 for all new work and migration of existing integrations.
- **Reason v2 exists:** v1 lacked versioning, OpenAPI spec, performance on large datasets, and had missing endpoints.
- **Rebuild stance:** Skip v1 entirely. Go straight to v2.

### Headless Auth API

- **Base URL:** `https://app.circle.so/api/v1/headless/auth_token`
- **Purpose:** Mint JWT access tokens for member-authenticated calls to the Headless Member API.
- **Auth:** Admin Bearer token (a *separate* "Headless Auth" token from the Admin API token).
- **Flow:**
  1. Admin holds the Headless Auth token (server-side secret).
  2. Server posts to Auth API with token + one of: `email`, `community_member_id`, or `sso_id`.
  3. Auth API returns `access_token` (1-hour lifetime) + refresh token (1-month lifetime).
  4. Client uses `access_token` as Bearer against Member API.
- **SDKs:** Node.js, Ruby, Go, Python.

### Headless Member API

- **Base URL:** `https://app.circle.so/api/headless/v1/`
- **Auth:** Member JWT (`Authorization: Bearer <access_token>`).
- **OpenAPI spec:** Available at [api-headless.circle.so with `Member APIs` doc](https://api-headless.circle.so/?urls.primaryName=Member+APIs).
- **Resources covered:** posts, comments, events (with RSVP), notifications, chat rooms + messages (DMs and group chat), home feed, search (members/posts/content), user profile.
- **Plan gate:** Business plan and above.
- **Billing model:** MAU-based — "unique users (by user-ID) that create or consume content through SDK or API within a monthly billing cycle." Authentication-only endpoints don't count.
- **Use case fit:** Embedding Circle inside a custom app (e.g., a ZPM app surfacing discussions). Not the primary path for a back-office sync job — use Admin API v2 for that.

### Data API

- **Purpose:** Stream community event data into a warehouse.
- **Integration:** ETL-compatible (Airbyte recommended, Fivetran mentioned).
- **Auth:** Token-based — but access requires a sales call; not self-service.
- **Plan gate:** **Plus Platform only** (the top tier, well above Business).
- **Rebuild stance:** Out of reach at current plan tier. If the rebuild needs event-stream analytics later, this is an upgrade path, not a day-one option.

### Circle MCP (AI integration)

- **URL:** `https://app.circle.so/api/mcp`
- **Auth:** OAuth-style — sign in with Circle account on first connection, then choose **read-only** or **full access**.
- **Clients supported:** Claude (Pro/Max/Team/Enterprise), Claude Code, Cursor, ChatGPT (beta), VS Code + GitHub Copilot, Windsurf.
- **Tools exposed:**
  - Read-only: browse members, spaces, posts, events, courses.
  - Full access: create/manage posts, members, events, messages.
- **Plan gate:** All paid plans (i.e., Professional+).
- **Quota:** Usage counts against Admin API v2 request quota (same 5K/30K/250K monthly pool).
- **Rebuild implication:** This is the single most important finding in this audit — see Flag #1.

### Websockets (Beta)

- **URL:** `wss://app.circle.so/cable`
- **Auth:** Bearer Headless Member access token. Refresh every hour.
- **Channels:**
  - **NotificationChannel** — `newNotification`, `updateNewNotificationCount`, `resetNewNotificationCount`
  - **ChatRoomChannel** — `chatRoomCreated`, `chatRoomUpdated`, `chatRoomDeleted`, `newMessage`
  - **RoomChannel** (per-room: `chat-room-#{id}`) — `newMessage`, `updatedMessage`, `deletedMessage`
  - **ThreadsChannel** — `newMessage`, `updatedMessage`, `deletedMessage`, `chatThreadRead`
- **Status:** Beta. Do not build production-critical flows on it yet.
- **Rebuild fit:** Could bridge Circle events into Supabase Realtime for live dashboards if/when it leaves beta.

### Webhooks (via Workflows)

- **Mechanism:** Circle's no-code Workflows product has a "send webhook" action. Webhooks are not a separate REST resource.
- **Management:** UI-only — webhooks are created/edited/listed inside the Workflows dashboard, not via API.
- **Events observed** (from Circle's documentation of Workflow triggers — not a complete enumerated list):
  - Member: new member joins, member removed
  - Posts: new post published
  - Spaces: new space created
  - Community: new community created
  - Subscriptions: canceled, past due
  - Events: new event created
- **Signature verification:** Secondary sources suggest SHA-256 HMAC with a `circle-signature`-style header, but this is **not confirmed** in Circle's primary docs and needs verification against a test webhook payload before relying on it in an Edge Function.
- **Zapier requests do not count** against Admin API quota (useful loophole for low-volume automations).

---

## Auth Summary

| Surface | Token type | Where to get it | Lifetime |
|---|---|---|---|
| Admin API v1 / v2 | Bearer API token | Dashboard → Developers → Tokens | Long-lived (rotate manually) |
| Headless Auth API | Bearer Headless Auth token | Dashboard → Developers → Tokens (separate token type) | Long-lived (rotate manually) |
| Headless Member API | JWT access token | Minted by Auth API per member | 1 hour |
| Headless refresh | Refresh token | Returned with access token | 1 month |
| Circle MCP | OAuth session | Interactive sign-in on first connection | Session-based |
| Websockets | JWT access token (same as Member API) | Minted by Auth API | 1 hour |

---

## Rate Limits & Quotas

- **Shared IP rate limit:** 2,000 requests / 5 minutes / IP. Explicitly labeled as subject to change. Applies across Admin API v2 + MCP usage from that IP.
- **Monthly Admin API v2 quotas:**
  - Professional: (metered — see Flag #3)
  - Business: **5,000 requests/mo**
  - Enterprise / Plus: **30,000 requests/mo**
  - Plus Platform: **250,000 requests/mo**
- **Admin API overage:** $0.005/request on Professional, $0.002/request on Business.
- **Headless billing:** MAU-based. Overage: $0.50/MAU on Professional, $0.30/MAU on Business.
- **Zapier exemption:** Zapier-originated requests don't count toward the monthly quota.
- **Enforcement date:** 2025-01-01.
- **Usage reporting lag:** ~5 minutes (1-minute cache delay + ~4-min propagation).

---

## Plan Gating (confirmed from [pricing page](https://circle.so/pricing))

| Feature | Professional ($89/mo) | Business ($199/mo) | Plus (custom) |
|---|---|---|---|
| Admin API v1/v2 | Metered (overage rate only) | Included | Included |
| Headless Member API | Not listed | Included | Included |
| Circle MCP | Included (all paid plans) | Included | Included |
| Data API | ❌ | ❌ | Plus Platform only |
| Webhooks (via Workflows) | Not explicitly gated on pricing page | Available | Available |
| Custom SSO | Limited | Multiple options | Custom SSO |

**Not verified on pricing page:** exact webhook gating, exact MCP gating (claimed "all paid plans" via docs), Data API plan-tier naming ("Plus" vs "Plus Platform" vs "Enterprise"). These likely matter less than the Business-tier gate, which is the key bar for a real integration.

---

## SDK / Ecosystem

- **Official Auth SDKs:** Node.js, Ruby, Go, Python (from Circle's sitemap).
- **Official MCP server:** Yes — hosted, at `https://app.circle.so/api/mcp`.
- **Deno/Edge:** No official SDK. Supabase Edge Functions (Deno) will need to use raw `fetch()` calls or port the Node SDK.
- **OpenAPI spec:** Available for Admin API v2 — can be used to generate a typed client in any language.
- **Third-party clients:** Zapier integration exists (quota-exempt). No notable community SDKs beyond that in search results.

---

## Flags

### Rebuild Strategy

1. **🔑 Circle publishes an official MCP server. This changes the rebuild math.** Connecting Claude Code to `https://app.circle.so/api/mcp` gives the agent direct tool access to members, spaces, posts, events, and courses — read or write. For most "let Claude read/write Circle" use cases, we should use the MCP rather than building custom tools in Supabase Edge Functions. This directly matches `principles.md`'s "don't outbuild Anthropic" guidance. *Action: install Circle MCP in Claude Code and validate the read-only tool set against actual ZPM community.*

2. **Verify ZPM community is on Business or higher.** Admin API and Headless Member API require Business plan ($199/mo) or above. Professional ($89/mo) only offers metered access at a high per-request rate. If ZPM is on Professional, no meaningful sync integration is feasible without upgrading — budget implication.

3. **Professional-tier API access is expensive-per-request.** Admin API overage is $0.005/request on Professional vs $0.002 on Business — meaningfully different at scale. A daily sync of 1,000 requests = $5/day on Professional vs $2/day on Business. The Business plan's included 5K/mo absorbs most sync workloads; Professional does not.

### Integration Gotchas

4. **MCP usage eats the Admin API quota.** Both the MCP and direct Admin API calls draw from the same 5,000/mo pool on Business. Heavy MCP use in Claude Code will starve a scheduled sync job, or vice versa. *Action: monitor usage; plan for an upgrade trigger if combined usage approaches ~4,000/mo.*

5. **Webhooks are UI-configured, not API-provisioned.** There is no REST endpoint to create/list/update webhook subscriptions. Webhook config cannot be version-controlled, tested via IaC, or bootstrapped on a new community. Each webhook is a manual setup inside Circle's Workflow builder. *Action: document webhook config as manual-setup steps in `05-integration/circle-setup.md`.*

6. **Webhook signature verification is undocumented in primary sources.** Circle has HMAC signing per secondary sources (`circle-signature` header, SHA-256), but the primary Circle docs don't state this clearly. *Action: before any webhook-backed Edge Function goes to production, trigger a test webhook against a temporary receiver and document the exact header/algorithm observed.*

7. **Webhook event coverage is narrower than the REST resource surface.** The Workflows trigger list covers new member, new post, new event, new space, subscription state changes, member removal — but not comment create/update, course lesson completion, form submission, post like, access-group change, or member-tag change. Full community state sync requires polling the Admin API, not relying on webhooks alone.

8. **No official Deno SDK.** Supabase Edge Functions run on Deno. The published Auth SDKs are Node/Ruby/Go/Python — none of which run natively on the Edge Functions runtime. *Recommendation: use raw `fetch()` for the 2-step auth + API call pattern; the protocol is simple enough that an SDK is not necessary.*

9. **Websockets are Beta.** Valuable for live DM/notification bridging but not yet production-safe. Treat as optional/experimental during the rebuild; don't let Realtime dashboard wiring depend on it.

10. **Data API is out of reach on current plan.** Requires Plus Platform (custom pricing, multi-thousand/mo tier) and a sales call. Event-stream-to-warehouse is not a near-term option — poll the Admin API and build event log in Supabase ourselves.

11. **Shared rate limit: 2,000 req / 5 min / IP.** Supabase Edge Functions run from shared outbound IPs. In theory, a noisy neighbor on the same Supabase region could bump us up against Circle's per-IP rate limit. In practice, 2,000/5min is very generous for sync workloads, but flag it for retry/backoff design.

12. **No DM (direct message) access via Admin API v2.** DMs are only accessible via the Headless Member API (member-scoped JWT) and Websockets. If the rebuild ever wants to index DMs into Pinecone, we'd need to rotate through member tokens — a heavier integration pattern.

### Data Schema Notes

13. **Custom profile fields are a separate endpoint.** `GET /community_members/{id}/profile_fields` — to mirror full member profiles we need a second call per member. N+1 problem at scale; batch cautiously.

14. **`ai_summary` endpoint exists on spaces.** Circle already generates AI summaries for spaces. Decision: do we consume Circle's summaries (cheaper, fewer tokens) or build our own (more control, Pinecone-backed)? For ZPM, Circle's summaries are probably fine for low-stakes surfacing; our own embeddings matter more when we want cross-community semantic search.

15. **Courses are fully exposed.** `GET /spaces/{space_id}/sections` + `GET /spaces/{space_id}/lessons`. If ZPM offers paid courses on Circle, we can mirror the curriculum and enrollment status into Supabase/Pinecone to power recommendations or context-aware assistant replies.

16. **Forms + submissions are API-readable.** Circle forms can feed the capture pipeline (`inbox.capture()`) — lead magnets and member surveys become another "entry point" alongside Telegram/CEO Desk/webhook.

---

## Rebuild Considerations

### Supabase tables (new, if we do a sync integration)

Suggested schema (all with `circle_` prefix to namespace cleanly):

| Table | Purpose | Key source |
|---|---|---|
| `circle_members` | Member directory mirror | `/community_members` + `/profile_fields` |
| `circle_member_tags` | Member ↔ tag join | `/member_tags/{id}/tagged_members` |
| `circle_spaces` | Spaces + space_groups | `/spaces` + `/space_groups` |
| `circle_posts` | Post mirror for search + embedding | `/posts` |
| `circle_comments` | Comment mirror | `/posts/{id}/comments` |
| `circle_events` | Event calendar | `/events` + `/events/{id}/attendees` |
| `circle_courses` | Course structure | `/spaces/{id}/sections` + `/lessons` |
| `circle_form_submissions` | Lead capture from Circle forms | `/forms/{id}/submissions` |
| `circle_webhook_events` | Raw webhook payload log for debugging | Webhook receiver |

All tables should include `circle_id`, `updated_at_circle`, and `synced_at` columns to support delta sync.

### Pinecone namespace

- New namespace: `circle` (or split: `circle-posts`, `circle-lessons`, `circle-comments` if corpora diverge).
- Metadata schema: `{ text, type, circle_id, space_id, author_id, created_at, url }`.
- Aligns with the inconsistency flag from the Pinecone audit — define the `circle_*` schema explicitly from day one.

### Edge Functions

- `circle-sync` — scheduled (hourly). Pulls deltas via Admin API v2 using `updated_at` cursors. Writes to `circle_*` tables. Enqueues embed jobs for new posts/comments/lessons.
- `circle-webhook` — HTTP endpoint. Receives Circle webhooks, verifies signature (once we confirm the algorithm — see Flag #6), normalizes payload, inserts into `circle_webhook_events`, dispatches to downstream triggers.
- `circle-embed` — background. Pulls un-embedded rows from `circle_posts`/`circle_comments`/`circle_lessons`, embeds via OpenAI, upserts to Pinecone.

### Claude Code integration (the primary near-term lever)

- Install Circle MCP in Claude Code.
- Verify read-only tool set against ZPM community (members list, posts in a space, events, course structure).
- Write a skill (`circle-community-ops`) that documents common patterns — "find members who haven't posted in 30 days," "pull all posts from space X this week," "draft a response to the latest unanswered thread."
- This unlocks most of the day-to-day agent-touches-Circle workflows without needing any custom sync code. Build the sync pipeline only for the workloads that *must* live in Supabase (analytics, cross-tool search, webhook-driven automation).

---

## Open Questions for Edmund

1. What plan tier is the ZPM Circle community on? (Needed to confirm API access.)
2. ~~Is there an existing Headless/Admin API token anywhere in 1Password or environment files that we should catalog alongside the Supabase/Pinecone credentials?~~ **Resolved 2026-04-17** — ZPM v2 Admin API token saved to `ops/.env` as `CIRCLE_ADMIN_API_TOKEN`. See decisions log entry "Circle Admin API v2 token secured; provisioning kit drafted".
3. Scope of initial Circle → Supabase sync: all resources, or start with members + posts only?
4. Do we want to consume Circle's native `ai_summary` per space, or only use it as a fallback when our own Pinecone summary isn't available?
5. Any interest in the Headless Member API for an eventual custom ZPM app, or is the integration purely admin-side for now?

## Follow-up work tracked

- **Provisioning kit** (drafted 2026-04-17): `05-design/circle-provisioning/` — JSON template + Deno script for scripted community setup and re-setup. See decisions log.
- **Q12** (open): whether the provisioner becomes a Supabase Edge Function + dashboard button, or stays CLI-only.
