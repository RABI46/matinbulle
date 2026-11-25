package fr.matinbulle.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * AlarmManager perd ses alarmes au redémarrage : on les reprogramme ici à
 * partir de l'heure murale conservée, rapportée au fuseau courant — un
 * décalage horaire pendant l'arrêt ne doit pas déplacer la sonnerie. Si
 * l'heure est tombée pendant l'extinction, on le signale au lieu de laisser
 * le réveil filer en silence.
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
        long now = System.currentTimeMillis();
        if (at > now) {
            AlarmReceiver.schedule(context, at, wall,
                    AlarmReceiver.armedSound(context), AlarmReceiver.armedRise(context));
            return;
        }
        // Heure tombée pendant l'arrêt : dans la fenêtre de rattrapage de la
        // page, on signale le réveil manqué ; au-delà, il est trop tard.
        if (at > 0 && now - at <= AlarmReceiver.GRACE) {
            AlarmReceiver.notifyMissed(context, wall);
            // Réveil consommé : la page recalculera la prochaine occurrence.
            AlarmReceiver.schedule(context, 0, null, null, false);
        }
    }
}
