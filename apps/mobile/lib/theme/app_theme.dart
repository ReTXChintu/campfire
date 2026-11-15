import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Campfire design system (design.html) — Char/Smoke/Ember/Gold/Birch/Ash-red. Mirrors
/// apps/frontend/src/index.css's CSS custom properties — same palette, same names, so a change on
/// one side is easy to carry over to the other by hand.
class AppColors {
  AppColors._();

  static const background = Color(0xFF0E0D0C);
  static const bgElevated = Color(0xFF161412);
  static const surface = Color(0xFF1E1B18);
  static const surfaceHover = Color(0xFF272320);
  static const foreground = Color(0xFFF1ECE3);
  static const textSecondary = Color(0xFFB4ADA3);
  static const textTertiary = Color(0xFF7A736A);
  static const accent = Color(0xFFFF6A3D);
  static const accentDim = Color(0xFFB5451F);
  static const accentSoft = Color(0x29FF6A3D); // accent @ 16% alpha
  static const amber = Color(0xFFFFB25E);
  static const live = Color(0xFF3FCB8E);
  static const info = Color(0xFF7AA7D9);
  static const danger = Color(0xFFE5645E);
  static const dangerSoft = Color(0x24E5645E); // danger @ 14% alpha
  static const divider = Color(0xFF262220);
  static const dividerStrong = Color(0xFF353330);
  static const onAccent = Color(0xFF1A0D06); // near-black text/icons on ember or gold backgrounds
}

class AppTheme {
  AppTheme._();

  /// The wordmark/hero-title font (web: Bebas Neue via --font-display).
  static TextStyle display({double fontSize = 32, Color color = AppColors.foreground}) =>
      GoogleFonts.bebasNeue(fontSize: fontSize, color: color, letterSpacing: 0.5);

  static ThemeData get dark {
    final base = ThemeData.dark(useMaterial3: true);
    final textTheme = GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: AppColors.foreground,
      displayColor: AppColors.foreground,
    );

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.background,
      colorScheme: base.colorScheme.copyWith(
        surface: AppColors.background,
        primary: AppColors.accent,
        secondary: AppColors.amber,
        error: AppColors.danger,
      ),
      textTheme: textTheme,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.black87,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
      ),
      dividerColor: AppColors.divider,
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.foreground),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accent,
          foregroundColor: AppColors.onAccent,
          textStyle: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        labelStyle: const TextStyle(color: AppColors.textSecondary),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.divider),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.divider),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Colors.white54),
        ),
      ),
    );
  }
}

/// Corner radii from the redesign's token set (`--r-sm` … `--r-pill`). Kept as plain doubles
/// rather than BorderRadius so they compose with both ClipRRect and BoxDecoration call sites.
class AppRadius {
  AppRadius._();

  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const pill = 999.0;
}

/// Layout constants the responsive shell and every pane agree on. Layouts are full-width by
/// product rule — these are side gutters, never a centred max-width column.
class AppLayout {
  AppLayout._();

  /// Below this the shell uses a bottom navigation bar; at or above it, a persistent left
  /// sidebar (Windows desktop and Android TV).
  static const sidebarBreakpoint = 840.0;

  /// 16px on phones, 24–32px on desktop.
  static double gutter(double width) => width >= sidebarBreakpoint ? 28 : 16;

  static bool usesSidebar(double width) => width >= sidebarBreakpoint;
}
