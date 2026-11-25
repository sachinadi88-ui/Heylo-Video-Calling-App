import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Flashlight,
  Link2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  PhoneOff,
  RefreshCw,
  RotateCcw,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  CameraFacingMode,
  ConnectionStage,
  RemoteCommand,
  StreamMeta,
  StreamStats,
} from '../types/stream.ts';
import {QrCodeDisplay} from './QrCodeDisplay.tsx';

interface DesktopViewerProps {
  roomCode: string;
  stage: ConnectionStage;
  errorMessage: string | null;
  signalingConnected: boolean;
  remoteStream: MediaStream | null;
  remoteTrackVersion: number;
  remoteMeta: StreamMeta | null;
  stats: StreamStats | null;
  localStream: MediaStream | null;
  cameraReady: boolean;
  cameraError: string | null;
  facingMode: CameraFacingMode;
  audioEnabled: boolean;
  cameraEnabled: boolean;
  onStartCamera: () => Promise<MediaStream | null>;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onCreateNewRoom: () => void;
  onSendRemoteCommand: (cmd: RemoteCommand) => void;
}

function getStageLabel(stage: ConnectionStage, signalingConnected: boolean): {
  label: string;
  tone: 'neutral' | 'amber' | 'green' | 'red';
} {
  if (!signalingConnected && stage !== 'live') {
    return {label: 'Connecting to server', tone: 'amber'};
  }
  switch (stage) {
    case 'live':
      return {label: 'Two-way call live', tone: 'green'};
    case 'negotiating':
      return {label: 'Connecting call', tone: 'amber'};
    case 'reconnecting':
      return {label: 'Reconnecting', tone: 'amber'};
    case 'error':
      return {label: 'Connection error', tone: 'red'};
    case 'waiting-for-peer':
      return {label: 'Waiting for participant', tone: 'neutral'};
    default:
      return {label: 'Initializing', tone: 'neutral'};
  }
}

export function DesktopViewer({
  roomCode,
  stage,
  errorMessage,
  signalingConnected,
  remoteStream,
  remoteTrackVersion,
  remoteMeta,
  stats,
  localStream,
  cameraReady,
  cameraError,
  facingMode,
  audioEnabled,
  cameraEnabled,
  onStartCamera,
  onToggleMic,
  onToggleCamera,
  onCreateNewRoom,
  onSendRemoteCommand,
}: DesktopViewerProps) {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const waitingPreviewRef = useRef<HTMLVideoElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const hadNativeFsRef = useRef(false);

  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSelfView, setShowSelfView] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const mobilePairUrl = roomCode
    ? `${window.location.origin}/?room=${roomCode}&role=camera`
    : '';

  // Start local camera & mic on mount so two-way video & audio are ready immediately
  useEffect(() => {
    if (!localStream && !cameraError) {
      void onStartCamera();
    }
  }, [localStream, cameraError, onStartCamera]);

  // Attach remote stream to main video element and attempt unmuted playback
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;

    if (remoteStream) {
      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
      }
      video.muted = isSpeakerMuted;
      video
        .play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            video.muted = true;
            setIsSpeakerMuted(true);
            setAutoplayBlocked(true);
            video.play().catch(() => {});
          }
        });
    } else {
      video.srcObject = null;
      setAutoplayBlocked(false);
    }
  }, [remoteStream, remoteTrackVersion, isSpeakerMuted]);

  // Attach local self-view stream
  useEffect(() => {
    const pipVideo = localVideoRef.current;
    const waitingVideo = waitingPreviewRef.current;
    if (pipVideo) {
      if (localStream) {
        pipVideo.srcObject = localStream;
        pipVideo.play().catch(() => {});
      } else {
        pipVideo.srcObject = null;
      }
    }
    if (waitingVideo) {
      if (localStream) {
        waitingVideo.srcObject = localStream;
        waitingVideo.play().catch(() => {});
      } else {
        waitingVideo.srcObject = null;
      }
    }
  }, [localStream, remoteStream, showSelfView, cameraEnabled]);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
    } catch {
      // Ignore native fullscreen exit errors
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    const el = stageContainerRef.current as
      | (HTMLDivElement & {webkitRequestFullscreen?: () => Promise<void> | void})
      | null;
    if (!el) return;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // Fallback CSS viewport fullscreen remains active via isFullscreen state
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  // Sync native fullscreen exit (Esc / Android back) and support Esc in CSS fullscreen mode
  useEffect(() => {
    const onFsChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement;
      if (fsEl) {
        hadNativeFsRef.current = true;
        setIsFullscreen(true);
      } else if (hadNativeFsRef.current) {
        hadNativeFsRef.current = false;
        setIsFullscreen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        void exitFullscreen();
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exitFullscreen, isFullscreen]);

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  const handleUnblockAudio = () => {
    setIsSpeakerMuted(false);
    setAutoplayBlocked(false);
    const video = remoteVideoRef.current;
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyLink = async () => {
    if (!mobilePairUrl) return;
    try {
      await navigator.clipboard.writeText(mobilePairUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const status = getStageLabel(stage, signalingConnected);
  const isLive = stage === 'live' && Boolean(remoteStream);
  const isInCall =
    isLive || stage === 'negotiating' || stage === 'reconnecting';
  const hasLocalVideo =
    Boolean(localStream?.getVideoTracks().length) && cameraEnabled;
  const hasRemoteVideo =
    Boolean(remoteStream?.getVideoTracks().length) &&
    remoteMeta?.cameraEnabled !== false;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Dominant Two-Way Video Call Stage */}
        <section
          aria-label="Two-Way Video Call Stage"
          className="bg-[#131822] border border-white/[0.08] rounded-xl overflow-hidden"
        >
          {/* Video Viewport (Hybrid native + mobile viewport fullscreen) */}
          <div
            ref={stageContainerRef}
            className={
              isFullscreen
                ? 'fixed inset-0 z-50 h-[100dvh] w-screen bg-[#07090D] flex items-center justify-center overflow-hidden pt-safe pb-safe'
                : 'relative aspect-video w-full bg-[#07090D] flex items-center justify-center overflow-hidden'
            }
          >
            {remoteStream ? (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={isSpeakerMuted}
                  className={`h-full w-full ${
                    fitMode === 'cover' ? 'object-cover' : 'object-contain'
                  } ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
                />

                {!hasRemoteVideo && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                    <div className="h-14 w-14 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center mb-3">
                      <VideoOff className="w-6 h-6 text-slate-300" />
                    </div>
                    <p className="text-sm font-medium text-white">
                      Participant camera is off
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {remoteMeta?.audioEnabled === false
                        ? 'Participant microphone is muted'
                        : 'Two-way voice audio is active'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="relative h-full w-full flex items-center justify-center">
                {hasLocalVideo && (
                  <video
                    ref={waitingPreviewRef}
                    autoPlay
                    playsInline
                    muted
                    className={`absolute inset-0 h-full w-full object-cover opacity-35 ${
                      facingMode === 'user' ? '-scale-x-100' : ''
                    }`}
                  />
                )}
                <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 py-10 max-w-md">
                  <div className="h-12 w-12 rounded-xl bg-black/50 border border-white/[0.12] backdrop-blur-sm flex items-center justify-center mb-5">
                    <Monitor className="w-6 h-6 text-slate-200" />
                  </div>
                  <h1 className="text-xl font-semibold text-white tracking-tight text-balance">
                    Ready for two-way video call
                  </h1>
                  <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                    Scan the QR code on the right or share this room code. Both callers will see and hear each other simultaneously.
                  </p>

                  {roomCode && (
                    <div className="mt-5 flex items-center gap-3">
                      <span className="font-mono text-3xl sm:text-4xl font-semibold tracking-[0.22em] text-white select-all">
                        {roomCode}
                      </span>
                    </div>
                  )}

                  {!cameraReady && (
                    <div className="mt-5 flex flex-col items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onStartCamera()}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
                      >
                        Enable Camera & Mic
                      </button>
                      {cameraError && (
                        <p className="text-xs text-amber-300 max-w-xs leading-relaxed">
                          {cameraError}
                        </p>
                      )}
                    </div>
                  )}

                  {errorMessage && (
                    <p className="mt-4 text-xs text-red-400">{errorMessage}</p>
                  )}
                </div>
              </div>
            )}

            {/* Top-left live status readout */}
            {isLive && (
              <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2 rounded-md bg-black/65 backdrop-blur-sm px-2.5 py-1 text-xs font-medium text-white">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Live</span>
                {remoteMeta && (
                  <>
                    <span className="text-white/40" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-200">
                      {remoteMeta.audioEnabled === false
                        ? 'Caller muted'
                        : 'Caller audio on'}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Always-accessible Exit Fullscreen button inside fullscreen stage */}
            {isFullscreen && (
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label="Exit full screen"
                className="absolute top-3 right-3 z-30 min-h-[44px] px-3.5 rounded-xl bg-black/70 hover:bg-black/85 border border-white/25 text-xs font-medium text-white backdrop-blur-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Minimize2 className="w-4 h-4" />
                <span>Exit Fullscreen</span>
              </button>
            )}

            {/* Autoplay-blocked audio unlock button */}
            {remoteStream && autoplayBlocked && (
              <div
                className={`absolute left-1/2 -translate-x-1/2 z-30 ${
                  isFullscreen ? 'bottom-20' : 'bottom-4'
                }`}
              >
                <button
                  type="button"
                  onClick={handleUnblockAudio}
                  className="min-h-[44px] px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white shadow-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Volume2 className="w-4 h-4" />
                  Click to Enable Call Audio
                </button>
              </div>
            )}

            {/* Local Self-View Picture-in-Picture during call */}
            {remoteStream && showSelfView && (
              <div
                className={`absolute right-3 z-20 w-32 sm:w-52 aspect-video rounded-lg overflow-hidden border border-white/15 bg-[#0B0E14] shadow-2xl ${
                  isFullscreen ? 'bottom-20' : 'bottom-3'
                }`}
              >
                {hasLocalVideo ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${
                      facingMode === 'user' ? '-scale-x-100' : ''
                    }`}
                  />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-slate-400">
                    <VideoOff className="w-4 h-4" />
                    <span className="text-[11px]">
                      {cameraReady ? 'Camera off' : 'No camera'}
                    </span>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-[11px] font-medium text-white">
                  <span>You</span>
                  {!audioEnabled && (
                    <MicOff className="w-3 h-3 text-red-400" />
                  )}
                </div>
              </div>
            )}

            {/* Floating In-Stage Call Controls when in Fullscreen mode */}
            {isFullscreen && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 rounded-2xl bg-black/75 border border-white/15 backdrop-blur-md max-w-[95vw] overflow-x-auto">
                <button
                  type="button"
                  onClick={onToggleMic}
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    audioEnabled
                      ? 'border-white/15 text-white hover:bg-white/10'
                      : 'border-red-400/40 bg-red-500/25 text-red-100'
                  }`}
                >
                  {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  <span>{audioEnabled ? 'Mic' : 'Muted'}</span>
                </button>

                <button
                  type="button"
                  onClick={onToggleCamera}
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    cameraEnabled && cameraReady
                      ? 'border-white/15 text-white hover:bg-white/10'
                      : 'border-red-400/40 bg-red-500/25 text-red-100'
                  }`}
                >
                  {cameraEnabled && cameraReady ? (
                    <Video className="w-4 h-4" />
                  ) : (
                    <VideoOff className="w-4 h-4" />
                  )}
                  <span>{cameraEnabled && cameraReady ? 'Cam' : 'Off'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsSpeakerMuted((prev) => !prev);
                    setAutoplayBlocked(false);
                  }}
                  disabled={!remoteStream}
                  className="min-h-[40px] px-3 rounded-xl border border-white/15 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-40 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {isSpeakerMuted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                  <span>{isSpeakerMuted ? 'Muted' : 'Sound'}</span>
                </button>

                {isInCall && (
                  <button
                    type="button"
                    onClick={() => {
                      void exitFullscreen();
                      onCreateNewRoom();
                    }}
                    className="min-h-[40px] px-3 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>End</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="min-h-[40px] px-3 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Minimize2 className="w-4 h-4" />
                  <span>Normal</span>
                </button>
              </div>
            )}
          </div>

          {/* Call Control & Telemetry Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-t border-white/[0.08]">
            {/* Left: Real Connection State & Telemetry */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                className={`inline-flex items-center gap-2 font-medium ${
                  status.tone === 'green'
                    ? 'text-emerald-400'
                    : status.tone === 'amber'
                      ? 'text-amber-400'
                      : status.tone === 'red'
                        ? 'text-red-400'
                        : 'text-slate-300'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status.tone === 'green'
                      ? 'bg-emerald-400'
                      : status.tone === 'amber'
                        ? 'bg-amber-400'
                        : status.tone === 'red'
                          ? 'bg-red-400'
                          : 'bg-slate-500'
                  }`}
                />
                {status.label}
              </span>

              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>

              {stats && stats.width > 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 text-slate-400 font-mono">
                  <span>
                    {stats.width}×{stats.height}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span>{stats.fps} fps</span>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span>{stats.bitrateKbps} kbps</span>
                  {stats.rttMs !== null && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>{stats.rttMs} ms</span>
                    </>
                  )}
                </div>
              ) : (
                <span className="text-slate-500">
                  {isLive ? 'Measuring call quality...' : 'Waiting for call connection'}
                </span>
              )}
            </div>

            {/* Right: Two-Way Call & Device Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onToggleMic}
                className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  audioEnabled
                    ? 'border-white/10 text-slate-200 hover:bg-white/5'
                    : 'border-red-400/40 bg-red-500/15 text-red-200'
                }`}
              >
                {audioEnabled ? (
                  <Mic className="w-3.5 h-3.5" />
                ) : (
                  <MicOff className="w-3.5 h-3.5" />
                )}
                {audioEnabled ? 'Mic On' : 'Muted'}
              </button>

              <button
                type="button"
                onClick={onToggleCamera}
                className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  cameraEnabled && cameraReady
                    ? 'border-white/10 text-slate-200 hover:bg-white/5'
                    : 'border-red-400/40 bg-red-500/15 text-red-200'
                }`}
              >
                {cameraEnabled && cameraReady ? (
                  <Video className="w-3.5 h-3.5" />
                ) : (
                  <VideoOff className="w-3.5 h-3.5" />
                )}
                {cameraEnabled && cameraReady ? 'Cam On' : 'Cam Off'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSpeakerMuted((prev) => !prev);
                  setAutoplayBlocked(false);
                }}
                disabled={!remoteStream}
                className={`h-9 px-3 rounded-lg border text-xs font-medium disabled:opacity-40 disabled:pointer-events-none transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  isSpeakerMuted
                    ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                    : 'border-white/10 text-slate-200 hover:bg-white/5'
                }`}
              >
                {isSpeakerMuted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                {isSpeakerMuted ? 'Speaker Off' : 'Sound On'}
              </button>

              {isLive && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowSelfView((prev) => !prev)}
                    aria-label={showSelfView ? 'Hide self view' : 'Show self view'}
                    className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {showSelfView ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                    Self View
                  </button>

                  <button
                    type="button"
                    onClick={() => onSendRemoteCommand({action: 'flip-camera'})}
                    className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Flip Remote
                  </button>

                  {remoteMeta?.torchSupported && (
                    <button
                      type="button"
                      onClick={() => onSendRemoteCommand({action: 'toggle-torch'})}
                      className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                        remoteMeta.torchEnabled
                          ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                          : 'border-white/10 text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <Flashlight className="w-3.5 h-3.5" />
                      Torch
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() =>
                  setFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))
                }
                disabled={!remoteStream}
                className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
              >
                {fitMode === 'contain' ? 'Fit' : 'Fill'}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="h-9 w-9 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center justify-center shrink-0"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>

              {isInCall && (
                <button
                  type="button"
                  onClick={onCreateNewRoom}
                  className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium text-white transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  End Call
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Pairing & Call Participants Sidebar */}
        <aside
          aria-label="Call Room Pairing"
          className="bg-[#131822] border border-white/[0.08] rounded-xl p-5 flex flex-col gap-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Invite Caller</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Instant two-way video & voice room
              </p>
            </div>
            <Users className="w-5 h-5 text-blue-400 shrink-0" />
          </div>

          <div className="flex justify-center py-2">
            <QrCodeDisplay value={mobilePairUrl} size={184} />
          </div>

          <div className="border-t border-white/[0.08] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Room Code</span>
              <span className="text-xs text-slate-500">1-to-1 encrypted call</span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0B0E14] border border-white/[0.08] px-3.5 py-2.5">
              <span className="font-mono text-xl font-semibold tracking-[0.2em] text-white select-all">
                {roomCode || '------'}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                disabled={!roomCode}
                className="h-8 px-2.5 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={!mobilePairUrl}
                className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Link Copied
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Copy Link
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onCreateNewRoom}
                className="h-10 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                New Room
              </button>
            </div>
          </div>

          <div className="border-t border-white/[0.08] pt-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Your Audio & Video</span>
              <span className="text-slate-200">
                {cameraReady
                  ? `${audioEnabled ? 'Mic on' : 'Mic muted'} · ${
                      cameraEnabled && localStream?.getVideoTracks().length
                        ? 'Cam on'
                        : 'Cam off'
                    }`
                  : 'Permission needed'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Remote Caller</span>
              <span className={isLive ? 'text-emerald-400' : 'text-slate-500'}>
                {isLive
                  ? `${remoteMeta?.audioEnabled === false ? 'Muted' : 'Speaking'} · ${
                      hasRemoteVideo ? 'Cam on' : 'Cam off'
                    }`
                  : 'Not joined yet'}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
