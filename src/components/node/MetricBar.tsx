import { useCallback, type ReactNode } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";

interface MetricBarProps {
  icon: ReactNode;
  label: string;
  valueText: string;
  unit?: string;
  detailText?: string;
  fraction: number; // 0..1
  redrawKey?: string;
  paint: string; // 填充色 (CSS color)
}

export function MetricBar({
  icon,
  label,
  valueText,
  unit,
  detailText,
  fraction,
  redrawKey,
}: MetricBarProps) {
  const clamped = Math.max(0, Math.min(1, fraction));

  // 连续进度条:先画整条底槽,再画按位置着色(绿 → 橙 → 红)的填充。
  // 渐变铺满整条宽度,填充只露出左边已用的那一段,所以占用越高,末端越红。
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const radius = height / 2;
      const inactiveColor = safeCanvasColor("var(--progress-bg)");

      ctx.globalAlpha = 0.58;
      ctx.fillStyle = inactiveColor;
      fillRoundedRect(ctx, 0, 0, width, height, radius);

      if (clamped > 0) {
        const fillWidth = Math.max(height, width * clamped);
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, "#22c55e");
        gradient.addColorStop(0.65, "#f59e0b");
        gradient.addColorStop(1, "#ef4444");

        ctx.globalAlpha = 1;
        ctx.fillStyle = gradient;
        fillRoundedRect(ctx, 0, 0, fillWidth, height, radius);
      }

      ctx.globalAlpha = 1;
    },
    [clamped],
  );

  return (
    <div className="metric-item">
      <div className="flex justify-between items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-[var(--text-secondary)] flex-shrink-0">
          <span>{icon}</span>
          <span className="text-[11px] font-medium tracking-[0.02em]">{label}</span>
        </div>
        <div className="tabular text-[13px] text-[var(--text-primary)] whitespace-nowrap overflow-hidden text-ellipsis max-w-full text-right">
          <span className="font-semibold">{valueText}</span>
          {unit && (
            <span className="ml-[1px] text-[11px] text-[var(--text-tertiary)]">{unit}</span>
          )}
        </div>
      </div>
      <div
        className="metric-detail"
        title={detailText}
        data-empty={detailText ? "false" : "true"}
      >
        {detailText ?? "\u00A0"}
      </div>
      <div className="metric-track">
        <CanvasStrip
          className="metric-track-canvas"
          height={8}
          redrawKey={redrawKey}
          draw={draw}
        />
      </div>
    </div>
  );
}
