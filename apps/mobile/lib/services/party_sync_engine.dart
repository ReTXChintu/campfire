import 'dart:math' as math;

/// The pure decision-making behind watch-party sync, with no Flutter, player or network in it, so
/// every rule here is unit-tested (test/party_sync_engine_test.dart) against simulated devices
/// with latency, clock skew and buffering instead of being discovered in a live party.
///
/// The model: one device is the party's **leader** (the host's main screen, or whoever holds
/// control when the host is away). Its playback is the truth. It announces a [PartyPlaybackState]
/// whenever someone acts (play, pause, seek, speed, track, episode) and as a heartbeat every few
/// seconds. Every other device continuously steers its own player toward where that state says
/// the video should be *right now* — small drift is absorbed by nudging the playback rate (no
/// visible jump), large drift by one seek, and a seek is led by how long this device's seeks have
/// actually been taking, so a slow stream doesn't land permanently behind.
///
/// "Right now" is always measured on the **server's clock** ([ServerClock]), never the device's
/// own: two phones' clocks routinely disagree by a second or more, which used to translate
/// directly into a second or more of offset between them.

/// A track pick in a form every device can resolve against the same file. libmpv assigns track
/// ids deterministically per file, so [id] is tried first; [language]/[title] are the fallback.
/// For subtitles, [source] is "off", "external" (an uploaded VTT set — [index] into the video's
/// own subtitle list) or "embedded".
class PartyTrackChoice {
  final String? source;
  final String? id;
  final int? index;
  final String? language;
  final String? title;

  const PartyTrackChoice({this.source, this.id, this.index, this.language, this.title});

  static const off = PartyTrackChoice(source: 'off');

  static PartyTrackChoice? fromJson(Object? json) {
    if (json is! Map) return null;
    String? str(Object? v) => v is String ? v : null;
    return PartyTrackChoice(
      source: str(json['source']),
      id: str(json['id']),
      index: json['index'] is int ? json['index'] as int : null,
      language: str(json['language']),
      title: str(json['title']),
    );
  }

  Map<String, dynamic> toJson() => {
        'source': source,
        'id': id,
        'index': index,
        'language': language,
        'title': title,
      };

  @override
  bool operator ==(Object other) =>
      other is PartyTrackChoice &&
      other.source == source &&
      other.id == id &&
      other.index == index &&
      other.language == language &&
      other.title == title;

  @override
  int get hashCode => Object.hash(source, id, index, language, title);

  @override
  String toString() => 'Track($source,$id,$index,$language,$title)';
}

enum PartyStateKind {
  /// Someone did something — everyone snaps to it.
  action,

  /// The leader's periodic "this is where I am" — followers steer toward it gently.
  heartbeat,

  /// The server's stored state, read on join — treated like an action.
  snapshot,
}

/// Where the party's video is: [positionSeconds] at server time [serverTimeMs], advancing at
/// [playbackRate] while [playing].
class PartyPlaybackState {
  final PartyStateKind kind;
  final bool playing;
  final double positionSeconds;
  final double playbackRate;
  final int serverTimeMs;
  final String? fileId;
  final PartyTrackChoice? audio;
  final PartyTrackChoice? subtitle;
  final String? senderIdentity;

  const PartyPlaybackState({
    required this.kind,
    required this.playing,
    required this.positionSeconds,
    required this.playbackRate,
    required this.serverTimeMs,
    this.fileId,
    this.audio,
    this.subtitle,
    this.senderIdentity,
  });

  /// Where the video should be at server time [serverNowMs].
  double positionAt(int serverNowMs) {
    if (!playing) return positionSeconds;
    final elapsed = (serverNowMs - serverTimeMs) / 1000;
    // A state can't be from the future; clamp so a bad clock estimate never runs it backwards.
    return positionSeconds + math.max(0, elapsed) * playbackRate;
  }

  PartyPlaybackState copyWith({PartyStateKind? kind, String? senderIdentity}) => PartyPlaybackState(
        kind: kind ?? this.kind,
        playing: playing,
        positionSeconds: positionSeconds,
        playbackRate: playbackRate,
        serverTimeMs: serverTimeMs,
        fileId: fileId,
        audio: audio,
        subtitle: subtitle,
        senderIdentity: senderIdentity ?? this.senderIdentity,
      );

  /// The `watch-party-sync` data-channel payload. `type`/`playing`/`positionSeconds`/
  /// `playbackRate`/`updatedAt` are the fields older clients already parse, kept as-is; the rest
  /// are additions they ignore.
  Map<String, dynamic> toJson() => {
        'type': 'sync-state',
        'kind': kind.name,
        'playing': playing,
        'positionSeconds': positionSeconds,
        'playbackRate': playbackRate,
        'updatedAt': DateTime.fromMillisecondsSinceEpoch(serverTimeMs, isUtc: true).toIso8601String(),
        'serverTimeMs': serverTimeMs,
        'fileId': fileId,
        'audioTrack': audio?.toJson(),
        'subtitleTrack': subtitle?.toJson(),
      };

  /// Parses a data-channel payload. A sender too old to include `serverTimeMs` is timed by
  /// arrival instead ([receivedAtServerMs]) — only off by one network hop, far better than
  /// trusting its clock.
  static PartyPlaybackState? tryParse(Object? value, {required int receivedAtServerMs, String? senderIdentity}) {
    if (value is! Map ||
        value['type'] != 'sync-state' ||
        value['playing'] is! bool ||
        value['positionSeconds'] is! num ||
        value['playbackRate'] is! num) {
      return null;
    }
    final kind = switch (value['kind']) {
      'heartbeat' => PartyStateKind.heartbeat,
      'snapshot' => PartyStateKind.snapshot,
      _ => PartyStateKind.action,
    };
    final rate = (value['playbackRate'] as num).toDouble();
    final position = (value['positionSeconds'] as num).toDouble();
    if (!position.isFinite || !(rate > 0 && rate <= 4)) return null;
    return PartyPlaybackState(
      kind: kind,
      playing: value['playing'] as bool,
      positionSeconds: math.max(0, position),
      playbackRate: rate,
      serverTimeMs: value['serverTimeMs'] is num ? (value['serverTimeMs'] as num).round() : receivedAtServerMs,
      fileId: value['fileId'] is String ? value['fileId'] as String : null,
      audio: PartyTrackChoice.fromJson(value['audioTrack']),
      subtitle: PartyTrackChoice.fromJson(value['subtitleTrack']),
      senderIdentity: senderIdentity,
    );
  }
}

/// An NTP-style estimate of `serverClock - localClock`. Each sample is one request to
/// `GET /api/watch-parties/time`: the reply is assumed to have been stamped halfway through the
/// round trip, so the error of a sample is at most half its RTT — which is why the lowest-RTT
/// sample of a recent window wins rather than an average that a single slow reply would skew.
class ServerClock {
  final int Function() _localNowMs;
  final List<({int offsetMs, int rttMs, int atLocalMs})> _samples = [];
  int? _offsetMs;

  ServerClock({int Function()? localNowMs})
      : _localNowMs = localNowMs ?? (() => DateTime.now().millisecondsSinceEpoch);

  bool get isSynced => _offsetMs != null;

  /// Best current estimate of server minus local, 0 until the first sample.
  int get offsetMs => _offsetMs ?? 0;

  int nowServerMs() => _localNowMs() + offsetMs;

  int localNowMs() => _localNowMs();

  /// Records one round trip: [sentLocalMs] just before the request, [receivedLocalMs] just after
  /// the reply carrying [serverTimeMs].
  void addSample({required int sentLocalMs, required int receivedLocalMs, required int serverTimeMs}) {
    final rtt = receivedLocalMs - sentLocalMs;
    if (rtt < 0 || rtt > 10000) return; // nonsense or useless
    final midpoint = sentLocalMs + rtt ~/ 2;
    _samples.add((offsetMs: serverTimeMs - midpoint, rttMs: rtt, atLocalMs: receivedLocalMs));
    // A 10-minute window: long enough to keep a lucky fast sample, short enough to follow the
    // device clock if it gets corrected underneath us.
    _samples.removeWhere((s) => receivedLocalMs - s.atLocalMs > 600000);
    if (_samples.length > 20) _samples.removeAt(0);
    final best = _samples.reduce((a, b) => a.rttMs <= b.rttMs ? a : b);
    _offsetMs = best.offsetMs;
  }
}

/// What a follower's player should do this instant. Null fields mean "leave it alone".
class SyncCorrection {
  final double? seekToSeconds;
  final bool? setPlaying;
  final double? rate;

  const SyncCorrection({this.seekToSeconds, this.setPlaying, this.rate});

  static const none = SyncCorrection();

  bool get isNone => seekToSeconds == null && setPlaying == null && rate == null;

  @override
  String toString() => 'SyncCorrection(seek: $seekToSeconds, play: $setPlaying, rate: $rate)';
}

/// How in-sync this device is, for the roster's per-person pill.
enum SyncHealth { synced, catchingUp, buffering, paused, independent }

class PartySyncEngine {
  /// Beyond this, drift is fixed with one seek rather than a rate nudge.
  static const hardDriftSeconds = 2.5;

  /// After an explicit action, anything beyond this is fixed immediately with a seek.
  static const actionToleranceSeconds = 0.4;

  /// Below this, drift is noise (frame timing, position-report granularity) — run at true speed.
  static const settledDriftSeconds = 0.12;

  /// A nudge starts only past this, so the rate isn't flapping around the settled band.
  static const nudgeStartSeconds = 0.25;

  /// The most the rate is ever bent while catching up: ±8% is inaudible with mpv's pitch
  /// correction and still closes a full second of drift in ~12s.
  static const maxRateNudge = 0.08;

  /// How strongly drift turns into rate: 1s of drift → 8%.
  static const nudgeGain = 0.08;

  /// After a seek, don't judge drift again until playback has settled (or this much time passes),
  /// otherwise the position that hasn't caught up with the seek yet triggers another seek.
  static const seekSettleMs = 4000;

  /// A heartbeat sampled this soon after the last action may predate it (the leader hadn't heard
  /// the action yet) and must not drag everyone back to where they were.
  static const staleHeartbeatGraceMs = 1500;

  int? _lastSeekAtServerMs;
  int _lastActionServerMs = 0;
  bool _nudging = false;

  /// One corrective seek is allowed after each seek: the first seek on a slow stream lands behind
  /// by however long it took to rebuffer, but it also *measures* that time ([seekLeadSeconds]), so
  /// a second, better-aimed seek gets it level in seconds instead of a long rate-nudge crawl. Only
  /// one, so a stream that is simply unpredictable can't start a seek storm.
  bool _reaimAvailable = false;

  /// Past this after a seek has resumed, the one re-aim fires.
  static const reaimDriftSeconds = 0.8;

  /// Smoothed seconds a seek on this device takes to be playing again — a seek aims this far
  /// ahead so the player comes out of its rebuffer level with everyone instead of behind them.
  double seekLeadSeconds = 0;

  /// Whether to accept [state] at all, given what has already been applied. Actions and snapshots
  /// always win over older heartbeats; a heartbeat that might predate the newest action is dropped.
  bool accept(PartyPlaybackState state) {
    if (state.kind == PartyStateKind.heartbeat) {
      return state.serverTimeMs >= _lastActionServerMs + staleHeartbeatGraceMs;
    }
    if (state.serverTimeMs + 50 < _lastActionServerMs) return false; // an action older than one applied
    _lastActionServerMs = math.max(_lastActionServerMs, state.serverTimeMs);
    return true;
  }

  /// Measured from "seek issued" to "playing again after it" — feeds [seekLeadSeconds].
  void recordSeekLatency(double seconds) {
    if (!seconds.isFinite || seconds < 0) return;
    final clamped = math.min(seconds, 3.0);
    seekLeadSeconds = seekLeadSeconds == 0 ? clamped * 0.8 : seekLeadSeconds * 0.6 + clamped * 0.4;
  }

  /// The core rule. [explicit] is true when [target] just arrived as an action/snapshot (snap to
  /// it), false on the periodic re-evaluation between heartbeats (steer gently).
  SyncCorrection decide({
    required PartyPlaybackState target,
    required int serverNowMs,
    required double localPositionSeconds,
    required bool localPlaying,
    required bool localBuffering,
    required double currentRate,
    required bool explicit,
    double? durationSeconds,
  }) {
    var expected = target.positionAt(serverNowMs);
    if (durationSeconds != null && durationSeconds > 0) expected = math.min(expected, durationSeconds);
    final drift = localPositionSeconds - expected; // > 0: ahead of the party
    final baseRate = target.playbackRate;

    final setPlaying = localPlaying == target.playing ? null : target.playing;

    // Paused party: just be on the same frame. No rate games while paused.
    if (!target.playing) {
      _nudging = false;
      final needSeek = drift.abs() > (explicit ? 0.15 : actionToleranceSeconds);
      return SyncCorrection(
        seekToSeconds: needSeek ? expected : null,
        setPlaying: setPlaying,
        rate: currentRate != baseRate ? baseRate : null,
      );
    }

    final recentlySeeked =
        _lastSeekAtServerMs != null && serverNowMs - _lastSeekAtServerMs! < seekSettleMs;

    // Still loading after a seek or a stall: a judgement now would be about a position that is
    // about to change. Keep the play state right, change nothing else.
    if (localBuffering && !explicit) {
      return SyncCorrection(setPlaying: setPlaying);
    }

    // The re-aim: the previous seek has resumed playing, and it measurably missed.
    var reaim = false;
    if (!explicit && _reaimAvailable && !localBuffering && _lastSeekAtServerMs != null &&
        serverNowMs - _lastSeekAtServerMs! > 1000) {
      _reaimAvailable = false;
      reaim = drift.abs() > reaimDriftSeconds;
    }

    final threshold = explicit ? actionToleranceSeconds : hardDriftSeconds;
    if (reaim || (drift.abs() > threshold && (explicit || !recentlySeeked))) {
      _lastSeekAtServerMs = serverNowMs;
      _reaimAvailable = !reaim;
      _nudging = false;
      var aim = expected + seekLeadSeconds * baseRate;
      if (durationSeconds != null && durationSeconds > 0) aim = math.min(aim, durationSeconds);
      return SyncCorrection(
        seekToSeconds: aim,
        setPlaying: setPlaying,
        rate: currentRate != baseRate ? baseRate : null,
      );
    }

    // Within reach: bend the rate toward the party, and straighten it once close enough. The
    // hysteresis (start past nudgeStart, stop inside settled) keeps it from flapping.
    double desiredRate = baseRate;
    if (drift.abs() > nudgeStartSeconds || (_nudging && drift.abs() > settledDriftSeconds)) {
      _nudging = true;
      final nudge = (-drift * nudgeGain).clamp(-maxRateNudge, maxRateNudge);
      desiredRate = baseRate * (1 + nudge);
    } else {
      _nudging = false;
    }
    final rateChange = (desiredRate - currentRate).abs() > 0.004 ? desiredRate : null;
    return SyncCorrection(setPlaying: setPlaying, rate: rateChange);
  }

  /// For the roster pill.
  SyncHealth health({
    required PartyPlaybackState? target,
    required int serverNowMs,
    required double localPositionSeconds,
    required bool localBuffering,
    required bool following,
  }) {
    if (!following) return SyncHealth.independent;
    if (localBuffering) return SyncHealth.buffering;
    if (target == null) return SyncHealth.synced;
    if (!target.playing) return SyncHealth.paused;
    final drift = (localPositionSeconds - target.positionAt(serverNowMs)).abs();
    return drift <= 0.75 ? SyncHealth.synced : SyncHealth.catchingUp;
  }
}
