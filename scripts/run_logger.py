#!/usr/bin/env python3
"""
KoUp Run Logger & Realtime Supabase Streaming Wrapper
- Library & CLI runner for scraper / automation processes
- Streams logs in batches (20 lines or 1s intervals) to public.scraper_logs
- Records run lifecycle, counts, and exit status to public.scraper_runs
- Zero hardcoded secrets: reads from environment, .env, or koup-app/.env.local
"""

import os
import sys
import json
import time
import uuid
import signal
import argparse
import subprocess
import threading
import re
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

try:
    import requests
except ImportError:
    requests = None

import urllib.request
import urllib.error

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TAG_RE_INSERTED = re.compile(r"\[(?:EKLENDİ|EKLENDI|ADDED)\]", re.IGNORECASE)
TAG_RE_UPDATED = re.compile(r"\[(?:GÜNCELLENDİ|GUNCELLENDI|UPDATED)\]", re.IGNORECASE)
TAG_RE_FAILED = re.compile(r"\[(?:HATA|FAILED|ERROR)\]", re.IGNORECASE)
TAG_RE_VERIFIED = re.compile(r"\[(?:DOĞRULANDI|DOGRULANDI|VERIFIED)\]", re.IGNORECASE)
TAG_RE_WARN = re.compile(r"\[(?:UYARI|WARN|WARNING)\]", re.IGNORECASE)


def _safe_write(text: str, stream=sys.stdout):
    """Safely print text to stream without charmap or UnicodeEncodeError failures."""
    try:
        stream.write(text)
        stream.flush()
    except UnicodeEncodeError:
        try:
            stream.buffer.write(text.encode("utf-8", errors="replace"))
            stream.buffer.flush()
        except Exception:
            pass
    except Exception:
        pass


def load_supabase_credentials():
    """Extract Supabase URL and service key safely without hardcoded secrets."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    )

    candidate_files = [
        os.path.join(_ROOT, ".env"),
        os.path.join(_ROOT, "koup-app", ".env.local"),
        os.path.join(_ROOT, "koup-app", ".env"),
    ]

    for fpath in candidate_files:
        if (not url or not key) and os.path.exists(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if not url and k in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"):
                                url = v
                            elif not key and k in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"):
                                key = v
            except Exception:
                pass

    return url.rstrip("/"), key


class RunLogger:
    def __init__(
        self,
        run_id: Optional[str] = None,
        target: str = "general",
        script: str = "unknown",
        args: Optional[List[str]] = None,
        trigger_source: str = "admin",
        gh_run_id: Optional[int] = None,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        batch_size: int = 20,
        flush_interval: float = 1.0,
    ):
        self.run_id = run_id or str(uuid.uuid4())
        self.target = target
        self.script = script
        self.args = args or []
        self.trigger_source = trigger_source
        self.gh_run_id = gh_run_id

        self.batch_size = batch_size
        self.flush_interval = flush_interval

        loaded_url, loaded_key = load_supabase_credentials()
        self.supabase_url = (supabase_url or loaded_url).rstrip("/")
        self.supabase_key = supabase_key or loaded_key

        self.seq = 0
        self.batch: List[Dict[str, Any]] = []
        self.last_flush = time.time()
        self.lock = threading.Lock()

        self.inserted_count = 0
        self.updated_count = 0
        self.failed_count = 0
        self.verified_count = 0

        self.is_started = False
        self.is_finished = False

    def _http_request(self, method: str, endpoint: str, data: Any = None, prefer: Optional[str] = None):
        """Execute HTTP request against Supabase PostgREST API."""
        if not self.supabase_url or not self.supabase_key:
            return None

        full_url = f"{self.supabase_url}/rest/v1/{endpoint.lstrip('/')}"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer

        payload_bytes = json.dumps(data).encode("utf-8") if data is not None else None

        if requests is not None:
            try:
                res = requests.request(
                    method=method,
                    url=full_url,
                    headers=headers,
                    data=payload_bytes,
                    timeout=10,
                )
                return res
            except Exception as e:
                sys.stderr.write(f"[run_logger] HTTP error ({method} {endpoint}): {e}\n")
                return None
        else:
            try:
                req = urllib.request.Request(full_url, data=payload_bytes, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return resp
            except Exception as e:
                sys.stderr.write(f"[run_logger] Urllib error ({method} {endpoint}): {e}\n")
                return None

    def start(self):
        """Initialize or update scraper_runs row to running status."""
        with self.lock:
            if self.is_started:
                return
            self.is_started = True

        run_record = {
            "id": self.run_id,
            "target": self.target,
            "script": self.script,
            "args": self.args,
            "trigger_source": self.trigger_source,
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        if self.gh_run_id is not None:
            run_record["gh_run_id"] = self.gh_run_id

        self._http_request(
            method="POST",
            endpoint="scraper_runs?on_conflict=id",
            data=run_record,
            prefer="resolution=merge-duplicates,return=representation",
        )

    def log(self, line: str, level: Optional[str] = None):
        """Append log line, auto-detect level & counter tags, and flush if needed."""
        line_clean = line.rstrip("\r\n")
        if not line_clean:
            return

        # Count tags
        ins = len(TAG_RE_INSERTED.findall(line_clean))
        upd = len(TAG_RE_UPDATED.findall(line_clean))
        fail = len(TAG_RE_FAILED.findall(line_clean))
        ver = len(TAG_RE_VERIFIED.findall(line_clean))

        with self.lock:
            self.inserted_count += ins
            self.updated_count += upd
            self.failed_count += fail
            self.verified_count += ver

            # Detect log level if not explicitly provided
            if not level:
                if fail > 0 or re.search(r"\b(?:traceback|exception)\b", line_clean, re.IGNORECASE):
                    level = "error"
                elif TAG_RE_WARN.search(line_clean):
                    level = "warn"
                else:
                    level = "info"

            entry = {
                "run_id": self.run_id,
                "seq": self.seq,
                "level": level,
                "line": line_clean,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.seq += 1
            self.batch.append(entry)

            should_flush = len(self.batch) >= self.batch_size or (time.time() - self.last_flush >= self.flush_interval)

        if should_flush:
            self.flush_logs()

    def flush_logs(self):
        """Send buffered log entries to public.scraper_logs."""
        with self.lock:
            if not self.batch:
                return
            to_send = list(self.batch)
            self.batch.clear()
            self.last_flush = time.time()

        self._http_request(
            method="POST",
            endpoint="scraper_logs",
            data=to_send,
            prefer="return=minimal",
        )

    def finish(self, status: str = "success", error_message: Optional[str] = None):
        """Flush remaining logs and finalize scraper_runs row."""
        with self.lock:
            if self.is_finished:
                return
            self.is_finished = True

        self.flush_logs()

        patch_body = {
            "status": status,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "inserted_count": self.inserted_count,
            "updated_count": self.updated_count,
            "failed_count": self.failed_count,
            "verified_count": self.verified_count,
        }
        if error_message:
            patch_body["error_message"] = error_message

        self._http_request(
            method="PATCH",
            endpoint=f"scraper_runs?id=eq.{self.run_id}",
            data=patch_body,
            prefer="return=minimal",
        )

    def run_command(self, cmd_args: List[str]) -> int:
        """Run subprocess, mirror stdout to console, and stream logs to Supabase."""
        self.start()

        if cmd_args and cmd_args[0].endswith(".py") and not cmd_args[0].startswith(sys.executable):
            cmd_args = [sys.executable] + cmd_args

        # Set up signal handler for clean cancellation
        def handle_cancel(signum, frame):
            self.finish(status="cancelled", error_message=f"Terminated by signal {signum}")
            sys.exit(128 + signum)

        try:
            signal.signal(signal.SIGINT, handle_cancel)
            signal.signal(signal.SIGTERM, handle_cancel)
        except (ValueError, AttributeError):
            pass

        sub_env = os.environ.copy()
        sub_env["PYTHONIOENCODING"] = "utf-8"
        sub_env["PYTHONUTF8"] = "1"

        try:
            proc = subprocess.Popen(
                cmd_args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                encoding="utf-8",
                errors="replace",
                env=sub_env,
            )
        except Exception as e:
            err = f"Failed to launch process: {e}"
            _safe_write(f"{err}\n", sys.stderr)
            self.finish(status="failed", error_message=err)
            return 1

        try:
            for line in proc.stdout:
                _safe_write(line)
                self.log(line)
        except Exception as e:
            self.log(f"[HATA] Log okuma hatası: {e}", level="error")

        proc.wait()
        rc = proc.returncode

        if rc == 0:
            final_status = "success"
            err_msg = None
        else:
            final_status = "failed"
            err_msg = f"Process exited with code {rc}"

        self.finish(status=final_status, error_message=err_msg)
        return rc

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.finish(status="failed", error_message=str(exc_val))
        else:
            self.finish(status="success")


def main():
    # Detect double dash '--' separator
    if "--" in sys.argv:
        idx = sys.argv.index("--")
        wrapper_argv = sys.argv[1:idx]
        sub_cmd = sys.argv[idx + 1 :]
    else:
        wrapper_argv = sys.argv[1:]
        sub_cmd = []

    parser = argparse.ArgumentParser(description="KoUp Scraper Run Logger & Streamer")
    parser.add_argument("--run-id", type=str, default=None, help="Scraper run UUID")
    parser.add_argument("--target", type=str, default="general", help="Scraper target site/domain")
    parser.add_argument("--script", type=str, default=None, help="Script path if not using --")
    parser.add_argument("--trigger", type=str, default="admin", help="Trigger source (admin/cron/manual)")
    parser.add_argument("--gh-run-id", type=int, default=None, help="GitHub Actions run ID")

    args, extra_args = parser.parse_known_args(wrapper_argv)

    if not sub_cmd:
        if args.script:
            sub_cmd = [args.script] + extra_args
        elif extra_args:
            sub_cmd = extra_args
        else:
            parser.error("No script or command specified to run. Use '-- <command>' or '--script <path>'.")

    script_name = sub_cmd[0]
    cmd_args = sub_cmd[1:]

    logger = RunLogger(
        run_id=args.run_id,
        target=args.target,
        script=script_name,
        args=cmd_args,
        trigger_source=args.trigger,
        gh_run_id=args.gh_run_id,
    )

    exit_code = logger.run_command(sub_cmd)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
