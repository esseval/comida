<?php
// proxy.php — Backend 100% Apache/Laragon para FatSecret.com.ar
// Lee credenciales de config.php (server-side, no expuesto), cachea token en cache/token.json (23h), resuelve CORS/IP.
// Endpoints: ?action=health | ?action=search (foods.search.v5) | ?action=food (food.get.v5)

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$configFile = __DIR__ . '/config.php';
$cacheFile = __DIR__ . '/cache/token.json';

function respond($code, $data){ http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }
function loadConfig(){
    global $configFile;
    if(!file_exists($configFile)) respond(500, ['error'=>'Falta config.php','hint'=>'Copia config.php.example a config.php y completa client_id/secret']);
    $cfg = require $configFile;
    $id = trim($cfg['client_id'] ?? ''); $sec = trim($cfg['client_secret'] ?? '');
    if(!$id || !$sec || $id==='TU_CLIENT_ID_AQUI') respond(500, ['error'=>'config.php sin credenciales','hint'=>'Completa client_id/client_secret en config.php']);
    return [$id,$sec];
}
function getCachedToken(){
    global $cacheFile;
    if(!file_exists($cacheFile)) return null;
    $j = json_decode(@file_get_contents($cacheFile), true);
    if(!$j || empty($j['access_token']) || empty($j['expires_at'])) return null;
    if(time() > ($j['expires_at'] - 60)) return null; // expira en <60s, renovar
    return $j['access_token'];
}
function saveToken($token, $expiresIn){
    global $cacheFile;
    @mkdir(dirname($cacheFile), 0777, true);
    $data = ['access_token'=>$token, 'expires_at'=> time() + intval($expiresIn ?: 86400)];
    @file_put_contents($cacheFile, json_encode($data), LOCK_EX);
}
function fetchToken($forceScope=null){
    [$id,$sec] = loadConfig();
    $cfg = require __DIR__ . '/config.php';
    // scope configurable: 'premier' requiere app premier, 'basic' funciona para todos. Por defecto 'basic' (compatible free).
    // Si pide 'premier' y la app es basic-only, FatSecret devuelve 400 invalid_scope — hacemos fallback a 'basic'.
    $scope = $forceScope ?? trim($cfg['scope'] ?? 'basic');
    if($scope==='' ) $scope='basic';
    // Si scope es 'premier' y falla, el fallback se hace abajo
    $cached = ($forceScope===null) ? getCachedToken() : null;
    if($cached) {
        // verificar que el scope cacheado coincida; si config cambió, invalida
        $cachedScope = @json_decode(@file_get_contents(__DIR__.'/cache/token.json'), true)['scope'] ?? 'basic';
        if($cachedScope === $scope) return $cached;
    }
    if($forceScope!==null) @unlink(__DIR__ . '/cache/token.json');
    $ch = curl_init('https://oauth.fatsecret.com/connect/token');
    $postFields = $scope ? http_build_query(['grant_type'=>'client_credentials','scope'=>$scope]) : http_build_query(['grant_type'=>'client_credentials']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER=>true, CURLOPT_POST=>true,
        CURLOPT_POSTFIELDS=>$postFields,
        CURLOPT_HTTPHEADER=>['Content-Type: application/x-www-form-urlencoded','Authorization: Basic '.base64_encode("$id:$sec")],
        CURLOPT_TIMEOUT=>15, CURLOPT_SSL_VERIFYPEER=>true,
    ]);
    $resp = curl_exec($ch); $code=curl_getinfo($ch,CURLINFO_HTTP_CODE); $err=curl_error($ch); curl_close($ch);
    if($err) respond(502, ['error'=>'cURL token','detail'=>$err]);
    if($code >=400){
        // Fallback: si pedimos 'premier' y la app es basic-only, reintenta con 'basic'
        if($code==400 && strpos($resp,'invalid_scope')!==false && $scope==='premier'){
            @unlink(__DIR__ . '/cache/token.json');
            return fetchToken('basic');
        }
        http_response_code($code); header('Content-Type: application/json'); echo $resp; exit;
    }
    $j=json_decode($resp,true);
    if(empty($j['access_token'])) respond(502, ['error'=>'Sin access_token','body'=>substr($resp,0,500)]);
    // Guardar con scope para validar cache posterior
    $saveData = ['access_token'=>$j['access_token'], 'expires_at'=> time() + intval($j['expires_in'] ?? 86400), 'scope'=>$scope];
    @mkdir(dirname(__DIR__ . '/cache/token.json'), 0777, true);
    @file_put_contents(__DIR__ . '/cache/token.json', json_encode($saveData), LOCK_EX);
    return $j['access_token'];
}

if($action === 'health'){
    $has = file_exists($configFile) ? (function(){ $c=require __DIR__.'/config.php'; return !empty(trim($c['client_id']??'')) && trim($c['client_id'])!=='TU_CLIENT_ID_AQUI'; })() : false;
    respond(200, ['ok'=>true,'backend'=>'fatsecret via proxy.php (Laragon Apache)','hasCreds'=>$has]);
}

if($action === 'search' || $action === 'food'){
    $token = fetchToken();
    // helper para reintentar con scope distinto si FatSecret responde code 14 Missing scope
    $tryApi = function($tok, $par) {
        $ch=curl_init('https://platform.fatsecret.com/rest/server.api');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($par),CURLOPT_HTTPHEADER=>['Content-Type: application/x-www-form-urlencoded','Authorization: Bearer '.$tok],CURLOPT_TIMEOUT=>15]);
        $r=curl_exec($ch); $c=curl_getinfo($ch,CURLINFO_HTTP_CODE); $e=curl_error($ch); curl_close($ch);
        return [$r,$c,$e];
    };
    $input = json_decode(file_get_contents('php://input'), true);
    if(!$input) $input = $_POST;
    // Permitir GET también (?q=yerba)
    $q = trim($_GET['q'] ?? $_GET['query'] ?? $input['q'] ?? $input['query'] ?? $input['search_expression'] ?? '');
    $page = max(1, intval($_GET['page'] ?? $input['page'] ?? 1));
    $pageSize = min(50, max(1, intval($_GET['pageSize'] ?? $_GET['page_size'] ?? $input['pageSize'] ?? 10)));
    if($action==='search' && $q==='') respond(400, ['error'=>'Falta q (query)']);

    $params = [];
    $cfgScope = trim((require __DIR__ . '/config.php')['scope'] ?? 'basic');
    $isPremier = ($cfgScope === 'premier');
    if($action==='search'){
        // foods.search.v5/v4 requieren scope premier; con basic solo funciona foods.search (sin versión)
        $method = $isPremier ? 'foods.search.v5' : 'foods.search';
        $params = ['method'=>$method,'search_expression'=>$q,'page_number'=>strval($page-1),'max_results'=>strval($pageSize),'format'=>'json','region'=>'AR','language'=>'es'];
        if($isPremier){ $params['include_sub_categories']='true'; $params['flag_default_serving']='true'; }
    } else {
        $fid = trim($_GET['id'] ?? $_GET['food_id'] ?? $input['id'] ?? $input['food_id'] ?? '');
        $fid = preg_replace('/^fatsecret-/', '', $fid);
        if(!$fid) respond(400, ['error'=>'Falta id/food_id']);
        // food.get funciona con basic en todas las versiones
        $method = $isPremier ? 'food.get.v5' : 'food.get';
        $params = ['method'=>$method,'food_id'=>$fid,'format'=>'json','region'=>'AR','language'=>'es'];
        if($isPremier){ $params['include_sub_categories']='true'; $params['flag_default_serving']='true'; }
    }
    [$resp,$code,$err] = $tryApi($token, $params);
    if($err) respond(502, ['error'=>'cURL api','detail'=>$err]);
    // Si FatSecret responde 403 code 14 Missing scope 'premier', reintenta con scope premier y sin flags premier-only
    if($code==403 && (strpos($resp,'"code":14')!==false || strpos($resp,'Missing scope')!==false)){
        // primer reintento: pedir token premier explícitamente
        @unlink(__DIR__ . '/cache/token.json');
        $token2 = fetchToken('premier');
        [$resp,$code,$err] = $tryApi($token2, $params);
        if($code==403){
            // segundo reintento: quitar flags que requieren premier (include_sub_categories)
            unset($params['include_sub_categories']); unset($params['include_food_images']); unset($params['include_food_attributes']);
            [$resp,$code,$err] = $tryApi($token2, $params);
            if($code==403){
                // último intento: token basic + params sin premier
                @unlink(__DIR__ . '/cache/token.json');
                $token3 = fetchToken('basic');
                [$resp,$code,$err] = $tryApi($token3, $params);
            }
        }
        if($err) respond(502, ['error'=>'cURL api retry','detail'=>$err]);
    }
    // Si sigue 403 pero ahora es otro scope, devolver mensaje claro
    if($code==403 && strpos($resp,'code')!==false){
        $j=json_decode($resp,true);
        if(isset($j['error']['message']) && strpos($j['error']['message'],'premier')!==false){
            respond(403, ['error'=>['code'=>14,'message'=>"Tu app FatSecret no tiene scope 'premier'. Ve a platform.fatsecret.com → tu app → Request Premier access o cambia config.php 'scope' => 'basic' y quita include_sub_categories. Detalle original: ".$j['error']['message']]]);
        }
    }
    http_response_code($code); header('Content-Type: application/json'); echo $resp; exit;
}

respond(400, ['error'=>'Acción no válida. Usa ?action=health | ?action=search&q=yerba | ?action=food&id=fatsecret-123']);
