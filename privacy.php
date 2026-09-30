<?php
// ===== EDIT THESE BEFORE UPLOADING =====
$company     = 'XPAC';
$appName     = 'XPAC';
$package     = 'com.gowiserzc.sync';
$applyUrl    = 'https://apply.xpacsconnect.ph';
$email       = 'support@xpacsconnect.ph';        // TODO: confirm support email
$dpoName     = 'Data Protection Officer';   // TODO: DPO full name
$dpoEmail    = 'dpo@xpacsconnect.ph';            // TODO: confirm DPO email
$phone       = '';                          // TODO: contact number (leave blank to hide)
$address     = '';                          // TODO: office address (leave blank to hide)
// =======================================
$year = date('Y');
$e = fn($s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy | <?= $e($company) ?></title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root { --primary: #0f766e; --text: #1f2937; --muted: #6b7280; --bg: #f3f4f6; --card: #ffffff; --border: #e5e7eb; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Inter', system-ui, sans-serif; color: var(--text); background: var(--bg); line-height: 1.6; }
    .container { max-width: 860px; margin: 0 auto; padding: 0 16px; }
    header { background: var(--card); border-bottom: 1px solid var(--border); }
    header .container { display: flex; align-items: center; justify-content: space-between; height: 64px; }
    header .brand { font-weight: 800; font-size: 20px; color: var(--primary); text-decoration: none; }
    header a.btn { background: var(--primary); color: #fff; padding: 8px 16px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px; }
    .hero { padding: 40px 0 16px; }
    .tag { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--primary); }
    h1 { margin: 6px 0; font-size: 34px; }
    .hero p { color: var(--muted); margin: 0; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin: 16px 0; }
    h2 { font-size: 20px; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
    h2 span { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 14px; flex-shrink: 0; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    .highlight { background: #ecfdf5; border-left: 4px solid var(--primary); padding: 12px 16px; border-radius: 8px; margin-top: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 10px; }
    .grid div { background: var(--bg); border-radius: 10px; padding: 12px; }
    .grid strong { display: block; }
    .grid span { color: var(--muted); font-size: 14px; }
    a { color: var(--primary); }
    footer { text-align: center; color: var(--muted); font-size: 14px; padding: 32px 16px; }
  </style>
</head>
<body>

  <header>
    <div class="container">
      <a class="brand" href="/"><?= $e($company) ?></a>
      <a class="btn" href="<?= $e($applyUrl) ?>" target="_blank" rel="noopener noreferrer">Get Connected</a>
    </div>
  </header>

  <main class="container">
    <div class="hero">
      <span class="tag">Legal</span>
      <h1>Privacy Policy</h1>
      <p><?= $e($company) ?> &nbsp;|&nbsp; Last Updated: <?= date('F j, Y') ?></p>
    </div>

    <div class="card">
      <p><?= $e($company) ?> complies with the <strong>Data Privacy Act of 2012 (RA 10173)</strong>. We are committed to protecting your personal information.</p>
      <p>This policy covers our website, our customer portal, and the <strong><?= $e($appName) ?> mobile app</strong> (Google Play package <strong><?= $e($package) ?></strong>).</p>
    </div>

    <section class="card">
      <h2><span>1</span> Information We Collect</h2>
      <ul>
        <li>Full name, address, contact number, and email</li>
        <li>Valid ID (type, number, and copy)</li>
        <li>Billing and payment records</li>
        <li>Service and account information</li>
        <li>Internet usage logs (IP, MAC, bandwidth usage)</li>
        <li>Customer support interactions</li>
        <li><strong>Precise and approximate device location</strong> of staff and field technicians who use the <?= $e($appName) ?> mobile app, including in the background while on duty (see Section 2)</li>
        <li>Photos and files taken or selected in the mobile app as job order, installation, or site visit evidence</li>
      </ul>
    </section>

    <section class="card">
      <h2><span>2</span> Location Data (<?= $e($appName) ?> Mobile App)</h2>
      <p>The <?= $e($appName) ?> mobile app collects <strong>location data</strong> from the device of signed-in staff and field technicians.</p>
      <ul>
        <li><strong>What we collect:</strong> precise (GPS) and approximate location, together with location accuracy, speed, heading, and the time it was recorded.</li>
        <li><strong>When we collect it:</strong> while the technician is on duty, including when the app is closed or not in use (background location). While background tracking is on, Android shows a persistent notification.</li>
        <li><strong>Why we collect it:</strong> so dispatch can see a technician's live position on the dispatch map, assign technicians to nearby job orders, and confirm site visits and installations.</li>
        <li><strong>Consent:</strong> before asking for location permission, the app explains how location is used. Location is only collected after the user agrees and grants the permission.</li>
        <li><strong>Who can see it:</strong> only authorized dispatch and administrative staff of <?= $e($company) ?>. We do not share location data with advertisers or other third parties, and we do not use it for advertising.</li>
        <li><strong>How long we keep it:</strong> only the latest position of each technician is kept for the live map. Movement history is automatically deleted after 24 hours.</li>
        <li><strong>How to stop it:</strong> sign out of the app, or turn off location permission for <?= $e($appName) ?> in your device settings at any time. The rest of the app keeps working without location.</li>
      </ul>
      <p>Customers who only use the customer portal are not location-tracked by the app.</p>
    </section>

    <section class="card">
      <h2><span>3</span> Why We Collect Your Information</h2>
      <ul>
        <li>Create and verify your account</li>
        <li>Provide, maintain, and troubleshoot your internet service</li>
        <li>Dispatch technicians and record installations and site visits</li>
        <li>Process billing and payments</li>
        <li>Deliver customer support</li>
        <li>Secure our network</li>
        <li>Comply with legal and regulatory requirements (BIR, LGU, NTC, law enforcement)</li>
      </ul>
    </section>

    <section class="card">
      <h2><span>4</span> How Your Data Is Shared</h2>
      <ul>
        <li>Authorized <?= $e($company) ?> employees</li>
        <li>Third-party service providers that help us run our service (e.g., billing and messaging systems)</li>
        <li>Payment gateways</li>
        <li>Government agencies when required by law</li>
      </ul>
      <div class="highlight">We <strong>DO NOT</strong> sell your personal data, including location data.</div>
    </section>

    <section class="card">
      <h2><span>5</span> Data Retention</h2>
      <div class="grid">
        <div><strong>Subscriber &amp; Billing</strong><span>As long as your account is active, then as required by law</span></div>
        <div><strong>Network Logs</strong><span>1 year</span></div>
        <div><strong>Support Records</strong><span>2 years</span></div>
        <div><strong>Technician Location History</strong><span>24 hours</span></div>
      </div>
      <p>After these periods, data is securely deleted or destroyed.</p>
    </section>

    <section class="card">
      <h2><span>6</span> Data Security</h2>
      <p>Data sent between the app, the portal, and our servers is encrypted in transit (HTTPS). Access is limited to authorized personnel.</p>
    </section>

    <section class="card">
      <h2><span>7</span> Your Rights</h2>
      <ul>
        <li>Access your personal information</li>
        <li>Request correction of data</li>
        <li>Withdraw consent</li>
        <li>Request deletion of your account and data by emailing <a href="mailto:<?= $e($dpoEmail) ?>"><?= $e($dpoEmail) ?></a></li>
        <li>File a complaint with the National Privacy Commission (NPC)</li>
      </ul>
    </section>

    <section class="card">
      <h2><span>8</span> Contact Us</h2>
      <ul>
        <li><strong><?= $e($dpoName) ?></strong> (Data Protection Officer): <a href="mailto:<?= $e($dpoEmail) ?>"><?= $e($dpoEmail) ?></a></li>
        <li>Support: <a href="mailto:<?= $e($email) ?>"><?= $e($email) ?></a></li>
        <?php if ($phone !== ''): ?><li>Phone: <a href="tel:<?= $e(preg_replace('/[^0-9+]/', '', $phone)) ?>"><?= $e($phone) ?></a></li><?php endif; ?>
        <?php if ($address !== ''): ?><li>Address: <?= $e($address) ?></li><?php endif; ?>
      </ul>
    </section>

    <div class="card">
      <p>By continuing to use <?= $e($company) ?>'s services, you acknowledge that you have read, understood, and agree to our <strong>Terms &amp; Conditions</strong> and <strong>Privacy Policy</strong>.</p>
    </div>
  </main>

  <footer>&copy; <?= $year ?> <?= $e($company) ?>. All rights reserved.</footer>

</body>
</html>
