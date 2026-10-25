import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  MapPin,
  Minus,
  PackageCheck,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Star,
  Users,
  X,
} from "lucide-react";
import { supabase, supabaseConfigured } from "./supabase";

type Section = "overview" | "applications" | "stations" | "orders" | "customers" | "stationOwners" | "adminAccounts";
type Kind = "applications" | "stations" | "orders" | "customers" | "stationOwners" | "adminAccounts";
type Row = Record<string, string | number | null>;
type Selection = { kind: Kind; row: Row } | null;
type Tone = "primary" | "secondary" | "positive" | "danger";

interface Permissions {
  review: boolean;
  publish: boolean;
  suspend: boolean;
}

interface DocRow {
  id: string;
  document_type: string;
  storage_path: string;
  review_status: string;
  review_notes: string | null;
  required_for_verification: boolean;
  expires_at: string | null;
  is_current?: boolean;
  submitted_at: string;
}

interface DecisionAction {
  id: string;
  label: string;
  tone: Tone;
  needsNote: boolean;
  disabled?: boolean;
}

interface ActionResult {
  kind: "success" | "error";
  text: string;
}

interface DashboardData {
  applications: Row[];
  stations: Row[];
  orders: Row[];
  customers: Row[];
  stationOwners: Row[];
  adminAccounts: Row[];
  canViewCustomers: boolean;
  canViewAccountEmails: boolean;
  canManageAdmins: boolean;
  totalApplications: number;
  totalStations: number;
  totalOrders: number;
  pendingApplications: number;
  publishedStations: number;
  totalCustomers: number | null;
  ordersLast30Days: Array<{ id: string; status: string; created_at: string }>;
  analyticsOrders: Array<{ id: string; status: string; created_at: string; station_id: string | null }>;
  analyticsPaidPayments: Array<{ order_id: string; amount: number | string; paid_at: string }>;
  analyticsStations: Array<{ id: string; display_name: string; city: string | null; province: string | null; logo_path: string | null; publication_status: string }>;
  paidSalesLast30Days: number;
  paidOrdersLast30Days: number;
  monthlyStationSales: Array<{
    station_id: string;
    display_name: string;
    city: string | null;
    province: string | null;
    logo_path: string | null;
    month: string;
    sales: number;
    orders: number;
  }>;
  ratingAverage: number | null;
  ratingCount: number;
  stationRatings: Array<{ id: string; display_name: string; logo_path: string | null; rating_average: number; rating_count: number }>;
  ratingDistribution: number[];
  canViewReviewDistribution: boolean;
}

const sections: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: ClipboardCheck },
  { id: "stations", label: "Stations", icon: Store },
  { id: "orders", label: "Orders", icon: PackageCheck },
  { id: "customers", label: "Customers", icon: Users },
  { id: "stationOwners", label: "Owners", icon: Store },
  { id: "adminAccounts", label: "Admins", icon: ShieldCheck },
];

const pageCopy: Record<Section, { title: string; description: string }> = {
  overview: { title: "Overview", description: "What needs your attention today." },
  applications: { title: "Applications", description: "Review stations applying to sell on AquaDirect." },
  stations: { title: "Stations", description: "Verification and publication status of every station." },
  orders: { title: "Orders", description: "Latest customer orders in your view." },
  customers: { title: "Customers", description: "Customer accounts, separate from station owners." },
  stationOwners: { title: "Station owners", description: "Accounts that own and manage stations." },
  adminAccounts: { title: "Admins", description: "Review admins and grant access to existing accounts." },
};

const tableConfig: Record<Kind, { columns: string[]; statusKey: string; searchLabel: string }> = {
  applications: {
    columns: ["display_name", "email", "city", "application_status", "permit_renewal", "created_at"],
    statusKey: "application_status",
    searchLabel: "Search applications",
  },
  stations: {
    columns: ["display_name", "barangay", "city", "province", "verification_status", "publication_status", "operational_status"],
    statusKey: "publication_status",
    searchLabel: "Search stations",
  },
  orders: {
    columns: ["order_number", "status", "payment_method", "total", "created_at"],
    statusKey: "status",
    searchLabel: "Search orders",
  },
  customers: {
    columns: ["full_name", "email", "status", "created_at"],
    statusKey: "status",
    searchLabel: "Search customer accounts",
  },
  stationOwners: {
    columns: ["full_name", "email", "status", "created_at"],
    statusKey: "status",
    searchLabel: "Search station owners",
  },
  adminAccounts: {
    columns: ["full_name", "email", "status", "created_at"],
    statusKey: "status",
    searchLabel: "Search admin accounts",
  },
};

const columnLabels: Record<string, string> = {
  order_number: "Order",
  status: "Status",
  payment_method: "Payment",
  total: "Total",
  created_at: "Created",
  display_name: "Name",
  full_name: "Account name",
  email: "Email",
  city: "Municipality / city",
  barangay: "Barangay",
  verification_status: "Verification",
  publication_status: "Publication",
  operational_status: "Operation",
  application_status: "Application",
  permit_renewal: "Permit renewal",
};

const moneyKeys = new Set(["total", "subtotal", "delivery_fee", "default_delivery_fee", "minimum_order_amount"]);
const dateKeys = new Set(["created_at", "submitted_at", "delivered_at"]);

function sentence(value: string) {
  const text = value.replaceAll("_", " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function manilaDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function timeAgo(value: string | number | null) {
  if (!value) return "";
  const minutes = Math.floor((Date.now() - new Date(String(value)).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return shortDate(String(value));
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
    const details = "details" in cause && typeof cause.details === "string" ? cause.details : "";
    const hint = "hint" in cause && typeof cause.hint === "string" ? cause.hint : "";
    return [cause.message, details, hint].filter(Boolean).join(" ");
  }
  return fallback;
}

function throwQueryError(queries: Array<{ name: string; error: { message: string } | null }>) {
  const failed = queries.find((query) => query.error !== null);
  if (failed?.error) throw new Error(`Could not load ${failed.name}: ${failed.error.message}`);
}

function toneOf(value: string) {
  const v = value.toLowerCase();
  if (["approved", "verified", "published", "active", "delivered", "paid", "succeeded"].includes(v)) return "green";
  if (["rejected", "cancelled", "failed", "suspended"].includes(v)) return "red";
  if (["submitted", "in_review", "pending", "renewal_review", "changes_requested", "onboarding", "processing"].includes(v)) return "amber";
  if (["confirmed", "preparing", "ready", "rider_assigned", "out_for_delivery"].includes(v)) return "blue";
  return "gray";
}

function StatusChip({ value, neutral = false }: { value: string; neutral?: boolean }) {
  return <span className={`chip chip-${neutral ? "gray" : toneOf(value)}`}>{sentence(value)}</span>;
}

function titleOf(kind: Kind, row: Row) {
  return kind === "orders" ? `Order #${row.order_number ?? ""}` : String(row.display_name ?? "Untitled");
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return <MessagePage title="Connect Supabase" message="Copy .env.example to .env.local and add your Supabase URL and public anon key." />;
  }
  if (!authReady) return <MessagePage busy title="Loading admin portal" message="Checking your sign-in session…" />;
  if (!session) return <SignIn />;
  return <AdminGate session={session} />;
}

function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className={`wordmark wordmark-${size}`} aria-label="AquaDirect">
      <span className="wm-aqua">Aqua</span>
      <span className="wm-direct">Direct</span>
    </span>
  );
}

function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className="brand">
      <Wordmark size={size} />
      <span className="brand-tag">Admin</span>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError(null);
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <Brand size="lg" />
        <h1>Sign in to the admin console</h1>
        <p>Access is checked against your Supabase permissions after you sign in.</p>
        {error && <div className="alert alert-error" role="alert"><AlertCircle size={16} />{error}</div>}
        <label>Email address
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@aquadirect.com" />
        </label>
        <label>Password
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </label>
        <button className="button button-primary button-wide" type="submit" disabled={busy}>
          {busy ? <span className="spinner spinner-light" /> : null}
          {busy ? "Signing in…" : "Sign in"}
          {!busy && <ArrowRight size={16} />}
        </button>
        <small className="secure-note"><ShieldCheck size={14} /> Restricted to authorized administrators.</small>
      </form>
    </main>
  );
}

function AdminGate({ session }: { session: Session }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function verifyAdmin() {
      if (!supabase) return;
      const { data, error: permissionError } = await supabase.rpc("has_permission", {
        required_permission: "admin.access",
      });
      if (!active) return;
      if (permissionError) {
        setError(permissionError.message);
        setAuthorized(false);
      } else {
        setAuthorized(data === true);
      }
    }
    void verifyAdmin();
    return () => {
      active = false;
    };
  }, [session.user.id]);

  if (authorized === null) return <MessagePage busy title="Verifying access" message="Checking admin.access permission…" />;
  if (!authorized) {
    return (
      <MessagePage
        title="Admin access required"
        message={error ?? "This account does not have the admin.access permission. Ask a project administrator to grant the appropriate role."}
        action={<button className="button button-secondary" type="button" onClick={() => void supabase?.auth.signOut()}><LogOut size={15} /> Sign out</button>}
      />
    );
  }
  return <Dashboard userEmail={session.user.email ?? "Administrator"} />;
}

function Dashboard({ userEmail }: { userEmail: string }) {
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [perms, setPerms] = useState<Permissions>({ review: false, publish: false, suspend: false });
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [ownersLoaded, setOwnersLoaded] = useState(false);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [adminsLoaded, setAdminsLoaded] = useState(false);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminGrantEmail, setAdminGrantEmail] = useState("");
  const [adminGrantBusy, setAdminGrantBusy] = useState(false);
  const [adminGrantResult, setAdminGrantResult] = useState<ActionResult | null>(null);
  const realtimeRefreshRef = useRef<() => void>(() => {});
  const sectionRef = useRef(section);
  sectionRef.current = section;

  async function load(refresh = false): Promise<DashboardData | null> {
    if (!supabase) return null;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const [
        applications,
        stations,
        orders,
        applicationCount,
        stationCount,
        orderCount,
        submittedCount,
        inReviewCount,
        publishedCount,
      ] = await Promise.all([
        supabase.from("station_applications")
          .select("id, display_name, legal_business_name, phone, email, address_line, barangay, city, province, application_status, verification_status, submitted_at, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("stations")
          .select("id, application_id, display_name, phone, email, address_line, barangay, city, province, region, postal_code, verification_status, publication_status, operational_status, service_radius_km, default_delivery_fee, minimum_order_amount, rating_average, rating_count, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("orders")
          .select("id, order_number, status, payment_method, subtotal, delivery_fee, total, customer_notes, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("station_applications").select("id", { count: "exact", head: true }),
        supabase.from("stations").select("id", { count: "exact", head: true }),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("station_applications").select("id", { count: "exact", head: true }).eq("application_status", "submitted"),
        supabase.from("station_applications").select("id", { count: "exact", head: true }).eq("application_status", "in_review"),
        supabase.from("stations").select("id", { count: "exact", head: true }).eq("publication_status", "published"),
      ]);
      throwQueryError([
        { name: "station applications", error: applications.error },
        { name: "stations", error: stations.error },
        { name: "orders", error: orders.error },
        { name: "application count", error: applicationCount.error },
        { name: "station count", error: stationCount.error },
        { name: "order count", error: orderCount.error },
        { name: "submitted application count", error: submittedCount.error },
        { name: "in-review application count", error: inReviewCount.error },
        { name: "published station count", error: publishedCount.error },
      ]);

      const reviewPermission = await supabase.rpc("has_permission", { required_permission: "station.review" });
      if (reviewPermission.error) throw new Error(`Could not check station.review permission: ${reviewPermission.error.message}`);
      let renewalApplicationIds: string[] = [];
      if (reviewPermission.data === true) {
        const pendingPermitRenewals = await supabase.from("station_documents")
          .select("application_id")
          .eq("document_type", "business_permit")
          .eq("is_current", true)
          .eq("review_status", "pending");
        if (pendingPermitRenewals.error) {
          throw new Error(`Could not load pending business permit renewals: ${pendingPermitRenewals.error.message}`);
        }
        renewalApplicationIds = [...new Set(
          (pendingPermitRenewals.data ?? []).map((document) => document.application_id),
        )];
      }
      const loadedApplications = applications.data ?? [];
      const missingRenewalApplicationIds = renewalApplicationIds.filter(
        (id) => !loadedApplications.some((application) => application.id === id),
      );
      const additionalRenewalApplications = missingRenewalApplicationIds.length > 0
        ? await supabase.from("station_applications")
          .select("id, display_name, legal_business_name, phone, email, address_line, barangay, city, province, application_status, verification_status, submitted_at, created_at")
          .in("id", missingRenewalApplicationIds)
        : { data: [], error: null };
      if (additionalRenewalApplications.error) {
        throw new Error(`Could not load applications with permit renewals: ${additionalRenewalApplications.error.message}`);
      }
      const applicationRows = [
        ...loadedApplications,
        ...(additionalRenewalApplications.data ?? []).filter(
          (application) => application.application_status === "approved",
        ),
      ];
      const approvedRenewalIds = new Set(
        applicationRows
          .filter((application) =>
            application.application_status === "approved"
            && renewalApplicationIds.includes(application.id),
          )
          .map((application) => application.id),
      );
      const adminApplicationRows = applicationRows
        .map((application) => ({
          ...application,
          permit_renewal: approvedRenewalIds.has(application.id) ? "Review needed" : null,
        }))
        .sort((a, b) => Number(approvedRenewalIds.has(b.id)) - Number(approvedRenewalIds.has(a.id)));

      const [customerPermission, reviewModerationPermission] = await Promise.all([
        supabase.rpc("has_permission", { required_permission: "customer.read" }),
        supabase.rpc("has_permission", { required_permission: "reviews.moderate" }),
      ]);
      if (customerPermission.error) throw new Error(`Could not check customer.read permission: ${customerPermission.error.message}`);
      if (reviewModerationPermission.error) throw new Error(`Could not check reviews.moderate permission: ${reviewModerationPermission.error.message}`);

      const todayKey = manilaDateKey(new Date());
      const startDate = addDays(new Date(`${todayKey}T00:00:00Z`), -29);
      const endDate = addDays(new Date(`${todayKey}T00:00:00Z`), 1);
      const rangeStart = `${startDate.toISOString().slice(0, 10)}T00:00:00+08:00`;
      const rangeEnd = `${endDate.toISOString().slice(0, 10)}T00:00:00+08:00`;
      const currentMonthKey = `${todayKey.slice(0, 7)}-01`;
      const currentMonthStart = new Date(`${currentMonthKey}T00:00:00Z`);
      const previousMonthStart = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 1, 1));
      const nextMonthStart = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() + 1, 1));
      const monthlyRangeStart = `${previousMonthStart.toISOString().slice(0, 10)}T00:00:00+08:00`;
      const monthlyRangeEnd = `${nextMonthStart.toISOString().slice(0, 10)}T00:00:00+08:00`;
      // Enough history for a 90-day selection plus its previous comparison period.
      const analyticsStartDate = addDays(new Date(`${todayKey}T00:00:00Z`), -179);
      const analyticsRangeStart = `${analyticsStartDate.toISOString().slice(0, 10)}T00:00:00+08:00`;
      const analyticsRangeEnd = rangeEnd;
      const [customerCount, platformOrders, paidPayments, monthlyPayments, analyticsOrdersResult, analyticsPaymentsResult, analyticsStationsResult, allStationRatings, ratingReviews] = await Promise.all([
        customerPermission.data === true
          ? supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "customer")
          : Promise.resolve({ count: null, error: null }),
        supabase.from("orders")
          .select("id, status, created_at")
          .gte("created_at", rangeStart)
          .lt("created_at", rangeEnd)
          .order("created_at", { ascending: true }),
        supabase.from("payments")
          .select("order_id, status, amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", rangeStart)
          .lt("paid_at", rangeEnd)
          .order("paid_at", { ascending: true }),
        supabase.from("payments")
          .select("order_id, status, amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", monthlyRangeStart)
          .lt("paid_at", monthlyRangeEnd)
          .order("paid_at", { ascending: true }),
        supabase.from("orders")
          .select("id, status, created_at, station_id")
          .gte("created_at", analyticsRangeStart)
          .lt("created_at", analyticsRangeEnd)
          .order("created_at", { ascending: true }),
        supabase.from("payments")
          .select("order_id, amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", analyticsRangeStart)
          .lt("paid_at", analyticsRangeEnd)
          .order("paid_at", { ascending: true }),
        supabase.from("stations")
          .select("id, display_name, city, province, logo_path, publication_status"),
        supabase.from("stations")
          .select("id, display_name, logo_path, rating_average, rating_count")
          .gt("rating_count", 0)
          .order("rating_count", { ascending: false }),
        reviewPermission.data === true
          ? supabase.from("station_reviews").select("rating").eq("is_visible", true)
          : Promise.resolve({ data: [], error: null }),
      ]);
      throwQueryError([
        { name: "recent orders", error: platformOrders.error },
        { name: "paid payments", error: paidPayments.error },
        { name: "monthly paid payments", error: monthlyPayments.error },
        { name: "analytics orders", error: analyticsOrdersResult.error },
        { name: "analytics paid payments", error: analyticsPaymentsResult.error },
        { name: "analytics stations", error: analyticsStationsResult.error },
        { name: "station ratings", error: allStationRatings.error },
        { name: "review distribution", error: ratingReviews.error },
      ]);

      const pageSize = 1000;
      const orderRows = [...(platformOrders.data ?? [])];
      while (orderRows.length === pageSize) {
        const offset = orderRows.length;
        const { data: page, error } = await supabase.from("orders")
          .select("id, status, created_at")
          .gte("created_at", rangeStart)
          .lt("created_at", rangeEnd)
          .order("created_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        orderRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const analyticsOrderRows = [...(analyticsOrdersResult.data ?? [])];
      while (analyticsOrderRows.length === pageSize) {
        const offset = analyticsOrderRows.length;
        const { data: page, error } = await supabase.from("orders")
          .select("id, status, created_at, station_id")
          .gte("created_at", analyticsRangeStart)
          .lt("created_at", analyticsRangeEnd)
          .order("created_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        analyticsOrderRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const analyticsPaymentRows = [...(analyticsPaymentsResult.data ?? [])];
      while (analyticsPaymentRows.length === pageSize) {
        const offset = analyticsPaymentRows.length;
        const { data: page, error } = await supabase.from("payments")
          .select("order_id, amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", analyticsRangeStart)
          .lt("paid_at", analyticsRangeEnd)
          .order("paid_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        analyticsPaymentRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const analyticsStationRows = [...(analyticsStationsResult.data ?? [])];
      while (analyticsStationRows.length === pageSize) {
        const offset = analyticsStationRows.length;
        const { data: page, error } = await supabase.from("stations")
          .select("id, display_name, city, province, logo_path, publication_status")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        analyticsStationRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const paymentRows = [...(paidPayments.data ?? [])];
      while (paymentRows.length === pageSize) {
        const offset = paymentRows.length;
        const { data: page, error } = await supabase.from("payments")
          .select("order_id, status, amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", rangeStart)
          .lt("paid_at", rangeEnd)
          .order("paid_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        paymentRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const stationRatingRows = [...(allStationRatings.data ?? [])];
      while (stationRatingRows.length === pageSize) {
        const offset = stationRatingRows.length;
        const { data: page, error } = await supabase.from("stations")
          .select("id, display_name, logo_path, rating_average, rating_count")
          .gt("rating_count", 0)
          .order("rating_count", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        stationRatingRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const ratingRows = [...(ratingReviews.data ?? [])];
      if (reviewPermission.data === true) {
        while (ratingRows.length === pageSize) {
          const offset = ratingRows.length;
          const { data: page, error } = await supabase.from("station_reviews")
            .select("rating")
            .eq("is_visible", true)
            .range(offset, offset + pageSize - 1);
          if (error) throw error;
          ratingRows.push(...(page ?? []));
          if ((page ?? []).length < pageSize) break;
        }
      }

      const paymentOrders = new Set<string>();
      let paidSalesLast30Days = 0;
      for (const payment of paymentRows) {
        if (!paymentOrders.has(payment.order_id)) {
          paymentOrders.add(payment.order_id);
          paidSalesLast30Days += Number(payment.amount);
        }
      }

      // Build current/previous calendar-month station sales from paid payments.
      // Sales are attributed through orders.station_id and grouped by payment month (Manila time).
      const monthlyPaymentRows = [...(monthlyPayments.data ?? [])];
      while (monthlyPaymentRows.length === pageSize) {
        const offset = monthlyPaymentRows.length;
        const { data: page, error } = await supabase.from("payments")
          .select("order_id, status, amount, paid_at")
          .eq("status", "paid")
          .gte("paid_at", monthlyRangeStart)
          .lt("paid_at", monthlyRangeEnd)
          .order("paid_at", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        monthlyPaymentRows.push(...(page ?? []));
        if ((page ?? []).length < pageSize) break;
      }
      const monthlyOrderIds = [...new Set(monthlyPaymentRows.map((payment) => payment.order_id).filter(Boolean))];
      const monthlyOrderStation = new Map<string, string>();
      for (let offset = 0; offset < monthlyOrderIds.length; offset += 500) {
        const ids = monthlyOrderIds.slice(offset, offset + 500);
        const { data: orderPage, error } = await supabase.from("orders")
          .select("id, station_id")
          .in("id", ids);
        if (error) throw new Error(`Could not load station sales orders: ${error.message}`);
        for (const order of orderPage ?? []) {
          if (order.station_id) monthlyOrderStation.set(order.id, order.station_id);
        }
      }
      const { data: salesStationRows, error: salesStationsError } = await supabase.from("stations")
        .select("id, display_name, city, province, logo_path");
      if (salesStationsError) throw new Error(`Could not load stations for sales analytics: ${salesStationsError.message}`);
      const salesStationsById = new Map((salesStationRows ?? []).map((station) => [station.id, station]));
      const monthlySalesByStation = new Map<string, { station_id: string; display_name: string; city: string | null; province: string | null; logo_path: string | null; month: string; sales: number; orders: Set<string> }>();
      const seenMonthlyPayments = new Set<string>();
      for (const payment of monthlyPaymentRows) {
        const orderId = String(payment.order_id ?? "");
        const stationId = monthlyOrderStation.get(orderId);
        if (!stationId || !payment.paid_at || !orderId) continue;
        const month = manilaDateKey(payment.paid_at).slice(0, 7);
        const paymentKey = `${orderId}:${month}`;
        if (seenMonthlyPayments.has(paymentKey)) continue;
        seenMonthlyPayments.add(paymentKey);
        const station = salesStationsById.get(stationId);
        if (!station) continue;
        const key = `${stationId}:${month}`;
        const aggregate = monthlySalesByStation.get(key) ?? {
          station_id: stationId,
          display_name: station.display_name,
          city: station.city ?? null,
          province: station.province ?? null,
          logo_path: station.logo_path ?? null,
          month,
          sales: 0,
          orders: new Set<string>(),
        };
        aggregate.sales += Number(payment.amount) || 0;
        aggregate.orders.add(orderId);
        monthlySalesByStation.set(key, aggregate);
      }
      const monthlyStationSales = [...monthlySalesByStation.values()].map((item) => ({
        station_id: item.station_id,
        display_name: item.display_name,
        city: item.city,
        province: item.province,
        logo_path: item.logo_path,
        month: item.month,
        sales: item.sales,
        orders: item.orders.size,
      }));

      const stationRows = stations.data ?? [];
      const applicationIds = stationRows
        .map((station) => station.application_id)
        .filter((id): id is string => typeof id === "string");
      const applicationAddresses = applicationIds.length > 0
        ? await supabase.from("station_applications")
          .select("id, address_line, barangay, city, province, region, postal_code")
          .in("id", applicationIds)
        : { data: [], error: null };
      if (applicationAddresses.error) throw new Error(`Could not load station addresses: ${applicationAddresses.error.message}`);
      const addressesByApplicationId = new Map(
        (applicationAddresses.data ?? []).map((address) => [address.id, address]),
      );
      const next: DashboardData = {
        applications: adminApplicationRows as Row[],
        stations: stationRows.map((station) => {
          const address = addressesByApplicationId.get(station.application_id);
          return {
            ...station,
            address_line: address?.address_line ?? station.address_line,
            barangay: address?.barangay ?? station.barangay,
            city: address?.city ?? station.city,
            province: address?.province ?? station.province,
            region: address?.region ?? station.region,
            postal_code: address?.postal_code ?? station.postal_code,
          };
        }) as Row[],
        orders: (orders.data ?? []) as Row[],
        customers: [],
        stationOwners: [],
        adminAccounts: [],
        canViewCustomers: customerPermission.data === true,
        canViewAccountEmails: false,
        canManageAdmins: false,
        totalApplications: applicationCount.count ?? 0,
        totalStations: stationCount.count ?? 0,
        totalOrders: orderCount.count ?? 0,
        pendingApplications: (submittedCount.count ?? 0) + (inReviewCount.count ?? 0),
        publishedStations: publishedCount.count ?? 0,
        totalCustomers: customerPermission.data === true && !customerCount.error ? customerCount.count ?? 0 : null,
        ordersLast30Days: orderRows as DashboardData["ordersLast30Days"],
        analyticsOrders: analyticsOrderRows as DashboardData["analyticsOrders"],
        analyticsPaidPayments: analyticsPaymentRows as DashboardData["analyticsPaidPayments"],
        analyticsStations: analyticsStationRows as DashboardData["analyticsStations"],
        paidSalesLast30Days,
        paidOrdersLast30Days: paymentOrders.size,
        monthlyStationSales,
        ratingAverage: (() => {
          const ratedStations = stationRatingRows;
          const totalRatings = ratedStations.reduce((total, station) => total + Number(station.rating_count), 0);
          if (totalRatings === 0) return null;
          const weightedRating = ratedStations.reduce(
            (total, station) => total + Number(station.rating_average) * Number(station.rating_count),
            0,
          );
          return weightedRating / totalRatings;
        })(),
        ratingCount: stationRatingRows.reduce(
          (total, station) => total + Number(station.rating_count),
          0,
        ),
        stationRatings: (stationRatingRows as DashboardData["stationRatings"])
          .sort((left, right) => right.rating_count - left.rating_count || right.rating_average - left.rating_average),
        ratingDistribution: ratingRows.reduce((distribution, review) => {
          const rating = Number(review.rating);
          if (rating >= 1 && rating <= 5) distribution[rating - 1] += 1;
          return distribution;
        }, [0, 0, 0, 0, 0]),
        canViewReviewDistribution: reviewModerationPermission.data === true,
      };
      setData(next);
      setUpdatedAt(new Date());
      return next;
    } catch (cause) {
      setLoadError(errorMessage(cause, "Dashboard data could not be loaded."));
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadAccountRole(role: "customer" | "station_owner" | "admin"): Promise<Row[]> {
    const client = supabase;
    if (!client) return [];
    const pageSize = 1000;
    const firstPage = await client.from("user_roles")
      .select("user_id")
      .eq("role", role)
      .order("user_id", { ascending: true })
      .range(0, pageSize - 1);
    if (firstPage.error) throw firstPage.error;
    const roleRows = [...(firstPage.data ?? [])];
    while (roleRows.length === pageSize) {
      const offset = roleRows.length;
      const { data: page, error } = await client.from("user_roles")
        .select("user_id")
        .eq("role", role)
        .order("user_id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      roleRows.push(...(page ?? []));
      if ((page ?? []).length < pageSize) break;
    }

    const profiles: Row[] = [];
    for (let offset = 0; offset < roleRows.length; offset += 500) {
      const { data: page, error } = await client.from("profiles")
        .select("id, full_name, status, created_at")
        .in("id", roleRows.slice(offset, offset + 500).map((row) => row.user_id));
      if (error) throw error;
      profiles.push(...(page ?? []) as Row[]);
    }
    return profiles.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
  }

  async function loadAccounts(accountType: "customers" | "stationOwners") {
    if (!supabase) return;
    const isCustomers = accountType === "customers";
    if (isCustomers) setCustomersLoading(true);
    else setOwnersLoading(true);
    setLoadError(null);
    try {
      const permission = await supabase.rpc("has_permission", { required_permission: "customer.read" });
      if (permission.error) throw permission.error;
      if (permission.data !== true) {
        setData((current) => current ? { ...current, canViewCustomers: false } : current);
        if (isCustomers) setCustomersLoaded(true);
        else setOwnersLoaded(true);
        return;
      }
      const emailPermission = await supabase.rpc("has_permission", { required_permission: "customer.email.view" });
      if (emailPermission.error) throw emailPermission.error;

      const profiles = isCustomers
        ? await Promise.all([
            loadAccountRole("customer"),
            loadAccountRole("station_owner"),
            loadAccountRole("admin"),
          ])
          .then(([customerRows, ownerRows, adminRows]) => {
            const excludedIds = new Set([...ownerRows, ...adminRows].map((row) => row.id));
            return customerRows.filter((row) => !excludedIds.has(row.id));
          })
        : await loadAccountRole("station_owner");
      const emailByUserId = new Map<string, string>();
      if (emailPermission.data === true) {
        for (let offset = 0; offset < profiles.length; offset += 500) {
          const ids = profiles.slice(offset, offset + 500).map((profile) => String(profile.id));
          const { data: emails, error } = await supabase.from("support_customer_emails")
            .select("user_id, email")
            .in("user_id", ids);
          if (error) throw error;
          for (const account of emails ?? []) emailByUserId.set(account.user_id, account.email);
        }
      }
      const profilesWithEmail = profiles.map((profile) => ({
        ...profile,
        email: emailByUserId.get(String(profile.id)) ?? null,
      }));
      setData((current) => current ? {
        ...current,
        [accountType]: profilesWithEmail,
        canViewCustomers: true,
        canViewAccountEmails: emailPermission.data === true,
      } : current);
      if (isCustomers) setCustomersLoaded(true);
      else setOwnersLoaded(true);
    } catch (cause) {
      setLoadError(errorMessage(cause, `${isCustomers ? "Customer accounts" : "Station owner accounts"} could not be loaded.`));
    } finally {
      if (isCustomers) setCustomersLoading(false);
      else setOwnersLoading(false);
    }
  }

  async function loadAdminAccounts() {
    if (!supabase) return;
    setAdminsLoading(true);
    setLoadError(null);
    setAdminGrantResult(null);
    try {
      const [managePermission, emailPermission] = await Promise.all([
        supabase.rpc("has_permission", { required_permission: "roles.manage" }),
        supabase.rpc("has_permission", { required_permission: "customer.email.view" }),
      ]);
      if (managePermission.error) throw managePermission.error;
      if (emailPermission.error) throw emailPermission.error;
      if (managePermission.data !== true) {
        setData((current) => current ? { ...current, canManageAdmins: false } : current);
        setAdminsLoaded(true);
        return;
      }
      let profiles = await loadAccountRole("admin");
      const emailByUserId = new Map<string, string>();
      if (emailPermission.data === true) {
        for (let offset = 0; offset < profiles.length; offset += 500) {
          const ids = profiles.slice(offset, offset + 500).map((profile) => String(profile.id));
          const { data: emails, error } = await supabase.from("support_customer_emails")
            .select("user_id, email")
            .in("user_id", ids);
          if (error) throw error;
          for (const account of emails ?? []) emailByUserId.set(account.user_id, account.email);
        }
      }
      profiles = profiles.map((profile) => ({
        ...profile,
        email: emailByUserId.get(String(profile.id)) ?? null,
      }));
      setData((current) => current ? {
        ...current,
        adminAccounts: profiles,
        canManageAdmins: true,
        canViewAccountEmails: emailPermission.data === true,
      } : current);
      setAdminsLoaded(true);
    } catch (cause) {
      setLoadError(errorMessage(cause, "Admin accounts could not be loaded."));
    } finally {
      setAdminsLoading(false);
    }
  }

  realtimeRefreshRef.current = () => {
    void (async () => {
      await load(true);
      if (sectionRef.current === "customers") await loadAccounts("customers");
      if (sectionRef.current === "stationOwners") await loadAccounts("stationOwners");
      if (sectionRef.current === "adminAccounts") await loadAdminAccounts();
    })();
  };

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setRealtimeStatus("offline");
      return;
    }
    let refreshTimer: number | undefined;
    const tables = ["orders", "station_applications", "stations", "payments", "station_reviews", "user_roles"];
    let channel = client.channel("admin-portal-live-updates");
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => realtimeRefreshRef.current(), 500);
        },
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setRealtimeStatus("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeStatus("offline");
    });
    return () => {
      window.clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, []);

  async function grantAdminAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !data?.canManageAdmins) return;
    const email = adminGrantEmail.trim();
    if (!email) return;
    setAdminGrantBusy(true);
    setAdminGrantResult(null);
    const { error } = await supabase.rpc("grant_admin_by_email", { p_email: email });
    setAdminGrantBusy(false);
    if (error) {
      setAdminGrantResult({ kind: "error", text: error.message });
      return;
    }
    setAdminGrantEmail("");
    setAdminGrantResult({ kind: "success", text: `Admin access granted to ${email}.` });
    setAdminsLoaded(false);
    await loadAdminAccounts();
  }

  useEffect(() => {
    if (section === "customers" && data && !customersLoaded) void loadAccounts("customers");
    if (section === "stationOwners" && data && !ownersLoaded) void loadAccounts("stationOwners");
    if (section === "adminAccounts" && data && !adminsLoaded) void loadAdminAccounts();
  }, [section, data, customersLoaded, ownersLoaded, adminsLoaded]);

  useEffect(() => {
    let active = true;
    async function loadPermissions() {
      const client = supabase;
      if (!client) return;
      const [review, publish, suspend] = await Promise.all(
        ["station.review", "station.publish", "station.suspend"].map((key) =>
          client.rpc("has_permission", { required_permission: key }),
        ),
      );
      if (active) {
        setPerms({ review: review.data === true, publish: publish.data === true, suspend: suspend.data === true });
      }
    }
    void loadPermissions();
    return () => {
      active = false;
    };
  }, []);

  async function afterAction() {
    const fresh = await load(true);
    setSelected((current) => {
      if (!current || !fresh) return current;
      const next = fresh[current.kind].find((row) => row.id === current.row.id);
      return next ? { kind: current.kind, row: next } : current;
    });
  }

  const pending = data?.pendingApplications ?? 0;
  const copy = pageCopy[section];

  return (
    <div className="console">
      <header className="topnav">
        <Brand />
        <nav className="tabs" aria-label="Admin navigation">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              className={`tab ${section === id ? "tab-active" : ""}`}
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={16} />{label}
              {id === "applications" && pending > 0 && <span className="tab-badge">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="account">
          <span className="access-chip" title="admin.access verified"><ShieldCheck size={14} /> Admin access</span>
          <span className="avatar" aria-hidden="true">{userEmail.slice(0, 1).toUpperCase()}</span>
          <span className="account-email">{userEmail}</span>
          <button className="icon-button" type="button" aria-label="Sign out" onClick={() => void supabase?.auth.signOut()}><LogOut size={16} /></button>
        </div>
      </header>

      <main className="workspace">
        <div className="page-head">
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className="page-tools">
            <span className={`realtime-status realtime-${realtimeStatus}`} role="status" aria-live="polite">
              <i aria-hidden="true" />
              {realtimeStatus === "live" ? "Live updates" : realtimeStatus === "connecting" ? "Connecting…" : "Offline"}
            </span>
            {updatedAt && <span className="updated">Updated {updatedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span>}
            <button className="button button-secondary" type="button" disabled={refreshing || loading || customersLoading || ownersLoading || adminsLoading} onClick={() => section === "customers" ? void loadAccounts("customers") : section === "stationOwners" ? void loadAccounts("stationOwners") : section === "adminAccounts" ? void loadAdminAccounts() : void load(true)}>
              <RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {loadError && (
          <div className="alert alert-error" role="alert">
            <AlertCircle size={16} />
            <span>{loadError}</span>
            <button className="text-button" type="button" onClick={() => section === "customers" ? void loadAccounts("customers") : section === "stationOwners" ? void loadAccounts("stationOwners") : section === "adminAccounts" ? void loadAdminAccounts() : void load(true)}>Retry</button>
          </div>
        )}
        {!loading && section === "applications" && !perms.review && (
          <div className="alert alert-error" role="alert">
            <AlertCircle size={16} />
            <span>Your account can open the admin portal but lacks the <code>station.review</code> permission needed to review applications.</span>
          </div>
        )}

          {loading ? <Skeleton /> : data ? (
          <div className="view" key={section}>
            {section === "overview" && (
              <>
                <div className="kpis">
                  <Kpi accent label="To review" value={pending} detail="In the queue" />
                  <Kpi label="Live stations" value={data.publishedStations} detail={`of ${data.totalStations} registered`} />
                  <Kpi label="Applications" value={data.totalApplications} detail="All time" />
                  <Kpi label="Orders" value={data.totalOrders} detail="In your view" />
                </div>
                <PlatformAnalytics data={data} />
                <div className="overview-grid">
                  <ReviewQueue
                    rows={data.applications}
                    onSelect={(row) => setSelected({ kind: "applications", row })}
                    onViewAll={() => setSection("applications")}
                  />
                  <RecentOrders
                    rows={data.orders.slice(0, 6)}
                    onSelect={(row) => setSelected({ kind: "orders", row })}
                    onViewAll={() => setSection("orders")}
                  />
                </div>
              </>
            )}
            {section === "applications" && <DataTable kind="applications" rows={data.applications} selectedId={selected?.row.id} onSelect={(row) => setSelected({ kind: "applications", row })} />}
            {section === "stations" && <DataTable kind="stations" rows={data.stations} selectedId={selected?.row.id} onSelect={(row) => setSelected({ kind: "stations", row })} />}
            {section === "orders" && <DataTable kind="orders" rows={data.orders} selectedId={selected?.row.id} onSelect={(row) => setSelected({ kind: "orders", row })} />}
            {section === "customers" && (
              !data.canViewCustomers ? (
                <div className="alert alert-error" role="alert"><AlertCircle size={16} />Account lists require the customer.read permission.</div>
              ) : customersLoading ? (
                <div className="panel analytics-empty"><span className="spinner" /> Loading customer accounts…</div>
              ) : (
                <DataTable kind="customers" rows={data.customers} selectedId={undefined} includeAccountEmail={data.canViewAccountEmails} />
              )
            )}
            {section === "stationOwners" && (
              !data.canViewCustomers ? (
                <div className="alert alert-error" role="alert"><AlertCircle size={16} />Account lists require the customer.read permission.</div>
              ) : ownersLoading ? (
                <div className="panel analytics-empty"><span className="spinner" /> Loading station owner accounts…</div>
              ) : (
                <DataTable kind="stationOwners" rows={data.stationOwners} selectedId={undefined} includeAccountEmail={data.canViewAccountEmails} />
              )
            )}
            {section === "adminAccounts" && (
              adminsLoading ? (
                <div className="panel analytics-empty"><span className="spinner" /> Loading admin accounts…</div>
              ) : !data.canManageAdmins ? (
                <div className="alert alert-error" role="alert"><AlertCircle size={16} />Admin accounts require the roles.manage permission.</div>
              ) : (
                <section className="admin-account-management">
                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Grant admin access</h2>
                        <p>Enter the email of an existing, confirmed AquaDirect account.</p>
                      </div>
                    </div>
                    <form className="admin-grant-form" onSubmit={(event) => void grantAdminAccess(event)}>
                      <label htmlFor="admin-grant-email">Account email</label>
                      <div className="admin-grant-controls">
                        <input
                          id="admin-grant-email"
                          type="email"
                          autoComplete="email"
                          required
                          value={adminGrantEmail}
                          onChange={(event) => setAdminGrantEmail(event.target.value)}
                          placeholder="name@gmail.com"
                        />
                        <button className="button button-primary" type="submit" disabled={adminGrantBusy}>
                          {adminGrantBusy ? <span className="spinner spinner-light" /> : <ShieldCheck size={15} />}
                          {adminGrantBusy ? "Granting access…" : "Grant admin access"}
                        </button>
                      </div>
                      <p className="admin-grant-note">This grants the full admin role. The account must already exist and have a confirmed email address. The change is recorded in the admin audit log.</p>
                      {adminGrantResult && (
                        <div className={`result ${adminGrantResult.kind === "success" ? "result-success" : "result-error"}`} role="status">
                          {adminGrantResult.kind === "success" ? <Check size={15} /> : <AlertCircle size={15} />}
                          {adminGrantResult.text}
                        </div>
                      )}
                    </form>
                  </div>
                  <DataTable
                    kind="adminAccounts"
                    rows={data.adminAccounts}
                    selectedId={undefined}
                    includeAccountEmail={data.canViewAccountEmails}
                  />
                </section>
              )
            )}
          </div>
        ) : (
          <section className="panel load-failure" role="alert">
            <span className="empty-icon"><AlertCircle size={20} /></span>
            <h2>Admin data could not be loaded</h2>
            <p>{loadError ?? "The portal did not receive dashboard data. Check your connection and try again."}</p>
            <button className="button button-primary" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} /> Try again
            </button>
          </section>
        )}
      </main>

      {selected && <Drawer selection={selected} perms={perms} onChanged={afterAction} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Kpi({ label, value, detail, accent = false }: { label: string; value: number; detail: string; accent?: boolean }) {
  return (
    <div className={`kpi ${accent ? "kpi-accent" : ""}`}>
      <span className="kpi-label">{label}</span>
      <strong>{value.toLocaleString("en-PH")}</strong>
      <small>{detail}</small>
    </div>
  );
}

type PeriodKey = "this-month" | "last-month" | "7" | "30" | "90";
type RankMode = "sales" | "orders";

const periodOptions: Array<{ value: PeriodKey; label: string }> = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

// Must match the lookback used when the dashboard loads analyticsOrders / analyticsPaidPayments.
const ANALYTICS_LOOKBACK_DAYS = 180;

function toDayDate(key: string) {
  return new Date(`${key}T00:00:00Z`);
}

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.round((toDayDate(end).getTime() - toDayDate(start).getTime()) / 86400000);
}

function formatDay(key: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", month: "short", day: "numeric" }).format(toDayDate(key));
}

function formatRange(start: string, end: string) {
  const last = toDayKey(addDays(toDayDate(end), -1));
  return start === last ? formatDay(start) : `${formatDay(start)} – ${formatDay(last)}`;
}

function moneyCompact(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function locationOf(station: { city?: string | null; province?: string | null } | undefined) {
  if (!station) return "Location not set";
  const city = station.city?.trim();
  const province = station.province?.trim();
  return city && province ? `${city}, ${province}` : city || province || "Location not set";
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function statusTone(key: string) {
  if (key === "completed") return "green";
  if (key === "canceled") return "red";
  return toneOf(key);
}

function rangeFor(period: PeriodKey, today: string) {
  const todayDate = toDayDate(today);
  const tomorrow = toDayKey(addDays(todayDate, 1));
  const thisMonthStart = `${today.slice(0, 7)}-01`;
  const monthStartBefore = (monthStart: string) => `${toDayKey(addDays(toDayDate(monthStart), -1)).slice(0, 7)}-01`;

  if (period === "this-month") {
    // Month-to-date is compared with the same number of days from the start of last month.
    const elapsed = daysBetween(thisMonthStart, tomorrow);
    const previousStart = monthStartBefore(thisMonthStart);
    const sameDays = toDayKey(addDays(toDayDate(previousStart), elapsed));
    return { start: thisMonthStart, end: tomorrow, previousStart, previousEnd: sameDays < thisMonthStart ? sameDays : thisMonthStart, label: "This month" };
  }
  if (period === "last-month") {
    const start = monthStartBefore(thisMonthStart);
    return { start, end: thisMonthStart, previousStart: monthStartBefore(start), previousEnd: start, label: "Last month" };
  }
  const days = Number(period);
  const start = toDayKey(addDays(todayDate, -(days - 1)));
  return { start, end: tomorrow, previousStart: toDayKey(addDays(todayDate, -(days * 2 - 1))), previousEnd: start, label: `Last ${days} days` };
}

const formatCount = (value: number) => Math.round(value).toLocaleString("en-PH");

function niceCeil(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

// Monotone cubic interpolation: smooth like a spline but never dips below the data (no fake negative sales).
function smoothPath(points: Array<[number, number]>) {
  const n = points.length;
  if (n === 0) return "";
  const fmt = (value: number) => value.toFixed(2);
  if (n === 1) return `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tangent[i] = k * a * slope[i];
      tangent[i + 1] = k * b * slope[i];
    }
  }
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const third = dx[i] / 3;
    d += ` C${fmt(x0 + third)} ${fmt(y0 + tangent[i] * third)} ${fmt(x1 - third)} ${fmt(y1 - tangent[i + 1] * third)} ${fmt(x1)} ${fmt(y1)}`;
  }
  return d;
}

function useCountUp(target: number, duration = 950) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const value = from + (target - from) * (1 - Math.pow(1 - progress, 3));
      fromRef.current = value;
      setDisplay(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return display;
}

function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}

function ChangeBadge({ change, onDark = false, title }: { change: number | null; onDark?: boolean; title?: string }) {
  const tone = change === null ? "neutral" : change > 0.05 ? "up" : change < -0.05 ? "down" : "neutral";
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
  const label = change === null ? "New" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  return <span className={`analytics-change analytics-change-${tone}${onDark ? " on-dark" : ""}`} title={title}><Icon size={12} aria-hidden="true" />{label}</span>;
}

function useNarrowScreen(maxWidth = 680) {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

const PREVIEW_ROWS = 5;
const PREVIEW_RATINGS = 3;
type ListDrawerKind = "top" | "quiet" | "ratings";

function ListDrawer({ title, subtitle, total, shown, query, onQuery, onClose, toolbar, children }: {
  title: string; subtitle: string; total: number; shown: number; query: string;
  onQuery: (value: string) => void; onClose: () => void; toolbar?: ReactNode; children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); opener?.focus?.(); };
  }, []);
  return createPortal(
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer list-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div><span className="drawer-kind">{subtitle}</span><h2>{title}</h2></div>
          <button ref={closeRef} className="icon-button" type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={17} /></button>
        </header>
        <div className="list-drawer-tools">
          <label className="search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by station or location" aria-label="Search stations" />
          </label>
          {toolbar}
          <span className="list-drawer-count">{shown === total ? `${total} station${total === 1 ? "" : "s"}` : `${shown} of ${total} stations`}</span>
        </div>
        <div className="list-drawer-body">
          {shown === 0 ? <div className="analytics-empty">No stations match “{query.trim()}”.</div> : children}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

type TrendDay = { key: string; label: string; sales: number; previousSales: number };

function SalesTrendChart({ trend, hasPrevious, summary }: { trend: TrendDay[]; hasPrevious: boolean; summary: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const narrow = useNarrowScreen();
  const count = trend.length;
  const yMax = niceCeil(Math.max(...trend.map((day) => Math.max(day.sales, day.previousSales)), 0));
  const W = 1000;
  const H = 300;
  const xAt = (index: number) => (count === 1 ? W / 2 : (index / (count - 1)) * W);
  const xPercent = (index: number) => (count === 1 ? 50 : (index / (count - 1)) * 100);
  const yAt = (value: number) => H - (value / yMax) * H;
  const pointsOf = (pick: (day: TrendDay) => number): Array<[number, number]> =>
    count === 1 ? [[0, yAt(pick(trend[0]))], [W, yAt(pick(trend[0]))]] : trend.map((day, index) => [xAt(index), yAt(pick(day))]);
  const linePath = smoothPath(pointsOf((day) => day.sales));
  const previousPath = hasPrevious ? smoothPath(pointsOf((day) => day.previousSales)) : "";
  const areaPath = `${linePath} L${W} ${H} L0 ${H} Z`;
  const labelSlots = narrow ? 4 : 6;
  const labelIndexes = [...new Set(count <= (narrow ? 4 : 8) ? trend.map((_, index) => index) : Array.from({ length: labelSlots }, (_, step) => Math.round((step * (count - 1)) / (labelSlots - 1))))];

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(count === 1 ? 0 : Math.round(ratio * (count - 1)));
  };
  const active = hover === null ? null : trend[hover];

  return (
    <div className="trend">
      <div className="trend-axis" aria-hidden="true"><span>{moneyCompact(yMax)}</span><span>{moneyCompact(yMax / 2)}</span><span>₱0</span></div>
      <div className="trend-stage">
        <div className="trend-plot" role="img" aria-label={summary} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <div className="trend-grid" aria-hidden="true"><span /><span /><span /></div>
          <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#34d6e6" stopOpacity="0.42" />
                <stop offset="1" stopColor="#34d6e6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {hasPrevious && <path className="trend-prev" d={previousPath} />}
            <path className="trend-area" d={areaPath} fill="url(#trend-fill)" />
            <path className="trend-line" d={linePath} />
          </svg>
          {active && hover !== null && (
            <>
              <span className="trend-cursor" style={{ left: `${xPercent(hover)}%` }} />
              <span className="trend-dot" style={{ left: `${xPercent(hover)}%`, bottom: `${(active.sales / yMax) * 100}%` }} />
              <div className={`trend-tip ${xPercent(hover) > 60 ? "is-left" : ""}`} style={{ left: `${xPercent(hover)}%` }}>
                <small>{active.label}</small>
                <strong>{money(active.sales)}</strong>
                {hasPrevious && <span>Previous: {money(active.previousSales)}</span>}
              </div>
            </>
          )}
        </div>
        <div className="trend-xlabels" aria-hidden="true">
          {labelIndexes.map((index, position) => (
            <span key={trend[index].key} className={position === 0 ? "is-first" : position === labelIndexes.length - 1 ? "is-last" : ""} style={{ left: `${xPercent(index)}%` }}>{trend[index].label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlatformAnalytics({ data }: { data: DashboardData }) {
  const today = manilaDateKey(new Date());
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [leaderboardMode, setLeaderboardMode] = useState<RankMode>("sales");
  const [salesLocation, setSalesLocation] = useState("all");
  const [drawer, setDrawer] = useState<ListDrawerKind | null>(null);
  const [drawerQuery, setDrawerQuery] = useState("");
  const openDrawer = (kind: ListDrawerKind) => { setDrawerQuery(""); setDrawer(kind); };
  const closeDrawer = () => setDrawer(null);

  const locationOptions = useMemo(
    () => [...new Set(data.analyticsStations.map((station) => locationOf(station)))].sort((a, b) => a.localeCompare(b)),
    [data.analyticsStations],
  );

  // One pass over the data. The period AND the location filter apply to every panel, so the
  // KPIs, leaderboard, trend, status mix and quiet list always describe the same set of orders.
  const analytics = useMemo(() => {
    const range = rangeFor(period, today);
    const stationById = new Map(data.analyticsStations.map((station) => [station.id, station]));
    const orderById = new Map(data.analyticsOrders.map((order) => [order.id, order]));
    const matchesLocation = (stationId: string | null) =>
      salesLocation === "all" || (stationId !== null && locationOf(stationById.get(stationId)) === salesLocation);

    const currentOrders: DashboardData["analyticsOrders"] = [];
    const previousOrders: DashboardData["analyticsOrders"] = [];
    const ordersCurrent = new Map<string, number>();
    const ordersPrevious = new Map<string, number>();
    const lastOrderAt = new Map<string, { ms: number; iso: string }>();
    for (const order of data.analyticsOrders) {
      if (order.station_id) {
        const ms = Date.parse(order.created_at);
        const last = lastOrderAt.get(order.station_id);
        if (!Number.isNaN(ms) && (!last || ms > last.ms)) lastOrderAt.set(order.station_id, { ms, iso: order.created_at });
      }
      if (!matchesLocation(order.station_id)) continue;
      const key = manilaDateKey(order.created_at);
      if (key >= range.start && key < range.end) {
        currentOrders.push(order);
        if (order.station_id) ordersCurrent.set(order.station_id, (ordersCurrent.get(order.station_id) ?? 0) + 1);
      } else if (key >= range.previousStart && key < range.previousEnd) {
        previousOrders.push(order);
        if (order.station_id) ordersPrevious.set(order.station_id, (ordersPrevious.get(order.station_id) ?? 0) + 1);
      }
    }

    const salesCurrent = new Map<string, number>();
    const salesPrevious = new Map<string, number>();
    const paidOrdersCurrent = new Set<string>();
    const paidOrdersPrevious = new Set<string>();
    const salesByDay = new Map<string, number>();
    const previousSalesByDay = new Map<string, number>();
    for (const payment of data.analyticsPaidPayments) {
      if (!payment.paid_at) continue;
      const order = orderById.get(payment.order_id);
      if (!order?.station_id || !matchesLocation(order.station_id)) continue;
      const key = manilaDateKey(payment.paid_at);
      const amount = Number(payment.amount) || 0;
      if (key >= range.start && key < range.end) {
        salesCurrent.set(order.station_id, (salesCurrent.get(order.station_id) ?? 0) + amount);
        paidOrdersCurrent.add(order.id);
        salesByDay.set(key, (salesByDay.get(key) ?? 0) + amount);
      } else if (key >= range.previousStart && key < range.previousEnd) {
        salesPrevious.set(order.station_id, (salesPrevious.get(order.station_id) ?? 0) + amount);
        paidOrdersPrevious.add(order.id);
        previousSalesByDay.set(key, (previousSalesByDay.get(key) ?? 0) + amount);
      }
    }
    const sum = (map: Map<string, number>) => [...map.values()].reduce((total, value) => total + value, 0);
    const salesTotal = sum(salesCurrent);
    const previousSalesTotal = sum(salesPrevious);

    const stationIds = new Set<string>([...data.analyticsStations.map((station) => station.id), ...salesCurrent.keys(), ...ordersCurrent.keys()]);
    const stations = [...stationIds]
      .filter((id) => matchesLocation(id))
      .map((id) => ({
        id,
        station: stationById.get(id),
        sales: salesCurrent.get(id) ?? 0,
        previousSales: salesPrevious.get(id) ?? 0,
        orders: ordersCurrent.get(id) ?? 0,
        previousOrders: ordersPrevious.get(id) ?? 0,
      }));

    const trendDays = Math.max(1, daysBetween(range.start, range.end));
    const trend = Array.from({ length: trendDays }, (_, index) => {
      const key = toDayKey(addDays(toDayDate(range.start), index));
      const previousKey = toDayKey(addDays(toDayDate(range.previousStart), index));
      return {
        key,
        label: formatDay(key),
        sales: salesByDay.get(key) ?? 0,
        previousSales: previousKey < range.previousEnd ? previousSalesByDay.get(previousKey) ?? 0 : 0,
      };
    });
    const bestDay = trend.reduce((best, day) => (day.sales > best.sales ? day : best), trend[0]);

    const statusCounts = new Map<string, number>();
    for (const order of currentOrders) {
      const key = (order.status || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_") || "unknown";
      statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }
    const statusEntries = [...statusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: sentence(key), count, share: (count / currentOrders.length) * 100, tone: statusTone(key) }));
    const countOf = (keys: string[]) => statusEntries.filter((entry) => keys.includes(entry.key)).reduce((total, entry) => total + entry.count, 0);
    const completedCount = countOf(["delivered", "completed"]);
    const cancelledCount = countOf(["cancelled", "canceled"]);

    const activeStationIds = new Set(currentOrders.map((order) => order.station_id).filter((id): id is string => Boolean(id)));
    const quietStations = data.analyticsStations
      .filter((station) => station.publication_status === "published" && matchesLocation(station.id) && !activeStationIds.has(station.id))
      .map((station) => ({ station, lastOrder: lastOrderAt.get(station.id) ?? null }))
      .sort((a, b) => (a.lastOrder?.ms ?? -1) - (b.lastOrder?.ms ?? -1) || a.station.display_name.localeCompare(b.station.display_name));

    return {
      range,
      currentOrders,
      previousOrders,
      stations,
      salesTotal,
      previousSalesTotal,
      paidOrderCount: paidOrdersCurrent.size,
      previousPaidOrderCount: paidOrdersPrevious.size,
      trend,
      bestDay,
      statusEntries,
      completedCount,
      cancelledCount,
      activeOrders: currentOrders.length - completedCount - cancelledCount,
      quietStations,
    };
  }, [data.analyticsOrders, data.analyticsPaidPayments, data.analyticsStations, period, salesLocation, today]);

  const {
    range, currentOrders, previousOrders, stations, salesTotal, previousSalesTotal, paidOrderCount, previousPaidOrderCount,
    trend, bestDay, statusEntries, completedCount, cancelledCount, activeOrders, quietStations,
  } = analytics;

  const periodName = range.label.toLowerCase();
  const averageOrder = paidOrderCount > 0 ? salesTotal / paidOrderCount : 0;
  const previousAverageOrder = previousPaidOrderCount > 0 ? previousSalesTotal / previousPaidOrderCount : 0;
  const salesChange = pctChange(salesTotal, previousSalesTotal);
  const ordersChange = pctChange(currentOrders.length, previousOrders.length);
  const averageChange = pctChange(averageOrder, previousAverageOrder);
  const hasPreviousTrend = trend.some((day) => day.previousSales > 0);
  const replayKey = `${period}|${salesLocation}`;

  const salesMode = leaderboardMode === "sales";
  const rankTotal = salesMode ? salesTotal : currentOrders.length;
  const previousRankTotal = salesMode ? previousSalesTotal : previousOrders.length;
  const formatValue = (value: number) => (salesMode ? money(value) : value.toLocaleString("en-PH"));
  const ranked = stations
    .map((item) => {
      const value = salesMode ? item.sales : item.orders;
      const previousValue = salesMode ? item.previousSales : item.previousOrders;
      return { ...item, value, previousValue, change: pctChange(value, previousValue), share: rankTotal > 0 ? (value / rankTotal) * 100 : 0 };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || (a.station?.display_name ?? "").localeCompare(b.station?.display_name ?? ""));
  const rankedWithRank = ranked.map((item, index) => ({ ...item, rank: index + 1 }));
  const maxRankValue = rankedWithRank[0]?.value ?? 0;
  const searchTerm = drawerQuery.trim().toLowerCase();
  const matchesSearch = (name: string, location: string) => !searchTerm || name.toLowerCase().includes(searchTerm) || location.toLowerCase().includes(searchTerm);

  const renderRankRow = (item: (typeof rankedWithRank)[number], index: number) => {
    const name = item.station?.display_name ?? "Station";
    return <li key={item.id} style={{ "--i": Math.min(index, 8) } as CSSProperties}>
      <span className={`lb-rank ${item.rank <= 3 ? "is-top" : ""}`}>{item.rank}</span>
      <StationLogo name={name} path={item.station?.logo_path ?? null} />
      <div className="lb-name">
        <strong title={name}>{name}</strong>
        <small><MapPin size={12} aria-hidden="true" /> {locationOf(item.station)}</small>
      </div>
      <div className="lb-share">
        <span><b>{item.share.toFixed(1)}%</b> of {salesMode ? "sales" : "orders"}</span>
        <span className="station-sales-track"><span style={{ width: `${maxRankValue > 0 ? (item.value / maxRankValue) * 100 : 0}%` }} /></span>
      </div>
      <div className="lb-value">
        <strong>{formatValue(item.value)}</strong>
        <ChangeBadge change={item.change} title={`Previous period: ${formatValue(item.previousValue)}`} />
      </div>
    </li>;
  };

  const renderQuietRow = ({ station, lastOrder }: (typeof quietStations)[number]) => {
    const idleDays = lastOrder ? Math.max(1, Math.floor((Date.now() - lastOrder.ms) / 86400000)) : null;
    return (
      <li key={station.id}>
        <StationLogo name={station.display_name} path={station.logo_path} />
        <span>
          <strong title={station.display_name}>{station.display_name}</strong>
          <small><MapPin size={12} aria-hidden="true" /> {locationOf(station)}</small>
        </span>
        <span className="quiet-station-badge" title={lastOrder ? `Last order ${timeAgo(lastOrder.iso)}` : `No orders in the last ${ANALYTICS_LOOKBACK_DAYS} days`}>{idleDays === null ? `${ANALYTICS_LOOKBACK_DAYS}d+ idle` : `${idleDays}d idle`}</span>
      </li>
    );
  };

  const rankToggle = (
    <div className="rank-toggle" role="group" aria-label="Rank stations by">
      <button type="button" aria-pressed={salesMode} onClick={() => setLeaderboardMode("sales")}>Sales</button>
      <button type="button" aria-pressed={!salesMode} onClick={() => setLeaderboardMode("orders")}>Orders</button>
    </div>
  );

  // Statuses that share a colour family (e.g. delivered + completed) get progressively lighter shades.
  const toneSeen = new Map<string, number>();
  const shadedEntries = statusEntries.map((entry) => {
    const seen = toneSeen.get(entry.tone) ?? 0;
    toneSeen.set(entry.tone, seen + 1);
    return { ...entry, shade: Math.min(seen, 2) };
  });
  let donutOffset = 0;
  const donutSegments = shadedEntries.map((entry, index) => {
    const length = Math.max(0.4, entry.share - (statusEntries.length > 1 ? 0.8 : 0));
    const segment = { ...entry, index, length, offset: donutOffset };
    donutOffset += entry.share;
    return segment;
  });
  const completedShare = currentOrders.length > 0 ? (completedCount / currentOrders.length) * 100 : 0;
  const cancelledShare = currentOrders.length > 0 ? (cancelledCount / currentOrders.length) * 100 : 0;

  const totalReviews = data.ratingDistribution.reduce((total, count) => total + count, 0);
  const maxRatingCount = Math.max(...data.ratingDistribution, 0);
  const trendSummary = `Daily paid sales for ${periodName}: ${money(salesTotal)} in total${bestDay && bestDay.sales > 0 ? `, best day ${bestDay.label} at ${money(bestDay.sales)}` : ""}.`;

  return (
    <section className="admin-analytics" aria-label="Platform analytics">
      <div className="pulse">
        <div className="pulse-top">
          <div className="pulse-title"><h2>Platform analytics</h2><p>Sales, orders and ratings across AquaDirect.</p></div>
          <div className="analytics-controls">
            <div className="period-picker" role="group" aria-label="Analytics period">
              {periodOptions.map((option) => (
                <button key={option.value} type="button" aria-pressed={period === option.value} onClick={() => setPeriod(option.value)}>{option.label}</button>
              ))}
            </div>
            <label className="analytics-location">
              <MapPin size={14} aria-hidden="true" />
              <span className="analytics-sr">Location</span>
              <select value={salesLocation} onChange={(event) => setSalesLocation(event.target.value)}>
                <option value="all">All locations</option>
                {locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
              </select>
            </label>
          </div>
        </div>

        <p className="analytics-range-note">
          <CalendarDays size={13} aria-hidden="true" />
          <strong>{range.label}</strong>
          <span>{formatRange(range.start, range.end)}</span>
          <span>compared with {formatRange(range.previousStart, range.previousEnd)}</span>
          {salesLocation !== "all" && <em className="scope">{salesLocation}</em>}
        </p>

        <div className="pulse-figures">
          <div className="pulse-main">
            <span className="pulse-label">Paid sales</span>
            <strong className="pulse-number"><CountUp value={salesTotal} format={money} /></strong>
            <div className="pulse-delta"><ChangeBadge change={salesChange} onDark /><span>vs {money(previousSalesTotal)} in the previous period</span></div>
          </div>
          <dl className="pulse-stats">
            <div><dt>Paid orders</dt><dd>{paidOrderCount.toLocaleString("en-PH")}</dd></div>
            <div><dt>Daily average</dt><dd>{money(salesTotal / trend.length)}</dd></div>
            <div><dt>Best day</dt><dd>{bestDay && bestDay.sales > 0 ? `${bestDay.label} · ${moneyCompact(bestDay.sales)}` : "—"}</dd></div>
          </dl>
        </div>

        <div className="trend-head">
          <h3>Platform sales trend</h3>
          <div className="trend-legend"><span><i /> This period</span>{hasPreviousTrend && <span><i className="ghost" /> Previous period</span>}</div>
        </div>
        {salesTotal === 0 && !hasPreviousTrend ? (
          <div className="pulse-empty">No paid sales in {periodName} yet. The trend appears here once payments are marked paid.</div>
        ) : (
          <SalesTrendChart key={replayKey} trend={trend} hasPrevious={hasPreviousTrend} summary={trendSummary} />
        )}
      </div>

      <div className="stat-tiles">
        <article className="stat-tile">
          <header><span>Orders</span><BarChart3 size={16} aria-hidden="true" /></header>
          <strong><CountUp value={currentOrders.length} format={formatCount} /></strong>
          <footer><ChangeBadge change={ordersChange} title={`Previous period: ${previousOrders.length.toLocaleString("en-PH")} orders`} /><small>{activeOrders.toLocaleString("en-PH")} still active</small></footer>
        </article>
        <article className="stat-tile">
          <header><span>Average order value</span><Receipt size={16} aria-hidden="true" /></header>
          <strong>{paidOrderCount > 0 ? <CountUp value={averageOrder} format={money} /> : "—"}</strong>
          <footer>{paidOrderCount > 0 && <ChangeBadge change={averageChange} title={previousPaidOrderCount > 0 ? `Previous period: ${money(previousAverageOrder)}` : "No paid orders in the previous period"} />}<small>per paid order</small></footer>
        </article>
        <article className="stat-tile">
          <header><span>Customers</span><Users size={16} aria-hidden="true" /></header>
          <strong>{data.totalCustomers === null ? (data.canViewCustomers ? "Unavailable" : "Restricted") : <CountUp value={data.totalCustomers} format={formatCount} />}</strong>
          <footer><small>{data.totalCustomers === null ? (data.canViewCustomers ? "Count could not load" : "Needs customer.read") : "All-time accounts"}</small></footer>
        </article>
      </div>

      <div className="analytics-columns">
        <div className="analytics-col">
          <section className="panel station-sales-panel">
            <div className="panel-heading">
              <div><h2>Top stations</h2><p>Share of {salesMode ? "paid sales" : "orders"} and change vs the previous period</p></div>
              {rankToggle}
            </div>
            <div className="lb-summary">
              <strong>{formatValue(rankTotal)}</strong>
              <ChangeBadge change={pctChange(rankTotal, previousRankTotal)} />
              <span>previous {formatValue(previousRankTotal)} · {ranked.length} station{ranked.length === 1 ? "" : "s"} with {salesMode ? "sales" : "orders"}</span>
            </div>
            {ranked.length === 0 ? <div className="analytics-empty">No station activity in {periodName}. Try another period or location.</div> : (
              <ol className="station-sales-list" key={`${leaderboardMode}|${replayKey}`}>{rankedWithRank.slice(0, PREVIEW_ROWS).map(renderRankRow)}</ol>
            )}
            {ranked.length > PREVIEW_ROWS && (
              <div className="station-sales-more">
                <button className="text-button" type="button" onClick={() => openDrawer("top")}>View all {ranked.length} stations <ArrowRight size={14} /></button>
              </div>
            )}
            <p className="station-sales-footnote">Sales are payments marked <code>paid</code>, counted on the payment date and attributed to the order’s station. COD orders count once their payment is marked paid. Shares are within the selected location.</p>
          </section>
        </div>

        <div className="analytics-col">
          <section className="panel mix-panel">
            <div className="panel-heading"><div><h2>Order-status mix</h2><p>{currentOrders.length.toLocaleString("en-PH")} order{currentOrders.length === 1 ? "" : "s"} in {periodName}</p></div><PackageCheck size={18} className="analytics-heading-icon" /></div>
            {statusEntries.length === 0 ? <div className="analytics-empty">Order statuses appear here once orders are placed.</div> : (
              <>
                <div className="mix" key={replayKey}>
                  <div className="donut">
                    <svg viewBox="0 0 40 40" role="img" aria-label="Share of orders by status">
                      <circle className="donut-track" cx="20" cy="20" r="15.9155" />
                      {donutSegments.map((segment) => (
                        <circle
                          key={segment.key}
                          className={`donut-seg stroke-${segment.tone} shade-${segment.shade}`}
                          cx="20" cy="20" r="15.9155" pathLength={100}
                          transform="rotate(-90 20 20)"
                          style={{ strokeDasharray: `${segment.length} ${100 - segment.length}`, strokeDashoffset: -segment.offset, "--i": segment.index } as CSSProperties}
                        />
                      ))}
                    </svg>
                    <div className="donut-center"><strong>{currentOrders.length.toLocaleString("en-PH")}</strong><span>orders</span></div>
                  </div>
                  <ul className="mix-legend">
                    {shadedEntries.map((entry) => (
                      <li key={entry.key}>
                        <span><i className={`status-dot tone-${entry.tone} shade-${entry.shade}`} />{entry.label}</span>
                        <strong>{entry.count.toLocaleString("en-PH")} <small>{entry.share.toFixed(1)}%</small></strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mix-note">{completedShare.toFixed(1)}% completed · {cancelledShare.toFixed(1)}% cancelled · {activeOrders.toLocaleString("en-PH")} still active</p>
              </>
            )}
          </section>

          <section className="panel quiet-stations-panel">
            <div className="panel-heading"><div><h2>Quiet stations</h2><p>Published stations with no orders in {periodName}</p></div><Store size={18} className="analytics-heading-icon" /></div>
            <div className="quiet-stations-count"><strong>{quietStations.length}</strong><span>published station{quietStations.length === 1 ? "" : "s"} with no orders</span></div>
            {quietStations.length === 0 ? <div className="analytics-empty">Every published station{salesLocation === "all" ? "" : " in this location"} received at least one order in this period.</div> : (
              <ul className="quiet-stations-list">{quietStations.slice(0, PREVIEW_ROWS).map(renderQuietRow)}</ul>
            )}
            {quietStations.length > PREVIEW_ROWS && (
              <div className="station-sales-more">
                <button className="text-button" type="button" onClick={() => openDrawer("quiet")}>View all {quietStations.length} stations <ArrowRight size={14} /></button>
              </div>
            )}
          </section>
          <section className="panel admin-ratings-panel">
            <div className="panel-heading">
              <div>
                <h2>Station ratings</h2>
                <p>Overall average and stations ranked by total customer ratings.</p>
              </div>
              <Star size={18} className="analytics-heading-icon" fill="currentColor" />
            </div>
            <div className="rating-overall">
              <strong>{data.ratingAverage === null ? "—" : data.ratingAverage.toFixed(1)}</strong>
              <span>/ 5</span>
              <span className="rating-stars" aria-label={data.ratingAverage === null ? "No ratings" : `${data.ratingAverage.toFixed(1)} out of 5`}>
                {Array.from({ length: 5 }, (_, index) => (
                  <Star key={index} size={15} fill={data.ratingAverage !== null && index < Math.round(data.ratingAverage) ? "currentColor" : "none"} />
                ))}
              </span>
            </div>
            {data.stationRatings.length === 0 ? (
              <div className="analytics-empty">A station will appear in the rankings after it receives at least 3 ratings.</div>
            ) : (
              <ol className="top-rated-stations">
                {data.stationRatings.slice(0, PREVIEW_RATINGS).map((station, index) => (
                  <li key={station.id}>
                    <span>{index + 1}</span>
                    <StationLogo name={station.display_name} path={station.logo_path} />
                    <strong>{station.display_name}</strong>
                    <small>{station.rating_count.toLocaleString("en-PH")} rating{station.rating_count === 1 ? "" : "s"}</small>
                    <b><Star size={12} fill="currentColor" /> {Number(station.rating_average).toFixed(1)}</b>
                  </li>
                ))}
              </ol>
            )}
            {data.stationRatings.length > PREVIEW_RATINGS && (
              <div className="station-sales-more">
                <button className="text-button" type="button" onClick={() => openDrawer("ratings")}>View all {data.stationRatings.length} rated stations <ArrowRight size={14} /></button>
              </div>
            )}
            {data.canViewReviewDistribution && (
              <div className="rating-distribution" aria-label="Visible station rating distribution">
                {[5, 4, 3, 2, 1].map((stars) => {
                  const count = data.ratingDistribution[stars - 1];
                  return (
                    <div className="rating-distribution-row" key={stars}>
                      <span>{stars} <Star size={11} fill="currentColor" /></span>
                      <span className="rating-distribution-track">
                        <span style={{ width: maxRatingCount > 0 ? `${(count / maxRatingCount) * 100}%` : "0%" }} />
                      </span>
                      <small>{count}</small>
                    </div>
                  );
                })}
                <small className="rating-distribution-note">{totalReviews.toLocaleString("en-PH")} visible review{totalReviews === 1 ? "" : "s"} · distribution available to review moderators only</small>
              </div>
            )}
          </section>
        </div>
      </div>

      {drawer === "top" && (() => {
        const rows = rankedWithRank.filter((item) => matchesSearch(item.station?.display_name ?? "", locationOf(item.station)));
        return (
          <ListDrawer title="Top stations" subtitle={`By ${salesMode ? "paid sales" : "orders"} · ${periodName}`} total={rankedWithRank.length} shown={rows.length} query={drawerQuery} onQuery={setDrawerQuery} onClose={closeDrawer} toolbar={rankToggle}>
            <ol className="station-sales-list is-compact" key={leaderboardMode}>{rows.map(renderRankRow)}</ol>
          </ListDrawer>
        );
      })()}
      {drawer === "quiet" && (() => {
        const rows = quietStations.filter(({ station }) => matchesSearch(station.display_name, locationOf(station)));
        return (
          <ListDrawer title="Quiet stations" subtitle={`No orders · ${periodName}`} total={quietStations.length} shown={rows.length} query={drawerQuery} onQuery={setDrawerQuery} onClose={closeDrawer}>
            <ul className="quiet-stations-list">{rows.map(renderQuietRow)}</ul>
          </ListDrawer>
        );
      })()}
      {drawer === "ratings" && (() => {
        const rows = data.stationRatings.map((station, index) => ({ station, rank: index + 1 })).filter(({ station }) => matchesSearch(station.display_name, ""));
        return (
          <ListDrawer title="Station ratings" subtitle="Ranked by total ratings" total={data.stationRatings.length} shown={rows.length} query={drawerQuery} onQuery={setDrawerQuery} onClose={closeDrawer}>
            <ol className="top-rated-stations">
              {rows.map(({ station, rank }) => (
                <li key={station.id}>
                  <span>{rank}</span>
                  <StationLogo name={station.display_name} path={station.logo_path} />
                  <strong>{station.display_name}</strong>
                  <small>{station.rating_count.toLocaleString("en-PH")} rating{station.rating_count === 1 ? "" : "s"}</small>
                  <b><Star size={12} fill="currentColor" /> {Number(station.rating_average).toFixed(1)}</b>
                </li>
              ))}
            </ol>
          </ListDrawer>
        );
      })()}
    </section>
  );
}

function StationLogo({ name, path }: { name: string; path: string | null }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = path
    ? path.startsWith("http")
      ? path
      : supabase?.storage.from("station-assets").getPublicUrl(path).data.publicUrl
    : null;

  if (!imageUrl || failed) {
    return <span className="station-rating-logo station-rating-logo-fallback" aria-label={`${name} logo unavailable`}>{name.trim().slice(0, 1).toUpperCase() || "S"}</span>;
  }
  return <img className="station-rating-logo" src={imageUrl} alt={`${name} logo`} loading="lazy" onError={() => setFailed(true)} />;
}

function ReviewQueue({ rows, onSelect, onViewAll }: { rows: Row[]; onSelect: (row: Row) => void; onViewAll: () => void }) {
  const queue = rows.filter((row) => row.application_status === "submitted" || row.application_status === "in_review").slice(0, 6);
  return (
    <section className="panel queue">
      <div className="panel-heading">
        <div><h2>Review queue</h2><p>Applications waiting for a decision, newest first.</p></div>
        <button className="text-button" type="button" onClick={onViewAll}>All applications <ArrowRight size={14} /></button>
      </div>
      {queue.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><Inbox size={20} /></span>
          <strong>Nothing waiting for review</strong>
          <p>New station submissions will show up here.</p>
        </div>
      ) : (
        <ul className="queue-list">
          {queue.map((row) => (
            <li key={String(row.id)}>
              <button className="queue-item" type="button" onClick={() => onSelect(row)}>
                <span className="queue-initial">{String(row.display_name ?? "?").slice(0, 1).toUpperCase()}</span>
                <span className="queue-copy">
                  <strong>{String(row.display_name)}</strong>
                  <small>{[row.city, row.province].filter(Boolean).join(", ")} · {timeAgo(row.submitted_at ?? row.created_at)}</small>
                </span>
                <StatusChip value={String(row.application_status)} />
                <ArrowRight size={15} className="queue-arrow" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentOrders({ rows, onSelect, onViewAll }: { rows: Row[]; onSelect: (row: Row) => void; onViewAll: () => void }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><h2>Recent orders</h2><p>Latest activity across all stations.</p></div>
        <button className="text-button" type="button" onClick={onViewAll}>All orders <ArrowRight size={14} /></button>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><PackageCheck size={20} /></span>
          <strong>No orders yet</strong>
          <p>Orders placed by customers will appear here.</p>
        </div>
      ) : (
        <ul className="order-list">
          {rows.map((row) => (
            <li key={String(row.id)}>
              <button className="order-item" type="button" onClick={() => onSelect(row)}>
                <span className="order-main"><strong>#{row.order_number}</strong><small>{timeAgo(row.created_at)}</small></span>
                <span className="order-total">{money(Number(row.total ?? 0))}</span>
                <StatusChip value={String(row.status)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DataTable({ kind, rows, selectedId, onSelect, includeAccountEmail = false }: { kind: Kind; rows: Row[]; selectedId: Row[string] | undefined; onSelect?: (row: Row) => void; includeAccountEmail?: boolean }) {
  const config = tableConfig[kind];
  const columns = (kind === "customers" || kind === "stationOwners") && !includeAccountEmail
    ? config.columns.filter((column) => column !== "email")
    : config.columns;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const statuses = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const value = row[config.statusKey];
      if (value != null) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
    });
    return Array.from(counts.entries());
  }, [rows, config.statusKey]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return rows.filter((row) =>
      (filter === "all" || String(row[config.statusKey]) === filter)
      && (!text || Object.values(row).some((value) => value != null && String(value).toLowerCase().includes(text))),
    );
  }, [rows, query, filter, config.statusKey]);

  return (
    <section className="panel table-panel">
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={config.searchLabel} aria-label={config.searchLabel} />
        </label>
        <div className="chips" role="group" aria-label="Filter by status">
          <button className={`filter ${filter === "all" ? "filter-active" : ""}`} type="button" onClick={() => setFilter("all")}>All <span>{rows.length}</span></button>
          {statuses.map(([value, count]) => (
            <button className={`filter ${filter === value ? "filter-active" : ""}`} key={value} type="button" onClick={() => setFilter(value)}>
              {sentence(value)} <span>{count}</span>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><Inbox size={20} /></span>
          <strong>{kind === "customers" ? "No customer accounts found" : kind === "stationOwners" ? "No station owner accounts found" : kind === "adminAccounts" ? "No admin accounts found" : "Nothing here yet"}</strong>
          {kind === "applications" ? (
            <p>A seller login alone does not create an application. The seller must sign in to the Seller Portal, complete Station details, and save the profile. Both portals must use the same Supabase project.</p>
          ) : kind === "customers" || kind === "stationOwners" ? (
            <p>{kind === "customers" ? "Customer-only accounts" : "Accounts assigned the station owner role"} will appear here. Email visibility requires the customer.email.view permission.</p>
          ) : kind === "adminAccounts" ? (
            <p>No accounts currently have the admin role.</p>
          ) : (
            <p>Records will appear once they are created.</p>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><Search size={20} /></span>
          <strong>No matches</strong>
          <p>Try a different search or clear the status filter.</p>
          <button className="button button-secondary button-small" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{columnLabels[column]}</th>)}</tr></thead>
            <tbody>
              {visible.map((row, index) => (
                <tr
                  key={String(row.id ?? index)}
                  className={selectedId !== undefined && row.id === selectedId ? "row-selected" : ""}
                  tabIndex={onSelect ? 0 : undefined}
                  onClick={onSelect ? () => onSelect(row) : undefined}
                  onKeyDown={onSelect ? (event) => { if (event.key === "Enter") onSelect(row); } : undefined}
                >
                  {columns.map((column, columnIndex) => (
                    <td key={column} className={columnIndex === 0 ? "cell-primary" : ""}>{formatCell(column, row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-foot">Showing {visible.length} of {rows.length} latest records</div>
    </section>
  );
}

function formatCell(column: string, value: Row[string]): ReactNode {
  if (value == null) return "—";
  if (column === "order_number") return `#${value}`;
  if (dateKeys.has(column)) return shortDate(String(value));
  if (moneyKeys.has(column)) return <span className="num">{money(Number(value))}</span>;
  if (column === "permit_renewal") return <StatusChip value={String(value)} />;
  if (column.includes("status")) return <StatusChip value={String(value)} />;
  if (column === "payment_method") return <StatusChip neutral value={String(value) === "cod" ? "Cash on delivery" : String(value)} />;
  return String(value);
}

function formatDetail(key: string, value: Row[string]): ReactNode {
  if (value == null || value === "") return "—";
  if (dateKeys.has(key)) return new Date(String(value)).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
  if (key === "service_radius_km") return `${value} km`;
  if (key === "rating_average") return `${value} / 5`;
  return formatCell(key, value);
}

function Drawer({ selection, perms, onChanged, onClose }: { selection: NonNullable<Selection>; perms: Permissions; onChanged: () => Promise<void>; onClose: () => void }) {
  const { kind, row } = selection;
  const [copied, setCopied] = useState(false);
  const statusEntries = Object.entries(row).filter(([key, value]) => key.includes("status") && value != null);
  const detailEntries = Object.entries(row).filter(([key]) => key !== "id" && !key.includes("status") && key !== "display_name" && key !== "order_number");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(String(row.id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={titleOf(kind, row)}>
        <header className="drawer-head">
          <div>
            <span className="drawer-kind">{kind === "applications" ? "Application" : kind === "stations" ? "Station" : "Order"}</span>
            <h2>{titleOf(kind, row)}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close details" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="drawer-body">
          {statusEntries.length > 0 && (
            <div className="drawer-status">
              {statusEntries.map(([key, value]) => (
                <div key={key}><span>{columnLabels[key] ?? sentence(key)}</span><StatusChip value={String(value)} /></div>
              ))}
            </div>
          )}
          {kind === "applications" && <ApplicationReview key={String(row.id)} row={row} perms={perms} onChanged={onChanged} />}
          {kind === "stations" && <StationActions key={String(row.id)} row={row} perms={perms} onChanged={onChanged} />}
          <dl className="drawer-list">
            {detailEntries.map(([key, value]) => (
              <div key={key}><dt>{sentence(key)}</dt><dd>{formatDetail(key, value)}</dd></div>
            ))}
          </dl>
        </div>
        <footer className="drawer-foot">
          <span className="drawer-id">ID {String(row.id).slice(0, 8)}…</span>
          <button className="button button-secondary button-small" type="button" onClick={() => void copyId()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy ID"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DecisionPanel({
  actions,
  busy,
  compact = false,
  noteLabel,
  onConfirm,
}: {
  actions: DecisionAction[];
  busy: boolean;
  compact?: boolean;
  noteLabel: string;
  onConfirm: (id: string, notes: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const active = actions.find((action) => action.id === pending);

  function choose(action: DecisionAction) {
    if (action.needsNote) {
      setPending(action.id);
      setNotes("");
    } else {
      onConfirm(action.id, "");
    }
  }

  return (
    <div className={`decision ${compact ? "decision-compact" : ""}`}>
      <div className="decision-buttons">
        {actions.map((action) => (
          <button
            className={`button button-small button-${action.tone} ${pending === action.id ? "button-pressed" : ""}`}
            key={action.id}
            type="button"
            disabled={busy || action.disabled}
            onClick={() => choose(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {active && (
        <div className="decision-note">
          <textarea autoFocus rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={noteLabel} aria-label={noteLabel} />
          <div className="decision-note-actions">
            <button className="button button-secondary button-small" type="button" onClick={() => setPending(null)}>Cancel</button>
            <button
              className={`button button-small button-${active.tone}`}
              type="button"
              disabled={busy || !notes.trim()}
              onClick={() => {
                onConfirm(active.id, notes);
                setPending(null);
              }}
            >
              Confirm: {active.label.toLowerCase()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultNote({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className={`result result-${result.kind}`} role={result.kind === "error" ? "alert" : "status"}>
      {result.kind === "success" ? <Check size={15} /> : <AlertCircle size={15} />}
      <span>{result.text}</span>
    </div>
  );
}

const applicationMessages: Record<string, string> = {
  in_review: "Review started.",
  approved: "Application approved. Publish the station from the Stations tab when it's ready.",
  changes_requested: "Changes requested. The owner can update and resubmit.",
  rejected: "Application rejected.",
};

function ApplicationReview({ row, perms, onChanged }: { row: Row; perms: Permissions; onChanged: () => Promise<void> }) {
  const id = String(row.id);
  const status = String(row.application_status);
  const reviewable = status === "submitted" || status === "in_review";
  const permitRenewalReview = status === "approved";
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const loadDocs = useCallback(async () => {
    if (!supabase) return;
    const columns = "id, document_type, storage_path, review_status, review_notes, required_for_verification, expires_at, submitted_at";
    let rows: DocRow[] = [];
    let message: string | null = null;
    const current = await supabase.from("station_documents")
      .select(`${columns}, is_current`)
      .eq("application_id", id)
      .eq("is_current", true)
      .order("document_type");
    if (!current.error) {
      rows = (current.data ?? []) as unknown as DocRow[];
    } else {
      message = current.error.message;
    }
    setDocError(message);
    setDocs(rows);
  }, [id]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const required = (docs ?? []).filter((doc) => doc.required_for_verification && doc.is_current !== false);
  const canApprove = required.length > 0 && required.every((doc) => doc.review_status === "approved");
  const renewalPending = (docs ?? []).some((doc) =>
    doc.document_type === "business_permit"
    && doc.is_current !== false
    && doc.review_status === "pending",
  );

  async function openDocument(doc: DocRow) {
    if (!supabase) return;
    const tab = window.open("about:blank", "_blank");
    const { data, error } = await supabase.storage.from("station-documents").createSignedUrl(doc.storage_path, 120);
    if (error || !data?.signedUrl) {
      tab?.close();
      setResult({ kind: "error", text: error?.message ?? "This document could not be opened." });
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else {
      window.open(data.signedUrl, "_blank");
    }
  }

  async function reviewDocument(doc: DocRow, decision: string, notes: string) {
    if (!supabase) return;
    setBusy(doc.id);
    setResult(null);
    const { error } = await supabase.rpc("review_station_document", {
      p_document_id: doc.id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    });
    setBusy(null);
    if (error) {
      setResult({ kind: "error", text: error.message });
      return;
    }
    setResult({ kind: "success", text: `${sentence(doc.document_type)} marked ${sentence(decision).toLowerCase()}.` });
    await loadDocs();
    if (permitRenewalReview && doc.document_type === "business_permit") {
      await onChanged();
    }
  }

  async function decide(decision: string, notes: string) {
    if (!supabase) return;
    setBusy("application");
    setResult(null);
    const { error } = await supabase.rpc("review_application", {
      p_application_id: id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    });
    setBusy(null);
    if (error) {
      setResult({ kind: "error", text: error.message });
      return;
    }
    setResult({ kind: "success", text: applicationMessages[decision] ?? "Application updated." });
    await onChanged();
  }

  const decisions: DecisionAction[] = [];
  if (status === "submitted") decisions.push({ id: "in_review", label: "Start review", tone: "secondary", needsNote: false });
  if (reviewable) {
    decisions.push(
      { id: "approved", label: "Approve", tone: "positive", needsNote: false, disabled: !canApprove },
      { id: "changes_requested", label: "Request changes", tone: "secondary", needsNote: true },
      { id: "rejected", label: "Reject", tone: "danger", needsNote: true },
    );
  }

  return (
    <div className="review">
      <ResultNote result={result} />
      <section>
        <h3>Documents</h3>
        {docs === null ? (
          <p className="review-note"><span className="spinner" /> Loading documents…</p>
        ) : docError ? (
          <p className="review-note review-note-error">{docError}</p>
        ) : docs.length === 0 ? (
          <p className="review-note">No documents have been uploaded yet.</p>
        ) : (
          <ul className="doc-list">
            {docs.map((doc) => (
              <li className="doc-item" key={doc.id}>
                <div className="doc-head">
                  <span className="doc-icon"><FileText size={16} /></span>
                  <span className="doc-copy">
                    <strong>{sentence(doc.document_type)}</strong>
                    <small>
                      Uploaded {timeAgo(doc.submitted_at)}
                      {doc.required_for_verification ? "" : " · Optional"}
                      {doc.document_type === "business_permit" && doc.expires_at
                        ? ` · Expires ${shortDate(doc.expires_at)}`
                        : ""}
                    </small>
                  </span>
                  <StatusChip value={permitRenewalReview && doc.document_type === "business_permit" && doc.review_status === "pending" ? "renewal_review" : doc.review_status} />
                  <button className="icon-button" type="button" aria-label={`Open ${sentence(doc.document_type)}`} onClick={() => void openDocument(doc)}><ExternalLink size={15} /></button>
                </div>
                  {permitRenewalReview && doc.is_current !== false && doc.document_type === "business_permit" && doc.review_status === "pending" && (
                    <p className="review-note">Renewed permit submitted. Review the replacement; the station remains approved.</p>
                  )}
                  {doc.review_notes && <p className="doc-notes">{doc.review_notes}</p>}
                  {perms.review && doc.is_current !== false && (reviewable || (permitRenewalReview && doc.document_type === "business_permit" && doc.review_status === "pending")) && (
                  <DecisionPanel
                    compact
                    busy={busy === doc.id}
                    noteLabel="Tell the owner what needs to change"
                    actions={[
                      { id: "approved", label: "Approve", tone: "positive", needsNote: false, disabled: doc.review_status === "approved" },
                      { id: "changes_requested", label: "Needs changes", tone: "secondary", needsNote: true },
                      { id: "rejected", label: "Reject", tone: "danger", needsNote: true },
                    ]}
                    onConfirm={(decision, notes) => void reviewDocument(doc, decision, notes)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Decision</h3>
        {!perms.review ? (
          <p className="review-note">Your account doesn't have permission to review applications.</p>
        ) : decisions.length === 0 ? (
          <p className="review-note">
            {permitRenewalReview && renewalPending
              ? "Review the pending business permit renewal above; the station remains approved."
              : `No review actions are available for ${sentence(status).toLowerCase()} applications.`}
          </p>
        ) : (
          <>
            <DecisionPanel busy={busy === "application"} noteLabel="Add a note for the station owner" actions={decisions} onConfirm={(decision, notes) => void decide(decision, notes)} />
            {permitRenewalReview && renewalPending
              ? <p className="review-note">Reviewing this renewal does not change the station's approved application status.</p>
              : docs !== null && !canApprove
                ? <p className="review-note">Approve every required document to enable approval.</p>
                : null}
          </>
        )}
      </section>
    </div>
  );
}

function StationActions({ row, perms, onChanged }: { row: Row; perms: Permissions; onChanged: () => Promise<void> }) {
  const id = String(row.id);
  const publication = String(row.publication_status);
  const verified = String(row.verification_status) === "verified";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const actions: DecisionAction[] = [];
  if (publication === "unpublished" && perms.publish) {
    actions.push({ id: "publish", label: "Publish station", tone: "positive", needsNote: false, disabled: !verified });
  }
  if (publication === "published" && perms.suspend) {
    actions.push({ id: "suspend", label: "Suspend station", tone: "danger", needsNote: true });
  }

  async function run(action: string, notes: string) {
    if (!supabase) return;
    setBusy(true);
    setResult(null);
    const { error } = action === "publish"
      ? await supabase.rpc("publish_station", { p_station_id: id })
      : await supabase.rpc("suspend_station", { p_station_id: id, p_reason: notes.trim() });
    setBusy(false);
    if (error) {
      setResult({ kind: "error", text: error.message });
      return;
    }
    setResult({
      kind: "success",
      text: action === "publish" ? "Station published. Customers can now find it." : "Station suspended and removed from customer search.",
    });
    await onChanged();
  }

  return (
    <div className="review">
      <ResultNote result={result} />
      <section>
        <h3>Publication</h3>
        {actions.length > 0 && (
          <DecisionPanel busy={busy} noteLabel="Reason for suspension (kept in the audit log)" actions={actions} onConfirm={(action, notes) => void run(action, notes)} />
        )}
        <p className="review-note">
          {publication === "published" && (perms.suspend ? "This station is visible to customers." : "This station is visible to customers. Your account can't suspend stations.")}
          {publication === "unpublished" && (!perms.publish ? "Your account doesn't have permission to publish stations." : verified ? "Publishing checks hours, delivery area and at least one active product." : "Approve the station's application before publishing.")}
          {publication === "suspended" && "Suspended stations can't be reinstated from this console yet."}
          {publication === "archived" && "This station is archived."}
        </p>
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton skeleton-kpis" />
      <div className="skeleton-cols"><div className="skeleton skeleton-panel" /><div className="skeleton skeleton-panel" /></div>
    </div>
  );
}

function MessagePage({ title, message, action, busy = false }: { title: string; message: string; action?: ReactNode; busy?: boolean }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand size="lg" />
        <h1>{title}</h1>
        <p>{busy && <span className="spinner" />} {message}</p>
        {action}
      </div>
    </main>
  );
}

export default App;
