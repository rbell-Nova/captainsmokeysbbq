<?php
declare(strict_types=1);
// Never print PHP warnings/notices into a response (they can contain private paths).
ini_set('display_errors', '0');
require __DIR__ . '/lib.php';
header('Cache-Control: no-store, private');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';
// Apple passes are opened by navigating straight here, so errors must be a readable page, not JSON.
$wantsPage = $method === 'GET' && $action === 'apple';
$token = '';

try {
    $config = walletConfig();
    $capabilities = walletCapabilities($config);
    if ($method === 'GET' && $action === 'status') {
        header('Content-Type: application/json; charset=utf-8');
        echo walletJson($capabilities);
        exit;
    }
    if ($method === 'POST') {
        $input = json_decode((string)file_get_contents('php://input', false, null, 0, 4096), true);
        if (!is_array($input)) throw new WalletError('Invalid Wallet request.', 400);
        $action = $input['provider'] ?? '';
        $token = $input['token'] ?? '';
        if ($action !== 'google') throw new WalletError('Unsupported Wallet request.', 400);
    } elseif ($wantsPage) {
        $token = $_GET['token'] ?? '';
    } else {
        throw new WalletError('Unsupported Wallet request.', 405);
    }
    if (!is_string($token)) throw new WalletError('Invalid ticket.', 400);
    if (empty($capabilities[$action])) throw new WalletError('This Wallet option is not available yet. Please use your ticket QR code.', 503);

    walletRateLimit($config['rate_limit_dir'] ?? (sys_get_temp_dir() . '/smokeys-wallet-rate'),
        (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));

    [$ticket, $event] = walletTicket($config, $token);
    if ($action === 'apple') {
        $pass = walletApplePass($config, $ticket, $event, $token);
        header('Content-Type: application/vnd.apple.pkpass');
        header('Content-Disposition: attachment; filename="captain-smokeys-ticket.pkpass"');
        header('Content-Length: ' . strlen($pass));
        echo $pass;
    } else {
        header('Content-Type: application/json; charset=utf-8');
        echo walletJson(['url' => walletGoogleLink($config, $ticket, $event, $token)]);
    }
} catch (Throwable $error) {
    $code = $error instanceof WalletError ? $error->getCode() : 503;
    http_response_code($code >= 400 && $code <= 599 ? $code : 503);
    if ($code === 429) header('Retry-After: 300');
    // Do not return upstream errors, certificate details, tokens, or private paths.
    $message = $error instanceof WalletError ? $error->getMessage() : 'Wallet is temporarily unavailable. Please use your ticket QR code.';
    if ($wantsPage) {
        header('Content-Type: text/html; charset=utf-8');
        echo walletErrorPage($message, is_string($token) && preg_match('/^tk_[A-Za-z0-9_-]{16,128}$/D', $token) ? walletTicketUrl($token) : null);
    } else {
        header('Content-Type: application/json; charset=utf-8');
        echo walletJson(['error' => $message]);
    }
}
