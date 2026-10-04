// capturecheck.js — does the face just captured fit with the faces already
// captured? Run right after each capture, so a wrong turn or a misread is caught
// on the spot instead of surfacing at Verify as a list of impossible pieces.
//
// Every check is RELATIVE to what has been scanned so far — never to an assumed
// starting grip — and each is a property every real cube has, standard or mirror
// scheme, so a correctly followed scan can never trip one:
//   • centres (3x3): opposite faces have opposite centre colours; no two faces
//     share a centre; neighbouring faces never have opposite centres;
//   • pieces: a corner or edge seen on two captured faces never shows the same
//     colour twice, nor two opposite colours;
//   • the camera's picture never changed between two captures (reported by the
//     app's live read-out): the cube was not turned. Stickers alone can't tell —
//     two faces of a real 2x2 sometimes look identical — but motion can.

const OPPOSITE_COLOR = { W: 'Y', Y: 'W', G: 'B', B: 'G', R: 'O', O: 'R' };
const OPPOSITE_FACE = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };

// Which facelets each multi-sticker piece (corner or edge) shows, found by running
// unique labels through the size's own faces -> geometry builder, exactly as
// scanpath.js does — no orientation convention is restated here.
function pieceFacelets({ faceOrder, gridN, geomFromFaces }) {
  const labelled = {};
  for (const f of faceOrder) labelled[f] = Array.from({ length: gridN * gridN }, (_, i) => `${f}:${i}`);
  return geomFromFaces(labelled)
    .filter((c) => c.stickers.length >= 2)
    .map((c) =>
      c.stickers.map((s) => {
        const [face, idx] = s.color.split(':');
        return { face, idx: Number(idx) };
      })
    );
}

// Build the size's check. Returns checkCapture(faces, stepIndex, { unchanged })
// -> null when the face fits, else { message } in plain words. `unchanged` is
// true only when the app KNOWS the camera's picture didn't change since the
// previous capture; leave it unset when unknown.
export function makeCaptureCheck({ faceOrder, gridN, geomFromFaces, scanSequence, hasCenters, faceLabels, colorNames }) {
  const pieces = pieceFacelets({ faceOrder, gridN, geomFromFaces });
  const centre = Math.floor((gridN * gridN) / 2);
  const label = (f) => faceLabels[f];
  const name = (c) => colorNames[c];

  return function checkCapture(faces, stepIndex, { unchanged = false } = {}) {
    const f = scanSequence[stepIndex].face;
    const filled = (x) => Array.isArray(faces[x]) && faces[x].length === gridN * gridN && faces[x].every((c) => c != null);
    if (!filled(f)) return null;
    const others = faceOrder.filter((x) => x !== f && filled(x));

    if (unchanged && others.length) {
      return { message: `The picture hasn't changed since the last capture — the cube may not have been turned.` };
    }

    if (hasCenters) {
      const c = faces[f][centre];
      for (const y of others) {
        const cy = faces[y][centre];
        if (OPPOSITE_FACE[f] === y) {
          if (c !== OPPOSITE_COLOR[cy]) {
            return {
              message: `This should be the face opposite ${label(y)}, with a ${name(OPPOSITE_COLOR[cy])} centre — this one's centre is ${name(c)}.`,
            };
          }
        } else if (c === cy) {
          return { message: `This face's centre is ${name(c)}, the same as the ${label(y)} face already scanned.` };
        } else if (c === OPPOSITE_COLOR[cy]) {
          return {
            message: `This face's centre is ${name(c)}, which belongs opposite the ${label(y)} face (${name(cy)}), not beside it.`,
          };
        }
      }
    }

    for (const piece of pieces) {
      const mine = piece.filter((p) => p.face === f);
      if (!mine.length) continue;
      const seen = piece.filter((p) => p.face !== f && filled(p.face));
      for (const a of mine) {
        for (const b of seen) {
          const ca = faces[a.face][a.idx];
          const cb = faces[b.face][b.idx];
          if (ca === cb || OPPOSITE_COLOR[ca] === cb) {
            return {
              message:
                `This face doesn't fit beside the ${label(b.face)} face: one piece would show ` +
                (ca === cb ? `${name(ca)} twice.` : `${name(ca)} and ${name(cb)}, which are opposite colours.`),
            };
          }
        }
      }
    }
    return null;
  };
}
