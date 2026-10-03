-- Datasets behind the "Driving coach" AI/BI dashboard (databricks/dashboard.py builds it).
-- Also usable by hand: Dashboards > Create > Data tab > paste each query.

-- summary (counters)
SELECT COUNT(*) AS trips, COUNT(DISTINCT driverId) AS drivers,
       ROUND(AVG(smoothness), 1) AS avg_smoothness, SUM(nBadEvents) AS problem_events
FROM carassistant.default.trips;

-- maya_trend (line charts): a new driver improving over trips
SELECT tripNumber, smoothness, ROUND(stopCompliance * 100) AS stop_pct
FROM carassistant.default.driver_trends WHERE driverId = 'demo-maya' ORDER BY tripNumber;

-- events_by_kind (bar chart)
SELECT kind, COUNT(*) AS n FROM carassistant.default.events GROUP BY kind ORDER BY n DESC;

-- hotspots (table): exactly the list phones are told (notebook 02 saves it; 2+ drivers, 50 m clusters)
SELECT cell AS place, ROUND(lat, 5) AS lat, ROUND(lon, 5) AS lon, bad AS problems, drivers, ran, rolled,
       topKind AS mostly
FROM carassistant.default.hotspots ORDER BY bad DESC;
