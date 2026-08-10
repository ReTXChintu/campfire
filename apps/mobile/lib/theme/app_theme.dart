import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Mirrors apps/frontend/src/index.css's CSS custom properties — same palette, same names,
/// so a change on one side is easy to carry over to the other by hand.
class AppColors {
  AppColors._();

  static const background = Color(0xFF0A0B0F);
  static const surface = Color(0xFF1C1F27);
  static const surfaceHover = Color(0xFF252932);
  static const foreground = Color(0xFFF2EFE9);
  static const textSecondary = Color(0xFF9A9CA8);
  static const textTertiary = Color(0xFF5C5F6B);
  static const accent = Color(0xFFFF4D2E);
  static const accentDim = Color(0xFFB5391F);
  static const amber = Color(0xFFFFB13C);
  static const live = Color(0xFF2ED47A);
  static const divider = Color(0xFF23262E);
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
        error: const Color(0xFFF87171),
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
          backgroundColor: AppColors.foreground,
          foregroundColor: Colors.black,
          textStyle: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
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
