package com.remotecodex.android

object AndroidFeatureFlags {
    // Terminal access is policy-gated and intentionally disabled for Android.
    const val ShellEnabled = false

    // Temporary migration escape hatch: production and default debug builds use the shared
    // WebView thread UI. Enable only with
    // `-PremoteCodex.nativeThreadFallback=true` while debugging Android-native parity gaps.
    val NativeThreadDetailFallbackEnabled =
        BuildConfig.REMOTE_CODEX_NATIVE_THREAD_DETAIL_FALLBACK
}
