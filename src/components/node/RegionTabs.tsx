import { t } from "@/i18n";
import { useMemo } from "react";
import { Flag } from "@/components/ui/Flag";
import { useDragReorder } from "@/hooks/useDragReorder";
import { HOME_ALL_REGION, type HomeRegionOption } from "@/utils/homeNodes";

/**
 * 地区筛选栏：按国旗聚合节点，点击某地区只看该地区，再点一次（或点已选中项）回到全部。
 * 与分组栏是两条独立筛选，可叠加（先分组、后地区）。
 *
 * 传了 `onReorder` 就能直接拖动标签调整顺序（鼠标按住拖，触屏长按再拖）。拖动中只改本组件里的
 * 预览顺序，抬手才交给上层存；Esc 或浏览器中断拖动（pointercancel）就退回原顺序。
 */
export function RegionTabs({
  regions,
  selectedRegion,
  onSelectRegion,
  onReorder,
}: {
  regions: HomeRegionOption[];
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
  /** 拖完、且顺序真的变了才调，参数是当前显示的全部地区代码。 */
  onReorder?: (codes: string[]) => void;
}) {
  const codes = useMemo(() => regions.map((region) => region.code), [regions]);
  const byCode = useMemo(
    () => new Map(regions.map((region) => [region.code, region])),
    [regions],
  );
  const { containerRef, order, draggingCode, itemRef, itemHandlers, shouldIgnoreClick } =
    useDragReorder({ codes, onReorder });

  return (
    <section className="home-region-bar" aria-label={t("region.filterLabel")}>
      <div
        ref={containerRef}
        className="home-region-chips"
        role="group"
        data-reordering={draggingCode ? "true" : undefined}
      >
        {order.map((code) => {
          const region = byCode.get(code);
          if (!region) return null;
          const active = selectedRegion === code;
          return (
            <button
              key={code}
              ref={itemRef(code)}
              type="button"
              className="home-region-chip"
              data-active={active ? "true" : "false"}
              data-dragging={draggingCode === code ? "true" : undefined}
              aria-pressed={active}
              {...itemHandlers(code)}
              onClick={() => {
                if (shouldIgnoreClick()) return;
                onSelectRegion(active ? HOME_ALL_REGION : code);
              }}
              title={code}
            >
              <Flag region={code} size={14} />
              <span className="home-region-chip-code">{code}</span>
              <span className="home-region-chip-count">{region.count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
