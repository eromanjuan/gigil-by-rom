// Canonical MediaPipe FaceMesh vertex indices we care about.
// The full mesh is 468 points, plus 10 iris points when refineLandmarks is on.

export const LM = {
  foreheadTop: 10,
  chin: 152,
  noseTip: 1,
  noseBridge: 168,
  noseUnder: 2,
  nostrilL: 98,
  nostrilR: 327,
  eyeOuterL: 33,
  eyeInnerL: 133,
  eyeOuterR: 263,
  eyeInnerR: 362,
  eyeUpperL: 159,
  eyeLowerL: 145,
  eyeUpperR: 386,
  eyeLowerR: 374,
  irisL: 468,
  irisR: 473,
  mouthL: 61,
  mouthR: 291,
  lipTop: 13,
  lipBottom: 14,
  lipOuterTop: 0,
  lipOuterBottom: 17,
  cheekL: 50,
  cheekR: 280,
  faceEdgeL: 234,
  faceEdgeR: 454,
  templeL: 21,
  templeR: 251,
} as const

/** The face silhouette, as an ordered ring. Used for skull fitting and edge feathering. */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
]

/** Lip ring (outer). Vertices inside it get extra wobble - mouths are floppy. */
export const LIPS_OUTER = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37,
  39, 40, 185,
]

/** Both eye rings. Kept stiff so eyes don't smear when the face deforms. */
export const EYE_RING_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
export const EYE_RING_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]

/** Iris points only exist when the landmarker runs with refineLandmarks. */
export const IRIS_L = [468, 469, 470, 471, 472]
export const IRIS_R = [473, 474, 475, 476, 477]
