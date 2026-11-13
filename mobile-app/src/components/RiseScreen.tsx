import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Linking,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { PhotoViewer } from './PhotoViewer';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import {
  distanceFromTap,
  focalPx,
  offsetForDepression,
  poseFromUp,
  type Pose,
  type Vec3,
} from '../lib/arGeometry';
import {
  crossing,
  depthFt,
  formatDepth,
  formatDuration,
  FT_PER_M,
  hourOf,
  localClock,
  model,
  scenarios,
  series,
  stageAt,
  THRESHOLDS,
  type Scenario,
} from '../lib/flood';

const K = {
  bg: '#F8FAF6',
  white: '#FFFFFF',
  ink: '#111815',
  ink2: '#314238',
  muted: '#526357',
  border: '#D8E2DC',
  borderStrong: '#B0C2B6',
  green: '#1B4D34',
  greenLight: '#E8F2EC',
  red: '#991B1B',
  redLight: '#FEE2E2',
  amber: '#854D0E',
  amberLight: '#FEF9C3',
  water: 'rgba(96, 78, 50, 0.62)',
  waterSolid: '#6B5838',
  surface: 'rgba(240, 232, 214, 0.95)',
  forecast: '#B45309',
};

type Source = 'observed' | 'forecast';
const LEADS = [1, 3, 6];
const SPEEDS = [0.5, 1, 2, 4]; // 1x plays the whole event in about 20 s
const SETTINGS_KEY = 'rise.calibration.v1';
const DEFAULTS = { eyeM: 1.4, fovDeg: 69, pitchOffset: 0, groundFt: 20 };

// --------------------------------------------------------------------------- sensors
type SensorStatus = 'off' | 'starting' | 'ok' | 'unavailable' | 'denied';

function usePose(enabled: boolean, pitchOffset: number): { pose: Pose; status: SensorStatus } {
  const [pose, setPose] = useState<Pose>({ pitch: 0, roll: 0 });
  const [status, setStatus] = useState<SensorStatus>('off');
  const up = useRef<Vec3 | null>(null);
  const sign = useRef<number>(1);
  const signLocked = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    let last: Pose | null = null;
    (async () => {
      setStatus('starting');
      try {
        if (!(await DeviceMotion.isAvailableAsync())) {
          if (!cancelled) setStatus('unavailable');
          return;
        }
        let perm = await DeviceMotion.getPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await DeviceMotion.requestPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) {
          setStatus('denied');
          return;
        }
      } catch {
        if (!cancelled) setStatus('unavailable');
        return;
      }
      DeviceMotion.setUpdateInterval(33);
      setStatus('ok');
      sub = DeviceMotion.addListener(m => {
        const g = m.accelerationIncludingGravity;
        if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.z)) return;
        // Platforms disagree on whether this reports gravity or its reaction.
        // People hold the phone upright in portrait, so lock the sign from the
        // first clearly-upright reading and treat the result as world-up.
        if (!signLocked.current && Math.abs(g.y) > 7) {
          sign.current = g.y > 0 ? 1 : -1;
          signLocked.current = true;
        }
        const s = sign.current;
        const raw = { x: s * g.x, y: s * g.y, z: s * g.z };
        const a = 0.18; // low-pass
        const prev = up.current ?? raw;
        const next = { x: prev.x + a * (raw.x - prev.x), y: prev.y + a * (raw.y - prev.y), z: prev.z + a * (raw.z - prev.z) };
        up.current = next;
        const p = poseFromUp(next, pitchOffset);
        // Skip re-renders for sub-0.1 degree jitter
        if (last && Math.abs(p.pitch - last.pitch) < 0.002 && Math.abs(p.roll - last.roll) < 0.002) return;
        last = p;
        setPose(p);
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
      setStatus('off');
    };
  }, [enabled, pitchOffset]);

  return { pose, status };
}

// --------------------------------------------------------------------------- AR overlay
const FT = 0.3048;

/**
 * Water drawn as a horizontal plane at depth `depthM`, plus a staff gauge (the
 * white measuring post you see at real low-water crossings) standing on the
 * spot the user tapped. Everything sits in one layer rotated by the phone's
 * roll, so the waterline stays level with the real horizon.
 */
function WaterOverlay({
  W,
  H,
  pose,
  fovDeg,
  eyeM,
  distM,
  depthM,
  flow,
}: {
  W: number;
  H: number;
  pose: Pose;
  fovDeg: number;
  eyeM: number;
  distM: number;
  depthM: number;
  flow: number;
}) {
  const f = focalPx(W, H, fovDeg);
  const L = 2 * Math.hypot(W, H);
  const mid = L / 2;
  const yAt = (heightM: number, d = distM) => offsetForDepression(Math.atan2(eyeM - heightM, d), pose, f);
  const groundY = yAt(0);
  const wet = depthM > 0.01;
  const over = depthM >= eyeM - 0.02;
  const waterY = over ? -L : yAt(depthM);

  // Perspective ripples between the viewer and the spot, drifting toward the viewer.
  const ripples: { y: number; a: number }[] = [];
  if (wet && !over) {
    for (let k = 0; k < 7; k++) {
      const frac = ((k + flow) % 7) / 7;
      const d = distM * (0.2 + 0.78 * (1 - frac));
      ripples.push({ y: yAt(depthM, d), a: 0.14 + 0.22 * frac });
    }
  }

  // Depth scale: heights are projected at the spot's distance but drawn at the
  // left edge, so it stays out of the way and reads the same wherever you aim.
  const scaleX = mid - W / 2 + 22;
  const ticks = [1, 2, 3, 4, 5, 6, 7].map(ft => ({ ft, y: mid + yAt(ft * FT) }));
  const topY = ticks[6].y;
  const baseY = mid + groundY;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          left: W / 2 - mid,
          top: H / 2 - mid,
          width: L,
          height: L,
          transform: [{ rotate: `${pose.roll}rad` }],
        }}
      >
        {/* depth scale at the left edge, drawn first so the water covers its lower part */}
        <View style={{ position: 'absolute', left: scaleX - 1, width: 3, top: topY, height: Math.max(0, baseY - topY), backgroundColor: 'rgba(0,0,0,0.25)' }} />
        <View style={{ position: 'absolute', left: scaleX, width: 1.5, top: topY, height: Math.max(0, baseY - topY), backgroundColor: 'rgba(255,255,255,0.85)' }} />
        {ticks.map(t => (
          <View key={t.ft}>
            <View style={{ position: 'absolute', left: scaleX, width: t.ft % 2 === 0 ? 12 : 7, top: t.y - 0.75, height: 1.5, backgroundColor: 'rgba(255,255,255,0.85)' }} />
            {t.ft % 2 === 0 && (
              <Text style={[st.scaleLabel, { left: scaleX + 15, top: t.y - 8 }]}>{t.ft} ft</Text>
            )}
          </View>
        ))}
        <View style={{ position: 'absolute', left: scaleX - 4, width: 16, top: baseY - 0.75, height: 1.5, backgroundColor: 'rgba(255,255,255,0.85)' }} />

        {wet && (
          <>
            <View style={{ position: 'absolute', left: 0, right: 0, top: mid + waterY, bottom: 0, backgroundColor: K.water }} />
            {ripples.map((r, k) => (
              <View key={k} style={{ position: 'absolute', left: 0, right: 0, top: mid + r.y, height: 1.5, backgroundColor: `rgba(240,232,214,${r.a.toFixed(2)})` }} />
            ))}
            {!over && <View style={{ position: 'absolute', left: 0, right: 0, top: mid + waterY - 1.5, height: 3, backgroundColor: K.surface }} />}
          </>
        )}

      </View>
    </View>
  );
}

// --------------------------------------------------------------------------- diagram (no camera)
/**
 * Side view drawn in real feet with one uniform scale, so the adult (5 ft 8 in)
 * and the sedan (14.5 ft long, 4.7 ft tall) keep true proportions on any screen.
 */
const PERSON_FT = 5.7;
const CAR = { x: 4.6, len: 14.5, body: 2.9, roof: 4.7, wheel: 1.05 };

function DepthDiagram({ depth, width, height }: { depth: number; width: number; height: number }) {
  const below = 0.7; // ground strip under the surface line
  // Keep the adult and the car's cabin in frame; the car may run off the right
  // edge on narrow screens so the scene stays zoomed in.
  const minW = 12;
  let vbH = Math.min(16, Math.max(8, depth + 1.5)) + below;
  let vbW = (vbH * width) / height;
  if (vbW < minW) {
    vbW = minW;
    vbH = (vbW * height) / width;
  }
  const Y = (ft: number) => vbH - below - ft;
  const px = 2.0; // person centre x
  // Cars start to float around 2 ft of water; show it lifting and tilting.
  const lift = Math.max(0, depth - 1.8);
  const tilt = lift > 0 ? Math.min(6, 2 + lift) : 0;
  const cx = CAR.x + CAR.len / 2;
  const carPath = [
    `M${CAR.x} ${Y(0.9)}`,
    `L${CAR.x} ${Y(2.5)}`,
    `Q${CAR.x} ${Y(CAR.body)} ${CAR.x + 0.6} ${Y(CAR.body)}`,
    `L${CAR.x + 3.4} ${Y(CAR.body)}`,
    `L${CAR.x + 5.2} ${Y(CAR.roof)}`,
    `L${CAR.x + 10} ${Y(CAR.roof)}`,
    `L${CAR.x + 11.6} ${Y(CAR.body)}`,
    `L${CAR.x + CAR.len - 0.5} ${Y(CAR.body - 0.2)}`,
    `Q${CAR.x + CAR.len} ${Y(CAR.body - 0.2)} ${CAR.x + CAR.len} ${Y(2.2)}`,
    `L${CAR.x + CAR.len} ${Y(0.9)}`,
    'Z',
  ].join(' ');
  const ticks = [];
  for (let ft = 1; ft < vbH - below - 0.3; ft++) ticks.push(ft);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${vbW} ${vbH}`} accessible={false}>
      <Rect x={0} y={0} width={vbW} height={vbH} fill="#EEF2EE" />
      {/* adult, 5 ft 8 in */}
      <Circle cx={px} cy={Y(PERSON_FT - 0.42)} r={0.42} fill="#2D3A33" />
      <Rect x={px - 0.62} y={Y(4.85)} width={1.24} height={2.0} rx={0.3} fill="#2D3A33" />
      <Rect x={px - 0.95} y={Y(4.7)} width={0.3} height={1.9} rx={0.15} fill="#2D3A33" />
      <Rect x={px + 0.65} y={Y(4.7)} width={0.3} height={1.9} rx={0.15} fill="#2D3A33" />
      <Rect x={px - 0.55} y={Y(2.95)} width={0.48} height={2.95} rx={0.15} fill="#2D3A33" />
      <Rect x={px + 0.07} y={Y(2.95)} width={0.48} height={2.95} rx={0.15} fill="#2D3A33" />
      {/* sedan */}
      <G transform={`translate(0 ${-lift}) rotate(${tilt} ${cx} ${Y(1.5)})`}>
        <Path d={carPath} fill="#4A5852" />
        <Path
          d={`M${CAR.x + 3.9} ${Y(CAR.body + 0.1)} L${CAR.x + 5.4} ${Y(CAR.roof - 0.3)} L${CAR.x + 9.8} ${Y(CAR.roof - 0.3)} L${CAR.x + 11.1} ${Y(CAR.body + 0.1)} Z`}
          fill="#C9D3CD"
        />
        <Circle cx={CAR.x + 2.8} cy={Y(CAR.wheel)} r={CAR.wheel} fill="#1F2924" />
        <Circle cx={CAR.x + CAR.len - 2.8} cy={Y(CAR.wheel)} r={CAR.wheel} fill="#1F2924" />
      </G>
      {/* water */}
      {depth > 0 && <Rect x={0} y={Y(depth)} width={vbW} height={depth} fill={K.water} />}
      {depth > 0 && <Line x1={0} x2={vbW} y1={Y(depth)} y2={Y(depth)} stroke={K.surface} strokeWidth={0.08} />}
      {/* ground */}
      <Rect x={0} y={Y(0)} width={vbW} height={below} fill="#C8D2CB" />
      <Line x1={0} x2={vbW} y1={Y(0)} y2={Y(0)} stroke="#2D3A33" strokeWidth={0.08} />
      {/* scale in feet */}
      {ticks.map(ft => (
        <G key={ft}>
          <Line x1={vbW - 0.45} x2={vbW - 0.1} y1={Y(ft)} y2={Y(ft)} stroke="#2D3A33" strokeWidth={0.05} />
          {ft % 2 === 0 && (
            <SvgText x={vbW - 0.6} y={Y(ft) + 0.17} fontSize={0.5} fill="#2D3A33" textAnchor="end">
              {`${ft} ft`}
            </SvgText>
          )}
        </G>
      ))}
    </Svg>
  );
}

// --------------------------------------------------------------------------- chart + scrubber
function Timeline({
  sc,
  observed,
  forecast,
  t,
  groundFt,
  marks,
  depth,
  onSeek,
}: {
  sc: Scenario;
  observed: (number | null)[];
  forecast: (number | null)[] | null;
  t: number;
  groundFt: number;
  marks: { hour: number; label: string }[];
  depth: number;
  onSeek: (t: number) => void;
}) {
  const [w, setW] = useState(300);
  const H = 52;
  const n = Math.max(1, sc.hours.length - 1);
  const vals = [...observed, ...(forecast ?? [])].filter((v): v is number => v != null);
  const lo = Math.min(...vals, sc.baseline_ft);
  const hi = Math.max(...vals, sc.baseline_ft + groundFt + 6);
  const x = (i: number) => (i / n) * w;
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const path = (arr: (number | null)[]) => {
    let d = '';
    let pen = false;
    arr.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const groundY = y(sc.baseline_ft + groundFt);
  const seek = (e: GestureResponderEvent) => {
    if (w > 0) onSeek(Math.max(0, Math.min(n, (e.nativeEvent.locationX / w) * n)));
  };
  const clock = localClock(sc, t);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Flood timeline"
      accessibilityValue={{ text: `${clock.day} ${clock.time}. Water ${formatDepth(depth)}.` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onSeek(Math.max(0, Math.min(n, t + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={seek}
      onResponderMove={seek}
    >
      <Svg width={w} height={H} pointerEvents="none">
        <Rect x={0} y={groundY} width={w} height={H - groundY} fill="#EEF2EE" />
        <Line x1={0} x2={w} y1={groundY} y2={groundY} stroke={K.borderStrong} strokeDasharray="4 4" />
        {marks.map(m => (
          <Line key={m.label} x1={x(m.hour)} x2={x(m.hour)} y1={0} y2={H} stroke={K.red} strokeWidth={1} opacity={0.5} />
        ))}
        <Path d={path(observed)} stroke={K.ink} strokeWidth={2} fill="none" />
        {forecast && <Path d={path(forecast)} stroke={K.forecast} strokeWidth={2} strokeDasharray="5 3" fill="none" />}
        <Line x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={K.green} strokeWidth={2} />
        <Circle cx={x(t)} cy={H - 3} r={6} fill={K.green} />
      </Svg>
      <View style={st.axisRow}>
        <Text style={st.axisText}>{localClock(sc, 0).time}</Text>
        <Text style={st.axisText}>{localClock(sc, n).time}</Text>
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------- screen
export function RiseScreen() {
  const [scIdx, setScIdx] = useState(0);
  const sc = scenarios[scIdx];
  const n = sc.hours.length - 1;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<Source>('observed');
  const [lead, setLead] = useState(3);
  const [groundFt, setGroundFt] = useState(20);
  const [eyeM, setEyeM] = useState(1.4);
  const [distM, setDistM] = useState(4);
  const [fovDeg, setFovDeg] = useState(69);
  const [pitchOffset, setPitchOffset] = useState(0);
  const [view, setView] = useState<'camera' | 'diagram'>('diagram');
  const [measuring, setMeasuring] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [layout, setLayout] = useState({ W: 1, H: 1 });
  const [flow, setFlow] = useState(0);
  const [camIssue, setCamIssue] = useState<'denied' | 'error' | null>(null);
  const [tapHint, setTapHint] = useState('');
  const [spotSet, setSpotSet] = useState(false);
  const [flash, setFlash] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // Tabs stay mounted; release the camera and pause when another tab is showing
  const focused = useIsFocused();
  const cameraOn = view === 'camera' && !!permission?.granted && focused;
  const { pose, status: sensorStatus } = usePose(cameraOn, pitchOffset);

  // Remember calibration between visits (falls back to defaults if storage fails)
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then(raw => {
        const v = raw ? JSON.parse(raw) : null;
        const num = (x: unknown, lo: number, hi: number, d: number) =>
          typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
        if (v) {
          setEyeM(num(v.eyeM, 0.6, 2, DEFAULTS.eyeM));
          setFovDeg(num(v.fovDeg, 45, 90, DEFAULTS.fovDeg));
          setPitchOffset(num(v.pitchOffset, -0.6, 0.6, 0));
          setGroundFt(num(v.groundFt, 0, 60, DEFAULTS.groundFt));
        }
      })
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, []);
  useEffect(() => {
    if (!settingsLoaded) return;
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ eyeM, fovDeg, pitchOffset, groundFt })).catch(() => {});
  }, [settingsLoaded, eyeM, fovDeg, pitchOffset, groundFt]);

  const hasForecast = model.trained && !!sc.forecast;
  const observed = sc.stage_ft;
  const forecastSeries = useMemo(() => (hasForecast ? series(sc, 'forecast', lead) : null), [hasForecast, sc, lead]);
  const effectiveSource: Source = hasForecast ? source : 'observed';
  const driving = effectiveSource === 'forecast' && forecastSeries ? forecastSeries : observed;
  const peakHere = depthFt(sc.peak_ft, sc, groundFt);
  const depth = depthFt(stageAt(driving, t), sc, groundFt);
  const depthM = depth / FT_PER_M;
  const clock = localClock(sc, t);
  const lostAt = hourOf(sc, sc.gauge_lost_at);
  const gaugeLost = lostAt != null && t >= lostAt;

  // Threshold crossings for the selected curve
  const marks = useMemo(
    () =>
      THRESHOLDS.map(th => ({ ...th, hour: crossing(driving, sc, groundFt, th.ft) })).filter(
        (m): m is (typeof THRESHOLDS)[number] & { hour: number } => m.hour != null
      ),
    [driving, sc, groundFt]
  );
  const firstWet = crossing(driving, sc, groundFt, 0.01);
  const carsFloat = marks.find(m => m.ft === 1)?.hour ?? null;
  const overHead = marks.find(m => m.ft === 5.7)?.hour ?? null;
  const level = THRESHOLDS.filter(th => depth >= th.ft).pop();

  // How much warning the model gave: forecast crossing vs observed crossing of 1 ft
  const obsCars = crossing(observed, sc, groundFt, 1);
  const fcCars = forecastSeries ? crossing(forecastSeries, sc, groundFt, 1) : null;

  // Playback: whole event in ~20 s
  const speed = SPEEDS[speedIdx];
  const atEnd = t >= n;
  const isPlaying = playing && !atEnd && focused;
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setT(prev => Math.min(n, prev + (n / 400) * speed));
      setFlow(v => (v + 0.08) % 6);
    }, 50);
    return () => clearInterval(id);
  }, [isPlaying, n, speed]);

  // Pause when the app goes to the background
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') setPlaying(false);
    });
    return () => sub.remove();
  }, []);

  // Slow ripple drift when paused, so the surface reads as water
  useEffect(() => {
    if (isPlaying || !cameraOn) return;
    const id = setInterval(() => setFlow(v => (v + 0.03) % 6), 60);
    return () => clearInterval(id);
  }, [isPlaying, cameraOn]);

  // Haptic + screen reader announcement when a depth threshold is crossed
  const lastLevel = useRef(-1);
  useEffect(() => {
    const idx = level ? THRESHOLDS.indexOf(level) : -1;
    if (idx > lastLevel.current && level) {
      Haptics.notificationAsync(idx >= 3 ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning).catch(() => {});
      AccessibilityInfo.announceForAccessibility(`${formatDepth(depth)}. ${level.label}.`);
    }
    lastLevel.current = idx;
  }, [level, depth]);

  async function toggleView() {
    if (view === 'camera') {
      setView('diagram');
      setMeasuring(false);
      return;
    }
    try {
      const p = permission?.granted ? permission : await requestPermission();
      if (p?.granted) {
        setCamIssue(null);
        setView('camera');
        if (!spotSet) setMeasuring(true); // first time: start aiming right away
      } else {
        setCamIssue('denied');
      }
    } catch {
      setCamIssue('error');
    }
  }

  // Measure the spot under the centre crosshair: its depression angle and the
  // phone's height give the distance (no finger in the way of the view).
  // While aiming, the water and ruler follow the crosshair live, so you can
  // see them land on the wall before locking.
  const aimDist = measuring && cameraOn && layout.W > 1 ? distanceFromTap(0, pose, focalPx(layout.W, layout.H, fovDeg), eyeM) : null;
  const shownDist = measuring && aimDist ? aimDist : distM;

  function markSpot() {
    const d = aimDist;
    if (!d) {
      setTapHint('The + is above the ground. Tilt down until it sits at the bottom of a wall or car.');
      AccessibilityInfo.announceForAccessibility('Tilt down so the crosshair is on the ground');
      return;
    }
    setTapHint('');
    setDistM(Math.round(d * 10) / 10);
    setSpotSet(true);
    setMeasuring(false);
    setFlash(`Spot set ${Math.round(d * FT_PER_M)} ft away`);
    Haptics.selectionAsync().catch(() => {});
    AccessibilityInfo.announceForAccessibility(`Spot set ${Math.round(d * FT_PER_M)} feet away`);
  }

  function pickScenario(i: number) {
    setScIdx(i);
    setViewerIndex(null);
    setT(0);
    setPlaying(false);
    if (!(model.trained && scenarios[i].forecast)) setSource('observed');
    lastLevel.current = -1;
  }

  const statusTone = depth >= 1 ? 'danger' : depth > 0 ? 'warn' : 'ok';

  function resetCalibration() {
    setEyeM(DEFAULTS.eyeM);
    setFovDeg(DEFAULTS.fovDeg);
    setPitchOffset(0);
    setDistM(4);
    setSpotSet(false);
  }

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(''), 2500);
    return () => clearTimeout(id);
  }, [flash]);

  // One bottom banner, most important message first
  let banner: { tone: 'info' | 'warn' | 'alert'; text: string } | null = null;
  if (cameraOn && measuring) {
    banner = { tone: 'info', text: tapHint || 'Point the + at the bottom of a wall, car or curb. The water follows it.' };
  } else if (cameraOn && flash) {
    banner = { tone: 'info', text: flash };
  } else if (cameraOn && sensorStatus === 'denied') {
    banner = { tone: 'warn', text: 'Motion access is off, so the water can’t stay level as you tilt. Allow Motion & Fitness in Settings.' };
  } else if (cameraOn && sensorStatus === 'unavailable') {
    banner = { tone: 'warn', text: 'No motion sensor found. Hold the phone upright and pointed straight ahead.' };
  } else if (cameraOn && sensorStatus === 'ok' && pose.pitch < -1.05) {
    banner = { tone: 'info', text: 'Raise the phone and look toward the spot.' };
  } else if (cameraOn && sensorStatus === 'ok' && pose.pitch > 0.6) {
    banner = { tone: 'info', text: 'Tilt the phone down toward the ground.' };
  } else if (cameraOn && !spotSet) {
    banner = { tone: 'info', text: 'Tap Place water to put it on a wall, car or curb ahead of you.' };
  } else if (gaugeLost) {
    banner = { tone: 'alert', text: 'The river gauge stopped reporting here. The water kept rising.' };
  }

  return (
    <View style={st.root}>
      {/* --------------------------------------------------- viewport */}
      <View
        style={st.viewport}
        onLayout={e => setLayout({ W: e.nativeEvent.layout.width, H: e.nativeEvent.layout.height })}
      >
        {cameraOn ? (
          <View style={StyleSheet.absoluteFill} accessible={!measuring} accessibilityLabel="Camera view with simulated flood water">
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              onMountError={() => {
                setView('diagram');
                setCamIssue('error');
              }}
            />
            {layout.W > 1 && (
              <WaterOverlay W={layout.W} H={layout.H} pose={pose} fovDeg={fovDeg} eyeM={eyeM} distM={shownDist} depthM={depthM} flow={flow} />
            )}
            {measuring && (
              <View style={st.reticle} pointerEvents="none">
                <View style={st.reticleH} />
                <View style={st.reticleV} />
                <View style={st.reticleDot} />
                <View style={st.reticleTag}>
                  <Text style={st.reticleTagText}>{aimDist ? `${Math.round(aimDist * FT_PER_M)} ft away` : 'Aim lower'}</Text>
                </View>
              </View>
            )}
            {measuring && (
              <Pressable
                onPress={markSpot}
                disabled={!aimDist}
                accessibilityRole="button"
                accessibilityLabel={aimDist ? `Lock the water on the spot ${Math.round(aimDist * FT_PER_M)} feet away` : 'Aim lower to lock a spot'}
                style={[st.lockBtn, !aimDist && st.lockBtnDisabled]}
              >
                <Text style={st.lockText}>Lock here</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={st.diagramWrap} accessible accessibilityLabel={`Side view. Water is ${formatDepth(depth)} deep next to an adult and a car.`}>
            {layout.W > 1 && <DepthDiagram depth={depth} width={layout.W} height={layout.H} />}
          </View>
        )}

        <View
          style={[st.hudCard, statusTone === 'danger' && st.depthTagDanger, statusTone === 'warn' && st.depthTagWarn]}
          pointerEvents="none"
        >
          <Text style={st.depthValue} accessibilityLiveRegion="polite">
            {formatDepth(depth)}
          </Text>
          <Text style={st.depthLabel}>{level ? level.label : 'Ground is still dry'}</Text>
          <Text style={st.hudClock}>
            {clock.time} · {clock.day}
          </Text>
        </View>

        {cameraOn && (
          <View style={st.floatCol}>
            {measuring ? (
              <>
                <Pressable
                  onPress={() => {
                    setMeasuring(false);
                    setTapHint('');
                  }}
                  accessibilityRole="button"
                  style={st.floatBtn}
                >
                  <Text style={st.floatText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={() => {
                  setTapHint('');
                  setMeasuring(true);
                }}
                accessibilityRole="button"
                style={[st.floatBtn, !spotSet && st.floatBtnPrimary]}
              >
                <Text style={[st.floatText, !spotSet && st.floatTextPrimary]}>{spotSet ? 'Re-aim' : 'Place water'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {banner && (
          <View
            style={[st.banner, banner.tone === 'warn' && st.bannerWarn, banner.tone === 'alert' && st.bannerAlert]}
            pointerEvents="none"
            accessibilityLiveRegion="polite"
          >
            <Text style={[st.bannerText, banner.tone === 'alert' && st.bannerTextAlert, banner.tone === 'warn' && st.bannerTextWarn]}>
              {banner.text}
            </Text>
          </View>
        )}
      </View>

      {/* --------------------------------------------------- controls */}
      <ScrollView style={[st.panel, (showMore || pickerOpen) && st.panelOpen]} contentContainerStyle={st.panelContent}>
        {/* row 1: event, view, more */}
        <View style={st.row}>
          <Pressable
            onPress={() => setPickerOpen(o => !o)}
            accessibilityRole="button"
            accessibilityLabel={`Flood event: ${sc.title}, ${sc.event}. Tap to change.`}
            accessibilityState={{ expanded: pickerOpen }}
            style={[st.picker, pickerOpen && st.pickerOpen]}
          >
            <Text style={st.pickerTitle} numberOfLines={1}>
              {sc.title} {pickerOpen ? '▴' : '▾'}
            </Text>
            <Text style={st.pickerSub} numberOfLines={1}>
              {sc.event}
            </Text>
          </Pressable>
          <Pressable onPress={toggleView} accessibilityRole="button" accessibilityLabel={view === 'camera' ? 'Switch to side view' : 'Switch to camera'} style={st.iconBtn}>
            <Text style={st.iconBtnText}>{view === 'camera' ? 'Side' : 'Camera'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowMore(m => !m)}
            accessibilityRole="button"
            accessibilityLabel={showMore ? 'Hide details' : 'Show details, settings and photos'}
            accessibilityState={{ expanded: showMore }}
            style={[st.iconBtn, showMore && st.iconBtnActive]}
          >
            <Text style={[st.iconBtnText, showMore && st.iconBtnTextActive]}>{showMore ? 'Less' : 'More'}</Text>
          </Pressable>
        </View>

        {pickerOpen && (
          <View style={st.pickerList} accessibilityRole="radiogroup">
            {scenarios.map((s, i) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  pickScenario(i);
                  setPickerOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: i === scIdx }}
                style={[st.pickerItem, i === scIdx && st.pickerItemActive]}
              >
                <Text style={[st.pickerTitle, i === scIdx && st.chipTitleActive]}>{s.title}</Text>
                <Text style={st.pickerSub}>
                  {s.event} · river rose {Math.round(s.peak_ft - s.baseline_ft)} ft
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* row 2: play, timeline, speed */}
        <View style={st.playRow}>
          <Pressable
            onPress={() => {
              if (atEnd) {
                setT(0);
                lastLevel.current = -1;
                setPlaying(true);
              } else {
                setPlaying(p => !p);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause timelapse' : atEnd ? 'Replay timelapse' : 'Play timelapse'}
            style={st.playRound}
          >
            <Text style={st.playGlyph}>{isPlaying ? '❚❚' : atEnd ? '↺' : '▶'}</Text>
          </Pressable>
          <View style={st.timelineWrap}>
            <Timeline
              sc={sc}
              observed={observed}
              forecast={effectiveSource === 'forecast' ? forecastSeries : null}
              t={t}
              groundFt={groundFt}
              marks={marks.filter(m => m.ft === 1 || m.ft === 5.7).map(m => ({ hour: m.hour, label: m.short }))}
              depth={depth}
              onSeek={v => {
                setPlaying(false);
                setT(v);
              }}
            />
          </View>
          <Pressable
            onPress={() => setSpeedIdx(i => (i + 1) % SPEEDS.length)}
            accessibilityRole="button"
            accessibilityLabel={`Playback speed ${SPEEDS[speedIdx]} times. Tap to change.`}
            style={st.speedBtn}
          >
            <Text style={st.iconBtnText}>{SPEEDS[speedIdx]}×</Text>
          </Pressable>
        </View>
        {camIssue && view !== 'camera' && (
          <View style={st.card}>
            <Text style={st.cardText}>
              {camIssue === 'denied'
                ? 'Camera access is off. The side view still shows the same water depth.'
                : 'The camera could not start. Close other apps using it and try again; the side view still works.'}
            </Text>
            {camIssue === 'denied' && (
              <Pressable onPress={() => Linking.openSettings().catch(() => {})} accessibilityRole="button" style={st.secondary}>
                <Text style={st.secondaryText}>Open Settings</Text>
              </Pressable>
            )}
          </View>
        )}

        {showMore && (
          <>
        {/* key numbers */}
        <View style={st.facts}>
          <Fact
            label="Dry ground to cars floating"
            value={firstWet != null && carsFloat != null ? formatDuration(carsFloat - firstWet) : '—'}
          />
          <Fact
            label="Dry ground to over your head"
            value={firstWet != null && overHead != null ? formatDuration(overHead - firstWet) : 'Not reached'}
          />
          <Fact label="River rise" value={`${Math.round(sc.peak_ft - sc.baseline_ft)} ft`} />
        </View>

        {/* source toggle */}
        <Text style={st.sectionLabel}>Water level from</Text>
        <View style={st.segment} accessibilityRole="radiogroup">
          <Seg label="What happened" active={effectiveSource === 'observed'} onPress={() => setSource('observed')} />
          <Seg
            label={hasForecast ? 'Model forecast' : 'Model (not trained yet)'}
            active={effectiveSource === 'forecast'}
            disabled={!hasForecast}
            onPress={() => setSource('forecast')}
          />
        </View>
        {effectiveSource === 'forecast' && (
          <>
            <View style={st.segment}>
              {LEADS.map(L => (
                <Seg key={L} label={`${L} h ahead`} active={lead === L} onPress={() => setLead(L)} />
              ))}
            </View>
            <Text style={st.note}>
              Each point is what the {model.name} predicted {lead} h earlier, using only data available then
              {model.future_rain_assumed ? ' plus the rain that followed (as a rainfall forecast would supply)' : ''}. This event was
              held out of training.
              {obsCars != null && fcCars != null
                ? ` It forecast cars floating ${formatDuration(Math.abs(obsCars - fcCars))} ${fcCars <= obsCars ? 'before' : 'after'} it happened.`
                : ''}
            </Text>
          </>
        )}

        {/* ground stepper */}
        <Text style={st.sectionLabel}>Your ground is {groundFt} ft above the river’s normal level</Text>
        <Text style={st.note}>
          {peakHere > 0 ? `At the peak, water here would be ${formatDepth(peakHere)} deep.` : 'At this height the water never reaches you in this event.'}
        </Text>
        <View style={st.row}>
          <Stepper label="Lower" onPress={() => setGroundFt(g => Math.max(0, g - 2))} />
          <Stepper label="Higher" onPress={() => setGroundFt(g => Math.min(60, g + 2))} />
        </View>

        {cameraOn && (
          <Pressable onPress={() => setShowCal(c => !c)} accessibilityRole="button" style={st.linkRow}>
            <Text style={st.link}>{showCal ? 'Hide calibration' : 'Calibrate camera'}</Text>
          </Pressable>
        )}
        {cameraOn && showCal && (
          <View style={st.card}>
            <Text style={st.cardText}>
              {spotSet ? `Your spot is ${(distM * FT_PER_M).toFixed(0)} ft away.` : 'No spot placed yet, so the water is drawn 13 ft ahead.'} The phone is held{' '}
              {formatDepth(eyeM * FT_PER_M)} above the ground; match this to how you are holding it.
            </Text>
            <View style={st.row}>
              <Stepper label="Phone lower" onPress={() => setEyeM(v => Math.max(0.6, +(v - 0.1).toFixed(1)))} />
              <Stepper label="Phone higher" onPress={() => setEyeM(v => Math.min(2, +(v + 0.1).toFixed(1)))} />
            </View>
            <Text style={st.cardText}>If the waterline slides when you tilt the phone, adjust the lens angle ({fovDeg}°).</Text>
            <View style={st.row}>
              <Stepper label="Narrower" onPress={() => setFovDeg(v => Math.max(45, v - 2))} />
              <Stepper label="Wider" onPress={() => setFovDeg(v => Math.min(90, v + 2))} />
            </View>
            <Pressable onPress={() => setPitchOffset(o => o + pose.pitch)} accessibilityRole="button" style={st.secondary}>
              <Text style={st.secondaryText}>Point at eye level, then tap to level</Text>
            </Pressable>
            <Pressable onPress={resetCalibration} accessibilityRole="button" style={st.linkRow}>
              <Text style={st.link}>Reset calibration</Text>
            </Pressable>
            <Text style={st.noteSmall}>
              Depth comes from the phone’s tilt sensors and your tap, which works in Expo Go. LiDAR depth on Pro iPhones needs a
              development build.
            </Text>
          </View>
        )}

        {/* action */}
        <View style={st.card}>
          <Text style={st.cardTitle}>If water is rising where you are</Text>
          <Text style={st.cardText}>Get to higher ground now. Don’t wait for water to reach your door.</Text>
          <Text style={st.cardText}>Never walk or drive into moving water. Turn around, don’t drown.</Text>
          <Text style={st.cardText}>Know your nearest low-water crossings and an exit route that avoids them.</Text>
        </View>

        {sc.images.length > 0 && (
          <>
            <Text style={st.sectionLabel}>Aerial photos near this gauge (UTSA dataset)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.thumbs}>
              {sc.images.map((img, i) => (
                <Pressable
                  key={img.image_id}
                  onPress={() => setViewerIndex(i)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`${img.source} aerial photo, ${img.locality}, ${img.date}`}
                  accessibilityHint="Opens a larger view"
                  style={({ pressed }) => [st.thumbWrap, pressed && { opacity: 0.7 }]}
                >
                  <Image source={{ uri: img.url }} style={st.thumb} />
                  <Text style={st.thumbText}>{img.date} · tap to enlarge</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={st.noteSmall}>
          {sc.gauge_name} (USGS {sc.gauge_id.replace('USGS-', '')}). Depth at your spot is estimated from the river’s rise and the
          ground height you set. It is not a forecast for your address.
        </Text>
          </>
        )}
      </ScrollView>
      <PhotoViewer photos={sc.images} index={viewerIndex} onIndex={setViewerIndex} onClose={() => setViewerIndex(null)} />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={st.factValue}>{value}</Text>
      <Text style={st.factLabel}>{label}</Text>
    </View>
  );
}

function Seg({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      style={[st.seg, active && st.segActive, disabled && st.segDisabled]}
    >
      <Text style={[st.segText, active && st.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={st.stepper}>
      <Text style={st.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: K.bg },
  viewport: { flex: 1, minHeight: 260, backgroundColor: '#000', overflow: 'hidden' },
  diagramWrap: { flex: 1, backgroundColor: '#EEF2EE', justifyContent: 'flex-end' },
  hud: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  depthTag: { backgroundColor: K.white, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, maxWidth: '68%', borderWidth: 1, borderColor: K.border },
  depthTagWarn: { backgroundColor: K.amberLight, borderColor: '#FDE047' },
  depthTagDanger: { backgroundColor: K.redLight, borderColor: '#FCA5A5' },
  depthValue: { fontSize: 22, fontWeight: '700', color: K.ink, letterSpacing: -0.5 },
  depthLabel: { fontSize: 13, color: K.ink2, marginTop: 2 },
  clockTag: { backgroundColor: K.white, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'flex-end', borderWidth: 1, borderColor: K.border },
  clockTime: { fontSize: 17, fontWeight: '700', color: K.ink },
  clockDay: { fontSize: 12, color: K.muted },
  measureDim: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: '#FFFFFF' },
  banner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 8, padding: 10 },
  bannerWarn: { backgroundColor: K.amberLight, borderWidth: 1, borderColor: '#FDE047' },
  bannerAlert: { backgroundColor: K.red },
  bannerText: { fontSize: 14, color: K.ink, textAlign: 'center', fontWeight: '600' },
  bannerTextWarn: { color: K.amber },
  bannerTextAlert: { color: K.white },
  measureBanner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: K.white, borderRadius: 8, padding: 10 },
  measureText: { fontSize: 14, color: K.ink, textAlign: 'center', fontWeight: '600' },
  warnBanner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: K.amberLight, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#FDE047' },
  warnText: { fontSize: 13, color: K.amber, textAlign: 'center', fontWeight: '600' },
  scaleLabel: { position: 'absolute', color: 'rgba(255,255,255,0.92)', fontSize: 11, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 2 },
  hudCard: { position: 'absolute', top: 10, left: 10, maxWidth: '62%', backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: K.border },
  hudClock: { fontSize: 12, color: K.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  floatCol: { position: 'absolute', top: 10, right: 10, gap: 8, alignItems: 'flex-end' },
  floatBtn: { minHeight: 40, minWidth: 64, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
  floatBtnPrimary: { backgroundColor: K.green },
  floatText: { fontSize: 14, fontWeight: '700', color: K.ink },
  floatTextPrimary: { color: K.white },
  reticle: { position: 'absolute', left: '50%', top: '50%', width: 120, height: 44, marginLeft: -60, marginTop: -22, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  reticleH: { position: 'absolute', width: 44, height: 2, backgroundColor: '#FFFFFF', borderRadius: 1 },
  reticleV: { position: 'absolute', width: 2, height: 44, backgroundColor: '#FFFFFF', borderRadius: 1 },
  reticleTag: { position: 'absolute', top: 30, minWidth: 84, alignItems: 'center', backgroundColor: 'rgba(17,24,21,0.78)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  reticleTagText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  lockBtn: { position: 'absolute', bottom: 64, alignSelf: 'center', minHeight: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: K.green, alignItems: 'center', justifyContent: 'center' },
  lockBtnDisabled: { opacity: 0.45 },
  lockText: { color: K.white, fontSize: 16, fontWeight: '700' },
  reticleDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: K.green, backgroundColor: '#FFFFFF' },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playRound: { width: 48, height: 48, borderRadius: 24, backgroundColor: K.green, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { color: K.white, fontSize: 17, fontWeight: '700' },
  timelineWrap: { flex: 1, minWidth: 0 },
  speedBtn: { minWidth: 48, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: K.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  lostBanner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: K.red, borderRadius: 8, padding: 10 },
  lostText: { fontSize: 14, color: K.white, textAlign: 'center', fontWeight: '600' },
  panel: { flexGrow: 0, maxHeight: '40%', backgroundColor: K.white, borderTopWidth: 1, borderTopColor: K.border },
  panelOpen: { maxHeight: '62%' },
  panelContent: { paddingHorizontal: 14, paddingTop: 10, gap: 10, paddingBottom: 14 },
  picker: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: K.borderStrong, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  pickerOpen: { borderColor: K.green },
  pickerTitle: { fontSize: 15, fontWeight: '600', color: K.ink },
  pickerSub: { fontSize: 12, color: K.muted },
  pickerList: { borderWidth: 1, borderColor: K.border, borderRadius: 8, overflow: 'hidden' },
  pickerItem: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: K.border },
  pickerItemActive: { backgroundColor: K.greenLight },
  iconBtn: { minWidth: 56, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: K.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  iconBtnActive: { backgroundColor: K.green, borderColor: K.green },
  iconBtnText: { fontSize: 15, fontWeight: '700', color: K.ink, fontVariant: ['tabular-nums'] },
  iconBtnTextActive: { color: K.white },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderColor: K.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' },
  chipActive: { borderColor: K.green, backgroundColor: K.greenLight },
  chipTitle: { fontSize: 14, fontWeight: '600', color: K.ink },
  chipTitleActive: { color: K.green },
  chipSub: { fontSize: 12, color: K.muted },
  chipSubActive: { color: K.green },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  play: { flex: 1, minHeight: 44, minWidth: 96, borderRadius: 8, backgroundColor: K.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  playText: { color: K.white, fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: K.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryActive: { backgroundColor: K.green, borderColor: K.green },
  secondaryText: { color: K.ink, fontSize: 15, fontWeight: '600' },
  secondaryTextActive: { color: K.white },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  axisText: { fontSize: 11, color: K.muted },
  facts: { flexDirection: 'row', gap: 8 },
  fact: { flex: 1, borderWidth: 1, borderColor: K.border, borderRadius: 8, padding: 10 },
  factValue: { fontSize: 17, fontWeight: '700', color: K.ink },
  factLabel: { fontSize: 12, color: K.muted, marginTop: 2 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: K.ink2, marginTop: 4 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: K.borderStrong, borderRadius: 8, overflow: 'hidden' },
  seg: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segActive: { backgroundColor: K.green },
  segDisabled: { opacity: 0.45 },
  segText: { fontSize: 14, fontWeight: '600', color: K.ink, textAlign: 'center' },
  segTextActive: { color: K.white },
  stepper: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: K.borderStrong, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 13, lineHeight: 19, color: K.ink2 },
  noteSmall: { fontSize: 12, lineHeight: 17, color: K.muted },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 15, fontWeight: '600', color: K.green },
  card: { borderWidth: 1, borderColor: K.border, borderRadius: 10, padding: 14, gap: 8, backgroundColor: K.bg },
  cardTitle: { fontSize: 15, fontWeight: '700', color: K.ink },
  cardText: { fontSize: 14, lineHeight: 20, color: K.ink2 },
  thumbs: { gap: 8 },
  thumbWrap: { gap: 4 },
  thumb: { width: 140, height: 140, borderRadius: 8, backgroundColor: K.border },
  thumbText: { fontSize: 11, color: K.muted },
});
