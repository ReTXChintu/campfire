import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../models/catalog.dart';
import '../models/media_request.dart';
import '../services/api_client.dart';
import '../services/requests_service.dart';
import '../theme/app_theme.dart';
import 'request_poster.dart';
import 'request_status_pill.dart';

/// Opens the "Request a title" form: full-screen on a phone, a dialog on a desktop-sized window
/// (Windows, and an Android TV's own wide screen). One form either way — the breakpoint only
/// decides how it's framed, so there's no second copy of the flow to keep in step.
///
/// Resolves with the request that came back — either the one just created, or the existing one the
/// requester upvoted instead after the dedupe hint offered it. Null means they backed out.
Future<MediaRequest?> showRequestSheet(
  BuildContext context, {
  String? initialTitle,
  List<CatalogListItem> libraryItems = const [],
}) {
  final wide = MediaQuery.sizeOf(context).width >= 700;
  final form = RequestForm(initialTitle: initialTitle, libraryItems: libraryItems);

  if (wide) {
    return showDialog<MediaRequest>(
      context: context,
      barrierDismissible: false,
      builder: (context) => Dialog(
        backgroundColor: AppColors.bgElevated,
        insetPadding: const EdgeInsets.all(24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ConstrainedBox(
          // A dialog is one of the few things allowed to be narrower than the window (see the
          // full-bleed rule) — a 1600px-wide form field would be unusable.
          constraints: const BoxConstraints(maxWidth: 720, maxHeight: 720),
          child: form,
        ),
      ),
    );
  }

  return showModalBottomSheet<MediaRequest>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.bgElevated,
    isDismissible: false,
    enableDrag: false,
    // isScrollControlled hands the sheet the full screen height as its constraint, so a
    // heightFactor of 1 is what makes this genuinely full-screen rather than a tall peek.
    builder: (context) => FractionallySizedBox(heightFactor: 1, child: form),
  );
}

/// The form body. Public so the sheet and the dialog can share it verbatim.
class RequestForm extends StatefulWidget {
  final String? initialTitle;
  final List<CatalogListItem> libraryItems;

  const RequestForm({super.key, this.initialTitle, this.libraryItems = const []});

  @override
  State<RequestForm> createState() => _RequestFormState();
}

enum _RefTab { link, image }

enum _LinkState { empty, checking, bad, resolved }

class _RequestFormState extends State<RequestForm> {
  final _titleController = TextEditingController();
  final _linkController = TextEditingController();
  final _scrollController = ScrollController();

  Timer? _matchDebounce;
  _RefTab _tab = _RefTab.link;

  // --- dedupe / library hints ----------------------------------------------------------------
  MediaRequest? _duplicate;
  bool _matching = false;
  CatalogListItem? _alreadyInLibrary;

  // --- link reference ------------------------------------------------------------------------
  _LinkState _linkState = _LinkState.empty;
  String? _linkError;
  ResolvedLink? _resolved;
  /// Set once the requester says "Looks right" (or when there was no metadata to confirm at all,
  /// in which case there's nothing to look at and the link just counts).
  String? _confirmedLink;

  // --- image reference ----------------------------------------------------------------------
  UploadedReferenceImage? _uploadedImage;
  String? _uploadedImageName;
  bool _uploading = false;
  String? _imageError;

  // --- submit --------------------------------------------------------------------------------
  bool _submitting = false;
  String? _titleError;
  String? _referenceError;
  String? _formError;
  MediaRequest? _created;

  @override
  void initState() {
    super.initState();
    _titleController.text = widget.initialTitle ?? '';
    if (_titleController.text.isNotEmpty) {
      _recheckTitle(immediate: true);
    }
  }

  @override
  void dispose() {
    _matchDebounce?.cancel();
    _titleController.dispose();
    _linkController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------------------------
  // Title: the dedupe hint (server-side) and the already-in-your-library warning (client-side,
  // against the catalog this session already holds — no endpoint needed for something we know).
  // ---------------------------------------------------------------------------------------------

  void _onTitleChanged(String _) {
    setState(() {
      _titleError = null;
      _formError = null;
    });
    _recheckTitle();
  }

  void _recheckTitle({bool immediate = false}) {
    _matchDebounce?.cancel();
    final title = _titleController.text.trim();
    _alreadyInLibrary = _findInLibrary(title);

    if (title.length < 2) {
      setState(() {
        _duplicate = null;
        _matching = false;
      });
      return;
    }

    void run() async {
      setState(() => _matching = true);
      try {
        final match = await RequestsService.match(title);
        if (!mounted || _titleController.text.trim() != title) return;
        setState(() {
          _duplicate = match;
          _matching = false;
        });
      } catch (_) {
        if (!mounted) return;
        // A failed hint is not worth an error message — it's an optimisation, not the flow.
        setState(() => _matching = false);
      }
    }

    if (immediate) {
      run();
    } else {
      _matchDebounce = Timer(const Duration(milliseconds: 400), run);
    }
  }

  CatalogListItem? _findInLibrary(String title) {
    final query = title.trim().toLowerCase();
    if (query.length < 3) return null;
    for (final item in widget.libraryItems) {
      final name = item.name.toLowerCase();
      if (name == query || name.contains(query) || query.contains(name)) return item;
    }
    return null;
  }

  Future<void> _voteForDuplicateInstead() async {
    final duplicate = _duplicate;
    if (duplicate == null) return;
    setState(() => _submitting = true);
    try {
      final updated = await RequestsService.upvote(duplicate.id, wantsIt: true);
      if (!mounted) return;
      Navigator.of(context).pop(updated);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _formError = error.message;
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Reference: a link (validated and, when the backend has a TMDB key, previewed) or an image.
  // ---------------------------------------------------------------------------------------------

  Future<void> _resolveLink() async {
    final link = _linkController.text.trim();
    if (link.isEmpty) {
      setState(() {
        _linkState = _LinkState.empty;
        _resolved = null;
        _confirmedLink = null;
        _linkError = null;
      });
      return;
    }

    setState(() {
      _linkState = _LinkState.checking;
      _linkError = null;
      _referenceError = null;
    });

    try {
      final resolved = await RequestsService.resolveLink(link);
      if (!mounted) return;
      setState(() {
        _resolved = resolved;
        _linkState = _LinkState.resolved;
        // No metadata means the link is valid but unenriched (no TMDB_API_KEY server-side) —
        // there's no preview card to confirm, so accept it and say so quietly.
        _confirmedLink = resolved.meta == null ? link : null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _linkState = _LinkState.bad;
        _resolved = null;
        _confirmedLink = null;
        _linkError = error.message;
      });
    }
  }

  Future<void> _pickImage() async {
    setState(() => _imageError = null);
    FilePickerResult? picked;
    try {
      picked = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['png', 'jpg', 'jpeg', 'webp', 'gif'],
        // The bytes are what gets POSTed, and a path isn't available on every platform.
        withData: true,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _imageError = "Couldn't open the file picker: $error");
      return;
    }
    final file = (picked != null && picked.files.isNotEmpty) ? picked.files.first : null;
    final bytes = file?.bytes;
    if (file == null || bytes == null) return;

    final contentType = _contentTypeFor(file.extension);
    if (contentType == null) {
      setState(() => _imageError = 'Attach a PNG, JPEG, WebP or GIF image');
      return;
    }

    setState(() {
      _uploading = true;
      _referenceError = null;
    });
    try {
      final uploaded = await RequestsService.uploadReferenceImage(bytes, contentType);
      if (!mounted) return;
      setState(() {
        _uploadedImage = uploaded;
        _uploadedImageName = file.name;
        _uploading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        // The server owns the size and type limits (5 MB, PNG/JPEG/WebP/GIF) and says so itself.
        _imageError = error.message;
      });
    }
  }

  static String? _contentTypeFor(String? extension) {
    switch (extension?.toLowerCase()) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      default:
        return null;
    }
  }

  /// What will actually be sent. Only one of the two ever is: whichever tab the requester left
  /// filled in. Confirming the preview card is optional — a link that was typed but never checked
  /// is still submitted, because the server validates it again anyway and its "that doesn't look
  /// like an IMDb or TMDb title link" is a better answer than refusing to submit at all.
  String? get _effectiveLink {
    if (_tab != _RefTab.link) return null;
    final confirmed = _confirmedLink;
    if (confirmed != null && confirmed.isNotEmpty) return confirmed;
    final typed = _linkController.text.trim();
    return typed.isEmpty ? null : typed;
  }
  String? get _effectiveImageId => _tab == _RefTab.image ? _uploadedImage?.imageId : null;

  // ---------------------------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------------------------

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _titleError = null;
      _referenceError = null;
      _formError = null;
    });

    try {
      final created = await RequestsService.create(
        title: _titleController.text.trim(),
        refLink: _effectiveLink,
        refImageId: _effectiveImageId,
      );
      if (!mounted) return;
      setState(() {
        _created = created;
        _submitting = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      // The server's own messages, pinned to the field it named — the rules aren't restated here.
      setState(() {
        _submitting = false;
        switch (error.field) {
          case 'title':
            _titleError = error.message;
          case 'reference':
          case 'refLink':
          case 'refImage':
            _referenceError = error.message;
          default:
            _formError = error.message;
        }
      });
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _formError = "Couldn't reach the server — check your connection and try again.";
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final created = _created;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _Header(
          title: created == null ? 'Request a title' : 'Request submitted',
          onClose: () => Navigator.of(context).pop(created),
        ),
        Expanded(
          child: created == null ? _buildForm(context) : _Success(request: created),
        ),
        _Footer(
          busy: _submitting || _uploading,
          primaryLabel: created == null ? 'Submit request' : 'See my requests',
          onCancel: () => Navigator.of(context).pop(created),
          cancelLabel: created == null ? 'Cancel' : 'Done',
          onPrimary: created == null ? _submit : () => Navigator.of(context).pop(created),
        ),
      ],
    );
  }

  Widget _buildForm(BuildContext context) {
    return ListView(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
      children: [
        if (_formError != null) ...[
          _ErrorBanner(_formError!),
          const SizedBox(height: 14),
        ],
        Text('Title', style: _labelStyle),
        const SizedBox(height: 7),
        TextField(
          controller: _titleController,
          autofocus: true,
          textInputAction: TextInputAction.next,
          onChanged: _onTitleChanged,
          decoration: InputDecoration(
            hintText: 'e.g. The Salt Road',
            hintStyle: const TextStyle(color: AppColors.textTertiary),
            errorText: _titleError,
            suffixIcon: _matching
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textTertiary),
                    ),
                  )
                : null,
          ),
        ),
        if (_alreadyInLibrary != null) _libraryWarning(_alreadyInLibrary!),
        if (_alreadyInLibrary == null && _duplicate != null) _duplicateHint(_duplicate!),
        const SizedBox(height: 6),
        const Text(
          "We check your library as you type, so you don't ask for something you already have.",
          style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
        ),
        const SizedBox(height: 20),
        _referenceGroup(),
        const SizedBox(height: 16),
        const Text(
          'Submitted requests are visible to everyone on this server, with your name.',
          style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
        ),
      ],
    );
  }

  Widget _libraryWarning(CatalogListItem item) {
    return _InlineWarn(
      icon: Icons.check_circle_outline,
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: item.name,
                  style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.foreground),
                ),
                const TextSpan(text: ' is already in your library.'),
              ],
            ),
            style: const TextStyle(color: AppColors.foreground, fontSize: 12, height: 1.45),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              context.push(
                item is CatalogFolderItem ? '/folder/${item.id}' : '/watch/${item.id}',
              );
            },
            style: TextButton.styleFrom(
              foregroundColor: AppColors.amber,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(0, 32),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Open it'),
          ),
        ],
      ),
    );
  }

  Widget _duplicateHint(MediaRequest duplicate) {
    final others = duplicate.wantCount;
    return _InlineWarn(
      icon: Icons.groups_outlined,
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: '$others ${others == 1 ? "person" : "people"}',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.foreground),
                ),
                const TextSpan(text: ' already asked for '),
                TextSpan(
                  text: duplicate.title,
                  style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.foreground),
                ),
                TextSpan(text: ' (${duplicate.status.label.toLowerCase()}).'),
              ],
            ),
            style: const TextStyle(color: AppColors.foreground, fontSize: 12, height: 1.45),
          ),
          TextButton(
            onPressed: duplicate.iWantIt || _submitting ? null : _voteForDuplicateInstead,
            style: TextButton.styleFrom(
              foregroundColor: AppColors.amber,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(0, 32),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(duplicate.iWantIt ? "You've already voted for it" : 'Add my vote instead'),
          ),
        ],
      ),
    );
  }

  Widget _referenceGroup() {
    final invalid = _referenceError != null;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.background,
        border: Border.all(color: invalid ? AppColors.danger : AppColors.dividerStrong),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(13, 12, 13, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.travel_explore, size: 16, color: AppColors.amber),
                    const SizedBox(width: 7),
                    Text('Help us identify it', style: _labelStyle.copyWith(fontSize: 13.5)),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'A link or a poster image is how the admin finds the exact title — especially for '
                  'regional or same-named releases.',
                  style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(9, 10, 9, 0),
            child: Row(
              children: [
                _RefTabButton(
                  label: 'Paste a link',
                  selected: _tab == _RefTab.link,
                  onTap: () => setState(() {
                    _tab = _RefTab.link;
                    _referenceError = null;
                  }),
                ),
                const SizedBox(width: 4),
                _RefTabButton(
                  label: 'Upload an image',
                  selected: _tab == _RefTab.image,
                  onTap: () => setState(() {
                    _tab = _RefTab.image;
                    _referenceError = null;
                  }),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(13, 12, 13, 14),
            child: _tab == _RefTab.link ? _linkTab() : _imageTab(),
          ),
          if (_referenceError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(13, 0, 13, 12),
              child: _FieldError(_referenceError!),
            ),
        ],
      ),
    );
  }

  Widget _linkTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('IMDb or TMDb title link', style: _labelStyle),
        const SizedBox(height: 7),
        TextField(
          controller: _linkController,
          keyboardType: TextInputType.url,
          textInputAction: TextInputAction.done,
          style: const TextStyle(fontSize: 13),
          onChanged: (_) {
            if (_linkState != _LinkState.empty || _confirmedLink != null) {
              setState(() {
                _linkState = _LinkState.empty;
                _resolved = null;
                _confirmedLink = null;
                _linkError = null;
              });
            }
          },
          onSubmitted: (_) => _resolveLink(),
          decoration: const InputDecoration(
            hintText: 'https://www.imdb.com/title/tt4729432/',
            hintStyle: TextStyle(color: AppColors.textTertiary, fontSize: 13),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            OutlinedButton(
              onPressed: _linkState == _LinkState.checking ? null : _resolveLink,
              child: Text(_linkState == _LinkState.checking ? 'Looking that up…' : 'Check this link'),
            ),
            if (_linkState == _LinkState.checking) ...[
              const SizedBox(width: 10),
              const SizedBox(
                width: 15,
                height: 15,
                child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent),
              ),
            ],
          ],
        ),
        if (_linkState == _LinkState.bad && _linkError != null) ...[
          const SizedBox(height: 10),
          _FieldError(_linkError!),
        ],
        if (_linkState == _LinkState.resolved) ...[
          const SizedBox(height: 11),
          if (_resolved!.meta == null)
            _InlineWarn(
              icon: Icons.check,
              child: const Text(
                "That link checks out. We couldn't pull any details for it, so the admin will open "
                'it themselves — nothing more needed from you.',
                style: TextStyle(color: AppColors.foreground, fontSize: 12, height: 1.45),
              ),
            )
          else
            _LinkPreview(
              meta: _resolved!.meta!,
              confirmed: _confirmedLink != null,
              onConfirm: () => setState(() => _confirmedLink = _linkController.text.trim()),
              onReject: () => setState(() {
                _linkState = _LinkState.empty;
                _resolved = null;
                _confirmedLink = null;
                _linkController.clear();
              }),
            ),
        ],
      ],
    );
  }

  Widget _imageTab() {
    final uploaded = _uploadedImage;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (uploaded == null)
          InkWell(
            onTap: _uploading ? null : _pickImage,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 14),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.dividerStrong, width: 1.5),
              ),
              child: Column(
                children: [
                  if (_uploading)
                    const SizedBox(
                      width: 26,
                      height: 26,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent),
                    )
                  else
                    const Icon(Icons.upload_outlined, size: 26, color: AppColors.amber),
                  const SizedBox(height: 8),
                  Text(
                    _uploading ? 'Uploading…' : 'Choose a poster or a screenshot',
                    style: const TextStyle(color: AppColors.foreground, fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'PNG, JPEG, WebP or GIF · up to 5 MB',
                    style: TextStyle(color: AppColors.textTertiary, fontSize: 11),
                  ),
                ],
              ),
            ),
          )
        else
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.dividerStrong),
            ),
            child: Row(
              children: [
                RequestPoster(
                  title: _uploadedImageName ?? 'Reference',
                  refImagePath: uploaded.path,
                  width: 44,
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _uploadedImageName ?? 'Reference image',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.foreground, fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${(uploaded.sizeBytes / 1024 / 1024).toStringAsFixed(1)} MB · attached',
                        style: const TextStyle(color: AppColors.textTertiary, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Remove the attached image',
                  onPressed: () => setState(() {
                    _uploadedImage = null;
                    _uploadedImageName = null;
                  }),
                  icon: const Icon(Icons.delete_outline, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        if (_imageError != null) ...[
          const SizedBox(height: 10),
          _FieldError(_imageError!),
        ],
        const SizedBox(height: 8),
        const Text(
          'The admin sees this full size, so a clear poster or a title card works best.',
          style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
        ),
      ],
    );
  }

  static const _labelStyle = TextStyle(
    color: AppColors.textSecondary,
    fontSize: 12.5,
    fontWeight: FontWeight.w600,
  );
}

class _Header extends StatelessWidget {
  final String title;
  final VoidCallback onClose;

  const _Header({required this.title, required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.divider)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: const TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
          IconButton(
            tooltip: 'Close',
            onPressed: onClose,
            icon: const Icon(Icons.close, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  final bool busy;
  final String primaryLabel;
  final String cancelLabel;
  final VoidCallback onCancel;
  final VoidCallback onPrimary;

  const _Footer({
    required this.busy,
    required this.primaryLabel,
    required this.cancelLabel,
    required this.onCancel,
    required this.onPrimary,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: busy ? null : onCancel,
              child: Text(cancelLabel),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ElevatedButton(
              onPressed: busy ? null : onPrimary,
              child: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onAccent),
                    )
                  : Text(primaryLabel),
            ),
          ),
        ],
      ),
    );
  }
}

class _RefTabButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _RefTabButton({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        backgroundColor: selected ? AppColors.accentSoft : Colors.transparent,
        foregroundColor: selected ? AppColors.foreground : AppColors.textSecondary,
        side: BorderSide(color: selected ? AppColors.accentDim : Colors.transparent),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        minimumSize: const Size(0, 38),
        textStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
      ),
      child: Text(label),
    );
  }
}

class _LinkPreview extends StatelessWidget {
  final RequestRefMeta meta;
  final bool confirmed;
  final VoidCallback onConfirm;
  final VoidCallback onReject;

  const _LinkPreview({
    required this.meta,
    required this.confirmed,
    required this.onConfirm,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: confirmed ? AppColors.live : AppColors.dividerStrong),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RequestPoster(title: meta.title, posterUrl: meta.posterUrl, width: 56),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        meta.title,
                        style: const TextStyle(color: AppColors.foreground, fontSize: 13.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                    if (confirmed)
                      const Text(
                        '✓ confirmed',
                        style: TextStyle(color: AppColors.live, fontSize: 11, fontWeight: FontWeight.w700),
                      ),
                  ],
                ),
                // Year and type come from the lookup and are often missing — rendered only when
                // they're actually there, never as an "Unknown" placeholder.
                if (meta.year != null || meta.type != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    [
                      if (meta.year != null) '${meta.year}',
                      if (meta.type != null) meta.type == 'series' ? 'Series' : 'Movie',
                    ].join(' · '),
                    style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                  ),
                ],
                if (meta.overview != null && meta.overview!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    meta.overview!,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5, height: 1.45),
                  ),
                ],
                const SizedBox(height: 9),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    if (!confirmed)
                      ElevatedButton.icon(
                        onPressed: onConfirm,
                        icon: const Icon(Icons.check, size: 16),
                        label: const Text('Looks right'),
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        ),
                      ),
                    OutlinedButton(
                      onPressed: onReject,
                      child: Text(confirmed ? 'Change' : 'Not this one'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Success extends StatelessWidget {
  final MediaRequest request;

  const _Success({required this.request});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 28, 16, 20),
      children: [
        Center(
          child: Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.live),
            ),
            child: const Icon(Icons.check, color: AppColors.live, size: 26),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          '${request.title} is on the board',
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.foreground, fontSize: 16, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Text(
              'Status: ${request.status.label}. Everyone can see it and add their vote, and you can '
              'follow it in My requests.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5),
            ),
          ),
        ),
        const SizedBox(height: 22),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(left: BorderSide(color: AppColors.accent, width: 3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'WHAT HAPPENS NEXT',
                style: TextStyle(
                  color: AppColors.accent,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                "New → Planned → Sourcing → Added. If it can't be found you'll get a reason, not silence.",
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.5),
              ),
              const SizedBox(height: 12),
              RequestStatusTimeline(request.status),
            ],
          ),
        ),
      ],
    );
  }
}

class _InlineWarn extends StatelessWidget {
  final IconData icon;
  final Widget child;

  const _InlineWarn({required this.icon, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.amber.withValues(alpha: 0.1),
        border: Border.all(color: AppColors.amber.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: AppColors.amber),
          const SizedBox(width: 8),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _FieldError extends StatelessWidget {
  final String message;
  const _FieldError(this.message);

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.error_outline, size: 14, color: AppColors.danger),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: const TextStyle(color: AppColors.danger, fontSize: 11.5, fontWeight: FontWeight.w600, height: 1.4),
          ),
        ),
      ],
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.dangerSoft,
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.danger),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.foreground, fontSize: 12.5, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}
