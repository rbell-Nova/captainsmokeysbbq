<?php
// Wallet service tests. Needs PHP 8.1+ with openssl, zip, and curl.
//   php tests/wallet.test.php
// Uses throwaway certificates and a fake HTTP layer; never contacts Apple,
// Google, or Apps Script.
declare(strict_types=1);
error_reporting(E_ALL);
require __DIR__ . '/../wallet/lib.php';

$tmp = sys_get_temp_dir() . '/wallet-test-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
$docroot = "$tmp/public_html";
$private = "$tmp/smokeys-wallet";
mkdir($docroot, 0700, true);
mkdir($private, 0700, true);
$_SERVER['DOCUMENT_ROOT'] = $docroot;

$failed = 0;
$count = 0;
function test(string $name, callable $fn): void {
    global $failed, $count;
    $count++;
    try { $fn(); echo "  ok  $name\n"; }
    catch (Throwable $e) { $failed++; echo "  FAIL $name\n    " . get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine() . "\n"; }
}
function check(bool $cond, string $msg = 'assertion failed'): void { if (!$cond) throw new RuntimeException($msg); }
function same($a, $b, string $msg = ''): void { if ($a !== $b) throw new RuntimeException(($msg ? "$msg: " : '') . var_export($a, true) . ' !== ' . var_export($b, true)); }
function throwsWallet(callable $fn, int $code, ?string $re = null): void {
    try { $fn(); } catch (WalletError $e) {
        same($e->getCode(), $code, 'error code (' . $e->getMessage() . ')');
        if ($re) check((bool)preg_match($re, $e->getMessage()), 'message: ' . $e->getMessage());
        return;
    }
    throw new RuntimeException("expected WalletError $code");
}

// ---------------------------------------------------------------- fixtures
const TOKEN = 'tk_0123456789abcdef0123456789abcdef';
const EXEC = 'https://script.google.com/macros/s/AKfyTEST_exec-id/exec';
$eventFixture = ['id' => 'evt_test', 'name' => 'Test Muster', 'startsAt' => gmdate('c', time() + 86400),
    'endsAt' => gmdate('c', time() + 86400 + 14400), 'venue' => 'Legion Hall', 'address' => '1 Main St'];
$ticketFixture = ['ticketNumber' => 'SM-1001', 'firstName' => 'Pat', 'lastName' => 'Griller', 'adultCount' => 3,
    'childCount' => 2, 'totalGuestCount' => 5, 'donationAmountCents' => 1500, 'ticketStatus' => 'ready'];

function fakeBackend(array $ticket = null, array $event = null, array $overrides = []): callable {
    global $ticketFixture, $eventFixture;
    $ticket = $ticket ?? $ticketFixture;
    $event = $event ?? $eventFixture;
    return function (string $url) use ($ticket, $event, $overrides) {
        if (str_contains($url, 'action=getGuestTicket')) return $overrides['ticket'] ?? [200, ['ok' => true, 'data' => $ticket]];
        if (str_contains($url, 'action=getEvent')) return $overrides['event'] ?? [200, ['ok' => true, 'data' => $event]];
        throw new RuntimeException("unexpected URL $url");
    };
}
$baseConfig = ['apps_script_url' => EXEC, 'event_id' => 'evt_test', 'event_confirmed' => true];

// Throwaway "WWDR" CA + pass certificate shaped like Apple's (UID = pass type, OU = team).
$caKey = openssl_pkey_new(['private_key_bits' => 2048]);
$caCert = openssl_csr_sign(openssl_csr_new(['CN' => 'Test WWDR CA'], $caKey), null, $caKey, 30, ['digest_alg' => 'sha256'], 1);
$passKey = openssl_pkey_new(['private_key_bits' => 2048]);
$passCsr = openssl_csr_new(['UID' => 'pass.com.test.event', 'CN' => 'Pass Type ID: pass.com.test.event', 'OU' => 'TEAM123456', 'O' => 'Test', 'C' => 'US'], $passKey);
$passCert = openssl_csr_sign($passCsr, $caCert, $caKey, 30, ['digest_alg' => 'sha256'], 2);
openssl_x509_export_to_file($caCert, "$private/wwdr.pem");
openssl_x509_export_to_file($passCert, "$private/pass.pem");
openssl_pkey_export_to_file($passKey, "$private/pass-key.pem");
$appleConfig = $baseConfig + ['apple' => ['enabled' => true, 'pass_type_id' => 'pass.com.test.event', 'team_id' => 'TEAM123456',
    'certificate' => "$private/pass.pem", 'private_key' => "$private/pass-key.pem", 'key_password' => '', 'wwdr_certificate' => "$private/wwdr.pem"]];

// Throwaway Google service account.
$saKey = openssl_pkey_new(['private_key_bits' => 2048]);
openssl_pkey_export($saKey, $saPem);
$saPublic = openssl_pkey_get_details($saKey)['key'];
file_put_contents("$private/sa.json", json_encode(['client_email' => 'wallet@test.iam.gserviceaccount.com', 'private_key' => $saPem]));
$googleConfig = $baseConfig + ['google' => ['enabled' => true, 'issuer_id' => '3388000000012345678', 'service_account' => "$private/sa.json"]];

// ------------------------------------------------------------ ticket checks
test('valid ticket and event pass validation', function () use ($baseConfig) {
    [$t, $e] = walletTicket($baseConfig, TOKEN, fakeBackend());
    same($t['adultCount'], 3); same($t['childCount'], 2); same($e['id'], 'evt_test');
});
test('checked-in tickets are allowed (pass shows as completed)', function () use ($baseConfig, $ticketFixture) {
    [$t] = walletTicket($baseConfig, TOKEN, fakeBackend(['ticketStatus' => 'checked-in'] + $ticketFixture));
    same($t['ticketStatus'], 'checked-in');
});
test('malformed and mock tokens are rejected before any network call', function () use ($baseConfig) {
    $never = fn() => throw new RuntimeException('network called');
    throwsWallet(fn() => walletTicket($baseConfig, 'tk_short', $never), 400);
    throwsWallet(fn() => walletTicket($baseConfig, 'tk_mock_1002aaaaaaaaaaaaaaaa', $never), 400);
    throwsWallet(fn() => walletTicket($baseConfig, 'tk_../../etc/passwdAAAAAAAA', $never), 400);
});
foreach (['cancelled', 'void', 'registered', ''] as $status) {
    test("status '$status' is not admitted", function () use ($baseConfig, $ticketFixture, $status) {
        throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(['ticketStatus' => $status] + $ticketFixture)), 410);
    });
}
test('unknown ticket → 404; backend error → 502', function () use ($baseConfig) {
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(null, null, ['ticket' => [200, ['ok' => true, 'data' => null]]])), 404);
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(null, null, ['ticket' => [200, ['ok' => false, 'error' => 'boom']]])), 502);
});
test('unconfirmed or mismatched event blocks passes', function () use ($baseConfig, $eventFixture) {
    throwsWallet(fn() => walletTicket(['event_confirmed' => false] + $baseConfig, TOKEN, fakeBackend()), 503);
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(null, ['id' => 'evt_other'] + $eventFixture)), 503);
});
test('ended event → 410; bad dates → 503', function () use ($baseConfig, $eventFixture) {
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(null, ['startsAt' => '2020-01-01T10:00:00Z', 'endsAt' => '2020-01-01T12:00:00Z'] + $eventFixture)), 410);
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(null, ['endsAt' => $eventFixture['startsAt'], 'startsAt' => $eventFixture['endsAt']] + $eventFixture)), 503);
});
test('bad counts are rejected', function () use ($baseConfig, $ticketFixture) {
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(['adultCount' => -1] + $ticketFixture)), 502);
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(['adultCount' => 1.5] + $ticketFixture)), 502);
    throwsWallet(fn() => walletTicket($baseConfig, TOKEN, fakeBackend(['adultCount' => 0, 'childCount' => 0] + $ticketFixture)), 502);
});
test('only a real Apps Script /exec URL is accepted', function () use ($baseConfig) {
    throwsWallet(fn() => walletTicket(['apps_script_url' => 'https://evil.example/exec'] + $baseConfig, TOKEN, fakeBackend()), 503);
});

// -------------------------------------------------------- capability checks
test('capabilities: everything present → both enabled', function () use ($appleConfig, $googleConfig) {
    $caps = walletCapabilities($appleConfig + $googleConfig);
    same($caps, ['apple' => true, 'google' => true]);
});
test('capabilities: disabled until event is confirmed', function () use ($appleConfig, $googleConfig) {
    same(walletCapabilities(['event_confirmed' => false] + $appleConfig + $googleConfig), ['apple' => false, 'google' => false]);
});
test('capabilities: keys inside public_html are refused', function () use ($appleConfig, $docroot, $private) {
    copy("$private/pass-key.pem", "$docroot/pass-key.pem");
    $cfg = $appleConfig;
    $cfg['apple']['private_key'] = "$docroot/pass-key.pem";
    same(walletCapabilities($cfg)['apple'], false);
    same(walletPrivateFile("$docroot/pass-key.pem"), false);
    same(walletPrivateFile("$private/pass-key.pem"), true);
    unlink("$docroot/pass-key.pem");
});
test('capabilities: Google needs a numeric issuer ID (not the merchant ID)', function () use ($googleConfig) {
    $cfg = $googleConfig;
    $cfg['google']['issuer_id'] = 'BCR2DN6XXXXXXXXX';
    same(walletCapabilities($cfg)['google'], false);
});
test('config file inside public_html is ignored', function () use ($docroot) {
    file_put_contents("$docroot/config.php", "<?php return ['event_confirmed' => true];");
    putenv("SMOKEYS_WALLET_CONFIG=$docroot/config.php");
    same(walletConfig(), []);
    putenv('SMOKEYS_WALLET_CONFIG');
    unlink("$docroot/config.php");
});

// ---------------------------------------------------------------- Apple pass
test('Apple pass: signed, complete, and verifiable', function () use ($appleConfig, $ticketFixture, $eventFixture, $tmp, $private) {
    $pkpass = walletApplePass($appleConfig, $ticketFixture, $eventFixture, TOKEN);
    $dir = "$tmp/pkpass";
    mkdir($dir);
    file_put_contents("$dir/pass.pkpass", $pkpass);
    $zip = new ZipArchive();
    check($zip->open("$dir/pass.pkpass") === true, 'zip opens');
    $names = [];
    for ($i = 0; $i < $zip->numFiles; $i++) $names[] = $zip->getNameIndex($i);
    sort($names);
    same($names, ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'manifest.json', 'pass.json', 'signature']);
    $manifest = json_decode($zip->getFromName('manifest.json'), true);
    foreach ($names as $n) if (!in_array($n, ['manifest.json', 'signature'], true)) same($manifest[$n] ?? null, sha1($zip->getFromName($n)), "manifest hash for $n");
    $pass = json_decode($zip->getFromName('pass.json'), true);
    same($pass['passTypeIdentifier'], 'pass.com.test.event');
    same($pass['teamIdentifier'], 'TEAM123456');
    same($pass['barcodes'][0]['message'], 'https://www.captainsmokeysbbq.com/ticket/?a=' . TOKEN, 'QR matches staff scanner format');
    same($pass['eventTicket']['auxiliaryFields'][2]['value'], 5, 'total');
    $venue = array_values(array_filter($pass['eventTicket']['backFields'], fn($f) => $f['key'] === 'venue'))[0]['value'];
    same($venue, "Legion Hall\n1 Main St", 'venue uses a real newline');
    same($pass['serialNumber'], walletSerial($eventFixture, TOKEN), 'stable serial');
    file_put_contents("$dir/manifest.json", $zip->getFromName('manifest.json'));
    file_put_contents("$dir/signature", $zip->getFromName('signature'));
    $zip->close();
    // Independent check with the openssl CLI: detached DER CMS over manifest.json, chaining to the "WWDR" CA.
    exec('openssl cms -verify -binary -inform DER -in ' . escapeshellarg("$dir/signature") . ' -content ' . escapeshellarg("$dir/manifest.json")
        . ' -CAfile ' . escapeshellarg("$private/wwdr.pem") . ' -purpose any -out /dev/null 2>&1', $out, $rc);
    same($rc, 0, 'openssl cms -verify: ' . implode(' ', $out));
    exec('openssl pkcs7 -inform DER -in ' . escapeshellarg("$dir/signature") . ' -print_certs 2>/dev/null | grep -c "^subject="', $certs);
    same((int)($certs[0] ?? 0), 2, 'signature carries pass cert + WWDR cert');
    exec('openssl cms -cmsout -print -inform DER -in ' . escapeshellarg("$dir/signature") . ' 2>/dev/null', $dump);
    check(str_contains(implode("\n", $dump), 'eContent: <ABSENT>'), 'Apple requires a DETACHED signature (manifest must not be embedded)');
    file_put_contents("$dir/manifest.json", str_replace('"', "'", file_get_contents("$dir/manifest.json")));
    exec('openssl cms -verify -binary -inform DER -in ' . escapeshellarg("$dir/signature") . ' -content ' . escapeshellarg("$dir/manifest.json")
        . ' -CAfile ' . escapeshellarg("$private/wwdr.pem") . ' -purpose any -out /dev/null 2>&1', $out2, $rc2);
    check($rc2 !== 0, 'tampered manifest must fail verification');
    check(!glob(sys_get_temp_dir() . '/smokeys-wallet-*'), 'temp signing directory cleaned up');
});
test('Apple pass: certificate/team mismatch refuses to sign', function () use ($appleConfig, $ticketFixture, $eventFixture) {
    $cfg = $appleConfig;
    $cfg['apple']['team_id'] = 'OTHERTEAM1';
    throwsWallet(fn() => walletApplePass($cfg, $ticketFixture, $eventFixture, TOKEN), 503);
});

// ---------------------------------------------------------------- Google
function jwtParts(string $jwt): array {
    [$h, $p, $s] = explode('.', $jwt);
    $dec = fn($x) => base64_decode(strtr($x, '-_', '+/') . str_repeat('=', (4 - strlen($x) % 4) % 4));
    return [json_decode($dec($h), true), json_decode($dec($p), true), $dec($s), "$h.$p"];
}
test('Google: creates class + object, then returns a signed save link', function () use ($googleConfig, $ticketFixture, $eventFixture, $saPublic) {
    $calls = [];
    $http = function (string $url, string $method = 'GET', ?string $body = null, array $headers = []) use (&$calls, $saPublic) {
        $calls[] = "$method " . preg_replace('~^https://[^/]+~', '', $url);
        if (str_contains($url, 'oauth2.googleapis.com')) {
            parse_str((string)$body, $form);
            [, $claims, $sig, $signed] = jwtParts($form['assertion']);
            same(openssl_verify($signed, $sig, $saPublic, OPENSSL_ALGO_SHA256), 1, 'OAuth assertion signature');
            same($claims['scope'], 'https://www.googleapis.com/auth/wallet_object.issuer');
            return [200, ['access_token' => 'at-123']];
        }
        check(in_array('Authorization: Bearer at-123', $headers, true), 'bearer token sent');
        if ($method === 'GET' && str_contains($url, 'eventTicketClass/')) return [404, ['error' => ['code' => 404]]];
        if ($method === 'POST' && str_ends_with($url, 'eventTicketClass')) {
            $class = json_decode($body, true);
            same($class['reviewStatus'], 'UNDER_REVIEW');
            same($class['eventName']['defaultValue']['value'], 'Test Muster');
            return [200, $class];
        }
        if ($method === 'POST' && str_ends_with($url, 'eventTicketObject')) return [409, ['error' => ['code' => 409]]];
        if ($method === 'PUT' && str_contains($url, 'eventTicketObject/')) {
            $object = json_decode($body, true);
            same($object['state'], 'ACTIVE');
            same($object['barcode']['value'], 'https://www.captainsmokeysbbq.com/ticket/?a=' . TOKEN);
            same($object['textModulesData'][0]['body'], '3 adults · 2 kids · 5 total');
            return [200, $object];
        }
        throw new RuntimeException("unexpected $method $url");
    };
    $link = walletGoogleLink($googleConfig, $ticketFixture, $eventFixture, TOKEN, $http);
    check(str_starts_with($link, 'https://pay.google.com/gp/v/save/'), 'save URL');
    [$header, $claims, $sig, $signed] = jwtParts(substr($link, strlen('https://pay.google.com/gp/v/save/')));
    same($header['alg'], 'RS256');
    same(openssl_verify($signed, $sig, $saPublic, OPENSSL_ALGO_SHA256), 1, 'save JWT signature');
    same($claims['typ'], 'savetowallet');
    same($claims['aud'], 'google');
    same(count($claims['payload']['eventTicketObjects']), 1);
    check(str_starts_with($claims['payload']['eventTicketObjects'][0]['id'], '3388000000012345678.'), 'object ID uses issuer');
    same($calls, ['POST /token', 'GET /walletobjects/v1/eventTicketClass/' . rawurlencode(walletGoogleData($googleConfig, $ticketFixture, $eventFixture, TOKEN)['class']['id']),
        'POST /walletobjects/v1/eventTicketClass', 'POST /walletobjects/v1/eventTicketObject',
        'PUT /walletobjects/v1/eventTicketObject/' . rawurlencode(walletGoogleData($googleConfig, $ticketFixture, $eventFixture, TOKEN)['object']['id'])]);
});
test('Google: checked-in ticket object is COMPLETED', function () use ($googleConfig, $ticketFixture, $eventFixture) {
    same(walletGoogleData($googleConfig, ['ticketStatus' => 'checked-in'] + $ticketFixture, $eventFixture, TOKEN)['object']['state'], 'COMPLETED');
});
test('Google: rejected class or failed auth stops with a friendly error', function () use ($googleConfig, $ticketFixture, $eventFixture) {
    $rejected = fn(string $url, string $m = 'GET') => str_contains($url, 'oauth2') ? [200, ['access_token' => 'x']] : [200, ['reviewStatus' => 'REJECTED']];
    throwsWallet(fn() => walletGoogleLink($googleConfig, $ticketFixture, $eventFixture, TOKEN, $rejected), 503);
    $noAuth = fn() => [401, ['error' => 'invalid_grant']];
    throwsWallet(fn() => walletGoogleLink($googleConfig, $ticketFixture, $eventFixture, TOKEN, $noAuth), 503, '/authenticate/');
});

// ---------------------------------------------------------------- rate limit
test('rate limiter allows the limit, then returns 429', function () use ($tmp) {
    for ($i = 0; $i < 3; $i++) walletRateLimit("$tmp/rate", '203.0.113.9', 3, 600);
    throwsWallet(fn() => walletRateLimit("$tmp/rate", '203.0.113.9', 3, 600), 429);
    walletRateLimit("$tmp/rate", '203.0.113.10', 3, 600); // other clients unaffected
    foreach (glob("$tmp/rate/*") as $f) check(!str_contains(file_get_contents($f), '203.0.113'), 'no raw IPs stored');
});

// ---------------------------------------------------------------- endpoint (php -S)
test('endpoint: status JSON, JSON errors for Google, HTML page for Apple', function () use ($tmp, $docroot, $private) {
    $web = "$docroot/wallet";
    mkdir($web, 0700, true);
    foreach (['index.php', 'lib.php'] as $f) copy(__DIR__ . "/../wallet/$f", "$web/$f");
    file_put_contents("$private/config.php", "<?php return ['event_confirmed' => false];");
    $port = 18000 + random_int(0, 999);
    $cmd = sprintf('SMOKEYS_WALLET_CONFIG=%s exec php -S 127.0.0.1:%d -t %s', escapeshellarg("$private/config.php"), $port, escapeshellarg($docroot));
    $proc = proc_open($cmd, [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
    try {
        usleep(400000);
        $get = function (string $path, string $method = 'GET', ?string $body = null) use ($port) {
            $ctx = stream_context_create(['http' => ['method' => $method, 'ignore_errors' => true, 'content' => $body ?? '',
                'header' => "Content-Type: application/json\r\n"]]);
            $res = file_get_contents("http://127.0.0.1:$port$path", false, $ctx);
            return [(int)explode(' ', $http_response_header[0])[1], implode("\n", $http_response_header), $res];
        };
        [$code, $headers, $body] = $get('/wallet/?action=status');
        same($code, 200);
        same(json_decode($body, true), ['apple' => false, 'google' => false]);
        check(str_contains($headers, 'Cache-Control: no-store'), 'no-store');
        [$code, $headers, $body] = $get('/wallet/?action=apple&token=' . TOKEN);
        same($code, 503);
        check(str_contains($headers, 'text/html'), 'Apple error is a page');
        check(str_contains($body, 'Back to your ticket') && !str_contains($body, $private), 'page links back, leaks no paths');
        [$code, $headers, $body] = $get('/wallet/', 'POST', json_encode(['provider' => 'google', 'token' => TOKEN]));
        same($code, 503);
        check(str_contains($headers, 'application/json'), 'Google error is JSON');
        [$code] = $get('/wallet/', 'POST', '{"provider":"bitcoin"}');
        same($code, 400);
        [$code] = $get('/wallet/?action=delete', 'GET');
        same($code, 405);
    } finally {
        proc_terminate($proc);
        proc_close($proc);
    }
});

exec('rm -rf ' . escapeshellarg($tmp));
if ($failed) { echo "$failed of $count wallet test(s) failed.\n"; exit(1); }
echo "Wallet tests passed ($count).\n";
