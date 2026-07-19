import json
import re

log_path = r"C:\Users\Snow\.gemini\antigravity\brain\98e1a089-adb7-4a02-bc4d-00788d3a50dc\.system_generated\logs\transcript_full.jsonl"

with open(log_path, "r", encoding="utf-8") as f:
    for line in f:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue
        
        step = data.get("step_index")
        # Find VIEW_FILE tool calls
        tool_calls = data.get("tool_calls", [])
        for tc in tool_calls:
            if tc.get("name") == "view_file":
                args = tc.get("args", {})
                if "UVEditorPanel.tsx" in args.get("AbsolutePath", ""):
                    print(f"Step {step}: StartLine={args.get('StartLine')}, EndLine={args.get('EndLine')}")
