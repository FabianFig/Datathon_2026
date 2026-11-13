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

/**
 * Tracks turning left/right (yaw about world-up) by integrating the gyroscope.
 *
 * Platforms differ on gyro units (deg/s vs rad/s) and sometimes sign, so the
 * tracker calibrates itself: while the phone is near upright, tilting it
 * changes the gravity-derived pitch, and the gyro's x-axis rate must match
 * that change. A least-squares ratio between the two gives both unit and sign.
 * Positive yaw = turned left (counter-clockwise seen from above).
 */
export function createYawTracker() {
  let yaw = 0;
  let k = Math.PI / 180; // assume deg/s until calibrated
  let sxy = 0;
  let sxx = 0;
  let calibrated = false;
  let prevPitch: number | null = null;

  return {
    get yaw() {
      return yaw;
    },
    get calibrated() {
      return calibrated;
    },
    /** up: world-up in device axes; rate: raw gyro {x,y,z} about device axes; dt in seconds. */
    update(up: Vec3, rate: Vec3, pose: Pose, dt: number) {
      if (!(dt > 0 && dt < 0.2)) {
        prevPitch = pose.pitch;
        return yaw;
      }
      // Calibrate from pitch changes while roughly upright and not rolled.
      if (prevPitch != null && Math.abs(pose.roll) < 0.35 && Math.abs(pose.pitch) < 1.0 && Math.abs(rate.x) > 1e-3) {
        const pitchRate = (pose.pitch - prevPitch) / dt;
        sxy += rate.x * pitchRate;
        sxx += rate.x * rate.x;
        const ratio = sxy / sxx;
        const unit = Math.abs(ratio) > 0.2 ? 1 : Math.PI / 180; // rad/s vs deg/s
        // Trust it once enough tilting has been seen (summed (rad/s)^2)
        if (!calibrated && sxx * unit * unit > 3) calibrated = true;
        if (calibrated) k = (ratio < 0 ? -1 : 1) * unit;
      }
      prevPitch = pose.pitch;
      const n = Math.hypot(up.x, up.y, up.z) || 1;
      const yawRate = k * ((rate.x * up.x + rate.y * up.y + rate.z * up.z) / n);
      yaw += yawRate * dt;
      return yaw;
    },
    reset() {
      yaw = 0;
    },
  };
}

/** Horizontal screen offset (px, + = right) of a world bearing locked at `lockedYaw`. */
export function offsetForBearing(lockedYaw: number, currentYaw: number, f: number): number | null {
  const a = currentYaw - lockedYaw; // turned left since locking → the spot is now to the right
  if (Math.abs(a) > 1.3) return null; // behind or far outside the view
  return f * Math.tan(a);
}
