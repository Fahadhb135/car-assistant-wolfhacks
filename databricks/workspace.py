"""Deploy the notebooks + helper modules to a Databricks workspace and run them, using only
the REST API and the token in ../.env (no git push or Git folder needed).

  cloud/.venv/bin/python databricks/workspace.py deploy
  cloud/.venv/bin/python databricks/workspace.py run 01_ingest [02_analytics 03_retrain ...]
  cloud/.venv/bin/python databricks/workspace.py job [--run]     # scheduled ingest->analytics (created paused)

Files land in /Workspace/Users/<you>/car-assistant/ with the same layout as the repo, so the
notebooks' relative imports (databricks/lib, cloud/app/hotspots.py) keep working."""
import base64
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parent.parent
env = ROOT / ".env"
if env.exists():
    for line in env.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

_h = os.environ["DATABRICKS_HOST"]
_h = _h if _h.startswith("http") else "https://" + _h
_p = urlparse(_h)
HOST = f"{_p.scheme}://{_p.netloc}"
client = httpx.Client(headers={"Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}"}, timeout=120)


def api(method: str, path: str, **kw) -> dict:
    r = client.request(method, f"{HOST}{path}", **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> HTTP {r.status_code}: {r.text[:600]}")
    return r.json() if r.content else {}


def me() -> str:
    return api("GET", "/api/2.0/preview/scim/v2/Me")["userName"]


def base_dir() -> str:
    return f"/Workspace/Users/{me()}/car-assistant"


# repo path -> workspace path (relative to base_dir)
FILES = (
    [(p, p) for p in sorted((ROOT / "databricks" / "lib").glob("*.py"))]
    + [(ROOT / "cloud" / "app" / "__init__.py", None), (ROOT / "cloud" / "app" / "hotspots.py", None)]
    + [(p, p) for p in sorted((ROOT / "databricks" / "notebooks").glob("*.py"))]
)


def upload(local: Path, ws_path: str, notebook: bool) -> None:
    content = base64.b64encode(local.read_bytes()).decode()
    body = {"path": ws_path, "content": content, "overwrite": True}
    if notebook:
        body.update({"format": "SOURCE", "language": "PYTHON"})
        ws_path = ws_path.removesuffix(".py")
        body["path"] = ws_path
    else:
        body["format"] = "AUTO"
    api("POST", "/api/2.0/workspace/import", json=body)


def deploy() -> str:
    base = base_dir()
    for d in ("databricks/lib", "databricks/notebooks", "databricks/dashboard", "cloud/app"):
        api("POST", "/api/2.0/workspace/mkdirs", json={"path": f"{base}/{d}"})
    for local, _ in FILES:
        rel = local.relative_to(ROOT).as_posix()
        is_nb = "notebooks" in rel
        upload(local, f"{base}/{rel}", notebook=is_nb)
        print("uploaded", rel)
    print("workspace folder:", base)
    return base


def run(notebook: str, params: dict | None = None) -> bool:
    path = f"{base_dir()}/databricks/notebooks/{notebook}"
    sub = api(
        "POST",
        "/api/2.1/jobs/runs/submit",
        json={
            "run_name": f"car-assistant {notebook}",
            "tasks": [{"task_key": "nb", "notebook_task": {"notebook_path": path, "base_parameters": params or {}}}],
        },
    )
    run_id = sub["run_id"]
    print(f"{notebook}: run {run_id} submitted")
    start = time.time()
    while True:
        st = api("GET", "/api/2.1/jobs/runs/get", params={"run_id": run_id})
        life, result = st["state"]["life_cycle_state"], st["state"].get("result_state")
        if life in ("TERMINATED", "SKIPPED", "INTERNAL_ERROR"):
            break
        if time.time() - start > 900:
            print("timed out waiting"); return False
        time.sleep(8)
    task_run = st["tasks"][0]["run_id"]
    try:
        out = api("GET", "/api/2.1/jobs/runs/get-output", params={"run_id": task_run})
        err = out.get("error") or out.get("error_trace")
        if err:
            print("ERROR:", str(err)[:1500])
        nb_out = (out.get("notebook_output") or {}).get("result")
        if nb_out:
            print("notebook result:", nb_out[:500])
    except Exception as exc:
        print("(could not fetch output)", exc)
    print(f"{notebook}: {life} / {result} in {int(time.time() - start)}s")
    return result == "SUCCESS"


JOB_NAME = "car-assistant refresh (ingest -> analytics)"


def create_job(cron: str = "0 0/30 * * * ?") -> str:
    """A scheduled job that chains 01_ingest -> 02_analytics. Created PAUSED so it uses no quota
    until you unpause it (Workflows > the job > Schedule). Idempotent by name."""
    base = f"{base_dir()}/databricks/notebooks"
    settings = {
        "name": JOB_NAME,
        "tasks": [
            {"task_key": "ingest", "notebook_task": {"notebook_path": f"{base}/01_ingest"}},
            {"task_key": "analytics", "depends_on": [{"task_key": "ingest"}],
             "notebook_task": {"notebook_path": f"{base}/02_analytics"}},
        ],
        "schedule": {"quartz_cron_expression": cron, "timezone_id": "UTC", "pause_status": "PAUSED"},
        "max_concurrent_runs": 1,
    }
    for j in api("GET", "/api/2.1/jobs/list", params={"name": JOB_NAME}).get("jobs", []):
        api("POST", "/api/2.1/jobs/reset", json={"job_id": j["job_id"], "new_settings": settings})
        print("updated job", j["job_id"])
        return str(j["job_id"])
    job_id = api("POST", "/api/2.1/jobs/create", json=settings)["job_id"]
    print("created job", job_id, "(schedule PAUSED)")
    return str(job_id)


def run_job(job_id: str) -> bool:
    run_id = api("POST", "/api/2.1/jobs/run-now", json={"job_id": int(job_id)})["run_id"]
    start = time.time()
    while True:
        st = api("GET", "/api/2.1/jobs/runs/get", params={"run_id": run_id})
        if st["state"]["life_cycle_state"] in ("TERMINATED", "SKIPPED", "INTERNAL_ERROR"):
            break
        time.sleep(8)
    tasks = {t["task_key"]: t["state"].get("result_state") for t in st.get("tasks", [])}
    print("job run:", st["state"].get("result_state"), tasks, f"in {int(time.time() - start)}s")
    return st["state"].get("result_state") == "SUCCESS"


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "deploy":
        deploy()
    elif cmd == "job":
        jid = create_job()
        if "--run" in sys.argv:
            sys.exit(0 if run_job(jid) else 1)
    elif cmd == "run":
        ok = all(run(n) for n in sys.argv[2:])
        sys.exit(0 if ok else 1)
    else:
        print(__doc__)
