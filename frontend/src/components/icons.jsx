// One icon family (Phosphor) behind semantic names. Screens use <Icon name="…" />, never a Phosphor import.
// Styles: regular for chrome, fill for the selected state only, duotone for empty states / illustrative spots.
import {
  AddressBook, ArrowRight, Bell, Briefcase, Buildings, CalendarBlank, CaretDown, CaretUp, CaretUpDown, Certificate, ChartBar, ChartLine,
  ChartLineUp, Check, CheckCircle, CheckSquare, ClipboardText, ClockCounterClockwise, Coins, CurrencyCircleDollar, FileText, FlowArrow,
  Funnel, Gauge, GearSix, Handshake, House, Info, Kanban, List, ListBullets, ListChecks, MagnifyingGlass, Megaphone, Package, PencilSimple,
  Percent, PlugsConnected, Plus, Pulse, Receipt, ShieldCheck, Sparkle, SignOut, Stack, Stamp, Star, Tag, Target, Ticket, Tray, TreeStructure, TrendUp,
  Truck, UploadSimple, UserGear, Users, UsersThree, Wallet, Warning, WarningCircle, X, XCircle,
} from '@phosphor-icons/react';

const MAP = {
  // navigation
  dashboard: House, myWork: CheckSquare, approvals: Stamp, leads: Funnel, accounts: Buildings, contacts: AddressBook, pipeline: Kanban,
  opportunities: ChartLineUp, quotations: FileText, dealRegistrations: Certificate, projects: Briefcase, forecast: TrendUp, contracts: Handshake,
  campaigns: Megaphone, partners: UsersThree, vendors: Truck, products: Package, priceLists: Tag, vendorCosts: CurrencyCircleDollar,
  requirements: ListChecks, solutions: Stack, tasks: CheckSquare, activities: Pulse, meetings: Users, calendar: CalendarBlank,
  activityReports: ClipboardText, events: Ticket, claims: Receipt, payments: Wallet, targets: Target, commission: Coins, reports: ChartBar,
  analytics: ChartLine, orgChart: TreeStructure, admin: Gauge, users: Users, permissions: ShieldCheck, organisation: Buildings,
  picklists: ListBullets, stages: FlowArrow, fx: Percent, workflows: FlowArrow, configuration: GearSix, integrations: PlugsConnected,
  audit: ClockCounterClockwise, imports: UploadSimple,
  // chrome & actions
  search: MagnifyingGlass, notifications: Bell, menu: List, close: X, sortAsc: CaretUp, sortDesc: CaretDown, sortable: CaretUpDown,
  next: ArrowRight, check: Check, edit: PencilSimple, add: Plus, star: Star, ai: Sparkle, signOut: SignOut, settings: UserGear, inbox: Tray,
  // status (always next to a label)
  info: Info, success: CheckCircle, warning: Warning, error: WarningCircle, rejected: XCircle,
};

export function Icon({ name, size = 20, weight = 'regular', className = '', label, ...rest }) {
  const C = MAP[name];
  if (!C) return null;
  return <C size={size} weight={weight} className={`ic ${size <= 16 ? 'sm' : ''} ${className}`.trim()} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} {...rest} />;
}

export const iconNames = Object.keys(MAP);
