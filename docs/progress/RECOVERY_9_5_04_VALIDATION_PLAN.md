# 9.5-04 blocker validation plan

Validation is read-only over the branch commit. GitHub Actions may only checkout, typecheck, test and build.

Manual preview must verify:

1. click/tap empty clears single and multiple piece selection;
2. empty clears point/handle/segment and no hidden IDs remain;
3. Escape clears selection;
4. zoom/pan/pinch do not masquerade as empty clicks;
5. selected single piece shows `↻` outside the top-right selection corner;
6. drag rotates around the piece center with live angle;
7. Shift snapping works in 15° increments;
8. pointer up is one undo step; undo and redo restore/reapply rotation;
9. pointer cancel/Escape during rotation restores the prior transform;
10. desktop and mobile touch targets remain usable.
