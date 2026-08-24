import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../config.dart';
import 'token_store.dart';

class ApiException implements Exception {
  final String message;
  final int status;
  ApiException(this.message, this.status);
  @override
  String toString() => message;
}

/// Thin JSON fetch wrapper — attaches the Bearer token, mirrors
/// apps/frontend/src/lib/api.ts's request() but without a build step, so no generics-driven
/// response typing; call sites parse the decoded JSON themselves via each model's fromJson.
class ApiClient {
  ApiClient._();
  static const bool _apiLogsEnabled = bool.fromEnvironment('API_LOGS', defaultValue: kDebugMode);
  static const int _maxLogBodyLength = 1200;

  static Future<Map<String, String>> _headers({bool json = false}) async {
    final token = await TokenStore.read();
    return {
      if (token != null) 'Authorization': 'Bearer $token',
      if (json) 'Content-Type': 'application/json',
    };
  }

  static Uri _uri(String path) => Uri.parse('$apiBaseUrl$path');

  static Future<dynamic> _send(String method, String path, {Object? body}) async {
    final uri = _uri(path);
    final headers = await _headers(json: body != null);
    final stopwatch = Stopwatch()..start();
    _logRequest(method, uri, headers, body);

    try {
      late final http.Response res;
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: headers);
          break;
        case 'POST':
          res = await http.post(
            uri,
            headers: headers,
            body: body != null ? jsonEncode(body) : null,
          );
          break;
        case 'PATCH':
          res = await http.patch(
            uri,
            headers: headers,
            body: body != null ? jsonEncode(body) : null,
          );
          break;
        default:
          throw UnsupportedError('Unsupported method $method');
      }
      stopwatch.stop();
      _logResponse(method, uri, res, stopwatch.elapsed);
      return _decode(res);
    } on SocketException catch (e, stackTrace) {
      stopwatch.stop();
      _logFailure(method, uri, e, stopwatch.elapsed, stackTrace);
      rethrow;
    } on http.ClientException catch (e, stackTrace) {
      stopwatch.stop();
      _logFailure(method, uri, e, stopwatch.elapsed, stackTrace);
      rethrow;
    } on FormatException catch (e, stackTrace) {
      stopwatch.stop();
      _logFailure(method, uri, e, stopwatch.elapsed, stackTrace);
      rethrow;
    }
  }

  static dynamic _decode(http.Response res) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      String message = res.reasonPhrase ?? 'Request failed';
      try {
        final body = jsonDecode(res.body);
        if (body is Map && body['error'] is String) message = body['error'] as String;
      } catch (_) {
        // non-JSON error body — fall back to the status line above
      }
      throw ApiException(message, res.statusCode);
    }
    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  static void _logRequest(String method, Uri uri, Map<String, String> headers, Object? body) {
    if (!_apiLogsEnabled) return;
    final message =
        '${_requestLabel(method, uri)} headers=${_stringifyForLog(_redact(headers))}'
        '${body != null ? ' body=${_stringifyForLog(_redact(body))}' : ''}';
    developer.log(message, name: 'CampfireApi');
    debugPrint('[CampfireApi] $message');
  }

  static void _logResponse(String method, Uri uri, http.Response res, Duration elapsed) {
    if (!_apiLogsEnabled) return;
    final contentType = res.headers['content-type'] ?? '';
    final body = _parseBodyForLog(res.body, contentType);
    final message =
        '${_requestLabel(method, uri)} -> ${res.statusCode} ${res.reasonPhrase ?? ''} '
        '(${elapsed.inMilliseconds} ms) headers=${_stringifyForLog(_redact(res.headers))}'
        '${body != null ? ' body=${_stringifyForLog(body)}' : ''}';
    developer.log(message, name: 'CampfireApi');
    debugPrint('[CampfireApi] $message');
  }

  static void _logFailure(
    String method,
    Uri uri,
    Object error,
    Duration elapsed,
    StackTrace stackTrace,
  ) {
    if (!_apiLogsEnabled) return;
    final message =
        '${_requestLabel(method, uri)} failed after ${elapsed.inMilliseconds} ms: $error';
    developer.log(
      message,
      name: 'CampfireApi',
      error: error,
      stackTrace: stackTrace,
      level: 1000,
    );
    debugPrint('[CampfireApi] $message');
  }

  static String _requestLabel(String method, Uri uri) => '$method ${uri.toString()}';

  static Object? _parseBodyForLog(String body, String contentType) {
    if (body.isEmpty) return null;
    final isJson = contentType.contains('application/json') ||
        body.startsWith('{') ||
        body.startsWith('[');
    if (!isJson) return _truncate(body);
    try {
      return _redact(jsonDecode(body));
    } catch (_) {
      return _truncate(body);
    }
  }

  static Object? _redact(Object? value) {
    if (value is Map) {
      return value.map((key, nested) {
        final normalizedKey = key.toString().toLowerCase();
        if (_isSensitiveKey(normalizedKey)) {
          return MapEntry(key, '<redacted>');
        }
        return MapEntry(key, _redact(nested));
      });
    }
    if (value is Iterable) return value.map(_redact).toList(growable: false);
    return value;
  }

  static bool _isSensitiveKey(String key) {
    return key.contains('authorization') ||
        key.contains('password') ||
        key == 'token' ||
        key.endsWith('_token') ||
        key.endsWith('token');
  }

  static String _stringifyForLog(Object? value) {
    final text = value is String ? value : jsonEncode(value);
    return _truncate(text);
  }

  static String _truncate(String value) {
    if (value.length <= _maxLogBodyLength) return value;
    return '${value.substring(0, _maxLogBodyLength)}...<truncated>';
  }

  static Future<dynamic> get(String path) async {
    return _send('GET', path);
  }

  static Future<dynamic> post(String path, [Object? body]) async {
    return _send('POST', path, body: body);
  }

  static Future<dynamic> patch(String path, Object body) async {
    return _send('PATCH', path, body: body);
  }
}
