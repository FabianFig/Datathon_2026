/**
 * Camera geometry for a world-anchored water surface without ARKit/ARCore,
 * so it runs in Expo Go.
 *
 * The phone's gravity vector gives camera pitch and roll. With the phone's
 * height above the ground (h) and the distance to a reference point on the
 * ground (D, measured by tapping where the ground meets a wall or object),
 * a waterline of depth w on that object sits at angle atan((h - w) / D)
 * below the horizon. That angle is projected into screen pixels, so the
 * waterline stays put on real objects as the phone tilts.
 */

export type Vec3 = { x: number; y: number; z: number };

export type Pose = {
  /** camera elevation above the horizon, radians (+ = pointing up) */
  pitch: number;
  /** clockwise angle of world-up on screen, radians */
  roll: number;
};

export function poseFromUp(u: Vec3, pitchOffset = 0): Pose {
  const horiz = Math.hypot(u.x, u.y);
  return {
    pitch: -Math.atan2(u.z, horiz) - pitchOffset,
    roll: Math.atan2(u.x, u.y),
  };
}

/** Focal length in px for a preview that aspect-fills a W x H portrait view. */
export function focalPx(W: number, H: number, longFovDeg: number, sensorAspect = 4 / 3): number {
  const vf = (longFovDeg * Math.PI) / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) / sensorAspect);
  return Math.max(W / (2 * Math.tan(hf / 2)), H / (2 * Math.tan(vf / 2)));
}

/** Screen offset (px, + = down, in the roll-corrected frame) of a point `depressionRad` below the horizon. */
export function offsetForDepression(depressionRad: number, pose: Pose, f: number): number {
  const a = depressionRad + pose.pitch;
  const clamped = Math.max(-1.45, Math.min(1.45, a));
  return f * Math.tan(clamped);
}

/** Inverse: depression angle of a tapped screen point (offset in the roll-corrected frame). */
export function depressionForOffset(offset: number, pose: Pose, f: number): number {
  return Math.atan(offset / f) - pose.pitch;
}

/** Map a tap (relative to view centre) into the roll-corrected vertical offset. */
export function rotatedOffset(dx: number, dy: number, roll: number): number {
  return -dx * Math.sin(roll) + dy * Math.cos(roll);
}

export function distanceFromTap(offset: number, pose: Pose, f: number, eyeM: number): number | null {
  const dep = depressionForOffset(offset, pose, f);
  if (dep < (2 * Math.PI) / 180) return null; // at or above the horizon
  return Math.max(0.8, Math.min(40, eyeM / Math.tan(dep)));
}
