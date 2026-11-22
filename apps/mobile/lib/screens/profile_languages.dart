part of 'profile_screen.dart';

/// The viewer's languages: up to three audio languages in order, whether subtitles come on
/// (never / only when the audio isn't one of those / always) and in which language. Every title
/// starts in these unless the viewer picked something else for it in the player.
///
/// Built from [SettingsRow]s and [showOptionPicker] so a TV remote walks it like the rest of the
/// profile; each change is saved straight away, as nothing else on this screen has a Save button.
class LanguageSettingsSection extends StatefulWidget {
  final LanguagePrefs? prefs;
  final Future<List<LanguageOption>> Function() loadOptions;
  final Future<void> Function(LanguagePrefs prefs) onSave;

  const LanguageSettingsSection({
    super.key,
    required this.prefs,
    required this.loadOptions,
    required this.onSave,
  });

  static const maxAudio = 3;

  static String modeLabel(String mode) => switch (mode) {
    'always' => 'Always',
    'foreign' => "Only when the audio isn't one of my languages",
    _ => 'Off',
  };

  static String slotTitle(int slot) => switch (slot) {
    0 => 'Audio language',
    1 => 'Second choice',
    _ => 'Third choice',
  };

  @override
  State<LanguageSettingsSection> createState() => _LanguageSettingsSectionState();
}

class _LanguageSettingsSectionState extends State<LanguageSettingsSection> {
  static const _none = '';

  List<LanguageOption>? _options;
  Future<List<LanguageOption>>? _loading;
  bool _saving = false;
  String? _error;

  // Shown until the save lands, so a slow server doesn't make a pick look ignored.
  LanguagePrefs? _pending;

  LanguagePrefs get _prefs => _pending ?? widget.prefs ?? const LanguagePrefs();

  @override
  void initState() {
    super.initState();
    // Only for the names on the rows; a failure here is retried when a picker needs the list.
    _ensureOptions().catchError((_) => const <LanguageOption>[]);
  }

  Future<List<LanguageOption>> _ensureOptions() {
    final ready = _options;
    if (ready != null) return Future.value(ready);
    return _loading ??= widget.loadOptions().then((options) {
      if (mounted) setState(() => _options = options);
      return options;
    }).whenComplete(() => _loading = null);
  }

  String _name(String code) {
    for (final o in _options ?? const <LanguageOption>[]) {
      if (o.code == code) return o.name;
    }
    return code.toUpperCase();
  }

  /// Languages something in the library has come first: those are the ones that can matter.
  List<PickerOption<String>> _languageChoices({Set<String> exclude = const {}}) {
    final options = (_options ?? const <LanguageOption>[]).where((o) => !exclude.contains(o.code)).toList();
    return [
      for (final o in options.where((o) => o.inLibrary))
        PickerOption(value: o.code, label: o.name, detail: 'In the library'),
      for (final o in options.where((o) => !o.inLibrary)) PickerOption(value: o.code, label: o.name),
    ];
  }

  Future<bool> _optionsOrError() async {
    try {
      await _ensureOptions();
      return true;
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't load the list of languages. Try again in a moment.");
      return false;
    }
  }

  Future<void> _save(LanguagePrefs next) async {
    setState(() {
      _pending = next;
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave(next);
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : "Couldn't save. Check your connection.");
    } finally {
      if (mounted) {
        setState(() {
          _pending = null;
          _saving = false;
        });
      }
    }
  }

  Future<void> _pickAudio(int slot) async {
    if (!await _optionsOrError() || !mounted) return;
    final audio = _prefs.audio;
    final current = slot < audio.length ? audio[slot] : _none;
    final picked = await showOptionPicker<String>(
      context: context,
      title: LanguageSettingsSection.slotTitle(slot),
      selected: current,
      options: [
        PickerOption(
          value: _none,
          label: slot == 0 ? 'No preference' : 'None',
          detail: slot == 0 ? "Each title's own default audio" : null,
        ),
        ..._languageChoices(exclude: {for (var i = 0; i < audio.length; i++) if (i != slot) audio[i]}),
      ],
    );
    if (picked == null || picked == current || !mounted) return;
    final next = [...audio];
    if (picked == _none) {
      if (slot < next.length) next.removeAt(slot);
    } else if (slot < next.length) {
      next[slot] = picked;
    } else {
      next.add(picked);
    }
    await _save(_prefs.copyWith(audio: next));
  }

  Future<void> _pickMode() async {
    final mode = _prefs.subtitleMode;
    final picked = await showOptionPicker<String>(
      context: context,
      title: 'Subtitles',
      selected: mode,
      options: [
        for (final m in LanguagePrefs.modes)
          PickerOption(
            value: m,
            label: LanguageSettingsSection.modeLabel(m),
            detail: switch (m) {
              'foreign' => 'On for a title whose audio is in none of your languages',
              'always' => 'Every title starts with subtitles on',
              _ => 'Every title starts without subtitles',
            },
          ),
      ],
    );
    if (picked == null || picked == mode || !mounted) return;
    var subtitles = _prefs.subtitles;
    if (picked != 'off' && subtitles == null) {
      // The server refuses subtitles switched on in no language, so ask now rather than fail.
      subtitles = await _askSubtitleLanguage(null);
      if (subtitles == null) return;
    }
    await _save(_prefs.copyWith(subtitleMode: picked, subtitles: subtitles));
  }

  Future<String?> _askSubtitleLanguage(String? current) async {
    if (!await _optionsOrError() || !mounted) return null;
    return showOptionPicker<String>(
      context: context,
      title: 'Subtitle language',
      selected: current,
      options: _languageChoices(),
    );
  }

  Future<void> _pickSubtitleLanguage() async {
    final current = _prefs.subtitles;
    final picked = await _askSubtitleLanguage(current);
    if (picked == null || picked == current || !mounted) return;
    await _save(_prefs.copyWith(subtitles: picked));
  }

  /// Taps wait out a save in flight, so two quick picks can't race. The rows themselves stay
  /// focusable meanwhile: taking them away would drop a TV remote's focus off the section.
  void _guard(Future<void> Function() action) {
    if (_saving) return;
    action();
  }

  @override
  Widget build(BuildContext context) {
    final prefs = _prefs;
    final audio = prefs.audio;
    // One row more than there are choices (up to three), so adding the next is always one tap.
    final audioRows = (audio.length + 1).clamp(1, LanguageSettingsSection.maxAudio);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var slot = 0; slot < audioRows; slot++)
          SettingsRow(
            icon: slot == 0 ? Icons.record_voice_over_outlined : Icons.subdirectory_arrow_right,
            title: LanguageSettingsSection.slotTitle(slot),
            subtitle: slot < audio.length
                ? _name(audio[slot])
                : slot == 0
                    ? "No preference: each title's own default"
                    : 'None: used when a title has none of the above',
            onTap: () => _guard(() => _pickAudio(slot)),
          ),
        SettingsRow(
          icon: Icons.closed_caption_outlined,
          title: 'Subtitles',
          subtitle: LanguageSettingsSection.modeLabel(prefs.subtitleMode),
          onTap: () => _guard(_pickMode),
        ),
        if (prefs.subtitleMode != 'off')
          SettingsRow(
            icon: Icons.translate,
            title: 'Subtitle language',
            subtitle: prefs.subtitles == null ? 'Pick one' : _name(prefs.subtitles!),
            onTap: () => _guard(_pickSubtitleLanguage),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
          ),
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            'Every title starts in these. Changing the audio or subtitles in the player still wins '
            'for that title and the rest of its series.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 12, height: 1.4),
          ),
        ),
      ],
    );
  }
}
