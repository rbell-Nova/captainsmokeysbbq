<?php
declare(strict_types=1);

// No secrets in this file. Configuration and keys live outside public_html.
final class WalletError extends RuntimeException {}

function walletJson(array $value): string {
    return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}
function walletBase64(string $value): string {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}
function walletJwt(array $claims, string $key): string {
    $input = walletBase64(walletJson(['alg' => 'RS256', 'typ' => 'JWT'])) . '.' . walletBase64(walletJson($claims));
    if (!openssl_sign($input, $signature, $key, OPENSSL_ALGO_SHA256)) {
        throw new WalletError('Wallet signing is unavailable. Please use your ticket QR code.', 503);
    }
    return $input . '.' . walletBase64($signature);
}
function walletRead(string $path): string {
    $data = @file_get_contents($path);
    if ($data === false) throw new WalletError('Wallet configuration is incomplete.', 503);
    return $data;
}
function walletDocumentRoot(): string {
    return realpath($_SERVER['DOCUMENT_ROOT'] ?? '') ?: '';
}
// True only for a readable file that is NOT inside the public web root, so a
// misconfigured key/certificate path can never point at a downloadable file.
function walletPrivateFile(?string $path): bool {
    if (!is_string($path) || $path === '') return false;
    $real = realpath($path);
    if (!$real || !is_file($real) || !is_readable($real)) return false;
    $root = walletDocumentRoot();
    return !($root && ($real === $root || str_starts_with($real, $root . DIRECTORY_SEPARATOR)));
}
function walletConfig(): array {
    $root = walletDocumentRoot();
    $path = getenv('SMOKEYS_WALLET_CONFIG') ?: ($root ? dirname($root) . '/smokeys-wallet/config.php' : '');
    if (!walletPrivateFile($path)) return [];
    $config = require realpath($path);
    return is_array($config) ? $config : [];
}
function walletCapabilities(array $config): array {
    $base = !empty($config['event_confirmed']) && !empty($config['event_id'])
        && preg_match('~^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$~D', $config['apps_script_url'] ?? '')
        && extension_loaded('curl') && extension_loaded('openssl');
    $apple = $config['apple'] ?? [];
    $google = $config['google'] ?? [];
    return [
        'apple' => (bool)($base && !empty($apple['enabled']) && !empty($apple['pass_type_id']) && !empty($apple['team_id'])
            && walletPrivateFile($apple['certificate'] ?? null) && walletPrivateFile($apple['private_key'] ?? null)
            && walletPrivateFile($apple['wwdr_certificate'] ?? null) && function_exists('openssl_cms_sign') && class_exists('ZipArchive')),
        'google' => (bool)($base && !empty($google['enabled']) && preg_match('/^[0-9]+$/D', (string)($google['issuer_id'] ?? ''))
            && walletPrivateFile($google['service_account'] ?? null)),
    ];
}

// Small per-client limiter for the pass endpoints (shared hosting, no Redis).
// Stores only a hash of the client address, never the ticket token.
function walletRateLimit(string $dir, string $client, int $limit = 20, int $windowSeconds = 600): void {
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) return; // fail open rather than break tickets
    $file = $dir . '/' . hash('sha256', $client) . '.json';
    $handle = @fopen($file, 'c+');
    if (!$handle) return;
    try {
        flock($handle, LOCK_EX);
        $now = time();
        $hits = json_decode(stream_get_contents($handle) ?: '[]', true);
        $hits = array_values(array_filter(is_array($hits) ? $hits : [], fn($t) => is_int($t) && $t > $now - $windowSeconds));
        if (count($hits) >= $limit) throw new WalletError('Too many Wallet requests. Please wait a few minutes and try again.', 429);
        $hits[] = $now;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($hits));
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

// HTTPS-only requests, with a fixed destination supplied by server code, never the guest.
function walletHttp(string $url, string $method = 'GET', ?string $body = null, array $headers = [], bool $redirects = false): array {
    $ch = curl_init($url);
    $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => $redirects, CURLOPT_MAXREDIRS => 3,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers];
    // Newer libcurl deprecates the bitmask form; use the string form when PHP has it.
    if (defined('CURLOPT_PROTOCOLS_STR')) {
        $options[CURLOPT_PROTOCOLS_STR] = 'https';
        $options[CURLOPT_REDIR_PROTOCOLS_STR] = 'https';
    } else {
        $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
        $options[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTPS;
    }
    curl_setopt_array($ch, $options);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($response === false) throw new WalletError('Wallet service could not connect. Please try again.', 502);
    $json = json_decode($response, true);
    if (!is_array($json)) throw new WalletError('Wallet service returned an invalid response. Please try again.', 502);
    return [$status, $json];
}
function walletTicket(array $config, string $token, ?callable $http = null): array {
    if (!preg_match('/^tk_[A-Za-z0-9_-]{16,128}$/D', $token) || str_starts_with($token, 'tk_mock_')) {
        throw new WalletError('This ticket link is not valid.', 400);
    }
    $http = $http ?? 'walletHttp';
    $base = $config['apps_script_url'] ?? '';
    if (!preg_match('~^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$~D', $base)) {
        throw new WalletError('Wallet configuration is incomplete.', 503);
    }
    [$status, $ticketResult] = $http($base . '?action=getGuestTicket&token=' . rawurlencode($token), 'GET', null, [], true);
    if ($status !== 200 || empty($ticketResult['ok'])) throw new WalletError('Could not verify this ticket. Please try again.', 502);
    $ticket = $ticketResult['data'] ?? null;
    if (!$ticket) throw new WalletError('This ticket is no longer available. Open your latest ticket link.', 404);
    // Real ticket statuses in Code.gs: ready, checked-in, cancelled, void.
    if (!in_array($ticket['ticketStatus'] ?? '', ['ready', 'checked-in'], true)) {
        throw new WalletError('This ticket is not valid for admission.', 410);
    }
    [$status, $eventResult] = $http($base . '?action=getEvent', 'GET', null, [], true);
    $event = $eventResult['data'] ?? [];
    if ($status !== 200 || empty($eventResult['ok']) || empty($config['event_confirmed'])
        || ($event['id'] ?? '') !== ($config['event_id'] ?? null)) {
        throw new WalletError('The event is not ready for Wallet passes yet.', 503);
    }
    foreach (['name', 'startsAt', 'endsAt', 'venue'] as $field) {
        if (empty($event[$field])) throw new WalletError('The event details are incomplete.', 503);
    }
    $start = strtotime($event['startsAt']);
    $end = strtotime($event['endsAt']);
    if (!$start || !$end || $end <= $start) throw new WalletError('The event dates are invalid.', 503);
    if ($end < time()) throw new WalletError('This event has ended.', 410);
    foreach (['adultCount', 'childCount', 'donationAmountCents'] as $field) {
        if (!isset($ticket[$field]) || !is_numeric($ticket[$field]) || $ticket[$field] < 0 || floor((float)$ticket[$field]) !== (float)$ticket[$field]) {
            throw new WalletError('The ticket details are invalid.', 502);
        }
        $ticket[$field] = (int)$ticket[$field];
    }
    if (empty($ticket['ticketNumber']) || $ticket['adultCount'] + $ticket['childCount'] < 1) throw new WalletError('The ticket details are incomplete.', 502);
    return [$ticket, $event];
}
function walletTicketUrl(string $token): string {
    return 'https://www.captainsmokeysbbq.com/ticket/?a=' . rawurlencode($token);
}
// Minimal page for errors on the Apple (direct navigation) path.
function walletErrorPage(string $message, ?string $ticketUrl): string {
    $h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $back = $ticketUrl ? '<p><a href="' . $h($ticketUrl) . '">Back to your ticket</a></p>' : '';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>Wallet unavailable | Captain Smokey\'s BBQ</title>'
        . '<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}'
        . 'main{max-width:26rem;text-align:center}a{color:#ff6b6b}</style></head><body><main>'
        . '<h1>Wallet pass unavailable</h1><p>' . $h($message) . '</p>'
        . '<p>Your ticket QR code still works at the gate.</p>' . $back . '</main></body></html>';
}
function walletDonation(array $ticket): string {
    return $ticket['donationAmountCents'] > 0 ? '$' . number_format($ticket['donationAmountCents'] / 100, 2) . ' due at check-in' : 'No donation due';
}
function walletSerial(array $event, string $token): string {
    // A reissued token gets a distinct pass, while repeated saves are stable.
    return hash('sha256', $event['id'] . ':' . $token);
}
function walletAppleData(array $config, array $ticket, array $event, string $token): array {
    return [
        'formatVersion' => 1, 'passTypeIdentifier' => $config['apple']['pass_type_id'],
        'teamIdentifier' => $config['apple']['team_id'], 'serialNumber' => walletSerial($event, $token),
        'organizationName' => "Captain Smokey's BBQ", 'description' => $event['name'] . ' admission ticket',
        'logoText' => "Captain Smokey's BBQ", 'foregroundColor' => 'rgb(255,255,255)',
        'backgroundColor' => 'rgb(44,44,44)', 'labelColor' => 'rgb(255,210,210)',
        'relevantDate' => gmdate('Y-m-d\TH:i:s\Z', strtotime($event['startsAt'])),
        'expirationDate' => gmdate('Y-m-d\TH:i:s\Z', strtotime($event['endsAt'])),
        'barcodes' => [['format' => 'PKBarcodeFormatQR', 'message' => walletTicketUrl($token),
            'messageEncoding' => 'iso-8859-1', 'altText' => (string)$ticket['ticketNumber']]],
        'eventTicket' => [
            'primaryFields' => [['key' => 'event', 'label' => 'EVENT', 'value' => $event['name']]],
            'secondaryFields' => [['key' => 'guest', 'label' => 'GUEST', 'value' => trim($ticket['firstName'] . ' ' . $ticket['lastName'])]],
            'auxiliaryFields' => [
                ['key' => 'adults', 'label' => 'ADULTS', 'value' => $ticket['adultCount']],
                ['key' => 'kids', 'label' => 'KIDS', 'value' => $ticket['childCount']],
                ['key' => 'total', 'label' => 'TOTAL', 'value' => $ticket['adultCount'] + $ticket['childCount']],
            ],
            'backFields' => [
                ['key' => 'ticket', 'label' => 'Ticket number', 'value' => (string)$ticket['ticketNumber']],
                ['key' => 'venue', 'label' => 'Venue', 'value' => trim($event['venue'] . "\n" . ($event['address'] ?? ''))],
                ['key' => 'starts', 'label' => 'Event starts', 'value' => $event['startsAt'], 'dateStyle' => 'PKDateStyleFull', 'timeStyle' => 'PKDateStyleShort'],
                ['key' => 'donation', 'label' => 'Donation', 'value' => walletDonation($ticket)],
                ['key' => 'instructions', 'label' => 'Admission', 'value' => 'Your whole party checks in together. Admission is verified at the gate. Open the ticket link for current status.'],
                ['key' => 'link', 'label' => 'Your ticket', 'value' => walletTicketUrl($token)],
            ],
        ],
    ];
}
function walletApplePass(array $config, array $ticket, array $event, string $token): string {
    $apple = $config['apple'];
    $cert = walletRead($apple['certificate']);
    $key = openssl_pkey_get_private(walletRead($apple['private_key']), $apple['key_password'] ?? '');
    $info = openssl_x509_parse($cert);
    if (!$key || !$info || !openssl_x509_check_private_key($cert, $key)
        || ($info['subject']['UID'] ?? '') !== $apple['pass_type_id']
        || ($info['subject']['OU'] ?? '') !== $apple['team_id']
        || ($info['validFrom_time_t'] ?? PHP_INT_MAX) > time() || ($info['validTo_time_t'] ?? 0) <= time()) {
        throw new WalletError('Apple Wallet signing is not configured correctly.', 503);
    }
    $dir = sys_get_temp_dir() . '/smokeys-wallet-' . bin2hex(random_bytes(16));
    if (!mkdir($dir, 0700)) throw new WalletError('Apple Wallet is temporarily unavailable.', 503);
    try {
        $files = ['pass.json' => walletJson(walletAppleData($config, $ticket, $event, $token))];
        foreach (['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'] as $asset) {
            $files[$asset] = walletRead(__DIR__ . '/assets/' . $asset);
        }
        $manifest = [];
        foreach ($files as $name => $contents) $manifest[$name] = sha1($contents);
        $files['manifest.json'] = walletJson($manifest);
        file_put_contents($dir . '/manifest.json', $files['manifest.json']);
        if (!openssl_cms_sign($dir . '/manifest.json', $dir . '/signature', $cert, $key, [],
            OPENSSL_CMS_DETACHED | OPENSSL_CMS_BINARY, OPENSSL_ENCODING_DER, $apple['wwdr_certificate'])) {
            throw new WalletError('Apple Wallet could not sign this pass. Please try again.', 503);
        }
        $files['signature'] = walletRead($dir . '/signature');
        $zip = new ZipArchive();
        if ($zip->open($dir . '/ticket.pkpass', ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new WalletError('Could not create the Wallet pass.', 503);
        foreach ($files as $name => $contents) {
            if (!$zip->addFromString($name, $contents)) throw new WalletError('Could not package the Wallet pass.', 503);
        }
        if (!$zip->close()) throw new WalletError('Could not finish the Wallet pass.', 503);
        return walletRead($dir . '/ticket.pkpass');
    } finally {
        foreach (glob($dir . '/*') as $file) @unlink($file);
        @rmdir($dir);
    }
}
function walletLocalized(string $value): array {
    return ['defaultValue' => ['language' => 'en-US', 'value' => $value]];
}
function walletGoogleData(array $config, array $ticket, array $event, string $token): array {
    $issuer = $config['google']['issuer_id'];
    if (!preg_match('/^[0-9]+$/D', $issuer)) throw new WalletError('Google Wallet issuer is invalid.', 503);
    $classId = $issuer . '.event_' . substr(hash('sha256', $event['id']), 0, 24);
    return [
        'class' => ['id' => $classId, 'issuerName' => "Captain Smokey's BBQ", 'reviewStatus' => 'UNDER_REVIEW',
            'eventName' => walletLocalized($event['name']),
            'venue' => ['name' => walletLocalized($event['venue']), 'address' => walletLocalized($event['address'] ?? '')],
            'dateTime' => ['start' => $event['startsAt'], 'end' => $event['endsAt']],
            'hexBackgroundColor' => '#2c2c2c',
            'logo' => ['sourceUri' => ['uri' => 'https://www.captainsmokeysbbq.com/assets/logo.png'], 'contentDescription' => walletLocalized("Captain Smokey's BBQ")]],
        'object' => ['id' => $issuer . '.' . walletSerial($event, $token), 'classId' => $classId,
            'state' => $ticket['ticketStatus'] === 'checked-in' ? 'COMPLETED' : 'ACTIVE',
            'ticketHolderName' => trim($ticket['firstName'] . ' ' . $ticket['lastName']), 'ticketNumber' => (string)$ticket['ticketNumber'],
            'barcode' => ['type' => 'QR_CODE', 'value' => walletTicketUrl($token), 'alternateText' => (string)$ticket['ticketNumber']],
            'textModulesData' => [
                ['id' => 'party', 'header' => 'Your party', 'body' => $ticket['adultCount'] . ' adults · ' . $ticket['childCount'] . ' kids · ' . ($ticket['adultCount'] + $ticket['childCount']) . ' total'],
                ['id' => 'donation', 'header' => 'Donation', 'body' => walletDonation($ticket)],
                ['id' => 'admission', 'header' => 'Admission', 'body' => 'Your whole party checks in together. Admission is verified at the gate.']],
            'linksModuleData' => ['uris' => [['uri' => walletTicketUrl($token), 'description' => 'Open current ticket', 'id' => 'ticket']]],
        ],
    ];
}
function walletGoogleLink(array $config, array $ticket, array $event, string $token, ?callable $http = null): string {
    $http = $http ?? 'walletHttp';
    $account = json_decode(walletRead($config['google']['service_account']), true, 512, JSON_THROW_ON_ERROR);
    if (empty($account['private_key']) || empty($account['client_email'])) throw new WalletError('Google Wallet credentials are incomplete.', 503);
    $now = time();
    $assertion = walletJwt(['iss' => $account['client_email'], 'scope' => 'https://www.googleapis.com/auth/wallet_object.issuer',
        'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600], $account['private_key']);
    [$status, $auth] = $http('https://oauth2.googleapis.com/token', 'POST', http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $assertion]), ['Content-Type: application/x-www-form-urlencoded']);
    if ($status !== 200 || empty($auth['access_token'])) throw new WalletError('Google Wallet could not authenticate. Please use your ticket QR code.', 503);
    $headers = ['Content-Type: application/json', 'Authorization: Bearer ' . $auth['access_token']];
    $data = walletGoogleData($config, $ticket, $event, $token);
    $base = 'https://walletobjects.googleapis.com/walletobjects/v1/';
    [$status, $existing] = $http($base . 'eventTicketClass/' . rawurlencode($data['class']['id']), 'GET', null, $headers);
    if ($status === 404) {
        [$status, $existing] = $http($base . 'eventTicketClass', 'POST', walletJson($data['class']), $headers);
        if ($status === 409) [$status, $existing] = $http($base . 'eventTicketClass/' . rawurlencode($data['class']['id']), 'GET', null, $headers);
    }
    if ($status !== 200 || ($existing['reviewStatus'] ?? '') === 'REJECTED') throw new WalletError('Google Wallet event setup needs attention. Please use your ticket QR code.', 503);
    [$status] = $http($base . 'eventTicketObject', 'POST', walletJson($data['object']), $headers);
    if ($status === 409) [$status] = $http($base . 'eventTicketObject/' . rawurlencode($data['object']['id']), 'PUT', walletJson($data['object']), $headers);
    if ($status !== 200) throw new WalletError('Google Wallet could not create this ticket. Please try again.', 502);
    $jwt = walletJwt(['iss' => $account['client_email'], 'aud' => 'google', 'typ' => 'savetowallet', 'iat' => $now,
        'origins' => ['https://www.captainsmokeysbbq.com', 'https://captainsmokeysbbq.com'],
        'payload' => ['eventTicketObjects' => [['id' => $data['object']['id']]]]], $account['private_key']);
    return 'https://pay.google.com/gp/v/save/' . $jwt;
}
