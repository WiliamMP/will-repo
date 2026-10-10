// Dragging a branch (badge in the graph or sidebar row) onto another branch.
// A custom type, so text or files dragged over the app are ignored.
const TYPE = "application/x-will-branch";

export function dragBranch(e: React.DragEvent, name: string) {
  e.dataTransfer.setData(TYPE, name);
  e.dataTransfer.effectAllowed = "move";
}

/** true while a branch is being dragged over (the name itself is only readable on drop) */
export const isBranchDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TYPE);

export const droppedBranch = (e: React.DragEvent) => e.dataTransfer.getData(TYPE) || null;

/** Drop target props for anything that represents branch `target` */
export function branchDropProps(target: string, onDrop: (source: string, target: string, x: number, y: number) => void, setOver?: (over: boolean) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!isBranchDrag(e)) return;
      e.preventDefault(); // allows the drop
      e.dataTransfer.dropEffect = "move";
      setOver?.(true);
    },
    onDragLeave: () => setOver?.(false),
    onDrop: (e: React.DragEvent) => {
      setOver?.(false);
      const source = droppedBranch(e);
      if (!source || source === target) return;
      e.preventDefault();
      onDrop(source, target, e.clientX, e.clientY);
    },
  };
}
