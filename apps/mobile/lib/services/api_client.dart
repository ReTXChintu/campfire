import 'dart:convert';
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

  static Future<Map<String, String>> _headers({bool json = false}) async {
    final token = await TokenStore.read();
    return {
      if (token != null) 'Authorization': 'Bearer $token',
      if (json) 'Content-Type': 'application/json',
    };
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

  static Future<dynamic> get(String path) async {
    final res = await http.get(Uri.parse('$apiBaseUrl$path'), headers: await _headers());
    return _decode(res);
  }

  static Future<dynamic> post(String path, [Object? body]) async {
    final res = await http.post(
      Uri.parse('$apiBaseUrl$path'),
      headers: await _headers(json: body != null),
      body: body != null ? jsonEncode(body) : null,
    );
    return _decode(res);
  }

  static Future<dynamic> patch(String path, Object body) async {
    final res = await http.patch(
      Uri.parse('$apiBaseUrl$path'),
      headers: await _headers(json: true),
      body: jsonEncode(body),
    );
    return _decode(res);
  }
}
