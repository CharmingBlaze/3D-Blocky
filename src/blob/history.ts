// ---------------------------------------------------------------------------
// history.ts — undo/redo. Sculpt strokes only store the vertices they
// actually touched (not a full mesh snapshot), so undo stays cheap even on
// dense meshes. Doodle add/delete just stores the whole object, since those
// are naturally one command each.
// ---------------------------------------------------------------------------

import { IndexedMesh } from './mesh';
import { HistoryCommand, Vec3 } from './types';

export class HistoryStack {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 100) {
    this.maxDepth = maxDepth;
  }

  push(command: HistoryCommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = []; // new action invalidates redo branch
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}

/** Builds an undo/redo command from a brush stroke's touched-vertex list. */
export function createSculptCommand(
  mesh: IndexedMesh,
  touched: { index: number; before: Vec3 }[],
  label = 'Sculpt',
): HistoryCommand {
  const after = touched.map(t => ({ index: t.index, after: mesh.getPos(t.index) }));
  return {
    label,
    undo(): void {
      for (const t of touched) mesh.setPos(t.index, t.before);
      mesh.recomputeNormals();
    },
    redo(): void {
      for (const t of after) mesh.setPos(t.index, t.after);
      mesh.recomputeNormals();
    },
  };
}
