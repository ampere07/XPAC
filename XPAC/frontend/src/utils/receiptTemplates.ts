/**
 * Printable receipt / invoice templates for a settled transaction.
 *
 * Extracted from TransactionListDetails so the same markup can be reused by the
 * receipt preview modal, the print path and the PDF export — previously the HTML
 * was built inline inside the print handler, so a preview could only ever have
 * been an approximation of what actually printed. Everything now renders from
 * this one source, which is why the preview is pixel-identical to the output.
 *
 * Two formats:
 *   pos80  72mm slip for an 80mm thermal roll (monospace, dashed rules)
 *   a4     full A4 invoice (proportional type, ruled table, signature blocks)
 */

export type ReceiptFormat = 'pos80' | 'a4';

export interface ReceiptCompany {
  name: string;
  address: string;
  tin: string;
  sec: string;
  bpNo: string;
  tel: string;
  email: string;
}

export interface ReceiptData {
  company: ReceiptCompany;
  logoSrc: string;
  receiptNo: string;
  dateStr: string;
  timeStr: string;
  customerName: string;
  accountNo: string;
  contact: string;
  address: string;
  /** e.g. "Recurring Fee (Plan C)" */
  description: string;
  /** Optional service-period line shown under the description. */
  periodLabel?: string;
  /** Pre-formatted, e.g. "₱1,000.00" */
  amount: string;
  paymentMethod: string;
  referenceNo?: string;
  processedBy?: string;
}

export const RECEIPT_DISCLAIMER =
  'This document is a temporary proof of payment/acknowledgment only and is not valid for '
  + 'claiming input tax or official accounting purposes.';

/** Printed wherever a value cannot be resolved at all. */
const PLACEHOLDER = '-';

/** HTML-escape a value for interpolation into a template. */
const esc = (v: unknown): string =>
  String(v ?? PLACEHOLDER)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** First value that is neither null/undefined nor blank once trimmed. */
const firstFilled = (values: unknown[], fallback = PLACEHOLDER): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== '') return text;
  }
  return fallback;
};

/**
 * Company block used when the caller supplies none, or an incomplete one.
 *
 * Empty strings rather than a placeholder: a masthead reading "TIN: -" looks like a data
 * error, whereas an absent line simply is not printed. The name is the exception — the slip
 * has to say who issued it, and it is referenced in three places in each template.
 */
const FALLBACK_COMPANY: ReceiptCompany = {
  name: 'OFFICIAL RECEIPT',
  address: '',
  tin: '',
  sec: '',
  bpNo: '',
  tel: '',
  email: '',
};

/**
 * Fill in whatever the caller left out, so a template only ever renders complete data.
 *
 * The templates are handed transactions from two eras. Rows written by this system arrive
 * with every field populated; rows migrated from the old database arrive with NULL OR
 * numbers, no processed-by, no service period, sometimes no customer at all — and, for the
 * oldest of them, a `company` that was never attached because the caller read it off a
 * relation that did not hydrate.
 *
 * Guarding here rather than at each call site is deliberate: the templates interpolate
 * `d.company.name` and `d.amount` directly, so a single missing branch is a blank slip or a
 * `Cannot read properties of undefined` thrown mid-print — with the print dialog already
 * open and a customer waiting at the counter. Every field is resolved to a printable string
 * before any markup is built.
 *
 * Idempotent: normalising an already-normalised payload returns the same values, so the
 * preview, the print window and the PDF export can each call it without compounding
 * fallbacks.
 */
export const normalizeReceiptData = (data: Partial<ReceiptData> | null | undefined): ReceiptData => {
  const source = data ?? {};
  const company = source.company ?? ({} as Partial<ReceiptCompany>);

  const periodLabel = firstFilled([source.periodLabel], '');
  const referenceNo = firstFilled([source.referenceNo], '');
  const processedBy = firstFilled([source.processedBy], '');

  return {
    company: {
      name: firstFilled([company.name], FALLBACK_COMPANY.name),
      address: firstFilled([company.address], FALLBACK_COMPANY.address),
      tin: firstFilled([company.tin], FALLBACK_COMPANY.tin),
      sec: firstFilled([company.sec], FALLBACK_COMPANY.sec),
      bpNo: firstFilled([company.bpNo], FALLBACK_COMPANY.bpNo),
      tel: firstFilled([company.tel], FALLBACK_COMPANY.tel),
      email: firstFilled([company.email], FALLBACK_COMPANY.email),
    },
    // Blank rather than a placeholder: the <img> is hidden by its own onerror handler, and a
    // src of "-" would fire a pointless request for a relative path first.
    logoSrc: firstFilled([source.logoSrc], ''),
    receiptNo: firstFilled([source.receiptNo]),
    dateStr: firstFilled([source.dateStr]),
    timeStr: firstFilled([source.timeStr]),
    customerName: firstFilled([source.customerName]),
    accountNo: firstFilled([source.accountNo]),
    contact: firstFilled([source.contact]),
    // The templates already render `d.address || '-'`, so an empty string is safe here and
    // keeps "no address on file" distinguishable from a literal dash in the data.
    address: firstFilled([source.address], ''),
    description: firstFilled([source.description], 'Payment'),
    amount: firstFilled([source.amount], '₱0.00'),
    paymentMethod: firstFilled([source.paymentMethod]),
    // Optional lines: the templates test them for truthiness before printing a row, so '' is
    // what omits the line entirely.
    ...(periodLabel ? { periodLabel } : {}),
    ...(referenceNo ? { referenceNo } : {}),
    ...(processedBy ? { processedBy } : {}),
  };
};

/** Filename stem for downloads, e.g. "Receipt_2026-004293_A4". */
export const receiptFileName = (data: Partial<ReceiptData> | null | undefined, format: ReceiptFormat): string => {
  const safeNo = normalizeReceiptData(data).receiptNo.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `Receipt_${safeNo}_${format === 'a4' ? 'A4' : '80mm'}`;
};

export const buildReceiptHtml = (
  data: Partial<ReceiptData> | null | undefined,
  format: ReceiptFormat
): string => {
  const safe = normalizeReceiptData(data);
  return format === 'a4' ? buildA4Invoice(safe) : buildPos80Receipt(safe);
};

/**
 * "Label: value" for the parts that are actually present, joined by `sep`.
 *
 * The company registration details are printed as pairs ("TIN: … | SEC: …"). A migrated
 * deployment may hold only some of them, and interpolating the blanks straight in yields
 * "TIN:  | SEC: " — a line that reads as a rendering fault rather than as absent data. Pairs
 * with nothing behind them are dropped, and the separator disappears with them.
 */
const metaPairs = (pairs: Array<[string, string]>, sep: string): string =>
  pairs
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `${esc(label)}: ${esc(value)}`)
    .join(sep);

/** A `<div class="muted">` line that is omitted entirely when its value is blank. */
const mutedLine = (value: string, label?: string): string =>
  value === ''
    ? ''
    : `<div class="muted">${label ? `${esc(label)}: ` : ''}${esc(value)}</div>`;

// ── 80mm thermal slip ────────────────────────────────────────────────────────

const buildPos80Receipt = (d: ReceiptData): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${esc(d.receiptNo)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      color: #000; background: #fff;
      font-size: 11px; line-height: 1.4;
      width: 72mm; max-width: 72mm; margin: 0 auto; padding: 10px 8px;
    }
    .center { text-align: center; }
    .logo { width: 54px; height: auto; margin: 0 auto 4px; display: block; }
    .company { font-weight: bold; font-size: 13px; letter-spacing: .5px; }
    .muted { font-size: 11px; }
    .divider { border: none; border-top: 1px dashed #000; margin: 8px 0; }
    .title { font-weight: bold; letter-spacing: 2px; font-size: 13px; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .row .label { white-space: nowrap; }
    .row .value { text-align: right; font-weight: bold; word-break: break-word; }
    .section-head { display: flex; justify-content: space-between; font-weight: bold; }
    .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; }
    .thanks { font-size: 11px; }
    /* Boxed and bold so the validity notice reads as a disclaimer rather than as part of the
       sign-off. No colour — thermal printers are monochrome. */
    .disclaimer {
      font-size: 10px; line-height: 1.35; text-align: center; font-weight: bold;
      border: 1px dashed #000; padding: 5px 4px; margin: 8px 0;
    }
    @page { margin: 0; }
    @media print {
      /* html spans the full sheet (Letter, A4 or thermal roll); the body is a fixed
         narrow slip auto-centered within it, so the receipt is centered on ANY paper size. */
      html { width: 100%; margin: 0; }
      body { width: 72mm; max-width: 72mm; margin: 0 auto; padding: 8px 6px; }
    }
  </style>
</head>
<body>
  <div class="center">
    ${d.logoSrc ? `<img class="logo" src="${esc(d.logoSrc)}" alt="logo" onerror="this.style.display='none'" />` : ''}
    <div class="company">${esc(d.company.name)}</div>
    ${mutedLine(d.company.address)}
    ${(() => {
      const regs = metaPairs([['TIN', d.company.tin], ['SEC', d.company.sec]], ' | ');
      return regs ? `<div class="muted">${regs}</div>` : '';
    })()}
    ${mutedLine(d.company.bpNo, 'BP No')}
    ${mutedLine(d.company.tel, 'Tel')}
    ${mutedLine(d.company.email)}
  </div>

  <hr class="divider" />
  <div class="center title">* OFFICIAL RECEIPT *</div>
  <hr class="divider" />

  <div class="row"><span class="label">Receipt #:</span><span class="value">${esc(d.receiptNo)}</span></div>
  <div class="row"><span class="label">Date:</span><span class="value">${esc(d.dateStr)}</span></div>
  <div class="row"><span class="label">Time:</span><span class="value">${esc(d.timeStr)}</span></div>

  <hr class="divider" />
  <div style="font-weight:bold;">Bill To:</div>
  <div style="font-weight:bold;">${esc(d.customerName)}</div>
  <div class="row"><span class="label">Account #:</span><span class="value">${esc(d.accountNo)}</span></div>
  <div class="row"><span class="label">Contact:</span><span class="value">${esc(d.contact)}</span></div>
  <div class="muted">Address: ${esc(d.address || '-')}</div>

  <hr class="divider" />
  <div class="section-head"><span>DESCRIPTION</span><span>AMOUNT</span></div>
  <hr class="divider" />
  <div class="row"><span class="label">${esc(d.description)}</span><span class="value">${esc(d.amount)}</span></div>
  ${d.periodLabel ? `<div class="muted">${esc(d.periodLabel)}</div>` : ''}

  <hr class="divider" />
  <div class="total-row"><span>TOTAL AMOUNT:</span><span>${esc(d.amount)}</span></div>
  <hr class="divider" />
  <div class="row"><span class="label">Payment Method:</span><span class="value">${esc(d.paymentMethod).toUpperCase()}</span></div>

  <hr class="divider" />
  <div class="disclaimer">${esc(RECEIPT_DISCLAIMER)}</div>

  <hr class="divider" />
  <div class="center thanks">THANK YOU FOR YOUR PAYMENT!</div>
  <div class="center thanks">Keep this receipt for your records.</div>
  <div class="center thanks">For inquiries, please contact us.</div>
  <div class="center thanks" style="margin-top:6px; font-weight:bold;">${esc(d.company.name)}</div>
  ${d.company.tel ? `<div class="center thanks">Tel: ${esc(d.company.tel)}</div>` : ''}
  ${d.company.email ? `<div class="center thanks">${esc(d.company.email)}</div>` : ''}
</body>
</html>`;

// ── A4 invoice ───────────────────────────────────────────────────────────────

const buildA4Invoice = (d: ReceiptData): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${esc(d.receiptNo)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111; background: #fff;
      font-size: 12px; line-height: 1.5;
      width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 15mm;
    }
    .masthead { border-bottom: 2px solid #111; padding-bottom: 8mm; margin-bottom: 8mm; }
    .masthead table { width: 100%; border-collapse: collapse; }
    .masthead td { vertical-align: top; border: none; padding: 0; }
    .logo { width: 74px; height: auto; display: block; margin-bottom: 4px; }
    .company-name { font-size: 17px; font-weight: bold; letter-spacing: .4px; }
    .company-meta { font-size: 10.5px; color: #444; line-height: 1.5; }
    .doc-title { font-size: 22px; font-weight: bold; letter-spacing: 2px; text-align: right; }
    .doc-meta { font-size: 11px; text-align: right; margin-top: 4px; }
    .doc-meta strong { display: inline-block; min-width: 62px; text-align: left; color: #444;
                       font-weight: normal; }

    .panels { width: 100%; border-collapse: collapse; margin-bottom: 7mm; }
    .panels td { width: 50%; vertical-align: top; padding: 0 6mm 0 0; border: none; }
    .panel-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px;
                   color: #666; margin-bottom: 2mm; }
    .panel-box { border: 1px solid #ddd; background: #fafafa; padding: 4mm; min-height: 30mm; }
    .panel-box .name { font-weight: bold; font-size: 13px; margin-bottom: 1.5mm; }
    .panel-box .line { font-size: 11px; color: #333; }

    table.items { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
    table.items thead th {
      background: #111; color: #fff; font-size: 10px; text-transform: uppercase;
      letter-spacing: .8px; padding: 3mm 3mm; text-align: left; font-weight: bold;
    }
    table.items thead th.num { text-align: right; }
    table.items tbody td { padding: 3.5mm 3mm; border-bottom: 1px solid #e5e5e5; font-size: 12px;
                           vertical-align: top; }
    table.items tbody td.num { text-align: right; white-space: nowrap; }
    table.items tbody .sub { display: block; font-size: 10.5px; color: #666; margin-top: 1mm; }

    .totals { width: 46%; margin-left: auto; border-collapse: collapse; }
    .totals td { padding: 2.5mm 3mm; font-size: 12px; border: none; }
    .totals td.num { text-align: right; white-space: nowrap; }
    .totals tr.grand td {
      border-top: 2px solid #111; border-bottom: 2px solid #111;
      font-size: 14px; font-weight: bold;
    }

    .paid-stamp {
      display: inline-block; border: 2px solid #111; padding: 2mm 5mm; font-weight: bold;
      letter-spacing: 2px; font-size: 13px; margin-top: 5mm;
    }

    .disclaimer {
      margin-top: 7mm; border: 1px solid #bbb; background: #fafafa;
      padding: 3.5mm 4mm; font-size: 10px; line-height: 1.45; color: #333;
    }

    .signatures { width: 100%; border-collapse: collapse; margin-top: 12mm; }
    .signatures td { width: 50%; padding: 0 8mm 0 0; border: none; vertical-align: bottom; }
    .sig-line { border-top: 1px solid #111; padding-top: 1.5mm; font-size: 10.5px; color: #444; }

    .footer { margin-top: 10mm; border-top: 1px solid #ddd; padding-top: 3mm;
              font-size: 10px; color: #666; text-align: center; }

    @page { size: A4; margin: 0; }
    @media print {
      body { width: 210mm; padding: 14mm 15mm; }
      .panel-box { background: #fafafa !important; -webkit-print-color-adjust: exact;
                   print-color-adjust: exact; }
      table.items thead th { background: #111 !important; color: #fff !important;
                             -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <div class="masthead">
    <table>
      <tr>
        <td style="width:58%;">
          ${d.logoSrc ? `<img class="logo" src="${esc(d.logoSrc)}" alt="logo" onerror="this.style.display='none'" />` : ''}
          <div class="company-name">${esc(d.company.name)}</div>
          <div class="company-meta">
            ${[
              d.company.address ? esc(d.company.address) : '',
              metaPairs([['TIN', d.company.tin], ['SEC', d.company.sec]], ' &nbsp;|&nbsp; '),
              metaPairs([['BP No', d.company.bpNo], ['Tel', d.company.tel]], ' &nbsp;|&nbsp; '),
              d.company.email ? esc(d.company.email) : '',
            ].filter(Boolean).join('<br />')}
          </div>
        </td>
        <td style="width:42%;">
          <div class="doc-title">OFFICIAL RECEIPT</div>
          <div class="doc-meta">
            <strong>OR No.</strong> ${esc(d.receiptNo)}<br />
            <strong>Date</strong> ${esc(d.dateStr)}<br />
            <strong>Time</strong> ${esc(d.timeStr)}
            ${d.referenceNo ? `<br /><strong>Ref No.</strong> ${esc(d.referenceNo)}` : ''}
          </div>
        </td>
      </tr>
    </table>
  </div>

  <table class="panels">
    <tr>
      <td>
        <div class="panel-label">Billed To</div>
        <div class="panel-box">
          <div class="name">${esc(d.customerName)}</div>
          <div class="line">Account #: ${esc(d.accountNo)}</div>
          <div class="line">Contact: ${esc(d.contact)}</div>
          <div class="line">${esc(d.address || '-')}</div>
        </div>
      </td>
      <td style="padding-right:0;">
        <div class="panel-label">Payment Details</div>
        <div class="panel-box">
          <div class="line">Method: <strong>${esc(d.paymentMethod).toUpperCase()}</strong></div>
          ${d.referenceNo ? `<div class="line">Reference: ${esc(d.referenceNo)}</div>` : ''}
          ${d.processedBy ? `<div class="line">Processed By: ${esc(d.processedBy)}</div>` : ''}
          <div class="line">Date Paid: ${esc(d.dateStr)}</div>
        </div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:70%;">Description</th>
        <th class="num" style="width:30%;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          ${esc(d.description)}
          ${d.periodLabel ? `<span class="sub">${esc(d.periodLabel)}</span>` : ''}
        </td>
        <td class="num">${esc(d.amount)}</td>
      </tr>
    </tbody>
  </table>

  <table class="totals">
    <tr>
      <td>Subtotal</td>
      <td class="num">${esc(d.amount)}</td>
    </tr>
    <tr class="grand">
      <td>TOTAL AMOUNT PAID</td>
      <td class="num">${esc(d.amount)}</td>
    </tr>
  </table>

  <div class="paid-stamp">PAID</div>

  <div class="disclaimer">${esc(RECEIPT_DISCLAIMER)}</div>

  <table class="signatures">
    <tr>
      <td><div class="sig-line">Received By / Authorised Signature</div></td>
      <td style="padding-right:0;"><div class="sig-line">Customer Signature</div></td>
    </tr>
  </table>

  <div class="footer">
    ${[
      esc(d.company.name),
      d.company.tel ? `Tel: ${esc(d.company.tel)}` : '',
      d.company.email ? esc(d.company.email) : '',
    ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ')}
  </div>

</body>
</html>`;
