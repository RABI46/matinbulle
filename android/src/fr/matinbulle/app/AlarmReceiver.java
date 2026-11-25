package fr.matinbulle.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Déclenché par AlarmManager : confie la sonnerie à RingService. Le son ne
 * peut pas venir d'ici — un receiver ne tient pas plusieurs minutes, et
 * l'activité ne peut plus être ouverte depuis l'arrière-plan.
 */
public class AlarmReceiver extends BroadcastReceiver {

    static final String EXTRA_RING = "matinbulle.ring";
    static final String CHANNEL = "reveil";
    static final String MISSED_CHANNEL = "reveil-manque";
    static final int MISSED_ID = 8;
    static final int REQUEST = 7;
    /** Fenêtre de rattrapage, alignée sur GRACE dans app.js (10 min). */
    static final long GRACE = 10 * 60_000L;

    /** Instant (ms epoch) confié au système, conservé pour survivre au redémarrage. */
    private static final String PREFS = "matinbulle";
    private static final String KEY_AT = "armedAt";
    /** Heure murale visée « yyyy-MM-ddTHH:mm » : un instant absolu ne dit pas de quelle heure il s'agit. */
    private static final String KEY_WALL = "armedWall";

    /**
     * Programme (ou annule, avec at <= 0) la sonnerie et retient l'instant et
     * l'heure murale : AlarmManager oublie tout au redémarrage, et un instant
     * absolu ne survit pas à un changement de fuseau.
     */
    static void schedule(Context context, long at, String wall) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, AlarmReceiver.class);
        PendingIntent ring = PendingIntent.getBroadcast(context, REQUEST, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (at <= 0) {
            am.cancel(ring);
            prefs.edit().remove(KEY_AT).remove(KEY_WALL).apply();
            return;
        }
        prefs.edit().putLong(KEY_AT, at).putString(KEY_WALL, wall).apply();
        try {
            // setAlarmClock : exacte, réveille l'appareil, visible dans la barre d'état.
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, null), ring);
        } catch (SecurityException refused) {
            // shortcut: alarme exacte refusée par le système -> heure approximative
            am.set(AlarmManager.RTC_WAKEUP, at, ring);
        }
    }

    /** Instant encore confié au système (0 = rien de programmé). */
    static long armedAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_AT, 0);
    }

    /** Heure murale encore confiée au système (null = inconnue, ancienne version). */
    static String armedWall(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_WALL, null);
    }

    /**
     * Instant réel de l'heure murale mémorisée, rapportée au fuseau courant de
     * l'appareil (0 si illisible). La page a déjà choisi la date et l'heure ;
     * ici on ne fait que les reconvertir, heure d'été comprise.
     */
    static long resolveWall(String wall) {
        if (wall == null) return 0;
        String[] dateAndTime = wall.split("T");
        if (dateAndTime.length != 2) return 0;
        String[] ymd = dateAndTime[0].split("-");
        String[] hm = dateAndTime[1].split(":");
        if (ymd.length != 3 || hm.length != 2) return 0;
        try {
            Calendar calendar = Calendar.getInstance(TimeZone.getDefault());
            calendar.clear();
            calendar.set(Integer.parseInt(ymd[0]), Integer.parseInt(ymd[1]) - 1,
                    Integer.parseInt(ymd[2]), Integer.parseInt(hm[0]), Integer.parseInt(hm[1]), 0);
            return calendar.getTimeInMillis();
        } catch (NumberFormatException bad) {
            return 0;
        }
    }

    /** « 2026-11-25T07:15 » -> « 07:15 ». */
    static String hourOf(String wall) {
        if (wall == null) return null;
        int sep = wall.indexOf('T');
        return sep < 0 || sep + 1 >= wall.length() ? null : wall.substring(sep + 1);
    }

    /**
     * Réveil tombé pendant que l'appareil était éteint : au redémarrage on
     * prévient au lieu de laisser le réveil disparaître en silence. Une
     * sonnerie immédiate est hors de portée depuis un boot (lancer une
     * activité en arrière-plan est bloqué) : c'est une notification.
     */
    static void notifyMissed(Context context, String wall) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                    MISSED_CHANNEL, "Réveil manqué", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Réveil tombé pendant que le téléphone était éteint");
            nm.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent screen = PendingIntent.getActivity(context, MISSED_ID, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, MISSED_CHANNEL)
                : new Notification.Builder(context);
        String hour = hourOf(wall);
        builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("Réveil manqué")
                .setContentText(hour == null
                        ? "Le réveil a sonné pendant que le téléphone était éteint."
                        : "Le réveil de " + hour + " a sonné pendant que le téléphone était éteint.")
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(screen);
        nm.notify(MISSED_ID, builder.build());
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String wall = armedWall(context);
        try {
            // Une alarme exacte autorise le démarrage d'un service de premier
            // plan depuis l'arrière-plan : c'est lui qui porte le son.
            RingService.start(context, wall);
        } catch (RuntimeException refused) {
            // Service refusé par le système : au moins la notification, et
            // l'écran de réveil si l'ouverture est acceptée.
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(RingService.NOTIFICATION_ID, RingService.notification(context, wall, false));
            Intent open = new Intent(context, MainActivity.class)
                    .putExtra(EXTRA_RING, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try {
                context.startActivity(open);
            } catch (RuntimeException blocked) {
                // Arrière-plan verrouillé : la notification reste le seul recours.
            }
        }
    }
}
