# Invoice artwork

| File | Used for |
|---|---|
| `agentinvoiceheader.png` | the top of the agent invoice — ATSS FIBER mark and watermark |
| `agentinvoicefooter.png` | the foot — angled bars and the contact strip |

## Why there is a copy here

These originate in `ATSS2_0/frontend/src/assets/`. They are copied here because
the backend renders the invoice PDF, and on the server only `backend/` is
deployed — `frontend/src` is a build input that never reaches it, so the
renderer cannot read from there.

The service prefers this copy and falls back to the frontend path, which only
resolves in a local checkout.

## Refreshing after the artwork changes

Update the originals in `frontend/src/assets/`, then copy them across:

```sh
cd ATSS2_0
cp frontend/src/assets/agentinvoiceheader.png frontend/src/assets/agentinvoicefooter.png \
   backend/resources/images/
```

To check the two are in step:

```sh
cd ATSS2_0
for f in agentinvoiceheader.png agentinvoicefooter.png; do
  diff -q "frontend/src/assets/$f" "backend/resources/images/$f" \
    && echo "$f in sync" || echo "$f OUT OF SYNC — copy it across"
done
```

A missing image does not stop an invoice being issued: the template falls back
to plain text and the document is still valid, just unbranded.
