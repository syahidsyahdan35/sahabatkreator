# Meta App Review — Submission Package (Fase 14B)

App: **Botara** — App ID `1141276711971314` (business portfolio: SHD Store)
> 2026-11-03: the previous app **Botara Dev** (`2356364001779420`) was
> **deleted** by the owner after its submission was rejected; this
> package now targets the fresh app **Botara** (`1141276711971314`),
> which has **no submission history** (`UNSUBMITTED`) and a clean
> compliance record. Its 4 use cases (Facebook Messaging, Instagram
> Business, Pages API, WhatsApp Business Messaging) are already
> configured.
Product: **Sahabat Kreator** — multi-tenant chat-marketing SaaS for creators
and SMBs (unified inbox + automations + AI agents + broadcasts over
WhatsApp, Instagram, Messenger, Telegram, Webchat).
Staging (the environment reviewers test): **https://botara.my.id**
Graph API version pinned everywhere in code: **v26.0**.

> How to use this document: **§0 is the go-live order** — do those steps
> in sequence. §1–§5 are **paste-ready English text** for the Meta
> console (App Review submission, app description, data-handling
> questions). §6 is the console pre-flight checklist with the exact
> values to confirm. §7 contains the screencast shot scripts. The
> permission list in §2 was **derived from the code** (every Graph API
> call site is cited), not from memory — if a call is not in the code,
> its permission is not requested.

---

## §0 — GO-LIVE ORDER (who does what, in sequence)

Legend: **[USER]** = only the account owner can do it (console, business
documents, recording, the submit click). **[DONE]** = already true /
prepared by development. **[MUSE]** = ask Muse; verifiable from
server logs/code.

1. **[USER] Business Verification** — Meta Business Settings → Business
   Info → verify the SHD Store portfolio (legal business documents).
   Advanced Access for business-type permissions is not granted to
   unverified businesses. *Status: user-side, not started via this
   package.*
2. **[USER] Console fields pre-flight** — walk §6 top to bottom and
   confirm every value (URLs, webhook, redirect URI, icon, category).
3. **[USER] Add the three Page-engagement permissions to the app** —
   App Review → *Permissions and Features* (or the use-case editor):
   confirm `pages_read_engagement`, `pages_read_user_content`,
   `pages_manage_engagement` are part of the app. **Do this BEFORE
   setting `META_ENGAGEMENT_SCOPES=1`**: the OAuth dialog only
   requests these scopes when that env flag is on (default off since
   the 2026-11-03 hotfix). If the flag is turned on before the
   permissions are on the app, Meta rejects the dialog with *"Invalid
   Scopes"* and **new** Messenger connections cannot be made until
   they are added (already-connected channels are unaffected). This
   is the exact sequence that worked for `business_management` in
   Hotfix R1.
   **[MUSE] After App Review approves all three**: set
   `META_ENGAGEMENT_SCOPES=1` in `.env.staging` (and later
   `.env.production`), rebuild + restart API, then verify a fresh
   Messenger connect shows all 7 scopes in the dialog URL.
4. **[USER] Finish the IG config item** — in the Instagram FLB
   configuration (new one on app `1141276711971314`), set the permission list to exactly
   `instagram_basic`, `instagram_manage_messages`,
   `instagram_manage_comments`, `business_management` (**never add
   `instagram_content_publish`** — the product never publishes media,
   see §2.4). On app `1141276711971314` this configuration must be
   **created fresh** (the old app's configs died with it); put the new
   config ID in Panel Admin → `meta_ig_config_id`. After reconnecting
   Instagram, **[MUSE]** can confirm from the discovery log
   (`businesses_instagram_accounts` stops returning `ERR:graph_100`).
5. **[USER] Create the WhatsApp FLB config** — the Embedded Signup
   configuration (new ID stored in Panel Admin → `meta_wa_config_id`)
   must carry `whatsapp_business_messaging` +
   `whatsapp_business_management` (+ `business_management`).
6. **[USER] Create the reviewer demo account** — register one account
   on https://botara.my.id/register (e.g. a dedicated review mailbox),
   create a workspace, and connect your own test Page, Instagram
   account, and WhatsApp number to it. Leave them connected; put this
   account's credentials in the submission's test-instructions field
   (§4 already contains the matching instructions text). Reviewers then
   see every feature working without needing Meta assets of their own.
7. **[USER] Record the three screencasts** using the shot scripts in
   §7 (Messenger, Instagram, WhatsApp). Use the demo account from
   step 6 so no personal data or tokens appear on screen.
8. **[USER] Submit** — App Review → Permissions and Features: request
   **Advanced Access** for the 13 permissions in §2, paste the §3
   justification into each permission's field, paste §4 as the test
   instructions, attach the matching screencast to each permission
   (one video may cover several — say which in the notes), answer the
   data-handling questions from §5, and click submit.
9. **[USER + CLAUDE] Respond to the reviewer** — if Meta asks for a
   Tester add or a re-record, the user adds the reviewer's account
   under App Roles → Roles (Tester) and tells Muse; Muse re-checks
   logs/paths and updates this package if the reviewer finds a gap.
10. **[USER] After approval: switch the app to Live mode** and ask
    Muse to re-run the smoke battery (health, connect flows, webhook
    delivery) against the live-mode app before announcing it.

Already **[DONE]** by development (no user action): legal pages live
(/privacy, /terms, /data-deletion), OAuth callback + webhook endpoints
live and verified (§8), dialog scope list split into core (always
requested) + engagement (gated by `META_ENGAGEMENT_SCOPES`, default
off until App Review approves — hotfix 2026-11-03), data-deletion
instructions page designated as the console's deletion URL.

---

## §1 — App summary & use-case description (paste-ready)

> Sahabat Kreator is a multi-tenant SaaS platform that helps creators
> and small businesses in Indonesia manage customer conversations from
> one place. A business connects its own Facebook Page, Instagram
> professional account, and WhatsApp Business account to its workspace
> and gets a unified team inbox, keyword/flow automations, AI-assisted
> replies based on its own knowledge base, appointment booking, product
> catalog and payment links, and opt-in broadcasts.
>
> The app only ever accesses assets the signed-in user administers and
> explicitly selects during the Meta connect flow. It reads and sends
> messages and comments on behalf of that connected business, manages
> the business's WhatsApp message templates, and receives message and
> comment events through a single signed webhook. It does not publish
> posts or media, does not read advertising data, and never accesses
> data of businesses that did not connect.

---

## §2 — Permission inventory (derived from the code)

Method: every Graph API call in the codebase was enumerated (clients:
`packages/channels/channel-messenger/src/index.ts` — one client for
Page + Instagram on graph.facebook.com; `packages/channels/channel-whatsapp/src/index.ts`;
sender-profile fetch in `packages/core/src/meta.ts`; connect flows in
`apps/api/src/modules/meta-oauth/routes.ts` and
`apps/api/src/modules/channels/routes.ts`; delivery in
`apps/api/src/modules/meta/poller.ts`; comment actions in
`apps/worker/src/index.ts`; template management in
`apps/api/src/modules/whatsapp-templates/routes.ts`) and mapped to the
permission Meta's documentation assigns to that call.

**Dev-mode masking (applies to every row):** the app is in Development
mode and everyone testing it today holds an app role and connects
their *own* assets, so Standard Access is enough and the need for
Advanced Access is invisible. The moment a business *without* an app
role connects its assets, each permission below must hold **Advanced
Access** (this submission) or the listed calls fail or return empty.

### 2.1 Messenger / Facebook Page — requested via the classic Facebook Login dialog `scope` parameter

| Permission | Graph calls in the product (code) | Access note |
|---|---|---|
| `pages_show_list` | `GET /me/accounts` (Page list + Page tokens), Page backfill `GET /{page-id}?fields=id,name,username,access_token,instagram_business_account{...}` during discovery | Advanced Access required for other businesses' Pages |
| `pages_messaging` | `POST /{page-id}/messages` (Send API, `messaging_type: RESPONSE`); private replies via `recipient: { comment_id }`; sender profile `GET /{psid}?fields=first_name,last_name,profile_pic`; inbound via `messages` webhook field | Advanced Access required; also the permission Meta reviews most strictly — screencast 1 shows it end-to-end |
| `pages_manage_metadata` | `POST /{page-id}/subscribed_apps?subscribed_fields=messages,feed` at connect time | Advanced Access required |
| `pages_read_engagement` | Page `feed` webhook subscription + receiving comment events (comment id, text, post id) from that feed | Advanced Access required. **Was missing from the dialog before Fase 14B** — added to the dialog scope list (`MESSENGER_ENGAGEMENT_SCOPES`, opt-in via `META_ENGAGEMENT_SCOPES`) |
| `pages_read_user_content` | Commenter identity (`from.id`, `from.name`) carried in the `feed` comment payloads, shown in the inbox and used for comment-to-DM | Advanced Access required. **Added in Fase 14B** (same gap as above) |
| `pages_manage_engagement` | `POST /{comment-id}/comments` (public reply as the Page); `POST /{comment-id}?is_hidden=true\|false` (hide/unhide) — worker comment actions | Advanced Access required. **Added in Fase 14B** (same gap as above) |
| `business_management` | `GET /me/assigned_pages`; `GET /me/businesses?fields=...,owned_pages,client_pages` (Page discovery); shared with the IG/WA discovery edges below | Advanced Access required. Added to the dialog in Hotfix R1 after live logs proved Pages visible only through a business portfolio never appeared (`graph_10`/`graph_100`) without it |

### 2.2 Instagram — Unified Login (Facebook Login for Business); permissions live in the FLB configuration, not in a scope parameter

| Permission | Graph calls in the product (code) | Access note |
|---|---|---|
| `instagram_basic` | `GET /me/assigned_instagram_accounts?fields=id,username`; `GET /{ig-id}?fields=id,username` (connect validation, manual System-User token path); `GET /{ig-id}?fields=profile_picture_url` (account avatar); Page-edge discovery `instagram_business_account{id,username}` on `/me/accounts` and `/{page-id}` | Advanced Access required for other businesses' accounts |
| `instagram_manage_messages` | `POST /{ig-id}/messages` (Send API incl. private reply via `recipient: { comment_id }`); sender profile `GET /{igsid}?fields=name,username,profile_picture_url`; `POST /{ig-id}/subscribed_apps?subscribed_fields=messages,comments`; inbound via `messages` webhook field | Advanced Access required |
| `instagram_manage_comments` | Inbound via `comments` webhook field; `POST /{comment-id}/replies` (public reply); `POST /{comment-id}?hidden=true\|false` (hide/unhide) | Advanced Access required |
| `business_management` | `GET /me/businesses?fields=id,instagram_accounts{id,username}` — the only discovery edge that finds portfolio-owned IG accounts not linked to any Page | **Still open console item:** live logs (2026-11-03) show this edge returning `ERR:graph_100` for the IG token — the permission is not yet in the IG FLB config's list. See §0 step 4 |

### 2.3 WhatsApp — Embedded Signup (FLB configuration) + manual System-User token path

| Permission | Graph calls in the product (code) | Access note |
|---|---|---|
| `whatsapp_business_messaging` | `POST /{phone_number_id}/messages` (text + approved template sends); inbound + status webhooks (`whatsapp_business_account` object) | Advanced Access required |
| `whatsapp_business_management` | `GET /me/assigned_whatsapp_business_accounts`; `GET /{waba-id}/phone_numbers`; `GET /{phone_number_id}?fields=verified_name,display_phone_number` (connect validation); `GET /{phone_number_id}/whatsapp_business_profile?fields=profile_picture_url`; templates `GET/POST/DELETE /{waba-id}/message_templates`; `POST /{waba-id}/subscribed_apps` | Advanced Access required |
| `business_management` | Part of the standard Embedded Signup configuration; the business token's asset discovery above runs against the client's portfolio | Same submission as 2.1/2.2 |

### 2.4 Explicitly NOT requested (no such calls exist in the code)

- `instagram_content_publish` — the product never publishes media or
  posts (no `POST /{ig-id}/media`, no media-publish calls anywhere).
  If it appears in the IG FLB config, remove it (§0 step 4).
- `pages_manage_posts` — no Page post creation.
- `instagram_manage_insights`, `read_insights` — no insights calls.
- Any ads permissions (`ads_read`, `ads_management`) — no ads features.
- Comment **deletion** — moderation is hide/unhide + reply only; there
  is no `DELETE /{comment-id}` call.
- Telegram and Webchat are not Meta surfaces and are out of scope for
  this review.

---

## §3 — Per-permission justifications (paste-ready)

*One paragraph per permission, in the form Meta asks for: what the app
does with it, the value to the person connecting the asset, and where
it appears in the demo.*

**pages_show_list** — When a user clicks "Continue with Facebook" in
our Channels page, Sahabat Kreator calls /me/accounts and the related
discovery edges to list the Facebook Pages that user manages, showing
each Page's name and username in an asset picker. The user picks
exactly one Page to connect; we store that Page's access token
(encrypted) and use it only for that Page. Without this permission the
user cannot see or select their Page, so no Messenger channel can be
connected. Shown in Screencast 1, shots 2–4.

**pages_messaging** — This is the core of the product for Messenger:
customer messages sent to the connected Page arrive through the
messages webhook and appear in the business's unified inbox, and the
business's replies (typed by a human agent, an automation, or the
AI agent the owner configured) are sent with the Send API
(POST /{page-id}/messages). We also use it for the documented private
reply to a commenter (recipient: { comment_id }) so a business can
answer a public comment privately. Sender name and profile picture
are fetched once so agents know who they are talking to. Shown in
Screencast 1, shots 5–7.

**pages_manage_metadata** — Immediately after a user connects a Page,
the app subscribes itself to that Page's webhooks
(POST /{page-id}/subscribed_apps with subscribed_fields=messages,feed).
Without this subscription Meta delivers no message or comment events
for the Page and the inbox stays empty. The subscription is created
only for Pages the user explicitly connected, and the user can undo
it by disconnecting the channel in our UI or removing the app in
their Facebook settings. Shown in Screencast 1, shot 4 (the connected
state right after selection).

**pages_read_engagement** — The app subscribes to the Page's feed
field to receive new-comment events on the Page's posts. Comment text
and the post it belongs to are shown to the business in its inbox so
the team can answer questions that were asked publicly on a post
instead of in a DM. We read only comments on posts of Pages the user
connected; we do not read other Page content. Shown in Screencast 1,
shots 8–9.

**pages_read_user_content** — Comment events identify the commenter
(from.id, from.name). We store that identity with the comment so the
business can see who wrote it, reply to that person, and — when the
commenter continues in DM — keep the public comment and the private
conversation attached to the same contact. No other user content is
read. Shown in Screencast 1, shots 8–10.

**pages_manage_engagement** — When a business sets a comment rule
(for example: keyword "price" → reply and offer a DM) or clicks
Reply/Hide on a comment in our inbox, the app performs exactly that
action as the Page: POST /{comment-id}/comments for a public reply
and POST /{comment-id}?is_hidden= for hide/unhide moderation. The
app never deletes comments and never acts on comments of Pages that
were not connected. Shown in Screencast 1, shots 9–10.

**business_management** — Many creators hold their Page or Instagram
account inside a Meta Business portfolio rather than as a
directly-administered asset. The discovery edges that see those
assets — /me/assigned_pages and /me/businesses (owned_pages,
client_pages, instagram_accounts) — return Graph errors (#10/#100)
without business_management, and the asset silently never appears in
our picker; we verified this in production logs and fixed it by
requesting the permission. We use it read-only, only during the
connect flow, to list the businesses' Pages and Instagram accounts
the user may connect. Shown in Screencast 1, shot 3 (a portfolio-held
Page appears in the picker) and Screencast 2, shot 3.

**instagram_basic** — During the Instagram connect (Unified Login),
the app discovers the professional accounts shared with it
(/me/assigned_instagram_accounts and the Page/business edges), reads
each account's id and username to show in the picker, validates a
manually pasted System User token against GET /{ig-id}, and reads
profile_picture_url so the connected account shows its real avatar
in the channel list. This is identity/read access only; nothing is
published. Shown in Screencast 2, shots 2–4.

**instagram_manage_messages** — Instagram DMs to the connected
account arrive through the messages webhook into the same unified
inbox as Messenger, and replies are sent with POST /{ig-id}/messages.
It also covers the private reply that turns a public comment into a
DM conversation (recipient: { comment_id }) and the subscription
call that enables event delivery for the account. Sender name,
username, and profile picture are fetched once per new contact.
Shown in Screencast 2, shots 5–6 and 8.

**instagram_manage_comments** — Comments on the connected account's
posts arrive through the comments webhook field and are listed with
the commenter's username. The business can answer publicly
(POST /{comment-id}/replies) and moderate with hide/unhide
(POST /{comment-id}?hidden=), manually or through the comment rules
it configured (for example, keyword-triggered replies). Comments are
never deleted. Shown in Screencast 2, shots 7–8.

**whatsapp_business_messaging** — Businesses reply to customers and
send approved template messages (for example broadcast campaigns to
contacts who opted in) with POST /{phone_number_id}/messages, and
receive customer messages and delivery statuses through the
whatsapp_business_account webhook. Free-form sends are only made
inside Meta's 24-hour customer-service window; outside it only
pre-approved templates are used. Shown in Screencast 3, shots 5–7.

**whatsapp_business_management** — During Embedded Signup the app
lists the WhatsApp Business accounts shared with it and their phone
numbers, validates the number (verified_name, display_phone_number),
reads the business profile picture, subscribes the app to the WABA,
and manages the business's message templates from our dashboard
(list/create/delete on /{waba-id}/message_templates) so the business
does not have to use a separate tool to prepare broadcast templates.
Shown in Screencast 3, shots 2–4.

---

## §4 — Reviewer test instructions (paste-ready)

> **Before you start:** the app is in Development mode during this
> review. A demo workspace with a Facebook Page, an Instagram
> professional account, and a WhatsApp Business number already
> connected is provided so every feature can be verified immediately:
>
> 1. Open https://botara.my.id/login and sign in with the demo
>    credentials supplied in the "test credentials" field of this
>    submission.
> 2. You land on the workspace dashboard. Open **Channels** in the
>    left navigation: the Page, Instagram account, and WhatsApp
>    number show as **Connected** with their real names and avatars.
>
> **Messenger (pages_show_list, pages_messaging,
> pages_manage_metadata, pages_read_engagement,
> pages_read_user_content, pages_manage_engagement,
> business_management)**
>
> 3. From any other Facebook account, send a message to the connected
>    Page (for example "Hi, is this course still open?"). Within a
>    few seconds it appears in **Inbox**. Open the conversation and
>    reply from the dashboard composer; the reply is delivered to
>    Messenger by the Send API.
> 4. Comment on any public post of the connected Page. The comment
>    appears in the app's comments view with your name. In
>    **Automations → Comment rules**, a rule for the keyword "price"
>    is enabled: comment "What is the price?" on the post and you
>    will see (a) a public reply from the Page under your comment,
>    (b) a private DM from the Page in your Messenger, and (c) the
>    rule can hide comments — hiding is visible on the post itself.
>
> **Instagram (instagram_basic, instagram_manage_messages,
> instagram_manage_comments)**
>
> 5. From any other Instagram account, DM the connected professional
>    account; the message appears in the same **Inbox** and can be
>    answered there. Comment on one of its posts; the comment appears
>    in the comments view and the same "price" rule answers it
>    publicly and by DM.
>
> **WhatsApp (whatsapp_business_messaging,
> whatsapp_business_management)**
>
> 6. Open **Broadcasts → Templates**: the business's message templates
>    are listed with Meta's approval status; creating a template here
>    submits it to Meta. Open **Broadcasts**, send the approved
>    template to the provided test contact, and reply to it from the
>    phone — the reply lands in **Inbox** and can be answered within
>    the 24-hour window.
>
> **Running the connect flow yourself:** register your own account at
> https://botara.my.id/register, create a workspace (name it anything,
> click Create), then open **Channels → Continue with Facebook**.
> Because the app is in Development mode, only Facebook accounts with
> an app role can complete the Meta consent. If you want to run it,
> reply in this review thread with the Facebook account you will use
> and we will add it as a Tester (App Roles) — the picker will then
> list your Pages, including Pages held in a Business portfolio
> (business_management), and the selected asset becomes Connected.
>
> **What you should observe throughout:** the app only ever shows
> data belonging to the connected business's own assets; messages and
> comments arrive in near-real time through Meta webhooks; every
> outbound message is sent through the official Graph API endpoints
> listed in each permission's justification.

### §4.1 — What the USER must set up in the console for reviewers (checklist)

- [ ] App stays in **Development** mode until approval (§0 step 10).
- [ ] Reviewer **demo account** created and its Page/IG/WhatsApp left
      connected (§0 step 6); credentials pasted into the submission's
      test-credentials field — **not** into any public page.
- [ ] A comment rule with keyword `price` enabled on the demo
      workspace's Page and IG accounts (so §4 steps 4–5 work verbatim).
- [ ] One **approved** WhatsApp template on the demo WABA plus a test
      contact who opted in (so §4 step 6 works even while a newly
      created template is still pending Meta's template review).
- [ ] App Roles: be ready to add the reviewer's Facebook account as
      **Tester** on request (App Roles → Roles → Add People).
- [ ] The demo assets must belong to the verified business portfolio
      (SHD Store) so nothing depends on personal-profile assets.

---

## §5 — Data-handling answers (paste-ready)

**What Meta data does the app access?** For each business that
connects its own assets: Page / Instagram account / WABA identifiers,
names, usernames, and profile pictures; the content of messages
exchanged with that business (Messenger, Instagram DM, WhatsApp) and
delivery statuses; comments on the connected Page's posts and the
connected Instagram account's posts, including the commenter's id and
username/name; and, for people who message the business, their name,
username, and profile picture (fetched once from the sender-profile
endpoints). WhatsApp correspondents are identified by their phone
number (wa_id), as provided by the Cloud API webhook.

**How is it used?** Only to operate the connected business's channels:
showing its team a unified inbox, delivering its replies, running the
automations, comment rules, broadcasts, and AI agents the business
itself configured, and showing its analytics. Platform data is never
sold, never used for advertising or profiling, and never shared with
other tenants. If a business enables an AI agent, message content is
sent to our AI model provider (OpenRouter) solely to generate that
business's replies; this is disclosed in the privacy policy.

**Where is it stored, and how is it protected?** In the application's
PostgreSQL database and Cloudflare R2 object storage (profile photos
and media). Channel access tokens are encrypted at rest with
AES-256-GCM envelope encryption, are never displayed in the UI, and
are never written to logs. Every workspace's data is isolated by
database row-level security keyed on the tenant.

**Retention and deletion.** Disconnecting a channel deletes its
stored access token immediately. Deleting a channel moves it to a
30-day Trash grace period, after which its conversations, messages,
channel identities, and media records are permanently purged.
Operational integration logs are automatically deleted after 30 days.
A business can request complete account/workspace deletion by email
to support@botara.my.id from its registered address; verified
requests are completed within 30 days. End customers of a business
may contact the business, or us at the same address — we forward the
request to the business and assist as its processor. Full
instructions: **https://botara.my.id/data-deletion** (this URL is the
app's Data Deletion Instructions URL in App Settings).

**Data Deletion Request Callback:** the app does not implement the
signed-request callback endpoint; deletion is handled through the
instructions URL above and the in-product paths described there.
*(Internal note — not part of the paste text: if the console for this
app requires the callback field, that is a known gap recorded in
§8; Meta's App Settings field used by this app is the Instructions
URL.)*

**Privacy policy:** https://botara.my.id/privacy — describes the data
categories above, the controller/processor split between businesses
and the platform, subprocessors (Cloudflare, OpenRouter, Resend,
payment providers), retention, and user rights.
**Terms:** https://botara.my.id/terms

---

## §6 — Console pre-flight checklist (exact expected values)

App: **Botara** · App ID: `1141276711971314` · Portfolio: SHD Store.

### App Settings → Basic
- [x] Privacy Policy URL: `https://botara.my.id/privacy` (verified via API 2026-11-03)
- [x] Terms of Service URL: `https://botara.my.id/terms` (verified)
- [x] Data Deletion Instructions URL: `https://botara.my.id/data-deletion` (verified)
- [ ] App icon: 1024×1024 image uploaded (the SK monogram artwork the
      user has on file) — a 48px default icon is present; confirm the
      full-size artwork is uploaded.
- [ ] Category: currently `MESSENGER_BOT` — acceptable for this
      product (Messenger is the core surface); switching to
      **Business** is optional.
- [x] App Domains / website: `botara.my.id` (verified; the production
      domain is added in Fase 14C before public launch — reviewers
      test on the staging domain above).
- [ ] Contact email: still `syahidsyahdan35@gmail.com` and
      **unverified** — change to `support@botara.my.id` (or verify the
      current one) before submit.

### Facebook Login → Settings
- [ ] Valid OAuth Redirect URIs contains exactly:
      `https://botara.my.id/api/meta/oauth/callback`
- [ ] Login for Business configurations (the old app's configs are
      gone — create fresh ones on this app, then store each new ID in
      Panel Admin → `meta_ig_config_id` / `meta_wa_config_id`):
  - Instagram config (new ID) — permissions exactly:
    `instagram_basic`, `instagram_manage_messages`,
    `instagram_manage_comments`, `business_management`
    (never add `instagram_content_publish`; §0 step 4).
  - WhatsApp config (new ID) —
    permissions: `whatsapp_business_messaging`,
    `whatsapp_business_management`, `business_management`.

### App Review → Permissions and Features
- [ ] The three engagement permissions exist on the app (§0 step 3):
      `pages_read_engagement`, `pages_read_user_content`,
      `pages_manage_engagement`. The OAuth dialog requests them
      **only** once `META_ENGAGEMENT_SCOPES=1` is set — which happens
      AFTER Advanced Access is granted (§0 step 3). Requesting them
      before approval makes the dialog fail with "Invalid Scopes"
      (the Fase 14B unconditional-scope change was reverted to this
      opt-in for exactly that reason).
- [ ] All 13 permissions from §2 are queued for **Advanced Access**
      with the §3 justifications and §7 screencasts attached.

### Webhooks (App Settings / product configuration)
- [ ] Callback URL: `https://botara.my.id/api/meta/webhook`
- [ ] Verify token: the same value stored server-side
      (`META_WEBHOOK_VERIFY_TOKEN` / Panel Admin) — never paste it
      anywhere public.
- [ ] Subscriptions — Page: `messages`, `feed` · Instagram:
      `messages`, `comments` · WhatsApp (`whatsapp_business_account`):
      `messages`. (Per-asset `subscribed_apps` calls are also made by
      the app at connect time; both layers are expected.)

### Business verification & roles
- [x] Business Verification for SHD Store: **Verified**
      (`business_verification_passes: true`, verified via API 2026-11-03).
- [ ] App Roles: reviewer demo assets owned by the portfolio;
      team members who test have Tester/Admin roles as needed.

### Compliance (verified via API 2026-11-03)
- [x] Compliance status: **compliant** — no open violations, no
      required actions. Data Use Checkup URL:
      https://developers.facebook.com/apps/1141276711971314/data-use-checkup/
      (fill it in as part of the submission; `data_use_checkup` is the
      one step every permission row still lists as incomplete).
- [x] No prior submission on this app (`UNSUBMITTED`, clean history) —
      the old app's rejection history does NOT carry over.

---

## §7 — Screencast shot scripts

**Recording hygiene (all three videos):**
- One continuous take per flow — **no cuts between the Meta consent
  dialog and the connected state**; Meta rejects stitched flows.
- Keep the browser address bar visible: reviewers must see
  `botara.my.id` and the `facebook.com` dialog with the app name
  **Botara** and the permission list.
- Use the reviewer demo account (§0 step 6); never show real customer
  data, tokens, or passwords (log in before pressing record, or mask
  the password field — but do not cut the connect flow itself).
- Keep each video under ~3 minutes; speak or caption one sentence per
  shot naming what is happening ("This Page lives in our Business
  portfolio — business_management lets the picker list it").
- Record the *second actor* (customer phone/second browser profile)
  in picture-in-picture or by switching windows within the same take;
  the message must visibly arrive in the Sahabat Kreator inbox.

### Screencast 1 — Messenger (covers pages_show_list, business_management, pages_manage_metadata, pages_messaging, pages_read_engagement, pages_read_user_content, pages_manage_engagement)
1. Open `https://botara.my.id/channels` (demo account already signed
   in). Hover the Messenger card; click **Continue with Facebook**.
2. The Meta dialog appears showing **Botara** and its permission
   list — pause 2 seconds so the list is readable.
3. In the asset picker, show at least one Page that lives in the
   **Business portfolio** (call it out in narration —
   business_management). Select the demo Page → **Connect**.
4. Back in Channels, the Page card shows **Connected** with its real
   name and avatar (the app subscribed itself via subscribed_apps —
   pages_manage_metadata).
5. Switch to the "customer" profile: open Messenger, send "Hi, is
   this course still open?" to the Page.
6. Switch back: the message is in **Inbox**. Open it; the sender's
   name and photo are shown. Type a reply in the composer and send —
   cut back to the customer profile to show it arrived in Messenger
   (pages_messaging).
7. Customer profile: comment "Hello" on any public post of the Page.
8. Dashboard: open the comments view — the comment is listed with the
   commenter's name (pages_read_engagement, pages_read_user_content).
9. With the `price` comment rule enabled, customer comments "What is
   the price?" → show (a) the Page's public reply appearing under the
   comment on Facebook, (b) the private-reply DM arriving in the
   customer's Messenger (pages_manage_engagement, pages_messaging).
10. Dashboard: click **Hide** on a comment; show the post on Facebook
    with the comment hidden (pages_manage_engagement).

### Screencast 2 — Instagram (covers instagram_basic, business_management, instagram_manage_messages, instagram_manage_comments)
1. Channels → Instagram card → **Continue with Facebook** (Unified
   Login dialog with the app name visible; pause on the consent
   screen).
2. Asset picker: select the professional account → **Connect**.
3. If the account lives only in the portfolio, narrate that the
   businesses discovery edge found it (business_management) — after
   §0 step 4 is done; otherwise connect the Page-linked account and
   skip the narration.
4. Channels shows the IG card **Connected** with the real `@username`
   and avatar (instagram_basic).
5. Customer profile (Instagram app/web): DM "Is the class available
   this month?" → dashboard **Inbox** shows it; reply from the
   dashboard; show the reply arriving in Instagram (instagram_manage_messages).
6. Customer comments "Hello" on a post → dashboard comments view
   lists it with the commenter's username (instagram_manage_comments).
7. Customer comments "What is the price?" → show the public reply
   under the comment and the private-reply DM arriving
   (instagram_manage_comments + instagram_manage_messages).
8. Dashboard: **Hide** a comment; show it hidden on the post.

### Screencast 3 — WhatsApp (covers whatsapp_business_messaging, whatsapp_business_management, business_management)
1. Channels → WhatsApp card → **Continue with Facebook** (Embedded
   Signup dialog visible with the app name).
2. In the flow, pick the demo WABA and phone number (narration: the
   app discovers assigned WABAs and their numbers —
   whatsapp_business_management) → finish.
3. Channels shows the WhatsApp card **Connected** with the verified
   business name and display number.
4. Open **Broadcasts → Templates**: the template list with Meta
   approval statuses loads from the WABA; create one small template
   and submit it (it shows PENDING — narrate that Meta reviews
   templates separately; an already-APPROVED template is used next).
5. Open **Broadcasts** → new broadcast → pick the approved template
   and the opted-in test contact → send (whatsapp_business_messaging).
6. Show the customer's phone receiving the template message.
7. Reply from the phone ("Yes, I want to join") → the reply lands in
   **Inbox**; answer it from the dashboard inside the 24-hour window
   and show it arriving on the phone.

---

## §8 — Verification evidence & known gaps (Fase 14B, 2026-11-03)

Verified live against https://botara.my.id on 2026-11-03:

- `GET /privacy`, `/terms`, `/data-deletion`, `/register` → **200**;
  the shipped web bundle contains the full legal copy (strings
  "Data Deletion", "Deleting your whole account or workspace",
  "data deletion instructions URL", "Two kinds of data, two roles"
  all present in the deployed JS) — the pages render real content,
  not placeholders. (The pages are client-rendered; content evidence
  is the deployed bundle + the i18n source in
  `packages/i18n/src/resources/en.ts`.)
- `GET /api/health` → `{ "status": "ok", "service": "api" }`.
- Webhook handshake shape: `GET /api/meta/webhook?hub.mode=subscribe&
  hub.verify_token=<deliberately wrong>&hub.challenge=…` → **403**
  (endpoint live, fail-closed). The success branch (echo the
  challenge when the token matches) is verified from code
  (`apps/api/src/modules/meta/routes.ts`) — deliberately NOT executed
  with the real verify token from outside, and live channels already
  prove event delivery end-to-end.
- OAuth callback: bare `GET /api/meta/oauth/callback` → **302** to
  `https://botara.my.id/channels?meta_oauth_error=META_OAUTH_STATE_INVALID`
  (the documented failure shape; a valid signed `state` + `code` is
  required to proceed).
- OAuth start/info endpoints are mounted and auth-gated:
  unauthenticated calls → **401**. The dialog URL itself (client_id =
  App ID, redirect_uri = the §6 value, `config_id` for
  Instagram/WhatsApp, `scope` list for Messenger) is verified from
  code — it cannot be exercised without signing in, and no staging
  accounts were created for this phase.
- Register → workspace → Channels path verified by code-path review:
  `/register` (Better Auth sign-up creates a session) → dashboard
  shows the create-workspace form when the user has none
  (`POST /tenants`) → Channels page hosts the "Continue with
  Facebook" connect + asset picker (`meta-oauth` start/session/
  complete endpoints). Inferred, not clicked through, per the
  no-new-accounts rule for this phase.

**Gaps found & disposition:**

1. **Page comment permissions were never requested by the Messenger
   dialog** (feed comment events + public reply + hide are
   `pages_read_engagement` / `pages_read_user_content` /
   `pages_manage_engagement` per Meta's Pages API docs, none of which
   were in the Messenger dialog scope list). In Development mode with mock
   chains this was invisible; for other businesses the comment
   features would have failed even after a successful review of the
   old list. **Fixed in Fase 14B**: the three scopes were added to
   the dialog (same pattern as the R1 `business_management` fix),
   with the console prerequisite sequenced in §0 step 3.
2. **IG FLB config lacks `business_management`** — proven from live
   discovery logs (`businesses_instagram_accounts=ERR:graph_100`).
   Console-side only (permissions live in the config, not in code);
   the user's guided step is §0 step 4. IG still connects today via
   the Page-linked discovery edge.
3. **No Data Deletion Request Callback endpoint** (signed_request) —
   the app relies on the Data Deletion Instructions URL, which exists
   and is complete. Implementing the automated callback is a small
   future code item **only if** the console demands it for this app;
   flagged here so it is a decision, not a surprise.
4. App display name during consent is the Meta app name
   (**Botara** on app `1141276711971314`), while the product brand is
   Sahabat Kreator. Renaming the app is a user console decision; it does not block
   review, but reviewers will see "Botara" in dialogs and
   screencasts — the §1 description names both so the mismatch reads
   as intentional.

5. **2026-11-03, app migration:** the original app **Botara Dev**
   (`2356364001779420`) was deleted after a rejected submission; all
   console-side state must be rebuilt on **Botara**
   (`1141276711971314`): FLB configurations for Instagram and WhatsApp
   (new config IDs → Panel Admin `meta_ig_config_id` / `meta_wa_config_id`),
   webhook subscription (same callback URL and verify token), Valid
   OAuth Redirect URI, app roles/assets for testing, and the contact
   email. Verified live via API on 2026-11-03: the new app is
   compliant (no violations), business verification passes (SHD
   Store), privacy/terms/data-deletion URLs already point to
   botara.my.id, category `MESSENGER_BOT`, Development mode, **no
   submission yet**. Contact email is still a personal Gmail address
   and unverified — change to `support@botara.my.id` before submit.
   Staging must also learn the new IDs: set them in Panel Admin
   (`meta_app_id`, `meta_ig_config_id`, `meta_wa_config_id`) — the
   staging `platform_settings` table is empty and `.env.staging` has
   no `META_APP_ID` fallback, so OAuth dialogs currently have no
   `client_id`.

---

## §9 — Ringkasan Bahasa Indonesia (bagian yang dikerjakan user)

Urutan pengerjaan (detailnya §0): **(1)** verifikasi bisnis SHD Store
di Meta Business Settings; **(2)** cek semua nilai konsol di §6
(URL privasi/syarat/penghapusan data, redirect URI, ikon, kategori);
**(3)** tiga izin engagement Page
(`pages_read_engagement`, `pages_read_user_content`,
`pages_manage_engagement`) diajukan lewat App Review ini sendiri —
JANGAN diaktifkan sebelum Advanced Access-nya disetujui: dialog
OAuth hanya memintanya bila env `META_ENGAGEMENT_SCOPES=1`, dan env
itu baru dinyalakan SESUDAH persetujuan (memintanya sebelum itu
membuat dialog gagal dengan "Invalid Scopes" — itulah sebabnya
perubahan Fase 14B yang memintanya tanpa syarat sudah dibatalkan
menjadi opt-in; connect Messenger normal saat ini aman dan tidak
meminta trio ini sama sekali); **(4)** buat konfigurasi IG baru di app
`1141276711971314` (app lama dihapus): `instagram_basic` +
`instagram_manage_messages` + `instagram_manage_comments` +
`business_management` — TANPA `instagram_content_publish`; masukkan ID
config barunya ke Panel Admin → `meta_ig_config_id`; **(5)** buat
konfigurasi WhatsApp (Embedded Signup) baru dengan
`whatsapp_business_messaging` +
`whatsapp_business_management` + `business_management`; masukkan ID-nya
ke Panel Admin → `meta_wa_config_id`; **(5b)** pasang nilai
`meta_app_id` = `1141276711971314` di Panel Admin (saat ini staging
belum punya client_id sama sekali — platform_settings kosong);
**(6)** langganan webhook di app baru: callback
`https://botara.my.id/api/meta/webhook` + verify token yang sama
dengan server; **(7)** buat satu akun demo khusus reviewer, hubungkan
Page + IG + nomor WA milik sendiri, biarkan terhubung, dan taruh
kredensialnya di kolom test credentials saat submit; **(8)** rekam
tiga screencast mengikuti naskah §7 (tanpa potongan antara dialog
izin dan status terhubung); **(9)** isi Data Use Checkup + ganti
email kontak ke `support@botara.my.id` (yang sekarang gmail pribadi
dan belum terverifikasi); **(10)** submit App Review dengan teks
§3/§4/§5 yang tinggal tempel; **(11)** sesudah disetujui, pindahkan
aplikasi ke mode Live dan minta Muse menjalankan baterai smoke ulang.

Yang sudah disiapkan Muse: seluruh teks pengajuan berbahasa Inggris
(§1, §3, §4, §5), daftar izin final hasil inventaris kode (§2),
checklist konsol (§6), naskah screencast (§7), perbaikan kode
Fase 14B (trio izin engagement kini diminta dialog Messenger), dan
paket ini kini menunjuk app baru **Botara** `1141276711971314`
(2026-11-03; kondisi konsolnya diverifikasi via API: compliant,
bisnis terverifikasi, URL legal benar, belum ada submission).
