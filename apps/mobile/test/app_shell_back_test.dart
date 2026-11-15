import 'package:campfire_mobile/widgets/app_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// The Android back button, end to end through Flutter's real system-back path
/// (`WidgetsBinding.handlePopRoute`, which is what the platform's back event calls): the shell must
/// walk back through the destinations you visited, pop pushed screens first, and only let the app
/// close after a second press on Home. Before, every back press from any tab closed the app.
void main() {
  late GoRouter router;

  Widget page(String name) => Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('page:$name'),
              Builder(
                builder: (context) => TextButton(
                  onPressed: () => context.push('/detail'),
                  child: Text('open-detail-$name'),
                ),
              ),
            ],
          ),
        ),
      );

  setUp(() {
    router = GoRouter(
      initialLocation: '/',
      routes: [
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => AppShell(navigationShell: shell),
          branches: [
            StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => page('home'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/search', builder: (_, _) => page('search'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/discover', builder: (_, _) => page('discover'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/requests', builder: (_, _) => page('requests'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (_, _) => page('profile'))]),
          ],
        ),
        GoRoute(path: '/detail', builder: (_, _) => const Scaffold(body: Text('page:detail'))),
      ],
    );
  });

  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400 * 3, 860 * 3); // a phone: bottom navigation
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
  }

  /// Presses system back; returns whether Flutter handled it (false = the app would close).
  Future<bool> back(WidgetTester tester) async {
    final handled = await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    return handled;
  }

  bool showing(String name) => find.text('page:$name').hitTestable().evaluate().isNotEmpty;

  testWidgets('back walks back through visited tabs, then home', (tester) async {
    await pump(tester);
    await tester.tap(find.text('Search'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discover'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Requests'));
    await tester.pumpAndSettle();
    expect(showing('requests'), isTrue);

    expect(await back(tester), isTrue);
    expect(showing('discover'), isTrue);
    expect(await back(tester), isTrue);
    expect(showing('search'), isTrue);
    expect(await back(tester), isTrue);
    expect(showing('home'), isTrue);
  });

  testWidgets('a tab reached by go() from inside a screen still goes back', (tester) async {
    await pump(tester);
    router.go('/discover?type=movies'); // what a rail's "See all" does
    await tester.pumpAndSettle();
    expect(showing('discover'), isTrue);
    expect(await back(tester), isTrue);
    expect(showing('home'), isTrue);
  });

  testWidgets('a pushed screen pops first, back to the tab it was opened from', (tester) async {
    await pump(tester);
    await tester.tap(find.text('Discover'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('open-detail-discover'));
    await tester.pumpAndSettle();
    expect(find.text('page:detail'), findsOneWidget);

    expect(await back(tester), isTrue);
    expect(showing('discover'), isTrue);
    expect(await back(tester), isTrue);
    expect(showing('home'), isTrue);
  });

  testWidgets('on Home, the first back asks, it does not exit', (tester) async {
    await pump(tester);
    expect(await back(tester), isTrue, reason: 'must be handled — unhandled means the app closes');
    expect(find.text('Press back again to exit'), findsOneWidget);
    expect(showing('home'), isTrue);
  });
}
