package com.example.runovaandroid

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.*
import android.webkit.*
import androidx.activity.ComponentActivity

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ---- HARD PORTRAIT LOCK ----
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT

        // ---- NEVER SLEEP ----
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // ---- FULL IMMERSIVE ----
        hideSystemUI()

        // ---- KIOSK ----
        enforceKiosk()

        // ---- REQUEST CAMERA PERMISSION ----
        if (checkSelfPermission(Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {

            requestPermissions(
                arrayOf(Manifest.permission.CAMERA),
                1001
            )
        }

        // ---- WEBVIEW ----
        webView = WebView(this)
        webView.isFocusable = false
        webView.isFocusableInTouchMode = false

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = WebViewClient()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true

            // HARD NO ZOOM
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = false
            loadWithOverviewMode = false
            textZoom = 100

            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.loadUrl("https://runova-mirror-production.up.railway.app")
        setContentView(webView)
    }

    // ---- KILL ALL TOUCH / GESTURES ----
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // block multitouch
        if (event.pointerCount > 1) return true
        return super.dispatchTouchEvent(event)
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        enforceKiosk()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUI()
            enforceKiosk()
        }
    }

    private fun hideSystemUI() {
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_FULLSCREEN
    }

    private fun enforceKiosk() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, MyDeviceAdminReceiver::class.java)

        if (dpm.isDeviceOwnerApp(packageName)) {
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
            dpm.setStatusBarDisabled(admin, true)
        }

        if (dpm.isLockTaskPermitted(packageName)) {
            try {
                startLockTask()
            } catch (_: Exception) {}
        }
    }
}
