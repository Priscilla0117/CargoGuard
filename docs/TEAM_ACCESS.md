# Team identity and access

The default mode remains an explicitly labelled, isolated synthetic demo. It does not authenticate a typed reviewer name. Enable team mode only on a deliberately configured deployment; its server session determines the workspace, identity and permissions for every protected endpoint.

## Configuration

Set `CARGO_AUTH_MODE=team`, `CARGO_PUBLIC_ORIGIN` to the deployment's HTTPS origin, and a cryptographically random `CARGO_BOOTSTRAP_SECRET` of at least 32 characters in the server environment. Do not commit or publish the secret. HTTP is allowed only for local loopback rehearsal. Run the normal database migrations, including `0006_team_identity.sql`, before serving requests. Preserve the database and its backups.

Open the app and choose **First-time team setup**. Supply the setup credential and create a named administrator with a 15–128 character password/passphrase. Setup consumes the single installation slot atomically; it cannot create a second team or administrator after initialization. Remove the bootstrap secret from the server after successful setup. The setup endpoint never signs a caller in automatically.

The administrator signs in and opens **Team access** to add operators, reviewers or other administrators. Initial credentials must be distributed using the organization's approved secure channel; the app sends no emails. Members can change their own password, which revokes all their sessions. Keep at least two managed administrator accounts for recovery. This version has no public self-registration or email password-reset flow.

## Enforced permissions

| Role | Permissions |
| --- | --- |
| Operator | Read the shared workspace, process/import documents, organize work, draft tasks and propose rules. |
| Reviewer | Operator abilities plus manual source confirmation/correction, classification override, document selection, completion, instruction approval and label-rule decisions. |
| Administrator | Reviewer abilities plus team membership and policy administration. |

Permissions are enforced by the server for direct API requests and document/export routes. A role in request JSON or a forged anonymous workspace cookie grants no access. Actions derive their recorded actor from the authenticated account; legacy actor fields remain accepted for demo compatibility but cannot impersonate another team member.

Members share only their assigned workspace. Assignment selectors use active membership records. Role/active changes use version checks, prevent removal of the last active administrator and revoke the target member's sessions. Membership is checked on each request. An already-running authorized operation may finish after its initiating session is revoked; revocation blocks subsequent requests.

## Security implementation and limits

- Passwords use a unique random 256-bit salt and PBKDF2-HMAC-SHA-256 with 600,000 iterations through Web Crypto; only derived hashes are stored. [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Sessions are random 256-bit opaque tokens. The database stores their SHA-256 hashes, with an eight-hour absolute lifetime and 30-minute idle expiry. Cookies are HttpOnly, SameSite=Strict and Secure over HTTPS. Logout revokes the server session. [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
- Browser writes require a matching origin. Team requests with no origin or a cross-site fetch context are rejected; approved API clients must send the configured Origin header.
- Login attempts are reserved atomically in the database: six per account identifier and 60 globally per 15-minute window. Identifiers in the limiter are hashes. Errors do not distinguish an absent account from an unavailable account or incorrect password. Global limits protect the small pilot but require tuning with infrastructure rate controls for enterprise use.
- Team access changes and sessions have an immutable application-level audit table. Case revisions and operational audit history remain separately available. Diagnostic errors do not log document values, passwords, email bodies or raw provider errors; authorized case records retain evidence required for review.

This is a working local/pilot authentication mode, not an assertion of enterprise identity certification. Corporate SSO/MFA, lifecycle provisioning, central security monitoring, formal recovery procedures, penetration testing, infrastructure log review and production access policies require an Averis-managed rollout. Database administrators can still alter database contents outside the app; SQL immutability triggers are application safeguards, not tamper-proof external storage. The current supported password implementation was verified on the Node deployment runtime; legacy edge runtime support must be validated separately before enabling team mode there.

`tests/auth.test.ts` verifies salted password hashing, one-time bootstrap, capability boundaries, direct endpoint guards, forged workspace cookies, session revocation/expiry, origin checks, cookie flags, concurrent throttle reservations, immutable audit history and last-administrator protection.
