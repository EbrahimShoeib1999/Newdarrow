/**
 * Global Back/Forward history controls for the shared header.
 *
 * True browser-style navigation: the pair walks the user's actual visit
 * order across portals (via navigate(-1)/navigate(1)), never a per-page
 * shortcut to the dashboard. Availability comes from the mirrored router
 * history (navigation-history.ts), so both buttons visibly disable when the
 * stack has no entry in that direction — e.g. right after a deep link or a
 * refresh, where the per-page registry BackBar still offers its smart
 * fallback and this pair stays inert instead of guessing.
 *
 * Direction follows the shell's RTL convention (same as BackBar/PageHeader):
 * the arrow glyph itself flips with the document direction.
 */

import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, Tooltip } from "@heroui/react";
import type { useNavHistory } from "@/features/portals/hooks/use-nav-history";

export interface NavHistoryControlsProps {
  /** The shell (AppLayout) runs the tracker once and hands the pair its
   *  read-model, so exactly one component observes the router transitions. */
  history: ReturnType<typeof useNavHistory>;
}

export function NavHistoryControls({ history }: NavHistoryControlsProps) {
  const { t, i18n } = useTranslation();
  const { canBack, canForward, back, forward } = history;

  const isRtl = i18n.dir() === "rtl";
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const ForwardIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      role="group"
      aria-label={t("nav.history", "Navigation history")}
      data-testid="nav-history"
    >
      <Tooltip content={t("actions.back")}>
        <span className="inline-flex">
          <Button
            isIconOnly
            variant="light"
            size="sm"
            className="min-w-0 h-8 w-8 sm:h-9 sm:w-9 shrink-0"
            isDisabled={!canBack}
            onPress={back}
            aria-label={t("actions.back")}
            data-testid="nav-history-back"
          >
            <BackIcon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </Button>
        </span>
      </Tooltip>
      <Tooltip content={t("actions.forward", "Forward")}>
        <span className="inline-flex">
          <Button
            isIconOnly
            variant="light"
            size="sm"
            className="min-w-0 h-8 w-8 sm:h-9 sm:w-9 shrink-0"
            isDisabled={!canForward}
            onPress={forward}
            aria-label={t("actions.forward", "Forward")}
            data-testid="nav-history-forward"
          >
            <ForwardIcon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
