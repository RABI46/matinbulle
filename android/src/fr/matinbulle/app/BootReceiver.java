package fr.matinbulle.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * AlarmManager perd ses alarmes au redémarrage : on les reprogramme ici à
 * partir de l'heure murale conservée, rapportée au fuseau courant — un
 * décalage horaire pendant l'arrêt ne doit pas déplacer la sonnerie.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        String wall = AlarmReceiver.armedWall(context);
        // Ancienne version sans heure murale : on retombe sur l'instant mémorisé.
        long at = AlarmReceiver.resolveWall(wall);
        if (at <= 0) at = AlarmReceiver.armedAt(context);
        // Heure passée pendant l'arrêt : la page rattrape à l'ouverture.
        if (at <= System.currentTimeMillis()) return;
        AlarmReceiver.schedule(context, at, wall);
    }
}
