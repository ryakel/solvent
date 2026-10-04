// issues.js — validator findings that point at stickers.
//
// Each finding is { message, cells: [[face, idx], ...] }: the plain-language
// message the Verify step lists, plus the stickers it is about, so the net can
// mark exactly what to look at instead of leaving the user to decode "the URF
// corner". A finding with no cells (e.g. a global twist parity) is still listed.
// Repeated messages merge into one finding.

export function issueList() {
  const issues = [];
  const byMessage = new Map();
  return {
    add(message, cells = []) {
      let it = byMessage.get(message);
      if (!it) {
        it = { message, cells: [] };
        byMessage.set(message, it);
        issues.push(it);
      }
      for (const [face, idx] of cells) {
        if (!it.cells.some(([f, i]) => f === face && i === idx)) it.cells.push([face, idx]);
      }
    },
    get length() {
      return issues.length;
    },
    messages: () => issues.map((i) => i.message),
    issues: () => issues,
  };
}
