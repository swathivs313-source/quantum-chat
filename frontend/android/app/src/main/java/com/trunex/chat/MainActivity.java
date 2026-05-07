package com.trunex.chat;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;
import android.Manifest;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // This is the magical line that blacks out the app in Recent Apps/Task View
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        // Override WebChromeClient to handle getUserMedia permission requests
        WebView webView = getBridge().getWebView();
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                String[] resources = request.getResources();
                boolean needsAudio = false;
                boolean needsVideo = false;

                for (String resource : resources) {
                    if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        needsAudio = true;
                    }
                    if (resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        needsVideo = true;
                    }
                }

                // Check if Android runtime permissions are granted
                boolean audioGranted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                boolean videoGranted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;

                if ((needsAudio && !audioGranted) || (needsVideo && !videoGranted)) {
                    // Store pending request and ask for runtime permissions
                    pendingPermissionRequest = request;
                    java.util.ArrayList<String> permissionsNeeded = new java.util.ArrayList<>();
                    if (needsAudio && !audioGranted) permissionsNeeded.add(Manifest.permission.RECORD_AUDIO);
                    if (needsVideo && !videoGranted) permissionsNeeded.add(Manifest.permission.CAMERA);
                    ActivityCompat.requestPermissions(MainActivity.this,
                            permissionsNeeded.toArray(new String[0]),
                            PERMISSION_REQUEST_CODE);
                } else {
                    // Runtime permissions already granted, grant the WebView request
                    request.grant(resources);
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && pendingPermissionRequest != null) {
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
    }
}
