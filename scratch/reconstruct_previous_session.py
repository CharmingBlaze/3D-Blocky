import json
import re

log_path = r"C:\Users\Snow\.gemini\antigravity\brain\98e1a089-adb7-4a02-bc4d-00788d3a50dc\.system_generated\logs\transcript_full.jsonl"
file_path = r"c:\Users\Snow\Documents\Projects\blocky3D - Copy\src\components\UVEditorPanel.tsx"

# First restore to clean HEAD to ensure we start from the correct baseline
import subprocess
subprocess.run(["git", "restore", file_path], check=True)

# Read the file content
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Load all replace_file_content calls from steps 150 to 260
replacements = []
with open(log_path, "r", encoding="utf-8") as f:
    for line in f:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue
        
        step = data.get("step_index")
        if 150 <= step <= 270:
            # Check for tool calls
            # Can be in planner response
            tool_calls = data.get("tool_calls", [])
            for tc in tool_calls:
                if tc.get("name") == "replace_file_content":
                    args = tc.get("args", {})
                    # Make sure it targets UVEditorPanel.tsx
                    if "UVEditorPanel.tsx" in args.get("TargetFile", ""):
                        replacements.append({
                            "step": step,
                            "target": args.get("TargetContent"),
                            "replacement": args.get("ReplacementContent")
                        })

print(f"Found {len(replacements)} replacements from steps 150-270.")

# Apply each replacement in order
for r in replacements:
    step = r["step"]
    target = r["target"]
    rep = r["replacement"]
    
    if target in content:
        content = content.replace(target, rep)
        print(f"Applied replacement from step {step} successfully.")
    else:
        # Try normalizing whitespace/newlines in case of line ending mismatches
        target_norm = target.replace("\r\n", "\n").replace("\r", "\n")
        content_norm = content.replace("\r\n", "\n").replace("\r", "\n")
        if target_norm in content_norm:
            # We need to perform the replace while preserving original newlines if possible
            # Or just normalize the whole content to LF and then convert back if needed
            content = content_norm.replace(target_norm, rep.replace("\r\n", "\n").replace("\r", "\n"))
            print(f"Applied normalized replacement from step {step} successfully.")
        else:
            print(f"WARNING: Target not found for step {step}!")
            print("Target sample:", repr(target[:100]))

# Save the restored file
with open(file_path, "w", encoding="utf-8", newline="\r\n") as f:
    f.write(content)

print("Done restoring UVEditorPanel.tsx.")
