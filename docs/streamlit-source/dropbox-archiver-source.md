# Streamlit Source — 97_Dropbox_Archiver.py

**Purpose for coordinator:** This file exists so the remote coordinator can study the Streamlit implementation without needing local filesystem access. The original lives at `../streamlit_app/pages/97_Dropbox_Archiver.py` (141 lines).

---

## What it does

3-stage pipeline to offload old Dropbox files and free up storage:

- **Stage 1 — Audit** (runs in Streamlit Cloud): Connects to Dropbox API, counts files older than N days, compares against what's already downloaded locally
- **Stage 2 — Download** (terminal only): Downloads archiveable files from Dropbox → `C:/AI_Data/exports/dropbox`
- **Stage 3 — Transfer** (terminal only): Copies from PC → external hard drive with SHA256 spot-checking

Key constraint: Stages 2 and 3 are intentionally terminal-only (Colin runs them locally). The Streamlit page only does Stage 1 (audit/count) and shows the terminal commands for 2 and 3.

Protected folders never archived: `/Hubdoc/Uploads`

## Source (verbatim)

```python
"""
Dropbox Archiver — Offload old files to free up Dropbox storage.
3-stage pipeline: Audit → Download to PC → Transfer to Hard Drive.
Stage 1 runs on Streamlit Cloud. Stages 2-3 must run locally via terminal.
"""

import sys
import time
from pathlib import Path

import streamlit as st
from utils.style import page_setup, section_header

page_setup("Dropbox Archiver", "📦", auth="admin")

# Backend lives in scripts/ — add to path
SCRIPTS_PATH = Path(__file__).parent.parent / "scripts"
if str(SCRIPTS_PATH) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PATH))

st.markdown(
    section_header("Dropbox Archiver", "Offload old files → free up Dropbox storage"),
    unsafe_allow_html=True,
)

# ── Settings sidebar ──────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### Settings")
    cutoff_days = st.slider(
        "Archive files older than",
        min_value=30, max_value=730, value=90, step=30,
        format="%d days",
    )

    st.divider()
    st.markdown("### Pipeline Stages")
    st.markdown(
        "1. **Audit** — count the gap *(runs here)*\n"
        "2. **Download** — copy to PC *(run in terminal)*\n"
        "3. **Transfer** — move to hard drive *(run in terminal)*"
    )
    st.divider()
    # Protected folders note

# ── State helpers ─────────────────────────────────────────────────────────────
def _state(key, default=None):
    if key not in st.session_state:
        st.session_state[key] = default
    return st.session_state[key]

# ── Stage 1: Audit ────────────────────────────────────────────────────────────
st.markdown("## Stage 1 — Audit")

col_run, col_info = st.columns([1, 3])
with col_run:
    run_audit = st.button("Run Audit", type="primary")

audit_result = _state("archiver_audit")

if run_audit:
    with st.spinner("Connecting to Dropbox and listing files..."):
        try:
            from dropbox_archiver import audit
            result = audit(older_than_days=cutoff_days)
            st.session_state["archiver_audit"] = result
            st.session_state["archiver_files"] = result.get("files", [])
            audit_result = result
        except ImportError:
            st.error("dropbox not installed — run: pip install dropbox")
        except Exception as e:
            st.error(f"Audit failed: {e}")

if audit_result and "error" not in audit_result:
    col1, col2, col3, col4 = st.columns(4)
    used_pct = audit_result.get("pct", 0)
    col1.metric("Dropbox Used", f"{audit_result['used_gb']:.1f} GB", f"{used_pct:.0f}% of {audit_result['quota_gb']:.0f} GB")
    col2.metric("Archiveable Files", f"{audit_result['archiveable_total']:,}", help=f"Files older than {cutoff_days} days")
    col3.metric("Already on Computer", f"{audit_result['already_local']:,}")
    col4.metric("Need Download", f"{audit_result['need_download']:,}", f"{audit_result['need_download_bytes']/1024**3:.2f} GB")

    st.progress(min(used_pct / 100, 1.0), text=f"Dropbox: {audit_result['used_gb']:.1f} / {audit_result['quota_gb']:.0f} GB used")

    if audit_result["need_download"] == 0:
        st.success("All archiveable files are already on this computer. Proceed to Stage 3.")
    else:
        st.info(f"{audit_result['need_download']:,} files need to be downloaded before they can be moved.")

elif audit_result and "error" in audit_result:
    st.error(f"Audit error: {audit_result['error']}")
else:
    st.info("Run the audit to see your Dropbox usage and file gap.")

st.divider()

# ── Stage 2: Download to PC ───────────────────────────────────────────────────
st.markdown("## Stage 2 — Download to Your PC")

files = _state("archiver_files", [])
missing_files = [f for f in files if not f["is_local"]]

if not audit_result:
    st.warning("Run Stage 1 (Audit) first.")
elif not missing_files:
    st.success(f"Nothing to download — all {len(files):,} archiveable files are already on your PC.")
else:
    download_gb = sum(f["size"] for f in missing_files) / 1024**3
    st.info(f"{len(missing_files):,} files to download ({download_gb:.2f} GB)")
    st.markdown("**Run this in your VS Code terminal:**")
    st.code(
        f'cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"\n'
        f'python tools/dropbox_archiver.py --download --days {cutoff_days}',
        language="bash",
    )

st.divider()

# ── Stage 3: Transfer to Hard Drive ──────────────────────────────────────────
st.markdown("## Stage 3 — Transfer to Hard Drive")

st.markdown("**Run this in your VS Code terminal** (replace `D` with your drive letter):")
st.code(
    f'cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"\n'
    f'python tools/dropbox_archiver.py --transfer D --days {cutoff_days}',
    language="bash",
)
```

## Key domain rules for LepiOS port

1. Stage 1 can run server-side (Dropbox API call). Stages 2–3 are display-only (show terminal commands)
2. Default cutoff: 90 days. Range: 30–730 days
3. Protected path: `/Hubdoc/Uploads` — never eligible
4. The `dropbox_archiver` Python script lives at `tools/dropbox_archiver.py` in the workspace root — LepiOS port should call the Dropbox API directly, not shell out
5. Key metrics: used_gb, quota_gb, pct, archiveable_total, already_local, need_download, need_download_bytes
6. `is_local` flag per file = whether it's already downloaded to `C:/AI_Data/exports/dropbox`
