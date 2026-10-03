"""Create (or update) the "Driving coach" AI/BI dashboard through the Lakeview API and publish it.

  cloud/.venv/bin/python databricks/dashboard.py

Idempotent: finds the dashboard by name and updates it. The tables must exist (run notebooks 01 + 02)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workspace as w  # noqa: E402

NAME = "Driving coach"
T = "carassistant.default"

DATASETS = {
    "summary": ("Summary",
                f"SELECT COUNT(*) AS trips, COUNT(DISTINCT driverId) AS drivers, ROUND(AVG(smoothness), 1) AS avg_smoothness, SUM(nBadEvents) AS problem_events FROM {T}.trips"),
    "maya": ("Maya's trend",
             f"SELECT tripNumber, smoothness, ROUND(stopCompliance * 100) AS stop_pct FROM {T}.driver_trends WHERE driverId = 'demo-maya' ORDER BY tripNumber"),
    "kinds": ("Events by kind", f"SELECT kind, COUNT(*) AS n FROM {T}.events GROUP BY kind ORDER BY n DESC"),
    "hot": ("Hotspots",
            f"SELECT cell AS place, ROUND(lat, 5) AS lat, ROUND(lon, 5) AS lon, bad AS problems, drivers, ran, rolled, topKind AS mostly FROM {T}.hotspots ORDER BY bad DESC"),
}


def widget(name, dataset, fields, spec, x, y, width, height, title=None):
    spec = {**spec, **({"frame": {"showTitle": True, "title": title}} if title else {})}
    return {
        "widget": {
            "name": name,
            "queries": [{"name": "main_query", "query": {"datasetName": dataset, "fields": fields, "disaggregated": True}}],
            "spec": spec,
        },
        "position": {"x": x, "y": y, "width": width, "height": height},
    }


def field(col):
    return {"name": col, "expression": f"`{col}`"}


def counter(name, col, label, x):
    return widget(name, "summary", [field(col)],
                  {"version": 2, "widgetType": "counter", "encodings": {"value": {"fieldName": col, "displayName": label}}},
                  x, 0, 3 if x == 0 or x == 3 else 3, 3)


def line(name, dataset, x_col, y_col, title, x, y):
    return widget(name, dataset, [field(x_col), field(y_col)], {
        "version": 3, "widgetType": "line",
        "encodings": {"x": {"fieldName": x_col, "scale": {"type": "quantitative"}, "displayName": "Trip #"},
                      "y": {"fieldName": y_col, "scale": {"type": "quantitative"}, "displayName": title}},
    }, x, y, 3, 6, title)


def dashboard_json() -> str:
    layout = [
        counter("c_trips", "trips", "Trips", 0),
        counter("c_drivers", "drivers", "Drivers", 3),
        counter("c_smooth", "avg_smoothness", "Avg smoothness", 6) | {},
        counter("c_bad", "problem_events", "Problem events", 9),
        line("l_smooth", "maya", "tripNumber", "smoothness", "Maya: smoothness by trip", 0, 3),
        line("l_stop", "maya", "tripNumber", "stop_pct", "Maya: full stops (%)", 3, 3),
        widget("b_kinds", "kinds", [field("kind"), field("n")], {
            "version": 3, "widgetType": "bar",
            "encodings": {"x": {"fieldName": "kind", "scale": {"type": "categorical"}, "displayName": "Event"},
                          "y": {"fieldName": "n", "scale": {"type": "quantitative"}, "displayName": "Count"}},
        }, 6, 3, 6, 6, "What goes wrong"),
        widget("t_hot", "hot", [field(c) for c in ("place", "lat", "lon", "problems", "drivers", "ran", "rolled", "mostly")], {
            "version": 1, "widgetType": "table",
            "encodings": {"columns": [{"fieldName": c, "displayName": c} for c in ("place", "lat", "lon", "problems", "drivers", "ran", "rolled", "mostly")]},
            "frame": {"showTitle": True, "title": "Hotspots (2+ drivers, demo data)"},
        }, 0, 9, 12, 6),
    ]
    return json.dumps({
        "datasets": [{"name": k, "displayName": v[0], "queryLines": [v[1]]} for k, v in DATASETS.items()],
        "pages": [{"name": "overview", "displayName": "Overview", "pageType": "PAGE_TYPE_CANVAS", "layout": layout}],
    })


def find_existing(parent: str) -> str | None:
    """By name via the list API, then by workspace path (the list can lag right after creation)."""
    for d in w.api("GET", "/api/2.0/lakeview/dashboards").get("dashboards", []):
        if d.get("display_name") == NAME and d.get("lifecycle_state") != "TRASHED":
            return d["dashboard_id"]
    try:
        st = w.api("GET", "/api/2.0/workspace/get-status", params={"path": f"{parent}/{NAME}.lvdash.json"})
        return st.get("resource_id")
    except RuntimeError:
        return None


def main() -> None:
    import sql

    wh = sql.warehouse_id()
    parent = f"{w.base_dir()}"
    body = {"display_name": NAME, "warehouse_id": wh, "serialized_dashboard": dashboard_json(), "parent_path": parent}
    did = find_existing(parent)
    if did:
        w.api("PATCH", f"/api/2.0/lakeview/dashboards/{did}", json={k: body[k] for k in ("display_name", "warehouse_id", "serialized_dashboard")})
        print("updated dashboard", did)
    else:
        did = w.api("POST", "/api/2.0/lakeview/dashboards", json=body)["dashboard_id"]
        print("created dashboard", did)
    pub = w.api("POST", f"/api/2.0/lakeview/dashboards/{did}/published", json={"embed_credentials": True, "warehouse_id": wh})
    print("published:", pub.get("display_name"), "| url:", f"{w.HOST}/dashboardsv3/{did}/published")


if __name__ == "__main__":
    main()
