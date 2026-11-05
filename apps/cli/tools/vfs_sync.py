#!/usr/bin/env python3
"""Replay the newest session JSONL (write_file / edit_file TOOL_CALLs) onto real disk.

The agent's write_file/edit_file tools operate on an in-memory VirtualFS; run_command
sees the real disk. This bridges the two so builds/tests can run for real.
"""
import json, os, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS = os.path.join(ROOT, ".melonpan", "logs")
TARGET = ROOT


def newest_session():
    files = sorted(glob.glob(os.path.join(LOGS, "*.jsonl")), key=os.path.getmtime)
    return files[-1] if files else None


def safe_join(rel):
    rel = rel.replace("\\", "/").lstrip("/")
    while rel.startswith("../"):
        rel = rel[3:]
    return os.path.normpath(os.path.join(TARGET, rel))


def replay(path):
    vfs = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") != "TOOL_CALL":
            continue
        p = ev.get("payload") or {}
        name = p.get("name")
        args = p.get("args") or {}
        if name == "write_file":
            vfs[args.get("path", "")] = args.get("content", "")
        elif name == "edit_file":
            key = args.get("path", "")
            cur = vfs.get(key)
            if cur is None:
                continue
            hunks = args.get("edits")
            if hunks:
                for h in hunks:
                    s, r = h.get("search"), h.get("replace")
                    if s is None:
                        continue
                    if s not in cur:
                        print(f"  ! hunk miss in {key}: {s[:60]!r}", file=sys.stderr)
                        continue
                    cur = cur.replace(s, r, 1)
            else:
                s, r = args.get("search"), args.get("replace")
                if s is not None and s in cur:
                    cur = cur.replace(s, r, 1)
                else:
                    print(f"  ! edit miss in {key}", file=sys.stderr)
                    continue
            vfs[key] = cur
    return {k: v for k, v in vfs.items() if k}


def main():
    log = sys.argv[1] if len(sys.argv) > 1 else newest_session()
    if not log:
        print("no session log found", file=sys.stderr)
        return 1
    vfs = replay(log)
    written = 0
    for rel, content in sorted(vfs.items()):
        if rel.startswith("__") or "/__" in rel:
            continue
        dest = safe_join(rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(content)
        written += 1
        print(f"  synced {rel} ({len(content)} chars)")
    print(f"[vfs_sync] {written} files -> {TARGET} (from {os.path.basename(log)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
