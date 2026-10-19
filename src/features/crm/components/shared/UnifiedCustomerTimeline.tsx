import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Chip, Spinner } from "@heroui/react";
import {
  User,
  Briefcase,
  FileText,
  CheckSquare,
  Receipt,
  HandCoins,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useCustomerTimeline } from "../../hooks/use-customer-timeline";
import {
  TIMELINE_FILTERS,
  type TimelineCategory,
  type TimelineEvent,
} from "../../utils/lifecycle-timeline";

const CATEGORY_ICON: Record<TimelineCategory, typeof User> = {
  customer: User,
  deal: Briefcase,
  contract: FileText,
  task: CheckSquare,
  invoice: Receipt,
  payment: HandCoins,
  activity: MessageSquare,
};

const CATEGORY_COLOR: Record<TimelineCategory, string> = {
  customer: "default",
  deal: "warning",
  contract: "primary",
  task: "secondary",
  invoice: "danger",
  payment: "success",
  activity: "default",
};

function eventLabel(e: TimelineEvent, t: TFunction<"crm">): string {
  const params = e.params ?? {};
  // Activity "logged" subjects are stored data (English) — show verbatim.
  if (e.kind === "logged" && typeof params.subject === "string") {
    return params.subject;
  }
  const key = `timeline.events.${e.labelKey}` as Parameters<typeof t>[0];
  return String(t(key, params));
}

interface Props {
  contactId: string;
}

export function UnifiedCustomerTimeline({ contactId }: Props) {
  const { t } = useTranslation("crm");
  const { data: users } = useAllUsers();
  const { data: events, isLoading, isError } = useCustomerTimeline(contactId);
  const [active, setActive] = useState<Set<TimelineCategory>>(new Set());

  const actorName = (id?: string) =>
    id ? users?.find((u) => u.id === id)?.name : undefined;

  const filtered = (events ?? []).filter(
    (e) => active.size === 0 || active.has(e.category)
  );

  const toggle = (c: TimelineCategory) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-default-500">
        <Spinner size="sm" />
        <span className="text-sm">{t("timeline.loading")}</span>
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-danger">{t("timeline.error")}</p>;
  }

  if (!events || events.length === 0) {
    return <p className="text-default-500 text-sm">{t("timeline.empty")}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {TIMELINE_FILTERS.map((c) => {
          const Icon = CATEGORY_ICON[c];
          const on = active.size === 0 || active.has(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors ${
                on
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-default-200 text-default-400"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(`timeline.categories.${c}`)}
            </button>
          );
        })}
      </div>

      {/* Events */}
      <ul className="space-y-3">
        {filtered.map((e) => {
          const Icon = CATEGORY_ICON[e.category];
          const who = actorName(e.actorUserId);
          const body = (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="flat" color={CATEGORY_COLOR[e.category] as never}>
                  {t(`timeline.categories.${e.category}`)}
                </Chip>
                <p className="font-semibold text-sm">{eventLabel(e, t)}</p>
              </div>
              <p className="text-[11px] text-default-400 mt-1">
                {formatDate(e.timestamp)}
                {who ? ` · ${who}` : ""}
              </p>
            </>
          );
          return (
            <li
              key={e.id}
              className="flex gap-3 p-4 rounded-xl border border-default-100 bg-content1"
            >
              <div className="w-8 h-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              {e.route ? (
                <Link
                  to={e.route}
                  className="flex-1 min-w-0 group flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">{body}</div>
                  <ArrowRight className="w-4 h-4 shrink-0 text-default-300 group-hover:text-primary rtl:rotate-180" />
                </Link>
              ) : (
                <div className="flex-1 min-w-0">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
