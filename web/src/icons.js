/**
 * Inline SVG icons from @phosphor-icons/core, imported individually via Vite's
 * `?raw` loader. Each import is ~500 B; we only ship what's referenced here.
 * Templates render an icon with <span x-html="icons.brainFill"></span>.
 */
import userCircleFill from "@phosphor-icons/core/assets/fill/user-circle-fill.svg?raw";
import waveformFill from "@phosphor-icons/core/assets/fill/waveform-fill.svg?raw";
import plugFill from "@phosphor-icons/core/assets/fill/plug-fill.svg?raw";
import brainFill from "@phosphor-icons/core/assets/fill/brain-fill.svg?raw";
import brainRegular from "@phosphor-icons/core/assets/regular/brain.svg?raw";
import chartBarFill from "@phosphor-icons/core/assets/fill/chart-bar-fill.svg?raw";
import chartBarRegular from "@phosphor-icons/core/assets/regular/chart-bar.svg?raw";
import calendarBlankFill from "@phosphor-icons/core/assets/fill/calendar-blank-fill.svg?raw";
import timerFill from "@phosphor-icons/core/assets/fill/timer-fill.svg?raw";
import warningOctagonFill from "@phosphor-icons/core/assets/fill/warning-octagon-fill.svg?raw";
import userFill from "@phosphor-icons/core/assets/fill/user-fill.svg?raw";
import userRegular from "@phosphor-icons/core/assets/regular/user.svg?raw";
import wrenchFill from "@phosphor-icons/core/assets/fill/wrench-fill.svg?raw";
import wrenchRegular from "@phosphor-icons/core/assets/regular/wrench.svg?raw";
import trashRegular from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import trashBold from "@phosphor-icons/core/assets/bold/trash-bold.svg?raw";
import plusBold from "@phosphor-icons/core/assets/bold/plus-bold.svg?raw";
import caretRight from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";

export const icons = {
  userCircleFill,
  waveformFill,
  plugFill,
  brainFill,
  brain: brainRegular,
  chartBarFill,
  chartBar: chartBarRegular,
  calendarBlankFill,
  timerFill,
  warningOctagonFill,
  userFill,
  user: userRegular,
  wrenchFill,
  wrench: wrenchRegular,
  trash: trashRegular,
  trashBold,
  plusBold,
  caretRight,
};
