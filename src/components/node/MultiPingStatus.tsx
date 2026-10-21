import { t } from "@/i18n";
import { memo, useState } from "react";
import { clsx } from "clsx";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { usePreferences } from "@/hooks/usePreferences";
import type { HomepagePingDisplayLine } from "@/types/cfsm";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { LatencyBars } from "./LatencyBars";
import { PingLineSwitcher } from "./PingLineSwitcher";
import { QualityBars } from "./QualityBars";
import { formatHealthBucketTooltip } from "./pingBucketText";

type MultiPingStatusDensity = "large" | "compact";
type MultiPingMetric = "latency" | "loss";

const MultiPingMetricRow = memo(function MultiPingMetricRow({
  uuid,
  slot,
  line,
  metric,
  density,
  redrawKey,
}: {
  uuid: string;
  slot: number;
  line: HomepagePingDisplayLine;
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const latencyColor = latencyHeatColor(line.lastValue);
  const lossColor = lossHeatColor(line.loss);
  const isLoading = line.loadState === "pending";
  const isError = line.loadState === "error";
  const staleError = isError && (line.lastValue != null || line.loss != null);
  const latencyLabel =
    isLoading && line.lastValue == null
      ? t("card.pingLoading")
      : isError && line.lastValue == null
        ? t("card.pingFailed")
        : line.lastValue == null
          ? t("card.pingNoSamples")
          : `${Math.round(line.lastValue)}ms`;
  const lossLabel =
    isLoading && line.loss == null
      ? t("card.pingLoading")
      : isError && line.loss == null
        ? t("card.pingFailed")
        : line.loss == null
          ? "—"
          : `${line.loss.toFixed(1)}%`;
  const hoveredBucket =
    hoveredIndex == null ? null : (line.buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket
    ? formatHealthBucketTooltip(hoveredBucket, metric)
    : null;
  const chartHeight = density === "compact" ? 9 : 11;
  const value = metric === "latency" ? line.lastValue : line.loss;
  const valueColor = metric === "latency" ? latencyColor : lossColor;
  const unit = metric === "latency" ? "ms" : "%";
  const waiting = isLoading && value == null;
  const displayValue =
    waiting
      ? "..."
      : isError && value == null
        ? "!"
        : value == null
          ? "—"
          : metric === "latency"
            ? Math.round(value)
            : value.toFixed(1);
  return (
    <div
      className="multi-ping-metric-row"
      data-load-state={line.loadState ?? "ready"}
      title={`${t("multi.rowTitle", { task: line.taskName, latency: latencyLabel, loss: lossLabel })}${
        staleError ? t("multi.staleSuffix") : ""
      }`}
    >
      <div
        className={clsx(
          "multi-ping-metric-head",
          metric === "loss" && "is-value-only",
        )}
      >
        {metric === "latency" && (
          <PingLineSwitcher uuid={uuid} slot={slot} taskName={line.taskName} />
        )}
        <strong
          className="multi-ping-value tabular"
          style={{
            color: value == null ? "var(--text-tertiary)" : valueColor,
          }}
        >
          {displayValue}
          {value != null && <small>{unit}</small>}
        </strong>
      </div>
      <span className="multi-ping-buckets">
        {metric === "latency" ? (
          <LatencyBars
            buckets={line.buckets}
            redrawKey={redrawKey}
            height={chartHeight}
            onHoverIndex={setHoveredIndex}
          />
        ) : (
          <QualityBars
            buckets={line.buckets}
            redrawKey={redrawKey}
            height={chartHeight}
            onHoverIndex={setHoveredIndex}
          />
        )}
        <HealthBucketTooltip
          text={tooltip}
          index={hoveredIndex}
          count={line.buckets.length}
        />
      </span>
    </div>
  );
});

const MultiPingMetricColumn = memo(function MultiPingMetricColumn({
  uuid,
  lines,
  metric,
  density,
  redrawKey,
}: {
  uuid: string;
  lines: HomepagePingDisplayLine[];
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  return (
    <div
      className="multi-ping-metric-column"
      aria-label={t(metric === "latency" ? "card.latency" : "card.loss")}
    >
      {lines.map((line, slot) => (
        // 按行号当 key，不按线路 id：访客在这一行换了线路（PingLineSwitcher）后还是同一行、
        // 同一颗按钮，焦点能回到它身上；按线路 id 会让整行卸载重建。
        <MultiPingMetricRow
          key={slot}
          uuid={uuid}
          slot={slot}
          line={line}
          metric={metric}
          density={density}
          redrawKey={redrawKey}
        />
      ))}
    </div>
  );
});

export const MultiPingStatus = memo(function MultiPingStatus({
  uuid,
  lines,
  density,
  className,
}: {
  uuid: string;
  lines: HomepagePingDisplayLine[];
  density: MultiPingStatusDensity;
  className?: string;
}) {
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;

  return (
    <div
      className={clsx("multi-ping-status", `is-${density}`, className)}
      role="group"
      aria-label={t("multi.groupLabel")}
    >
      <div className="multi-ping-columns">
        <MultiPingMetricColumn
          uuid={uuid}
          lines={lines}
          metric="latency"
          density={density}
          redrawKey={redrawKey}
        />
        <MultiPingMetricColumn
          uuid={uuid}
          lines={lines}
          metric="loss"
          density={density}
          redrawKey={redrawKey}
        />
      </div>
    </div>
  );
});
