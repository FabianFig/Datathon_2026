import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Line, Path, Rect, Circle } from 'react-native-svg';
import {
  distanceFromTap,
  focalPx,
  offsetForDepression,
  poseFromUp,
  rotatedOffset,
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

// --------------------------------------------------------------------------- sensors
function usePose(enabled: boolean, pitchOffset: number): Pose {
  const [pose, setPose] = useState<Pose>({ pitch: 0, roll: 0 });
  const up = useRef<Vec3 | null>(null);
  const sign = useRef<number>(1);
  const signLocked = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    (async () => {
      if (!(await DeviceMotion.isAvailableAsync())) return;
      const perm = await DeviceMotion.getPermissionsAsync();
      if (!perm.granted) await DeviceMotion.requestPermissionsAsync();
      if (cancelled) return;
      DeviceMotion.setUpdateInterval(33);
      sub = DeviceMotion.addListener(m => {
        const g = m.accelerationIncludingGravity;
        if (!g) return;
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
        setPose(poseFromUp(next, pitchOffset));
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled, pitchOffset]);

  return pose;
}

// --------------------------------------------------------------------------- AR overlay
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
  const groundY = offsetForDepression(Math.atan(eyeM / distM), pose, f);
  const over = depthM >= eyeM - 0.02;
  const waterY = over ? -L : offsetForDepression(Math.atan((eyeM - depthM) / distM), pose, f);

  // Ripple lines at nearer distances, drifting toward the viewer.
  const ripples: number[] = [];
  if (depthM > 0.02 && !over) {
    for (let k = 0; k < 6; k++) {
      const frac = ((k + flow) % 6) / 6; // 0..1
      const d = distM * (0.25 + 0.7 * (1 - frac));
      ripples.push(offsetForDepression(Math.atan((eyeM - depthM) / d), pose, f));
    }
  }

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
        {depthM > 0.02 && (
          <>
            <View style={{ position: 'absolute', left: 0, right: 0, top: mid + waterY, bottom: 0, backgroundColor: K.water }} />
            {!over && <View style={{ position: 'absolute', left: 0, right: 0, top: mid + waterY - 1, height: 2.5, backgroundColor: K.surface }} />}
            {ripples.map((y, i) => (
              <View
                key={i}
                style={{ position: 'absolute', left: 0, right: 0, top: mid + y, height: 1, backgroundColor: 'rgba(240,232,214,0.35)' }}
              />
            ))}
          </>
        )}
        {/* reference point on the ground */}
        <View style={{ position: 'absolute', left: mid - 28, width: 56, top: mid + groundY - 1, height: 2, backgroundColor: '#FFFFFF' }} />
        <View style={{ position: 'absolute', left: mid - 1, width: 2, top: mid + groundY - 8, height: 16, backgroundColor: '#FFFFFF' }} />
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------- diagram (no camera)
function DepthDiagram({ depth, height }: { depth: number; height: number }) {
  const maxFt = 8;
  const W = 320;
  const ground = height - 18;
  const pxPerFt = (ground - 10) / maxFt;
  const y = (ft: number) => ground - Math.min(maxFt, ft) * pxPerFt;
  const personH = 5.7;
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} accessible={false}>
      <Rect x={0} y={0} width={W} height={height} fill="#EEF2EE" />
      {/* person */}
      <Circle cx={92} cy={y(personH) + 9} r={9} fill="#2D3A33" />
      <Rect x={84} y={y(personH) + 20} width={16} height={(personH - 2.9) * pxPerFt - 14} rx={4} fill="#2D3A33" />
      <Rect x={85} y={y(2.9)} width={6} height={2.9 * pxPerFt} fill="#2D3A33" />
      <Rect x={93} y={y(2.9)} width={6} height={2.9 * pxPerFt} fill="#2D3A33" />
      {/* car */}
      <Path d={`M170 ${y(1.5)} L190 ${y(2.6)} L250 ${y(2.6)} L268 ${y(1.5)} L286 ${y(1.5)} L286 ${y(0.6)} L160 ${y(0.6)} L160 ${y(1.5)} Z`} fill="#4A5852" />
      <Circle cx={185} cy={y(0.45)} r={0.45 * pxPerFt} fill="#2D3A33" />
      <Circle cx={262} cy={y(0.45)} r={0.45 * pxPerFt} fill="#2D3A33" />
      {/* water */}
      {depth > 0 && <Rect x={0} y={y(depth)} width={W} height={ground - y(depth)} fill={K.water} />}
      {depth > 0 && <Line x1={0} x2={W} y1={y(depth)} y2={y(depth)} stroke={K.surface} strokeWidth={2} />}
      <Line x1={0} x2={W} y1={ground} y2={ground} stroke="#2D3A33" strokeWidth={2} />
      {/* scale */}
      {[1, 2, 3, 4, 5, 6, 7].map(ft => (
        <Line key={ft} x1={W - 14} x2={W - 4} y1={y(ft)} y2={y(ft)} stroke="#2D3A33" strokeWidth={1} />
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
  onSeek,
}: {
  sc: Scenario;
  observed: (number | null)[];
  forecast: (number | null)[] | null;
  t: number;
  groundFt: number;
  marks: { hour: number; label: string }[];
  onSeek: (t: number) => void;
}) {
  const [w, setW] = useState(300);
  const H = 92;
  const n = sc.hours.length - 1;
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
  const seek = (e: GestureResponderEvent) => onSeek(Math.max(0, Math.min(n, (e.nativeEvent.locationX / w) * n)));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: seek,
        onPanResponderMove: seek,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, n]
  );
  const clock = localClock(sc, t);
  const depth = depthFt(stageAt(observed, t), sc, groundFt);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Flood timeline"
      accessibilityValue={{ text: `${clock.day} ${clock.time}. Water ${formatDepth(depth)}.` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onSeek(Math.max(0, Math.min(n, t + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
      {...pan.panHandlers}
    >
      <Svg width={w} height={H}>
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
        <Text style={st.axisText}>Your ground ‒ ‒</Text>
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
  const [layout, setLayout] = useState({ W: 1, H: 1 });
  const [flow, setFlow] = useState(0);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraOn = view === 'camera' && !!permission?.granted;
  const pose = usePose(cameraOn, pitchOffset);

  const hasForecast = model.trained && !!sc.forecast;
  const observed = sc.stage_ft;
  const forecastSeries = hasForecast ? series(sc, 'forecast', lead) : null;
  const driving = source === 'forecast' && forecastSeries ? forecastSeries : observed;
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
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT(prev => {
        const next = prev + n / 400;
        if (next >= n) {
          setPlaying(false);
          return n;
        }
        return next;
      });
      setFlow(v => (v + 0.08) % 6);
    }, 50);
    return () => clearInterval(id);
  }, [playing, n]);

  // Slow ripple drift when paused, so the surface reads as water
  useEffect(() => {
    if (playing || !cameraOn) return;
    const id = setInterval(() => setFlow(v => (v + 0.03) % 6), 60);
    return () => clearInterval(id);
  }, [playing, cameraOn]);

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

  async function useCamera() {
    if (view === 'camera') {
      setView('diagram');
      return;
    }
    const p = permission?.granted ? permission : await requestPermission();
    if (p?.granted) setView('camera');
  }

  function onTap(e: GestureResponderEvent) {
    if (!measuring) return;
    const { locationX, locationY } = e.nativeEvent;
    const off = rotatedOffset(locationX - layout.W / 2, locationY - layout.H / 2, pose.roll);
    const d = distanceFromTap(off, pose, focalPx(layout.W, layout.H, fovDeg), eyeM);
    if (d) {
      setDistM(Math.round(d * 10) / 10);
      setMeasuring(false);
      Haptics.selectionAsync().catch(() => {});
      AccessibilityInfo.announceForAccessibility(`Reference set ${(d * FT_PER_M).toFixed(0)} feet away`);
    }
  }

  function pickScenario(i: number) {
    setScIdx(i);
    setT(0);
    setPlaying(false);
    lastLevel.current = -1;
  }

  const statusTone = depth >= 1 ? 'danger' : depth > 0 ? 'warn' : 'ok';

  return (
    <View style={st.root}>
      {/* --------------------------------------------------- viewport */}
      <View
        style={st.viewport}
        onLayout={e => setLayout({ W: e.nativeEvent.layout.width, H: e.nativeEvent.layout.height })}
      >
        {cameraOn ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onTap}
            accessibilityLabel={measuring ? 'Tap where the ground meets a wall or object' : 'Camera view with simulated flood water'}
          >
            <CameraView style={StyleSheet.absoluteFill} facing="back" />
            <WaterOverlay W={layout.W} H={layout.H} pose={pose} fovDeg={fovDeg} eyeM={eyeM} distM={distM} depthM={depthM} flow={flow} />
          </Pressable>
        ) : (
          <View style={st.diagramWrap} accessible accessibilityLabel={`Side view. Water is ${formatDepth(depth)} deep next to an adult and a car.`}>
            <DepthDiagram depth={depth} height={Math.max(160, layout.H - 8)} />
          </View>
        )}

        <View style={st.hud} pointerEvents="none">
          <View style={[st.depthTag, statusTone === 'danger' && st.depthTagDanger, statusTone === 'warn' && st.depthTagWarn]}>
            <Text style={st.depthValue} accessibilityLiveRegion="polite">{formatDepth(depth)}</Text>
            <Text style={st.depthLabel}>{level ? level.label : 'Ground is still dry'}</Text>
          </View>
          <View style={st.clockTag}>
            <Text style={st.clockTime}>{clock.time}</Text>
            <Text style={st.clockDay}>{clock.day}</Text>
          </View>
        </View>

        {measuring && (
          <View style={st.measureBanner} pointerEvents="none">
            <Text style={st.measureText}>Tap where the ground meets a wall, car or curb.</Text>
          </View>
        )}
        {gaugeLost && (
          <View style={st.lostBanner} pointerEvents="none">
            <Text style={st.lostText}>The river gauge stopped reporting here. The water kept rising.</Text>
          </View>
        )}
      </View>

      {/* --------------------------------------------------- controls */}
      <ScrollView style={st.panel} contentContainerStyle={st.panelContent}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
          {scenarios.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => pickScenario(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: i === scIdx }}
              style={[st.chip, i === scIdx && st.chipActive]}
            >
              <Text style={[st.chipTitle, i === scIdx && st.chipTitleActive]}>{s.title}</Text>
              <Text style={[st.chipSub, i === scIdx && st.chipSubActive]}>{s.event}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={st.row}>
          <Pressable
            onPress={() => {
              if (t >= n) setT(0);
              setPlaying(p => !p);
            }}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause timelapse' : 'Play timelapse'}
            style={st.play}
          >
            <Text style={st.playText}>{playing ? 'Pause' : t >= n ? 'Replay' : 'Play'}</Text>
          </Pressable>
          <Pressable onPress={useCamera} accessibilityRole="button" style={st.secondary}>
            <Text style={st.secondaryText}>{view === 'camera' ? 'Side view' : 'Use camera'}</Text>
          </Pressable>
          {cameraOn && (
            <Pressable
              onPress={() => setMeasuring(m => !m)}
              accessibilityRole="button"
              accessibilityState={{ selected: measuring }}
              style={[st.secondary, measuring && st.secondaryActive]}
            >
              <Text style={[st.secondaryText, measuring && st.secondaryTextActive]}>Set spot</Text>
            </Pressable>
          )}
        </View>

        <Timeline
          sc={sc}
          observed={observed}
          forecast={source === 'forecast' ? forecastSeries : null}
          t={t}
          groundFt={groundFt}
          marks={marks.filter(m => m.ft === 1 || m.ft === 5.7).map(m => ({ hour: m.hour, label: m.short }))}
          onSeek={v => {
            setPlaying(false);
            setT(v);
          }}
        />

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
          <Seg label="What happened" active={source === 'observed'} onPress={() => setSource('observed')} />
          <Seg
            label={hasForecast ? 'Model forecast' : 'Model (not trained yet)'}
            active={source === 'forecast'}
            disabled={!hasForecast}
            onPress={() => setSource('forecast')}
          />
        </View>
        {source === 'forecast' && hasForecast && (
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
              Water is drawn on a spot {distM.toFixed(1)} m ({(distM * FT_PER_M).toFixed(0)} ft) away, with the phone held{' '}
              {(eyeM * FT_PER_M).toFixed(1)} ft above the ground. Use Set spot to measure a new spot by tapping its base.
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
              {sc.images.map(img => (
                <View key={img.image_id} style={st.thumbWrap}>
                  <Image
                    source={{ uri: img.url }}
                    style={st.thumb}
                    accessibilityLabel={`${img.source} aerial photo, ${img.locality}, ${img.date}`}
                  />
                  <Text style={st.thumbText}>{img.date}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={st.noteSmall}>
          {sc.gauge_name} (USGS {sc.gauge_id.replace('USGS-', '')}). Depth at your spot is estimated from the river’s rise and the
          ground height you set. It is not a forecast for your address.
        </Text>
      </ScrollView>
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
  depthValue: { fontSize: 26, fontWeight: '700', color: K.ink, letterSpacing: -0.5 },
  depthLabel: { fontSize: 13, color: K.ink2, marginTop: 2 },
  clockTag: { backgroundColor: K.white, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'flex-end', borderWidth: 1, borderColor: K.border },
  clockTime: { fontSize: 17, fontWeight: '700', color: K.ink },
  clockDay: { fontSize: 12, color: K.muted },
  measureBanner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: K.white, borderRadius: 8, padding: 10 },
  measureText: { fontSize: 14, color: K.ink, textAlign: 'center', fontWeight: '600' },
  lostBanner: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: K.red, borderRadius: 8, padding: 10 },
  lostText: { fontSize: 14, color: K.white, textAlign: 'center', fontWeight: '600' },
  panel: { flexGrow: 0, maxHeight: '52%', backgroundColor: K.white, borderTopWidth: 1, borderTopColor: K.border },
  panelContent: { padding: 16, gap: 12, paddingBottom: 28 },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderColor: K.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' },
  chipActive: { borderColor: K.green, backgroundColor: K.greenLight },
  chipTitle: { fontSize: 14, fontWeight: '600', color: K.ink },
  chipTitleActive: { color: K.green },
  chipSub: { fontSize: 12, color: K.muted },
  chipSubActive: { color: K.green },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  play: { minHeight: 48, minWidth: 96, borderRadius: 8, backgroundColor: K.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  playText: { color: K.white, fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: K.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
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
  thumb: { width: 120, height: 90, borderRadius: 8, backgroundColor: K.border },
  thumbText: { fontSize: 11, color: K.muted },
});
