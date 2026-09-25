<?php
// Copy to /home/YOUR_CPANEL_USER/smokeys-wallet/config.php, OUTSIDE public_html.
// This example contains no credentials. Keep the real config out of Git.
return [
    'apps_script_url' => '', // The current Apps Script /exec URL from assets/event-ticketing/config.js.
    'event_id' => '',       // Must match getEvent. Confirm the real venue and dates first.
    'event_confirmed' => false,
    // Per-client limit for pass requests (20 per 10 min). Keep it outside public_html.
    'rate_limit_dir' => __DIR__ . '/rate-limit',
    'apple' => [
        'enabled' => false,
        'pass_type_id' => 'pass.com.captainsmokeysbbq.event',
        'team_id' => '',
        'certificate' => __DIR__ . '/apple-pass.pem',
        'private_key' => __DIR__ . '/apple-key.pem',
        'key_password' => '',
        'wwdr_certificate' => __DIR__ . '/apple-wwdr.pem',
    ],
    'google' => [
        'enabled' => false,
        'issuer_id' => '',
        'service_account' => __DIR__ . '/google-service-account.json',
    ],
];
