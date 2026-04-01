import type { MeiosisCell } from 'meiosis-setup/types';
import type { AppState } from './types';

const MAX_HISTORY = 30;

export interface UndoRedoState {
  past: AppState[];
  future: AppState[];
}

const undoRedo: UndoRedoState = { past: [], future: [] };

let lastSnapshot: AppState | null = null;

/** Call this after any user-driven update to snapshot for undo. */
export function pushHistory(state: AppState): void {
  if (lastSnapshot && JSON.stringify(lastSnapshot) === JSON.stringify(state)) return;
  if (lastSnapshot) {
    undoRedo.past.push(lastSnapshot);
    if (undoRedo.past.length > MAX_HISTORY) undoRedo.past.shift();
  }
  undoRedo.future = [];
  lastSnapshot = state;
}

export function canUndo(): boolean {
  return undoRedo.past.length > 0;
}

export function canRedo(): boolean {
  return undoRedo.future.length > 0;
}

export function undo(cell: MeiosisCell<AppState>): void {
  if (!canUndo()) return;
  const prev = undoRedo.past.pop()!;
  if (lastSnapshot) undoRedo.future.unshift(lastSnapshot);
  lastSnapshot = prev;
  cell.update(prev);
}

export function redo(cell: MeiosisCell<AppState>): void {
  if (!canRedo()) return;
  const next = undoRedo.future.shift()!;
  if (lastSnapshot) undoRedo.past.push(lastSnapshot);
  lastSnapshot = next;
  cell.update(next);
}
