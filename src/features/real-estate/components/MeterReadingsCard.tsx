import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { Gauge, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useRemActor } from "../hooks/use-real-estate";
import { useAddMeterReadingMutation, useMeterReadings } from "../hooks/use-real-estate-ops";
import { RemSelect } from "./RemSelect";
import { remErrorText } from "../lib/ui-maps";
import type { Unit } from "../types/real-estate.types";

/**
 * Utility meter readings ledger for a unit. Readings are append-only facts;
 * a regression below the previous reading is allowed only with a note
 * (meter swapped/reset) — enforced server-side by MeterReadingService.add.
 */
export function MeterReadingsCard({ unit }: { unit: Unit }) {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canCreate = can("real_estate.create");
  const actor = useRemActor();

  const { data: readings = [] } = useMeterReadings(unit.id);
  const add = useAddMeterReadingMutation();

  const [adding, setAdding] = useState(false);
  const [meterId, setMeterId] = useState("");
  const [reading, setReading] = useState("");
  const [readingDate, setReadingDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const meters = unit.meters ?? [];

  const submit = async () => {
    const meter = meters.find((m) => m.id === meterId);
    if (!meter) {
      toast.error(t("validation.required"));
      return;
    }
    if (!Number.isFinite(Number(reading)) || Number(reading) < 0) {
      toast.error(t("validation.money"));
      return;
    }
    try {
      await add.mutateAsync({
        by: actor,
        input: {
          unitId: unit.id,
          propertyId: unit.propertyId,
          meterId: meter.id,
          meterNumber: meter.meterNumber,
          utility: meter.utility,
          reading: Number(reading),
          readingDate,
          note: note.trim() || null,
          photoUrl: null,
          createdBy: actor,
        },
      });
      setAdding(false);
      setReading("");
      setNote("");
    } catch (e) {
      toast.error(remErrorText(t, e));
    }
  };

  return (
    <Card>
      <CardBody className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-default-800 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" /> {t("meterReadings.title")}
          </h2>
          {canCreate && meters.length > 0 && (
            <Button size="sm" variant="flat" color="primary" startContent={<Plus className="w-4 h-4" />} onPress={() => setAdding(true)}>
              {t("meterReadings.add")}
            </Button>
          )}
        </div>

        {meters.length === 0 && (
          <p className="text-sm text-default-400">{t("meterReadings.noMeters")}</p>
        )}

        {adding && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end border border-default-200 rounded-lg p-3">
            <RemSelect
              label={t("meterReadings.meter")}
              value={meterId}
              onChange={setMeterId}
              options={meters.map((m) => ({ id: m.id, label: `${t(`utility.${m.utility}`, { defaultValue: m.utility })} · ${m.meterNumber}` }))}
            />
            <Input
              label={t("meterReadings.reading")}
              type="number"
              min="0"
              value={reading}
              onValueChange={setReading}
            />
            <Input
              label={t("fields.date")}
              type="date"
              value={readingDate}
              onValueChange={setReadingDate}
            />
            <div className="flex gap-2">
              <Input
                className="flex-1"
                label={t("meterReadings.note")}
                value={note}
                onValueChange={setNote}
                description={t("meterReadings.regressionHint")}
              />
              <Button size="sm" color="primary" isLoading={add.isPending} onPress={() => void submit()}>
                {t("buttons.save")}
              </Button>
            </div>
          </div>
        )}

        {readings.length === 0 ? (
          meters.length === 0 ? null : <p className="text-sm text-default-400">{t("meterReadings.empty")}</p>
        ) : (
          <ul className="divide-y divide-default-100">
            {readings.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <Chip size="sm" variant="flat" color="default">
                  {t(`utility.${r.utility}`, { defaultValue: r.utility })} · {r.meterNumber}
                </Chip>
                <span className="tabular-nums font-medium">{r.reading.toLocaleString()}</span>
                <span className="text-xs text-default-500">{formatDate(r.readingDate)}</span>
                {r.note && <span className="text-xs text-default-400">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
