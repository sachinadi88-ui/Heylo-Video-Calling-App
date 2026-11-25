import {
  Camera,
  EyeOff,
  Flashlight,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneCall,
  PhoneOff,
  QrCode,
  RotateCcw,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  CameraFacingMode,
  ConnectionStage,
  StreamMeta,
  StreamStats,
  VideoQualityPreset,
} from '../types/stream.ts';
import {QrScannerModal} from './QrScannerModal.tsx';

interface MobileBroadcasterProps {
  roomCode: string;
  onChangeRoomCode: (code: string) => void;
  stage: ConnectionStage;
  errorMessage: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteTrackVersion: number;
  remoteMeta: StreamMeta | null;
  stats: StreamStats | null;
  cameraReady: boolean;
  cameraError: string | null;
  facingMode: CameraFacingMode;
  quality: VideoQualityPreset;
  audioEnabled: boolean;
  cameraEnabled: boolean;
  torchSupported: boolean;
  torchEnabled: boolean;
  wakeLockActive: boolean;
  onStartCamera: () => Promise<MediaStream | null>;
  onFlipCamera: () => Promise<void>;
  onChangeQuality: (q: VideoQualityPreset) => Promise<void>;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleTorch: () => Promise<void>;
  onJoinAndStream: (code: string) => Promise<boolean>;
  onStopBroadcast: () => void;
}

const QUALITY_OPTIONS: VideoQualityPreset[] = ['480p', '720p', '1080p'];

export function MobileBroadcaster({
  roomCode,
  onChangeRoomCode,
  stage,
  errorMessage,
  localStream,
  remoteStream,
  remoteTrackVersion,
  remoteMeta,
  stats,
  cameraReady,
  cameraError,
  facingMode,
  quality,
  audioEnabled,
  cameraEnabled,
  torchSupported,
  torchEnabled,
  wakeLockActive,
  onStartCamera,
  onFlipCamera,
  onChangeQuality,
  onToggleMic,
  onToggleCamera,
  onToggleTorch,
  onJoinAndStream,
  onStopBroadcast,
}: MobileBroadcasterProps) {
  const stageContainerRef = useRef<HTMLElement | null>(null);
  const mainRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const mainLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const hadNativeFsRef = useRef(false);
  const autoFullscreenTriggeredRef = useRef(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [pocketDim, setPocketDim] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [swapViews, setSwapViews] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isStreamingOrWaiting =
    stage === 'waiting-for-peer' ||
    stage === 'negotiating' ||
    stage === 'live' ||
    stage === 'reconnecting';

  const hasCallVideo = Boolean(remoteStream);
  const hasLocalVideo =
    Boolean(localStream?.getVideoTracks().length) && cameraEnabled;
  const hasRemoteVideo =
    Boolean(remoteStream?.getVideoTracks().length) &&
    remoteMeta?.cameraEnabled !== false;

  // Determine which stream goes in main stage vs PiP
  const remoteInMain = hasCallVideo && !swapViews;

  // Attach remote stream to whichever <video> element is rendering it (main or PiP)
  useEffect(() => {
    const targetVideo = remoteInMain
      ? mainRemoteVideoRef.current
      : pipVideoRef.current;

    if (!targetVideo) return;

    if (remoteStream) {
      if (targetVideo.srcObject !== remoteStream) {
        targetVideo.srcObject = remoteStream;
      }
      targetVideo.muted = isSpeakerMuted;
      targetVideo
        .play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            targetVideo.muted = true;
            setIsSpeakerMuted(true);
            setAutoplayBlocked(true);
            targetVideo.play().catch(() => {});
          }
        });
    } else {
      targetVideo.srcObject = null;
      setAutoplayBlocked(false);
    }
  }, [remoteStream, remoteTrackVersion, isSpeakerMuted, remoteInMain]);

  // Attach local camera stream to whichever <video> element is rendering self-view
  useEffect(() => {
    const targetLocal = remoteInMain
      ? pipVideoRef.current
      : mainLocalVideoRef.current;

    if (!targetLocal) return;

    if (localStream) {
      if (targetLocal.srcObject !== localStream) {
        targetLocal.srcObject = localStream;
      }
      targetLocal.play().catch(() => {});
    } else {
      targetLocal.srcObject = null;
    }
  }, [localStream, remoteInMain, cameraEnabled]);

  // Start local camera & mic preview immediately on entering Join Call mode
  useEffect(() => {
    if (!localStream && !cameraError) {
      void onStartCamera();
    }
  }, [localStream, cameraError, onStartCamera]);

  // If arrived via QR code URL (?room=XXXXXX&role=camera), auto-join once camera is ready
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (
      urlRoom &&
      !autoJoinAttempted &&
      cameraReady &&
      stage === 'idle' &&
      roomCode.length === 6
    ) {
      setAutoJoinAttempted(true);
      void onJoinAndStream(roomCode);
    }
  }, [autoJoinAttempted, cameraReady, onJoinAndStream, roomCode, stage]);

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
      | (HTMLElement & {webkitRequestFullscreen?: () => Promise<void> | void})
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

  // Sync native fullscreen exit (Esc / Android back button) and lock background scroll
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

  // Automatically enter fullscreen when call connects; return to normal when call ends
  useEffect(() => {
    if (stage === 'live' && remoteStream) {
      if (!autoFullscreenTriggeredRef.current) {
        autoFullscreenTriggeredRef.current = true;
        void enterFullscreen();
      }
    } else if (
      stage === 'idle' ||
      stage === 'waiting-for-peer' ||
      stage === 'error'
    ) {
      if (autoFullscreenTriggeredRef.current) {
        autoFullscreenTriggeredRef.current = false;
        if (isFullscreen) {
          void exitFullscreen();
        }
      }
    }
  }, [stage, remoteStream, enterFullscreen, exitFullscreen, isFullscreen]);

  const handleUnblockAudio = () => {
    setIsSpeakerMuted(false);
    setAutoplayBlocked(false);
    const targetVideo = remoteInMain
      ? mainRemoteVideoRef.current
      : pipVideoRef.current;
    if (targetVideo) {
      targetVideo.muted = false;
      targetVideo.play().catch(() => {});
    }
  };

  const handleCodeDetected = (detectedCode: string) => {
    setScannerOpen(false);
    onChangeRoomCode(detectedCode);
    void onJoinAndStream(detectedCode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onJoinAndStream(roomCode);
  };

  const statusText =
    stage === 'live'
      ? 'Two-way call live'
      : stage === 'negotiating'
        ? 'Connecting call'
        : stage === 'waiting-for-peer'
          ? 'Waiting for host'
          : stage === 'reconnecting'
            ? 'Reconnecting'
            : cameraReady
              ? 'Camera & mic ready'
              : 'Camera off';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 sm:py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-stretch">
        {/* Two-Way Call Viewfinder (Hybrid native + mobile viewport fullscreen) */}
        <section
          ref={stageContainerRef}
          aria-label="Two-Way Video Call Viewfinder"
          className={
            isFullscreen
              ? 'fixed inset-0 z-50 h-[100dvh] w-screen bg-[#07090D] overflow-hidden flex flex-col justify-between pt-safe pb-safe'
              : 'relative rounded-2xl bg-[#07090D] border border-white/[0.08] overflow-hidden min-h-[54vh] sm:min-h-[62vh] flex flex-col justify-between'
          }
        >
          {/* Main Background Video (Remote Caller when live, or Local Camera before joining) */}
          {remoteInMain ? (
            <>
              <video
                ref={mainRemoteVideoRef}
                autoPlay
                playsInline
                muted={isSpeakerMuted}
                className={`absolute inset-0 h-full w-full ${
                  isFullscreen ? 'object-contain sm:object-cover' : 'object-cover'
                } ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
              />
              {!hasRemoteVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  <div className="h-14 w-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <VideoOff className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm font-medium text-white">
                    Host camera is off
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {remoteMeta?.audioEnabled === false
                      ? 'Host microphone is muted'
                      : 'Two-way voice audio is active'}
                  </p>
                </div>
              )}
            </>
          ) : localStream ? (
            <>
              <video
                ref={mainLocalVideoRef}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 h-full w-full object-cover ${
                  facingMode === 'user' ? '-scale-x-100' : ''
                } ${hasLocalVideo ? 'opacity-100' : 'opacity-0'}`}
              />
              {!hasLocalVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <VideoOff className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm font-medium text-white">Your camera is off</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {audioEnabled ? 'Microphone is active' : 'Microphone is muted'}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                <Camera className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-white">
                {cameraError ? 'Camera & mic access required' : 'Starting camera & mic...'}
              </p>
              {cameraError && (
                <p className="mt-2 text-xs text-red-300 max-w-xs leading-relaxed">
                  {cameraError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void onStartCamera()}
                className="mt-4 min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
              >
                Enable Camera & Mic
              </button>
            </div>
          )}

          {/* Picture-in-Picture Corner Tile when call is active (tap to swap main/PiP) */}
          {hasCallVideo && (
            <button
              type="button"
              onClick={() => setSwapViews((prev) => !prev)}
              aria-label="Swap local and remote video views"
              className="absolute top-[74px] right-3 z-20 w-24 sm:w-40 aspect-[3/4] sm:aspect-video rounded-xl overflow-hidden border border-white/25 bg-[#0B0E14] shadow-2xl text-left"
            >
              {remoteInMain ? (
                hasLocalVideo ? (
                  <video
                    ref={pipVideoRef}
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
                    <span className="text-[10px]">Cam off</span>
                  </div>
                )
              ) : (
                <>
                  <video
                    ref={pipVideoRef}
                    autoPlay
                    playsInline
                    muted={isSpeakerMuted}
                    className={`h-full w-full object-cover ${
                      hasRemoteVideo ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  {!hasRemoteVideo && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
                      <VideoOff className="w-4 h-4" />
                      <span className="text-[10px]">Host off</span>
                    </div>
                  )}
                </>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-[10px] font-medium text-white">
                <span>{remoteInMain ? 'You' : 'Host'}</span>
                {remoteInMain && !audioEnabled && (
                  <MicOff className="w-3 h-3 text-red-400" />
                )}
              </div>
            </button>
          )}

          {/* Top Scrim & Compact Status + Always-Reachable Fullscreen / Exit Button */}
          <div className="relative z-10 flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
            <div className="flex items-center gap-2 text-xs font-medium text-white min-w-0">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  stage === 'live'
                    ? 'bg-emerald-400'
                    : isStreamingOrWaiting
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
                }`}
              />
              <span className="truncate">{statusText}</span>
              {isStreamingOrWaiting && roomCode && (
                <>
                  <span className="text-white/40 shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tracking-wider shrink-0">{roomCode}</span>
                </>
              )}
              {stage === 'live' && remoteMeta?.audioEnabled === false && (
                <>
                  <span className="text-white/40 shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-amber-300 truncate">Host muted</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {wakeLockActive && stage === 'live' && (
                <button
                  type="button"
                  onClick={() => setPocketDim(true)}
                  className="min-h-[40px] px-3 rounded-xl bg-black/55 hover:bg-black/75 border border-white/15 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 backdrop-blur-sm transition-colors whitespace-nowrap"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Dim</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
                className={`min-h-[40px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 backdrop-blur-sm transition-colors whitespace-nowrap ${
                  isFullscreen
                    ? 'bg-white/15 hover:bg-white/25 border-white/30 text-white'
                    : 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                }`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-4 h-4" />
                    <span>Exit</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-4 h-4" />
                    <span>Full</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Autoplay Blocked Unmute Prompt */}
          {hasCallVideo && autoplayBlocked && (
            <div className="relative z-20 flex justify-center px-4">
              <button
                type="button"
                onClick={handleUnblockAudio}
                className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white shadow-lg inline-flex items-center gap-2 transition-colors"
              >
                <Volume2 className="w-4 h-4" />
                Tap to Hear Caller
              </button>
            </div>
          )}

          {/* Bottom Scrim & Thumb-Zone Quick Controls */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onToggleMic}
                disabled={!cameraReady}
                aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-xs font-medium disabled:opacity-40 inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors ${
                  audioEnabled
                    ? 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                    : 'bg-red-500/25 border-red-400/40 text-red-100'
                }`}
              >
                {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                <span>{audioEnabled ? 'Mic On' : 'Muted'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleCamera}
                disabled={!cameraReady}
                aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-xs font-medium disabled:opacity-40 inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors ${
                  cameraEnabled
                    ? 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                    : 'bg-red-500/25 border-red-400/40 text-red-100'
                }`}
              >
                {cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                <span>{cameraEnabled ? 'Cam On' : 'Cam Off'}</span>
              </button>

              <button
                type="button"
                onClick={() => void onFlipCamera()}
                disabled={!cameraReady}
                aria-label="Switch front or rear camera"
                className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-black/55 hover:bg-black/75 border border-white/15 text-xs font-medium text-white disabled:opacity-40 inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
              </button>

              {hasCallVideo && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSpeakerMuted((prev) => !prev);
                    setAutoplayBlocked(false);
                  }}
                  aria-label={isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                  className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors ${
                    isSpeakerMuted
                      ? 'bg-amber-500/30 border-amber-400/50 text-amber-100'
                      : 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                  }`}
                >
                  {isSpeakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  <span>{isSpeakerMuted ? 'Muted' : 'Sound'}</span>
                </button>
              )}

              {torchSupported && (
                <button
                  type="button"
                  onClick={() => void onToggleTorch()}
                  aria-label="Toggle flashlight"
                  className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors ${
                    torchEnabled
                      ? 'bg-amber-500/30 border-amber-400/50 text-amber-100'
                      : 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                  }`}
                >
                  <Flashlight className="w-4 h-4" />
                </button>
              )}

              {isFullscreen && isStreamingOrWaiting && (
                <button
                  type="button"
                  onClick={() => {
                    void exitFullscreen();
                    onStopBroadcast();
                  }}
                  aria-label="Leave call"
                  className="min-h-[44px] px-3 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-medium text-white inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>Leave</span>
                </button>
              )}
            </div>

            {/* Quality Segmented Control */}
            <div
              role="group"
              aria-label="Stream resolution"
              className="flex items-center gap-1 p-1 rounded-xl bg-black/60 border border-white/15 backdrop-blur-sm"
            >
              {QUALITY_OPTIONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => void onChangeQuality(preset)}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                    quality === preset
                      ? 'bg-white text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Battery-Saving Dim Screen Overlay */}
          {pocketDim && (
            <button
              type="button"
              onClick={() => setPocketDim(false)}
              className="absolute inset-0 z-30 bg-black/95 flex flex-col items-center justify-center gap-2 text-center p-6"
            >
              <span className="text-xs font-medium text-slate-400">
                Two-way call active · Screen dimmed
              </span>
              <span className="text-sm font-medium text-slate-200">
                Tap anywhere to restore call view
              </span>
            </button>
          )}
        </section>

        {/* Thumb-Friendly Pairing & Join Call Panel */}
        <section
          aria-label="Join Call Controls"
          className="bg-[#131822] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-5"
        >
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                {isStreamingOrWaiting ? 'Active Call Room' : 'Join Video Call'}
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {isStreamingOrWaiting
                  ? 'You are connected in a simultaneous two-way video and voice call.'
                  : 'Scan the QR code on the host screen or enter the 6-character room code.'}
              </p>
            </div>

            {!isStreamingOrWaiting ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="room-code-input"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Host Room Code
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={6}
                    placeholder="ABC234"
                    value={roomCode}
                    onChange={(e) =>
                      onChangeRoomCode(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                      )
                    }
                    className="w-full h-12 rounded-xl bg-[#0B0E14] border border-white/15 px-4 text-center font-mono text-xl font-semibold tracking-[0.25em] text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {errorMessage && (
                  <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="min-h-[48px] px-4 rounded-xl border border-white/15 text-sm font-medium text-slate-100 hover:bg-white/5 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <QrCode className="w-4 h-4 text-blue-400" />
                    Scan QR
                  </button>

                  <button
                    type="submit"
                    disabled={roomCode.length !== 6}
                    className="min-h-[48px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-sm font-medium text-white transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <PhoneCall className="w-4 h-4" />
                    Join Call
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl bg-[#0B0E14] border border-white/[0.08] px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Room</span>
                  <span className="font-mono text-lg font-semibold tracking-[0.2em] text-white">
                    {roomCode}
                  </span>
                </div>

                <div className="space-y-2 text-xs border-t border-white/[0.08] pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Host Status</span>
                    <span className={stage === 'live' ? 'text-emerald-400' : 'text-slate-300'}>
                      {stage === 'live'
                        ? `${remoteMeta?.audioEnabled === false ? 'Muted' : 'Speaking'} · ${
                            hasRemoteVideo ? 'Cam on' : 'Cam off'
                          }`
                        : statusText}
                    </span>
                  </div>
                  {stats && stats.width > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Incoming Video</span>
                      <span className="font-mono text-slate-300">
                        {stats.width}×{stats.height} · {stats.fps} fps
                        {stats.rttMs !== null ? ` · ${stats.rttMs} ms` : ''}
                      </span>
                    </div>
                  )}
                </div>

                {errorMessage && (
                  <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>
                )}

                <button
                  type="button"
                  onClick={onStopBroadcast}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-medium text-white transition-colors inline-flex items-center justify-center gap-2"
                >
                  <PhoneOff className="w-4 h-4" />
                  Leave Call
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 leading-relaxed border-t border-white/[0.08] pt-4">
            Both participants can speak and stream video simultaneously. Keep this tab active during your call.
          </p>
        </section>
      </div>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleCodeDetected}
      />
    </div>
  );
}
