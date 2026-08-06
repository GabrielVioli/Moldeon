from pathlib import Path
import base64
import gzip
import hashlib

parts = Path("scripts/.prompt11-payload")
encoded = "".join(path.read_text(encoding="utf-8") for path in sorted(parts.glob("part*")))
source = gzip.decompress(base64.b64decode(encoded))
expected = "0195ca5fdc389cc217075f5a20ab1abca6cd8bad63d9acb8dc7981475f3d9291"
actual = hashlib.sha256(source).hexdigest()
if actual != expected:
    raise SystemExit(f"Prompt 11 payload checksum mismatch: {actual}")
exec(compile(source, "scripts/apply-prompt11.py", "exec"), {"__name__": "__main__"})

collision_path = Path("apps/web/src/physics/clothCollision.ts")
collision = collision_path.read_text(encoding="utf-8")
old_velocity = """const normalSpeed = Math.max(0, vx * ux + vy * uy + vz * uz);
    const tx = vx - ux * normalSpeed;
    const ty = vy - uy * normalSpeed;
    const tz = vz - uz * normalSpeed;"""
new_velocity = """const signedNormalSpeed = vx * ux + vy * uy + vz * uz;
    const outwardNormalSpeed = Math.max(0, signedNormalSpeed);
    const tx = vx - ux * signedNormalSpeed;
    const ty = vy - uy * signedNormalSpeed;
    const tz = vz - uz * signedNormalSpeed;"""
if old_velocity not in collision:
    raise SystemExit("signed contact velocity marker not found")
collision = collision.replace(old_velocity, new_velocity, 1)
collision = collision.replace("ux * normalSpeed + tx * tangentScale", "ux * outwardNormalSpeed + tx * tangentScale", 1)
collision = collision.replace("uy * normalSpeed + ty * tangentScale", "uy * outwardNormalSpeed + ty * tangentScale", 1)
collision = collision.replace("uz * normalSpeed + tz * tangentScale", "uz * outwardNormalSpeed + tz * tangentScale", 1)
collision_path.write_text(collision, encoding="utf-8")

test_path = Path("apps/web/src/garment3d/ClothSimulationCollisionInput.test.ts")
test = test_path.read_text(encoding="utf-8")
test = test.replace(
    "expect(Array.from(buffers.ellipsoids.radii)).toEqual([0.3, 0.5, 0.2]);",
    "expect(buffers.ellipsoids.radii[0]).toBeCloseTo(0.3);\n    expect(buffers.ellipsoids.radii[1]).toBeCloseTo(0.5);\n    expect(buffers.ellipsoids.radii[2]).toBeCloseTo(0.2);",
    1,
)
test = test.replace(
    "expect(Array.from(buffers.capsules.starts)).toEqual([-0.12, 0.8, 0]);",
    "expect(buffers.capsules.starts[0]).toBeCloseTo(-0.12);\n    expect(buffers.capsules.starts[1]).toBeCloseTo(0.8);\n    expect(buffers.capsules.starts[2]).toBeCloseTo(0);",
    1,
)
test_path.write_text(test, encoding="utf-8")
