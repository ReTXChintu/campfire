import 'dart:io';
import 'package:flutter/services.dart' show rootBundle;

class _BackendTrustHttpOverrides extends HttpOverrides {
  final List<int> certBytes;
  _BackendTrustHttpOverrides(this.certBytes);

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    // `withTrustedRoots: true` keeps the normal system CA list intact — this *adds* our one
    // self-signed cert as an extra trusted root, it doesn't replace anything, so real HTTPS to
    // other hosts (e.g. google_fonts fetching font files) still validates normally.
    final ctx = context ?? SecurityContext(withTrustedRoots: true);
    try {
      ctx.setTrustedCertificatesBytes(certBytes);
    } catch (_) {
      // Bundled cert is the not-yet-regenerated placeholder (invalid PEM) — fall back to just
      // the system trust store rather than throwing on every request.
    }
    return super.createHttpClient(ctx);
  }
}

/// Loads assets/certs/backend_cert.pem (bundled by scripts/generate-self-signed-cert.sh) and
/// installs it as a globally-trusted cert for all `dart:io` HTTP clients — this is what
/// package:http's default client is built on for every non-web Flutter platform, so setting
/// `HttpOverrides.global` here covers every API call the app makes without touching call sites.
Future<void> installBackendCertTrust() async {
  try {
    final data = await rootBundle.load('assets/certs/backend_cert.pem');
    HttpOverrides.global = _BackendTrustHttpOverrides(data.buffer.asUint8List());
  } catch (_) {
    // No bundled cert — e.g. the backend has a real (CA-signed) certificate, so there's nothing
    // extra to trust. Falls back to Dart's normal default HttpClient behavior.
  }
}
