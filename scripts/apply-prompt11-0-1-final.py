from pathlib import Path
import runpy

# Compatibility fixes between the intentionally incremental recovery scripts.
stabilization = Path("scripts/apply-prompt11-0-1-stabilization.py")
text = stabilization.read_text(encoding="utf-8")
old = '''    "function selectInstanceSupportVertices(",\n    "export function xpbdInitializationTransferables",\n    "export function xpbdInitializationTransferables",\n)'''
new = '''    "function selectInstanceSupportVertices(",\n    "function appendEdge(",\n    "",\n)'''
if text.count(old) != 1:
    raise RuntimeError(f"adapter helper boundary mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old_condition = '''    && correspondences.every((pair) => (pair.region === "hip" || pair.region === "waist") && pair.neutralPlacement)'''
new_condition = '''    && correspondences.every((pair) => pair.region === "hip" || pair.region === "waist")'''
if text.count(old_condition) != 1:
    raise RuntimeError(f"lower-shell condition mismatch: {text.count(old_condition)}")
stabilization.write_text(text.replace(old_condition, new_condition, 1), encoding="utf-8")

dressing = Path("scripts/apply-prompt11-0-1-auto-dressing.py")
dressing_text = dressing.read_text(encoding="utf-8")
velocity_marker = "applyBodyContactVelocities(state.velocities, state.body);"
if dressing_text.count(velocity_marker) != 2:
    raise RuntimeError(f"auto dressing velocity marker mismatch: {dressing_text.count(velocity_marker)}")
dressing.write_text(
    dressing_text.replace(velocity_marker, "applyBodyContactVelocities(state.velocities, state.body, dt);"),
    encoding="utf-8",
)

for script in [
    "scripts/apply-prompt11-0-1-stabilization.py",
    "scripts/apply-prompt11-0-1-friction.py",
    "scripts/apply-prompt11-0-1-inelastic.py",
    "scripts/apply-prompt11-0-1-phase-switch.py",
    "scripts/apply-prompt11-0-1-post-body-structural.py",
    "scripts/apply-prompt11-0-1-cfl-velocity.py",
    "scripts/apply-prompt11-0-1-auto-dressing.py",
    "scripts/apply-prompt11-0-1-body-profile.py",
]:
    runpy.run_path(script, run_name="__main__")
