import type { SVGProps } from "react";
import {
  UserCircleIcon,
  WrenchScrewdriverIcon,
  BookOpenIcon,
  SparklesIcon,
  ChartBarIcon,
  CpuChipIcon,
  SpeakerWaveIcon,
  ServerStackIcon,
  CalendarDaysIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  XCircleIcon,
  BoltIcon,
  CommandLineIcon,
  GlobeAltIcon,
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  XMarkIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Squares2X2Icon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
  KeyIcon,
  MapIcon,
  CircleStackIcon,
  ComputerDesktopIcon,
  ArrowDownTrayIcon,
  InformationCircleIcon,
  ChatBubbleLeftIcon,
  CodeBracketIcon,
  ShieldCheckIcon,
  IdentificationIcon,
  UserPlusIcon,
} from "@heroicons/react/24/solid";

import {
  UserCircleIcon as UserCircleOutline,
  WrenchScrewdriverIcon as WrenchOutline,
  BookOpenIcon as BookOutline,
  SparklesIcon as SparklesOutline,
  ChartBarIcon as ChartBarOutline,
} from "@heroicons/react/24/outline";

import type { ComponentType } from "react";

export type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export const Icon = {
  UserCircle: UserCircleIcon,
  Wrench: WrenchScrewdriverIcon,
  Book: BookOpenIcon,
  Sparkles: SparklesIcon,
  ChartBar: ChartBarIcon,
  Cpu: CpuChipIcon,
  Speaker: SpeakerWaveIcon,
  Server: ServerStackIcon,
  Calendar: CalendarDaysIcon,
  Clock: ClockIcon,
  Warning: ExclamationTriangleIcon,
  Trash: TrashIcon,
  XCircle: XCircleIcon,
  Bolt: BoltIcon,
  CommandLine: CommandLineIcon,
  Globe: GlobeAltIcon,
  LockClosed: LockClosedIcon,
  LockOpen: LockOpenIcon,
  Plus: PlusIcon,
  X: XMarkIcon,
  Check: CheckIcon,
  ChevronRight: ChevronRightIcon,
  ChevronDown: ChevronDownIcon,
  Squares: Squares2X2Icon,
  Clipboard: ClipboardDocumentIcon,
  Refresh: ArrowPathIcon,
  Key: KeyIcon,
  Map: MapIcon,
  CircleStack: CircleStackIcon,
  Desktop: ComputerDesktopIcon,
  Download: ArrowDownTrayIcon,
  Info: InformationCircleIcon,
  Chat: ChatBubbleLeftIcon,
  Code: CodeBracketIcon,
  Shield: ShieldCheckIcon,
  Identification: IdentificationIcon,
  UserPlus: UserPlusIcon,
};

export const TabIcon = {
  profile: { on: UserCircleIcon, off: UserCircleOutline },
  tools: { on: WrenchScrewdriverIcon, off: WrenchOutline },
  memory: { on: BookOpenIcon, off: BookOutline },
  plus: { on: SparklesIcon, off: SparklesOutline },
  stats: { on: ChartBarIcon, off: ChartBarOutline },
};

export type IconColor =
  | "c-blue"
  | "c-green"
  | "c-red"
  | "c-orange"
  | "c-purple"
  | "c-teal"
  | "c-indigo"
  | "c-pink"
  | "c-yellow"
  | "c-gray";
