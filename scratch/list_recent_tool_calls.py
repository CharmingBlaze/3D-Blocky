import json

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
        if step <= 330:
            continue
        source = data.get("source")
        tool_calls = data.get("tool_calls", [])
        
        if tool_calls:
            print(f"Step {step} ({source}): {[t.get('name') for t in tool_calls]}")
