# Gigil!

Upload a photo. It becomes a 3D head. Hit it.

A browser-based physics sandbox: a still photo is turned into a textured 3D
bust that reacts to punches, slaps, eye pokes, nose pinches, strangling and
spit — each on its own hotkey, each with its own hit reaction, deformation,
synthesised sound and comic-book impact pop.

**Everything runs client-side.** The photo is never uploaded anywhere; face
detection, texturing and physics all happen in the browser.

## Running it

```bash
npm install     # also fetches the MediaPipe model into public/
npm run dev     # http://localhost:5173
```

If `npm install` couldn't reach the network, run `npm run setup:assets` later
to fetch them. Failing that, the app falls back to a CDN at runtime.

```bash
npm run build   # typecheck + production bundle
```

## Controls

| Key | Move | Notes |
| --- | --- | --- |
| `Z` | Punch | Alternates sides; the heaviest hit |
| `X` | Slap L | Swings in from the left, leaves a handprint |
| `C` | Slap R | The same, mirrored |
| `V` | Poke Eyes | Dents and puffs each eye independently |
| `B` | Pinch Nose | Grabs, squeezes and wrings |
| `N` | Strangle | **Hold** — damage ticks until released |
| `M` | Spit | Travels, then splats and drips |

Every move is also a button in the dock, so it works on touch. The dock
highlights whichever key you actually press.

## What this deliberately doesn't do

Damage is stylised — swelling, flushing and bruises that ripen from red to
purple. There is no blood, no lacerations and no asphyxiation colouring, and
that's a design decision rather than an omission.

The app renders a real, identifiable person from an uploaded photo, and it's
explicitly built to keep them recognisable at any damage level. Pairing that
with photoreal injury would make it a straightforward tool for producing
harassment material about a specific person — upload a classmate or an ex and
it does the rest. Stylised damage gives the same escalation curve without
producing something that reads as a photograph of a real person's injuries.

`MAX_SWELL` in `deform.ts` is the related cap: swelling accumulates toward a
ceiling and stops, so no amount of pounding dissolves the features.

## How the head gets built

The interesting part is turning one 2D photo into something you can punch.

1. **Landmarks.** MediaPipe's Face Landmarker finds 478 points, each with an
   estimated depth.
2. **Frontalisation.** Almost nobody uploads a dead-on portrait. An orthonormal
   basis is built from the interocular and brow-to-chin axes, and its inverse
   is applied to the point cloud. A three-quarter photo becomes a head facing
   the player. Without this the reconstruction stays turned away and can never
   line up with the skull behind it.
3. **Triangulation.** Delaunay over the *frontalised* projection — triangulating
   the original projection collapses the far half of a turned face into slivers
   and tears holes through the nose. Sliver and long-edge triangles are culled.
4. **The rest of the head.** The face is only a front shell. The cranium is
   built by sweeping the face's own silhouette ring backwards, upwards and
   inwards to a pole. An ellipsoid can't do this job: to close the silhouette it
   has to be as wide as the face, and anything that wide pushes through the
   cheeks, leaving just the nose and lips poking out of a bald ball. Growing the
   cap from the boundary makes the seam exact by construction.
5. **Separate layers.** Hair, ears, neck and clothing are distinct meshes over
   that cranium. Hair gets its own file (`hair.ts`) and is described below.
   Ears are an extruded outline with a helix and lobe; stacked spheres never
   read as ears.
   The neck-to-shoulder transition is a single loft, because a cylinder jammed
   into a sphere creases exactly where the eye expects a slope.
6. **Blending.** Skin, hair and clothing tones are all sampled from the photo —
   hair by probing a fan of points above the brow and keeping whatever reads
   least like skin, clothing by probing below the jaw and rejecting anything
   close to skin tone. The photo's overall colour cast also tints the key and
   fill lights, so the generated body isn't lit by a different sun than the
   face. The face texture dissolves into flat skin at the silhouette, hiding
   both the seam and the stray background pixels the landmark oval picks up
   just outside the real edge.

## The hair

Hair is the one part of the head the landmarks say nothing at all about —
MediaPipe stops at the hairline — so it's built in two stages: segment it out
of the photo, then grow geometry that matches what was found.

### Getting it out of the photo

Three tones are already known: skin from the cheeks, hair from a probe fan
above the brow, background from the image border. So a pixel is classified by
which of the three it's nearest in linear RGB, rather than by any fixed
threshold — that's what makes it work on blonde-against-white and
black-against-black alike, where a brightness cutoff picks one and fails the
other. The colour score is then gated on geometry, because colour alone will
happily call a dark jumper or a shadowed jaw "hair": inside the face oval is a
face, below the chin is a collar, and past about 1.35 face-heights from the
skull is somebody else's problem.

That produces a mask, which is then blurred — it drives geometry, and an
unsmoothed one puts a visible staircase on the hairline.

To ask the mask about a point on the 3D skull, there's a least-squares affine
fit from head-local space back into photo UV, over all 478 landmarks. It's
exact for a frontal photo and degrades gracefully once frontalisation has
rotated a turned one.

### Growing geometry from it

- **The outline is the photo's.** Shell coverage comes from the mask, so the
  widow's peak, the fringe, the receding temples and the parting are the
  subject's own rather than a jittered horizontal cut.
- **So is the volume.** Each column steps outward from the skull in head space,
  projecting as it goes, until the mask gives out — so a big style builds big.
  The stepping is done in world space and projected, not marched in UV, because
  u and v are normalised by image width and height separately and a step of
  equal UV length isn't one of equal world length unless the photo is square.
- **So is the colour**, sampled per vertex, which is what carries dye, grey,
  roots and sun-bleached ends. This does bake the photo's own lighting into the
  albedo — the same trade the face texture already makes.
- **The camera never saw the back of the head**, so all three hand back to a
  procedural rule as they wrap around, smoothly. A hard switchover draws a ring
  right around the skull where the two disagree.

### Making it read as hair

A single offset shell reads as a painted swim cap however good the hairline is,
because three things are missing: bulk that varies across the head, strand
direction, and a broken silhouette. `hair.ts` builds all three.

- **Volume**, not a constant offset. Where the photo can't measure it, the
  shell grows off the cranium along a lobed thickness profile driven by fbm, so
  it swells over the crown and back and its silhouette is never a clean dome.
- **A flow tangent per vertex**, pointing away from the crown whorl and
  projected onto the surface. That drives a Kajiya-Kay anisotropic highlight —
  two shifted lobes, a tight white one off the cuticle and a broad tinted one
  from light that has passed through the strand. Hair scatters *along* the
  strand rather than about a normal, so the specular is a band running across
  the head, and that band is most of what separates hair from moulded plastic.
- **Wisps** — tapered tubes, not ribbons — rooted on the outer rings and grown
  past the shell's edge so the outline is ragged. A ribbon has to face
  somewhere, and at the silhouette, exactly where these matter, it turns
  edge-on and vanishes. Three sides read from every angle.

Two supporting details: the cut-off alpha is jittered per column and applied
*before* the alpha test, so the edge is chewed per strand instead of following
one smooth contour; and the scalp underneath is vertex-painted toward hair tone,
so a gap at a silhouette shows dark scalp rather than a bald patch.

The sheen is lit by hand rather than through three's light loop, so `Game.ts`
pushes the key light's direction and colour into the hair uniforms whenever the
light panel moves it.

## The hands

First-person hands are fully articulated: five digits, three hinged joints
each, driven by a small pose library (`fist`, `flat`, `poke`, `pinchOpen/Closed`,
`clawOpen/Closed`) that attacks blend between, so a grab closes rather than
snapping shut. Two details do most of the work:

- **Aiming is by contact point, not wrist.** Each hand declares the point that
  actually touches the target, and attacks solve the wrist position from it.
  Repose or reproportion a hand and the aim follows instead of silently drifting.
- **Phalanx capsules overlap** their segment by 20%. Butted exactly together,
  every knuckle shows a seam and the rig reads as a pile of detached sausages.
- **Skin is translucent, and unevenly so.** Standard PBR gets the specular on
  skin right and the diffuse wrong, because skin isn't an opaque surface —
  light enters it, scatters and leaves somewhere else, so flesh stays warm
  where a plastic model goes flat black. Every part carries a `THINNESS` value,
  and a fresnel term adds light back where the surface turns away from you:
  fingertips and the webbing glow, the heel of the palm and the forearm barely
  do. That single gradient is most of the distance between "hand" and "mannequin
  hand". The phalanx index is part of the geometry cache key because of it —
  sharing a capsule between a knuckle and a fingertip would light one wrongly.

## How hits feel

No physics engine. Rigid bodies are hard to make punchy, and they can't squash.
Instead:

- **Springs** (`springs.ts`) drive positional recoil, neck twist and
  squash-stretch. Fixed-stepped at 120Hz so a slow frame can't detonate the head.
- **The body follows the head.** A second, softer pair of springs chases where
  the head has got to rather than taking the impulse itself, so the shoulders
  arrive late and travel about a third as far — which is the whole of what
  reads as a light head on a heavy body. Chasing the head's *result* rather
  than the hit means everything drags the body along for free: a punch, a
  throttle shaking it, a nose being wrung. None of them know the body exists.
  The head is parented under the torso so the neck can't leave the collar, and
  the body's travel is subtracted back out of the head's — otherwise riding the
  body would double every recoil.
- **A deformation shader** (`deform.ts`) injects vertex displacement into the
  standard PBR material, so dents still light correctly. Up to 8 concurrent
  impacts, each with a push/pinch/pull mode and an envelope that bites in fast,
  holds, then springs back with one elastic overshoot.
- **Per-vertex flex** decides who moves: rigid at the silhouette where the face
  is welded to the skull, soft over the cheeks, floppiest at the lips, firm
  across the eyes so they don't smear into their sockets.
- **Swelling** is a second, persistent field: hits within a short distance of
  each other merge into one site that deepens, so working the same cheek puffs
  it up instead of stacking overlapping bumps. Capped at `MAX_SWELL`.
- **Damage accumulates** into a bruise layer painted in the photo's own UV
  space and multiplied over the face, so a worked-over face stays worked over
  until you hit Heal. Marks ripen over ~20 seconds from fresh red to the dull
  purple of a real bruise.
- **Impacts are synthesised** at runtime (`audio.ts`) — gated noise bursts plus
  pitch-swept tones, and a reflex yelp that's a sawtooth pushed through three
  formant bandpasses. No sample files, so pitch and length react to how hard
  the hit landed.
- **The voice is recorded.** Five clips in `public/voice` — "aray", "aruy",
  "aww", "ouch" and the sobbing "huhuhu". Synthesis was tried first and lost:
  formant synthesis can produce the *shape* of a word, but a real person in
  pain has a rasp and a break in it that a filter bank doesn't. What gets said
  climbs with the damage, and the lines are rationed — one at a time, with a
  gap after each — because a head that talks on every frame of a combo stops
  being funny in about four seconds.

## Layout

```
public/voice/      the five recorded pain lines
src/game/
  faceBuilder.ts   photo -> frontalised face mesh, tone sampling, hair mask
  bust.ts          cranium, ears, neck and clothing around that mesh
  hair.ts          hair shell, wisps and the anisotropic sheen material
  deform.ts        impact + swelling fields, PBR shader injection
  springs.ts       recoil, twist and squash
  attacks.ts       the six moves, as keyframed timelines
  hands.ts         articulated hand rig and pose library
  fx.ts            particles, impact flashes, camera shake
  audio.ts         WebAudio synthesis
  Game.ts          scene, lights, loop, input, scoring
src/ui/            React shell: uploader, HUD, hotkey dock, light panel
```

`src/devHandsTest.ts` + `hands-test.html` are a dev-only rig inspector, served
at `/hands-test.html`. It renders every hand pose open and closed with the
contact points marked — far faster than diagnosing hand geometry from
gameplay frames. Not part of the app bundle.

`src/devHandModelTest.ts` + `hand-model-test.html` is a GLB inspector at
`/hand-model-test.html`. It splits `hand.glb` into its six pieces and lays them
out with their index numbers, already canonicalised — which is how the
piece-to-move mapping below was established, since reading a pose off a mesh is
a job for eyes and not for cluster analysis.

### The scanned hands

`public/models/hands/hand.glb` is a photoscan holding **six separate hands in
six poses**, laid out side by side like a product sheet. `handModel.ts` splits
it into connected pieces and assigns one pose per move:

| piece | move |
| --- | --- |
| 1 | Punch |
| 2 | Poke Eyes |
| 0 | Slap, mirrored for left and right |
| 5 | Pinch Nose |
| 4 | Strangle, mirrored for the second hand |

This sidesteps rigging entirely. The mesh has no skeleton, so nothing can bend
— but nothing needs to, because the pose that's wanted is the pose that was
scanned, and a pose that never deforms has no skinning artefacts to go wrong.
`setPose` and `setContact` are no-ops that exist only so attacks don't have to
know which rig they're driving; the procedural rig in `hands.ts` is still a
complete implementation of the same interface and takes over if the GLB fails
to load.

Two details make it drop in without touching a single attack keyframe:

- **Splitting has to weld first.** Scans duplicate their vertices along every
  UV seam, so a naive connected-components pass returns hundreds of shards
  instead of six hands.
- **Every piece is fitted to the procedural rig's frame** — wrist at the
  origin, fingers down -Z, palm up +Y, scaled on total length and seated so
  the fingertips land where the old rig put them. Attacks are authored as
  offsets from a contact point in that frame, so a scan seated differently
  would land short on all seven moves at once. The orientation comes from the
  point cloud's covariance: longest axis along the fingers, shortest is the
  palm normal, since a hand is much longer than it is wide and much wider than
  it is thick. Which *end* is the wrist can't be had from the axes, so it's
  taken from where the mass sits — a hand tapers toward the fingers.

The cost is a 5.6 MB download, mostly texture.

## Known limits

- A steeply turned photo has no texture for the far cheek, so that side
  stretches. Frontalisation fixes the geometry, not the missing pixels.
- Faces in heavy shadow, sunglasses, or strong profile may not be detected at
  all; the app says so rather than guessing.
- Hair is a shell with wisps, not simulated strands. Its outline, volume and
  colour come from the photo, but only where the photo can see: the back of the
  head is always guesswork. Hair segmentation is a three-tone nearest-match, so
  a background the same colour as the hair, or a hat, will confuse it.
- Hair that hangs below the jaw isn't built. The shell is grown on the cranium,
  and the cranium stops at the neck.
- Reconstruction is landmark-driven, not photogrammetric. There's no depth
  model, so unusual head shapes regress toward an average skull.
