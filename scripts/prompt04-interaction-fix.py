from pathlib import Path

path = Path("apps/web/src/editor/PatternCanvas.tsx")
source = path.read_text(encoding="utf-8")
old = '''  function handleInternalPathPointerDown(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (event.button === 1 || spacePressedRef.current || toolRef.current === "hand") return false;
    const session = useInternalPathEditorStore.getState();
    const handleHit = findInternalPathHandleAt(event.clientX, event.clientY);
    if (handleHit) {'''
new = '''  function handleInternalPathPointerDown(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (event.button === 1 || spacePressedRef.current || toolRef.current === "hand") return false;
    const session = useInternalPathEditorStore.getState();
    if ((toolRef.current === "cut" || toolRef.current === "dart") && session.draftPathId) {
      session.appendDraftPoint(screenToActivePieceLocal(event.clientX, event.clientY));
      dragRef.current = null;
      scheduleDraw();
      return true;
    }
    const handleHit = findInternalPathHandleAt(event.clientX, event.clientY);
    if (handleHit) {'''
if source.count(old) != 1:
    raise SystemExit(f"internal path pointer dispatch occurrence count: {source.count(old)}")
source = source.replace(old, new, 1)
old_tail = '''    if (toolRef.current === "cut" || toolRef.current === "dart") {
      const local = screenToActivePieceLocal(event.clientX, event.clientY);
      if (session.draftPathId) session.appendDraftPoint(local);
      else session.startPath(activePieceId, toolRef.current === "dart" ? "dart" : "cut", local);
      dragRef.current = null;
      scheduleDraw();
      return true;
    }'''
new_tail = '''    if (toolRef.current === "cut" || toolRef.current === "dart") {
      const local = screenToActivePieceLocal(event.clientX, event.clientY);
      session.startPath(activePieceId, toolRef.current === "dart" ? "dart" : "cut", local);
      dragRef.current = null;
      scheduleDraw();
      return true;
    }'''
if source.count(old_tail) != 1:
    raise SystemExit(f"internal path start occurrence count: {source.count(old_tail)}")
path.write_text(source.replace(old_tail, new_tail, 1), encoding="utf-8")
