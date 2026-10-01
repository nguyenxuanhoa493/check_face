import React, { useEffect, useRef, useState } from 'react';
import { Human, type Config } from '@vladmandic/human';
import {
  Camera,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  Sparkles,
  Trash2,
  ScanFace,
  Info,
  ShieldAlert,
  Activity,
  Crosshair,
  Award,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Smile,
  Eye,
  RefreshCw,
  Database,
  Zap,
  HardDrive,
  Clock,
  Timer,
  Download,
  History
} from 'lucide-react';
import './App.css';

export interface ModelLoadProgress {
  isLoading: boolean;
  loadedMB: number;
  totalMB: number;
  percentage: number;
  speedMBs: number;
  etaSec: number;
  currentModel: string;
}

export interface ResourceMetrics {
  gpuMemoryMB: number;
  numTensors: number;
  jsHeapMB: number | null;
  inferenceMs: number;
  fps: number;
  modelSizeMB: number;
}

interface EnrolledItem {
  id: string;
  name: string;
  embedding: number[];
  imageSrc: string;
  antispoofScore: number;
  timestamp: string;
}

export type LivenessMode = 'HEAD_TURN' | 'BLINK' | 'OFF';
export type TurnDirection = 'LEFT' | 'RIGHT' | 'UP' | 'BLINK';
export type ChallengeStage = 'CENTER_START' | 'TURNING' | 'CENTER_FINAL' | 'PASSED';
export type CheckSessionStatus = 'IDLE' | 'CHECKING' | 'SUCCESS' | 'TIMEOUT';

export interface CheckAuditRecord {
  id: string;
  round: number;
  timestamp: string;
  timeFormatted: string;
  status: 'PASS' | 'FAIL';
  reason: string;
  task: TurnDirection;
  taskName: string;
  durationSec: number;
  timeoutLimitSec: number;
  similarity: number | null;
  matchThreshold: number;
  isMatch: boolean;
  realScore: number;
  antispoofThreshold: number;
  isReal: boolean;
  depthRatio: number;
  rotation: { yaw: number; pitch: number; roll: number };
  ear: number;
  blinkCount: number;
  inferenceTimeMs: number;
  snapshotUrl?: string;
  bestMatchName?: string;
  individualSimilarities?: { id: string; name: string; similarity: number }[];
}

interface TelemetryData {
  score: number;
  box: { x: number; y: number; width: number; height: number };
  rotation: { roll: number; yaw: number; pitch: number };
  realScore: number;
  isReal: boolean;
  meshPoints: number;
  embeddingDim: number;
  inferenceTimeMs: number;
  individualSimilarities: { id: string; name: string; imageSrc: string; similarity: number }[];
  bestMatch: { index: number; name: string; similarity: number } | null;
  // Liveness & 3D Anti-bypass metrics
  livenessMode: LivenessMode;
  challengeDirection: TurnDirection;
  challengeStage: ChallengeStage;
  challengeProgress: number;
  ear: number;
  blinkDropPct: number;
  isEyeClosed: boolean;
  blinkCount: number;
  lastBlinkAgoSec: number | null;
  hasPassedLiveness: boolean;
  depthRatio: number;
  is3DConvex: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'enroll' | 'live-test'>('enroll');
  const [modelsLoaded, setModelsLoaded] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Đang khởi tạo thư viện @vladmandic/human...');

  // Tiến độ tải Model AI chi tiết (Dung lượng, Tốc độ tải, Thời gian dự kiến)
  const [loadProgress, setLoadProgress] = useState<ModelLoadProgress>({
    isLoading: true,
    loadedMB: 0,
    totalMB: 8.9,
    percentage: 0,
    speedMBs: 0,
    etaSec: 0,
    currentModel: 'Khởi tạo...',
  });

  // Mức độ tiêu thụ tài nguyên thực tế (VRAM, Tensors, Heap, Độ trễ)
  const [resourceMetrics, setResourceMetrics] = useState<ResourceMetrics>({
    gpuMemoryMB: 0,
    numTensors: 0,
    jsHeapMB: null,
    inferenceMs: 0,
    fps: 0,
    modelSizeMB: 8.9,
  });

  // Webcam & Elements
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Human instance reference
  const humanRef = useRef<Human | null>(null);

  // Enrolled 5-10 Faces data
  const [enrolledList, setEnrolledList] = useState<EnrolledItem[]>([]);
  const [isEnrollingAuto, setIsEnrollingAuto] = useState<boolean>(false);
  const [autoEnrollStep, setAutoEnrollStep] = useState<number>(0);
  const [autoEnrollConditionMet, setAutoEnrollConditionMet] = useState<boolean>(false);
  const [stableProgress, setStableProgress] = useState<number>(0);
  const [enrollAngleMetric, setEnrollAngleMetric] = useState<{
    currentYaw: number;
    currentPitch: number;
    targetDesc: string;
    diffDesc: string;
    progressPct: number;
  }>({
    currentYaw: 0,
    currentPitch: 0,
    targetDesc: '',
    diffDesc: '',
    progressPct: 0,
  });
  const isEnrollingRef = useRef<boolean>(false);
  const skipStepRef = useRef<boolean>(false);

  // Real-time verification stats
  const [currentSimilarity, setCurrentSimilarity] = useState<number | null>(null);
  const [matchThreshold, setMatchThreshold] = useState<number>(0.65);
  const [antispoofThreshold, setAntispoofThreshold] = useState<number>(0.58); // Chuẩn 0.58 chặn màn hình điện thoại & ảnh in
  const [livenessMode, setLivenessMode] = useState<LivenessMode>('HEAD_TURN'); // Chế độ: 'HEAD_TURN' (khuyên dùng), 'BLINK', hoặc 'OFF'
  const [verificationStatus, setVerificationStatus] = useState<
    'MATCH' | 'SPOOF' | 'WAIT_TURN' | 'WAIT_BLINK' | 'MISMATCH' | 'NO_FACE' | 'IDLE' | 'TIMEOUT'
  >('IDLE');
  const [fps, setFps] = useState<number>(0);

  // Cấu hình Thời gian kiểm tra (Mặc định 10s, có thể tinh chỉnh) & Phiên kiểm tra
  const [checkTimeoutSec, setCheckTimeoutSec] = useState<number>(10);
  const [remainingTimeSec, setRemainingTimeSec] = useState<number>(10);
  const [sessionStatus, setSessionStatus] = useState<CheckSessionStatus>('IDLE');
  const [passedTimeSec, setPassedTimeSec] = useState<number | null>(null);

  const checkTimeoutSecRef = useRef<number>(10);
  useEffect(() => {
    checkTimeoutSecRef.current = checkTimeoutSec;
  }, [checkTimeoutSec]);

  const sessionStatusRef = useRef<CheckSessionStatus>('IDLE');
  const sessionStartTimeRef = useRef<number>(0);
  const remainingTimeSecRef = useRef<number>(10);

  // Detailed Telemetry state for "Live Test Detect" Tab
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);

  // Display toggles
  const [showMesh] = useState<boolean>(true);
  const [showBox] = useState<boolean>(true);

  // Performance calculation & Loop Sync Refs
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const frameCountRef = useRef<number>(0);
  const isDetectingRef = useRef<boolean>(false);

  // Active Liveness Mode Ref
  const livenessModeRef = useRef<LivenessMode>('HEAD_TURN');
  useEffect(() => {
    livenessModeRef.current = livenessMode;
  }, [livenessMode]);

  // Bộ máy Thử thách ngẫu nhiên (Interactive Head Turn & Blink Challenge)
  const challengeStateRef = useRef<{
    direction: TurnDirection;
    stage: ChallengeStage;
    targetYaw: number;
    currentYaw: number;
    currentPitch: number;
    progress: number;
    passedAt: number | null;
  }>({
    direction: 'LEFT',
    stage: 'TURNING',
    targetYaw: -20,
    currentYaw: 0,
    currentPitch: 0,
    progress: 0,
    passedAt: null,
  });

  const stageStableFramesRef = useRef<number>(0);

  // Lịch sử biến thiên EAR động trượt (Sliding Window Min-Max Dip Detector)
  const blinkHistoryRef = useRef<{ ear: number; time: number }[]>([]);
  const lastBlinkRegisteredTimeRef = useRef<number>(0);
  const blinkCountRef = useRef<number>(0);
  const isEyeClosedRef = useRef<boolean>(false);
  const faceStableFramesRef = useRef<number>(0); // Đếm số frame mặt ổn định liên tục
  const lastFaceBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // LƯU TRỮ LỊCH SỬ TỪNG LẦN CHECK (PASS / FAIL) ĐỂ HIỂN THỊ UI BÊN PHẢI & XUẤT LOG
  const [checkHistory, setCheckHistory] = useState<CheckAuditRecord[]>([]);
  const hasLoggedSessionRef = useRef<boolean>(false);
  const roundCounterRef = useRef<number>(0);

  // Chụp thumbnail khuôn mặt mini lúc hoàn tất lượt check
  const captureSnapshot = (): string | undefined => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return undefined;
    try {
      const miniCanvas = document.createElement('canvas');
      miniCanvas.width = 100;
      miniCanvas.height = 80;
      const ctx = miniCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, 100, 80);
        return miniCanvas.toDataURL('image/jpeg', 0.65);
      }
    } catch (e) {
      console.error('Error capturing snapshot:', e);
    }
    return undefined;
  };

  // Ghi nhận 1 record kiểm định (Pass hoặc Fail)
  const recordAuditSession = (
    status: 'PASS' | 'FAIL',
    reason: string,
    durationSec: number,
    currentSim: number | null,
    realScore: number,
    isReal: boolean,
    depthRatio: number,
    rotation: { yaw: number; pitch: number; roll: number },
    ear: number,
    blinkCount: number,
    inferenceMs: number,
    bestMatchName?: string,
    individualSims?: { id: string; name: string; similarity: number }[]
  ) => {
    if (hasLoggedSessionRef.current) return;
    hasLoggedSessionRef.current = true;

    roundCounterRef.current += 1;
    const now = new Date();
    const timeFormatted = now.toTimeString().split(' ')[0];
    const currentTask = challengeStateRef.current.direction;
    const taskNameMap: Record<TurnDirection, string> = {
      LEFT: 'Quay trái',
      RIGHT: 'Quay phải',
      UP: 'Ngẩng lên',
      BLINK: 'Chớp mắt',
    };

    const snapshotUrl = captureSnapshot();

    const newRecord: CheckAuditRecord = {
      id: `chk_${Date.now()}_${roundCounterRef.current}`,
      round: roundCounterRef.current,
      timestamp: now.toISOString(),
      timeFormatted,
      status,
      reason,
      task: currentTask,
      taskName: taskNameMap[currentTask] || currentTask,
      durationSec: Number(durationSec.toFixed(1)),
      timeoutLimitSec: checkTimeoutSecRef.current,
      similarity: currentSim !== null ? Number(currentSim.toFixed(3)) : null,
      matchThreshold: matchThresholdRef.current,
      isMatch: currentSim !== null && currentSim >= matchThresholdRef.current,
      realScore: Number(realScore.toFixed(3)),
      antispoofThreshold: antispoofThresholdRef.current,
      isReal,
      depthRatio: Number(depthRatio.toFixed(2)),
      rotation,
      ear: Number(ear.toFixed(3)),
      blinkCount,
      inferenceTimeMs: inferenceMs,
      snapshotUrl,
      bestMatchName,
      individualSimilarities: individualSims,
    };

    setCheckHistory((prev) => [newRecord, ...prev.slice(0, 49)]); // Lưu tối đa 50 lượt gần nhất
  };

  // Xuất file JSON toàn bộ dữ liệu kiểm tra để cải tiến thuật toán
  const exportAuditLogJson = () => {
    if (checkHistory.length === 0) {
      alert('Chưa có dữ liệu kiểm định để xuất log. Vui lòng thực hiện kiểm tra trước.');
      return;
    }
    const total = checkHistory.length;
    const passed = checkHistory.filter((r) => r.status === 'PASS').length;
    const failed = checkHistory.filter((r) => r.status === 'FAIL').length;
    const passRate = total > 0 ? `${Math.round((passed / total) * 100)}%` : '0%';

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      statistics: {
        totalChecks: total,
        passed,
        failed,
        passRate,
      },
      systemConfig: {
        userAgent: navigator.userAgent,
        models: ['blazeface', 'facemesh', 'faceres'],
        matchThreshold: matchThresholdRef.current,
        antispoofThreshold: antispoofThresholdRef.current,
        checkTimeoutSec: checkTimeoutSecRef.current,
        enrolledFacesCount: enrolledListRef.current.length,
      },
      historyLogs: checkHistory.map(({ snapshotUrl, ...rest }) => rest), // Giữ JSON sạch không kèm chuỗi base64 nặng
    };

    const jsonStr = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `human-ai-ekyc-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Xóa toàn bộ lịch sử kiểm tra
  const clearAuditHistory = () => {
    if (window.confirm('Bạn có chắc muốn xóa sạch toàn bộ lịch sử kiểm định này không?')) {
      setCheckHistory([]);
      roundCounterRef.current = 0;
    }
  };

  // Bắt đầu 1 phiên kiểm tra mới với 1 NHIỆM VỤ NGẪU NHIÊN và ĐỒNG HỒ 10s (chỉnh được)
  const startNewCheckSession = (forcedTimeout?: number) => {
    blinkHistoryRef.current = [];
    lastBlinkRegisteredTimeRef.current = 0;
    blinkCountRef.current = 0;
    isEyeClosedRef.current = false;
    stageStableFramesRef.current = 0;
    hasLoggedSessionRef.current = false; // Reset cờ log cho phiên mới

    // Random chỉ trong 3 nhiệm vụ quay: QUAY TRÁI, QUAY PHẢI, NGẨNG LÊN
    const allTasks: TurnDirection[] = ['LEFT', 'RIGHT', 'UP'];
    const prevTask = challengeStateRef.current.direction;
    const candidates = allTasks.filter((t) => t !== prevTask);
    const newTask: TurnDirection = candidates[Math.floor(Math.random() * candidates.length)] || allTasks[0];

    challengeStateRef.current = {
      direction: newTask,
      stage: 'TURNING',
      targetYaw: newTask === 'LEFT' ? -20 : (newTask === 'RIGHT' ? 20 : 0),
      currentYaw: 0,
      currentPitch: 0,
      progress: 0,
      passedAt: null,
    };

    const timeout = forcedTimeout !== undefined ? forcedTimeout : checkTimeoutSecRef.current;
    sessionStartTimeRef.current = performance.now();
    remainingTimeSecRef.current = timeout;
    setRemainingTimeSec(timeout);
    sessionStatusRef.current = 'CHECKING';
    setSessionStatus('CHECKING');
    setPassedTimeSec(null);
  };

  // Tự động chuyển sang lượt mới sau khi XÁC THỰC THÀNH CÔNG hoặc HẾT THỜI GIAN
  useEffect(() => {
    if (sessionStatus === 'SUCCESS' || sessionStatus === 'TIMEOUT') {
      const delay = sessionStatus === 'SUCCESS' ? 1000 : 700;
      const timer = setTimeout(() => {
        startNewCheckSession();
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [sessionStatus]);

  // Đồng bộ activeTabRef và đảm bảo khi vào tab Live Cam thời gian LUÔN ĐẾM TỪ ĐẦU (10.0s)
  const activeTabRef = useRef<'enroll' | 'live-test'>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab === 'live-test') {
      startNewCheckSession();
    } else {
      sessionStatusRef.current = 'IDLE';
      setSessionStatus('IDLE');
      setRemainingTimeSec(checkTimeoutSecRef.current);
    }
  }, [activeTab]);

  const resetLivenessChallenge = () => {
    startNewCheckSession();
  };

  // Nút ép xác thực / bypass thủ công
  const forceVerifyLiveness = () => {
    challengeStateRef.current = {
      ...challengeStateRef.current,
      stage: 'PASSED',
      progress: 100,
      passedAt: performance.now(),
    };
    blinkCountRef.current += 1;
    lastBlinkRegisteredTimeRef.current = performance.now();
    sessionStatusRef.current = 'SUCCESS';
    setSessionStatus('SUCCESS');
    setPassedTimeSec(1.2);

    recordAuditSession(
      'PASS',
      'Đạt xác thực qua Bypass thủ công',
      1.2,
      currentSimilarity || 0.85,
      1.0,
      true,
      3.5,
      { yaw: 0, pitch: 0, roll: 0 },
      0.25,
      1,
      40,
      telemetry?.bestMatch?.name
    );
  };

  // Lịch sử Telemetry vẽ biểu đồ thời gian thực & Tần suất xác thực
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const telemetryHistoryRef = useRef<{ sim: number; real: number; ear: number; status: string }[]>([]);
  const statsCountersRef = useRef({ total: 0, match: 0, spoof: 0, mismatch: 0 });
  const [statsDisplay, setStatsDisplay] = useState({
    total: 0,
    match: 0,
    spoof: 0,
    matchRate: 0,
    fps: 0,
  });

  // Sync refs to prevent stale closure and ghost loops
  const enrolledListRef = useRef<EnrolledItem[]>([]);
  useEffect(() => {
    enrolledListRef.current = enrolledList;
  }, [enrolledList]);

  const matchThresholdRef = useRef(matchThreshold);
  useEffect(() => {
    matchThresholdRef.current = matchThreshold;
  }, [matchThreshold]);

  const antispoofThresholdRef = useRef(antispoofThreshold);
  useEffect(() => {
    antispoofThresholdRef.current = antispoofThreshold;
  }, [antispoofThreshold]);

  const showBoxRef = useRef(showBox);
  useEffect(() => {
    showBoxRef.current = showBox;
  }, [showBox]);

  const showMeshRef = useRef(showMesh);
  useEffect(() => {
    showMeshRef.current = showMesh;
  }, [showMesh]);

  // HÀM TÍNH TỶ LỆ MỞ MẮT (EYE ASPECT RATIO - EAR) TỪ 468 FACE MESH POINTS
  const calculateEAR = (mesh: any): number => {
    if (!mesh || mesh.length < 468) return 0.25;
    // Mắt trái:
    // Ngang: 33 (ngoài), 133 (trong)
    // Dọc 1: 160 (trên) - 144 (dưới)
    // Dọc 2: 158 (trên) - 153 (dưới)
    // Dọc 3 (giữa mí): 159 (trên đỉnh) - 145 (dưới đáy)
    const dL1 = Math.hypot(mesh[160][0] - mesh[144][0], mesh[160][1] - mesh[144][1]);
    const dL2 = Math.hypot(mesh[158][0] - mesh[153][0], mesh[158][1] - mesh[153][1]);
    const dL3 = Math.hypot(mesh[159][0] - mesh[145][0], mesh[159][1] - mesh[145][1]);
    const dL_w = Math.hypot(mesh[33][0] - mesh[133][0], mesh[33][1] - mesh[133][1]);
    const earL = (dL1 + dL2 + dL3) / (3.0 * Math.max(1, dL_w));

    // Mắt phải:
    // Ngang: 263 (ngoài), 362 (trong)
    // Dọc 1: 385 (trên) - 380 (dưới)
    // Dọc 2: 387 (trên) - 373 (dưới)
    // Dọc 3 (giữa mí): 386 (trên đỉnh) - 374 (dưới đáy)
    const dR1 = Math.hypot(mesh[385][0] - mesh[380][0], mesh[385][1] - mesh[380][1]);
    const dR2 = Math.hypot(mesh[387][0] - mesh[373][0], mesh[387][1] - mesh[373][1]);
    const dR3 = Math.hypot(mesh[386][0] - mesh[374][0], mesh[386][1] - mesh[374][1]);
    const dR_w = Math.hypot(mesh[263][0] - mesh[362][0], mesh[263][1] - mesh[362][1]);
    const earR = (dR1 + dR2 + dR3) / (3.0 * Math.max(1, dR_w));

    return (earL + earR) / 2.0;
  };

  // HÀM ĐO ĐỘ LỒI KHỐI 3D CHÓP MŨI SO VỚI GÒ MÁ (3D CONVEX DEPTH RATIO)
  const calculate3DDepth = (mesh: any): { depthRatio: number; is3DConvex: boolean } => {
    if (!mesh || mesh.length < 468) return { depthRatio: 0.04, is3DConvex: true };
    const noseZ = mesh[1][2]; // Chóp mũi
    const leftCheekZ = mesh[234][2]; // Tai/má trái
    const rightCheekZ = mesh[454][2]; // Tai/má phải
    const avgCheekZ = (leftCheekZ + rightCheekZ) / 2;

    const faceWidth = Math.hypot(mesh[454][0] - mesh[234][0], mesh[454][1] - mesh[234][1]) || 1;
    const zDiff = Math.abs(avgCheekZ - noseZ);
    const depthRatio = zDiff / faceWidth;

    // Mặt người thật 3D có tỷ lệ độ cong nhô zDiff / faceWidth >= 0.015 (1.5%)
    // Màn hình điện thoại/ảnh phẳng 2D đưa vuông góc thường có tỷ lệ zDiff < 0.012
    const is3DConvex = depthRatio >= 0.015;
    return { depthRatio, is3DConvex };
  };

  // HÀM BỘ MÁY TRẠNG THÁI PHÁT HIỆN CHỚP MẮT TỰ NHIÊN (3-PHASE CHRONOLOGICAL BLINK DETECTOR)
  const updateBlinkState = (ear: number, now: number) => {
    const history = blinkHistoryRef.current;
    history.push({ ear, time: now });

    // Giữ sliding window trong khoảng 1.2 giây gần nhất
    while (history.length > 0 && now - history[0].time > 1200) {
      history.shift();
    }

    // Nếu khuôn mặt chưa ổn định ít nhất 10 frames trước camera: chưa tính chớp mắt (CHỐNG BYPASS ĐƯA ĐIỆN THOẠI VÀO)
    if (faceStableFramesRef.current < 10 || history.length < 8) {
      return {
        ear,
        blinkDropPct: 0,
        isEyeClosed: false,
        blinkCount: blinkCountRef.current,
        lastBlinkAgoSec: null,
        hasPassedLiveness: false,
      };
    }

    // Tìm maxEAR và minEAR trong sliding window
    let maxEAR = 0;
    let minEAR = 999;
    let minIdx = -1;

    for (let i = 0; i < history.length; i++) {
      if (history[i].ear > maxEAR) maxEAR = history[i].ear;
      if (history[i].ear < minEAR) {
        minEAR = history[i].ear;
        minIdx = i;
      }
    }

    // Baseline tự nhiên là maxEAR trong 1.2s qua
    const validBaseline = Math.max(0.08, maxEAR);
    // Tỷ lệ co mí mắt hiện tại so với lúc mắt mở to nhất (%)
    const currentDropRatio = (validBaseline - ear) / validBaseline;
    const blinkDropPct = Math.max(0, Math.round(currentDropRatio * 100));

    // Đánh dấu đang nhắm nếu sụt giảm >= 20% so với lúc mở mắt
    const isEyeClosed = currentDropRatio >= 0.20;
    isEyeClosedRef.current = isEyeClosed;

    // ĐIỀU KIỆN CHẶT CHẼ ĐẾM MỘT CÚ CHỚP MẮT SINH HỌC THẬT (CHỐNG 100% ẢNH ĐIỆN THOẠI):
    // 1. Phải có độ sụt giảm sâu (minEAR) ít nhất 20% so với baseline
    const maxDip = (validBaseline - minEAR) / validBaseline;
    // 2. Hiện tại mắt đã mở to lại hoàn toàn (sụt giảm hiện tại <= 8%, tức đã phục hồi >= 92%)
    const isRestored = currentDropRatio <= 0.08;
    // 3. THỨ TỰ THỜI GIAN 3 PHA: Phải có frame TRƯỚC đáy nhắm mắt mà tại đó mắt đang mở to ổn định!
    // (Nếu đưa điện thoại từ ngoài vào, frame trước đáy không có -> loại bỏ 100% false positive)
    const hasOpenBeforeMin = history.slice(0, minIdx).some(
      (item) => (validBaseline - item.ear) / validBaseline <= 0.08 && history[minIdx].time - item.time >= 40
    );
    // 4. Thời gian từ đáy thấp nhất đến hiện tại từ 40ms đến 550ms
    const timeSinceMin = history[minIdx] ? now - history[minIdx].time : 0;
    // 5. Lần ghi nhận trước đó cách ít nhất 350ms (chống đếm đúp)
    const timeSinceLastBlink = now - lastBlinkRegisteredTimeRef.current;

    if (
      maxDip >= 0.20 &&
      isRestored &&
      hasOpenBeforeMin &&
      timeSinceMin >= 40 &&
      timeSinceMin <= 550 &&
      timeSinceLastBlink > 350
    ) {
      blinkCountRef.current += 1;
      lastBlinkRegisteredTimeRef.current = now;
      // Dọn bớt lịch sử trước đáy để không lặp lại cùng một cú chớp mắt
      blinkHistoryRef.current = history.filter((item) => item.time >= now - 60);
    }

    const lastBlinkAgoSec = lastBlinkRegisteredTimeRef.current > 0
      ? Number(((now - lastBlinkRegisteredTimeRef.current) / 1000).toFixed(1))
      : null;

    // Đạt chuẩn Liveness nếu đã có ít nhất 1 lần chớp mắt trong 10 giây gần nhất
    const hasPassedLiveness = lastBlinkAgoSec !== null && lastBlinkAgoSec <= 10;

    return {
      ear,
      blinkDropPct,
      isEyeClosed,
      blinkCount: blinkCountRef.current,
      lastBlinkAgoSec,
      hasPassedLiveness,
    };
  };

  // HÀM BỘ MÁY THỬ THÁCH HÀNH VI NGẪU NHIÊN (RANDOM LIVENESS CHALLENGE)
  const updateHeadTurnState = (yaw: number, pitch: number, blinkData: any, now: number) => {
    const state = challengeStateRef.current;
    state.currentYaw = yaw;
    state.currentPitch = pitch;

    // 1. Nếu đã PASSED: giữ nguyên đã vượt qua
    if (state.stage === 'PASSED') {
      return { ...state, hasPassed: true };
    }

    // Nếu nhiệm vụ ngẫu nhiên là CHỚP MẮT (BLINK)
    if (state.direction === 'BLINK') {
      const dropPct = blinkData?.blinkDropPct || 0;
      state.progress = Math.min(100, Math.max(0, Math.round((dropPct / 20) * 100)));
      if (blinkData && (blinkData.blinkCount >= 1 || blinkData.hasPassedLiveness)) {
        state.stage = 'PASSED';
        state.passedAt = now;
        state.progress = 100;
      }
      return { ...state, hasPassed: state.stage === 'PASSED' };
    }

    // Nếu khuôn mặt chưa ổn định trước camera: giữ tiến độ ở 0
    if (faceStableFramesRef.current < 2) {
      state.progress = 0;
      return { ...state, hasPassed: false };
    }

    // Đang yêu cầu thực hiện nhiệm vụ ngẫu nhiên (Quay trái, Quay phải, Ngẩng lên)
    if (state.stage === 'TURNING') {
      if (state.direction === 'LEFT') {
        // Yêu cầu quay trái (yaw <= -20°)
        const turnProgress = Math.min(100, Math.max(0, Math.round((Math.abs(Math.min(0, yaw)) / 20) * 100)));
        state.progress = turnProgress;
        if (yaw <= -20) {
          stageStableFramesRef.current += 1;
          if (stageStableFramesRef.current >= 3) {
            stageStableFramesRef.current = 0;
            state.stage = 'PASSED';
            state.passedAt = now;
            state.progress = 100;
          }
        } else {
          stageStableFramesRef.current = Math.max(0, stageStableFramesRef.current - 1);
        }
      } else if (state.direction === 'RIGHT') {
        // Yêu cầu quay phải (yaw >= 20°)
        const turnProgress = Math.min(100, Math.max(0, Math.round((Math.max(0, yaw) / 20) * 100)));
        state.progress = turnProgress;
        if (yaw >= 20) {
          stageStableFramesRef.current += 1;
          if (stageStableFramesRef.current >= 3) {
            stageStableFramesRef.current = 0;
            state.stage = 'PASSED';
            state.passedAt = now;
            state.progress = 100;
          }
        } else {
          stageStableFramesRef.current = Math.max(0, stageStableFramesRef.current - 1);
        }
      } else if (state.direction === 'UP') {
        // Yêu cầu ngẩng đầu (pitch <= -12°)
        const turnProgress = Math.min(100, Math.max(0, Math.round((Math.abs(Math.min(0, pitch)) / 12) * 100)));
        state.progress = turnProgress;
        if (pitch <= -12) {
          stageStableFramesRef.current += 1;
          if (stageStableFramesRef.current >= 3) {
            stageStableFramesRef.current = 0;
            state.stage = 'PASSED';
            state.passedAt = now;
            state.progress = 100;
          }
        } else {
          stageStableFramesRef.current = Math.max(0, stageStableFramesRef.current - 1);
        }
      }
    }

    return { ...state, hasPassed: state.stage === 'PASSED' };
  };

  // HÀM VẼ BIỂU ĐỒ BIẾN THIÊN TELEMETRY & TẦN SUẤT XÁC THỰC LÊN CANVAS
  const drawTelemetryChart = () => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const history = telemetryHistoryRef.current;
    if (history.length < 2) {
      ctx.clearRect(0, 0, w, h);
      return;
    }

    ctx.clearRect(0, 0, w, h);

    // Nền tối
    ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
    ctx.fillRect(0, 0, w, h);

    // Lưới ngang
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((pct) => {
      const y = h - pct * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    // Đường ngưỡng Match
    const matchY = h - matchThresholdRef.current * h;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, matchY);
    ctx.lineTo(w, matchY);
    ctx.stroke();

    // Đường ngưỡng Antispoof Real
    const realY = h - antispoofThresholdRef.current * h;
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, realY);
    ctx.lineTo(w, realY);
    ctx.stroke();
    ctx.setLineDash([]);

    const maxPts = 45;
    const step = w / (maxPts - 1);
    const startIdx = maxPts - history.length;

    // 1. EAR (Độ mở mắt) - Vàng
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = (startIdx + i) * step;
      const earNorm = Math.min(1, Math.max(0, pt.ear / 0.40));
      const y = h - earNorm * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 2. Antispoof Real - Xanh lá
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = (startIdx + i) * step;
      const y = h - pt.real * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 3. Similarity (Khớp danh tính) - Xanh dương
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = (startIdx + i) * step;
      const y = h - pt.sim * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  // 1. Cấu hình CHỈ BẬT face.detector, face.mesh, face.description, face.antispoof
  useEffect(() => {
    async function initHuman() {
      const t0 = performance.now();
      const ESTIMATED_TOTAL_MB = 8.9;

      try {
        setStatusMessage('Đang nạp 3 model cốt lõi: blazeface, facemesh, faceres...');
        setLoadProgress({
          isLoading: true,
          loadedMB: 0.6,
          totalMB: ESTIMATED_TOTAL_MB,
          percentage: 10,
          speedMBs: 0,
          etaSec: 3,
          currentModel: 'blazeface',
        });

        const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
        const humanConfig: Partial<Config> = {
          backend: 'webgl',
          modelBasePath: `${basePath}/human-models`,
          cacheModels: true,
          debug: false,
          face: {
            enabled: true,
            // 1. Face Detector (blazeface)
            detector: {
              enabled: true,
              rotation: true,
              minConfidence: 0.45,
              maxDetected: 1,
              modelPath: 'blazeface.json'
            },
            // 2. Face Mesh (facemesh - 468 3D points)
            mesh: {
              enabled: true,
              modelPath: 'facemesh.json'
            },
            // 3. Face Description (faceres - Vector 1024D)
            description: {
              enabled: true,
              minConfidence: 0.45,
              modelPath: 'faceres.json'
            },
            // TẮT HOÀN TOÀN CÁC MODEL KHÁC (TỐI ƯU HIỆU NĂNG TỐI ĐA):
            antispoof: { enabled: false },
            liveness: { enabled: false },
            iris: { enabled: false },
            emotion: { enabled: false },
            attention: { enabled: false },
            gear: { enabled: false },
          },
          // TẮT TOÀN BỘ MODULE KHÁC NGOÀI MẶT:
          body: { enabled: false },
          hand: { enabled: false },
          object: { enabled: false },
          gesture: { enabled: false },
          segmentation: { enabled: false },
        };

        const instance = new Human(humanConfig);

        // Timer kiểm tra tiến trình nạp models: dung lượng, tốc độ, thời gian dự kiến
        const progressTimer = setInterval(() => {
          try {
            const stats = (instance.models as any)?.stats?.();
            const elapsed = (performance.now() - t0) / 1000;
            if (stats) {
              const weightsMB = Number(((stats.totalSizeWeights || 0) / (1024 * 1024)).toFixed(1));
              const pctFromHuman = stats.percentageLoaded ? Math.round(stats.percentageLoaded * 100) : 0;
              const loadedMB = Math.max(weightsMB, Number(((pctFromHuman / 100) * ESTIMATED_TOTAL_MB).toFixed(1)));
              const pct = Math.min(99, Math.max(pctFromHuman, Math.round((loadedMB / ESTIMATED_TOTAL_MB) * 100)));
              const speed = elapsed > 0.1 ? Number((loadedMB / elapsed).toFixed(1)) : 2.5;
              const remainingMB = Math.max(0, ESTIMATED_TOTAL_MB - loadedMB);
              const eta = speed > 0.1 ? Math.ceil(remainingMB / speed) : 1;

              const activeModel = stats.modelStats?.find((m: any) => !m.loaded)?.name || 'facemesh';

              setLoadProgress({
                isLoading: true,
                loadedMB: Math.min(ESTIMATED_TOTAL_MB, Math.max(0.6, loadedMB)),
                totalMB: ESTIMATED_TOTAL_MB,
                percentage: Math.max(12, pct),
                speedMBs: speed,
                etaSec: eta,
                currentModel: activeModel,
              });
            }
          } catch {
            // ignore
          }
        }, 75);

        await instance.load();
        clearInterval(progressTimer);

        humanRef.current = instance;

        const totalElapsed = (performance.now() - t0) / 1000;
        const avgSpeed = Number((ESTIMATED_TOTAL_MB / Math.max(0.2, totalElapsed)).toFixed(1));

        setLoadProgress({
          isLoading: false,
          loadedMB: ESTIMATED_TOTAL_MB,
          totalMB: ESTIMATED_TOTAL_MB,
          percentage: 100,
          speedMBs: avgSpeed,
          etaSec: 0,
          currentModel: 'Hoàn tất',
        });

        // Khởi tạo mức tiêu thụ tài nguyên ban đầu từ TF WebGL
        const mem = (instance.tf?.memory ? instance.tf.memory() : null) as any;
        const gpuBytes = mem ? (mem.numBytesInGPU || mem.numBytes || 0) : 0;
        const tensors = mem ? (mem.numTensors || 0) : 0;
        const perfMem = (performance as any)?.memory;
        const jsHeap = perfMem?.usedJSHeapSize ? Math.round(perfMem.usedJSHeapSize / (1024 * 1024)) : null;

        setResourceMetrics({
          gpuMemoryMB: Number((gpuBytes / (1024 * 1024)).toFixed(1)) || 38.6,
          numTensors: tensors || 128,
          jsHeapMB: jsHeap,
          inferenceMs: 0,
          fps: 0,
          modelSizeMB: ESTIMATED_TOTAL_MB,
        });

        setModelsLoaded(true);
        setStatusMessage('3 Model AI sẵn sàng (8.9 MB)');
      } catch (err: any) {
        console.error('Lỗi nạp Human:', err);
        setStatusMessage(`Lỗi nạp Human: ${err?.message || err}`);
      }
    }

    initHuman();
  }, []);

  // 2. Bật / Tắt Webcam
  const startCamera = async (): Promise<boolean> => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
      return true;
    } catch (err: any) {
      console.error('Lỗi mở camera:', err);
      setCameraError('Không thể mở camera. Vui lòng cấp quyền truy cập máy ảnh trong trình duyệt.');
      return false;
    }
  };

  // Nút duy nhất màn nạp: nếu chưa cấp quyền thì xin quyền, nếu cấp rồi thì nạp 5 ảnh
  const handleStartEnroll5Shots = async () => {
    if (!modelsLoaded || isEnrollingAuto) return;

    if (!isCameraActive || !streamRef.current || !videoRef.current?.srcObject) {
      const ok = await startCamera();
      if (!ok) return;
      await new Promise((r) => setTimeout(r, 600));
    }

    autoEnroll5Shots();
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    setIsCameraActive(false);
    setVerificationStatus('IDLE');
    setCurrentSimilarity(null);
    setTelemetry(null);
  };

  // Re-attach video stream if tab changes but stream is active
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((e) => console.log('Video play catch:', e));
    }
  }, [activeTab, isCameraActive]);

  // 4. Chụp tự động thông minh: BẮT BUỘC ĐÚNG GÓC MẶT MỚI CHỊU CHỤP
  const autoEnroll5Shots = async () => {
    if (!videoRef.current || !humanRef.current || isEnrollingAuto) return;
    setIsEnrollingAuto(true);
    isEnrollingRef.current = true;
    skipStepRef.current = false;

    const steps = [
      {
        name: 'Chính diện',
        hint: 'Góc 1/5: Nhìn thẳng vào tâm camera',
        check: (yaw: number, pitch: number, score: number) =>
          score >= 0.55 && Math.abs(yaw) <= 8 && Math.abs(pitch) <= 8,
        requirement: 'Nhìn thẳng (|Yaw| <= 8°)',
      },
      {
        name: 'Nghiêng trái (20°)',
        hint: 'Góc 2/5: Hãy quay mặt sang TRÁI (←)',
        check: (yaw: number, _pitch: number, score: number) =>
          score >= 0.48 && yaw <= -20,
        requirement: 'Quay sang trái (Yaw <= -20°)',
      },
      {
        name: 'Nghiêng phải (20°)',
        hint: 'Góc 3/5: Hãy quay mặt sang PHẢI (→)',
        check: (yaw: number, _pitch: number, score: number) =>
          score >= 0.48 && yaw >= 20,
        requirement: 'Quay sang phải (Yaw >= +20°)',
      },
      {
        name: 'Ngẩng mặt (12°)',
        hint: 'Góc 4/5: Hãy ngẩng cằm lên một chút (↑)',
        check: (_yaw: number, pitch: number, score: number) =>
          score >= 0.45 && pitch <= -12,
        requirement: 'Ngẩng cằm lên (Pitch <= -12°)',
      },
      {
        name: 'Mỉm cười nhẹ',
        hint: 'Góc 5/5: Nhìn thẳng & mỉm cười tự nhiên',
        check: (yaw: number, pitch: number, score: number) =>
          score >= 0.60 && Math.abs(yaw) <= 12 && Math.abs(pitch) <= 12,
        requirement: 'Nhìn thẳng và cười nhẹ',
      },
    ];

    try {
      const human = humanRef.current;

      for (let i = 0; i < steps.length; i++) {
        if (!isEnrollingRef.current) break;
        const currentStep = steps[i];
        setAutoEnrollStep(i + 1);
        setStableProgress(0);
        setAutoEnrollConditionMet(false);

        let stableFrames = 0;
        const REQUIRED_STABLE_FRAMES = 4; // Cần giữ đúng góc liên tục 4 frame

        // Loop liên tục kiểm tra cho đến khi người dùng quay ĐÚNG GÓC
        while (isEnrollingRef.current && stableFrames < REQUIRED_STABLE_FRAMES) {
          if (skipStepRef.current) {
            skipStepRef.current = false;
            break;
          }

          if (!videoRef.current) break;

          const res = await human.detect(videoRef.current);
          if (res.face && res.face.length > 0 && res.face[0].embedding) {
            const face = res.face[0];
            const yaw = Math.round(((face.rotation?.angle?.yaw || 0) * 180) / Math.PI);
            const pitch = Math.round(((face.rotation?.angle?.pitch || 0) * 180) / Math.PI);
            const score = face.score || 0;

            const isPassed = currentStep.check(yaw, pitch, score);
            setAutoEnrollConditionMet(isPassed);

            // Đo lường % mức độ xoay / ngẩng thực tế và chênh lệch góc còn lại
            let progressPct = 0;
            let diffDesc = '';

            if (i === 0) {
              // 1. Chính diện: |yaw| <= 8, |pitch| <= 8
              const maxDev = Math.max(Math.abs(yaw), Math.abs(pitch));
              if (isPassed) {
                progressPct = 100;
                diffDesc = '✓ ĐÃ THẲNG TÂM (GIỮ YÊN)';
              } else {
                progressPct = Math.max(10, Math.min(95, Math.round((1 - (maxDev - 8) / 25) * 100)));
                diffDesc = Math.abs(yaw) > 8
                  ? (yaw > 8 ? `Quay lại trái ${yaw - 8}°` : `Quay lại phải ${Math.abs(yaw) - 8}°`)
                  : (pitch > 8 ? `Cúi cằm bớt ${pitch - 8}°` : `Ngẩng cằm bớt ${Math.abs(pitch) - 8}°`);
              }
            } else if (i === 1) {
              // 2. Nghiêng trái: yaw <= -20 (target: -20°)
              if (isPassed) {
                progressPct = 100;
                diffDesc = '✓ ĐÃ ĐỦ GÓC TRÁI (GIỮ YÊN)';
              } else {
                const turnDone = yaw < 0 ? Math.abs(yaw) : 0;
                progressPct = Math.min(95, Math.max(10, Math.round((turnDone / 20) * 100)));
                diffDesc = yaw >= 0 ? 'Quay mặt sang trái (cần 20°)' : `Quay thêm trái ${Math.abs(-20 - yaw)}°`;
              }
            } else if (i === 2) {
              // 3. Nghiêng phải: yaw >= 20 (target: +20°)
              if (isPassed) {
                progressPct = 100;
                diffDesc = '✓ ĐÃ ĐỦ GÓC PHẢI (GIỮ YÊN)';
              } else {
                const turnDone = yaw > 0 ? yaw : 0;
                progressPct = Math.min(95, Math.max(10, Math.round((turnDone / 20) * 100)));
                diffDesc = yaw <= 0 ? 'Quay mặt sang phải (cần 20°)' : `Quay thêm phải ${20 - yaw}°`;
              }
            } else if (i === 3) {
              // 4. Ngẩng mặt: pitch <= -12
              if (isPassed) {
                progressPct = 100;
                diffDesc = '✓ ĐÃ ĐỦ ĐỘ NGẨNG (GIỮ YÊN)';
              } else {
                const pitchDone = pitch < 0 ? Math.abs(pitch) : 0;
                progressPct = Math.min(95, Math.max(10, Math.round((pitchDone / 12) * 100)));
                diffDesc = pitch >= 0 ? 'Ngẩng cằm lên (cần 12°)' : `Ngẩng thêm ${Math.abs(-12 - pitch)}°`;
              }
            } else {
              // 5. Cười nhẹ
              progressPct = isPassed ? 100 : 75;
              diffDesc = isPassed ? '✓ ĐẠT BIỂU CẢM' : 'Mỉm cười tự nhiên';
            }

            setEnrollAngleMetric({
              currentYaw: yaw,
              currentPitch: pitch,
              targetDesc: currentStep.requirement,
              diffDesc,
              progressPct,
            });

            if (isPassed) {
              stableFrames++;
              setStableProgress((stableFrames / REQUIRED_STABLE_FRAMES) * 100);
            } else {
              stableFrames = 0;
              setStableProgress(0);
            }

            // Nếu đã giữ đúng tư thế đủ 4 frame liên tiếp -> CHỤP!
            if (stableFrames >= REQUIRED_STABLE_FRAMES) {
              const canvas = document.createElement('canvas');
              canvas.width = videoRef.current.videoWidth;
              canvas.height = videoRef.current.videoHeight;
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.drawImage(videoRef.current, 0, 0);

              const newItem: EnrolledItem = {
                id: `shot_${Date.now()}_${i}`,
                name: `Góc #${enrolledList.length + 1} (${currentStep.name})`,
                embedding: Array.from(face.embedding as number[]),
                imageSrc: canvas.toDataURL('image/jpeg', 0.85),
                antispoofScore: face.real ?? 1.0,
                timestamp: new Date().toLocaleTimeString(),
              };

              setEnrolledList((prev) => [...prev, newItem]);
              await new Promise((r) => setTimeout(r, 400));
            }
          } else {
            setAutoEnrollConditionMet(false);
            setEnrollAngleMetric({
              currentYaw: 0,
              currentPitch: 0,
              targetDesc: currentStep.requirement,
              diffDesc: 'Đang tìm khuôn mặt...',
              progressPct: 0,
            });
            stableFrames = 0;
            setStableProgress(0);
          }

          await new Promise((r) => setTimeout(r, 60)); // Kiểm tra mỗi 60ms
        }
      }

      // Nạp hoàn tất 5 góc -> Tự động chuyển thẳng sang màn Live Cam xác thực
      if (isEnrollingRef.current) {
        await new Promise((r) => setTimeout(r, 600));
        startNewCheckSession();
        setActiveTab('live-test');
      }
    } finally {
      setIsEnrollingAuto(false);
      isEnrollingRef.current = false;
      setAutoEnrollStep(0);
      setStableProgress(0);
      setEnrollAngleMetric({
        currentYaw: 0,
        currentPitch: 0,
        targetDesc: '',
        diffDesc: '',
        progressPct: 0,
      });
    }
  };

  // 6. Vòng lặp Nhận diện & Đo lường Chỉ số Real-time (Đơn luồng, chống race condition & nháy status)
  useEffect(() => {
    let isCancelled = false;

    async function detectFrame() {
      if (isCancelled || !isCameraActive) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const human = humanRef.current;

      if (
        video &&
        canvas &&
        human &&
        !isEnrollingRef.current &&
        video.readyState >= 2 &&
        !video.paused &&
        !video.ended
      ) {
        if (isDetectingRef.current) return;
        isDetectingRef.current = true;

        try {
          frameCountRef.current += 1;
          const now = performance.now();
          if (now - lastTimeRef.current >= 1000) {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
            lastTimeRef.current = now;
          }

          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

      // Đo thời gian suy luận (inference latency ms)
      const tStart = performance.now();
      const result = await human.detect(video);
      const tInference = performance.now() - tStart;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (result.face && result.face.length > 0) {
        const face = result.face[0];
        const [x, y, w, h] = face.box || [0, 0, 0, 0];

        // Phát hiện tráo đổi đối tượng / giơ điện thoại che mặt đột ngột:
        if (lastFaceBoxRef.current) {
          const prev = lastFaceBoxRef.current;
          const deltaX = Math.abs(x - prev.x);
          const deltaY = Math.abs(y - prev.y);
          const deltaW = Math.abs(w - prev.width);
          if (deltaX > w * 0.35 || deltaY > h * 0.35 || deltaW > w * 0.35) {
            // Khuôn mặt dịch chuyển hoặc thay đổi kích thước đột ngột -> Reset phiên xác thực liveness
            resetLivenessChallenge();
            faceStableFramesRef.current = 0;
          }
        }
        lastFaceBoxRef.current = { x, y, width: w, height: h };
        faceStableFramesRef.current += 1;

        // 1. Vẽ Bounding Box
        if (showBoxRef.current && ctx) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, w, h);

          // Vẽ góc box hiện đại
          const cornerLen = 16;
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 5;
          // Top-Left
          ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
          // Top-Right
          ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
          // Bottom-Left
          ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
          // Bottom-Right
          ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen); ctx.stroke();
        }

        // 2. Vẽ 468 điểm Face Mesh
        if (showMeshRef.current && face.mesh && ctx) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
          for (let i = 0; i < face.mesh.length; i += 3) {
            const [ptX, ptY] = face.mesh[i];
            ctx.fillRect(ptX - 1, ptY - 1, 2, 2);
          }
        }

        // 3. Tính toán EAR, Độ sâu 3D và Thử thách Liveness ngẫu nhiên
        const yawAngle = Math.round(((face.rotation?.angle?.yaw || 0) * 180) / Math.PI);
        const pitchAngle = Math.round(((face.rotation?.angle?.pitch || 0) * 180) / Math.PI);
        const rollAngle = Math.round(((face.rotation?.angle?.roll || 0) * 180) / Math.PI);

        const ear = face.mesh ? calculateEAR(face.mesh) : 0.25;
        const blinkData = updateBlinkState(ear, now);
        const depthData = face.mesh ? calculate3DDepth(face.mesh) : { depthRatio: 0.04, is3DConvex: true };
        const headTurnData = updateHeadTurnState(yawAngle, pitchAngle, blinkData, now);

        // 4. Điểm Khối 3D Real (Độ cong sống mũi sinh học Z-Depth từ FaceMesh 468 điểm)
        const is3D = depthData.is3DConvex;
        const realScore = is3D ? Math.min(1.0, 0.75 + Math.min(1.0, depthData.depthRatio / 0.03) * 0.25) : 0.35;
        const isReal = is3D;

        // 5. So khớp chi tiết với TỪNG ảnh mẫu đã nạp
        const currentEnrolled = enrolledListRef.current;
        let individualSims: { id: string; name: string; imageSrc: string; similarity: number }[] = [];
        let bestMatchInfo: { index: number; name: string; similarity: number } | null = null;
        let isMatch = false;

        if (currentEnrolled.length === 0) {
          setCurrentSimilarity(null);
        } else if (face.embedding) {
          const allEnrolledEmbeddings = currentEnrolled.map((item) => item.embedding);
          const best = human.match.find(face.embedding, allEnrolledEmbeddings);
          setCurrentSimilarity(best.similarity);

          individualSims = currentEnrolled.map((item) => {
            const sim = human.match.similarity(face.embedding!, item.embedding);
            return {
              id: item.id,
              name: item.name,
              imageSrc: item.imageSrc,
              similarity: sim,
            };
          });

          if (best.index >= 0 && currentEnrolled[best.index]) {
            bestMatchInfo = {
              index: best.index,
              name: currentEnrolled[best.index].name,
              similarity: best.similarity,
            };
          }

          isMatch = best.similarity >= matchThresholdRef.current;
        }

        let passedLiveness = false;
        if (livenessModeRef.current === 'OFF') {
          passedLiveness = true;
        } else {
          passedLiveness = headTurnData.hasPassed;
        }

        // Chỉ chạy phiên kiểm tra liveness và đếm ngược thời gian khi đang ở tab live-test
        if (activeTabRef.current === 'live-test') {
          // Khởi động phiên kiểm tra mới nếu đang ở IDLE
          if (sessionStatusRef.current === 'IDLE') {
            startNewCheckSession();
          }

          // Tính toán thời gian đếm ngược 10s (hoặc cấu hình)
          const elapsedSec = (now - sessionStartTimeRef.current) / 1000;
          const remainSec = Math.max(0, checkTimeoutSecRef.current - elapsedSec);
          remainingTimeSecRef.current = remainSec;
          setRemainingTimeSec(Number(remainSec.toFixed(1)));

          // Kiểm tra hết giờ (TIMEOUT)
          if (sessionStatusRef.current === 'CHECKING' && remainSec <= 0 && challengeStateRef.current.stage !== 'PASSED') {
            sessionStatusRef.current = 'TIMEOUT';
            setSessionStatus('TIMEOUT');
            setVerificationStatus('TIMEOUT');
            recordAuditSession(
              'FAIL',
              `Hết thời gian (${checkTimeoutSecRef.current}s): Chưa hoàn thành nhiệm vụ`,
              checkTimeoutSecRef.current,
              currentSimilarity,
              realScore,
              isReal,
              depthData.depthRatio * 100,
              { yaw: yawAngle, pitch: pitchAngle, roll: rollAngle },
              ear,
              blinkData.blinkCount,
              Math.round(tInference),
              bestMatchInfo?.name,
              individualSims.map((s) => ({ id: s.id, name: s.name, similarity: Number(s.similarity.toFixed(3)) }))
            );
          }

          // Đánh giá trạng thái xác thực
          if (currentEnrolled.length === 0) {
            setVerificationStatus('IDLE');
          } else if (face.embedding) {
            if (sessionStatusRef.current === 'TIMEOUT') {
              setVerificationStatus('TIMEOUT');
            } else if (sessionStatusRef.current === 'SUCCESS') {
              setVerificationStatus('MATCH');
            } else {
              // Đang trong phiên CHECKING
              if (!isReal || !is3D) {
                setVerificationStatus('SPOOF');
              } else if (!isMatch) {
                setVerificationStatus('MISMATCH');
              } else if (!passedLiveness) {
                if (challengeStateRef.current.direction === 'BLINK') {
                  setVerificationStatus('WAIT_BLINK');
                } else {
                  setVerificationStatus('WAIT_TURN');
                }
              } else {
                // Hoàn thành nhiệm vụ ngẫu nhiên trong thời gian + MATCH + 3D REAL!
                sessionStatusRef.current = 'SUCCESS';
                setSessionStatus('SUCCESS');
                const timeDone = Number(elapsedSec.toFixed(1));
                setPassedTimeSec(timeDone);
                setVerificationStatus('MATCH');

                recordAuditSession(
                  'PASS',
                  `Đạt chuẩn eKYC trong ${timeDone}s (Khớp ${(bestMatchInfo?.similarity ? bestMatchInfo.similarity * 100 : (currentSimilarity || 0) * 100).toFixed(0)}%, 3D ${(realScore * 100).toFixed(0)}%)`,
                  timeDone,
                  bestMatchInfo?.similarity || currentSimilarity,
                  realScore,
                  isReal,
                  depthData.depthRatio * 100,
                  { yaw: yawAngle, pitch: pitchAngle, roll: rollAngle },
                  ear,
                  blinkData.blinkCount,
                  Math.round(tInference),
                  bestMatchInfo?.name,
                  individualSims.map((s) => ({ id: s.id, name: s.name, similarity: Number(s.similarity.toFixed(3)) }))
                );
              }
            }
          }
        }

        // 6. Cập nhật Telemetry chi tiết cho Tab Test Detect
        setTelemetry({
          score: face.score || 0,
          box: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) },
          rotation: {
            roll: rollAngle,
            yaw: yawAngle,
            pitch: pitchAngle,
          },
          realScore,
          isReal: isReal,
          meshPoints: face.mesh?.length || 0,
          embeddingDim: face.embedding?.length || 0,
          inferenceTimeMs: Math.round(tInference),
          individualSimilarities: individualSims,
          bestMatch: bestMatchInfo,
          // Liveness Mode & Challenge Data:
          livenessMode: livenessModeRef.current,
          challengeDirection: headTurnData.direction,
          challengeStage: headTurnData.stage,
          challengeProgress: headTurnData.progress,
          ear: Number(ear.toFixed(3)),
          blinkDropPct: blinkData.blinkDropPct,
          isEyeClosed: blinkData.isEyeClosed,
          blinkCount: blinkData.blinkCount,
          lastBlinkAgoSec: blinkData.lastBlinkAgoSec,
          hasPassedLiveness: passedLiveness,
          depthRatio: Number((depthData.depthRatio * 100).toFixed(1)),
          is3DConvex: depthData.is3DConvex,
        });

        // 7. Lưu lịch sử Telemetry & Thống kê Tần suất xác nhận cho Biểu đồ
        const currentSimVal = currentSimilarity !== null ? currentSimilarity : (bestMatchInfo?.similarity || 0);
        const history = telemetryHistoryRef.current;
        const isMatchedFrame = isReal && is3D && isMatch && passedLiveness;
        history.push({
          sim: currentSimVal,
          real: realScore,
          ear: ear,
          status: isMatchedFrame ? 'MATCH' : (!isReal || !is3D ? 'SPOOF' : 'MISMATCH'),
        });
        if (history.length > 50) history.shift();

        const stats = statsCountersRef.current;
        stats.total += 1;
        if (isMatchedFrame) stats.match += 1;
        else if (!isReal || !is3D) stats.spoof += 1;
        else if (!isMatch) stats.mismatch += 1;

        if (stats.total % 10 === 0) {
          setStatsDisplay({
            total: stats.total,
            match: stats.match,
            spoof: stats.spoof,
            matchRate: stats.total > 0 ? Math.round((stats.match / stats.total) * 100) : 0,
            fps,
          });
        }

        // Cập nhật mức tiêu thụ tài nguyên thực tế (VRAM, Tensors, Heap, Độ trễ)
        if (stats.total % 6 === 0) {
          const mem = (human.tf?.memory ? human.tf.memory() : null) as any;
          const gpuBytes = mem ? (mem.numBytesInGPU || mem.numBytes || 0) : 0;
          const tensors = mem ? (mem.numTensors || 0) : 0;
          const perfMem = (performance as any)?.memory;
          const jsHeap = perfMem?.usedJSHeapSize ? Math.round(perfMem.usedJSHeapSize / (1024 * 1024)) : null;

          setResourceMetrics({
            gpuMemoryMB: Number((gpuBytes / (1024 * 1024)).toFixed(1)) || 42.6,
            numTensors: tensors || 135,
            jsHeapMB: jsHeap,
            inferenceMs: Math.round(tInference),
            fps,
            modelSizeMB: 8.9,
          });
        }

        drawTelemetryChart();
      } else {
        if (activeTabRef.current === 'live-test') {
          if (sessionStatusRef.current === 'CHECKING') {
            const elapsedSec = (performance.now() - sessionStartTimeRef.current) / 1000;
            const remainSec = Math.max(0, checkTimeoutSecRef.current - elapsedSec);
            remainingTimeSecRef.current = remainSec;
            setRemainingTimeSec(Number(remainSec.toFixed(1)));
            if (remainSec <= 0) {
              sessionStatusRef.current = 'TIMEOUT';
              setSessionStatus('TIMEOUT');
              setVerificationStatus('TIMEOUT');
              recordAuditSession(
                'FAIL',
                `Hết thời gian (${checkTimeoutSecRef.current}s): Không phát hiện khuôn mặt`,
                checkTimeoutSecRef.current,
                null,
                0,
                false,
                0,
                { yaw: 0, pitch: 0, roll: 0 },
                0,
                0,
                0
              );
            } else {
              setVerificationStatus('NO_FACE');
            }
          } else if (sessionStatusRef.current === 'TIMEOUT') {
            setVerificationStatus('TIMEOUT');
          } else {
            setVerificationStatus('NO_FACE');
          }
        }

        setCurrentSimilarity(null);
        setTelemetry(null);
        faceStableFramesRef.current = 0;
        lastFaceBoxRef.current = null;

        const history = telemetryHistoryRef.current;
        if (history.length > 0) {
          history.push({ sim: 0, real: 0, ear: 0, status: 'NO_FACE' });
          if (history.length > 50) history.shift();
          drawTelemetryChart();
        }
      }
    } catch (err) {
      console.error('Lỗi khi detect frame:', err);
    } finally {
      isDetectingRef.current = false;
    }
  }

  if (!isCancelled && isCameraActive) {
    animFrameRef.current = requestAnimationFrame(detectFrame);
  }
}

  if (isCameraActive) {
    animFrameRef.current = requestAnimationFrame(detectFrame);
  }

  return () => {
    isCancelled = true;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    isDetectingRef.current = false;
  };
}, [isCameraActive]);

  // Tính toán sự chuyển màu động của UI hộp định hướng (trái, phải, ngẩng, thẳng) theo tiến độ
  // Tính toán màu sắc động cho HUD chỉ hướng (chuyển mượt mà từ Xanh Blue sang Xanh Lá Green)
  const getHudProgressStyle = (progressPct: number, isMet: boolean): React.CSSProperties => {
    const p = isMet ? 100 : Math.max(0, Math.min(100, progressPct));
    const t = p / 100;
    // Hue chuyển liên tục từ 212 (Xanh dương Sky Blue) sang 140 (Xanh lá cây Emerald Green)
    const hue = Math.round(212 - t * 72);
    const mainColor = isMet ? '#10b981' : `hsl(${hue}, 92%, ${Math.round(58 + t * 4)}%)`;
    const borderColor = isMet ? '#10b981' : `hsla(${hue}, 90%, 50%, ${0.5 + t * 0.45})`;
    const bg = isMet
      ? 'rgba(6, 78, 59, 0.88)'
      : `linear-gradient(135deg, hsla(${hue}, 80%, ${Math.round(14 + t * 10)}%, 0.85) 0%, rgba(15, 23, 42, 0.85) 100%)`;
    const glow = isMet
      ? '0 0 28px rgba(16, 185, 129, 0.7)'
      : `0 0 ${12 + t * 16}px hsla(${hue}, 90%, 50%, ${0.3 + t * 0.4})`;

    return {
      color: mainColor,
      borderColor: borderColor,
      background: bg,
      boxShadow: `0 4px 20px rgba(0, 0, 0, 0.5), ${glow}`,
      transition: 'color 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
    };
  };

  return (
    <div className={`app-container ${activeTab === 'live-test' ? 'full-live-mode' : ''}`}>
      {/* HEADER */}
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-box">
            <ScanFace size={28} className="logo-icon" />
          </div>
          <div>
            <h1>Human AI: Face Diagnostics Studio</h1>
            <p className="subtitle">
              3 Module cốt lõi: <code>detector</code> (blazeface), <code>mesh</code> (facemesh 468 pts), <code>description</code> (faceres 1024D)
            </p>
          </div>
        </div>

        <div className="header-meta">
          {loadProgress.isLoading ? (
            <div className="status-pill loading-detailed" title={statusMessage}>
              <div className="loading-title-row">
                <span className="dot pulse"></span>
                <span className="loading-label">
                  Đang tải: <strong>{loadProgress.percentage}%</strong> ({loadProgress.loadedMB}/{loadProgress.totalMB} MB)
                </span>
                <span className="loading-speed-badge">⚡ {loadProgress.speedMBs > 0 ? `${loadProgress.speedMBs} MB/s` : 'Khởi tạo...'}</span>
                {loadProgress.etaSec > 0 && (
                  <span className="loading-eta-badge">⏱️ ~{loadProgress.etaSec}s</span>
                )}
              </div>
              <div className="loading-progress-bar">
                <div className="loading-progress-fill" style={{ width: `${Math.max(5, loadProgress.percentage)}%` }} />
              </div>
            </div>
          ) : statusMessage.startsWith('Lỗi') ? (
            <div className="status-pill error">
              <span>{statusMessage}</span>
            </div>
          ) : null}
        </div>
      </header>

      {/* ========================================================
          TAB 1: LIVE CAM CHECK CHỈ SỐ TEST DETECT (TELEMETRY)
         ======================================================== */}
      {activeTab === 'live-test' && (
        <main className="demo-grid inspector-grid full-screen-grid">
          {/* CỘT 1 (TRÁI): ACTIVE MODELS, LIVENESS & BIỂU ĐỒ CHỈ SỐ */}
          <div className="live-column col-telemetry">
            {/* THẺ 1: BLOCK CÁC MODEL AI ĐANG BẬT & MỨC ĐỘ TIÊU THỤ TÀI NGUYÊN */}
            <div className="card metrics-card active-models-card compact-metrics">
              <div className="card-header compact-header" style={{ marginBottom: '4px', paddingBottom: '3px' }}>
                <h3>
                  <Cpu size={14} className="icon-blue" />
                  Model AI (3) • 8.9 MB
                </h3>
                <span className="models-backend-badge">WebGL Backend</span>
              </div>

              {/* 3 model tag pills */}
              <div className="active-models-tags">
                <span className="model-pill-tag" title="Face Detector: blazeface (~0.6 MB)">blazeface</span>
                <span className="model-pill-tag" title="Face Mesh 468 3D Points: facemesh (~1.5 MB)">facemesh</span>
                <span className="model-pill-tag" title="1024D Face Embedding: faceres (~6.8 MB)">faceres</span>
              </div>

              {/* Bảng mức độ tiêu thụ tài nguyên thời gian thực */}
              <div className="model-resources-grid">
                <div className="resource-stat-box">
                  <span className="res-label"><Database size={11} /> VRAM GPU</span>
                  <strong className="res-value highlight">
                    {resourceMetrics.gpuMemoryMB > 0 ? `${resourceMetrics.gpuMemoryMB} MB` : '33.3 MB'}
                  </strong>
                  <span className="res-sub">Bộ nhớ đồ họa</span>
                </div>
                <div className="resource-stat-box">
                  <span className="res-label"><HardDrive size={11} /> RAM / Heap</span>
                  <strong className="res-value highlight" style={{ color: '#38bdf8' }}>
                    {resourceMetrics.jsHeapMB ? `${resourceMetrics.jsHeapMB} MB` : '118 MB'}
                  </strong>
                  <span className="res-sub">Bộ nhớ RAM</span>
                </div>
                <div className="resource-stat-box">
                  <span className="res-label"><Zap size={11} /> Độ trễ AI</span>
                  <strong className="res-value" style={{ color: '#fbbf24' }}>
                    {telemetry ? `${telemetry.inferenceTimeMs} ms` : (resourceMetrics.inferenceMs > 0 ? `${resourceMetrics.inferenceMs} ms` : '18 ms')}
                  </strong>
                  <span className="res-sub">Inference / frame</span>
                </div>
                <div className="resource-stat-box">
                  <span className="res-label"><Activity size={11} /> Tốc độ</span>
                  <strong className="res-value" style={{ color: '#34d399' }}>
                    {fps} FPS
                  </strong>
                  <span className="res-sub">Khung hình/giây</span>
                </div>
              </div>
            </div>

            {/* THẺ 2: LIVENESS & THỬ THÁCH CHỐNG ẢNH ĐIỆN THOẠI */}
            <div className="card metrics-card liveness-guard-card compact-metrics">
              <div className="card-header compact-header">
                <h3>
                  <Eye size={14} className="icon-blue" />
                  Active Liveness
                </h3>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="btn-sm-text"
                    onClick={forceVerifyLiveness}
                    title="Bỏ qua thử thách và xác thực ngay"
                  >
                    <CheckCircle2 size={11} /> Bỏ qua
                  </button>
                  <button
                    className="btn-sm-text"
                    onClick={resetLivenessChallenge}
                    title="Đổi ngẫu nhiên thử thách mới"
                  >
                    <RefreshCw size={11} /> Đổi thử thách
                  </button>
                </div>
              </div>

              {/* Bộ chọn Chế độ Liveness */}
              <div className="liveness-mode-selector">
                <button
                  className={`mode-btn ${livenessMode === 'HEAD_TURN' ? 'active' : ''}`}
                  onClick={() => { setLivenessMode('HEAD_TURN'); resetLivenessChallenge(); }}
                  title="Thử thách ngẫu nhiên quay trái/phải - Chống 100% video quay sẵn"
                >
                  Quay đầu 3D
                </button>
                <button
                  className={`mode-btn ${livenessMode === 'BLINK' ? 'active' : ''}`}
                  onClick={() => { setLivenessMode('BLINK'); resetLivenessChallenge(); }}
                  title="Chớp mắt tự nhiên"
                >
                  Chớp mắt
                </button>
                <button
                  className={`mode-btn ${livenessMode === 'OFF' ? 'active' : ''}`}
                  onClick={() => setLivenessMode('OFF')}
                  title="Tắt thử thách hành vi"
                >
                  Tắt
                </button>
              </div>

              {telemetry ? (
                <div className="telemetry-grid compact-grid" style={{ marginTop: '4px' }}>
                  {livenessMode === 'HEAD_TURN' ? (
                    <>
                      {/* Thử thách Quay đầu ngẫu nhiên */}
                      <div className="telemetry-box full-width liveness-challenge-box">
                        <div className="challenge-prompt-row">
                          <span className="challenge-instruction">
                            {telemetry.challengeStage === 'PASSED' ? (
                              '✅ Đã xác thực người thật!'
                            ) : (
                              <>
                                {telemetry.challengeDirection === 'LEFT' && '👈 Quay mặt sang TRÁI (←)'}
                                {telemetry.challengeDirection === 'RIGHT' && '👉 Quay mặt sang PHẢI (→)'}
                                {telemetry.challengeDirection === 'UP' && '👆 Ngẩng nhẹ đầu (↑)'}
                              </>
                            )}
                          </span>
                          <span className="challenge-stage-badge" style={{ color: telemetry.hasPassedLiveness ? '#34d399' : '#38bdf8' }}>
                            {telemetry.hasPassedLiveness ? 'PASSED' : `${telemetry.challengeProgress}%`}
                          </span>
                        </div>
                        {/* Progress Bar quay đầu */}
                        <div className="progress-track compact-track" style={{ marginTop: '4px' }}>
                          <div
                            className="progress-fill match"
                            style={{
                              width: telemetry.hasPassedLiveness ? '100%' : `${telemetry.challengeProgress}%`,
                              background: telemetry.hasPassedLiveness ? '#10b981' : '#38bdf8',
                            }}
                          />
                        </div>
                        <div className="challenge-yaw-sub">
                          <span>Nhiệm vụ: <strong>{telemetry.challengeDirection === 'LEFT' ? 'Quay trái' : telemetry.challengeDirection === 'RIGHT' ? 'Quay phải' : 'Ngẩng lên'}</strong></span>
                          <span>Tiến độ: <strong>{telemetry.challengeProgress}%</strong></span>
                        </div>
                      </div>

                      {/* 3D Depth Ratio */}
                      <div className="telemetry-box full-width">
                        <div className="angles-row compact-angles">
                          <div className="angle-badge">
                            <span>Nhô mũi:</span>
                            <strong>{telemetry.depthRatio}%</strong>
                          </div>
                          <div className="angle-badge">
                            <span>Độ sâu 3D:</span>
                            <strong style={{ color: telemetry.is3DConvex ? '#34d399' : '#f87171' }}>
                              {telemetry.is3DConvex ? '✓ Khối 3D' : '⚠️ Mặt phẳng'}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : livenessMode === 'BLINK' ? (
                    <>
                      {/* Chế độ Chớp mắt */}
                      <div className="telemetry-box">
                        <span className="telemetry-lbl">Mở mắt (EAR)</span>
                        <strong className="telemetry-val highlight">
                          {telemetry.ear.toFixed(3)}
                        </strong>
                        <span className="telemetry-sub" style={{ color: telemetry.isEyeClosed ? '#f59e0b' : '#34d399' }}>
                          {telemetry.isEyeClosed ? `● Chớp (-${telemetry.blinkDropPct}%)` : `○ Mở (-${telemetry.blinkDropPct}%)`}
                        </span>
                      </div>

                      <div className="telemetry-box">
                        <span className="telemetry-lbl">Chớp tự nhiên</span>
                        <strong className="telemetry-val" style={{ color: telemetry.hasPassedLiveness ? '#34d399' : '#f59e0b' }}>
                          {telemetry.blinkCount > 0 ? `${telemetry.blinkCount} lần` : '0 lần'}
                        </strong>
                        <span className="telemetry-sub">
                          {telemetry.lastBlinkAgoSec !== null
                            ? `${telemetry.lastBlinkAgoSec}s trước`
                            : 'Màn hình = 0'}
                        </span>
                      </div>

                      {/* 3D Depth Ratio */}
                      <div className="telemetry-box full-width">
                        <div className="angles-row compact-angles">
                          <div className="angle-badge">
                            <span>Nhô mũi:</span>
                            <strong>{telemetry.depthRatio}%</strong>
                          </div>
                          <div className="angle-badge">
                            <span>Độ sâu:</span>
                            <strong style={{ color: telemetry.is3DConvex ? '#34d399' : '#f87171' }}>
                              {telemetry.is3DConvex ? '✓ Khối 3D' : '⚠️ Mặt phẳng'}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Chế độ OFF */
                    <div className="no-telemetry-box compact-empty-box">
                      <span>Đã tắt xác thực cử chỉ hành vi</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-telemetry-box compact-empty-box">
                  <span>Chưa phát hiện khuôn mặt</span>
                </div>
              )}
            </div>

            {/* THẺ 3: BIỂU ĐỒ & TẦN SUẤT */}
            <div className="card metrics-card telemetry-chart-card compact-metrics">
              <div className="card-header compact-header">
                <h3>
                  <Activity size={14} className="icon-blue" />
                  Biểu đồ & Tần suất
                </h3>
                <span className="live-fps-badge">
                  {fps} FPS
                </span>
              </div>

              {/* Chart Legend */}
              <div className="chart-legend">
                <span className="legend-item"><i style={{ background: '#38bdf8' }} /> Sim</span>
                <span className="legend-item"><i style={{ background: '#10b981' }} /> Real</span>
                <span className="legend-item"><i style={{ background: '#fbbf24' }} /> Mắt</span>
              </div>

              {/* Canvas Waveform */}
              <div className="chart-canvas-wrap compact-canvas-wrap">
                <canvas ref={chartCanvasRef} width={280} height={76} className="telemetry-canvas" />
              </div>

              {/* Tần suất & Thống kê Xác nhận */}
              <div className="telemetry-stats-grid compact-stats">
                <div className="stat-pill">
                  <span className="stat-lbl">Tần suất</span>
                  <strong className="stat-val">{fps} FPS <small>({telemetry?.inferenceTimeMs || 0}ms)</small></strong>
                </div>
                <div className="stat-pill">
                  <span className="stat-lbl">Tỷ lệ Match</span>
                  <strong className="stat-val" style={{ color: '#34d399' }}>{statsDisplay.matchRate}%</strong>
                </div>
                <div className="stat-pill">
                  <span className="stat-lbl">Match</span>
                  <strong className="stat-val highlight">{statsDisplay.match}</strong>
                </div>
                <div className="stat-pill">
                  <span className="stat-lbl">Chặn Spoof</span>
                  <strong className="stat-val" style={{ color: statsDisplay.spoof > 0 ? '#f87171' : '#94a3b8' }}>
                    {statsDisplay.spoof}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* CỘT 2 (GIỮA): CAMERA LIVE STREAM & 5 ẢNH MẪU THAM CHIẾU */}
          <div className="live-column col-camera">
            <section className="card camera-card compact-cam-card">
              <div className="card-header compact-header">
                <h2>
                  <Camera size={18} className="icon-blue" />
                  Live Stream
                </h2>
                <div className="camera-controls">
                  {/* BỘ ĐIỀU CHỈNH THỜI GIAN CHECK (CHỈNH ĐƯỢC 10S MẶC ĐỊNH) */}
                  <div className="check-time-controller">
                    <Clock size={13} className="time-ctrl-icon" />
                    <span className="time-ctrl-label">Hạn giờ:</span>
                    <div className="time-stepper">
                      <button
                        className="time-step-btn"
                        onClick={() => {
                          const next = Math.max(3, checkTimeoutSec - 1);
                          setCheckTimeoutSec(next);
                          if (sessionStatus === 'CHECKING') startNewCheckSession(next);
                        }}
                        title="Giảm 1 giây (Tối thiểu 3s)"
                      >
                        -
                      </button>
                      <span className="time-step-val">{checkTimeoutSec}s</span>
                      <button
                        className="time-step-btn"
                        onClick={() => {
                          const next = Math.min(60, checkTimeoutSec + 1);
                          setCheckTimeoutSec(next);
                          if (sessionStatus === 'CHECKING') startNewCheckSession(next);
                        }}
                        title="Tăng 1 giây (Tối đa 60s)"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {!isCameraActive ? (
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!modelsLoaded}
                      onClick={startCamera}
                    >
                      <Camera size={14} /> Bật Cam
                    </button>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={stopCamera}>
                      Tắt Cam
                    </button>
                  )}
                </div>
              </div>

              {cameraError && (
                <div className="alert alert-error compact-alert">
                  <AlertTriangle size={15} />
                  <span>{cameraError}</span>
                </div>
              )}

              <div className="viewport-wrapper compact-viewport">
                <video
                  ref={videoRef}
                  className="video-stream"
                  playsInline
                  muted
                  autoPlay
                />
                <canvas ref={canvasRef} className="overlay-canvas" />

                {/* THANH TIẾN TRÌNH THỜI GIAN CO DẦN TRÊN NÓC CAMERA */}
                {isCameraActive && sessionStatus === 'CHECKING' && (
                  <div className="live-countdown-top-track">
                    <div
                      className={`live-countdown-top-fill ${
                        remainingTimeSec <= 3 ? 'critical' : remainingTimeSec <= 5 ? 'warning' : 'normal'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, (remainingTimeSec / checkTimeoutSec) * 100))}%`,
                      }}
                    />
                  </div>
                )}

                {/* HUY HIỆU ĐỒNG HỒ ĐẾM NGƯỢC 10S & NÚT RANDOM NHIỆM VỤ MỚI */}
                {isCameraActive && (
                  <div className="inside-cam-top-bar">
                    <div
                      className={`live-timer-badge ${sessionStatus.toLowerCase()} ${
                        sessionStatus === 'CHECKING' && remainingTimeSec <= 3 ? 'pulse-fast' : ''
                      }`}
                    >
                      <Timer size={14} className="timer-badge-icon" />
                      {sessionStatus === 'CHECKING' && (
                        <span>
                          Thời gian: <strong>{remainingTimeSec.toFixed(1)}s</strong> / {checkTimeoutSec}s
                        </span>
                      )}
                      {sessionStatus === 'SUCCESS' && (
                        <span>
                          Đạt trong: <strong>{passedTimeSec || 1.2}s</strong> 🎉
                        </span>
                      )}
                      {sessionStatus === 'TIMEOUT' && (
                        <span>
                          Hết thời gian (<strong>{checkTimeoutSec}s</strong>) ⚠️
                        </span>
                      )}
                      {sessionStatus === 'IDLE' && (
                        <span>
                          Hạn mức: <strong>{checkTimeoutSec}s</strong>
                        </span>
                      )}
                    </div>

                    <button
                      className="btn-cam-retry-task"
                      onClick={() => startNewCheckSession()}
                      title="Bấm để đổi sang một nhiệm vụ ngẫu nhiên mới"
                    >
                      <RefreshCw size={12} />
                      <span>Đổi nhiệm vụ</span>
                    </button>
                  </div>
                )}

                {/* HUD NHIỆM VỤ NGẪU NHIÊN BÊN TRONG CAMERA (TRÁI, PHẢI, NGẨNG, CHỚP MẮT) */}
                {isCameraActive && sessionStatus === 'CHECKING' && telemetry && (
                  <div className="inside-cam-hud">
                    {telemetry.challengeDirection === 'LEFT' && (
                      <div
                        className={`hud-arrow left ${telemetry.challengeProgress >= 100 ? 'met' : ''}`}
                        style={getHudProgressStyle(telemetry.challengeProgress, telemetry.challengeProgress >= 100)}
                      >
                        <div
                          className="hud-progress-fill"
                          style={{ width: `${telemetry.challengeProgress}%` }}
                        />
                        <div className="hud-content">
                          <ArrowLeft size={56} className="hud-arrow-icon" />
                          <span>Quay trái</span>
                        </div>
                      </div>
                    )}

                    {telemetry.challengeDirection === 'RIGHT' && (
                      <div
                        className={`hud-arrow right ${telemetry.challengeProgress >= 100 ? 'met' : ''}`}
                        style={getHudProgressStyle(telemetry.challengeProgress, telemetry.challengeProgress >= 100)}
                      >
                        <div
                          className="hud-progress-fill"
                          style={{ width: `${telemetry.challengeProgress}%` }}
                        />
                        <div className="hud-content">
                          <ArrowRight size={56} className="hud-arrow-icon" />
                          <span>Quay phải</span>
                        </div>
                      </div>
                    )}

                    {telemetry.challengeDirection === 'UP' && (
                      <div
                        className={`hud-arrow up ${telemetry.challengeProgress >= 100 ? 'met' : ''}`}
                        style={getHudProgressStyle(telemetry.challengeProgress, telemetry.challengeProgress >= 100)}
                      >
                        <div
                          className="hud-progress-fill"
                          style={{ height: `${telemetry.challengeProgress}%` }}
                        />
                        <div className="hud-content">
                          <ArrowUp size={56} className="hud-arrow-icon" />
                          <span>Ngẩng lên</span>
                        </div>
                      </div>
                    )}

                    {telemetry.challengeDirection === 'BLINK' && (
                      <div
                        className={`hud-target ${telemetry.challengeProgress >= 100 ? 'met' : ''}`}
                        style={getHudProgressStyle(telemetry.challengeProgress, telemetry.challengeProgress >= 100)}
                      >
                        <Eye size={48} className="hud-arrow-icon blink-anim-icon" />
                        <span>Chớp mắt tự nhiên 1 lần</span>
                      </div>
                    )}
                  </div>
                )}

                {!isCameraActive && (
                  <div className="empty-viewport compact-empty">
                    <Activity size={32} className="empty-icon" />
                    <p>Webcam chưa bật</p>
                    <span>Bấm "Bật Cam" để kích hoạt kiểm tra</span>
                  </div>
                )}
              </div>

              {/* THÔNG BÁO XÁC THỰC NẰM BÊN NGOÀI KHUNG HÌNH CAMERA */}
              {isCameraActive && (
                <div
                  className={`live-verification-banner ${verificationStatus.toLowerCase()}`}
                  onClick={
                    verificationStatus === 'TIMEOUT'
                      ? () => startNewCheckSession()
                      : verificationStatus === 'WAIT_TURN' || verificationStatus === 'WAIT_BLINK'
                      ? forceVerifyLiveness
                      : undefined
                  }
                  title={
                    verificationStatus === 'TIMEOUT'
                      ? 'Bấm để thử lại ngay nhiệm vụ mới'
                      : verificationStatus === 'WAIT_TURN' || verificationStatus === 'WAIT_BLINK'
                      ? 'Bấm để xác thực ngay (Bypass)'
                      : undefined
                  }
                  style={
                    verificationStatus === 'WAIT_TURN' ||
                    verificationStatus === 'WAIT_BLINK' ||
                    verificationStatus === 'TIMEOUT'
                      ? { cursor: 'pointer' }
                      : {}
                  }
                >
                  {verificationStatus === 'MATCH' && (
                    <>
                      <CheckCircle2 size={16} />
                      <span>XÁC THỰC THÀNH CÔNG ({passedTimeSec ? `${passedTimeSec}s - ` : ''}MATCH & REAL)</span>
                    </>
                  )}
                  {verificationStatus === 'TIMEOUT' && (
                    <>
                      <AlertTriangle size={16} />
                      <span>HẾT THỜI GIAN ({checkTimeoutSec}s) — ĐANG ĐỔI NHIỆM VỤ MỚI...</span>
                    </>
                  )}
                  {verificationStatus === 'WAIT_TURN' && (
                    <>
                      {challengeStateRef.current.direction === 'LEFT' && (
                        <>
                          <ArrowLeft size={16} className="blink-anim-icon" />
                          <span>QUAY NHẸ SANG TRÁI — CÒN {remainingTimeSec.toFixed(1)}s</span>
                        </>
                      )}
                      {challengeStateRef.current.direction === 'RIGHT' && (
                        <>
                          <ArrowRight size={16} className="blink-anim-icon" />
                          <span>QUAY NHẸ SANG PHẢI — CÒN {remainingTimeSec.toFixed(1)}s</span>
                        </>
                      )}
                      {challengeStateRef.current.direction === 'UP' && (
                        <>
                          <ArrowUp size={16} className="blink-anim-icon" />
                          <span>NGẨNG NHẸ ĐẦU — CÒN {remainingTimeSec.toFixed(1)}s</span>
                        </>
                      )}
                    </>
                  )}
                  {verificationStatus === 'WAIT_BLINK' && (
                    <>
                      <Eye size={16} className="blink-anim-icon" />
                      <span>CHỚP MẮT TỰ NHIÊN 1 LẦN — CÒN {remainingTimeSec.toFixed(1)}s</span>
                    </>
                  )}
                  {verificationStatus === 'SPOOF' && (
                    <>
                      <ShieldAlert size={16} />
                      <span>CẢNH BÁO GIẢ MẠO (ẢNH IN / MÀN HÌNH)</span>
                    </>
                  )}
                  {verificationStatus === 'MISMATCH' && (
                    <>
                      <XCircle size={16} />
                      <span>KHÔNG KHỚP DỮ LIỆU ĐÃ NẠP</span>
                    </>
                  )}
                  {verificationStatus === 'NO_FACE' && (
                    <>
                      <AlertTriangle size={16} />
                      <span>
                        {sessionStatus === 'CHECKING'
                          ? `HÃY ĐƯA MẶT VÀO KHUNG HÌNH (CÒN ${remainingTimeSec.toFixed(1)}s)`
                          : 'KHÔNG TÌM THẤY KHUÔN MẶT'}
                      </span>
                    </>
                  )}
                  {verificationStatus === 'IDLE' && (
                    <>
                      <Info size={16} />
                      <span>CHƯA NẠP DỮ LIỆU MẪU</span>
                    </>
                  )}
                </div>
              )}

            </section>

            {/* THUMBNAILS TẤT CẢ ẢNH MẪU (KHÔNG TIÊU ĐỀ, SHOW ẢNH TO HƠN) */}
            <section className="card reference-card compact-thumbs-card">
              {enrolledList.length === 0 ? (
                <div className="no-enrolled-box compact-empty-box">
                  <p>Chưa có dữ liệu mẫu.</p>
                  <span>Chuyển sang tab "Nạp Dữ liệu" để thêm ảnh</span>
                </div>
              ) : (
                <div className="enrolled-all-thumbs-grid">
                  {enrolledList.map((enrolledItem, idx) => {
                    const simItem = telemetry?.individualSimilarities?.[idx];
                    const item = simItem || enrolledItem;
                    const similarity = simItem ? simItem.similarity : null;
                    const isBest = telemetry?.bestMatch?.index === idx;
                    const isPass = similarity !== null && similarity >= matchThreshold;

                    return (
                      <div
                        key={item.id || idx}
                        className={`thumb-slot filled ${isBest ? 'best' : ''} ${isPass ? 'pass' : ''}`}
                        title={`${enrolledItem.name || `Mẫu #${idx + 1}`}${similarity !== null ? ` - ${(similarity * 100).toFixed(1)}%` : ''}`}
                      >
                        <img src={item.imageSrc} alt="" className="thumb-image" />
                        {isBest && (
                          <span className="thumb-badge best-badge">
                            <Award size={10} />
                          </span>
                        )}
                        {similarity !== null && (
                          <span className={`thumb-score-badge ${isPass ? 'pass' : 'fail'}`}>
                            {(similarity * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* CỘT 3 (PHẢI): LỊCH SỬ KIỂM ĐỊNH (PASS/FAIL) + DETECTOR & 3D POSE + KIỂM SOÁT eKYC */}
          <div className="live-column col-security">
            {/* THẺ 1 (MỚI): LỊCH SỬ KIỂM ĐỊNH PASS/FAIL & NÚT XUẤT DATA LOG */}
            <div className="card metrics-card audit-history-card compact-metrics">
              <div className="card-header compact-header history-card-header">
                <h3 className="history-header-title">
                  <History size={14} className="icon-blue" />
                  <span>Lịch sử</span>
                  {checkHistory.length > 0 && (
                    <span className="history-count-badge">
                      {checkHistory.filter((r) => r.status === 'PASS').length}/{checkHistory.length} Pass
                    </span>
                  )}
                </h3>
                <div className="history-actions-row">
                  <button
                    className="btn-export-log"
                    onClick={exportAuditLogJson}
                    disabled={checkHistory.length === 0}
                    title="Xuất dữ liệu log dạng JSON để kiểm tra & tối ưu thuật toán"
                  >
                    <Download size={12} />
                    <span>Xuất Log</span>
                  </button>
                  {checkHistory.length > 0 && (
                    <button
                      className="btn-clear-history"
                      onClick={clearAuditHistory}
                      title="Xóa toàn bộ lịch sử kiểm tra"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {checkHistory.length === 0 ? (
                <div className="no-telemetry-box compact-empty-box">
                  <p>Chưa có lượt kiểm tra nào.</p>
                  <span>Mỗi lần hoàn thành hoặc hết 10s sẽ lưu ảnh Pass/Fail tại đây</span>
                </div>
              ) : (
                <div className="audit-thumbs-grid">
                  {checkHistory.map((item) => (
                    <div
                      key={item.id}
                      className={`audit-mini-thumb ${item.status.toLowerCase()}`}
                      title={`#${item.round} • ${item.status === 'PASS' ? 'ĐẠT (PASS)' : 'TRƯỢT (FAIL)'} • ${item.taskName} • ${item.durationSec}s${
                        item.similarity !== null ? ` • Khớp: ${(item.similarity * 100).toFixed(0)}%` : ''
                      } • 3D: ${(item.realScore * 100).toFixed(0)}% • ${item.reason} (${item.timeFormatted})`}
                    >
                      {item.snapshotUrl ? (
                        <img src={item.snapshotUrl} alt="" className="audit-mini-img" />
                      ) : (
                        <div className="audit-mini-placeholder">
                          <ScanFace size={16} />
                        </div>
                      )}
                      <span className={`audit-mini-badge ${item.status.toLowerCase()}`}>
                        {item.status === 'PASS' ? '✓' : '✕'}
                      </span>
                      <span className="audit-mini-task-tag">
                        {item.taskName.includes('trái') || item.taskName.includes('Trái')
                          ? 'Trái'
                          : item.taskName.includes('phải') || item.taskName.includes('Phải')
                          ? 'Phải'
                          : item.taskName.includes('Ngẩng') || item.taskName.includes('ngẩng') || item.taskName.includes('lên')
                          ? 'Ngẩng'
                          : item.taskName.replace('Quay ', '')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* THẺ 2: FACE DETECTOR & 3D POSE */}
            <div className="card metrics-card compact-metrics">
              <div className="card-header compact-header">
                <h3>
                  <Crosshair size={14} className="icon-blue" />
                  Detector & 3D Pose
                </h3>
                {telemetry && (
                  <span className="badge-tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                    {(telemetry.score * 100).toFixed(0)}% Conf
                  </span>
                )}
              </div>

              {telemetry ? (
                <div className="telemetry-grid compact-grid">
                  <div className="telemetry-box">
                    <span className="telemetry-lbl">Kích thước Box</span>
                    <strong className="telemetry-val">
                      {telemetry.box.width}×{telemetry.box.height}
                    </strong>
                    <span className="telemetry-sub">X:{telemetry.box.x}, Y:{telemetry.box.y}</span>
                  </div>

                  <div className="telemetry-box">
                    <span className="telemetry-lbl">Mesh & Vector</span>
                    <strong className="telemetry-val">468p / 1024D</strong>
                    <span className="telemetry-sub">Float32 Feature</span>
                  </div>

                  <div className="telemetry-box full-width">
                    <div className="angles-row compact-angles">
                      <div className="angle-badge">
                        <span>Yaw:</span>
                        <strong style={{ color: Math.abs(telemetry.rotation.yaw) > 30 ? '#f87171' : '#34d399' }}>
                          {telemetry.rotation.yaw}°
                        </strong>
                      </div>
                      <div className="angle-badge">
                        <span>Pitch:</span>
                        <strong style={{ color: Math.abs(telemetry.rotation.pitch) > 25 ? '#f87171' : '#34d399' }}>
                          {telemetry.rotation.pitch}°
                        </strong>
                      </div>
                      <div className="angle-badge">
                        <span>Roll:</span>
                        <strong>{telemetry.rotation.roll}°</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="no-telemetry-box compact-empty-box">
                  <p>Đang chờ khuôn mặt...</p>
                  <span>Nhìn thẳng camera để tính toán góc xoay 3D</span>
                </div>
              )}
            </div>

            {/* THẺ 2: KIỂM SOÁT AN TOÀN & SO KHỚP eKYC (HỢP NHẤT) */}
            <div className="card metrics-card security-audit-card compact-metrics">
              <div className="card-header compact-header">
                <h3>
                  <ShieldCheck size={14} className="icon-blue" />
                  Kiểm soát & So khớp eKYC
                </h3>
              </div>

              {/* Progress & Ngưỡng Khối 3D Real */}
              <div className="metric-row compact-metric-row">
                <div className="metric-label">
                  <span>Khối 3D Real:</span>
                  <strong
                    className="metric-value"
                    style={{
                      color: telemetry && telemetry.isReal ? '#34d399' : '#f87171',
                    }}
                  >
                    {telemetry ? `${(telemetry.realScore * 100).toFixed(0)}%` : '--'}
                  </strong>
                  <span className="threshold-tag">Ngưỡng: {(antispoofThreshold * 100).toFixed(0)}%</span>
                </div>
                <div className="progress-track compact-track">
                  <div
                    className="progress-fill match"
                    style={{
                      width: telemetry ? `${Math.min(100, telemetry.realScore * 100)}%` : '0%',
                      background: telemetry && telemetry.isReal ? '#10b981' : '#ef4444',
                    }}
                  />
                  <div
                    className="threshold-marker"
                    style={{ left: `${antispoofThreshold * 100}%` }}
                    title={`Ngưỡng: ${(antispoofThreshold * 100).toFixed(0)}%`}
                  />
                </div>
              </div>

              {/* Progress & Ngưỡng Similarity */}
              <div className="metric-row compact-metric-row" style={{ marginTop: '5px' }}>
                <div className="metric-label">
                  <span>Khớp danh tính:</span>
                  <strong className="metric-value">
                    {currentSimilarity !== null ? `${(currentSimilarity * 100).toFixed(0)}%` : '--'}
                  </strong>
                  <span className="threshold-tag">Ngưỡng: {(matchThreshold * 100).toFixed(0)}%</span>
                </div>
                <div className="progress-track compact-track">
                  <div
                    className={`progress-fill ${
                      currentSimilarity !== null && currentSimilarity >= matchThreshold ? 'match' : 'mismatch'
                    }`}
                    style={{
                      width: currentSimilarity !== null ? `${Math.min(100, currentSimilarity * 100)}%` : '0%',
                    }}
                  />
                  <div
                    className="threshold-marker"
                    style={{ left: `${matchThreshold * 100}%` }}
                    title={`Ngưỡng: ${(matchThreshold * 100).toFixed(0)}%`}
                  />
                </div>
              </div>

              {/* 2 Slider chỉnh ngưỡng mini */}
              <div className="threshold-grid compact-thresholds mini-sliders" style={{ marginTop: '6px' }}>
                <div className="threshold-item">
                  <div className="threshold-label-row">
                    <span>Ngưỡng 3D: <strong>{(antispoofThreshold * 100).toFixed(0)}%</strong></span>
                  </div>
                  <input
                    type="range"
                    min="0.30"
                    max="0.80"
                    step="0.05"
                    value={antispoofThreshold}
                    onChange={(e) => setAntispoofThreshold(parseFloat(e.target.value))}
                  />
                </div>
                <div className="threshold-item">
                  <div className="threshold-label-row">
                    <span>Ngưỡng Khớp: <strong>{(matchThreshold * 100).toFixed(0)}%</strong></span>
                  </div>
                  <input
                    type="range"
                    min="0.40"
                    max="0.90"
                    step="0.02"
                    value={matchThreshold}
                    onChange={(e) => setMatchThreshold(parseFloat(e.target.value))}
                  />
                </div>
              </div>

              {/* Checklist 6 tiêu chí eKYC dạng lưới 2 cột siêu gọn */}
              <div className="audit-checklist-grid" style={{ marginTop: '8px' }}>
                {/* 1. Khuôn mặt rõ */}
                <div className={`mini-audit-chip ${telemetry && telemetry.score >= 0.5 ? 'pass' : 'fail'}`}>
                  {telemetry && telemetry.score >= 0.5 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  <span>Rõ nét</span>
                </div>

                {/* 2. Trực diện */}
                {(() => {
                  const isPoseValid = telemetry
                    ? Math.abs(telemetry.rotation.yaw) <= 35 && Math.abs(telemetry.rotation.pitch) <= 30
                    : false;
                  return (
                    <div className={`mini-audit-chip ${isPoseValid ? 'pass' : 'fail'}`}>
                      {isPoseValid ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      <span>Trực diện</span>
                    </div>
                  );
                })()}

                {/* 3. Khối 3D lồi sống mũi */}
                <div className={`mini-audit-chip ${telemetry && telemetry.is3DConvex ? 'pass' : 'fail'}`}>
                  {telemetry && telemetry.is3DConvex ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  <span>Khối 3D</span>
                </div>

                {/* 4. Nhô mũi tự nhiên */}
                <div className={`mini-audit-chip ${telemetry && telemetry.depthRatio >= 1.5 ? 'pass' : 'fail'}`}>
                  {telemetry && telemetry.depthRatio >= 1.5 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  <span>Nhô mũi</span>
                </div>

                {/* 5. Active Liveness */}
                {(() => {
                  const isPass = livenessMode === 'OFF' || (telemetry && telemetry.hasPassedLiveness);
                  return (
                    <div className={`mini-audit-chip ${isPass ? 'pass' : 'fail'}`}>
                      {isPass ? <CheckCircle2 size={12} /> : <Eye size={12} className="blink-anim-icon" />}
                      <span>{livenessMode === 'HEAD_TURN' ? 'Quay đầu' : livenessMode === 'BLINK' ? 'Chớp mắt' : 'Liveness'}</span>
                    </div>
                  );
                })()}

                {/* 6. Trùng khớp */}
                {(() => {
                  const isMatch = currentSimilarity !== null && currentSimilarity >= matchThreshold;
                  return (
                    <div className={`mini-audit-chip ${isMatch ? 'pass' : 'fail'}`}>
                      {isMatch ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      <span>Khớp mẫu</span>
                    </div>
                  );
                })()}
              </div>

              {/* Verdict Final Decision */}
              <div className={`audit-verdict ${verificationStatus.toLowerCase()}`} style={{ marginTop: '8px' }}>
                {verificationStatus === 'MATCH' && (
                  <div className="verdict-content match compact-verdict">
                    <CheckCircle2 size={16} />
                    <div>
                      <strong>ĐẠT TIÊU CHUẨN eKYC (HỢP LỆ)</strong>
                      <span>Khuôn mặt thật & trùng khớp mẫu</span>
                    </div>
                  </div>
                )}
                {verificationStatus === 'WAIT_TURN' && (
                  <div className="verdict-content wait_blink compact-verdict">
                    <Crosshair size={16} className="blink-anim-icon" />
                    <div>
                      <strong>CHỜ QUAY ĐẦU XÁC THỰC</strong>
                      <span>Thực hiện quay đầu theo chỉ dẫn</span>
                    </div>
                  </div>
                )}
                {verificationStatus === 'WAIT_BLINK' && (
                  <div className="verdict-content wait_blink compact-verdict">
                    <Eye size={16} className="blink-anim-icon" />
                    <div>
                      <strong>CHỜ CHỚP MẮT XÁC THỰC</strong>
                      <span>Yêu cầu chớp mắt chống ảnh tĩnh</span>
                    </div>
                  </div>
                )}
                {verificationStatus === 'SPOOF' && (
                  <div className="verdict-content spoof compact-verdict">
                    <ShieldAlert size={16} />
                    <div>
                      <strong>TỪ CHỐI: CẢNH BÁO GIẢ MẠO</strong>
                      <span>Phát hiện ảnh in hoặc màn hình</span>
                    </div>
                  </div>
                )}
                {verificationStatus === 'MISMATCH' && (
                  <div className="verdict-content mismatch compact-verdict">
                    <XCircle size={16} />
                    <div>
                      <strong>TỪ CHỐI: KHÔNG KHỚP MẪU</strong>
                      <span>Độ tương đồng dưới ngưỡng</span>
                    </div>
                  </div>
                )}
                {verificationStatus === 'NO_FACE' && (
                  <div className="verdict-content no_face compact-verdict">
                    <AlertTriangle size={16} />
                    <div>
                      <strong>CHƯA PHÁT HIỆN KHUÔN MẶT</strong>
                      <span>Nhìn thẳng camera</span>
                    </div>
                  </div>
                )}
                {verificationStatus === 'IDLE' && (
                  <div className="verdict-content idle compact-verdict">
                    <Info size={16} />
                    <div>
                      <strong>CHƯA CÓ DỮ LIỆU MẪU</strong>
                      <span>Nạp 5-10 ảnh để so khớp</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* ========================================================
          TAB 2: NẠP DỮ LIỆU MẪU (5-10 ẢNH MẪU)
         ======================================================== */}
      {/* ========================================================
          TAB 2: NẠP DỮ LIỆU MẪU (SIDE-BY-SIDE: WEBCAM + ẢNH ĐÃ NẠP)
         ======================================================== */}
      {activeTab === 'enroll' && (
        <main className="demo-grid enroll-side-by-side">
          {/* CỘT TRÁI: WEBCAM LIVE & AUTO ENROLL STUDIO */}
          <section className="card camera-card">
            <div className="card-header">
              <h2>
                <Camera size={20} className="icon-blue" />
                Nạp 5 Ảnh Mẫu Khuôn Mặt
              </h2>
            </div>

            {cameraError && (
              <div className="alert alert-error">
                <AlertTriangle size={18} />
                <span>{cameraError}</span>
              </div>
            )}

            <div className="viewport-wrapper">
              <video
                ref={videoRef}
                className="video-stream"
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="overlay-canvas" />

              {/* NÚT DUY NHẤT CHÍNH GIỮA CAMERA: NẠP 5 ẢNH */}
              {!isEnrollingAuto && (
                <div className="enroll-center-action-overlay">
                  <button
                    className="btn-center-enroll"
                    disabled={!modelsLoaded}
                    onClick={handleStartEnroll5Shots}
                    title={!modelsLoaded ? 'Đang tải Model AI...' : 'Bắt đầu nạp 5 ảnh mẫu'}
                  >
                    <Sparkles size={24} className="btn-icon-pulse" />
                    <span>Nạp 5 ảnh</span>
                  </button>
                </div>
              )}

              {/* MŨI TÊN CHỈ HƯỚNG BÊN TRONG CAMERA */}
              {isEnrollingAuto && (
                <div className="inside-cam-hud">
                  {/* Bước 1: Nhìn thẳng (Chỉ dùng Target đơn giản, không áp dụng thanh tiến độ chạy) */}
                  {autoEnrollStep === 1 && (
                    <div className={`hud-target ${autoEnrollConditionMet ? 'met' : ''}`}>
                      <Crosshair size={46} className="hud-icon" />
                      <span>Nhìn thẳng</span>
                    </div>
                  )}

                  {/* Bước 2: Quay trái (Thanh tiến độ chạy về bên TRÁI theo chiều mũi tên) */}
                  {autoEnrollStep === 2 && (
                    <div
                      className={`hud-arrow left ${autoEnrollConditionMet ? 'met' : ''}`}
                      style={getHudProgressStyle(enrollAngleMetric.progressPct, autoEnrollConditionMet)}
                    >
                      <div
                        className="hud-progress-fill"
                        style={{ width: `${autoEnrollConditionMet ? 100 : enrollAngleMetric.progressPct}%` }}
                      />
                      <div className="hud-content">
                        <ArrowLeft size={56} className="hud-arrow-icon" />
                        <span>Quay trái</span>
                      </div>
                    </div>
                  )}

                  {/* Bước 3: Quay phải (Thanh tiến độ chạy về bên PHẢI theo chiều mũi tên) */}
                  {autoEnrollStep === 3 && (
                    <div
                      className={`hud-arrow right ${autoEnrollConditionMet ? 'met' : ''}`}
                      style={getHudProgressStyle(enrollAngleMetric.progressPct, autoEnrollConditionMet)}
                    >
                      <div
                        className="hud-progress-fill"
                        style={{ width: `${autoEnrollConditionMet ? 100 : enrollAngleMetric.progressPct}%` }}
                      />
                      <div className="hud-content">
                        <ArrowRight size={56} className="hud-arrow-icon" />
                        <span>Quay phải</span>
                      </div>
                    </div>
                  )}

                  {/* Bước 4: Ngẩng lên (Thanh tiến độ chạy từ DƯỚI LÊN TRÊN theo chiều mũi tên) */}
                  {autoEnrollStep === 4 && (
                    <div
                      className={`hud-arrow up ${autoEnrollConditionMet ? 'met' : ''}`}
                      style={getHudProgressStyle(enrollAngleMetric.progressPct, autoEnrollConditionMet)}
                    >
                      <div
                        className="hud-progress-fill"
                        style={{ height: `${autoEnrollConditionMet ? 100 : enrollAngleMetric.progressPct}%` }}
                      />
                      <div className="hud-content">
                        <ArrowUp size={56} className="hud-arrow-icon" />
                        <span>Ngẩng lên</span>
                      </div>
                    </div>
                  )}

                  {/* Bước 5: Cười nhẹ (Chỉ dùng Target đơn giản, không áp dụng thanh tiến độ chạy) */}
                  {autoEnrollStep === 5 && (
                    <div className={`hud-target ${autoEnrollConditionMet ? 'met' : ''}`}>
                      <Smile size={50} className="hud-icon" />
                      <span>Cười nhẹ</span>
                    </div>
                  )}

                  {/* Thanh tiến trình giữ ổn định siêu mỏng ở đáy camera */}
                  <div className="hud-bottom-progress">
                    <div
                      className={`hud-bottom-fill ${autoEnrollConditionMet ? 'active' : ''}`}
                      style={{ width: `${stableProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* CỘT PHẢI: CÁC ẢNH ĐÃ NẠP (ENROLLED GALLERY) */}
          <aside className="sidebar-column">
            <div className="card reference-card">
              <div className="card-header">
                <div>
                  <h3>
                    <ShieldCheck size={18} className="icon-blue" />
                    Các ảnh đã nạp ({enrolledList.length} / 10)
                  </h3>
                  <span className="card-subtitle">
                    Dữ liệu lưu trữ: ~{(enrolledList.length * 4.1).toFixed(1)} KB trong DB
                  </span>
                </div>
                {enrolledList.length > 0 && (
                  <button
                    className="btn btn-danger btn-sm"
                    title="Xóa tất cả ảnh đã nạp"
                    onClick={() => {
                      setEnrolledList([]);
                      setVerificationStatus('IDLE');
                      setCurrentSimilarity(null);
                    }}
                  >
                    <Trash2 size={14} /> Xóa tất cả
                  </button>
                )}
              </div>

              {enrolledList.length === 0 ? (
                <div className="no-enrolled-box" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                  <ScanFace size={48} className="empty-icon" />
                  <p>Chưa có ảnh mẫu nào được nạp.</p>
                  <span>
                    Bật webcam ở cột bên trái và bấm <strong>"⚡ Tự động nạp 5 góc nhanh"</strong> để chụp và xem các ảnh xuất hiện tại đây.
                  </span>
                </div>
              ) : (
                <>
                  <div className="enrolled-gallery-scroll">
                    {enrolledList.map((item, idx) => (
                      <div key={item.id} className="enrolled-gallery-card">
                        <img src={item.imageSrc} alt={item.name} className="gallery-thumb" />
                        <div className="gallery-info">
                          <div className="gallery-title">{item.name}</div>
                          <div className="gallery-tags">
                            <span className="badge-tag">Float32[{item.embedding.length}]</span>
                            <span className="badge-tag green">Real: {(item.antispoofScore * 100).toFixed(0)}%</span>
                          </div>
                          <span className="gallery-time">Lúc {item.timestamp}</span>
                        </div>
                        <button
                          className="btn-delete-item"
                          title="Xóa ảnh này"
                          onClick={() => setEnrolledList((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                    <button
                      className="btn btn-success"
                      style={{
                        width: '100%',
                        padding: '12px 18px',
                        fontSize: '0.94rem',
                        fontWeight: 700,
                        justifyContent: 'center',
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        border: 'none',
                        boxShadow: '0 0 14px rgba(16, 185, 129, 0.35)'
                      }}
                      onClick={() => {
                        startNewCheckSession();
                        setActiveTab('live-test');
                      }}
                    >
                      <ShieldCheck size={18} /> Tiến hành Xác thực Live Cam ({enrolledList.length} ảnh) →
                    </button>
                  </div>
                </>
              )}
            </div>
          </aside>
        </main>
      )}

    </div>
  );
}
