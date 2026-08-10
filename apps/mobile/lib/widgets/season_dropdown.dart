import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';

class SeasonDropdown extends StatelessWidget {
  final List<Season> seasons;
  final String selectedId;
  final ValueChanged<String> onChanged;

  const SeasonDropdown({super.key, required this.seasons, required this.selectedId, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.divider),
        borderRadius: BorderRadius.circular(6),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: selectedId,
          dropdownColor: AppColors.surface,
          style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500),
          items: seasons
              .map((s) => DropdownMenuItem(value: s.id, child: Text(s.name)))
              .toList(),
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
      ),
    );
  }
}
