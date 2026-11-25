package fr.matinbulle.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

import java.io.IOException;

/**
 * La sonnerie du réveil, jouée par le système et non par la page : elle doit
 * s'entendre même quand l'application est fermée, or un BroadcastReceiver ne
 * peut ni tenir un son plusieurs minutes ni ouvrir une activité en
 * arrière-plan de façon fiable.
 *
 * Service de premier plan (type mediaPlayback) démarré depuis l'alarme
 * exacte, ce qui le dispense des restrictions de démarrage en arrière-plan.
 * Il sonne la sonnerie d'alarme de l'appareil, vibre et affiche une
 * notification plein écran qui amène l'écran de réveil. Il sonne de bout en
 * bout, sans dépendre de la page : seul l'acquittement du réveil (maintien de
 * 1,5 s ou action « Arrêter ») l'arrête, et il abandonne de lui-même au bout
 * de cinq minutes. Si le processus meurt pendant la sonnerie, le système
 * relance le service tant que l'échéance n'est pas passée.
 */
public class RingService extends Service {

    static final String ACTION_START = "fr.matinbulle.app.SONNER";
    static final String ACTION_STOP = "fr.matinbulle.app.SILENCE";
    static final String EXTRA_WALL = "matinbulle.wall";
    static final String EXTRA_SOUND = "matinbulle.sound";
    static final String EXTRA_RISE = "matinbulle.rise";
    static final int NOTIFICATION_ID = 9;
    /** Une sonnerie sans réponse ne doit pas durer toute la matinée. */
    static final long MAX_RING = 5 * 60_000L;

    /** Échéance et heure murale survivent à une mort du processus. */
    private static final String PREFS = "matinbulle.ring";
    private static final String KEY_DEADLINE = "deadline";
    private static final String KEY_WALL = "wall";

    private MediaPlayer player;
    private Ringtone fallback;
    private PowerManager.WakeLock wake;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Montée douce du volume quand "rise" est actif : 2 s par palier, 3 min. */
    private boolean rising;
    private int rampStep;
    private final Runnable giveUp = new Runnable() {
        @Override
        public void run() {
            RingLog.add(RingService.this, "TIMEOUT", null);
            stopSelf();
        }
    };
    private final Runnable rampUp = new Runnable() {
        @Override
        public void run() {
            if (player == null || !rising) return;
            rampStep += 2;
            float volume = Math.min(1f, 0.25f + (rampStep / 90f) * 0.75f);
            player.setVolume(volume, volume);
            if (rampStep < 90) handler.postDelayed(this, 2000);
        }
    };

    /** Démarre la sonnerie (heure murale pour la notification, son choisi, montée). */
    static void start(Context context, String wall, String sound, boolean rise) {
        Intent intent = new Intent(context, RingService.class)
                .setAction(ACTION_START)
                .putExtra(EXTRA_WALL, wall)
                .putExtra(EXTRA_SOUND, sound)
                .putExtra(EXTRA_RISE, rise);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Rend le silence, notification comprise : c'est l'acquittement du réveil. */
    static void stop(Context context) {
        if (prefs(context).getLong(KEY_DEADLINE, 0L) > 0) {
            RingLog.add(context, "ACK", null);
        }
        prefs(context).edit().remove(KEY_DEADLINE).remove(KEY_WALL).apply();
        context.stopService(new Intent(context, RingService.class));
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
    }

    /**
     * Notification du réveil : catégorie alarme, importance haute et intention
     * plein écran pour que l'écran de sonnerie passe par-dessus le
     * verrouillage. `ongoing` la rend insécable pendant que le service sonne.
     */
    static Notification notification(Context context, String wall, boolean ongoing) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                    AlarmReceiver.CHANNEL, "Réveil", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Sonnerie du réveil");
            // Le son vient du service, pas du canal.
            channel.setSound(null, null);
            channel.enableVibration(false);
            nm.createNotificationChannel(channel);
        }

        Intent open = new Intent(context, MainActivity.class)
                .putExtra(AlarmReceiver.EXTRA_RING, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent screen = PendingIntent.getActivity(context, AlarmReceiver.REQUEST, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent quiet = new Intent(context, RingService.class).setAction(ACTION_STOP);
        PendingIntent stop = PendingIntent.getService(context, AlarmReceiver.REQUEST, quiet,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String hour = AlarmReceiver.hourOf(wall);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, AlarmReceiver.CHANNEL)
                : new Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(context.getString(R.string.app_name))
                .setContentText(hour == null
                        ? "C'est l'heure de se lever."
                        : "Réveil de " + hour + " — c'est l'heure de se lever.")
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_HIGH)
                .setOngoing(ongoing)
                .setAutoCancel(!ongoing)
                .setContentIntent(screen);
        // Android 14 réserve l'ouverture plein écran aux réveils et la
        // permission se retire dans les réglages : sans elle, la notification
        // reste une alerte haute, avec le son et la vibration.
        if (fullScreenAllowed(nm)) builder.setFullScreenIntent(screen, true);
        builder.addAction(0, "Arrêter", stop);
        return builder.build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** L'écran de réveil peut-il encore s'ouvrir par-dessus le verrouillage ? */
    private static boolean fullScreenAllowed(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 34) return true;
        return nm == null || nm.canUseFullScreenIntent();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            RingLog.add(this, "ACK", "notification");
            stopSelf();
            return START_NOT_STICKY;
        }
        long now = System.currentTimeMillis();
        long deadline;
        String wall;
        String sound;
        boolean rise;
        if (intent == null) {
            // Le système relance le service après la mort du processus : on
            // reprend la sonnerie tant qu'elle n'a pas été acquittée et que
            // l'échéance n'est pas dépassée.
            deadline = prefs(this).getLong(KEY_DEADLINE, 0L);
            wall = prefs(this).getString(KEY_WALL, null);
            sound = AlarmReceiver.armedSound(this);
            rise = AlarmReceiver.armedRise(this);
            if (deadline <= now) {
                stopSelf();
                return START_NOT_STICKY;
            }
        } else {
            wall = intent.getStringExtra(EXTRA_WALL);
            sound = intent.getStringExtra(EXTRA_SOUND);
            rise = intent.getBooleanExtra(EXTRA_RISE, true);
            deadline = now + MAX_RING;
            prefs(this).edit()
                    .putLong(KEY_DEADLINE, deadline)
                    .putString(KEY_WALL, wall)
                    .apply();
        }
        Notification note = notification(this, wall, true);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, note);
        }
        ring(sound, rise);
        handler.removeCallbacks(giveUp);
        handler.postDelayed(giveUp, Math.max(1000L, deadline - System.currentTimeMillis()));
        // Un balayage de l'application ne doit pas emporter la sonnerie.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        silence();
        // Effacé ici, mais pas lors d'une mort brutale du processus : c'est ce
        // qui permet au redémarrage du service de savoir qu'il sonnait encore.
        prefs(this).edit().remove(KEY_DEADLINE).remove(KEY_WALL).apply();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    private void ring(String sound, boolean rise) {
        // Deuxième déclenchement alors que la sonnerie tourne : on repart propre.
        silence();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "matinbulle:sonnerie");
            wake.acquire(MAX_RING + 10_000L);
        }
        playAlarm(sound, rise);
        rising = rise;
        if (rise) {
            rampStep = 0;
            handler.postDelayed(rampUp, 2000);
        }
        startVibration();
    }

    private void playAlarm(String sound, boolean rise) {
        // Sonnerie choisie, embarquée dans les assets : rendue à la construction.
        if (sound != null && sound.matches("[a-z]+")) {
            AssetFileDescriptor fd = null;
            try {
                fd = getAssets().openFd("sounds/" + sound + ".wav");
                player = new MediaPlayer();
                player.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                player.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
                player.setLooping(true);
                player.prepare();
                fd.close();
                fd = null;
                float start = rise ? 0.25f : 1f;
                player.setVolume(start, start);
                player.start();
                return;
            } catch (Exception silent) {
                releasePlayer();
            } finally {
                if (fd != null) {
                    try {
                        fd.close();
                    } catch (IOException ignored) {
                        // déjà fermé
                    }
                }
            }
        }
        Uri uri = Settings.System.DEFAULT_ALARM_ALERT_URI;
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
            return;
        } catch (Exception silent) {
            releasePlayer();
        }
        // Dernier recours : une sonnerie du système, jouée une fois.
        try {
            fallback = RingtoneManager.getRingtone(this,
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
            if (fallback != null) {
                fallback.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                fallback.play();
            }
        } catch (Exception ignored) {
            // Aucun son possible : la notification et la vibration restent.
        }
    }

    private void startVibration() {
        Object service = getSystemService(VIBRATOR_SERVICE);
        if (!(service instanceof Vibrator)) return;
        vibrator = (Vibrator) service;
        long[] pattern = {0, 700, 500};
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (RuntimeException refused) {
            vibrator = null;
        }
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
                // déjà arrêté
            }
            player.release();
            player = null;
        }
        if (fallback != null) {
            try {
                fallback.stop();
            } catch (RuntimeException ignored) {
                // déjà arrêtée
            }
            fallback = null;
        }
    }

    private void silence() {
        rising = false;
        rampStep = 0;
        handler.removeCallbacks(rampUp);
        handler.removeCallbacks(giveUp);
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        releasePlayer();
        if (wake != null && wake.isHeld()) wake.release();
        wake = null;
    }
}
