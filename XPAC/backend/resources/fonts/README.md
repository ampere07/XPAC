# Invoice fonts

The agent invoice is set in six typefaces, one per slot. Each slot resolves in
this order:

1. `invoice-<slot>.ttf` — the specified face, once you have installed it
2. `invoice-<slot>.fallback.ttf` — an open-licensed stand-in of the same character
3. Helvetica

A missing font therefore makes the invoice plainer, never unissuable.

## The slots

| Slot | Used for | Specified face | What is installed now |
|---|---|---|---|
| `title` | the `BOOTH - REFERRAL` banner | Knockout Featherweight | **stand-in** — Anton |
| `meta` | the invoice date, and the team or agent name | Agrandir Narrow | **stand-in** — Archivo Narrow Bold |
| `head` | the table column headings | Open Sans | **Open Sans SemiBold** |
| `body` | the customer rows | Arimo | **Arimo Regular** |
| `totals` | the totals block | Arial MT Pro | **Arimo Bold** (metric-compatible with Arial) |
| `script` | the `Thank you!` sign-off | Halimum | **stand-in** — Great Vibes |

Open Sans and Arimo are the faces you asked for, under licences that allow
redistribution (SIL OFL / Apache 2.0), so those three slots are already exact.

Arimo is metrically compatible with Arial — same widths, same line breaks — so
the totals block sets identically to Arial MT Pro even before the licensed file
is added.

## Installing a licensed face

Knockout Featherweight, Agrandir Narrow and Halimum are commercial fonts. They
cannot be downloaded; they have to be bought from the foundry:

| Face | Foundry |
|---|---|
| Knockout Featherweight | Hoefler&Co (typography.com) |
| Agrandir Narrow | Pangram Pangram |
| Halimum | sold through the script-font marketplaces |
| Arial MT Pro | Monotype |

Once you have the `.ttf`, rename it and drop it in beside the stand-in:

```
invoice-title.ttf      <- Knockout Featherweight
invoice-meta.ttf       <- Agrandir Narrow
invoice-script.ttf     <- Halimum
invoice-totals.ttf     <- Arial MT Pro   (already good as Arimo Bold)
```

Nothing else changes. The primary name wins over the `.fallback` one
automatically on the next invoice generated.

Check the foundry's licence covers **PDF embedding** — most desktop licences do,
but some are seat-limited, and a server rendering invoices is not a desktop.

## Licensing

Do not commit a font you are not licensed to redistribute. Everything currently
in this folder is OFL or Apache 2.0 and safe to ship. Microsoft's faces (Impact,
Arial Narrow, Segoe Script) are convenient for a local preview but are not yours
to deploy.

## Format

TrueType (`.ttf`) only. Dompdf does not read `.otf` or `.woff2`; convert first if
the foundry supplies one of those.
