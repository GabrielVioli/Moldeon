from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    if old not in source:
        raise SystemExit(f"{path}: missing {old[:120]!r}")
    file.write_text(source.replace(old, new, 1), encoding="utf-8")


patch(
    "apps/web/src/App.tsx",
    'const MOBILE_QUERY = "(max-width: 760px)";\n',
    'const MOBILE_QUERY = "(max-width: 760px)";\nconst COMPACT_WORKSPACE_QUERY = "(max-width: 1180px)";\n',
)
patch(
    "apps/web/src/App.tsx",
    '''  const isMobile = useMediaQuery(MOBILE_QUERY);
  const eligibility = useMemo(() => evaluateGarment3DEligibility(garment), [garment]);
''',
    '''  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isCompactWorkspace = useMediaQuery(COMPACT_WORKSPACE_QUERY);
  const eligibility = useMemo(() => evaluateGarment3DEligibility(garment), [garment]);
''',
)
patch(
    "apps/web/src/App.tsx",
    '''    if (isMobile) setMobileView("preview");
    simulate();
  }, [isMobile, simulate]);
''',
    '''    if (isCompactWorkspace) setMobileView("preview");
    simulate();
  }, [isCompactWorkspace, simulate]);
''',
)
patch(
    "apps/web/src/App.tsx",
    '''    if (isMobile) setMobileView("preview");
  }, [isMobile]);
  const closeRightPanel = useCallback(() => {
    setIsRightPanelOpen(false);
    if (isMobile) setMobileView("editor");
  }, [isMobile]);
  const openRightPanel = useCallback((view: WorkspaceView = "preview") => {
    setIsRightPanelOpen(true);
    if (isMobile) setMobileView(view);
  }, [isMobile]);
''',
    '''    if (isCompactWorkspace) setMobileView("preview");
  }, [isCompactWorkspace]);
  const closeRightPanel = useCallback(() => {
    setIsRightPanelOpen(false);
    if (isCompactWorkspace) setMobileView("editor");
  }, [isCompactWorkspace]);
  const openRightPanel = useCallback((view: WorkspaceView = "preview") => {
    setIsRightPanelOpen(true);
    if (isCompactWorkspace) setMobileView(view);
  }, [isCompactWorkspace]);
''',
)
patch(
    "apps/web/src/App.tsx",
    '''      if (isMobile) setMobileView("editor");
    },
    [isMobile, loadGarment],
''',
    '''      if (isCompactWorkspace) setMobileView("editor");
    },
    [isCompactWorkspace, loadGarment],
''',
)
patch(
    "apps/web/src/App.tsx",
    '            title={isMobile ? "Voltar à bancada 2D" : "Recolher painel direito"}\n',
    '            title={isCompactWorkspace ? "Voltar à bancada 2D" : "Recolher painel direito"}\n',
)
patch(
    "apps/web/src/App.tsx",
    '            <span>{isMobile ? "Voltar à bancada" : "Recolher"}</span>\n',
    '            <span>{isCompactWorkspace ? "Voltar à bancada" : "Recolher"}</span>\n',
)
patch(
    "apps/web/src/App.tsx",
    '                active={isRightPanelOpen && (!isMobile || mobileView === "preview")}\n',
    '                active={isRightPanelOpen && (!isCompactWorkspace || mobileView === "preview")}\n',
)

path = Path("apps/web/src/styles.css")
source = path.read_text(encoding="utf-8")
marker = "/* Prompt 5: compact landscape workspace access */"
addition = r'''

/* Prompt 5: compact landscape workspace access */
@media (min-width: 761px) and (max-width: 1180px) {
  .workspace.mode-modeling,
  .workspace.mode-assembly,
  .workspace.mode-fitting,
  .workspace.mode-preparation {
    position: relative;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 44px minmax(0, 1fr);
    min-width: 0;
  }

  .mobile-workspace-tabs {
    z-index: 4;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-column: 1;
    grid-row: 1;
    gap: 4px;
    min-width: 0;
    padding: 4px;
    background: #dfdcd5;
    border-bottom: 1px solid #c3c0ba;
  }

  .workspace-tab {
    min-width: 0;
    min-height: 36px;
    padding: 0 8px;
    overflow: hidden;
    color: #696a66;
    background: transparent;
    border-radius: 7px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-tab[aria-selected="true"] {
    color: #17181a;
    background: #f7f5f0;
    box-shadow: 0 1px 3px rgba(20, 20, 20, 0.12);
  }

  .workspace.mode-modeling .workspace-view,
  .workspace.mode-assembly .workspace-view,
  .workspace.mode-fitting .workspace-view,
  .workspace.mode-preparation .workspace-view {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .workspace.mode-modeling .workspace-view.is-mobile-active,
  .workspace.mode-assembly .workspace-view.is-mobile-active,
  .workspace.mode-fitting .workspace-view.is-mobile-active,
  .workspace.mode-preparation .workspace-view.is-mobile-active {
    z-index: 2;
    visibility: visible;
    pointer-events: auto;
  }

  .inspector.workspace-view,
  .assembly-panel.workspace-view,
  .placement-panel.workspace-view {
    display: block;
    width: 100%;
    min-width: 0;
    max-width: none;
    padding: 14px 18px;
    border-left: 0;
    resize: none;
    overflow: auto;
  }

  .workspace.is-right-panel-closed.mode-modeling,
  .workspace.is-right-panel-closed.mode-assembly,
  .workspace.is-right-panel-closed.mode-fitting,
  .workspace.is-right-panel-closed.mode-preparation {
    grid-template-rows: 44px minmax(0, 1fr);
  }

  .workspace.is-right-panel-closed .editor-panel {
    grid-row: 2;
    visibility: visible;
    pointer-events: auto;
  }
}
'''
if marker not in source:
    path.write_text(source + addition, encoding="utf-8")
print("Prompt 5 compact workspace state and layout patch applied")
