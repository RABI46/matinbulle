package fr.matinbulle.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Matinbulle en APK : la maquette web est embarquée dans assets/www et servie
 * sous une origine https locale, pour que localStorage et le reste du DOM
 * fonctionnent exactement comme dans un navigateur.
 */
public class MainActivity extends Activity {

    /** Hôte fictif intercepté ; jamais résolu sur le réseau. */
    private static final String HOST = "matinbulle.local";

    private static final Map<String, String> MIMES = new HashMap<>();

    static {
        MIMES.put("html", "text/html");
        MIMES.put("js", "application/javascript");
        MIMES.put("json", "application/json");
        MIMES.put("css", "text/css");
        MIMES.put("svg", "image/svg+xml");
        MIMES.put("png", "image/png");
        MIMES.put("jpg", "image/jpeg");
        MIMES.put("webp", "image/webp");
        MIMES.put("ico", "image/x-icon");
        MIMES.put("woff2", "font/woff2");
        MIMES.put("ttf", "font/ttf");
        MIMES.put("wav", "audio/wav");
        MIMES.put("mp3", "audio/mpeg");
    }

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private Voice ttsVoice;
    private boolean ringing = false;
    private boolean askedFullScreen = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        web.setBackgroundColor(0xFF14181D);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // Les sons doux et les annonces doivent pouvoir démarrer après un geste unique.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(readAsset("www/bridge.js"), null);
                if (ringing) triggerRingJs();
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        setContentView(web);

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status != TextToSpeech.SUCCESS || tts == null) return;
                ttsVoice = bestFrenchVoice(tts);
                if (ttsVoice != null) {
                    try {
                        tts.setVoice(ttsVoice);
                    } catch (RuntimeException refused) {
                        tts.setLanguage(Locale.FRENCH);
                    }
                } else {
                    tts.setLanguage(Locale.FRENCH);
                }
                tts.setPitch(1f);
                tts.setSpeechRate(0.95f);
                ttsReady = true;
            }
        });

        web.loadUrl("https://" + HOST + "/index.html");

        handleRing(getIntent());

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        } else {
            askFullScreenPermission();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 1) askFullScreenPermission();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRing(intent);
    }

    /** Lancée par AlarmReceiver : sonnerie au-dessus du verrouillage, écran allumé. */
    private void handleRing(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(AlarmReceiver.EXTRA_RING, false)) return;
        intent.removeExtra(AlarmReceiver.EXTRA_RING);
        ringing = true;
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // La notification et le son appartiennent à RingService : la page ne
        // fait que montrer l'écran de sonnerie et acquitter le réveil.
        triggerRingJs();
    }

    /**
     * Android 14 ne réserve l'ouverture plein écran qu'aux réveils, et cette
     * permission ne se demande pas comme les autres : elle se donne dans les
     * réglages. Sans elle, le son et la notification partent quand même, mais
     * l'écran de réveil n'apparaît pas par-dessus le verrouillage.
     */
    private void askFullScreenPermission() {
        if (askedFullScreen || ringing || Build.VERSION.SDK_INT < 34) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null || nm.canUseFullScreenIntent()) return;
        askedFullScreen = true;
        new AlertDialog.Builder(this)
                .setTitle(R.string.full_screen_title)
                .setMessage(R.string.full_screen_message)
                .setPositiveButton(R.string.full_screen_open, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        openFullScreenSettings();
                    }
                })
                .setNegativeButton(R.string.full_screen_later, null)
                .show();
    }

    private void openFullScreenSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException missing) {
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getPackageName())));
            } catch (RuntimeException ignored) {
                // Aucun écran de réglage : la notification reste le recours.
            }
        }
    }

    /**
     * Voix française la plus naturelle disponible : qualité maximale, locale
     * de préférence pour que le réveil parle même sans réseau. Les voix
     * « compact » du système sont celles qui sonnent robotique.
     */
    private Voice bestFrenchVoice(TextToSpeech engine) {
        java.util.Set<Voice> voices;
        try {
            voices = engine.getVoices();
        } catch (RuntimeException missing) {
            return null;
        }
        if (voices == null) return null;
        Voice best = null;
        int bestScore = Integer.MIN_VALUE;
        for (Voice voice : voices) {
            if (voice == null || voice.getLocale() == null) continue;
            if (!"fr".equals(voice.getLocale().getLanguage())) continue;
            String name = voice.getName() == null ? "" : voice.getName().toLowerCase(Locale.ROOT);
            int score = voice.getQuality() * 10;
            if (!voice.isNetworkConnectionRequired()) score += 1001;
            if (name.contains("-frc")) score += 50;
            if (name.contains("compact")) score -= 400;
            if (score > bestScore) {
                bestScore = score;
                best = voice;
            }
        }
        return best;
    }

    private void triggerRingJs() {
        if (web == null) return;
        web.evaluateJavascript("window.matinbulleRing && window.matinbulleRing()", null);
    }

    /** Programme (ou annule, avec at <= 0) la sonnerie déléguée au système. */
    private void scheduleAlarm(long at, String wall, String sound, boolean rise) {
        AlarmReceiver.schedule(this, at, wall, sound, rise);
    }

    /** Sert un fichier de assets/www, ou une 404 locale pour tout le reste. */
    private WebResourceResponse serve(Uri uri) {
        if (uri == null || !HOST.equals(uri.getHost())) return null;

        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        String name = path.startsWith("/") ? path.substring(1) : path;
        if (name.contains("..")) return notFound();

        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        String mime = MIMES.containsKey(ext) ? MIMES.get(ext) : "application/octet-stream";

        try {
            InputStream in = getAssets().open("www/" + name);
            WebResourceResponse response = new WebResourceResponse(mime, "utf-8", in);
            if (Build.VERSION.SDK_INT >= 21) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                response.setResponseHeaders(headers);
            }
            return response;
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse(
                "text/plain",
                "utf-8",
                404,
                "Not Found",
                Collections.<String, String>emptyMap(),
                new ByteArrayInputStream("Introuvable".getBytes()));
    }

    private String readAsset(String name) {
        InputStream in = null;
        try {
            in = getAssets().open(name);
            byte[] buffer = new byte[8192];
            StringBuilder out = new StringBuilder();
            int read;
            while ((read = in.read(buffer)) > 0) out.append(new String(buffer, 0, read, "UTF-8"));
            return out.toString();
        } catch (IOException e) {
            return "";
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignored) {
                    // rien à faire
                }
            }
        }
    }

    /** Pont appelé par bridge.js (synthèse vocale du système, fr-FR). */
    private class Bridge {
        @JavascriptInterface
        public void speak(final String text, final String lang, final float rate) {
            if (text == null || text.trim().isEmpty()) return;
            web.post(new Runnable() {
                @Override
                public void run() {
                    if (!ttsReady || tts == null) return;
                    Locale locale = lang != null && lang.toLowerCase(Locale.ROOT).startsWith("fr")
                            ? Locale.FRENCH
                            : Locale.getDefault();
                    if (ttsVoice != null && "fr".equals(locale.getLanguage())) {
                        tts.setVoice(ttsVoice);
                    } else {
                        tts.setLanguage(locale);
                    }
                    tts.setPitch(1f);
                    tts.setSpeechRate(rate > 0f ? rate : 0.95f);
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "matinbulle");
                }
            });
        }

        @JavascriptInterface
        public void arm(final long at, final String wall, final String sound, final boolean rise) {
            web.post(new Runnable() {
                @Override
                public void run() {
                    scheduleAlarm(at, wall, sound, rise);
                }
            });
        }

        @JavascriptInterface
        public void disarm() {
            web.post(new Runnable() {
                @Override
                public void run() {
                    scheduleAlarm(0, null, null, false);
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            web.post(new Runnable() {
                @Override
                public void run() {
                    if (tts != null) tts.stop();
                }
            });
        }

        /**
         * Vrai : le son du réveil est tenu par RingService, la page ne joue
         * pas sa propre sonnerie. Une seule source, qui survit au balayage de
         * l'application.
         */
        @JavascriptInterface
        public boolean nativeAlarm() {
            return true;
        }

        /** Réveil acquitté : la sonnerie native s'arrête. */
        @JavascriptInterface
        public void ringDone() {
            RingService.stop(MainActivity.this);
        }

        /** État réel des permissions, du volume et du journal (écran Santé). */
        @JavascriptInterface
        public String health() {
            return Health.json(MainActivity.this);
        }

        /** Ouvre le réglage système qui corrige un contrôle en défaut. */
        @JavascriptInterface
        public void openSetting(final String kind) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = null;
                    try {
                        if ("notifications".equals(kind)) {
                            intent = Build.VERSION.SDK_INT >= 26
                                    ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                            Uri.parse("package:" + getPackageName()));
                        } else if ("exact".equals(kind) && Build.VERSION.SDK_INT >= 31) {
                            intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                    Uri.parse("package:" + getPackageName()));
                        } else if ("fullscreen".equals(kind) && Build.VERSION.SDK_INT >= 34) {
                            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                                    Uri.parse("package:" + getPackageName()));
                        } else if ("battery".equals(kind)) {
                            intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        } else if ("sound".equals(kind)) {
                            intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                        }
                    } catch (RuntimeException ignored) {
                        intent = null;
                    }
                    if (intent == null) {
                        intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + getPackageName()));
                    }
                    try {
                        startActivity(intent);
                    } catch (RuntimeException missing) {
                        // Aucun écran de réglage disponible sur cet appareil.
                    }
                }
            });
        }

        /** Sonnerie de test dans deux minutes, application fermée comprise. */
        @JavascriptInterface
        public void testAlarm() {
            web.post(new Runnable() {
                @Override
                public void run() {
                    AlarmReceiver.scheduleTest(MainActivity.this);
                }
            });
        }

        /** Impression système du mois (feuille #printSheet de la page). */
        @JavascriptInterface
        public void printPage() {
            web.post(new Runnable() {
                @Override
                public void run() {
                    if (web == null) return;
                    PrintManager print = (PrintManager) getSystemService(PRINT_SERVICE);
                    if (print == null) return;
                    PrintDocumentAdapter adapter = web.createPrintDocumentAdapter("matinbulle");
                    print.print("Matinbulle", adapter, new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .build());
                }
            });
        }

        /** Ouvre un lien https dans le navigateur du téléphone. */
        @JavascriptInterface
        public void openUrl(final String url) {
            if (url == null || !url.startsWith("https://")) return;
            web.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (RuntimeException missing) {
                        // Aucun navigateur : rien à ouvrir.
                    }
                }
            });
        }

        /** Partage la sauvegarde JSON (fichiers, Drive, courriel…). */
        @JavascriptInterface
        public void share(final String name, final String text) {
            web.post(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND)
                            .setType("application/json")
                            .putExtra(Intent.EXTRA_SUBJECT,
                                    name == null ? "Sauvegarde Matinbulle" : name)
                            .putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                    try {
                        startActivity(Intent.createChooser(send, "Sauvegarde Matinbulle"));
                    } catch (RuntimeException missing) {
                        // Aucune application de partage.
                    }
                }
            });
        }

        /** Dernier état affiché par les widgets d'écran d'accueil. */
        @JavascriptInterface
        public void widget(String json) {
            MatinbulleWidget.store(MainActivity.this, json);
            MatinbulleWidget.updateAll(MainActivity.this);
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        if (tts != null) tts.stop();
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
