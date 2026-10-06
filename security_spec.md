# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched are unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity**: All write operations require `request.auth != null` and `request.auth.token.email_verified == true`.
3. **PII Split Collection Isolation**: User PII (`email`, `phone`, `preferredCurrency`) is stored exclusively in `/users/{userId}/private/{docId}` and can only be read or written by the verified owner (`request.auth.uid == userId`) or a verified admin (`exists(/databases/$(database)/documents/admins/$(request.auth.uid))`).
4. **Master Gate Relational Sync**: Subcollection documents under `/users/{userId}/orders/{orderId}` require the parent `/users/{userId}` document to exist (`exists(/databases/$(database)/documents/users/$(userId))`) and `ownerId == userId`.
5. **Terminal State Locking**: Once an order reaches a terminal state (`completed`, `failed`, `cancelled`, `refunded`), non-admin users cannot mutate it.
6. **Temporal & Identity Immutability**: `createdAt`, `uid`, `ownerId`, `orderNumber`, and `partnerOrderId` are immutable on update, and timestamps must equal `request.time`.
7. **Immutable Webhook Idempotency Lock (`/webhook_events/{eventId}`)**: Webhook idempotency records in `/webhook_events/{eventId}` require `eventId` to match the document ID (`isValidId(eventId)`), `provider == 'rechargegames'`, `status == 'processed'`, and `processedAt == request.time`. Once created, documents in `/webhook_events/{eventId}` are strictly immutable (`allow update, delete: if false;`) to guarantee that a processed `event_id` can never be replayed or tampered with.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null`, creating `/users/user_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'admin_1', token: { email: 'leaderlindor@gmail.com', email_verified: false } }` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on User Create**: `auth.uid = 'user_1'`, payload `{ uid: 'user_2', displayName: 'Spoof' }` at `/users/user_1` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Create**: Payload includes undeclared field `{ uid: 'user_1', displayName: 'Alice', isAdmin: true, createdAt: request.time, updatedAt: request.time }` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Update**: Updating `/users/user_1` with `{ displayName: 'Alice2', role: 'superadmin', updatedAt: request.time }` -> `PERMISSION_DENIED`.
6. **PII Blanket Read Attack**: Authenticated user `user_2` attempting `get` on `/users/user_1/private/info` -> `PERMISSION_DENIED`.
7. **ID Poisoning Attack**: Creating `/users/invalid$id!@#` -> `PERMISSION_DENIED`.
8. **Value Poisoning (Oversized String)**: Updating `displayName` with a 5,000-character string (> max 80) -> `PERMISSION_DENIED`.
9. **Orphaned Subcollection Write**: Creating `/users/non_existent_user/orders/ord_1` when `/users/non_existent_user` does not exist -> `PERMISSION_DENIED`.
10. **Immortal Field Mutation**: Updating `createdAt` or `uid` on `/users/user_1` -> `PERMISSION_DENIED`.
11. **Forged Client Timestamp**: Creating `/users/user_1` with `createdAt` != `request.time` -> `PERMISSION_DENIED`.
12. **Terminal State Bypass**: User attempting to update an order whose existing `status` is `'completed'` -> `PERMISSION_DENIED`.
