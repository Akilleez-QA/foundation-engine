/**
 * kits/schedules: optional day-cycle schedules for actors (pure helpers; no system, clock, mover, save data or
 * registration). Time is the caller's game time (normally `GameClock.ut`). Cost: no draws; a placement is
 * O(variants + flags + log windows); a catch-up is bounded by its transition limit and one pattern cycle of days.
 */
export {
  createScheduleRoster,
  defineSchedule,
  defineScheduleCalendar,
  scheduleCatchUp,
  scheduleItineraryOrder,
  schedulePlacement,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleCalendar,
  type ScheduleCalendarInput,
  type ScheduleCatchUp,
  type ScheduleCatchUpOptions,
  type ScheduleEntry,
  type ScheduleFlags,
  type ScheduleIdleInput,
  type ScheduleInput,
  type ScheduleItineraryOrder,
  type SchedulePlacement,
  type ScheduleRoster,
  type ScheduleRosterLimits,
  type ScheduleTransition,
  type ScheduleVariant,
  type ScheduleVariantInput,
  type ScheduleWindowInput,
} from './schedule';
