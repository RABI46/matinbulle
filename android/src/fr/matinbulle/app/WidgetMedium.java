package fr.matinbulle.app;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 4 × 1 : l'heure, les jours et les étoiles. */
public class WidgetMedium extends MatinbulleWidget {

    @Override
    int layoutId() {
        return R.layout.widget_medium;
    }

    @Override
    void bind(Context context, RemoteViews views, JSONObject data) {
        views.setTextViewText(R.id.widget_time, data.optString("time", "--:--"));
        views.setTextViewText(R.id.widget_meta, data.optString("meta", "Réveil actif"));
        views.setTextViewText(R.id.widget_stars,
                "★ " + data.optInt("stars", 0) + " aujourd'hui");
    }
}
