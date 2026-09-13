package io.iboon.campfire_mobile

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// Extends AudioServiceActivity (not plain FlutterActivity) so the audio_service plugin's
// background MediaSession service shares this activity's FlutterEngine — required by the plugin
// whenever the app uses a custom activity, see lib/services/media_session_service.dart.
class MainActivity : AudioServiceActivity() {
    private var pipAutoEnterEnabled = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Picture-in-Picture — see lib/services/pip_service.dart. A minimal hand-written channel
        // rather than a third-party PiP plugin, calling Android's real API directly.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "campfire/pip").setMethodCallHandler { call, result ->
            when (call.method) {
                "enterPip" -> {
                    enterPipNow()
                    result.success(null)
                }
                "setAutoEnterEnabled" -> {
                    pipAutoEnterEnabled = call.argument<Boolean>("enabled") ?: false
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun enterPipNow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val params = PictureInPictureParams.Builder()
                .setAspectRatio(Rational(16, 9))
                .build()
            enterPictureInPictureMode(params)
        }
    }

    // Fires when the user leaves the activity via the home button/recents (not on a normal
    // back-navigation or screen-off) — the standard pre-Android-12 hook for "auto-enter PiP now",
    // still honored on newer versions alongside their own setAutoEnterEnabled(PictureInPictureParams)
    // API, which isn't used here to keep this minimal.
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pipAutoEnterEnabled) {
            enterPipNow()
        }
    }
}
