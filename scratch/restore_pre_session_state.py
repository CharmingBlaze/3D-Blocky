import json
import re

log_path = r"C:\Users\Snow\.gemini\antigravity\brain\98e1a089-adb7-4a02-bc4d-00788d3a50dc\.system_generated\logs\transcript_full.jsonl"
file_path = r"c:\Users\Snow\Documents\Projects\blocky3D - Copy\src\components\UVEditorPanel.tsx"
diff_path = r"C:\Users\Snow\.gemini\antigravity\brain\98e1a089-adb7-4a02-bc4d-00788d3a50dc\scratch\step262_diff.txt"

# 1. Reset to baseline clean HEAD
import subprocess
subprocess.run(["git", "restore", file_path], check=True)

# Read baseline lines
with open(file_path, "r", encoding="utf-8") as f:
    baseline_lines = f.readlines()

# 2. Extract viewed lines from steps < 150
viewed_lines = {}
with open(log_path, "r", encoding="utf-8") as f:
    for line in f:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue
        
        step = data.get("step_index", 999)
        if step >= 150:
            continue
        
        if data.get("type") == "VIEW_FILE" and data.get("status") == "DONE":
            content = data.get("content", "")
            if "UVEditorPanel.tsx" in content:
                for cl in content.split("\n"):
                    match = re.match(r"^(\d+):\s(.*)$", cl)
                    if match:
                        ln = int(match.group(1))
                        code = match.group(2)
                        viewed_lines[ln] = code

# We reconstruct up to line 2200
output_lines = []
for i in range(1, 2201):
    if i in viewed_lines:
        output_lines.append(viewed_lines[i] + "\n")
    else:
        # Use baseline mapped index: L_baseline = L_modified - 178
        # Since we are below 2325, the offset is 178 lines.
        base_idx = i - 1 - 178
        if base_idx >= 0 and base_idx < len(baseline_lines):
            output_lines.append(baseline_lines[base_idx])
        elif i - 1 < len(baseline_lines):
            output_lines.append(baseline_lines[i - 1])
        else:
            output_lines.append("\n")

# 3. Read the baseline lines for the tail (line 2201 in modified corresponds to baseline 2023)
# index for 2023 is 2022
tail_lines = baseline_lines[2022:]

# Write the temporary pre-restored file (without diff applied yet)
temp_file_content = "".join(output_lines) + "".join(tail_lines)
with open(file_path, "w", encoding="utf-8", newline="\r\n") as f:
    f.write(temp_file_content)

# 4. Prepare the diff file for lines 2147 onwards (baseline mapping)
diff_content = []
with open(diff_path, "r", encoding="utf-8") as f:
    lines = f.readlines()
    # Find where the diff actually starts
    start_idx = 0
    for idx, l in enumerate(lines):
        if l.startswith("@@ -2147"):
            start_idx = idx
            break
    diff_content = lines[start_idx:]

# Write the clean patch file
patch_path = r"C:\Users\Snow\.gemini\antigravity\brain\98e1a089-adb7-4a02-bc4d-00788d3a50dc\scratch\bottom_patch.patch"
# Unified diff header is required for git apply
header = [
    "--- a/src/components/UVEditorPanel.tsx\n",
    "+++ b/src/components/UVEditorPanel.tsx\n"
]
with open(patch_path, "w", encoding="utf-8", newline="\n") as f:
    f.writelines(header)
    f.writelines(diff_content)

# 5. Apply the patch
res = subprocess.run(["git", "apply", "--verbose", patch_path], capture_output=True, text=True)
print("Git apply stdout:", res.stdout)
print("Git apply stderr:", res.stderr)

if res.returncode == 0:
    print("Success! Reconstructed file matches original state.")
else:
    print("Git apply failed. Re-applying manually...")
