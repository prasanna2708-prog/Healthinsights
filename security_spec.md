# Security Specification & Payload-First Verification

## 1. Data Invariants
1. **Identity & Privilege Invariant**: Non-bootstrapped users registering a profile in `/users/{uid}` may only create their profile with `role == 'viewer'`. Role promotion (`analyst`, `admin`) may only be performed by an authenticated, email-verified `admin`.
2. **PII Isolation Invariant**: User emails are isolated in `/users/{uid}/private/contact`, readable only by the document owner or a verified admin. Claim records store AES-256-GCM encrypted patient tokens (`encryptedPatientId`) and masked IDs (`maskedPatientId`) — never raw patient identifiers.
3. **Referential & Ownership Invariant**: Every dataset, claim record, risk rule preset, and scenario carries `ownerId == request.auth.uid` on creation. Subcollection `/datasets/{datasetId}/claims/{claimId}` verifies parent dataset existence and matching `datasetId` via `get()` / `exists()` on single-document operations.
4. **Zero Client-Delegated List Queries**: Every `allow list` rule explicitly enforces `resource.data` checks (`resource.data.ownerId == request.auth.uid || resource.data.visibility == 'shared' || isBootstrappedAdmin()`) with zero `get()` or `exists()` lookups inside `list` blocks.
5. **Strict Key & Type Bounds**: Every create validates exact keys via `keys().hasAll(...) && keys().hasOnly(...)` and every update validates `affectedKeys().hasOnly(...)` alongside `isValid[Entity](incoming())`. All strings enforce `.size()` limits and timestamps enforce `request.time`.
6. **Immutable Audit Trail**: `/auditLogs/{logId}` records are append-only (`allow update, delete: if false`) and readable only by the actor or a verified admin.

## 2. Adversarial "Dirty Dozen" Payloads
1. **Privilege Escalation on Registration**: Creating `/users/attackerUid` with `{"uid":"attackerUid","displayName":"Mallory","role":"admin","department":"External"}` -> `PERMISSION_DENIED`.
2. **Self-Promotion Update**: Updating own `/users/viewerUid` changing `role` from `"viewer"` to `"admin"` -> `PERMISSION_DENIED`.
3. **Email Spoofing (Unverified Admin)**: Authenticated token with `email: "historymaker620@gmail.com"` and `email_verified: false` attempting admin write -> `PERMISSION_DENIED`.
4. **PII Cross-Tenant Read**: Viewer A attempting `get` on `/users/userB/private/contact` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Dataset**: Creating `/datasets/ds1` with an extra undocumented field `"isVerified": true` -> `PERMISSION_DENIED`.
6. **Oversized ID Poisoning**: Creating `/datasets/` with a 500-character ID or invalid characters (`ds1/../admin`) -> `PERMISSION_DENIED`.
7. **Orphaned Claim Injection**: Creating `/datasets/nonexistent_ds/claims/c1` -> `PERMISSION_DENIED` (`exists()` parent gate fails).
8. **Dataset Ownership Spoofing**: Analyst A creating a claim inside Analyst B's private dataset -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: Creating a dataset with `createdAt` set to a past client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **Immutable Owner Mutation**: Updating `/riskRules/r1` to overwrite `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **Unbounded Query Scraping**: Executing `list` on `/users` or `/auditLogs` as a non-admin viewer without actor filter -> `PERMISSION_DENIED`.
12. **Audit Log Tampering**: Attempting `update` or `delete` on `/auditLogs/log1` even as admin -> `PERMISSION_DENIED`.
