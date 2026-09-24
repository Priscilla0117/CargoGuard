# Microsoft mailbox and Outlook integration

This is an implemented, configuration-ready adapter. The project currently has no Microsoft tenant or application registration, so **no live mailbox connection, consent, deployment, message creation or sending has been performed**. Local tests use a mocked Microsoft transport with a real isolated SQL database. Missing configuration disables mailbox actions and displays the reason.

## What is implemented

- `/outlook` loads the official Office.js runtime and can read the selected Outlook message's subject, sender and plain-text body when hosted by a supported Outlook client.
- Authenticated team members can connect their own delegated Microsoft account. Anonymous demo workspaces cannot connect.
- Authorization code flow uses PKCE S256, random expiring state, and a single-use state record bound to the exact CargoGuard session, workspace and user.
- Access/refresh tokens and the temporary PKCE verifier use AES-256-GCM authenticated encryption. Workspace/user binding prevents decrypting a ciphertext in another account context. Tokens never reach browser JavaScript.
- A connected user can preview the selected mailbox message and supported attachment list, then explicitly import TXT, PDF, DOCX or XLSX source files through the existing protected parsing/upload pipeline. Source changes during preparation block import. Unsupported attachments are reported and never silently discarded.
- A saved shipment task can create a real Outlook draft only after the user enters a recipient and confirms reviewing the saved contents. Shipment version, task version and case version are retained as evidence.
- Sending is disabled by default. When an administrator enables it, an explicit reviewer/admin action is required. The server checks saved source versions and current Outlook draft contents before reserving the send operation.
- SQL reservations deduplicate repeated requests. Network timeouts become an uncertain state and never trigger automatic send retries. Microsoft accepting a send is labelled **submitted**, not delivered.
- A reviewer/admin can preview and explicitly dispatch a current deadline reminder to a server-approved recipient. The durable outbox deduplicates per reminder/recipient, checks current case and shipment revisions before sending, cancels if the reminder changes or is acknowledged, and preserves uncertain outcomes without resending.
- Connection, import and correspondence events have an append-only audit table. Diagnostic errors contain no token, email body or provider response text.

## Administrator configuration

Set up an organisational Microsoft Entra application as a **confidential web application**, with a tenant-specific directory ID. Do not use the `common` tenant endpoint. Register the exact HTTPS redirect URI below and allow the delegated permissions approved by the organisation.

| Server setting | Purpose |
| --- | --- |
| `CARGO_AUTH_MODE=team` | Require real CargoGuard team identities and roles. |
| `CARGO_PUBLIC_ORIGIN` | The deployed HTTPS origin, without an application subpath. |
| `CARGO_MS_TENANT_ID` | Entra tenant GUID. |
| `CARGO_MS_CLIENT_ID` | Entra application/client GUID. |
| `CARGO_MS_CLIENT_SECRET` | Confidential web application's server secret, held in the deployment secret store. |
| `CARGO_MS_REDIRECT_URI` | Exactly `https://YOUR_HOST/api/microsoft/callback`. |
| `CARGO_MS_TOKEN_KEY` | Base64 representation of a securely generated 32-byte key. Preserve it in the deployment secret store; changing it requires reconnecting stored accounts. |
| `CARGO_MS_ALLOW_SEND=false` | Keep disabled for initial pilot. Enabling requires organisational approval and live acceptance testing. |
| `CARGO_MS_ADDIN_ENABLED=false` | Keep disabled until the Outlook client deployment has been validated. Enabling permits only `/outlook` to be framed by the explicit Microsoft Outlook origins. |
| `CARGO_MS_ADDIN_ID` | Stable unique add-in GUID for generating the XML manifest; distinct from the client ID unless intentionally allocated that way. |
| `CARGO_MS_ALERTS_ENABLED=false` | Opt in to reviewed deadline email dispatch only after the tenant pilot is validated. This does not start a scheduler. |
| `CARGO_MS_ALERT_RECIPIENTS` | Comma-separated allowlist of 1–10 approved email recipients. Blank or malformed configuration disables alert dispatch. |

The requested delegated scopes are `offline_access`, `User.Read`, and `Mail.ReadWrite`. `Mail.Send` is requested only when application sending is enabled. Scope changes require reconnecting and fresh consent. No application-level mailbox-wide permissions or unattended service account access are used.

Apply migrations `0009_microsoft_connector.sql` and `0011_microsoft_notifications.sql` with the normal migration runner. Never place tokens, the encryption key or the client secret in the manifest, client environment variables or committed `.env` files. Disconnect removes the local token record; administrators manage Entra consent revocation separately.

The callback uses a same-origin POST from a minimal callback page. This allows the existing `SameSite=Strict` CargoGuard session cookie to remain unchanged while still binding the completed OAuth response to the original initiating session. State expires after ten minutes; the provider's code may expire sooner. An expired session requires starting connection again.

## Generate and validate the Outlook manifest

The template requests `ReadItem` for selected-message access and Mailbox 1.3. It is an add-in-only XML manifest using the read-item form. It is not a claim of Microsoft marketplace or all-client certification.

```powershell
node --import tsx scripts/generate-outlook-manifest.ts --origin https://YOUR_HOST --id YOUR_STABLE_ADDIN_GUID --output work/outlook-manifest.xml
```

The generator validates HTTPS and the GUID and writes a concrete manifest from `public/outlook/manifest.template.xml`. Validate its schema with Microsoft's current add-in validation tooling, then have the administrator sideload/deploy it for the intended Outlook client. Generation performs no deployment and creates no tenant or application.

Only `/outlook` is eligible for framing and only when explicitly enabled. All other application pages retain `X-Frame-Options: DENY`. OAuth pages are not designed to authenticate inside an arbitrary iframe: open the full workspace to sign in/connect when required by the client's browser policy.

**Client limitation:** browser Outlook may restrict third-party cookies, including CargoGuard's strict session cookie. This foundation deliberately does not weaken global session cookies or introduce a permissive bearer-token workaround. A supported Office dialog/SSO handoff and host-specific acceptance testing are required before claiming full Outlook-on-the-web support. The standalone `/outlook` page can manage connections and display configuration status without claiming access to an Outlook-selected item.

## Local checks and live acceptance boundary

Run:

```powershell
node --import tsx --test tests/microsoft.test.ts
```

The tests cover invalid configuration, encryption binding/tampering, fixed Graph destinations, bounded responses, state expiry/session binding/replay, token refresh, source-version checking, concurrent duplicate creation, external draft modification, changes during send preflight, ambiguous outcomes, bounded attachment handling and manifest/framing restrictions. They use synthetic addresses and tokens; they do not call Microsoft.

Before enabling a real pilot, verify actual consent, Conditional Access, token refresh/revocation, your Outlook client, shared-mailbox expectations, approved recipients, quota/rate limits, and the imported document's retained evidence. Test actual Graph draft body representation and the provider's send response in that tenant.

The source-version transaction prevents a stale local action at reservation time. Graph draft preflight and Graph send are separate remote operations: an Outlook editor could change a draft after preflight. Do not claim an atomic cross-system content lock. Keep application sending disabled until the organisation chooses and validates its outbound operating policy; users can review drafts directly in Outlook. Unknown operations must be reconciled with the mailbox by an operator; automatic reconciliation/resend is not implemented.

Current boundaries: delegated **own mailbox** only; no shared-mailbox access, subscription renewal, background delta sync, automatic chaser dispatch, unattended deadline scheduler, Teams alerts, automatic shipment association, or delivery receipt tracking. Deadline email reminders require explicit reviewer dispatch and an approved configured recipient. Source imports are individually reviewed and can then be linked to a confirmed shipment in CargoGuard.

## Official references

- [Microsoft authorization code and PKCE protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). Microsoft recommends a supported authentication library for production integrations; this isolated adapter uses the documented protocol and needs the live acceptance checks above before pilot activation.
- [Create a Graph message draft](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0).
- [Submit a Graph draft for sending](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0).
- [Outlook Mailbox API and REST identifier conversion](https://learn.microsoft.com/en-us/javascript/api/outlook/office.mailbox?view=outlook-js-preview).
- [Add-in-only XML manifest structure and schema ordering](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/xml-manifest-overview).
- [Outlook add-in permission levels](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/understanding-outlook-add-in-permissions).
