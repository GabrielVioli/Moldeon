from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Trecho não encontrado em {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1. Force a real redraw whenever a responsive/mobile preview becomes active.
replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''    this.resizeObserver = new ResizeObserver(() => {\n      this.resize();\n      this.requestRender();\n    });''',
    '''    this.resizeObserver = new ResizeObserver(() => {\n      this.refresh();\n    });''',
)
replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''      viewport.resize();\n      viewport.requestRender();''',
    '''      viewport.refresh();''',
)
replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''  dress(): void {\n    this.frameDressedScene();\n    this.requestRender();\n  }''',
    '''  dress(): void {\n    this.refresh();\n  }\n\n  refresh(): void {\n    if (this.disposed) return;\n    this.resize();\n    this.frameDressedScene();\n    this.controls.update();\n    this.renderer.render(this.scene, this.camera);\n    this.requestRender();\n  }''',
)
replace_once(
    "apps/web/src/viewport/GarmentViewport.tsx",
    '''        if (latestActiveRef.current && latestSimulateVersionRef.current > 0) {\n          viewport.dress();\n          lastDressedVersionRef.current = latestSimulateVersionRef.current;\n        }''',
    '''        if (latestActiveRef.current && latestSimulateVersionRef.current > 0) {\n          viewport.dress();\n          lastDressedVersionRef.current = latestSimulateVersionRef.current;\n        } else if (latestActiveRef.current) {\n          viewport.refresh();\n        }''',
)
replace_once(
    "apps/web/src/viewport/GarmentViewport.tsx",
    '''  useEffect(() => {\n    if (simulateVersion <= lastDressedVersionRef.current || !viewportRef.current) return;\n    viewportRef.current.dress();\n    lastDressedVersionRef.current = simulateVersion;\n  }, [simulateVersion]);''',
    '''  useEffect(() => {\n    if (!active) return;\n    const frame = window.requestAnimationFrame(() => viewportRef.current?.refresh());\n    return () => window.cancelAnimationFrame(frame);\n  }, [active]);\n\n  useEffect(() => {\n    if (simulateVersion <= lastDressedVersionRef.current || !viewportRef.current) return;\n    viewportRef.current.dress();\n    lastDressedVersionRef.current = simulateVersion;\n  }, [simulateVersion]);''',
)

# 2. Preserve a continuous human mannequin and remove the artificial shoulder-depth collapse.
replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''      receiveShadow: this.profile.shadows,\n      hiddenPartNames: arrangement.coveredAvatarPartNames,''',
    '''      receiveShadow: this.profile.shadows,''',
)
replace_once(
    "apps/web/src/garment3d/SemanticAvatarArrangement.ts",
    '''  const shoulderDepthRange = Math.max(\n    0.08,\n    avatar.landmarks.shoulderY - avatar.landmarks.bustY,\n  );\n\n''',
    '''''',
)
replace_once(
    "apps/web/src/garment3d/SemanticAvatarArrangement.ts",
    '''    const shoulderProgress = instance.placement.region === "torso"\n      ? clamp01((topY - worldY) / shoulderDepthRange)\n      : 1;\n    const depthScale = instance.placement.region === "torso"\n      ? lerp(0.16, 1, smoothstep(shoulderProgress))\n      : 1;\n    const radialWidth = axes.halfWidth + anchor.initialMarginM * 0.62;\n    const radialDepth = axes.halfDepth * depthScale + anchor.initialMarginM;''',
    '''    const radialWidth = axes.halfWidth + anchor.initialMarginM * 0.62;\n    const radialDepth = axes.halfDepth + anchor.initialMarginM;''',
)

# 3. Strengthen the semantic test so shoulder vertices remain on the anatomical shell.
test_path = Path("apps/web/src/garment3d/SemanticAvatarArrangement.test.ts")
test_text = test_path.read_text(encoding="utf-8")
needle = '''    expect(visible.every((instance) => instance.arrangement?.anchorId)).toBe(true);\n    expect(result.state.positions.every(Number.isFinite)).toBe(true);'''
replacement = '''    expect(visible.every((instance) => instance.arrangement?.anchorId)).toBe(true);\n    const torso = visible.filter((instance) => instance.placement.region === "torso");\n    const shoulderDepths = torso.flatMap((instance) => Array.from({ length: instance.vertexCount }, (_, local) => {\n      const y = result.state.positions[(instance.particleStart + local) * 3 + 1];\n      const z = Math.abs(result.state.positions[(instance.particleStart + local) * 3 + 2]);\n      return y >= result.avatar.landmarks.bustY ? [z] : [];\n    }));\n    expect(Math.min(...shoulderDepths)).toBeGreaterThan(0.025);\n    expect(result.state.positions.every(Number.isFinite)).toBe(true);'''
if needle not in test_text:
    raise RuntimeError("Trecho do teste semântico não encontrado")
test_path.write_text(test_text.replace(needle, replacement, 1), encoding="utf-8")

print("Avatar visual corrections applied")
