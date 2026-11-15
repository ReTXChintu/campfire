import 'dart:math' as math;

import 'package:campfire_mobile/services/party_sync_engine.dart';
import 'package:flutter_test/flutter_test.dart';

/// Simulated watch party: one leader and several followers on a shared virtual timeline, with the
/// things that broke the real one — device clocks seconds apart, network latency and jitter,
/// streams that take seconds to resume after a seek, and mid-playback stalls. Every follower runs
/// the real [PartySyncEngine] and [ServerClock]; only the players and the network are fake.

/// A player with the timing behaviour that matters: playback advances at [rate] while playing and
/// not buffering, and a seek or stall leaves it buffering for a while.
class SimPlayer {
  double position;
  bool playing;
  double rate = 1;
  bool buffering = false;
  int _bufferUntil = 0;
  int? _seekIssuedAt;
  final double seekLatencySeconds;
  int seeks = 0;
  void Function(double seconds)? onSeekResumed;

  SimPlayer({this.position = 0, this.playing = true, this.seekLatencySeconds = 0.3});

  void tick(int nowMs, int dtMs) {
    if (buffering && nowMs >= _bufferUntil) {
      buffering = false;
      if (_seekIssuedAt != null) {
        onSeekResumed?.call((nowMs - _seekIssuedAt!) / 1000);
        _seekIssuedAt = null;
      }
    }
    if (playing && !buffering) position += dtMs / 1000 * rate;
  }

  void seek(double to, int nowMs) {
    seeks++;
    position = to;
    buffering = true;
    _bufferUntil = nowMs + (seekLatencySeconds * 1000).round();
    _seekIssuedAt = nowMs;
  }

  void stall(int nowMs, int forMs) {
    buffering = true;
    _bufferUntil = nowMs + forMs;
  }
}

class SimFollower {
  final String name;
  final int clockSkewMs;
  final SimPlayer player;
  final engine = PartySyncEngine();
  late final ServerClock clock;
  PartyPlaybackState? target;
  int _trueNow = 0;

  SimFollower(this.name, {required this.clockSkewMs, double seekLatency = 0.3, double startAt = 0})
      : player = SimPlayer(position: startAt, playing: false, seekLatencySeconds: seekLatency) {
    clock = ServerClock(localNowMs: () => _trueNow + clockSkewMs);
    player.onSeekResumed = engine.recordSeekLatency;
  }

  void setNow(int trueNowMs) => _trueNow = trueNowMs;

  void apply(SyncCorrection c, int nowMs) {
    if (c.rate != null) player.rate = c.rate!;
    if (c.seekToSeconds != null) player.seek(c.seekToSeconds!, nowMs);
    if (c.setPlaying != null) player.playing = c.setPlaying!;
  }

  void receive(PartyPlaybackState state, int nowMs) {
    if (!engine.accept(state)) return;
    target = state;
    apply(
      engine.decide(
        target: state,
        serverNowMs: clock.nowServerMs(),
        localPositionSeconds: player.position,
        localPlaying: player.playing,
        localBuffering: player.buffering,
        currentRate: player.rate,
        explicit: state.kind != PartyStateKind.heartbeat,
      ),
      nowMs,
    );
  }

  void evaluate(int nowMs) {
    final t = target;
    if (t == null) return;
    apply(
      engine.decide(
        target: t,
        serverNowMs: clock.nowServerMs(),
        localPositionSeconds: player.position,
        localPlaying: player.playing,
        localBuffering: player.buffering,
        currentRate: player.rate,
        explicit: false,
      ),
      nowMs,
    );
  }
}

/// The whole party on one virtual clock (true time == server time).
class SimParty {
  int now = 0;
  final rng = math.Random(7);
  final SimPlayer leader;
  final int leaderSkewMs;
  late final ServerClock leaderClock;
  final List<SimFollower> followers;
  final List<({int at, SimFollower to, PartyPlaybackState state})> _inFlight = [];
  final int minLatencyMs;
  final int maxLatencyMs;

  SimParty({
    required this.followers,
    this.leaderSkewMs = 0,
    double leaderStart = 0,
    this.minLatencyMs = 40,
    this.maxLatencyMs = 250,
  }) : leader = SimPlayer(position: leaderStart) {
    leaderClock = ServerClock(localNowMs: () => now + leaderSkewMs);
  }

  int latency() => minLatencyMs + rng.nextInt(maxLatencyMs - minLatencyMs + 1);

  /// NTP-ish sampling against the "server" for every device, as the overlay does on connect.
  void syncClocks() {
    void sample(ServerClock c, int skew) {
      for (var i = 0; i < 5; i++) {
        final up = latency(), down = latency();
        final sent = now + skew;
        final serverStamp = now + up;
        c.addSample(sentLocalMs: sent, receivedLocalMs: now + up + down + skew, serverTimeMs: serverStamp);
      }
    }

    sample(leaderClock, leaderSkewMs);
    for (final f in followers) {
      f.setNow(now);
      sample(f.clock, f.clockSkewMs);
    }
  }

  PartyPlaybackState leaderState(PartyStateKind kind) => PartyPlaybackState(
        kind: kind,
        playing: leader.playing,
        positionSeconds: leader.position,
        playbackRate: leader.rate,
        serverTimeMs: leaderClock.nowServerMs(),
      );

  void broadcast(PartyStateKind kind) {
    final state = leaderState(kind);
    for (final f in followers) {
      _inFlight.add((at: now + latency(), to: f, state: state));
    }
  }

  /// Advances [ms] in 50ms steps: players tick, messages land, the leader heartbeats every 3s and
  /// each follower re-evaluates every 500ms — the same cadences the app uses.
  void run(int ms) {
    final end = now + ms;
    while (now < end) {
      now += 50;
      leader.tick(now, 50);
      for (final f in followers) {
        f.setNow(now);
        f.player.tick(now, 50);
      }
      final due = _inFlight.where((m) => m.at <= now).toList();
      _inFlight.removeWhere((m) => m.at <= now);
      for (final m in due) {
        m.to.receive(m.state, now);
      }
      if (now % 3000 == 0) broadcast(PartyStateKind.heartbeat);
      if (now % 500 == 0) {
        for (final f in followers) {
          f.evaluate(now);
        }
      }
    }
  }

  double drift(SimFollower f) => f.player.position - leader.position;
  double worstDrift() => followers.map((f) => drift(f).abs()).reduce(math.max);
}

void main() {
  group('ServerClock', () {
    test('estimates a 4.2s-fast device clock to within half the best round trip', () {
      var trueNow = 1000000;
      final clock = ServerClock(localNowMs: () => trueNow + 4200);
      final rng = math.Random(1);
      for (var i = 0; i < 6; i++) {
        final up = 20 + rng.nextInt(200), down = 20 + rng.nextInt(200);
        clock.addSample(
          sentLocalMs: trueNow + 4200,
          receivedLocalMs: trueNow + up + down + 4200,
          serverTimeMs: trueNow + up,
        );
        trueNow += 1000;
      }
      expect((clock.nowServerMs() - trueNow).abs(), lessThan(120));
    });

    test('ignores impossible samples', () {
      final clock = ServerClock(localNowMs: () => 0);
      clock.addSample(sentLocalMs: 100, receivedLocalMs: 50, serverTimeMs: 999);
      expect(clock.isSynced, isFalse);
    });
  });

  group('wire format', () {
    test('round-trips, including tracks and episode', () {
      const state = PartyPlaybackState(
        kind: PartyStateKind.action,
        playing: true,
        positionSeconds: 61.5,
        playbackRate: 1.25,
        serverTimeMs: 1700000000000,
        fileId: 'ep2',
        audio: PartyTrackChoice(id: '2', language: 'hin', title: 'Hindi DD5.1'),
        subtitle: PartyTrackChoice(source: 'external', index: 0, language: 'en'),
      );
      final parsed = PartyPlaybackState.tryParse(state.toJson(), receivedAtServerMs: 0)!;
      expect(parsed.kind, PartyStateKind.action);
      expect(parsed.positionSeconds, 61.5);
      expect(parsed.playbackRate, 1.25);
      expect(parsed.serverTimeMs, 1700000000000);
      expect(parsed.fileId, 'ep2');
      expect(parsed.audio, state.audio);
      expect(parsed.subtitle, state.subtitle);
    });

    test('keeps the fields an older client parses', () {
      final json = const PartyPlaybackState(
        kind: PartyStateKind.heartbeat,
        playing: false,
        positionSeconds: 3,
        playbackRate: 1,
        serverTimeMs: 0,
      ).toJson();
      expect(json['type'], 'sync-state');
      expect(json['updatedAt'], isA<String>());
      expect(json['playing'], isFalse);
    });

    test('an old sender without serverTimeMs is timed by arrival, not its own clock', () {
      final parsed = PartyPlaybackState.tryParse({
        'type': 'sync-state',
        'playing': true,
        'positionSeconds': 10,
        'playbackRate': 1,
        'updatedAt': '1999-01-01T00:00:00Z',
      }, receivedAtServerMs: 5000)!;
      expect(parsed.serverTimeMs, 5000);
      expect(parsed.kind, PartyStateKind.action);
    });

    test('rejects junk', () {
      expect(PartyPlaybackState.tryParse({'type': 'reaction'}, receivedAtServerMs: 0), isNull);
      expect(
        PartyPlaybackState.tryParse(
          {'type': 'sync-state', 'playing': true, 'positionSeconds': 1, 'playbackRate': 0},
          receivedAtServerMs: 0,
        ),
        isNull,
      );
    });
  });

  group('simulated party', () {
    SimParty party({double slowSeek = 2.0}) => SimParty(
          leaderSkewMs: -1800,
          leaderStart: 600,
          followers: [
            SimFollower('fast clock', clockSkewMs: 5000, startAt: 0),
            SimFollower('slow clock', clockSkewMs: -3500, startAt: 1200),
            SimFollower('slow stream', clockSkewMs: 700, seekLatency: slowSeek, startAt: 30),
          ],
        );

    test('joiners land on the leader within half a second despite skewed clocks', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(8000);
      expect(p.worstDrift(), lessThan(0.5), reason: 'drifts: ${p.followers.map(p.drift).toList()}');
      for (final f in p.followers) {
        expect(f.player.playing, isTrue);
      }
    });

    test('a pause stops everyone on the same frame', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(8000);
      p.leader.playing = false;
      p.broadcast(PartyStateKind.action);
      p.run(3000);
      for (final f in p.followers) {
        expect(f.player.playing, isFalse, reason: f.name);
      }
      expect(p.worstDrift(), lessThan(0.2));
    });

    test('a seek is followed quickly, even on a stream that takes 2s to resume', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(10000);
      p.leader.position = 3000;
      p.broadcast(PartyStateKind.action);
      p.run(6000);
      expect(p.worstDrift(), lessThan(0.6), reason: 'drifts: ${p.followers.map(p.drift).toList()}');
    });

    test('the slow stream learns its seek latency and stops landing behind', () {
      final p = party(slowSeek: 2.0)..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(10000);
      for (var i = 0; i < 3; i++) {
        p.leader.position += 600;
        p.broadcast(PartyStateKind.action);
        p.run(8000);
      }
      final slow = p.followers.last;
      expect(slow.engine.seekLeadSeconds, greaterThan(1.2));
      expect(p.drift(slow).abs(), lessThan(0.4));
    });

    test('a 6s stall is recovered without a seek storm', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(10000);
      final victim = p.followers.first;
      final seeksBefore = victim.player.seeks;
      victim.player.stall(p.now, 6000);
      p.run(20000);
      expect(p.drift(victim).abs(), lessThan(0.4));
      expect(victim.player.seeks - seeksBefore, lessThanOrEqualTo(2));
    });

    test('small drift is absorbed by rate, without any seek', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(10000);
      final f = p.followers[1];
      final seeksBefore = f.player.seeks;
      f.player.position += 1.2; // e.g. a decoder that ran fast for a while
      p.run(30000);
      expect(f.player.seeks, seeksBefore, reason: 'should nudge, not jump');
      expect(p.drift(f).abs(), lessThan(0.2));
      expect(f.player.rate, 1.0, reason: 'back to true speed once caught up');
    });

    test('stays locked over a long session', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      var worst = 0.0;
      p.run(10000);
      for (var minute = 0; minute < 20; minute++) {
        p.run(60000);
        worst = math.max(worst, p.worstDrift());
      }
      expect(worst, lessThan(0.35));
    });

    test('speed changes carry over', () {
      final p = party()..syncClocks();
      p.broadcast(PartyStateKind.snapshot);
      p.run(8000);
      p.leader.rate = 1.5;
      p.broadcast(PartyStateKind.action);
      p.run(15000);
      expect(p.worstDrift(), lessThan(0.4));
      for (final f in p.followers) {
        expect(f.player.rate, closeTo(1.5, 0.13));
      }
    });
  });

  group('ordering', () {
    test('a heartbeat sampled before the latest action is dropped', () {
      final engine = PartySyncEngine();
      const action = PartyPlaybackState(
        kind: PartyStateKind.action,
        playing: true,
        positionSeconds: 500,
        playbackRate: 1,
        serverTimeMs: 10000,
      );
      expect(engine.accept(action), isTrue);
      const staleBeat = PartyPlaybackState(
        kind: PartyStateKind.heartbeat,
        playing: true,
        positionSeconds: 20,
        playbackRate: 1,
        serverTimeMs: 10300,
      );
      expect(engine.accept(staleBeat), isFalse);
      const freshBeat = PartyPlaybackState(
        kind: PartyStateKind.heartbeat,
        playing: true,
        positionSeconds: 503,
        playbackRate: 1,
        serverTimeMs: 13000,
      );
      expect(engine.accept(freshBeat), isTrue);
    });

    test('an action older than one already applied is dropped', () {
      final engine = PartySyncEngine();
      expect(
        engine.accept(const PartyPlaybackState(
          kind: PartyStateKind.action,
          playing: false,
          positionSeconds: 9,
          playbackRate: 1,
          serverTimeMs: 5000,
        )),
        isTrue,
      );
      expect(
        engine.accept(const PartyPlaybackState(
          kind: PartyStateKind.action,
          playing: true,
          positionSeconds: 1,
          playbackRate: 1,
          serverTimeMs: 4000,
        )),
        isFalse,
      );
    });
  });
}
