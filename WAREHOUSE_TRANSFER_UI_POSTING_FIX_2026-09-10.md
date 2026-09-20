# Warehouse Transfer UI & Posting Fix — 2026-09-10

- Enlarged the enterprise warehouse transfer creation modal to use a wider desktop layout and taller viewport.
- Improved item table width for the larger layout.
- Fixed the "تقديم طلب تحويل معتمد" action so it submits an approved transfer with `auto_post=true`.
- Added an atomic server-side direct-post path: validate source available quantities, deduct source stock, add destination stock, update transfer to `completed`, write inventory ledger entries, and audit the operation in one DB transaction.
- Existing request -> approve -> dispatch -> receive workflow remains available for normal requests.
- Duplicate/insufficient stock validation is performed before any direct-post stock movement.
