package fr.matinbulle.app;

import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 2 × 1 : l'heure et les étoiles du jour. */
public class WidgetSmall extends MatinbulleWidget {

    @Override
    int layoutId() {
        return R.layout.widget_small;
    }

    @Override
    void bind(Context context, RemoteViews views, JSONObject data) {
        views.setTextViewText(R.id.widget_time, data.optString("time", "--:--"));
        views.setTextViewText(R.id.widget_stars,
                "★ " + data.optInt("stars", 0) + " aujourd'hui");
    }
}
