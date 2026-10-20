import { Button, Card, CardBody, Tooltip } from "@heroui/react";
import { Play, Square, Clock, Coffee, Zap, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAttendanceTimer } from "../hooks/use-attendance-timer";
import { useTranslation } from "react-i18next";
import { DailyReportModal } from "./DailyReportModal";

interface TimeTrackerWidgetProps {
  variant?: "compact" | "full";
}

export function TimeTrackerWidget({ variant = "compact" }: TimeTrackerWidgetProps) {
  const { t } = useTranslation("people");
  const {
    todayAttendance,
    isOnBreak,
    liveSeconds,
    accumulatedSeconds,
    isShiftLoading,
    isReportModalOpen,
    setReportModalOpen,
    syncError,
    retrySync,
    handleCheckIn,
    handleTakeBreak,
    handleCheckOut,
    executeCheckOut,
    formatLiveTime
  } = useAttendanceTimer();

  const isCheckedIn = !!todayAttendance && !todayAttendance.checkOut && !isOnBreak;
  const totalDisplaySeconds = accumulatedSeconds + liveSeconds;

  // A failed initialization is an explicit, recoverable error — not a silent
  // "off-duty" state. This keeps a permission/tenant/network fault from being
  // mistaken for "no shift today" while offering a retry that never bypasses
  // authentication or authorization.
  const syncErrorBanner = syncError ? (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger"
    >
      <span className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={16} className="shrink-0" />
        {t(syncError === "permission-denied" ? "time_tracker.sync_error_permission" : "time_tracker.sync_error_generic")}
      </span>
      <Button size="sm" variant="flat" color="danger" className="font-bold shrink-0" onPress={() => void retrySync()}>
        {t("time_tracker.sync_retry")}
      </Button>
    </div>
  ) : null;

  // In the navbar the banner must never stack a full-width block into the
  // header row — the pill itself morphs into an error chip of the same
  // footprint (same role="alert" + Retry affordance, just inline).
  const syncErrorChip = syncError ? (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-3 py-2 text-danger shadow-lg"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="text-[11px] sm:text-xs font-bold whitespace-nowrap">
        {t(syncError === "permission-denied" ? "time_tracker.sync_error_permission" : "time_tracker.sync_error_generic")}
      </span>
      <Button
        size="sm"
        variant="flat"
        color="danger"
        className="h-6 min-h-6 px-2 text-[10px] font-bold shrink-0"
        onPress={() => void retrySync()}
      >
        {t("time_tracker.sync_retry")}
      </Button>
    </div>
  ) : null;

  if (variant === "full") {
    return (
      <div className="space-y-3">
        {syncErrorBanner}
      <div className="bg-primary/5 p-6 md:p-10 flex flex-col md:flex-row items-center justify-between gap-6 md:gap-10 rounded-3xl">
        {/* Timer Section */}
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center md:items-start text-center md:text-left">
            <div className="flex items-center gap-2 text-default-400 mb-1">
              <Clock size={16} className={isCheckedIn ? "text-primary animate-pulse" : ""} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">{t("time_tracker.daily_focus")}</span>
            </div>
            <span className={`text-4xl md:text-5xl font-mono font-black tabular-nums tracking-tighter ${isCheckedIn ? 'text-primary drop-shadow-[0_0_15px_rgba(var(--heroui-primary-rgb),0.4)]' : 'text-foreground'}`}>
              {formatLiveTime(totalDisplaySeconds)}
            </span>
          </div>
        </div>

        <div className="hidden md:block h-16 w-[1px] bg-gradient-to-b from-transparent via-default-200 to-transparent" />

        {/* Actions Section */}
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 w-full md:w-auto">
          <div className="relative">
            <AnimatePresence mode="wait">
              {!isCheckedIn && !isOnBreak ? (
                <motion.div
                  key="start"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  <Button 
                    isIconOnly
                    color="primary"
                    variant="shadow"
                    className="h-16 w-16 md:h-20 md:w-20 rounded-[2rem] shadow-2xl shadow-primary/40 hover:scale-105 active:scale-95 transition-all"
                    onPress={handleCheckIn}
                    isLoading={isShiftLoading}
                  >
                    <Play size={28} fill="currentColor" className="ml-1 md:w-8 md:h-8" />
                  </Button>
                </motion.div>
              ) : isCheckedIn ? (
                <div className="flex gap-4">
                  <motion.div
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                  >
                    <Button 
                      isIconOnly
                      size="lg"
                      color="warning"
                      variant="flat"
                      className="h-16 w-16 md:h-20 md:w-20 rounded-[2rem] bg-warning/10 text-warning hover:scale-105 active:scale-95 transition-all"
                      onPress={handleTakeBreak}
                      isLoading={isShiftLoading}
                    >
                      <Coffee size={28} className="md:w-8 md:h-8" />
                    </Button>
                  </motion.div>
                  <motion.div
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                  >
                    <Button 
                      isIconOnly
                      size="lg"
                      color="danger"
                      variant="shadow"
                      className="h-16 w-16 md:h-20 md:w-20 rounded-[2rem] shadow-2xl shadow-danger/30 hover:scale-105 active:scale-95 transition-all bg-gradient-to-br from-danger to-rose-600"
                      onPress={handleCheckOut}
                      isLoading={isShiftLoading}
                    >
                      <Square size={24} fill="currentColor" className="md:w-7 md:h-7" />
                    </Button>
                  </motion.div>
                </div>
              ) : isOnBreak ? (
                <motion.div
                  key="resume"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  <Button 
                    isIconOnly
                    color="primary"
                    variant="shadow"
                    className="h-16 w-16 md:h-20 md:w-20 rounded-[2rem] shadow-2xl shadow-primary/40 hover:scale-105 active:scale-95 transition-all"
                    onPress={handleCheckIn}
                    isLoading={isShiftLoading}
                  >
                    <Play size={28} fill="currentColor" className="ml-1 md:w-8 md:h-8" />
                  </Button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="flex flex-row md:flex-col items-center md:items-start justify-between w-full md:w-auto px-4 md:px-0">
            <span className="text-[10px] font-black uppercase text-default-400 tracking-[0.2em] mb-0 md:mb-1">{t("time_tracker.system")}</span>
            <div className="flex items-center gap-3">
              <div className="relative flex h-3 w-3">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${isCheckedIn ? 'bg-success animate-ping' : isOnBreak ? 'bg-warning animate-pulse' : 'bg-default-300'}`}></span>
                <span className={`relative inline-flex rounded-full h-3 w-3 ${isCheckedIn ? 'bg-success' : isOnBreak ? 'bg-warning' : 'bg-default-400'}`}></span>
              </div>
              <span className={`text-sm font-black uppercase tracking-tight ${isCheckedIn ? 'text-success' : isOnBreak ? 'text-warning' : 'text-default-400'}`}>
                {isCheckedIn ? t("time_tracker.on_duty") : isOnBreak ? t("time_tracker.on_break") : t("time_tracker.off_duty")}
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      initial={false}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="space-y-2"
    >
      {syncError ? (
        syncErrorChip
      ) : (
      <Card
        className={`relative border shadow-2xl transition-all duration-700 ease-in-out ${
          isCheckedIn 
            ? "border-primary/40 bg-primary/10 shadow-primary/20" 
            : "border-default-200/50 bg-background/60 backdrop-blur-xl shadow-black/5"
        }`}
      >
        <CardBody className="p-0.5 px-1.5 sm:py-1.5 sm:px-4 flex flex-row items-center gap-1.5 sm:gap-6 overflow-hidden">
          {/* Animated Background Pulse */}
          <AnimatePresence>
            {isCheckedIn && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  backgroundPosition: ["0% 0%", "200% 0%"],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            )}
          </AnimatePresence>

          <div className="flex flex-col relative z-10">
            <div className="flex items-center gap-1 sm:gap-2 text-default-400 group">
              <motion.div
                animate={isCheckedIn ? { rotate: 360 } : {}}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              >
                <Clock className={isCheckedIn ? "text-primary w-2.5 h-2.5 sm:w-3 sm:h-3" : "w-2.5 h-2.5 sm:w-3 sm:h-3"} />
              </motion.div>
              <span className="text-[6px] sm:text-[9px] font-black uppercase tracking-[0.2em] text-default-400/80">
                {t("time_tracker.focus")}
              </span>
            </div>
            
            <div className="flex items-baseline gap-0.5">
              <span className={`text-xs sm:text-lg font-mono font-black tabular-nums tracking-tighter ${isCheckedIn ? 'text-primary drop-shadow-[0_0_8px_rgba(var(--heroui-primary-rgb),0.5)]' : 'text-foreground/80'}`}>
                {formatLiveTime(totalDisplaySeconds)}
              </span>
            </div>
          </div>

          <div className="h-5 sm:h-8 w-[1px] bg-gradient-to-b from-transparent via-default-200 to-transparent relative z-10" />

          <div className="flex items-center gap-1.5 sm:gap-4 relative z-10">
            <div className="relative group">
              <AnimatePresence mode="wait">
                {!isCheckedIn ? (
                  <motion.div
                    key="play"
                    initial={{ scale: 0.5, opacity: 0, rotate: -90 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.5, opacity: 0, rotate: 90 }}
                  >
                    <Tooltip content={isOnBreak ? t("time_tracker.back_to_work") : t("time_tracker.check_in_resume")} placement="bottom" showArrow offset={10}>
                      <Button 
                        isIconOnly 
                        color="primary" 
                        variant="shadow" 
                        className="min-w-unit-6 w-6 h-6 sm:h-9 sm:w-9 rounded sm:rounded-xl shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-all"
                        onPress={handleCheckIn}
                        isLoading={isShiftLoading}
                      >
                        <Play fill="currentColor" className="ml-0.5 w-3 h-3 sm:w-4 sm:h-4" />
                      </Button>
                    </Tooltip>
                  </motion.div>
                ) : (
                  <motion.div
                    key="stop"
                    initial={{ scale: 0.5, opacity: 0, rotate: 90 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.5, opacity: 0, rotate: -90 }}
                  >
                    <Tooltip content={t("time_tracker.check_out_end")} placement="bottom" color="danger" showArrow offset={10}>
                      <Button 
                        isIconOnly 
                        color="danger" 
                        variant="shadow" 
                        className="min-w-unit-6 w-6 h-6 sm:h-9 sm:w-9 rounded sm:rounded-xl shadow-lg shadow-danger/20 hover:scale-105 active:scale-95 transition-all bg-gradient-to-br from-danger to-rose-600"
                        onPress={handleCheckOut}
                        isLoading={isShiftLoading}
                      >
                        <Square fill="currentColor" className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" />
                      </Button>
                    </Tooltip>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <div className="flex flex-col min-w-[35px] sm:min-w-[70px]">
              <span className="text-[6px] sm:text-[9px] font-black text-default-400 uppercase tracking-widest leading-none mb-0.5">
                {t("time_tracker.system")}
              </span>
              <div className="flex items-center gap-0.5 sm:gap-2">
                <div className="relative flex h-1 w-1 sm:h-2 sm:w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${isCheckedIn ? 'bg-success animate-ping' : isOnBreak ? 'bg-warning animate-pulse' : 'bg-default-300'}`}></span>
                  <span className={`relative inline-flex rounded-full h-1 w-1 sm:h-2 sm:w-2 ${isCheckedIn ? 'bg-success' : isOnBreak ? 'bg-warning' : 'bg-default-400'}`}></span>
                </div>
                <span className={`text-[7px] sm:text-[11px] font-black uppercase tracking-tight leading-none ${isCheckedIn ? 'text-success' : isOnBreak ? 'text-warning' : 'text-default-400'}`}>
                  {isCheckedIn ? t("time_tracker.on") : isOnBreak ? t("time_tracker.break") : t("time_tracker.off")}
                </span>
              </div>
            </div>

            {/* Micro-Interaction Icons */}
            <div className="flex gap-0.5 sm:gap-1.5 ml-0 sm:ml-2">
               <Tooltip content={isOnBreak ? t("time_tracker.resume_work") : isCheckedIn ? t("time_tracker.take_break") : t("time_tracker.must_be_on_duty")}>
                  <Button 
                    isIconOnly 
                    size="sm" 
                    variant={isOnBreak ? "shadow" : "light"} 
                    className={`min-w-unit-5 w-5 h-5 sm:min-w-unit-7 sm:w-7 sm:h-7 rounded sm:rounded-lg transition-all ${isCheckedIn ? 'text-warning hover:bg-warning/10' : isOnBreak ? 'bg-warning text-warning-foreground' : 'text-default-300 opacity-50'}`}
                    onPress={isOnBreak ? handleCheckIn : handleTakeBreak}
                    disabled={!isCheckedIn && !isOnBreak}
                  >
                    <Coffee className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" fill={isOnBreak ? "currentColor" : "none"} />
                  </Button>
               </Tooltip>
               <Tooltip content={t("time_tracker.productivity_mode")}>
                  <Button isIconOnly size="sm" variant="light" className={`min-w-unit-5 w-5 h-5 sm:min-w-unit-7 sm:w-7 sm:h-7 rounded sm:rounded-lg ${isCheckedIn ? 'text-warning animate-pulse' : 'text-default-300'}`}>
                    <Zap className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" fill={isCheckedIn ? "currentColor" : "none"} />
                  </Button>
               </Tooltip>
            </div>
          </div>
        </CardBody>
      </Card>
      )}

      <DailyReportModal
        isOpen={isReportModalOpen}
        onClose={() => setReportModalOpen(false)}
        onSuccessCheckOut={executeCheckOut}
        attendance={todayAttendance}
        liveSeconds={liveSeconds}
        accumulatedSeconds={accumulatedSeconds}
      />
    </motion.div>
  );
}
