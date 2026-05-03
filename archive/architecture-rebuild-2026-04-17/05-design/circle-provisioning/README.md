# Circle Community Provisioning

Templatize a Circle.so community as JSON + image assets, then run a single script to create or update the whole community via the Admin API v2.

Built for the ZPM relaunch — same pattern reusable for EM, FAI, Real+True, and Digital Continent client communities.

## What it does

From one JSON file it will:

- Upload cover images, custom emoji (light + dark), and OpenGraph images via Circle's direct-upload flow
- Create or update the community's top-level branding (name, meta tags, logo)
- Resolve space groups by slug, creating them if the API allows
- Create topics and member tags
- Create or update every space with full config — cover image, emoji, visibility, locked-state copy, SEO tags, notification defaults, course settings, chat settings, etc.
- Write an `id-map.json` next to your template so reruns know what already exists

Re-runs are safe. On rerun it matches by slug and issues `PUT` instead of `POST` for existing records.

## Setup

### 1. Grab a v2 Admin API token

In Circle: **Dashboard → Developers → Tokens → New Token**. Type: **Admin V2**. Copy the token.

### 2. Store it in `ops/.env`

Open `/Users/edmundmitchell/factory/ops/.env` and add:

```
# Circle
CIRCLE_ADMIN_API_TOKEN=<paste-here>
CIRCLE_COMMUNITY_SLUG=zpm
```

### 3. (Later, for Edge Function deployment)

```bash
supabase secrets set CIRCLE_ADMIN_API_TOKEN=... --project-ref obizmgugsqirmnjpirnh
```

## Run

From this directory:

```bash
# load env, then:
export $(grep -v '^#' ../../../ops/.env | xargs)

# dry-run to see what would happen
deno run --allow-net --allow-read --allow-env provision.ts community-template.example.json --dry-run

# for real
deno run --allow-net --allow-read --allow-env provision.ts community-template.example.json

# update existing spaces by slug (read id-map.json, PUT existing records)
deno run --allow-net --allow-read --allow-env provision.ts community-template.example.json --update
```

If you don't have Deno: `brew install deno`. (Or let me know and I'll port it to plain Node.)

## Template structure

See `community-template.example.json`. Top-level keys:

```jsonc
{
  "community": { /* community-wide branding, logo_path, meta tags */ },
  "space_groups": [ { "slug", "name", ...group settings } ],
  "spaces": [ { "slug", "name", "space_group_slug", ...every space field } ],
  "topics": [ { "name" } ],
  "member_tags": [ { "name" } ]
}
```

### Every space can carry (verified from Admin API v2 OpenAPI spec)

**Branding / visual**
- `cover_image_path` → local image file, uploaded and swapped for `cover_image` signed_id
- `cover_image_visible`, `cover_image_display_style` (`normal` | `wide`)
- `emoji` (native emoji string) OR `custom_emoji_path` + `custom_emoji_dark_path` (light/dark uploaded)

**Locked state**
- `locked_page_heading`, `locked_page_description`, `locked_button_label`, `locked_button_url`, `show_lock_icon_for_non_members`

**Access**
- `is_private`, `is_hidden`, `is_hidden_from_non_members`, `hide_from_featured_areas`, `hide_from_sidebar`, `hide_members_count`

**Layout**
- `display_view`, `default_sort`, `default_tab`, `show_tab_bar`, `visible_tabs`, `hide_right_sidebar`, `show_next_event`, `pinned_posts_label`, `default_comment_sort`, `default_member_sort`

**Posting rules**
- `is_post_disabled`, `disable_member_post_covers`, `prevent_members_from_adding_others`, `require_topic_selection`, `hide_post_settings`
- `topic_names` (array of strings — resolved to IDs via the `topics` section)

**Notifications**
- `default_notification_setting`, `default_in_app_notification_setting`, `default_mobile_notification_setting`, mention-level variants
- `event_auto_rsvp_enabled`

**SEO**
- `meta_tag_attributes.meta_title`, `meta_description`, `opengraph_title`, `opengraph_description`
- `meta_tag_attributes.opengraph_image_path` (local file → uploaded)

**Course spaces**
- `space_type: "course"` + `course_setting`: `course_type`, `enforce_lessons_order`, `custom_section_label`, `custom_lesson_label`, `new_comment_notification_enabled`

**Chat spaces**
- `chat_room_description`, `chat_room_show_history`

## Known limitations / things to verify on first real run

1. **Image field names are unverified.** The OpenAPI response schema shows `cover_image_url`, but the *request* field name when passing a signed_id isn't in the public docs. The script uses `cover_image` / `custom_emoji` / `custom_emoji_dark` (conventional Rails ActiveStorage pattern). If a request fails with "unknown field," watch the error, adjust the field name in `resolveImageInputs()` inside `provision.ts`, and rerun. The `id-map.json` cache means successful uploads won't re-upload.

2. **Space group creation may not be exposed on v2.** The OpenAPI spec lists `GET /space_groups` but not `POST`. The script attempts `POST` and falls back to a warning — if creation fails, create the space groups in the Circle UI, then rerun. The script will resolve them by slug on the second pass.

3. **Community PUT fields are unverified.** The spec confirms `PUT /api/admin/v2/community` exists but doesn't publish the full body schema. The script passes whatever is in `template.community` as-is and catches errors. Start with just `name` and see what the API accepts.

4. **Rate limit: 2,000 req / 5 min per IP.** A full provision of a 20-space community with 3 images each is ~80 API calls plus ~60 S3 uploads — well under the limit. Monthly quota is 5,000 on Business plan, which a full rerun barely dents.

## Next steps after a clean first run

1. Commit your real template to `05-design/circle-provisioning/zpm-community.json` (add to .gitignore if it contains sensitive paywall copy)
2. Port the script into a Supabase Edge Function if you want it callable from a UI button or scheduled refresh
3. Add an `export` sub-command that reads an existing community via the API and writes out the template — useful for "capture current state, iterate, re-provision"
